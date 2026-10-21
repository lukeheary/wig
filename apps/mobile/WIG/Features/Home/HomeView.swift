import ClerkKit
import SwiftUI
import UIKit

enum GlobalSearchFilter: String, CaseIterable, Identifiable {
    case all
    case people
    case places
    case events

    var id: String { rawValue }
    var title: String { rawValue.capitalized }
}

@MainActor
private final class HomeActivationViewModel: ObservableObject {
    @Published private(set) var state: MobileActivationState?

    var incompleteTasks: [MobileActivationTask] {
        (state?.tasks ?? []).filter { !$0.isComplete }
    }

    func load(using apiClient: APIClient) async {
        do {
            state = try await apiClient.send(APIClient.mobileActivationState())
        } catch {
            // Activation is supplemental; Home should remain usable if it fails.
        }
    }
}

@MainActor
private final class LatestFromFollowsViewModel: ObservableObject {
    @Published private(set) var events = [EventFeedItem]()

    private var loadedCacheIdentity: String?
    private var loadToken: UUID?

    func load(
        using apiClient: APIClient,
        cacheIdentity: String,
        forceRefresh: Bool = false
    ) async {
        guard forceRefresh || loadedCacheIdentity != cacheIdentity || events.isEmpty else {
            return
        }

        let token = UUID()
        loadToken = token

        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = .autoupdatingCurrent
        guard let rangeEnd = calendar.date(byAdding: .day, value: 31, to: .now) else {
            return
        }

        do {
            let response = try await apiClient.send(
                APIClient.mobileEventsPreview(
                    startDate: .now,
                    endDate: rangeEnd,
                    limit: 500
                )
            )

            guard !Task.isCancelled, loadToken == token else {
                return
            }

            // Newer API versions return an unbounded latest feed. Merge it with
            // this 31-day event range so the section also stays independent from
            // Home's weekly request while older API environments are still in use.
            var seenEventIDs = Set<UUID>()
            events = ((response.latestFromPlaces ?? response.latestFromFollows ?? []) + response.events)
                .filter { seenEventIDs.insert($0.id).inserted }
            loadedCacheIdentity = cacheIdentity
        } catch is CancellationError {
            return
        } catch {
            // Keep the last successful result during a transient refresh failure.
        }
    }

    func clear() {
        loadToken = nil
        loadedCacheIdentity = nil
        events = []
    }
}

@MainActor
private final class HomeForegroundRefreshCoordinator: ObservableObject {
    private var needsRefresh = false
    private var refreshTask: Task<Void, Never>?

    func scenePhaseChanged(
        to phase: ScenePhase,
        eventDetailPresented: Bool,
        refresh: @escaping @MainActor () async -> Void
    ) {
        refreshTask?.cancel()
        refreshTask = nil

        guard phase == .active else {
            needsRefresh = false
            return
        }

        needsRefresh = true

        guard !eventDetailPresented else {
            return
        }

        schedule(refresh)
    }

    func eventDetailPresentationChanged(
        isPresented: Bool,
        scenePhase: ScenePhase,
        refresh: @escaping @MainActor () async -> Void
    ) {
        guard needsRefresh else {
            return
        }

        if isPresented {
            refreshTask?.cancel()
            refreshTask = nil
            return
        }

        guard scenePhase == .active else {
            return
        }

        schedule(refresh)
    }

    func dataDidChange(
        eventDetailPresented: Bool,
        refresh: @escaping @MainActor () async -> Void
    ) {
        needsRefresh = true
        refreshTask?.cancel()
        refreshTask = nil

        // Event edits post their change notification before the edit sheet and
        // event detail finish dismissing. Waiting until the detail closes avoids
        // racing the freshly updated What's New response. Changes made outside an
        // event detail are still refreshed automatically after the normal debounce.
        guard !eventDetailPresented else {
            return
        }

        schedule(refresh)
    }

    private func schedule(_ refresh: @escaping @MainActor () async -> Void) {
        refreshTask?.cancel()
        refreshTask = Task { @MainActor [weak self] in
            try? await Task.sleep(for: .milliseconds(500))

            guard !Task.isCancelled, let self else {
                return
            }

            await refresh()

            guard !Task.isCancelled else {
                return
            }

            self.needsRefresh = false
            self.refreshTask = nil
        }
    }
}

struct HomeView: View {
    let showsNativeSearch: Bool
    let resetToCurrentWeekTrigger: Int
    let onShowActivity: () -> Void
    let onSearchDismiss: () -> Void
    let onFindFriends: () -> Void
    let onExplorePlaces: () -> Void
    let onAddProfilePhoto: () -> Void
    let initialSearchFilter: GlobalSearchFilter
    let searchFilterTrigger: Int
    let onSearchEvents: () -> Void
    let showsSearchBackButton: Bool
    let onSearchBack: () -> Void
    let shouldAutoFocusSearch: Bool
    let onInitialContentReady: () -> Void

    @Environment(Clerk.self) private var clerk
    @Environment(\.apiClient) private var apiClient
    @Environment(\.scenePhase) private var scenePhase
    @EnvironmentObject private var appSession: AppSession
    @StateObject private var foregroundRefreshCoordinator = HomeForegroundRefreshCoordinator()
    @StateObject private var viewModel = EventFeedViewModel()
    @StateObject private var latestFromFollowsViewModel = LatestFromFollowsViewModel()
    @StateObject private var recentActivityViewModel = HomeRecentActivityViewModel()
    @StateObject private var searchViewModel = HomeSearchDirectoryViewModel()
    @StateObject private var homeEventSearchViewModel = HomeSearchDirectoryViewModel()
    @StateObject private var activationViewModel = HomeActivationViewModel()
    @State private var selectedWeekStart = Self.startOfWeek(for: .now)
    @State private var isSearchPresented = false
    @State private var searchText = ""
    @State private var homeEventSearchText = ""
    @State private var isHomeEventSearchPresented = false
    @FocusState private var isSearchFieldFocused: Bool
    @FocusState private var isHomeEventSearchFocused: Bool
    @State private var selectedLocationFilter: HomeLocationFilter?
    @State private var selectedEventFilter: HomeEventFilter = .all
    @State private var selectedWhatsNewFilter: HomeWhatsNewFilter?
    @State private var selectedCategoryFilterID: String?
    @State private var postEventFeedbackEvent: MobileEventReviewPrompt?
    @State private var postEventFeedbackPrompt: MobileEventReviewPrompt?
    @State private var pendingPostEventDetail: EventFeedItem?
    @State private var completedPostEventFeedbackIDs = Set<String>()
    @State private var selectedSearchFilter: GlobalSearchFilter
    @AppStorage("accountSearchRecentDestinations.v1") private var accountSearchHistoriesData = "{}"

    private static let sectionTitleFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEE, MMM d"
        return formatter
    }()
    private static let weekRangeMonthFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d"
        return formatter
    }()
    private static var weekCalendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.firstWeekday = 2
        return calendar
    }()

    private let eventCardWidth: CGFloat = 220

    init(
        showsNativeSearch: Bool = false,
        resetToCurrentWeekTrigger: Int = 0,
        onShowActivity: @escaping () -> Void = {},
        onSearchDismiss: @escaping () -> Void = {},
        onFindFriends: @escaping () -> Void = {},
        onExplorePlaces: @escaping () -> Void = {},
        onAddProfilePhoto: @escaping () -> Void = {},
        initialSearchFilter: GlobalSearchFilter = .all,
        searchFilterTrigger: Int = 0,
        onSearchEvents: @escaping () -> Void = {},
        showsSearchBackButton: Bool = false,
        onSearchBack: @escaping () -> Void = {},
        shouldAutoFocusSearch: Bool = false,
        onInitialContentReady: @escaping () -> Void = {}
    ) {
        self.showsNativeSearch = showsNativeSearch
        self.resetToCurrentWeekTrigger = resetToCurrentWeekTrigger
        self.onShowActivity = onShowActivity
        self.onSearchDismiss = onSearchDismiss
        self.onFindFriends = onFindFriends
        self.onExplorePlaces = onExplorePlaces
        self.onAddProfilePhoto = onAddProfilePhoto
        self.initialSearchFilter = initialSearchFilter
        self.searchFilterTrigger = searchFilterTrigger
        self.onSearchEvents = onSearchEvents
        self.showsSearchBackButton = showsSearchBackButton
        self.onSearchBack = onSearchBack
        self.shouldAutoFocusSearch = shouldAutoFocusSearch
        self.onInitialContentReady = onInitialContentReady
        _selectedSearchFilter = State(initialValue: initialSearchFilter)
    }

    var body: some View {
        NavigationStack {
            AnyView(
                content
                .background(feedBackground)
                .topStatusBarScrim()
                .toolbar(.hidden, for: .navigationBar)
                .task {
                    loadCompletedPostEventFeedbackIDs()

                    let activationTask = Task { @MainActor in
                        if shouldLoadActivation {
                            await activationViewModel.load(using: apiClient)
                        }
                    }

                    if case .idle = viewModel.state {
                        await loadHome(for: selectedWeekStart, using: apiClient)
                    }

                    await activationTask.value

                    if case .loaded = viewModel.state {
                        onInitialContentReady()
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: .activationDidChange)) { _ in
                    guard shouldLoadActivation else { return }
                    Task { await activationViewModel.load(using: apiClient) }
                }
                .onAppear {
                    if showsNativeSearch {
                        isSearchPresented = true
                        if shouldAutoFocusSearch {
                            focusUnifiedSearchField()
                        }
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: .eventRSVPDidChange)) { _ in
                    foregroundRefreshCoordinator.dataDidChange(
                        eventDetailPresented: appSession.isEventDetailPresented
                    ) {
                        await loadHome(for: selectedWeekStart, using: apiClient, forceRefresh: true)
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: .mobileEventDidChange)) { _ in
                    foregroundRefreshCoordinator.dataDidChange(
                        eventDetailPresented: appSession.isEventDetailPresented
                    ) {
                        await loadHome(for: selectedWeekStart, using: apiClient, forceRefresh: true)
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: .homeFeedVisibilityDidChange)) { _ in
                    viewModel.invalidateResponses(keeping: selectedWeekStart)

                    Task {
                        await loadHome(for: selectedWeekStart, using: apiClient, forceRefresh: true)
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: .friendRequestDidChange)) { notification in
                    if let userID = notification.userInfo?["userID"] as? String,
                       let rawStatus = notification.userInfo?["friendStatus"] as? String,
                       let status = FriendUserSummary.FriendStatus(rawValue: rawStatus) {
                        searchViewModel.updateFriendStatus(for: userID, status: status)
                    }

                    Task {
                        await loadHome(for: selectedWeekStart, using: apiClient, forceRefresh: true)
                        if shouldLoadActivation {
                            await activationViewModel.load(using: apiClient)
                        }
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: .appDataDidChange)) { _ in
                    HomeSearchDirectoryViewModel.invalidateCache()

                    foregroundRefreshCoordinator.dataDidChange(
                        eventDetailPresented: appSession.isEventDetailPresented
                    ) {
                        await loadHome(for: selectedWeekStart, using: apiClient, forceRefresh: true)

                        if showsNativeSearch {
                            await searchViewModel.load(
                                query: normalizedSearchQuery,
                                using: apiClient,
                                forceRefresh: true
                            )
                        }
                    }
                }
            )
                .onChange(of: selectedWeekStart) { _, weekStart in
                    Task {
                        await loadHome(for: weekStart, using: apiClient)
                    }
                }
                .onChange(of: clerk.user?.id) { _, _ in
                    selectedWhatsNewFilter = nil
                }
                .onChange(of: viewModel.feedTimeZoneIdentifier) { oldIdentifier, newIdentifier in
                    guard let newIdentifier,
                          let newTimeZone = TimeZone(identifier: newIdentifier)
                    else {
                        return
                    }

                    let oldTimeZone = oldIdentifier.flatMap(TimeZone.init(identifier:)) ?? .autoupdatingCurrent
                    let oldCurrentWeekStart = logicalStartOfWeek(for: .now, timeZone: oldTimeZone)

                    if selectedWeekStart == oldCurrentWeekStart {
                        selectedWeekStart = logicalStartOfWeek(for: .now, timeZone: newTimeZone)
                    }
                }
                .onChange(of: scenePhase) { _, phase in
                    guard !showsNativeSearch else {
                        return
                    }

                    foregroundRefreshCoordinator.scenePhaseChanged(
                        to: phase,
                        eventDetailPresented: appSession.isEventDetailPresented
                    ) {
                        await loadHome(
                            for: selectedWeekStart,
                            using: apiClient,
                            forceRefresh: true
                        )
                    }
                }
                .onChange(of: appSession.presentedEventDetail?.id) { _, presentationID in
                    guard !showsNativeSearch else {
                        return
                    }

                    foregroundRefreshCoordinator.eventDetailPresentationChanged(
                        isPresented: presentationID != nil,
                        scenePhase: scenePhase
                    ) {
                        await loadHome(
                            for: selectedWeekStart,
                            using: apiClient,
                            forceRefresh: true
                        )
                    }
                }
                .onChange(of: resetToCurrentWeekTrigger) { _, _ in
                    resetToCurrentWeek()
                }
                .onChange(of: searchFilterTrigger) { _, _ in
                    selectedSearchFilter = initialSearchFilter
                    searchText = ""
                    isSearchPresented = showsNativeSearch

                    if showsNativeSearch {
                        Task {
                            await searchViewModel.load(
                                query: "",
                                using: apiClient,
                                forceRefresh: true
                            )
                        }
                    }

                    if shouldAutoFocusSearch {
                        focusUnifiedSearchField()
                    }
                }
                .onChange(of: selectedLocationFilter) { _, newValue in
                    appSession.selectedCityContext = newValue?.selectedCityContext
                }
                .task(id: recentActivityLocationKey) {
                    await loadRecentActivity(using: apiClient)
                }
                .onChange(of: isSearchPresented) { _, isPresented in
                    guard showsNativeSearch,
                          !isPresented,
                          searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    else {
                        return
                    }

                    onSearchDismiss()
                }
                .task(id: normalizedSearchQuery) {
                    await loadNativeSearchResults()
                }
                .task(id: homeEventSearchRequestKey) {
                    await loadHomeEventSearchResults()
                }
                .onChange(of: searchText) { _, value in
                    prepareNativeSearch(query: value)
                }
                .onChange(of: homeEventSearchText) { _, value in
                    prepareHomeEventSearch(query: value)
                }
                .task(id: displayedEventPrefetchKey) {
                    await prefetchDisplayedEventArtwork()
                }
                .sheet(
                    item: $postEventFeedbackEvent,
                    onDismiss: presentPendingPostEventDetail,
                    content: postEventFeedbackSheet
                )
        }
        .nativeSearch(
            isEnabled: showsNativeSearch,
            text: $searchText,
            isPresented: $isSearchPresented
        )
    }

    private func loadNativeSearchResults() async {
        guard showsNativeSearch else {
            return
        }

        if !normalizedSearchQuery.isEmpty {
            try? await Task.sleep(for: .milliseconds(300))
            guard !Task.isCancelled else { return }
        }

        await searchViewModel.load(
            query: normalizedSearchQuery,
            using: apiClient
        )
    }

    private func focusUnifiedSearchField() {
        guard showsNativeSearch else { return }

        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(150))

            guard !Task.isCancelled, showsNativeSearch else { return }
            isSearchFieldFocused = true
        }
    }

    private func loadHomeEventSearchResults() async {
        guard !showsNativeSearch, isHomeEventSearchPresented else {
            return
        }

        await homeEventSearchViewModel.load(
            query: homeEventSearchQuery,
            using: apiClient
        )
    }

    private func prepareNativeSearch(query: String) {
        guard showsNativeSearch else {
            return
        }

        searchViewModel.prepare(query: query)
    }

    private func prepareHomeEventSearch(query: String) {
        guard !showsNativeSearch, isHomeEventSearchPresented else {
            return
        }

        homeEventSearchViewModel.prepare(query: query)
    }

    private func prefetchDisplayedEventArtwork() async {
        let events = displayedEventsForPrefetch
        guard !events.isEmpty else {
            return
        }

        await EventArtworkPrefetcher.prefetch(events: events)
    }

    @ViewBuilder
    private var content: some View {
        contentForEventFeedState
    }

    @ViewBuilder
    private var contentForEventFeedState: some View {
        switch viewModel.state {
        case .idle, .loading:
            if currentResponse != nil || viewModel.isLoading(weekStart: selectedWeekStart) {
                homeContentShell
            } else {
                NativeLoadingView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(feedBackground)
            }

        case .failed(let message):
            if currentResponse != nil {
                homeContentShell
            } else {
                ContentUnavailableView {
                    Label("Couldn’t Load Events", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(message)
                } actions: {
                    Button("Try Again") {
                        Task {
                            await loadHome(for: selectedWeekStart, using: apiClient, forceRefresh: true)
                        }
                    }
                    .foregroundStyle(.white)
                    .buttonStyle(.borderedProminent)
                    .tint(.black)
                }
                .foregroundStyle(.white)
                .background(feedBackground)
            }

        case .loaded:
            homeContentShell
        }
    }

    private var shouldLoadActivation: Bool {
        isAuthenticated && !showsNativeSearch
    }

    private var homeContentShell: some View {
        ZStack(alignment: .top) {
            if isShowingSearchResults {
                searchResultsContent
            } else {
                if shouldShowWeekLoadingIndicator {
                    weekLoadingContent
                        .id("loading-\(selectedWeekStart.timeIntervalSinceReferenceDate)")
                } else {
                    weeklyContent
                        .id("events-\(selectedWeekStart.timeIntervalSinceReferenceDate)")
                }
            }

            homeTopControls

            if isHomeEventSearchPresented {
                homeEventSearchOverlay
                    .zIndex(1)
            }
        }
        .background(feedBackground)
    }

    private var weeklyContent: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 24) {
                if isViewingCurrentWeek, let postEventFeedbackPrompt {
                    PostEventFeedbackBanner(event: postEventFeedbackPrompt) {
                        postEventFeedbackEvent = postEventFeedbackPrompt
                    }
                    .padding(.horizontal, 16)
                }

                if isViewingCurrentWeek, isAuthenticated, !activationViewModel.incompleteTasks.isEmpty {
                    HomeActivationSection(
                        tasks: activationViewModel.incompleteTasks,
                        onFindFriends: onFindFriends,
                        onExplorePlaces: onExplorePlaces,
                        onAddProfilePhoto: onAddProfilePhoto
                    )
                    .transition(.opacity.combined(with: .move(edge: .top)))
                }

                if shouldShowRecentActivity {
                    HomeRecentActivitySection(
                        activities: recentActivityViewModel.activities.filter {
                            activity in
                            guard !activity.type.isRequest,
                                  let event = activity.event
                            else {
                                return true
                            }
                            return effectiveLocationFilter.includes(event)
                        },
                        onShowActivity: onShowActivity,
                        onRespondToRequest: { activity, response in
                            do {
                                switch (activity.type, response) {
                                case (.friendRequestReceived, .accept):
                                    try await apiClient.send(APIClient.acceptMobileFriendRequest(friendRequestID: activity.id.uuidString))
                                case (.friendRequestReceived, .decline):
                                    try await apiClient.send(APIClient.declineMobileFriendRequest(friendRequestID: activity.id.uuidString))
                                case (.partnerRequestReceived, .accept):
                                    try await apiClient.send(APIClient.acceptMobilePartnerRequest(partnerID: activity.id.uuidString))
                                case (.partnerRequestReceived, .decline):
                                    try await apiClient.send(APIClient.declineMobilePartnerRequest(partnerID: activity.id.uuidString))
                                default:
                                    return
                                }
                                await loadRecentActivity(
                                    using: apiClient,
                                    forceRefresh: true
                                )
                            } catch {
                                // silently ignore — user can retry via activity tab
                            }
                        }
                    )
                    .padding(.bottom, -8)
                }

                ForEach(Array(groupedEvents.enumerated()), id: \.element.day) { index, section in
                    HomeEventDaySection(
                        section: section,
                        eventCardWidth: eventCardWidth
                    ) {
                        sectionHeader(
                            section.title,
                            showsLocation: index == 0 && isViewingCurrentWeek
                        )
                    }
                    if index == 0, shouldShowLatestFromFollows {
                        WhatsNewSection(
                            updates: visibleWhatsNewUpdates,
                            followsPlaces: hasFollowedPlaces,
                            selection: Binding(
                                get: { effectiveWhatsNewFilter },
                                set: { selectedWhatsNewFilter = $0 }
                            )
                        )
                            .padding(.bottom, 8)
                    }
                }
            }
            .padding(
                .top,
                isViewingCurrentWeek && postEventFeedbackPrompt != nil ? 66 : 74
            )
            .padding(.bottom, 18)
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
    }

    private var weekLoadingContent: some View {
        NativeLoadingView()
            .padding(.top, 56)
    }

    private var searchResultsContent: some View {
        ZStack(alignment: .top) {
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 14) {
                    searchFilterBar
                        .scrollingPillFade()
                        .padding(.horizontal, 16)

                    if normalizedSearchQuery.isEmpty {
                        recentSearchesSection
                        discoverySearchContent
                    } else if !searchViewModel.isLoading && !hasResultsForSelectedSearchFilter {
                        ContentUnavailableView {
                            Label("No Results Found", systemImage: "magnifyingglass")
                        } description: {
                            Text("Try a different search or filter.")
                        }
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 48)
                    } else {
                        populatedSearchContent
                    }
                }
                .frame(maxWidth: .infinity)
                .padding(.top, 60)
                .padding(.bottom, 18)
            }
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)

            if showsCenteredSearchLoadingState {
                NativeLoadingView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
                    .allowsHitTesting(false)
            }

            searchInputBar
                .padding(.horizontal, 16)
        }
    }

    private var searchFilterBar: some View {
        ScopePillBar {
            ForEach(GlobalSearchFilter.allCases) { filter in
                ScopePill(
                    title: filter.title,
                    isSelected: selectedSearchFilter == filter
                ) {
                    selectedSearchFilter = filter
                }
            }
        }
    }

    @ViewBuilder
    private var recentSearchesSection: some View {
        if !filteredRecentSearchDestinations.isEmpty {
            VStack(alignment: .leading, spacing: 9) {
                HStack {
                    SearchSectionHeader(title: "Recent")
                    Spacer()
                    Button("Clear") { recentSearchDestinationsData = "[]" }
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.58))
                }

                VStack(alignment: .leading, spacing: 6) {
                    ForEach(filteredRecentSearchDestinations) { destination in
                        switch destination {
                        case .person(let user):
                            NavigationLink {
                                UserProfileView(userID: user.id)
                            } label: {
                                SearchUserRow(user: user)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                            .simultaneousGesture(
                                TapGesture().onEnded {
                                    rememberSearchDestination(.person(user))
                                }
                            )

                        case .place(let place):
                            NavigationLink {
                                PlaceDetailView(place: place)
                            } label: {
                                PlaceRowView(place: place, style: .plain)
                            }
                            .buttonStyle(.plain)
                            .simultaneousGesture(
                                TapGesture().onEnded {
                                    rememberSearchDestination(.place(place))
                                }
                            )

                        case .event(let event):
                            EventDetailNavigationLink(
                                event: event,
                                preloadsRSVP: true,
                                onOpen: { rememberSearchDestination(.event($0)) }
                            ) {
                                SearchEventRow(event: event)
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .contentShape(Rectangle())
                            }
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
        }
    }

    @ViewBuilder
    private var discoverySearchContent: some View {
        if selectedSearchFilter == .all || selectedSearchFilter == .people {
            searchPeopleSection(users: Array(emptyStateRecentUsers.prefix(selectedSearchFilter == .people ? 20 : 8)), title: "People")
        }
        if selectedSearchFilter == .all || selectedSearchFilter == .places {
            searchPlacesSection(
                places: Array(
                    searchViewModel.suggestedPlaces
                        .sorted(by: sortSearchPlacesAlphabetically)
                        .prefix(selectedSearchFilter == .places ? 200 : 5)
                ),
                title: "Places"
            )
        }
        if selectedSearchFilter == .all || selectedSearchFilter == .events {
            searchEventsSection(
                events: Array(metroAreaEventRecommendations.prefix(selectedSearchFilter == .events ? 10 : 8)),
                title: "Events"
            )
        }
    }

    private var metroAreaEventRecommendations: [EventFeedItem] {
        guard let currentUserLocation else {
            return []
        }

        return searchViewModel.upcomingEvents.filter { event in
            let eventCity = event.metroAreaCity ?? event.city
            let eventState = event.metroAreaState ?? event.state

            return eventCity.localizedCaseInsensitiveCompare(currentUserLocation.city) == .orderedSame &&
                eventState.localizedCaseInsensitiveCompare(currentUserLocation.state) == .orderedSame
        }
    }

    @ViewBuilder
    private var populatedSearchContent: some View {
        if selectedSearchFilter == .all || selectedSearchFilter == .people {
            searchPeopleSection(users: Array(searchUserResults.prefix(selectedSearchFilter == .people ? 20 : 5)), title: "People")
        }
        if selectedSearchFilter == .all || selectedSearchFilter == .places {
            searchPlacesSection(
                places: Array(
                    searchViewModel.places
                        .sorted(by: sortSearchPlacesAlphabetically)
                        .prefix(selectedSearchFilter == .places ? 20 : 5)
                ),
                title: "Places"
            )
        }
        if selectedSearchFilter == .all || selectedSearchFilter == .events {
            searchEventsSection(events: Array(searchViewModel.events.prefix(selectedSearchFilter == .events ? 20 : 8)), title: "Events")
        }
    }

    @ViewBuilder
    private func searchPeopleSection(users: [FriendUserSummary], title: String) -> some View {
        if !users.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                SearchSectionHeader(title: title)
                SearchUsersList(
                    users: users,
                    onSelect: { rememberSearchResult(.person($0)) }
                )
            }
            .padding(.horizontal, 16)
        }
    }

    @ViewBuilder
    private func searchEventsSection(events: [EventFeedItem], title: String) -> some View {
        if !events.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                SearchSectionHeader(title: title)

                VStack(alignment: .leading, spacing: 6) {
                    ForEach(events) { event in
                        EventDetailNavigationLink(
                            event: event,
                            preloadsRSVP: true,
                            onOpen: { rememberSearchResult(.event($0)) }
                        ) {
                            SearchEventRow(event: event)
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                        }
                    }
                }
            }
            .padding(.horizontal, 16)
        }
    }

    @ViewBuilder
    private func searchPlacesSection(places: [PlaceListItem], title: String) -> some View {
        if !places.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                SearchSectionHeader(title: title)
                CompactPlaceListView(
                    places: places,
                    logoCornerRadius: 8,
                    rowSpacing: 6,
                    onSelect: { rememberSearchResult(.place($0)) }
                )
            }
            .padding(.horizontal, 16)
        }
    }

    private func sortSearchPlacesAlphabetically(_ lhs: PlaceListItem, _ rhs: PlaceListItem) -> Bool {
        let comparison = lhs.name.localizedCaseInsensitiveCompare(rhs.name)

        if comparison != .orderedSame {
            return comparison == .orderedAscending
        }

        return lhs.listRowID < rhs.listRowID
    }

    private var showsCenteredSearchLoadingState: Bool {
        guard searchViewModel.isLoading else {
            return false
        }

        return normalizedSearchQuery.isEmpty
            ? !hasDiscoveryResultsForSelectedSearchFilter
            : !hasResultsForSelectedSearchFilter
    }

    private var homeEventSearchBar: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 18, weight: .medium))
                .foregroundStyle(.white.opacity(0.62))

            TextField(
                "Search events...",
                text: $homeEventSearchText
            )
            .font(.system(size: 17, weight: .medium))
            .foregroundStyle(.white)
            .textInputAutocapitalization(.never)
            .autocorrectionDisabled()
            .submitLabel(.search)
            .focused($isHomeEventSearchFocused)

            if !homeEventSearchText.isEmpty {
                Button {
                    homeEventSearchText = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.48))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16)
        .frame(height: 46)
        .frame(maxWidth: .infinity)
        .contentShape(Capsule())
        .homeLiquidGlass(in: Capsule())
    }

    private var homeEventSearchOverlay: some View {
        ZStack(alignment: .top) {
            feedBackground
                .ignoresSafeArea()

            ScrollView {
                LazyVStack(alignment: .leading, spacing: 16) {
                    Text(isSearchingHomeEvents ? "Search Results" : "Upcoming Events")
                        .font(.system(size: 20, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 16)

                    homeEventSearchGridContent
                }
                .padding(.top, 74)
                .padding(.bottom, 18)
            }
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)

            HStack(spacing: 10) {
                homeEventSearchBar

                FloatingGlassIconButton(systemImage: "xmark") {
                    dismissHomeEventSearch()
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 0)
        }
        .transition(.opacity)
        .onAppear {
            Task { @MainActor in
                try? await Task.sleep(for: .milliseconds(150))

                if isHomeEventSearchPresented {
                    isHomeEventSearchFocused = true
                }
            }
        }
    }

    @ViewBuilder
    private var homeEventSearchGridContent: some View {
        if (homeEventSearchViewModel.isLoading || !homeEventSearchViewModel.hasLoadedResults) && homeEventSearchResults.isEmpty {
            NativeLoadingView(fillsAvailableSpace: false)
                .frame(maxWidth: .infinity)
                .padding(.top, 28)
        } else if homeEventSearchResults.isEmpty {
            ContentUnavailableView {
                Label("No Events Found", systemImage: "magnifyingglass")
            } description: {
                Text("Try a different event name.")
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity)
            .padding(.top, 28)
        } else {
            LazyVGrid(
                columns: [
                    GridItem(.flexible(), spacing: 12),
                    GridItem(.flexible(), spacing: 12),
                ],
                spacing: 12
            ) {
                ForEach(homeEventSearchResults) { event in
                    EventDetailNavigationLink(event: event) {
                        EventCardView(event: event, cardHeight: 258)
                            .frame(maxWidth: .infinity)
                            .contentShape(Rectangle())
                    }
                }
            }
            .padding(.horizontal, 16)
        }
    }

    private var searchInputBar: some View {
        HStack(spacing: 12) {
            if showsSearchBackButton {
                FloatingGlassIconButton(systemImage: "chevron.left") {
                    onSearchBack()
                }
            }

            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(.white.opacity(0.92))

                TextField("", text: $searchText, prompt: Text("Search...").foregroundStyle(.white.opacity(0.42)))
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(.white)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                    .focused($isSearchFieldFocused)

                if !searchText.isEmpty {
                    Button {
                        searchText = ""
                        isSearchFieldFocused = true
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.5))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
            .frame(height: 46)
            .frame(maxWidth: .infinity)
            .contentShape(Capsule())
            .homeLiquidGlass(in: Capsule())
            .onTapGesture {
                isSearchFieldFocused = true
                isSearchPresented = true
            }

        }
    }

    private var homeTopControls: some View {
        ZStack {
            HStack(alignment: .center, spacing: 10) {
                if !isSearchPresented {
                    HomeLeadingControls(
                        selectedEventFilter: $selectedEventFilter,
                        categories: availableCategoryFilters,
                        selectedCategoryID: effectiveCategoryFilterID,
                        onSelectCategory: { filterID in
                            selectedCategoryFilterID = filterID
                        },
                        onSearch: onSearchEvents
                    )
                }

                Spacer()

                if !isSearchPresented {
                    weekPagerControl
                }
            }

            if !isSearchPresented && appSession.isAdmin {
                Menu {
                    ForEach(availableLocationFilters) { location in
                        Button {
                            selectedLocationFilter = location
                        } label: {
                            if location == effectiveLocationFilter {
                                Label(location.title, systemImage: "checkmark")
                            } else {
                                Text(location.title)
                            }
                        }
                    }
                } label: {
                    VStack(spacing: 1) {
                        Text(visibleWeekRelativeTitle)
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.56))
                            .lineLimit(1)

                        Text(visibleWeekRangeTitle)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.92))
                            .lineLimit(1)
                            .minimumScaleFactor(0.8)
                    }
                    .padding(.horizontal, 20)
                    .frame(width: 156, height: 46)
                    .contentShape(Capsule())
                    .homeLiquidGlass(in: Capsule())
                }
                .buttonStyle(.plain)
                .frame(maxWidth: .infinity)
            }

            if !isSearchPresented && !appSession.isAdmin {
                VStack(spacing: 1) {
                    Text(visibleWeekRelativeTitle)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.56))
                    Text(visibleWeekRangeTitle)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.92))
                        .minimumScaleFactor(0.8)
                }
                .lineLimit(1)
                .padding(.horizontal, 20)
                .frame(width: 156, height: 46)
                .contentShape(Capsule())
                .homeLiquidGlass(in: Capsule())
                .frame(maxWidth: .infinity)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 0)
    }

    private var weekPagerControl: some View {
        HStack(spacing: 0) {
            Button {
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                moveWeek(by: -1)
            } label: {
                pagerChevron(systemImage: "chevron.left", isEnabled: isViewingFutureWeek)
            }
            .buttonStyle(.plain)
            .disabled(!isViewingFutureWeek)

            Rectangle()
                .fill(Color.white.opacity(0.18))
                .frame(width: 1, height: 24)

            Button {
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                moveWeek(by: 1)
            } label: {
                pagerChevron(systemImage: "chevron.right", isEnabled: true)
            }
            .buttonStyle(.plain)
        }
        .frame(height: 46)
        .clipShape(Capsule())
        .homePagerLiquidGlass(in: Capsule())
        .overlay(
            Capsule()
                .strokeBorder(Color.white.opacity(0.16), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.12), radius: 14, x: 0, y: 8)
    }

    private func pagerChevron(systemImage: String, isEnabled: Bool) -> some View {
        Image(systemName: systemImage)
            .font(.system(size: 19, weight: .semibold))
            .foregroundStyle(isEnabled ? Color.primary : Color.secondary.opacity(0.55))
            .frame(width: 46, height: 46)
            .contentShape(Rectangle())
    }

    private func presentHomeEventSearch() {
        homeEventSearchText = ""
        isHomeEventSearchPresented = true
    }

    private func dismissHomeEventSearch() {
        isHomeEventSearchFocused = false
        isHomeEventSearchPresented = false
    }

    private var groupedEvents: [EventSection] {
        let grouped = Dictionary(grouping: eventsForSelectedWeek) { event in
            visibleSectionDay(for: event)
        }

        return visibleWeekDays.compactMap { day in
            let events = grouped[day] ?? []
            let title = sectionTitle(for: day)

            guard title != "Last Night" || !events.isEmpty else {
                return nil
            }

            return EventSection(
                day: day,
                title: title,
                events: events.sorted(by: sortEventsForDayRow)
            )
        }
    }

    private var visibleWeekDays: [Date] {
        let startDate = logicalDisplayRangeStartDate
        let weekEnd = logicalWeekEnd ?? startDate
        let dayCount = max(
            Self.weekCalendar.dateComponents([.day], from: startDate, to: weekEnd).day ?? 0,
            0
        )

        return (0 ..< dayCount).compactMap { offset in
            guard let day = Self.weekCalendar.date(byAdding: .day, value: offset, to: startDate) else {
                return nil
            }

            return Self.weekCalendar.startOfDay(for: day)
        }
    }

    private var visibleWeekRangeTitle: String {
        let startDate = logicalDisplayRangeStartDate
        let weekEnd = logicalWeekEnd ?? startDate
        let inclusiveEndDate = Self.weekCalendar.date(byAdding: .day, value: -1, to: weekEnd) ?? startDate
        let formattedStartDate = Self.weekRangeMonthFormatter.string(from: startDate)

        guard !Self.weekCalendar.isDate(startDate, inSameDayAs: inclusiveEndDate) else {
            return formattedStartDate
        }

        return "\(formattedStartDate) - \(Self.weekRangeMonthFormatter.string(from: inclusiveEndDate))"
    }

    private var visibleWeekRelativeTitle: String {
        let currentWeekStart = currentFeedWeekStart
        let weeksFromCurrent = Self.weekCalendar.dateComponents(
            [.weekOfYear],
            from: currentWeekStart,
            to: selectedWeekStart
        ).weekOfYear ?? 0

        switch weeksFromCurrent {
        case ...(-2):
            return "\(-weeksFromCurrent) Weeks Ago"
        case -1:
            return "Last Week"
        case 0:
            let weekday = Self.weekCalendar.component(.weekday, from: logicalFeedToday)
            return [6, 7, 1].contains(weekday) ? "This Weekend" : "This Week"
        case 1:
            return "Next Week"
        default:
            return "In \(weeksFromCurrent) Weeks"
        }
    }

    private var eventsForSelectedWeek: [EventFeedItem] {
        let startDate = logicalDisplayRangeStartDate
        let weekEnd = logicalWeekEnd

        return filteredCurrentEvents.filter { event in
            let eventDay = visibleSectionDay(for: event)
            guard let weekEnd else {
                return eventDay >= startDate && !shouldHideEndedEventFromCurrentDay(event, eventDay: eventDay)
            }

            return eventDay >= startDate &&
                eventDay < weekEnd &&
                !shouldHideEndedEventFromCurrentDay(event, eventDay: eventDay)
        }
    }

    private func shouldHideEndedEventFromCurrentDay(
        _ event: EventFeedItem,
        eventDay: Date
    ) -> Bool {
        guard isViewingCurrentWeek,
              let endAt = event.endAt,
              Self.weekCalendar.isDate(eventDay, inSameDayAs: logicalFeedToday)
        else {
            return false
        }

        return endAt <= .now
    }

    private var homeEventSearchQuery: String {
        homeEventSearchText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var isSearchingHomeEvents: Bool {
        !homeEventSearchQuery.isEmpty
    }

    private var homeEventSearchResults: [EventFeedItem] {
        guard isSearchingHomeEvents else {
            return Array(homeEventSearchViewModel.upcomingEvents.prefix(6))
        }

        let localMatches = currentEvents
            .filter { $0.startAt >= .now && $0.matchesSearch(homeEventSearchQuery) }
            .sorted(by: { $0.startAt < $1.startAt })

        var seenEventIDs = Set<UUID>()
        return (homeEventSearchViewModel.events + localMatches)
            .filter { seenEventIDs.insert($0.id).inserted }
    }

    private var homeEventSearchRequestKey: String {
        "\(isHomeEventSearchPresented)-\(homeEventSearchQuery)"
    }

    private var currentEvents: [EventFeedItem] {
        currentResponse?.events ?? []
    }

    private var currentUserLocation: EventCity? {
        currentResponse?.currentUserLocation ?? viewModel.currentUserLocation
    }

    private var currentResponse: MobileEventsResponse? {
        viewModel.response(for: selectedWeekStart)
    }

    private var shouldShowWeekLoadingIndicator: Bool {
        currentResponse == nil && viewModel.isLoading(weekStart: selectedWeekStart)
    }

    private var filteredCurrentEvents: [EventFeedItem] {
        filteredCurrentEventsBeforeCategory
            .filter(categoryFilterIncludes)
    }

    private var filteredCurrentEventsBeforeCategory: [EventFeedItem] {
        currentEvents
            .filter(effectiveLocationFilter.includes)
            .filter(selectedEventFilter.includes)
    }

    private var searchUserResults: [FriendUserSummary] {
        searchViewModel.users
    }

    private var emptyStateRecentUsers: [FriendUserSummary] {
        let sourceUsers = searchViewModel.recentUsers.isEmpty
            ? searchViewModel.users
            : searchViewModel.recentUsers
        return Array(sourceUsers.prefix(20))
    }

    private var displayedEventsForPrefetch: [EventFeedItem] {
        if isShowingSearchResults {
            return []
        }

        if isHomeEventSearchPresented {
            return homeEventSearchResults
        }

        return eventsForSelectedWeek
    }

    private var displayedEventPrefetchKey: String {
        displayedEventsForPrefetch
            .map(\.id.uuidString)
            .joined(separator: ",")
    }

    private var availableLocationFilters: [HomeLocationFilter] {
        var cityFilters = (currentResponse?.availableCities ?? []).reduce(into: [HomeLocationFilter]()) { filters, city in
            let filter = HomeLocationFilter.city(city: city.city, state: city.state)

            guard !filters.contains(filter) else {
                return
            }

            filters.append(filter)
        }
        .sorted { lhs, rhs in
            lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
        }

        let bostonFilter = HomeLocationFilter.city(city: "Boston", state: "MA")
        if !cityFilters.contains(bostonFilter) {
            cityFilters.append(bostonFilter)
        }

        return cityFilters
    }

    private var availableCategoryFilters: [HomeCategoryFilter] {
        let counts = filteredCurrentEventsBeforeCategory.reduce(into: [String: Int]()) { counts, event in
            for category in event.categories {
                counts[category, default: 0] += 1
            }
        }

        return counts.keys
            .map { category in
                HomeCategoryFilter(
                    id: category,
                    title: categoryTitle(for: category),
                    count: counts[category] ?? 0
                )
            }
            .sorted { lhs, rhs in
                if lhs.count != rhs.count {
                    return lhs.count > rhs.count
                }

                return lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
            }
    }

    private var effectiveLocationFilter: HomeLocationFilter {
        // Prefer the selection shared across tabs so the most recent city choice on any
        // page (Home / Places / Activity) wins here too — the tabs stay alive, so local
        // state would otherwise keep showing this page's own stale selection.
        if let sharedFilter = appSession.selectedCityContext.flatMap(HomeLocationFilter.init),
           availableLocationFilters.contains(sharedFilter)
        {
            return sharedFilter
        }

        if let selectedLocationFilter,
           availableLocationFilters.contains(selectedLocationFilter)
        {
            return selectedLocationFilter
        }

        return defaultLocationFilter
    }

    private var effectiveCategoryFilterID: String? {
        guard let selectedCategoryFilterID else {
            return nil
        }

        return availableCategoryFilters.contains(where: { $0.id == selectedCategoryFilterID })
            ? selectedCategoryFilterID
            : nil
    }

    private var defaultLocationFilter: HomeLocationFilter {
        let cityFilters = availableLocationFilters

        if let currentUserLocation {
            let userFilter = HomeLocationFilter.city(
                city: currentUserLocation.city,
                state: currentUserLocation.state
            )

            if cityFilters.contains(userFilter) {
                return userFilter
            }
        }

        return cityFilters.first { filter in
            guard case .city(let city, _) = filter else {
                return false
            }

            return city.localizedCaseInsensitiveCompare("Boston") == .orderedSame
        } ?? .city(city: "Boston", state: "MA")
    }

    private var isViewingFutureWeek: Bool {
        selectedWeekStart > currentFeedWeekStart
    }

    private func categoryTitle(for category: String) -> String {
        currentEvents
            .compactMap { $0.categoryLabels[category] }
            .first(where: { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })
            ?? category.capitalized
    }

    private var shouldShowRecentActivity: Bool {
        isAuthenticated &&
            selectedEventFilter == .all &&
            effectiveCategoryFilterID == nil &&
            !isViewingFutureWeek &&
            !recentActivityViewModel.activities.isEmpty
    }

    private var shouldShowLatestFromFollows: Bool {
        isAuthenticated &&
            selectedEventFilter == .all &&
            effectiveCategoryFilterID == nil &&
            isViewingCurrentWeek &&
            !allWhatsNewUpdates.isEmpty
    }

    private var hasFollowedPlaces: Bool {
        currentResponse?.hasFollowedPlaces ?? latestFromPlacesSourceEvents.contains { event in
            event.isFollowed || event.venueIsFollowed || event.organizerIsFollowed
        }
    }

    private var effectiveWhatsNewFilter: HomeWhatsNewFilter {
        selectedWhatsNewFilter ?? (hasFollowedPlaces ? .following : .allPlaces)
    }

    private var latestFromPlacesSourceEvents: [EventFeedItem] {
        // The server's collection applies global place and source visibility.
        // Merging weekly events back in would reintroduce excluded places.
        if let latestFromPlaces = currentResponse?.latestFromPlaces {
            return latestFromPlaces
        }

        // Compatibility with older servers that omit the dedicated collection.
        return latestFromFollowsViewModel.events +
            (currentResponse?.latestFromFollows ?? []) +
            currentEvents
    }

    private var allWhatsNewUpdates: [FollowedEventUpdate] {
        let cutoff = Date.now.addingTimeInterval(-14 * 24 * 60 * 60)
        var seenEventIDs = Set<UUID>()
        let sourceEvents = latestFromPlacesSourceEvents
            .filter { seenEventIDs.insert($0.id).inserted }
        let updates = sourceEvents.compactMap { event -> FollowedEventUpdate? in
            guard event.venueID != nil || event.organizerID != nil,
                  effectiveLocationFilter.includes(event)
            else {
                return nil
            }

            let wasRecentlyCreated = event.createdAt.map { $0 >= cutoff } ?? false
            let wasRecentlyUpdated = event.updatedAt.map { updatedAt in
                let createdAt = event.createdAt ?? .distantPast
                return updatedAt >= cutoff && updatedAt > createdAt
            } ?? false
            let isSeriesOccurrence = event.seriesID != nil
            let qualifiesForLatest = isSeriesOccurrence
                ? wasRecentlyUpdated
                : (wasRecentlyCreated || wasRecentlyUpdated)

            guard qualifiesForLatest else { return nil }

            let kind: FollowedEventUpdate.Kind = isSeriesOccurrence ||
                (wasRecentlyUpdated && !wasRecentlyCreated)
                ? .seriesUpdated
                : .newEvent
            let activityDate = kind == .seriesUpdated
                ? (event.updatedAt ?? event.createdAt ?? .distantPast)
                : (event.createdAt ?? .distantPast)

            return FollowedEventUpdate(event: event, kind: kind, activityDate: activityDate)
        }
        .sorted { lhs, rhs in
            if lhs.activityDate == rhs.activityDate {
                return lhs.event.startAt < rhs.event.startAt
            }

            return lhs.activityDate > rhs.activityDate
        }

        return updates
    }

    private var visibleWhatsNewUpdates: [FollowedEventUpdate] {
        allWhatsNewUpdates.filter { update in
            switch effectiveWhatsNewFilter {
            case .following:
                return update.event.isFollowed ||
                    update.event.venueIsFollowed ||
                    update.event.organizerIsFollowed
            case .allPlaces:
                return true
            }
        }
    }

    private var isShowingSearchResults: Bool {
        isSearchPresented || !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var normalizedSearchQuery: String {
        searchText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var recentSearchDestinationsData: String {
        get {
            AccountSearchHistory.history(
                accountID: clerk.user?.id,
                storedHistories: accountSearchHistoriesData
            )
        }
        nonmutating set {
            accountSearchHistoriesData = AccountSearchHistory.updating(
                accountID: clerk.user?.id,
                history: newValue,
                storedHistories: accountSearchHistoriesData
            )
        }
    }

    private var recentSearchDestinations: [RecentSearchDestination] {
        (try? JSONDecoder().decode(
            [RecentSearchDestination].self,
            from: Data(recentSearchDestinationsData.utf8)
        )) ?? []
    }

    private var filteredRecentSearchDestinations: [RecentSearchDestination] {
        recentSearchDestinations.filter { destination in
            switch (selectedSearchFilter, destination) {
            case (.all, _), (.people, .person), (.places, .place), (.events, .event):
                return true
            default:
                return false
            }
        }
    }

    private var hasResultsForSelectedSearchFilter: Bool {
        switch selectedSearchFilter {
        case .all:
            return !searchUserResults.isEmpty ||
                !searchViewModel.events.isEmpty ||
                !searchViewModel.places.isEmpty
        case .people:
            return !searchUserResults.isEmpty
        case .events:
            return !searchViewModel.events.isEmpty
        case .places:
            return !searchViewModel.places.isEmpty
        }
    }

    private var hasDiscoveryResultsForSelectedSearchFilter: Bool {
        switch selectedSearchFilter {
        case .all:
            return !emptyStateRecentUsers.isEmpty ||
                !searchViewModel.upcomingEvents.isEmpty ||
                !searchViewModel.suggestedPlaces.isEmpty
        case .people:
            return !emptyStateRecentUsers.isEmpty
        case .events:
            return !searchViewModel.upcomingEvents.isEmpty
        case .places:
            return !searchViewModel.suggestedPlaces.isEmpty
        }
    }

    private func rememberSearchDestination(_ destination: RecentSearchDestination) {
        var destinations = recentSearchDestinations.filter { $0.id != destination.id }
        destinations.insert(destination, at: 0)
        destinations = Array(destinations.prefix(4))

        if let data = try? JSONEncoder().encode(destinations),
           let encoded = String(data: data, encoding: .utf8) {
            recentSearchDestinationsData = encoded
        }
    }

    private func rememberSearchResult(_ destination: RecentSearchDestination) {
        guard !normalizedSearchQuery.isEmpty else { return }
        rememberSearchDestination(destination)
    }

    private func moveWeek(by offset: Int) {
        guard let weekStart = Self.weekCalendar.date(byAdding: .day, value: offset * 7, to: selectedWeekStart) else {
            return
        }

        selectedWeekStart = max(weekStart, currentFeedWeekStart)
    }

    private func categoryFilterIncludes(_ event: EventFeedItem) -> Bool {
        guard let effectiveCategoryFilterID else {
            return true
        }

        return event.categories.contains(effectiveCategoryFilterID)
    }

    private func resetToCurrentWeek() {
        selectedWeekStart = currentFeedWeekStart
        selectedLocationFilter = nil
        selectedEventFilter = .all
        selectedCategoryFilterID = nil
    }

    private func loadHome(
        for weekStart: Date,
        using apiClient: APIClient,
        forceRefresh: Bool = false
    ) async {
        async let eventLoad: Void = viewModel.load(
            weekStart: weekStart,
            using: apiClient,
            cacheIdentity: eventFeedCacheIdentity,
            timeZone: feedTimeZone,
            forceRefresh: forceRefresh
        )
        async let reviewPromptLoad: Void = loadPostEventFeedbackPrompt(using: apiClient)
        async let recentActivityLoad: Void = loadRecentActivity(
            using: apiClient,
            forceRefresh: forceRefresh
        )

        // The current events API includes the unbounded What's New collection in
        // the same response as the weekly feed. Wait for that response first so
        // the carousel has its final contents before Home is revealed. Only use
        // the separate wide-range request as compatibility fallback for an older
        // server that omits the all-place `latestFromPlaces` collection.
        await eventLoad
        if currentResponse?.latestFromPlaces == nil {
            await loadLatestFromFollows(
                using: apiClient,
                forceRefresh: forceRefresh
            )
        } else {
            latestFromFollowsViewModel.clear()
        }

        _ = await (reviewPromptLoad, recentActivityLoad)
    }

    private func loadLatestFromFollows(
        using apiClient: APIClient,
        forceRefresh: Bool = false
    ) async {
        guard isAuthenticated else {
            latestFromFollowsViewModel.clear()
            return
        }

        await latestFromFollowsViewModel.load(
            using: apiClient,
            cacheIdentity: eventFeedCacheIdentity,
            forceRefresh: forceRefresh
        )
    }

    private func loadRecentActivity(
        using apiClient: APIClient,
        forceRefresh: Bool = false
    ) async {
        guard isAuthenticated else {
            recentActivityViewModel.clear()
            return
        }

        switch effectiveLocationFilter {
        case .all:
            await recentActivityViewModel.load(
                using: apiClient,
                cacheIdentity: recentActivityCacheIdentity,
                includesAllMetros: true,
                forceRefresh: forceRefresh
            )
        case .city(let city, let state):
            await recentActivityViewModel.load(
                using: apiClient,
                cacheIdentity: recentActivityCacheIdentity,
                metroCity: city,
                metroState: state,
                forceRefresh: forceRefresh
            )
        }
    }

    private func loadPostEventFeedbackPrompt(using apiClient: APIClient) async {
        do {
            let response = try await apiClient.send(APIClient.mobileEventReviewPrompt())
            postEventFeedbackPrompt = response.event.flatMap { event in
                completedPostEventFeedbackIDs.contains(event.id.uuidString) ? nil : event
            }
        } catch {
            postEventFeedbackPrompt = nil
        }
    }

    private var eventFeedCacheIdentity: String {
        appSession.isAuthBypassed ? "bypass" : clerk.user?.id ?? "guest"
    }

    private var recentActivityLocationKey: String {
        switch effectiveLocationFilter {
        case .all:
            return "all"
        case .city(let city, let state):
            return "\(city.lowercased())|\(state.uppercased())"
        }
    }

    private var recentActivityCacheIdentity: String {
        "\(eventFeedCacheIdentity)|\(recentActivityLocationKey)"
    }

    private func loadCompletedPostEventFeedbackIDs() {
        let savedIDs = UserDefaults.standard.stringArray(forKey: "completedPostEventFeedbackIDs") ?? []
        completedPostEventFeedbackIDs = Set(savedIDs)
    }

    private func presentPendingPostEventDetail() {
        guard let pendingPostEventDetail else { return }
        self.pendingPostEventDetail = nil
        appSession.presentEventDetail(pendingPostEventDetail)
    }

    private func postEventFeedbackSheet(for event: MobileEventReviewPrompt) -> some View {
        PostEventFeedbackSheet(
                        event: event,
                        onOpenEvent: {
                            do {
                                pendingPostEventDetail = try await apiClient.send(
                                    APIClient.mobileEventDetail(eventPublicID: event.publicID)
                                )
                            } catch {
                                return
                            }
                            postEventFeedbackEvent = nil
                        },
            onSkip: {
                await skipPostEventFeedback(for: event)
            }
        ) { response, comment in
            await recordPostEventFeedback(response, comment: comment, for: event)
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private func recordPostEventFeedback(
        _ response: PostEventFeedbackResponse,
        comment: String?,
        for event: MobileEventReviewPrompt
    ) async -> Bool {
        if response == .didNotAttend {
            do {
                let endpoint = try APIClient.updateMobileEventRSVP(
                    eventID: event.id,
                    status: .notGoing,
                    notifyFriends: false
                )
                _ = try await apiClient.send(endpoint)
                NotificationCenter.default.post(name: .eventRSVPDidChange, object: nil)
            } catch {
                return false
            }
        } else if let rating = response.rating {
            do {
                let endpoint = try APIClient.createMobileEventReview(
                    eventID: event.id,
                    rating: rating,
                    comment: comment
                )
                let review = try await apiClient.send(endpoint)
                EventReviewCache.store(review)
            } catch {
                return false
            }
        }

        completePostEventFeedback(for: event)
        return true
    }

    private func skipPostEventFeedback(for event: MobileEventReviewPrompt) async -> Bool {
        do {
            try await apiClient.send(APIClient.skipMobileEventReview(eventID: event.id))
        } catch {
            return false
        }

        completePostEventFeedback(for: event)
        return true
    }

    private func completePostEventFeedback(for event: MobileEventReviewPrompt) {
        ConfirmationHaptic.play()
        completedPostEventFeedbackIDs.insert(event.id.uuidString)
        UserDefaults.standard.set(
            Array(completedPostEventFeedbackIDs),
            forKey: "completedPostEventFeedbackIDs"
        )
        postEventFeedbackEvent = nil
        postEventFeedbackPrompt = nil
    }

    private var isAuthenticated: Bool {
        appSession.isAuthBypassed || clerk.user != nil
    }

    private func sortEventsForDayRow(_ lhs: EventFeedItem, _ rhs: EventFeedItem) -> Bool {
        let lhsPriority = dayRowPriority(for: lhs)
        let rhsPriority = dayRowPriority(for: rhs)

        if lhsPriority != rhsPriority {
            return lhsPriority < rhsPriority
        }

        let lhsRSVPCount = lhs.socialRSVPCount
        let rhsRSVPCount = rhs.socialRSVPCount

        if lhsRSVPCount != rhsRSVPCount {
            return lhsRSVPCount > rhsRSVPCount
        }

        if lhs.startAt != rhs.startAt {
            return lhs.startAt < rhs.startAt
        }

        return lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
    }

    private func dayRowPriority(for event: EventFeedItem) -> Int {
        if event.hasCurrentUserSocialRSVP || event.hasFriendSocialRSVP {
            return 0
        }

        if event.isFollowed, event.hasPosterArtwork {
            return 1
        }

        if event.isFollowed {
            return 2
        }

        if event.displayImageURL != nil {
            return 3
        }

        return 4
    }

    private func visibleSectionDay(for event: EventFeedItem) -> Date {
        let eventDateComponents = feedCalendar.dateComponents(
            [.year, .month, .day],
            from: event.startAt
        )

        return Self.weekCalendar.date(from: eventDateComponents)
            ?? Self.weekCalendar.startOfDay(for: event.startAt)
    }

    private func sectionTitle(for day: Date) -> String {
        let now = Date()
        let startOfToday = logicalFeedToday
        let startOfDay = Self.weekCalendar.startOfDay(for: day)
        let feedHour = feedCalendar.component(.hour, from: now)
        let isEarlyMorning = feedHour < 6
        let isEvening = feedHour >= 17

        if !isViewingFutureWeek,
           isEarlyMorning,
           let yesterday = Self.weekCalendar.date(byAdding: .day, value: -1, to: startOfToday),
           Self.weekCalendar.isDate(startOfDay, inSameDayAs: yesterday)
        {
            return "Last Night"
        }

        if Self.weekCalendar.isDate(startOfDay, inSameDayAs: startOfToday) {
            return isEvening ? "Tonight" : "Today"
        }

        return Self.sectionTitleFormatter.string(from: day)
    }

    private func sectionHeader(_ title: String, showsLocation: Bool) -> some View {
        HStack(spacing: 0) {
            Text(title)
                .font(AppTheme.contentHeaderFont)
                .foregroundStyle(.white)

            // Temporarily hidden; retain the city suffix for a future restore.
            // if let location = showsLocation ? headerLocationName : nil {
            //     Text(" in \(location)")
            //         .font(.system(size: 20, weight: .medium))
            //         .foregroundStyle(.white.opacity(0.5))
            // }
        }
    }

    private var headerLocationName: String? {
        switch effectiveLocationFilter {
        case .city(let city, _):
            return city
        case .all:
            return nil
        }
    }

    private var isViewingCurrentWeek: Bool {
        selectedWeekStart == currentFeedWeekStart
    }

    private var feedTimeZone: TimeZone {
        let identifier = currentResponse?.feedTimeZone ?? viewModel.feedTimeZoneIdentifier
        if let timeZone = identifier.flatMap(TimeZone.init(identifier:)) {
            return timeZone
        }

        if let state = currentUserLocation?.state,
           let profileTimeZone = TimeZone.usStateFallback(for: state)
        {
            return profileTimeZone
        }

        return TimeZone(identifier: "America/New_York") ?? .autoupdatingCurrent
    }

    private var feedCalendar: Calendar {
        var calendar = Self.weekCalendar
        calendar.timeZone = feedTimeZone
        return calendar
    }

    private var logicalFeedToday: Date {
        Self.logicalDay(for: .now, timeZone: feedTimeZone)
    }

    private var currentFeedWeekStart: Date {
        logicalStartOfWeek(for: .now, timeZone: feedTimeZone)
    }

    private var logicalDisplayRangeStartDate: Date {
        guard selectedWeekStart == currentFeedWeekStart else {
            return selectedWeekStart
        }

        let feedHour = feedCalendar.component(.hour, from: .now)
        if feedHour < 6,
           let yesterday = Self.weekCalendar.date(byAdding: .day, value: -1, to: logicalFeedToday)
        {
            return yesterday
        }

        return logicalFeedToday
    }

    private var logicalWeekEnd: Date? {
        Self.weekCalendar.date(byAdding: .day, value: 7, to: selectedWeekStart)
    }

    private func logicalStartOfWeek(for date: Date, timeZone: TimeZone) -> Date {
        Self.startOfWeek(for: Self.logicalDay(for: date, timeZone: timeZone))
    }

    private static func logicalDay(for date: Date, timeZone: TimeZone) -> Date {
        var calendar = weekCalendar
        calendar.timeZone = timeZone
        let components = calendar.dateComponents([.year, .month, .day], from: date)
        return weekCalendar.date(from: components) ?? weekCalendar.startOfDay(for: date)
    }

    private static func startOfWeek(for date: Date) -> Date {
        let startOfDay = weekCalendar.startOfDay(for: date)
        let weekday = weekCalendar.component(.weekday, from: startOfDay)
        let daysFromMonday = (weekday - weekCalendar.firstWeekday + 7) % 7

        return weekCalendar.date(byAdding: .day, value: -daysFromMonday, to: startOfDay) ?? startOfDay
    }

    private var feedBackground: some View {
        AppTheme.background
            .ignoresSafeArea()
    }
}

private struct HomeActivationSection: View {
    let tasks: [MobileActivationTask]
    let onFindFriends: () -> Void
    let onExplorePlaces: () -> Void
    let onAddProfilePhoto: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Text("Get Started")
                    .font(AppTheme.contentHeaderFont)
                    .foregroundStyle(.white)
            }
            .padding(.horizontal, 16)

            ScrollView(.horizontal) {
                LazyHStack(spacing: 12) {
                    ForEach(tasks) { task in
                        HomeActivationCard(task: task, action: action(for: task.key))
                            .containerRelativeFrame(.horizontal) { length, _ in
                                tasks.count == 1 ? length : length - 36
                            }
                    }
                }
                .scrollTargetLayout()
            }
            .contentMargins(.horizontal, 16, for: .scrollContent)
            .scrollTargetBehavior(.viewAligned)
            .scrollIndicators(.hidden)
        }
        .animation(.spring(response: 0.4, dampingFraction: 0.86), value: tasks)
    }

    private func action(for key: MobileActivationTask.Key) -> () -> Void {
        switch key {
        case .addFriends: onFindFriends
        case .followPlaces: onExplorePlaces
        case .addProfilePhoto: onAddProfilePhoto
        }
    }
}

private struct HomeActivationCard: View {
    let task: MobileActivationTask
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(.white)
                    Text(subtitle)
                        .font(.system(size: 13))
                        .foregroundStyle(.white.opacity(0.68))
                        .fixedSize(horizontal: false, vertical: true)

                    HStack(spacing: 4) {
                        ForEach(0..<task.target, id: \.self) { index in
                            Capsule()
                                .fill(
                                    index < task.progress
                                        ? AppTheme.accentBlue
                                        : Color.white.opacity(0.2)
                                )
                                .frame(height: 3)
                        }
                    }
                    .frame(width: CGFloat(task.target * 42))
                    .padding(.top, 8)
                }

                Spacer(minLength: 8)

                Image(systemName: "chevron.right")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.white.opacity(0.55))
            }
            .padding(16)
            .frame(maxWidth: .infinity, minHeight: 104, alignment: .leading)
            .contentShape(RoundedRectangle(cornerRadius: 20))
        }
        .buttonStyle(.plain)
        .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 20))
        .overlay {
            RoundedRectangle(cornerRadius: 20)
                .stroke(Color.white.opacity(0.1), lineWidth: 1)
        }
    }

    private var title: String {
        switch task.key {
        case .addFriends: "Add 3 friends"
        case .followPlaces: "Follow 2 places"
        case .addProfilePhoto: "Add a profile photo"
        }
    }

    private var subtitle: String {
        switch task.key {
        case .addFriends: "Add friends to see which events they’re going to."
        case .followPlaces: "Follow your favorite places to see their events first in your feed."
        case .addProfilePhoto: "Make it easier for friends to recognize you."
        }
    }

}

private extension HomeLocationFilter {
    init?(_ context: SelectedCityContext) {
        switch context {
        case .all:
            self = .all
        case .city(let city, let state):
            self = .city(city: city, state: state)
        }
    }

    var selectedCityContext: SelectedCityContext? {
        switch self {
        case .all:
            return .all
        case .city(let city, let state):
            return .city(city: city, state: state)
        }
    }
}

private extension View {
    @ViewBuilder
    func homePagerLiquidGlass<S: InsettableShape>(in shape: S) -> some View {
        if #available(iOS 26.1, *) {
            glassEffect(.regular.interactive(), in: shape)
        } else if #available(iOS 26.0, *) {
            glassEffect(.regular, in: shape)
        } else {
            background(.white.opacity(0.08), in: shape)
                .background(.ultraThinMaterial, in: shape)
        }
    }
}

private struct EventSection: Identifiable {
    let day: Date
    let title: String
    let events: [EventFeedItem]

    var id: Date { day }
}

private struct FollowedEventUpdate: Identifiable {
    enum Kind {
        case newEvent
        case seriesUpdated

        var title: String {
            switch self {
            case .newEvent: "New event"
            case .seriesUpdated: "Series updated"
            }
        }
    }

    let event: EventFeedItem
    let kind: Kind
    let activityDate: Date

    var id: UUID { event.id }
}

private enum HomeWhatsNewFilter: String, CaseIterable, Identifiable {
    case following
    case allPlaces

    var id: String { rawValue }

    var title: String {
        switch self {
        case .following: "Following"
        case .allPlaces: "All Places"
        }
    }
}

private struct WhatsNewSection: View {
    let updates: [FollowedEventUpdate]
    let followsPlaces: Bool
    @Binding var selection: HomeWhatsNewFilter

    @ViewBuilder
    var body: some View {
        if !updates.isEmpty {
            EventCardCarousel(
                events: updates.map(\.event),
                cardWidth: 164,
                verticalSpacing: 10,
                snapsToCards: false,
                showsCounter: false,
                headerTrailing: AnyView(filterMenu)
            ) {
                header
            } card: { event in
                if let update = updates.first(where: { $0.event.id == event.id }) {
                    EventDetailNavigationLink(event: event) {
                        LatestFromFollowsCard(update: update)
                    }
                    .buttonStyle(.plain)
                }
            }
            // Each filter and refresh represents a distinct feed. Recreate the
            // carousel when either changes so it begins with the first card.
            .id(carouselIdentity)
            .accessibilityElement(children: .contain)
            .accessibilityLabel("What’s New")
        } else {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .center, spacing: 12) {
                    header
                    Spacer(minLength: 8)
                    filterMenu
                }
                .padding(.horizontal, 16)

                EmptyEventDayPlaceholder(message: emptyStateMessage)
                    .padding(.horizontal, 16)
            }
        }
    }

    private var header: some View {
        Text("What’s New")
            .font(AppTheme.contentHeaderFont)
            .foregroundStyle(.white)
    }

    private var carouselIdentity: [String] {
        [selection.rawValue] + updates.map { update in
            "\(update.id.uuidString):\(update.activityDate.timeIntervalSinceReferenceDate)"
        }
    }

    private var emptyStateMessage: String {
        followsPlaces
            ? "No recent updates from places you follow."
            : "Follow places to see their latest updates here."
    }

    private var filterMenu: some View {
        Menu {
            ForEach(HomeWhatsNewFilter.allCases) { filter in
                Button {
                    var transaction = Transaction(animation: nil)
                    transaction.disablesAnimations = true

                    withTransaction(transaction) {
                        selection = filter
                    }
                } label: {
                    if filter == selection {
                        Label(filter.title, systemImage: "checkmark")
                    } else {
                        Text(filter.title)
                    }
                }
            }
        } label: {
            HStack(spacing: 5) {
                Text(selection.title)
                    .lineLimit(1)

                Image(systemName: "chevron.down")
                    .font(.system(size: 10, weight: .bold))
            }
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(.white.opacity(0.72))
            .contentShape(Rectangle())
        }
        .accessibilityLabel("What’s New places filter")
        .accessibilityValue(selection.title)
    }
}

private struct LatestFromFollowsCard: View {
    let update: FollowedEventUpdate

    @Environment(\.apiClient) private var apiClient
    @State private var refreshedSocialEvent: EventFeedItem?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            RemoteImageView(url: versionedArtworkURL) { image in
                image
                    .resizable()
                    .scaledToFill()
            } placeholder: {
                EventCardArtworkPlaceholder(width: 164, height: 164)
            }
            .frame(width: 164, height: 164)
            .clipped()
            .overlay(alignment: .bottomLeading) {
                EventSocialOverlayView(
                    attendees: goingAttendees,
                    size: .card
                )
                .padding(8)
            }
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(update.event.title)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.leading)
                    .lineLimit(1)
                    .truncationMode(.tail)

                Text(update.event.formattedCardStart)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(AppTheme.accentBlue)
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)

                HStack(spacing: 8) {
                    Text(update.event.primaryLocation)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.white.opacity(0.58))
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)

                    Spacer(minLength: 4)

                    if interestedCount > 0 {
                        HStack(spacing: 3) {
                            Image(systemName: "star.fill")
                                .font(.system(size: 10, weight: .semibold))
                            Text("\(interestedCount)")
                        }
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.yellow)
                        .fixedSize()
                    }
                }
            }
            .padding(.top, 8)
        }
        .frame(width: 164, alignment: .leading)
        .contentShape(Rectangle())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(accessibilityDescription)
        .accessibilityHint("Opens event details")
        .task(id: latestUpdateIdentity) {
            await refreshSocialEvent()
        }
    }

    private var latestUpdateIdentity: String {
        "\(update.event.id.uuidString)-\(update.event.updatedAt?.timeIntervalSince1970 ?? 0)"
    }

    private var versionedArtworkURL: URL? {
        guard let artworkURL = socialEvent.displayImageURL,
              let updatedAt = socialEvent.updatedAt,
              var components = URLComponents(url: artworkURL, resolvingAgainstBaseURL: false)
        else {
            return socialEvent.displayImageURL
        }

        var queryItems = components.queryItems ?? []
        queryItems.removeAll { $0.name == "wigUpdatedAt" }
        queryItems.append(
            URLQueryItem(name: "wigUpdatedAt", value: String(updatedAt.timeIntervalSince1970))
        )
        components.queryItems = queryItems
        return components.url
    }

    private var goingAttendees: [EventSocialAttendee] {
        socialEvent.socialAttendees
            .filter { $0.status == .going }
            .sorted { lhs, rhs in
                let lhsIsCurrentUser = socialEvent.friendsGoing.first {
                    $0.user.id == lhs.id
                }?.user.isCurrentUser ?? false
                let rhsIsCurrentUser = socialEvent.friendsGoing.first {
                    $0.user.id == rhs.id
                }?.user.isCurrentUser ?? false
                return lhsIsCurrentUser && !rhsIsCurrentUser
            }
    }

    private var interestedCount: Int {
        socialEvent.friendsInterested.filter {
            $0.user.isCurrentUser || $0.user.isFriend
        }.count
    }

    private var accessibilityDescription: String {
        let eventDescription = "\(update.kind.title), \(update.event.title), \(update.event.formattedCardStart), \(update.event.primaryLocation)"
        guard interestedCount > 0 else { return eventDescription }

        return "\(eventDescription), \(interestedCount) \(interestedCount == 1 ? "person" : "people") interested"
    }

    private var socialEvent: EventFeedItem {
        refreshedSocialEvent ?? update.event
    }

    @MainActor
    private func refreshSocialEvent() async {
        refreshedSocialEvent = nil

        do {
            let event = try await apiClient.send(
                APIClient.mobileEventDetail(eventPublicID: update.event.publicID)
            )
            guard !Task.isCancelled else { return }
            refreshedSocialEvent = event
        } catch is CancellationError {
            return
        } catch {
            // Keep the feed payload as the fallback if the detail refresh fails.
        }
    }
}

private struct HomeEventDaySection<Header: View>: View {
    let section: EventSection
    let eventCardWidth: CGFloat
    private let header: Header

    init(
        section: EventSection,
        eventCardWidth: CGFloat,
        @ViewBuilder header: () -> Header
    ) {
        self.section = section
        self.eventCardWidth = eventCardWidth
        self.header = header()
    }

    @ViewBuilder
    var body: some View {
        if section.events.isEmpty {
            VStack(alignment: .leading, spacing: 10) {
                header
                    .padding(.horizontal, 16)

                EmptyEventDayPlaceholder()
                    .padding(.horizontal, 16)
            }
        } else {
            EventCardCarousel(
                events: section.events,
                cardWidth: eventCardWidth,
                verticalSpacing: 10
            ) {
                header
            } card: { event in
                EventDetailNavigationLink(event: event) {
                    EventCardView(event: event)
                }
            }
        }
    }
}

enum PostEventFeedbackResponse: CaseIterable, Identifiable {
    case lovedIt
    case likedIt
    case okay
    case didNotLikeIt
    case didNotAttend

    var id: Self { self }

    var title: String {
        switch self {
        case .lovedIt:
            return "Loved it"
        case .likedIt:
            return "Liked it"
        case .okay:
            return "It was okay"
        case .didNotLikeIt:
            return "Didn't like it"
        case .didNotAttend:
            return "Didn't end up going"
        }
    }

    var emoji: String {
        switch self {
        case .lovedIt:
            return "😍"
        case .likedIt:
            return "🙂"
        case .okay:
            return "😐"
        case .didNotLikeIt:
            return "😞"
        case .didNotAttend:
            return "🫥"
        }
    }

    var isAttendanceChange: Bool {
        self == .didNotAttend
    }

    var rating: EventReviewRating? {
        switch self {
        case .lovedIt:
            return .lovedIt
        case .likedIt:
            return .likedIt
        case .okay:
            return .okay
        case .didNotLikeIt:
            return .didNotLikeIt
        case .didNotAttend:
            return nil
        }
    }
}

private struct PostEventFeedbackBanner: View {
    let event: MobileEventReviewPrompt
    let action: () -> Void
    @State private var artwork: UIImage?

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Group {
                    if let artwork {
                        Image(uiImage: artwork)
                            .resizable()
                            .scaledToFill()
                    } else {
                    ZStack {
                        Color.white.opacity(0.12)
                        Image(systemName: "calendar")
                            .foregroundStyle(.white.opacity(0.72))
                    }
                    }
                }
                .frame(width: 48, height: 48)
                .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .strokeBorder(.white.opacity(0.14), lineWidth: 1)
                }
                .shadow(color: .black.opacity(0.28), radius: 8, x: 0, y: 4)

                Text("How was \(event.title)?")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.white)
                    .lineLimit(2)
                    .minimumScaleFactor(0.88)
                    .multilineTextAlignment(.leading)

                Spacer(minLength: 0)

                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.white.opacity(0.60))
                    .padding(.trailing, 14)
            }
            .padding(7)
            .frame(height: 62)
            .background(
                Color.white.opacity(0.08),
                in: RoundedRectangle(cornerRadius: 14, style: .continuous)
            )
            .overlay {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
            }
            .contentShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityLabel("How was \(event.title)?")
        .task(id: event.coverImageURL) {
            guard let coverImageURL = event.coverImageURL else {
                artwork = nil
                return
            }

            guard let image = await RemoteImagePipeline.shared.image(for: coverImageURL) else {
                return
            }

            artwork = image
        }
    }
}

struct PostEventFeedbackSheet: View {
    let event: MobileEventReviewPrompt
    let onResponse: (PostEventFeedbackResponse, String?) async -> Bool
    let onOpenEvent: (() async -> Void)?
    let onSkip: (() async -> Bool)?

    @Environment(\.dismiss) private var dismiss
    @State private var isSubmitting = false
    @State private var comment: String
    @State private var selectedResponse: PostEventFeedbackResponse?
    @State private var isConfirmingDidNotAttend = false
    @State private var isConfirmingSkip = false
    @State private var submissionError: String?

    init(
        event: MobileEventReviewPrompt,
        initialResponse: PostEventFeedbackResponse? = nil,
        initialComment: String? = nil,
        onOpenEvent: (() async -> Void)? = nil,
        onSkip: (() async -> Bool)? = nil,
        onResponse: @escaping (PostEventFeedbackResponse, String?) async -> Bool
    ) {
        self.event = event
        self.onResponse = onResponse
        self.onOpenEvent = onOpenEvent
        self.onSkip = onSkip
        _comment = State(initialValue: initialComment ?? "")
        _selectedResponse = State(initialValue: initialResponse)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                eventHeader
                // Keep the title and metadata clear of the close control.
                .padding(.trailing, 58)
                .padding(.bottom, -4)

                HStack(alignment: .top, spacing: 8) {
                    ForEach(PostEventFeedbackResponse.allCases.filter { !$0.isAttendanceChange }) { response in
                        reactionButton(response)
                    }
                }

                VStack(alignment: .trailing, spacing: 6) {
                    TextField("Add a comment (optional)", text: $comment, axis: .vertical)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(.white)
                        .lineLimit(2 ... 3)
                        .tint(AppTheme.accentBlue)
                        .onChange(of: comment) { _, value in
                            if value.count > 250 {
                                comment = String(value.prefix(250))
                            }
                        }

                    Text("\(comment.count)/250")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.white.opacity(0.42))
                }
                .padding(12)
                .background(.white.opacity(0.055), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(.white.opacity(0.10), lineWidth: 1)
                }

                Button {
                    if let selectedResponse {
                        submit(selectedResponse)
                    }
                } label: {
                    Text("Done")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(selectedResponse == nil ? .white.opacity(0.45) : .black.opacity(0.86))
                        .frame(maxWidth: .infinity, minHeight: 58)
                        .background(
                            selectedResponse == nil ? Color.white.opacity(0.10) : AppTheme.accentBlue,
                            in: RoundedRectangle(cornerRadius: 18, style: .continuous)
                        )
                }
                .buttonStyle(.plain)
                .disabled(selectedResponse == nil || isSubmitting)
                .padding(.vertical, -8)

                HStack(spacing: 0) {
                    Button {
                        isConfirmingDidNotAttend = true
                    } label: {
                        Text(PostEventFeedbackResponse.didNotAttend.title)
                            .frame(maxWidth: .infinity)
                    }

                    if onSkip != nil {
                        Button {
                            isConfirmingSkip = true
                        } label: {
                            Text("Skip review")
                                .frame(maxWidth: .infinity)
                        }
                        .accessibilityHint("You can add a review later from this event")
                    }
                }
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white.opacity(0.62))
                .buttonStyle(.plain)
                .disabled(isSubmitting)
            }
            .padding(20)
            .padding(.top, 8)
            .overlay(alignment: .topTrailing) {
                Button(action: dismiss.callAsFunction) {
                    Image(systemName: "xmark")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.80))
                        .frame(width: 42, height: 42)
                        .background(.white.opacity(0.08), in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close")
                .padding(.top, 20)
                .padding(.trailing, 20)
            }
        }
        .scrollIndicators(.hidden)
        .alert(
            "Didn't end up going?",
            isPresented: $isConfirmingDidNotAttend,
        ) {
            Button("Didn't go", role: .destructive) {
                submit(.didNotAttend)
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("We'll update your RSVP.")
        }
        .alert(
            "Skip review?",
            isPresented: $isConfirmingSkip,
        ) {
            Button("Skip review") {
                skipReview()
            }
            Button("Cancel", role: .cancel) {}
        } message: {
            Text("You can add a review later from this event in your past events.")
        }
        .alert("Couldn't save your feedback", isPresented: Binding(
            get: { submissionError != nil },
            set: { if !$0 { submissionError = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(submissionError ?? "Please try again.")
        }
    }

    private var sheetArtwork: some View {
        RemoteImageView(url: event.coverImageURL) { image in
            image
                .resizable()
                .scaledToFill()
        } placeholder: {
            Color.white.opacity(0.08)
        }
        .frame(width: 88, height: 88)
        .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(.white.opacity(0.12), lineWidth: 1)
        }
    }

    @ViewBuilder
    private var eventHeader: some View {
        if let onOpenEvent {
            Button {
                Task {
                    await onOpenEvent()
                }
            } label: {
                eventHeaderContent
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("View \(event.title)")
        } else {
            eventHeaderContent
        }
    }

    private var eventHeaderContent: some View {
        HStack(alignment: .center, spacing: 14) {
            sheetArtwork

            VStack(alignment: .leading, spacing: 4) {
                Text(event.title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(3)

                VStack(alignment: .leading, spacing: 4) {
                    Text(eventStartDateAndTime)
                        .foregroundStyle(AppTheme.accentBlue)

                    Text(event.venueName ?? "\(event.city), \(event.state)")
                        .foregroundStyle(.white.opacity(0.70))
                }
                .font(.system(size: 14, weight: .medium))
                .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var eventStartDateAndTime: String {
        let date = event.startAt.formatted(date: .abbreviated, time: .omitted)
        let calendar = Calendar.autoupdatingCurrent

        let time: String
        if calendar.component(.minute, from: event.startAt) == 0 {
            time = event.startAt.formatted(
                .dateTime.hour(.defaultDigits(amPM: .abbreviated))
            )
        } else {
            time = event.startAt.formatted(date: .omitted, time: .shortened)
        }

        return "\(date) at \(time)"
    }

    private func reactionButton(_ response: PostEventFeedbackResponse) -> some View {
        Button {
            UISelectionFeedbackGenerator().selectionChanged()
            selectedResponse = response
        } label: {
            VStack(spacing: 9) {
                Text(response.emoji)
                    .font(.system(size: 52))
                    .frame(height: 64)
                    .scaleEffect(selectedResponse == response ? 1.08 : 1.0)
                    .opacity(selectedResponse == nil || selectedResponse == response ? 1 : 0.38)

                Text(response.title)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(selectedResponse == response ? AppTheme.accentBlue : .white.opacity(0.78))
                    .opacity(selectedResponse == nil || selectedResponse == response ? 1 : 0.38)
                    .multilineTextAlignment(.center)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity)
            }
            .frame(maxWidth: .infinity, alignment: .top)
        }
        .buttonStyle(.plain)
        .disabled(isSubmitting)
    }

    private func submit(_ response: PostEventFeedbackResponse) {
        guard !isSubmitting else { return }
        isSubmitting = true

        Task {
            let trimmedComment = comment.trimmingCharacters(in: .whitespacesAndNewlines)
            let didSubmit = await onResponse(response, trimmedComment.isEmpty ? nil : trimmedComment)
            if !didSubmit {
                submissionError = "Your feedback wasn't saved. Please try again."
            }
            isSubmitting = false
        }
    }

    private func skipReview() {
        guard !isSubmitting, let onSkip else { return }
        isSubmitting = true

        Task {
            let didSkip = await onSkip()
            if !didSkip {
                submissionError = "Your review wasn't skipped. Please try again."
            }
            isSubmitting = false
        }
    }
}

private enum HomeLocationFilter: Hashable, Identifiable {
    case all
    case city(city: String, state: String)

    var id: String {
        switch self {
        case .all:
            return "all"
        case .city(let city, let state):
            return "\(city)|\(state)"
        }
    }

    var title: String {
        switch self {
        case .all:
            return "All Cities"
        case .city(let city, _):
            return city
        }
    }

    func includes(_ event: EventFeedItem) -> Bool {
        switch self {
        case .all:
            return true
        case .city(let city, let state):
            let eventCity = event.metroAreaCity ?? event.city
            let eventState = event.metroAreaState ?? event.state

            return eventCity.localizedCaseInsensitiveCompare(city) == .orderedSame &&
                eventState.localizedCaseInsensitiveCompare(state) == .orderedSame
        }
    }

    func includes(_ event: ActivityEventSummary) -> Bool {
        switch self {
        case .all:
            return true
        case .city(let city, let state):
            let eventCity = event.metroAreaCity ?? event.city
            let eventState = event.metroAreaState ?? event.state

            return eventCity.localizedCaseInsensitiveCompare(city) == .orderedSame &&
                eventState.localizedCaseInsensitiveCompare(state) == .orderedSame
        }
    }
}

private enum HomeEventFilter: String, CaseIterable, Identifiable {
    case all
    case following
    case friends

    var id: String { rawValue }

    var menuTitle: String {
        switch self {
        case .all:
            return "All Events"
        case .following:
            return "Following"
        case .friends:
            return "Friends"
        }
    }

    func includes(_ event: EventFeedItem) -> Bool {
        switch self {
        case .all:
            return true
        case .following:
            return event.isFollowed
        case .friends:
            return event.hasFriendSocialRSVP
        }
    }
}

private struct HomeCategoryFilter: Identifiable, Hashable {
    let id: String
    let title: String
    let count: Int
}

private struct HomeLeadingControls: View {
    @Binding var selectedEventFilter: HomeEventFilter
    let categories: [HomeCategoryFilter]
    let selectedCategoryID: String?
    let onSelectCategory: (String?) -> Void
    let onSearch: () -> Void

    var body: some View {
        HStack(spacing: 0) {
            HomeFiltersMenuButton(
                selectedEventFilter: $selectedEventFilter,
                categories: categories,
                selectedCategoryID: selectedCategoryID,
                onSelectCategory: onSelectCategory,
                useCombinedStyle: true
            )

            Button(action: onSearch) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.primary)
                    .frame(width: 46, height: 46)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
        }
        .frame(height: 46)
        .clipShape(Capsule())
        .homePagerLiquidGlass(in: Capsule())
        .shadow(color: .black.opacity(0.12), radius: 14, x: 0, y: 8)
    }
}

private struct HomeFiltersMenuButton: View {
    @Binding var selectedEventFilter: HomeEventFilter
    let categories: [HomeCategoryFilter]
    let selectedCategoryID: String?
    let onSelectCategory: (String?) -> Void
    var useCombinedStyle = false

    private var hasActiveFilters: Bool {
        selectedEventFilter != .all || selectedCategoryID != nil
    }

    var body: some View {
        Menu {
            Section("Events") {
                ForEach(HomeEventFilter.allCases) { filter in
                    Button {
                        selectedEventFilter = filter
                    } label: {
                        if filter == selectedEventFilter {
                            Label(filter.menuTitle, systemImage: "checkmark")
                        } else {
                            Text(filter.menuTitle)
                        }
                    }
                }
            }

            if !categories.isEmpty {
                Section("Categories") {
                    Button {
                        onSelectCategory(nil)
                    } label: {
                        if selectedCategoryID == nil {
                            Label("All Categories", systemImage: "checkmark")
                        } else {
                            Text("All Categories")
                        }
                    }

                    ForEach(categories) { category in
                        Button {
                            onSelectCategory(selectedCategoryID == category.id ? nil : category.id)
                        } label: {
                            if selectedCategoryID == category.id {
                                Label(category.title, systemImage: "checkmark")
                            } else {
                                Text(category.title)
                            }
                        }
                    }
                }
            }
        } label: {
            Image(systemName: "line.3.horizontal.decrease")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(hasActiveFilters ? AppTheme.accentBlue : .primary)
                .frame(width: 46, height: 46)
                .contentShape(Rectangle())
                .modifier(HomeStandaloneControlStyle(isStandalone: !useCombinedStyle))
        }
        .buttonStyle(.plain)
    }
}

private struct HomeStandaloneControlStyle: ViewModifier {
    let isStandalone: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if isStandalone {
            content.homeLiquidGlass(in: Circle())
        } else {
            content
        }
    }
}

private struct HomeRecentActivitySection: View {
    let activities: [ActivityFeedItem]
    let onShowActivity: () -> Void
    let onRespondToRequest: (ActivityFeedItem, ActivityRequestResponse) async -> Void
    @EnvironmentObject private var requestStore: ActivityRequestStore

    private var visibleActivities: [ActivityFeedItem] {
        activities.filter { activity in
            guard activity.type.isRequest else { return true }
            return requestStore.response(for: activity.id) == nil
        }
    }

    var body: some View {
        let visible = visibleActivities
        if !visible.isEmpty {
            VStack(alignment: .leading, spacing: 7) {
                Button(action: onShowActivity) {
                    HStack(spacing: 6) {
                        Text("Recent Activity")
                            .font(AppTheme.contentHeaderFont)
                            .foregroundStyle(.white)

                        Image(systemName: "chevron.right")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(.white.opacity(0.52))
                    }
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 16)

                VStack(alignment: .leading, spacing: 12) {
                    ForEach(visible) { activity in
                        HomeRecentActivityRow(
                            activity: activity,
                            onRespondToRequest: onRespondToRequest
                        )
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 5)
            }
        }
    }
}

private struct HomeRecentActivityRow: View {
    let activity: ActivityFeedItem
    let onRespondToRequest: (ActivityFeedItem, ActivityRequestResponse) async -> Void
    @EnvironmentObject private var appSession: AppSession
    @EnvironmentObject private var requestStore: ActivityRequestStore
    @State private var selectedVenue: PlaceListItem?
    @State private var selectedUserProfile: RecentActivitySelectedUserProfile?
    @State private var isRequestsPagePresented = false

    private static let relativeFormatter: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        return formatter
    }()

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ActivityAvatarView(activity: activity)

            if activity.type.isRequest {
                requestContent
                    .offset(y: -2)
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    InlineLinkedActivityText(
                        activity: activity,
                        onTapEvent: {
                            if let event = activity.event?.eventFeedItem {
                                appSession.presentEventDetail(event)
                            }
                        },
                        onTapVenue: { venue in
                            selectedVenue = venue
                        },
                        onTapUser: { userID in
                            selectedUserProfile = RecentActivitySelectedUserProfile(id: userID)
                        }
                    )
                    .frame(maxWidth: .infinity, alignment: .leading)

                    Text(
                        Self.relativeFormatter
                            .localizedString(for: activity.timestamp, relativeTo: .now)
                            .capitalizingRelativeAgo()
                    )
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.white.opacity(0.42))
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .offset(y: -2)
            }
        }
        .navigationDestination(item: $selectedVenue) { venue in
            PlaceDetailView(place: venue)
        }
        .navigationDestination(item: $selectedUserProfile) { selection in
            UserProfileView(userID: selection.id)
        }
        .navigationDestination(isPresented: $isRequestsPagePresented) {
            RequestsPageView()
        }
    }

    private var requestContent: some View {
        HStack(alignment: .center, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                (
                    Text(activity.actorName)
                        .fontWeight(.medium)
                        .foregroundColor(.white)
                    +
                    Text(
                        activity.type == .partnerRequestReceived
                            ? " sent you a partner request."
                            : " sent you a friend request."
                    )
                    .foregroundColor(.white.opacity(0.62))
                )
                .font(.system(size: 14))
                .lineSpacing(3)

                Text(
                    Self.relativeFormatter
                        .localizedString(for: activity.timestamp, relativeTo: .now)
                        .capitalizingRelativeAgo()
                )
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.white.opacity(0.42))
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Button {
                isRequestsPagePresented = true
            } label: {
                Image(systemName: "chevron.right")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.white.opacity(0.66))
                    .frame(width: 32, height: 32)
            }
            .buttonStyle(.plain)
        }
        .contentShape(Rectangle())
        .onTapGesture {
            isRequestsPagePresented = true
        }
    }
}

private struct RecentActivitySelectedUserProfile: Identifiable, Hashable {
    let id: String
}

private enum RecentSearchDestination: Codable, Identifiable {
    case person(FriendUserSummary)
    case place(PlaceListItem)
    case event(EventFeedItem)

    var id: String {
        switch self {
        case .person(let user):
            return "person:\(user.id)"
        case .place(let place):
            return "place:\(place.listRowID)"
        case .event(let event):
            return "event:\(event.id.uuidString)"
        }
    }
}

private struct SearchSectionHeader: View {
    let title: String

    var body: some View {
        Text(title)
            .font(.system(size: 20, weight: .bold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct SearchUserRow: View {
    let user: FriendUserSummary

    var body: some View {
        CompactUserListRowView(
            imageURL: user.avatarImageURL,
            name: user.name,
            subtitle: subtitleText,
            identityKey: user.id
        )
    }

    private var subtitleText: String {
        user.friendStatus == .accepted
            ? "\(user.usernameText) • Friends"
            : user.usernameText
    }
}

private struct SearchEventRow: View {
    let event: EventFeedItem

    @Environment(Clerk.self) private var clerk
    @Environment(\.apiClient) private var apiClient

    var body: some View {
        HStack(spacing: 12) {
            RemoteImageView(url: event.posterImageURL) { image in
                image
                    .resizable()
                    .scaledToFill()
            } placeholder: {
                Color.white.opacity(0.08)
                    .overlay {
                        Image(systemName: "calendar")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.64))
                    }
            }
            .frame(width: 42, height: 42)
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .strokeBorder(.white.opacity(0.14), lineWidth: 1)
            }
            .overlay(alignment: .topTrailing) {
                EventSocialOverlayView(
                    attendees: goingAttendees,
                    size: .recentSearchRow
                )
                .padding(2)
            }

            VStack(alignment: .leading, spacing: 3) {
                Text(event.title)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.white)
                    .lineLimit(1)

                HStack(spacing: 5) {
                    Text("\(event.primaryLocation) • \(event.formattedCardStart)")
                        .font(.system(size: 10, weight: .medium))
                        .foregroundStyle(.white.opacity(0.58))
                        .lineLimit(1)

                    Spacer(minLength: 2)

                    if interestedCount > 0 {
                        HStack(spacing: 2) {
                            Image(systemName: "star.fill")
                            Text("\(interestedCount)")
                        }
                        .font(.system(size: 9, weight: .semibold))
                        .foregroundStyle(.yellow)
                        .fixedSize()
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 5)
        .task(id: "\(event.id.uuidString)-\(clerk.user?.id ?? "guest")") {
            guard let userID = clerk.user?.id else { return }
            await EventRSVPPrefetchCache.preload(
                eventID: event.id,
                userID: userID,
                using: apiClient
            )
        }
    }

    private var goingAttendees: [EventSocialAttendee] {
        event.socialAttendees.filter { $0.status == .going }
    }

    private var interestedCount: Int {
        event.friendsInterested.filter {
            $0.user.isCurrentUser || $0.user.isFriend
        }.count
    }
}

private struct SearchUsersList: View {
    let users: [FriendUserSummary]
    var onSelect: (FriendUserSummary) -> Void = { _ in }
    @Environment(\.apiClient) private var apiClient

    var body: some View {
        VStack(spacing: 2) {
            ForEach(users) { user in
                NavigationLink {
                    UserProfileView(userID: user.id)
                } label: {
                    SearchUserRow(user: user)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .simultaneousGesture(
                    TapGesture().onEnded {
                        onSelect(user)
                    }
                )
                .task {
                    await UserProfileViewModel.preload(userID: user.id, using: apiClient)
                }
            }
        }
    }
}

@MainActor
final class HomeRecentActivityViewModel: ObservableObject {
    @Published private(set) var activities: [ActivityFeedItem] = []
    private static var cachedActivities = [String: [ActivityFeedItem]]()
    private static var inFlightLoads = [String: Task<ActivityFeedResponse, Error>]()
    private static var inFlightTokens = [String: UUID]()

    func load(
        using apiClient: APIClient,
        cacheIdentity: String,
        metroCity: String? = nil,
        metroState: String? = nil,
        includesAllMetros: Bool = false,
        forceRefresh: Bool = false
    ) async {
        if !forceRefresh, let cached = Self.cachedActivities[cacheIdentity] {
            activities = cached
            return
        }

        if !forceRefresh, let inFlightLoad = Self.inFlightLoads[cacheIdentity] {
            do {
                let response = try await inFlightLoad.value
                Self.cachedActivities[cacheIdentity] = response.activities
                activities = response.activities
            } catch {
                // The active screen can retry without discarding existing items.
            }
            return
        }

        let token = UUID()
        let loadTask = Task {
            try await apiClient.send(
                APIClient.mobileHomeActivity(
                    limit: 3,
                    metroCity: metroCity,
                    metroState: metroState,
                    includesAllMetros: includesAllMetros
                )
            )
        }
        Self.inFlightLoads[cacheIdentity] = loadTask
        Self.inFlightTokens[cacheIdentity] = token

        do {
            let response = try await loadTask.value
            Self.cachedActivities[cacheIdentity] = response.activities
            activities = response.activities
        } catch {
            // Keep any existing items visible during refresh failures.
        }

        if Self.inFlightTokens[cacheIdentity] == token {
            Self.inFlightLoads[cacheIdentity] = nil
            Self.inFlightTokens[cacheIdentity] = nil
        }
    }

    static func preload(using apiClient: APIClient, cacheIdentity: String) async {
        let viewModel = HomeRecentActivityViewModel()
        await viewModel.load(using: apiClient, cacheIdentity: cacheIdentity)
    }

    func clear() {
        activities = []
    }
}

@MainActor
final class HomeSearchDirectoryViewModel: ObservableObject {
    enum Phase {
        case idle
        case loading
        case loaded
    }

    @Published private(set) var users: [FriendUserSummary] = []
    @Published private(set) var recentUsers: [FriendUserSummary] = []
    @Published private(set) var places: [PlaceListItem] = []
    @Published private(set) var suggestedPlaces: [PlaceListItem] = []
    @Published private(set) var events: [EventFeedItem] = []
    @Published private(set) var upcomingEvents: [EventFeedItem] = []
    @Published private(set) var phase: Phase = .idle
    private static var cachedResponse: MobileSearchResponse?
    private static var inFlightLoad: Task<MobileSearchResponse, Error>?
    private var activeQuery = ""

    var isLoading: Bool {
        phase == .loading
    }

    var hasLoadedResults: Bool {
        if case .loaded = phase {
            return true
        }

        return false
    }

    var hasAnyResults: Bool {
        !users.isEmpty || !events.isEmpty || !places.isEmpty
    }

    private func apply(_ response: MobileSearchResponse) {
        users = response.users
        recentUsers = response.recentUsers
        places = response.places
        suggestedPlaces = response.suggestedPlaces
        events = response.events
        upcomingEvents = response.upcomingEvents
    }

    func prepare(query: String) {
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        activeQuery = normalizedQuery

        if normalizedQuery.isEmpty {
            if let cachedResponse = Self.cachedResponse {
                apply(cachedResponse)
                phase = .loaded
            } else {
                phase = .loading
            }
        } else {
            phase = .loading
        }
    }

    func load(
        query: String,
        using apiClient: APIClient,
        forceRefresh: Bool = false
    ) async {
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)

        activeQuery = normalizedQuery
        phase = .loading

        do {
            let response: MobileSearchResponse

            if !forceRefresh, normalizedQuery.isEmpty, let cachedResponse = Self.cachedResponse {
                response = cachedResponse
            } else if !forceRefresh, normalizedQuery.isEmpty, let inFlightLoad = Self.inFlightLoad {
                response = try await inFlightLoad.value
            } else {
                let loadTask = Task {
                    try await apiClient.send(
                        APIClient.mobileSearch(query: normalizedQuery)
                    )
                }

                if normalizedQuery.isEmpty {
                    Self.inFlightLoad = loadTask
                }

                response = try await loadTask.value
            }

            var resolvedResponse = response
            if normalizedQuery.isEmpty,
               response.recentUsers.count < 20,
               let friendsResponse = try? await apiClient.send(APIClient.mobileFriends()) {
                resolvedResponse = fillingRecentUsers(
                    in: response,
                    with: friendsResponse.friends
                )
            }

            guard activeQuery == normalizedQuery else {
                return
            }

            if normalizedQuery.isEmpty {
                Self.cachedResponse = resolvedResponse
            }

            apply(resolvedResponse)
            if !normalizedQuery.isEmpty {
                let resultCount = resolvedResponse.events.count
                    + resolvedResponse.users.count
                    + resolvedResponse.places.count
                AppAnalytics.log(.search, [
                    "search_type": "all",
                    "query_length": normalizedQuery.count,
                    "source_screen": "search",
                ])
                AppAnalytics.log(.viewSearchResults, [
                    "search_type": "all",
                    "result_count_bucket": AppAnalytics.resultCountBucket(resultCount),
                ])
            }
        } catch {
            guard activeQuery == normalizedQuery else {
                return
            }

            users = []
            recentUsers = []
            places = []
            suggestedPlaces = []
            events = []
            upcomingEvents = []
        }

        if normalizedQuery.isEmpty {
            Self.inFlightLoad = nil
        }

        if activeQuery == normalizedQuery {
            phase = .loaded
        }
    }

    private func fillingRecentUsers(
        in response: MobileSearchResponse,
        with friends: [FriendUserSummary]
    ) -> MobileSearchResponse {
        var combinedUsers = response.recentUsers
        var seenUserIDs = Set(combinedUsers.map(\.id))

        for friend in friends where combinedUsers.count < 20 {
            guard seenUserIDs.insert(friend.id).inserted else {
                continue
            }

            combinedUsers.append(
                FriendUserSummary(
                    id: friend.id,
                    friendshipID: friend.friendshipID,
                    name: friend.name,
                    username: friend.username,
                    avatarImageURL: friend.avatarImageURL,
                    city: friend.city,
                    state: friend.state,
                    friendStatus: .accepted
                )
            )
        }

        return MobileSearchResponse(
            events: response.events,
            upcomingEvents: response.upcomingEvents,
            users: response.users,
            recentUsers: Array(combinedUsers.prefix(20)),
            suggestedPlaces: response.suggestedPlaces,
            places: response.places
        )
    }

    static func preload(using apiClient: APIClient) async {
        if cachedResponse != nil {
            return
        }

        if let inFlightLoad {
            _ = try? await inFlightLoad.value
            return
        }

        let loadTask = Task {
            try await apiClient.send(APIClient.mobileSearch(query: ""))
        }
        inFlightLoad = loadTask

        do {
            cachedResponse = try await loadTask.value
        } catch {
            // Ignore preload failures; the search screen can still load normally later.
        }

        inFlightLoad = nil
    }

    static func invalidateCache() {
        cachedResponse = nil
        inFlightLoad?.cancel()
        inFlightLoad = nil
    }

    func updateFriendStatus(for userID: String, status: FriendUserSummary.FriendStatus) {
        users = Self.updatingFriendStatus(in: users, for: userID, status: status)
        recentUsers = Self.updatingFriendStatus(in: recentUsers, for: userID, status: status)
        Self.updateCachedFriendStatus(for: userID, status: status)
    }

    static func updateCachedFriendStatus(
        for userID: String,
        status: FriendUserSummary.FriendStatus
    ) {

        guard let cachedResponse = Self.cachedResponse else {
            return
        }

        Self.cachedResponse = MobileSearchResponse(
            events: cachedResponse.events,
            upcomingEvents: cachedResponse.upcomingEvents,
            users: updatingFriendStatus(in: cachedResponse.users, for: userID, status: status),
            recentUsers: updatingFriendStatus(in: cachedResponse.recentUsers, for: userID, status: status),
            suggestedPlaces: cachedResponse.suggestedPlaces,
            places: cachedResponse.places
        )
    }

    private static func updatingFriendStatus(
        in source: [FriendUserSummary],
        for userID: String,
        status: FriendUserSummary.FriendStatus
    ) -> [FriendUserSummary] {
        source.map { user in
            guard user.id == userID else {
                return user
            }

            return FriendUserSummary(
                id: user.id,
                friendshipID: user.friendshipID,
                name: user.name,
                username: user.username,
                avatarImageURL: user.avatarImageURL,
                city: user.city,
                state: user.state,
                friendStatus: status
            )
        }
    }
}

private extension EventFeedItem {
    var hasCurrentUserSocialRSVP: Bool {
        if userRsvpStatus == .going || userRsvpStatus == .interested {
            return true
        }

        return (friendsGoing + friendsInterested).contains { rsvp in
            rsvp.user.isCurrentUser
        }
    }

    var hasFriendSocialRSVP: Bool {
        (friendsGoing + friendsInterested).contains { rsvp in
            rsvp.user.isFriend
        }
    }

    var socialRSVPCount: Int {
        friendsGoing.count + friendsInterested.count
    }

    func matchesSearch(_ query: String) -> Bool {
        let normalizedQuery = query.wigSearchNormalized

        return [
            title,
            venueName,
            organizerName,
            city,
            state,
            primaryCategoryLabel,
        ]
        .compactMap { $0 }
        .contains { value in
            value.wigSearchNormalized.matchesSearchQuery(normalizedQuery)
        }
    }
}

private extension String {
    var wigSearchNormalized: String {
        folding(options: [.diacriticInsensitive, .caseInsensitive], locale: .current)
            .lowercased()
            .replacingOccurrences(of: "&", with: " and ")
            .replacingOccurrences(
                of: #"[^a-z0-9]+"#,
                with: " ",
                options: .regularExpression
            )
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    // Lets partial input such as "Above a" match "Above & Beyond" after
    // ampersands normalize to the token "and".
    func matchesSearchQuery(_ normalizedQuery: String) -> Bool {
        guard !normalizedQuery.isEmpty else {
            return true
        }

        if contains(normalizedQuery) {
            return true
        }

        let queryTokens = normalizedQuery.split(separator: " ")
        let valueTokens = split(separator: " ")
        var valueIndex = valueTokens.startIndex

        for queryToken in queryTokens {
            guard let matchIndex = valueTokens[valueIndex...].firstIndex(where: {
                $0.hasPrefix(String(queryToken))
            }) else {
                return false
            }

            valueIndex = valueTokens.index(after: matchIndex)
        }

        return true
    }
}

private struct EmptyEventDayPlaceholder: View {
    let message: String

    init(message: String = "No events scheduled") {
        self.message = message
    }

    var body: some View {
        RoundedRectangle(cornerRadius: 20, style: .continuous)
            .fill(Color.clear)
            .frame(maxWidth: .infinity)
            .frame(height: 140)
            .overlay {
                Text(message)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.white.opacity(0.58))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }
            .overlay {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .strokeBorder(
                        style: StrokeStyle(
                            lineWidth: 1,
                            dash: [5, 5]
                        )
                    )
                    .foregroundStyle(.white.opacity(0.10))
            }
            .background(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(Color.white.opacity(0.015))
            )
    }
}

#Preview {
    HomeView()
}

private extension View {
    @ViewBuilder
    func homeLiquidGlass<S: InsettableShape>(in shape: S) -> some View {
        if #available(iOS 26.1, *) {
            glassEffect(.regular.interactive(), in: shape)
        } else if #available(iOS 26.0, *) {
            glassEffect(.regular, in: shape)
        } else {
            background(.black.opacity(0.20), in: shape)
                .background(.ultraThinMaterial, in: shape)
                .overlay(
                    shape.strokeBorder(.white.opacity(0.18), lineWidth: 1)
                )
                .shadow(color: .black.opacity(0.22), radius: 16, x: 0, y: 8)
        }
    }

    @ViewBuilder
    func nativeSearch(
        isEnabled: Bool,
        text: Binding<String>,
        isPresented: Binding<Bool>
    ) -> some View {
        self
    }
}
