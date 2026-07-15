import ClerkKit
import SwiftUI
import UIKit

struct HomeView: View {
    let showsNativeSearch: Bool
    let searchesUsersOnly: Bool
    let resetToCurrentWeekTrigger: Int
    let onShowActivity: () -> Void
    let onSearchDismiss: () -> Void

    @Environment(Clerk.self) private var clerk
    @Environment(\.apiClient) private var apiClient
    @Environment(\.scenePhase) private var scenePhase
    @EnvironmentObject private var appSession: AppSession
    @StateObject private var viewModel = EventFeedViewModel()
    @StateObject private var recentActivityViewModel = HomeRecentActivityViewModel()
    @StateObject private var searchViewModel = HomeSearchDirectoryViewModel()
    @StateObject private var homeEventSearchViewModel = HomeSearchDirectoryViewModel()
    @State private var selectedWeekStart = Self.startOfWeek(for: .now)
    @State private var isSearchPresented = false
    @State private var searchText = ""
    @State private var homeEventSearchText = ""
    @State private var isHomeEventSearchPresented = false
    @State private var selectedSearchFilter: SearchFilter = .all
    @FocusState private var isSearchFieldFocused: Bool
    @FocusState private var isHomeEventSearchFocused: Bool
    @State private var isSearchKeyboardDismissEnabled = false
    @State private var selectedLocationFilter: HomeLocationFilter?
    @State private var selectedEventFilter: HomeEventFilter = .all
    @State private var selectedCategoryFilterID: String?
    @State private var postEventFeedbackEvent: MobileEventReviewPrompt?
    @State private var postEventFeedbackPrompt: MobileEventReviewPrompt?
    @State private var completedPostEventFeedbackIDs = Set<String>()

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
        searchesUsersOnly: Bool = false,
        resetToCurrentWeekTrigger: Int = 0,
        onShowActivity: @escaping () -> Void = {},
        onSearchDismiss: @escaping () -> Void = {}
    ) {
        self.showsNativeSearch = showsNativeSearch
        self.searchesUsersOnly = searchesUsersOnly
        self.resetToCurrentWeekTrigger = resetToCurrentWeekTrigger
        self.onShowActivity = onShowActivity
        self.onSearchDismiss = onSearchDismiss
    }

    var body: some View {
        NavigationStack {
            content
                .background(feedBackground)
                .topStatusBarScrim()
                .toolbar(.hidden, for: .navigationBar)
                .task {
                    loadCompletedPostEventFeedbackIDs()

                    if case .idle = viewModel.state {
                        await loadHome(for: selectedWeekStart, using: apiClient)
                    }
                }
                .onAppear {
                    if showsNativeSearch {
                        isSearchPresented = true
                        isSearchFieldFocused = false
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: .eventRSVPDidChange)) { _ in
                    Task {
                        await loadHome(for: selectedWeekStart, using: apiClient, forceRefresh: true)
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: .mobileEventDidChange)) { _ in
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
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: .appDataDidChange)) { _ in
                    Task {
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
                .onChange(of: selectedWeekStart) { _, weekStart in
                    Task {
                        await loadHome(for: weekStart, using: apiClient)
                    }
                }
                .onChange(of: scenePhase) { _, phase in
                    guard phase == .active else {
                        return
                    }

                    Task {
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
                .onChange(of: selectedLocationFilter) { _, newValue in
                    appSession.selectedCityContext = newValue?.selectedCityContext
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
                    guard showsNativeSearch else {
                        return
                    }

                    await searchViewModel.load(
                        query: normalizedSearchQuery,
                        using: apiClient
                    )
                }
                .task(id: homeEventSearchRequestKey) {
                    guard !showsNativeSearch, isHomeEventSearchPresented else {
                        return
                    }

                    await homeEventSearchViewModel.load(
                        query: homeEventSearchQuery,
                        using: apiClient
                    )
                }
                .onChange(of: searchText) { _, value in
                    guard showsNativeSearch else {
                        return
                    }

                    searchViewModel.prepare(query: value)
                }
                .onChange(of: homeEventSearchText) { _, value in
                    guard !showsNativeSearch, isHomeEventSearchPresented else {
                        return
                    }

                    homeEventSearchViewModel.prepare(query: value)
                }
                .onChange(of: isSearchFieldFocused) { _, isFocused in
                    if isFocused {
                        isSearchKeyboardDismissEnabled = false

                        Task { @MainActor in
                            try? await Task.sleep(for: .milliseconds(350))

                            if isSearchFieldFocused {
                                isSearchKeyboardDismissEnabled = true
                            }
                        }
                    } else {
                        isSearchKeyboardDismissEnabled = false
                    }
                }
                .task(id: displayedEventPrefetchKey) {
                    guard !displayedEventsForPrefetch.isEmpty else {
                        return
                    }

                    await EventArtworkPrefetcher.prefetch(events: displayedEventsForPrefetch)
                }
                .sheet(item: $postEventFeedbackEvent) { event in
                    PostEventFeedbackSheet(
                        event: event,
                        onSkip: {
                            await skipPostEventFeedback(for: event)
                        }
                    ) { response, comment in
                        await recordPostEventFeedback(response, comment: comment, for: event)
                    }
                    .presentationDetents([.medium, .large])
                    .presentationDragIndicator(.visible)
                }
        }
        .nativeSearch(
            isEnabled: showsNativeSearch,
            text: $searchText,
            isPresented: $isSearchPresented
        )
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            if currentResponse != nil || viewModel.isLoading(weekStart: selectedWeekStart) {
                homeContentShell
            } else {
                ProgressView("Loading events...")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .tint(.white)
                    .foregroundStyle(.white)
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

    private var homeContentShell: some View {
        ZStack(alignment: .top) {
            if isShowingSearchResults {
                searchResultsContent
            } else {
                if shouldShowWeekSkeletons {
                    weekSkeletonContent
                        .id("skeleton-\(selectedWeekStart.timeIntervalSinceReferenceDate)")
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
                    .padding(.top, -2)
                    .padding(.bottom, -24)
                }

                if shouldShowRecentActivity {
                    HomeRecentActivitySection(
                        activities: recentActivityViewModel.activities,
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
                                await recentActivityViewModel.load(using: apiClient)
                            } catch {
                                // silently ignore — user can retry via activity tab
                            }
                        }
                    )
                    .padding(.top, 18)
                }

                ForEach(Array(groupedEvents.enumerated()), id: \.element.day) { index, section in
                    VStack(alignment: .leading, spacing: 12) {
                        sectionHeader(
                            section.title,
                            showsLocation: index == 0 && isViewingCurrentWeek
                        )
                            .padding(.horizontal, 16)

                        if section.events.isEmpty {
                            EmptyEventDayPlaceholder()
                                .padding(.horizontal, 16)
                        } else {
                            ScrollView(.horizontal) {
                                LazyHStack(alignment: .top, spacing: 12) {
                                    ForEach(section.events) { event in
                                        EventDetailNavigationLink(event: event) {
                                            EventCardView(event: event)
                                                .frame(width: eventCardWidth)
                                                .contentShape(Rectangle())
                                        }
                                    }
                                }
                                .scrollTargetLayout()
                            }
                            .scrollIndicators(.hidden)
                            .contentMargins(.horizontal, 16, for: .scrollContent)
                            .scrollTargetBehavior(.viewAligned)
                        }
                    }
                    // Match the 82pt top offset used above the first header on the
                    // Places and Activity tabs (64 base + 18) so switching tabs doesn't
                    // shift the header. The recent-activity block above already adds 18.
                    .padding(.top, index == 0 && !shouldShowRecentActivity ? 18 : 0)
                }
            }
            .padding(.top, 64)
            .padding(.bottom, 48)
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
    }

    private var weekSkeletonContent: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                ForEach(Array(skeletonSectionDays.enumerated()), id: \.element) { index, day in
                    EventSkeletonSectionView(
                        title: sectionTitle(for: day),
                        cardWidth: eventCardWidth
                    )
                    .padding(.top, index == 0 ? 16 : 0)
                }
            }
            .padding(.top, 64)
            .padding(.bottom, 48)
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
    }

    @ViewBuilder
    private var searchResultsContent: some View {
        if searchesUsersOnly {
            usersOnlySearchResultsContent
        } else {
            directorySearchResultsContent
        }
    }

    private var usersOnlySearchResultsContent: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                searchInputBar
                    .padding(.horizontal, 16)

                if normalizedSearchQuery.isEmpty {
                    if !emptyStateRecentUsers.isEmpty {
                        SearchSectionHeader(title: "People")
                            .padding(.horizontal, 16)
                            .padding(.top, 24)

                        SearchUsersList(users: emptyStateRecentUsers)
                            .padding(.horizontal, 16)
                    } else if !searchViewModel.isLoading {
                        ContentUnavailableView {
                            Label("Search Users", systemImage: "person.2")
                        } description: {
                            Text("Search by name or username.")
                        }
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 48)
                    }
                } else if searchViewModel.isLoading && searchUserResults.isEmpty {
                    ProgressView("Searching users...")
                        .frame(maxWidth: .infinity)
                        .tint(.white)
                        .foregroundStyle(.white)
                        .padding(.top, 48)
                } else if searchUserResults.isEmpty {
                    ContentUnavailableView {
                        Label("No Users Found", systemImage: "person.2")
                    } description: {
                        Text("Try a different name or username.")
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 48)
                } else {
                    SearchSectionHeader(title: "People")
                        .padding(.horizontal, 16)
                        .padding(.top, 24)

                    SearchUsersList(users: searchUserResults)
                        .padding(.horizontal, 16)
                }

                if searchViewModel.isLoading && normalizedSearchQuery.isEmpty {
                    ProgressView()
                        .tint(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 16)
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.bottom, 48)
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
    }

    private var directorySearchResultsContent: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 12) {
                if showsNativeSearch {
                    searchInputBar
                        .padding(.horizontal, 16)
                }

                if normalizedSearchQuery.isEmpty {
                    VStack(alignment: .leading, spacing: 12) {
                        if !emptyStateRecentUsers.isEmpty {
                            SearchSectionHeader(title: "People")
                                .padding(.horizontal, 16)
                                .padding(.top, 8)

                            SearchUsersList(users: emptyStateRecentUsers)
                                .padding(.horizontal, 16)
                        }

                        if !emptyStateSuggestedPlaces.isEmpty {
                            SearchSectionHeader(title: "Places")
                                .padding(.horizontal, 16)
                                .padding(.top, emptyStateRecentUsers.isEmpty ? 8 : 4)

                            ForEach(emptyStateSuggestedPlaces, id: \.listRowID) { place in
                                NavigationLink {
                                    PlaceDetailView(place: place)
                                } label: {
                                    PlaceRowView(place: place)
                                        .padding(.horizontal, 16)
                                }
                                .buttonStyle(.plain)
                            }
                        }

                        if !emptyStateUpcomingEvents.isEmpty {
                            SearchSectionHeader(title: "Events")
                                .padding(.horizontal, 16)
                                .padding(.top, emptyStateRecentUsers.isEmpty && emptyStateSuggestedPlaces.isEmpty ? 8 : 4)

                            ForEach(emptyStateUpcomingEvents) { event in
                                EventDetailNavigationLink(event: event) {
                                    EventSearchRow(event: event)
                                        .padding(.horizontal, 16)
                                }
                            }
                        }

                        if emptyStateRecentUsers.isEmpty && emptyStateSuggestedPlaces.isEmpty && emptyStateUpcomingEvents.isEmpty && !searchViewModel.isLoading {
                            ContentUnavailableView {
                                Label(
                                    "People, places, events...",
                                    systemImage: "magnifyingglass"
                                )
                            } description: {
                                Text(
                                    isAuthenticated
                                        ? "Search people, places, and events."
                                        : "Search places and events."
                                )
                            }
                            .foregroundStyle(.white)
                            .frame(maxWidth: .infinity)
                            .padding(.top, 48)
                        }

                        if searchViewModel.isLoading {
                            ProgressView()
                                .tint(.white)
                                .frame(maxWidth: .infinity)
                                .padding(.top, 16)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.top, 8)
                } else {
                    if searchViewModel.isLoading && searchUserResults.isEmpty && searchVenueResults.isEmpty && searchEvents.isEmpty {
                        ProgressView("Searching...")
                            .frame(maxWidth: .infinity)
                            .tint(.white)
                            .foregroundStyle(.white)
                            .padding(.top, 48)
                    } else if searchUserResults.isEmpty && searchVenueResults.isEmpty && searchEvents.isEmpty && !searchViewModel.isLoading {
                        ContentUnavailableView {
                            Label("No Results", systemImage: "magnifyingglass")
                        } description: {
                            Text("Try a different person, place, or event.")
                        }
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 48)
                    } else {
                        VStack(alignment: .leading, spacing: 12) {
                        if showsPeopleResults {
                            SearchSectionHeader(title: "People")
                                .padding(.horizontal, 16)
                                .padding(.top, 8)

                            SearchUsersList(users: searchUserResults)
                                .padding(.horizontal, 16)
                        }

                        if showsPlaceResults {
                            SearchSectionHeader(title: "Places")
                                .padding(.horizontal, 16)
                                .padding(.top, 8)

                            ForEach(searchVenueResults, id: \.listRowID) { place in
                                NavigationLink {
                                    PlaceDetailView(place: place)
                                } label: {
                                    PlaceRowView(place: place)
                                        .padding(.horizontal, 16)
                                }
                                .buttonStyle(.plain)
                            }
                        }

                        if showsEventResults {
                            SearchSectionHeader(title: "Events")
                                .padding(.horizontal, 16)
                                .padding(.top, 8)

                            ForEach(searchEvents) { event in
                                EventDetailNavigationLink(event: event) {
                                    EventSearchRow(event: event)
                                        .padding(.horizontal, 16)
                                }
                            }
                        }

                        if searchViewModel.isLoading {
                            ProgressView()
                                .tint(.white)
                                .frame(maxWidth: .infinity)
                                .padding(.top, 6)
                        }
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(.top, 8)
                    }
                }
            }
            .frame(maxWidth: .infinity)
            .padding(.top, showsNativeSearch ? 0 : 74)
            .padding(.bottom, 48)
        }
        .scrollIndicators(.hidden)
        .scrollDismissesKeyboard(.interactively)
        .simultaneousGesture(
            TapGesture().onEnded {
                guard isSearchFieldFocused, isSearchKeyboardDismissEnabled else {
                    return
                }

                isSearchFieldFocused = false
            }
        )
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
                .padding(.top, 82)
                .padding(.bottom, 48)
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
            ProgressView("Searching events...")
                .frame(maxWidth: .infinity)
                .tint(.white)
                .foregroundStyle(.white)
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
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(.white.opacity(0.92))

                TextField("", text: $searchText, prompt: Text(searchesUsersOnly ? "Search people..." : "People, places, events...").foregroundStyle(.white.opacity(0.42)))
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

            if !searchesUsersOnly {
                Menu {
                    ForEach(SearchFilter.allCases) { filter in
                        Button {
                            selectedSearchFilter = filter
                        } label: {
                            if selectedSearchFilter == filter {
                                Label(filter.title, systemImage: "checkmark")
                            } else {
                                Text(filter.title)
                            }
                        }
                    }
                } label: {
                    Image(systemName: "line.3.horizontal.decrease")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(selectedSearchFilter == .all ? Color.primary : AppTheme.accentBlue)
                        .frame(width: 46, height: 46)
                        .contentShape(Circle())
                        .modifier(HomeStandaloneControlStyle(isStandalone: true))
                }
                .buttonStyle(.plain)
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
                        onSearch: presentHomeEventSearch
                    )
                }

                Spacer()

                if !isSearchPresented {
                    weekPagerControl
                }
            }

            if !isSearchPresented {
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

        return visibleWeekDays.map { day in
            let events = grouped[day] ?? []

            return EventSection(
                day: day,
                title: sectionTitle(for: day),
                events: events.sorted(by: sortEventsForDayRow)
            )
        }
    }

    private var visibleWeekDays: [Date] {
        let startDate = EventFeedViewModel.displayRangeStartDate(for: selectedWeekStart)
        let weekEnd = EventFeedViewModel.weekEndDate(for: selectedWeekStart) ?? startDate
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
        let startDate = EventFeedViewModel.displayRangeStartDate(for: selectedWeekStart)
        let weekEnd = EventFeedViewModel.weekEndDate(for: selectedWeekStart) ?? startDate
        let inclusiveEndDate = Self.weekCalendar.date(byAdding: .day, value: -1, to: weekEnd) ?? startDate

        return "\(Self.weekRangeMonthFormatter.string(from: startDate)) - \(Self.weekRangeMonthFormatter.string(from: inclusiveEndDate))"
    }

    private var visibleWeekRelativeTitle: String {
        let currentWeekStart = Self.startOfWeek(for: .now)
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
            let weekday = Self.weekCalendar.component(.weekday, from: .now)
            return [6, 7, 1].contains(weekday) ? "This Weekend" : "This Week"
        case 1:
            return "Next Week"
        default:
            return "In \(weeksFromCurrent) Weeks"
        }
    }

    private var skeletonSectionDays: [Date] {
        Array(visibleWeekDays.prefix(3))
    }

    private var eventsForSelectedWeek: [EventFeedItem] {
        let startDate = EventFeedViewModel.displayRangeStartDate(for: selectedWeekStart)
        let weekEnd = EventFeedViewModel.weekEndDate(for: selectedWeekStart)

        return filteredCurrentEvents.filter { event in
            let eventDay = visibleSectionDay(for: event)
            guard let weekEnd else {
                return eventDay >= startDate
            }

            return eventDay >= startDate &&
                eventDay < weekEnd
        }
    }

    private var searchEvents: [EventFeedItem] {
        guard selectedSearchFilter.includesEvents else {
            return []
        }

        let query = normalizedSearchQuery
        guard !query.isEmpty else {
            return []
        }

        let localMatches = filteredCurrentEvents
            .filter { $0.startAt >= .now }
            .filter { event in
                event.matchesSearch(query)
            }
            .sorted(by: { $0.startAt < $1.startAt })

        var seenEventIDs = Set<UUID>()
        return (searchViewModel.events + localMatches)
            .filter { event in
                seenEventIDs.insert(event.id).inserted
            }
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

    private var shouldShowWeekSkeletons: Bool {
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
        selectedSearchFilter.includesPeople ? searchViewModel.users : []
    }

    private var emptyStateRecentUsers: [FriendUserSummary] {
        guard selectedSearchFilter.includesPeople else {
            return []
        }

        let count = searchesUsersOnly || selectedSearchFilter == .people ? 20 : 7
        let sourceUsers = searchViewModel.recentUsers.isEmpty
            ? searchViewModel.users
            : searchViewModel.recentUsers
        return Array(sourceUsers.prefix(count))
    }

    private var emptyStateSuggestedPlaces: [PlaceListItem] {
        guard selectedSearchFilter.includesPlaces else {
            return []
        }

        let count = selectedSearchFilter == .places ? 10 : 5
        let sourcePlaces = searchViewModel.suggestedPlaces.isEmpty
            ? searchViewModel.places
            : searchViewModel.suggestedPlaces
        return Array(sourcePlaces.prefix(count))
    }

    private var emptyStateUpcomingEvents: [EventFeedItem] {
        guard selectedSearchFilter.includesEvents else {
            return []
        }

        let count = selectedSearchFilter == .events ? 10 : 5
        return Array(searchViewModel.upcomingEvents.prefix(count))
    }

    private var searchVenueResults: [PlaceListItem] {
        selectedSearchFilter.includesPlaces ? searchViewModel.places : []
    }

    private var showsPeopleResults: Bool {
        !searchUserResults.isEmpty
    }

    private var showsPlaceResults: Bool {
        !searchVenueResults.isEmpty
    }

    private var showsEventResults: Bool {
        !searchEvents.isEmpty
    }

    private var displayedEventsForPrefetch: [EventFeedItem] {
        if isShowingSearchResults {
            return searchEvents
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
        selectedWeekStart > Self.startOfWeek(for: .now)
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

    private var isShowingSearchResults: Bool {
        isSearchPresented || !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private var normalizedSearchQuery: String {
        searchText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func moveWeek(by offset: Int) {
        guard let weekStart = Self.weekCalendar.date(byAdding: .day, value: offset * 7, to: selectedWeekStart) else {
            return
        }

        selectedWeekStart = max(weekStart, Self.startOfWeek(for: .now))
    }

    private func categoryFilterIncludes(_ event: EventFeedItem) -> Bool {
        guard let effectiveCategoryFilterID else {
            return true
        }

        return event.categories.contains(effectiveCategoryFilterID)
    }

    private func resetToCurrentWeek() {
        selectedWeekStart = Self.startOfWeek(for: .now)
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
            forceRefresh: forceRefresh
        )
        async let reviewPromptLoad: Void = loadPostEventFeedbackPrompt(using: apiClient)

        await eventLoad
        await reviewPromptLoad

        guard isAuthenticated else {
            recentActivityViewModel.clear()
            return
        }

        await recentActivityViewModel.load(using: apiClient)
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

    private func loadCompletedPostEventFeedbackIDs() {
        let savedIDs = UserDefaults.standard.stringArray(forKey: "completedPostEventFeedbackIDs") ?? []
        completedPostEventFeedbackIDs = Set(savedIDs)
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
                _ = try await apiClient.send(endpoint)
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
        UINotificationFeedbackGenerator().notificationOccurred(.success)
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
        Self.weekCalendar.startOfDay(for: event.startAt)
    }

    private func sectionTitle(for day: Date) -> String {
        let now = Date()
        let startOfToday = Self.weekCalendar.startOfDay(for: now)
        let startOfDay = Self.weekCalendar.startOfDay(for: day)
        let isEarlyMorning = Self.weekCalendar.component(.hour, from: now) < 6
        let isEvening = Self.weekCalendar.component(.hour, from: now) >= 17

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
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(.white)

            if let location = showsLocation ? headerLocationName : nil {
                Text(" in \(location)")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(.white.opacity(0.5))
            }
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
        selectedWeekStart == Self.startOfWeek(for: .now)
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
            return "🙁"
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
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
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
            .homeLiquidGlass(in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
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
        onSkip: (() async -> Bool)? = nil,
        onResponse: @escaping (PostEventFeedbackResponse, String?) async -> Bool
    ) {
        self.event = event
        self.onResponse = onResponse
        self.onSkip = onSkip
        _comment = State(initialValue: initialComment ?? "")
        _selectedResponse = State(initialValue: initialResponse)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                HStack(alignment: .center, spacing: 14) {
                    sheetArtwork

                    VStack(alignment: .leading, spacing: 4) {
                        Text(event.title)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(.white)
                            .lineLimit(2)

                        VStack(alignment: .leading, spacing: 4) {
                            Text(event.startAt.formatted(date: .abbreviated, time: .shortened))
                                .foregroundStyle(AppTheme.accentBlue)

                            Text(event.venueName ?? "\(event.city), \(event.state)")
                                .foregroundStyle(.white.opacity(0.70))
                        }
                        .font(.system(size: 14, weight: .medium))
                        .lineLimit(1)
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)

                }
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

private struct HomeMenuPillLabel: View {
    let title: String

    var body: some View {
        HStack(spacing: 10) {
            Text(title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.78)

            Image(systemName: "chevron.down")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.primary.opacity(0.58))
        }
        .padding(.horizontal, 15)
        .frame(height: 46)
        .fixedSize(horizontal: true, vertical: false)
        .contentShape(Capsule())
        .homeLiquidGlass(in: Capsule())
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
            VStack(alignment: .leading, spacing: 10) {
                Button(action: onShowActivity) {
                    HStack(spacing: 6) {
                        Text("Recent Activity")
                            .font(.system(size: 20, weight: .bold))
                            .foregroundStyle(.white)

                        Image(systemName: "chevron.right")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(.white.opacity(0.78))
                    }
                }
                .buttonStyle(.plain)
                .padding(.horizontal, 16)

                VStack(alignment: .leading, spacing: 16) {
                    ForEach(visible) { activity in
                        HomeRecentActivityRow(
                            activity: activity,
                            onRespondToRequest: onRespondToRequest
                        )
                    }
                }
                .padding(.horizontal, 16)
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
        HStack(alignment: activity.type.isRequest ? .center : .top, spacing: 12) {
            ActivityAvatarView(activity: activity)
                .padding(.top, activity.type.isRequest ? 0 : 6)

            if activity.type.isRequest {
                requestContent
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
            VStack(alignment: .leading, spacing: 6) {
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

private struct EventSearchRow: View {
    let event: EventFeedItem

    var body: some View {
        HStack(alignment: .center, spacing: 12) {
            artwork
                .frame(width: 84, height: 84)
                .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))
                .overlay(alignment: .bottomTrailing) {
                    if !event.socialAttendees.isEmpty {
                        EventSocialOverlayView(attendees: event.socialAttendees, size: .searchRow)
                            .padding(6)
                    }
                }

            VStack(alignment: .leading, spacing: 3) {
                Text(event.title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.leading)
                    .lineLimit(2)
                    .lineSpacing(1)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Text(event.formattedCardStart)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(AppTheme.accentBlue)
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)

                Text(event.primaryLocation)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.white.opacity(0.76))
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(9)
        .frame(minHeight: 102, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color(red: 0.11, green: 0.11, blue: 0.13))
        )
    }

    @ViewBuilder
    private var artwork: some View {
        if let url = event.displayImageURL {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFill()
                default:
                    placeholder
                }
            }
        } else {
            placeholder
        }
    }

    private var placeholder: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.13, green: 0.22, blue: 0.38),
                    Color(red: 0.46, green: 0.14, blue: 0.43),
                    Color(red: 0.86, green: 0.36, blue: 0.22),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            Image(systemName: "music.mic")
                .font(.system(size: 28, weight: .regular))
                .foregroundStyle(.white.opacity(0.78))
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
        UserListRowView(
            imageURL: user.avatarImageURL,
            name: user.name,
            subtitle: user.usernameText,
            identityKey: user.id,
            avatarSize: 42,
            verticalPadding: 0
        ) {
            if user.friendStatus == .accepted {
                Text("Friends")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.white.opacity(0.62))
            } else if user.friendStatus == .pendingSent {
                Text("Pending")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.white.opacity(0.62))
                    .padding(.trailing, 4)
            } else if user.friendStatus == .pendingReceived {
                Text("Requested You")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.white.opacity(0.62))
            }
        }
    }
}

private struct SearchUsersList: View {
    let users: [FriendUserSummary]
    @Environment(\.apiClient) private var apiClient

    var body: some View {
        VStack(spacing: 12) {
            ForEach(users) { user in
                NavigationLink {
                    UserProfileView(userID: user.id)
                } label: {
                    SearchUserRow(user: user)
                        .padding(9)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .fill(Color(red: 0.11, green: 0.11, blue: 0.13))
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .strokeBorder(.white.opacity(0.08), lineWidth: 1)
                        )
                        .contentShape(Rectangle())
                }
                .task {
                    await UserProfileViewModel.preload(userID: user.id, using: apiClient)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

private struct SearchVenueRow: View {
    let place: PlaceListItem

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            HStack(alignment: .center, spacing: 12) {
                logo

                VStack(alignment: .leading, spacing: 7) {
                    Text(place.name)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white)
                        .lineLimit(2)
                        .minimumScaleFactor(0.88)

                    if !place.locationText.isEmpty {
                        Text(place.locationText)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(Color(red: 0.48, green: 0.77, blue: 1.0))
                            .lineLimit(1)
                    }

                    if let eventCountText = place.eventCountText {
                        Text(eventCountText)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(.white.opacity(0.62))
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(9)
            .frame(minHeight: 102, alignment: .topLeading)

            Text(place.type.displayName)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.white.opacity(0.36))
                .padding(.trailing, 9)
                .padding(.bottom, 9)
        }
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color(red: 0.11, green: 0.11, blue: 0.13))
        )
    }

    @ViewBuilder
    private var logo: some View {
        if let url = place.displayLogoURL {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFill()
                default:
                    logoPlaceholder
                }
            }
            .frame(width: 84, height: 84)
            .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))
        } else {
            logoPlaceholder
        }
    }

    private var logoPlaceholder: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.16, green: 0.18, blue: 0.24),
                    Color(red: 0.30, green: 0.22, blue: 0.32),
                    Color(red: 0.08, green: 0.08, blue: 0.09),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            Image(systemName: place.type == .venue ? "building.2" : "sparkles")
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(.white.opacity(0.72))
        }
        .frame(width: 84, height: 84)
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

@MainActor
private final class HomeRecentActivityViewModel: ObservableObject {
    @Published private(set) var activities: [ActivityFeedItem] = []

    func load(using apiClient: APIClient) async {
        do {
            let response = try await apiClient.send(APIClient.mobileHomeActivity(limit: 3))
            activities = response.activities
        } catch {
            // Keep any existing items visible during refresh failures.
        }
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

            guard activeQuery == normalizedQuery else {
                return
            }

            if normalizedQuery.isEmpty {
                Self.cachedResponse = response
            }

            apply(response)
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

    func updateFriendStatus(for userID: String, status: FriendUserSummary.FriendStatus) {
        func updating(_ source: [FriendUserSummary]) -> [FriendUserSummary] {
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

        users = updating(users)
        recentUsers = updating(recentUsers)

        guard let cachedResponse = Self.cachedResponse else {
            return
        }

        Self.cachedResponse = MobileSearchResponse(
            events: cachedResponse.events,
            upcomingEvents: cachedResponse.upcomingEvents,
            users: updating(cachedResponse.users),
            recentUsers: updating(cachedResponse.recentUsers),
            suggestedPlaces: cachedResponse.suggestedPlaces,
            places: cachedResponse.places
        )
    }
}

private enum SearchFilter: String, CaseIterable, Identifiable {
    case all
    case people
    case places
    case events

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all:
            return "All"
        case .people:
            return "People"
        case .places:
            return "Places"
        case .events:
            return "Events"
        }
    }

    var systemImage: String {
        switch self {
        case .all:
            return "line.3.horizontal.decrease.circle"
        case .people:
            return "person.2"
        case .places:
            return "mappin.and.ellipse"
        case .events:
            return "calendar"
        }
    }

    var includesPeople: Bool {
        self == .all || self == .people
    }

    var includesPlaces: Bool {
        self == .all || self == .places
    }

    var includesEvents: Bool {
        self == .all || self == .events
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

private struct EventSkeletonSectionView: View {
    let title: String
    let cardWidth: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 16)

            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(0 ..< 3, id: \.self) { index in
                        EventCardSkeletonView(seed: index)
                            .frame(width: cardWidth)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollIndicators(.hidden)
            .contentMargins(.horizontal, 16, for: .scrollContent)
            .scrollTargetBehavior(.viewAligned)
            .allowsHitTesting(false)
        }
    }
}

private struct EmptyEventDayPlaceholder: View {
    var body: some View {
        RoundedRectangle(cornerRadius: 20, style: .continuous)
            .fill(Color.clear)
            .frame(maxWidth: .infinity)
            .frame(height: 140)
            .overlay {
                Text("No events scheduled")
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

struct EventCardSkeletonView: View {
    let seed: Int
    @State private var isHighlighted = false

    private let cardHeight: CGFloat = 284
    private let cardCornerRadius: CGFloat = 18

    var body: some View {
        RoundedRectangle(cornerRadius: cardCornerRadius, style: .continuous)
            .fill(Color(red: 0.11, green: 0.11, blue: 0.13))
            .overlay {
                RoundedRectangle(cornerRadius: cardCornerRadius, style: .continuous)
                    .fill(skeletonFill)
            }
            .frame(maxWidth: .infinity, minHeight: cardHeight, maxHeight: cardHeight, alignment: .topLeading)
        .onAppear {
            withAnimation(
                .easeInOut(duration: 0.92)
                    .repeatForever(autoreverses: true)
                    .delay(Double(seed) * 0.08)
            ) {
                isHighlighted = true
            }
        }
    }

    private var skeletonFill: LinearGradient {
        LinearGradient(
            colors: [
                Color.white.opacity(isHighlighted ? 0.11 : 0.055),
                Color.white.opacity(isHighlighted ? 0.17 : 0.085),
                Color.white.opacity(isHighlighted ? 0.10 : 0.05),
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
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
