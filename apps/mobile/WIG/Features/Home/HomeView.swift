import ClerkKit
import SwiftUI

struct HomeView: View {
    let showsNativeSearch: Bool
    let isSearchPresentedOnAppear: Bool
    let onShowActivity: () -> Void
    let onSearchDismiss: () -> Void

    @Environment(Clerk.self) private var clerk
    @Environment(\.apiClient) private var apiClient
    @EnvironmentObject private var appSession: AppSession
    @StateObject private var viewModel = EventFeedViewModel()
    @StateObject private var recentActivityViewModel = HomeRecentActivityViewModel()
    @StateObject private var searchViewModel = HomeSearchDirectoryViewModel()
    @State private var selectedWeekStart = Self.startOfWeek(for: .now)
    @State private var isSearchPresented = false
    @State private var searchText = ""
    @State private var selectedLocationFilter: HomeLocationFilter?
    @State private var selectedEventFilter: HomeEventFilter = .all
    @State private var weekNavigationDirection = 1
    @State private var isWeekTransitionEnabled = false
    @State private var sendingFriendRequestUserIDs = Set<String>()

    private static let sectionTitleFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEE, MMM d"
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
        isSearchPresentedOnAppear: Bool = false,
        onShowActivity: @escaping () -> Void = {},
        onSearchDismiss: @escaping () -> Void = {}
    ) {
        self.showsNativeSearch = showsNativeSearch
        self.isSearchPresentedOnAppear = isSearchPresentedOnAppear
        self.onShowActivity = onShowActivity
        self.onSearchDismiss = onSearchDismiss
    }

    var body: some View {
        NavigationStack {
            content
                .background(feedBackground)
                .toolbar(.hidden, for: .navigationBar)
                .task {
                    if case .idle = viewModel.state {
                        await loadHome(for: selectedWeekStart, using: apiClient)
                    }
                }
                .refreshable {
                    await loadHome(for: selectedWeekStart, using: apiClient, forceRefresh: true)
                }
                .onAppear {
                    if showsNativeSearch && isSearchPresentedOnAppear {
                        isSearchPresented = true
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: .eventRSVPDidChange)) { _ in
                    Task {
                        await loadHome(for: selectedWeekStart, using: apiClient, forceRefresh: true)
                    }
                }
                .onChange(of: selectedWeekStart) { _, weekStart in
                    Task {
                        await loadHome(for: weekStart, using: apiClient)
                    }
                }
                .onChange(of: isSearchPresented) { _, isPresented in
                    guard showsNativeSearch,
                          !isPresented,
                          searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    else {
                        return
                    }

                    isWeekTransitionEnabled = false
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
                .onChange(of: searchText) { _, value in
                    guard showsNativeSearch else {
                        return
                    }

                    searchViewModel.prepare(query: value)
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
            ProgressView("Loading events...")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .tint(.white)
                .foregroundStyle(.white)
                .background(feedBackground)

        case .failed(let message):
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

        case .loaded(let response):
            ZStack(alignment: .top) {
                if isShowingSearchResults {
                    searchResultsContent
                } else {
                    weeklyContent
                        .id(selectedWeekStart)
                        .transition(isWeekTransitionEnabled ? weekTransition : .identity)
                }

                homeTopControls
            }
            .background(feedBackground)
        }
    }

    private var weeklyContent: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 24) {
                if shouldShowRecentActivity {
                    HomeRecentActivitySection(
                        activities: recentActivityViewModel.activities,
                        onShowActivity: onShowActivity
                    )
                    .padding(.top, 18)
                }

                if groupedEvents.isEmpty {
                    ContentUnavailableView {
                        Label("No Events This Week", systemImage: "calendar")
                    } description: {
                        Text("Use the arrow to browse upcoming weeks.")
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 56)
                } else {
                    ForEach(Array(groupedEvents.enumerated()), id: \.element.day) { index, section in
                        VStack(alignment: .leading, spacing: 12) {
                            Text(section.title)
                                .font(.system(size: 20, weight: .bold))
                                .foregroundStyle(.white)
                                .padding(.horizontal, 16)

                            ScrollView(.horizontal) {
                                LazyHStack(alignment: .top, spacing: 12) {
                                    ForEach(section.events) { event in
                                        NavigationLink {
                                            EventDetailView(event: event)
                                        } label: {
                                            EventCardView(event: event)
                                                .frame(width: eventCardWidth)
                                        }
                                        .buttonStyle(.plain)
                                    }
                                }
                                .padding(.horizontal, 16)
                            }
                            .scrollIndicators(.hidden)
                        }
                        .padding(.top, index == 0 && !shouldShowRecentActivity ? 16 : 0)
                    }
                }
            }
            .padding(.top, 64)
            .padding(.bottom, 48)
        }
        .scrollIndicators(.hidden)
    }

    private var searchResultsContent: some View {
        ScrollView {
            LazyVStack(alignment: .leading, spacing: 14) {
                if normalizedSearchQuery.isEmpty {
                    ContentUnavailableView {
                        Label("Search Events and People", systemImage: "magnifyingglass")
                    } description: {
                        Text("Type a name, username, venue, or event.")
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 48)
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
                            Text("Try a different event, person, venue, or username.")
                        }
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .padding(.top, 48)
                    } else {
                        if !searchUserResults.isEmpty {
                            SearchSectionHeader(title: "People")
                                .padding(.horizontal, 16)

                            ForEach(Array(searchUserResults.enumerated()), id: \.element.id) { index, user in
                                SearchUserRow(
                                    user: user,
                                    seed: index,
                                    isSendingRequest: sendingFriendRequestUserIDs.contains(user.id),
                                    onAddFriend: {
                                        sendFriendRequest(to: user.id)
                                    }
                                )
                                    .padding(.horizontal, 16)
                            }
                        }

                        if !searchVenueResults.isEmpty {
                            SearchSectionHeader(title: "Venues")
                                .padding(.horizontal, 16)
                                .padding(.top, searchUserResults.isEmpty ? 0 : 8)

                            ForEach(searchVenueResults) { place in
                                NavigationLink {
                                    PlaceDetailView(place: place)
                                } label: {
                                    SearchVenueRow(place: place)
                                        .padding(.horizontal, 16)
                                }
                                .buttonStyle(.plain)
                            }
                        }

                        if !searchEvents.isEmpty {
                            SearchSectionHeader(title: "Events")
                                .padding(.horizontal, 16)
                                .padding(.top, (searchUserResults.isEmpty && searchVenueResults.isEmpty) ? 0 : 8)

                            ForEach(searchEvents) { event in
                                NavigationLink {
                                    EventDetailView(event: event)
                                } label: {
                                    EventSearchRow(event: event)
                                        .padding(.horizontal, 16)
                                }
                                .buttonStyle(.plain)
                            }
                        }

                        if searchViewModel.isLoading {
                            ProgressView()
                                .tint(.white)
                                .frame(maxWidth: .infinity)
                                .padding(.top, 6)
                        }
                    }
                }
            }
            .padding(.top, showsNativeSearch ? 18 : 74)
            .padding(.bottom, 104)
        }
        .scrollIndicators(.hidden)
    }

    private var homeTopControls: some View {
        HStack(alignment: .top, spacing: 10) {
            if !isSearchPresented {
                HomeLocationFilterDropdown(
                    selection: Binding(
                        get: { effectiveLocationFilter },
                        set: { selectedLocationFilter = $0 }
                    ),
                    locations: availableLocationFilters
                )

                HomeEventFilterDropdown(selection: $selectedEventFilter)
            }

            Spacer()

            if !isSearchPresented {
                if isViewingFutureWeek {
                    FloatingGlassIconButton(systemImage: "chevron.left") {
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()
                        moveWeek(by: -1)
                    }
                }

                FloatingGlassIconButton(systemImage: "chevron.right") {
                    UIImpactFeedbackGenerator(style: .light).impactOccurred()
                    moveWeek(by: 1)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 14)
    }

    private var groupedEvents: [EventSection] {
        let grouped = Dictionary(grouping: eventsForSelectedWeek) { event in
            visibleSectionDay(for: event)
        }

        return grouped
            .map { day, events in
                EventSection(
                    day: day,
                    title: sectionTitle(for: day),
                    events: events.sorted(by: sortEventsForDayRow)
                )
            }
            .sorted(by: { $0.day < $1.day })
    }

    private var eventsForSelectedWeek: [EventFeedItem] {
        return filteredCurrentEvents.filter { event in
            let eventDay = visibleSectionDay(for: event)
            guard let nextWeekStart = Self.weekCalendar.date(byAdding: .day, value: 7, to: selectedWeekStart) else {
                return shouldIncludeInCurrentWeekFeed(event)
            }

            return eventDay >= selectedWeekStart &&
                eventDay < nextWeekStart &&
                shouldIncludeInCurrentWeekFeed(event)
        }
    }

    private var searchEvents: [EventFeedItem] {
        let query = normalizedSearchQuery
        let upcomingEvents = filteredCurrentEvents
            .filter { $0.startAt >= .now }
            .sorted(by: { $0.startAt < $1.startAt })

        guard !query.isEmpty else {
            return []
        }

        return Array(
            upcomingEvents
                .filter { event in
                    event.matchesSearch(query)
                }
                .prefix(20)
        )
    }

    private var currentEvents: [EventFeedItem] {
        guard case .loaded(let response) = viewModel.state else {
            return []
        }

        return response.events
    }

    private var currentUserLocation: EventCity? {
        guard case .loaded(let response) = viewModel.state else {
            return nil
        }

        return response.currentUserLocation
    }

    private var filteredCurrentEvents: [EventFeedItem] {
        currentEvents
            .filter(effectiveLocationFilter.includes)
            .filter(selectedEventFilter.includes)
    }

    private var searchUserResults: [FriendUserSummary] {
        searchViewModel.users
    }

    private var searchVenueResults: [PlaceListItem] {
        searchViewModel.places
    }

    private var availableLocationFilters: [HomeLocationFilter] {
        guard case .loaded(let response) = viewModel.state else {
            return [.all]
        }

        var cityFilters = response.availableCities.reduce(into: [HomeLocationFilter]()) { filters, city in
            let filter = HomeLocationFilter.city(city: city.city, state: city.state)

            guard !filters.contains(filter) else {
                return
            }

            filters.append(filter)
        }
        .sorted { lhs, rhs in
            lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
        }

        if let currentUserLocation {
            let userFilter = HomeLocationFilter.city(
                city: currentUserLocation.city,
                state: currentUserLocation.state
            )

            if !cityFilters.contains(userFilter) {
                cityFilters.insert(userFilter, at: 0)
            }
        }

        return [.all] + cityFilters
    }

    private var effectiveLocationFilter: HomeLocationFilter {
        guard let selectedLocationFilter else {
            return defaultLocationFilter
        }

        if availableLocationFilters.contains(selectedLocationFilter) {
            return selectedLocationFilter
        }

        return defaultLocationFilter
    }

    private var defaultLocationFilter: HomeLocationFilter {
        let cityFilters = availableLocationFilters.filter { $0 != .all }

        if let currentUserLocation {
            let userFilter = HomeLocationFilter.city(
                city: currentUserLocation.city,
                state: currentUserLocation.state
            )

            return userFilter
        }

        return cityFilters.first { filter in
            guard case .city(let city, _) = filter else {
                return false
            }

            return city.localizedCaseInsensitiveCompare("Boston") == .orderedSame
        } ?? cityFilters.first ?? .all
    }

    private var isViewingFutureWeek: Bool {
        selectedWeekStart > Self.startOfWeek(for: .now)
    }

    private var shouldShowRecentActivity: Bool {
        isAuthenticated && !isViewingFutureWeek && !recentActivityViewModel.activities.isEmpty
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

        withAnimation(.snappy(duration: 0.24)) {
            isWeekTransitionEnabled = true
            weekNavigationDirection = offset >= 0 ? 1 : -1
            selectedWeekStart = max(weekStart, Self.startOfWeek(for: .now))
        }
    }

    private var weekTransition: AnyTransition {
        let insertionEdge: Edge = weekNavigationDirection >= 0 ? .trailing : .leading
        let removalEdge: Edge = weekNavigationDirection >= 0 ? .leading : .trailing

        return .asymmetric(
            insertion: .move(edge: insertionEdge).combined(with: .opacity),
            removal: .move(edge: removalEdge).combined(with: .opacity)
        )
    }

    private func loadHome(
        for weekStart: Date,
        using apiClient: APIClient,
        forceRefresh: Bool = false
    ) async {
        await viewModel.load(weekStart: weekStart, using: apiClient, forceRefresh: forceRefresh)

        guard isAuthenticated else {
            recentActivityViewModel.clear()
            return
        }

        await recentActivityViewModel.load(using: apiClient)
    }

    private var isAuthenticated: Bool {
        appSession.isAuthBypassed || clerk.user != nil
    }

    private func sendFriendRequest(to userID: String) {
        guard isAuthenticated else {
            return
        }

        sendingFriendRequestUserIDs.insert(userID)

        Task {
            defer {
                sendingFriendRequestUserIDs.remove(userID)
            }

            do {
                let response = try await apiClient.send(
                    APIClient.sendMobileFriendRequest(friendUserID: userID)
                )
                searchViewModel.updateFriendStatus(
                    for: userID,
                    status: response.friendStatus
                )
            } catch {
                // Keep the current search results visible without interrupting the surface.
            }
        }
    }

    private func sortEventsForDayRow(_ lhs: EventFeedItem, _ rhs: EventFeedItem) -> Bool {
        let lhsPriority = socialPriority(for: lhs)
        let rhsPriority = socialPriority(for: rhs)

        if lhsPriority != rhsPriority {
            return lhsPriority < rhsPriority
        }

        return lhs.startAt < rhs.startAt
    }

    private func socialPriority(for event: EventFeedItem) -> Int {
        if !event.friendsGoing.isEmpty {
            return 0
        }

        if !event.friendsInterested.isEmpty {
            return 1
        }

        return 2
    }

    private func visibleSectionDay(for event: EventFeedItem) -> Date {
        Self.weekCalendar.startOfDay(for: event.startAt)
    }

    private func shouldIncludeInCurrentWeekFeed(_ event: EventFeedItem) -> Bool {
        guard !isViewingFutureWeek else {
            return true
        }

        let now = Date()
        let startOfToday = Self.weekCalendar.startOfDay(for: now)
        let eventDay = visibleSectionDay(for: event)

        if eventDay >= startOfToday {
            return true
        }

        let isEarlyMorning = Self.weekCalendar.component(.hour, from: now) < 6

        guard isEarlyMorning,
              let yesterday = Self.weekCalendar.date(byAdding: .day, value: -1, to: startOfToday)
        else {
            return false
        }

        return Self.weekCalendar.isDate(eventDay, inSameDayAs: yesterday)
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
            return "Last Night's Events"
        }

        if Self.weekCalendar.isDate(startOfDay, inSameDayAs: startOfToday) {
            return isEvening ? "Tonight's Events" : "Today's Events"
        }

        return Self.sectionTitleFormatter.string(from: day)
    }

    private static func startOfWeek(for date: Date) -> Date {
        let startOfDay = weekCalendar.startOfDay(for: date)
        let weekday = weekCalendar.component(.weekday, from: startOfDay)
        let daysFromMonday = (weekday - weekCalendar.firstWeekday + 7) % 7

        return weekCalendar.date(byAdding: .day, value: -daysFromMonday, to: startOfDay) ?? startOfDay
    }

    private var feedBackground: some View {
        Color(red: 0.07, green: 0.07, blue: 0.08)
            .ignoresSafeArea()
    }
}

private struct EventSection: Identifiable {
    let day: Date
    let title: String
    let events: [EventFeedItem]

    var id: Date { day }
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
    case mine

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all:
            return "All Events"
        case .following:
            return "Following"
        case .friends:
            return "Friends' Events"
        case .mine:
            return "My Events"
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
        case .mine:
            return event.isCreatedByCurrentUser || event.hasCurrentUserSocialRSVP
        }
    }
}

private struct HomeLocationFilterDropdown: View {
    @Binding var selection: HomeLocationFilter
    let locations: [HomeLocationFilter]

    var body: some View {
        Menu {
            ForEach(locations) { location in
                Button {
                    selection = location
                } label: {
                    if location == selection {
                        Label(location.title, systemImage: "checkmark")
                    } else {
                        Text(location.title)
                    }
                }
            }
        } label: {
            HomeMenuPillLabel(title: selection.title)
        }
        .buttonStyle(.plain)
    }
}

private struct HomeEventFilterDropdown: View {
    @Binding var selection: HomeEventFilter

    var body: some View {
        Menu {
            ForEach(HomeEventFilter.allCases) { filter in
                Button {
                    selection = filter
                } label: {
                    if filter == selection {
                        Label(filter.title, systemImage: "checkmark")
                    } else {
                        Text(filter.title)
                    }
                }
            }
        } label: {
            HomeMenuPillLabel(title: selection.title)
        }
        .buttonStyle(.plain)
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
        .frame(height: 44)
        .fixedSize(horizontal: true, vertical: false)
        .contentShape(Capsule())
        .homeLiquidGlass(in: Capsule())
    }
}

private struct HomeRecentActivitySection: View {
    let activities: [ActivityFeedItem]
    let onShowActivity: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
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
                ForEach(activities) { activity in
                    HomeRecentActivityRow(activity: activity)
                }
            }
            .padding(.horizontal, 16)
        }
    }
}

private struct HomeRecentActivityRow: View {
    let activity: ActivityFeedItem
    @State private var selectedEvent: EventFeedItem?
    @State private var selectedVenue: PlaceListItem?

    private static let relativeFormatter: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        return formatter
    }()

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ActivityAvatarView(activity: activity)

            VStack(alignment: .leading, spacing: 4) {
                InlineLinkedActivityText(
                    activity: activity,
                    onTapEvent: {
                        selectedEvent = activity.event.eventFeedItem
                    },
                    onTapVenue: { venue in
                        selectedVenue = venue
                    }
                )
                .frame(maxWidth: .infinity, alignment: .leading)

                Text(Self.relativeFormatter.localizedString(for: activity.timestamp, relativeTo: .now))
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.white.opacity(0.42))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationDestination(item: $selectedEvent) { event in
            EventDetailView(event: event)
        }
        .navigationDestination(item: $selectedVenue) { venue in
            PlaceDetailView(place: venue)
        }
    }
}

private struct EventSearchRow: View {
    let event: EventFeedItem

    var body: some View {
        HStack(spacing: 14) {
            artwork
                .frame(width: 86, height: 86)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))

            VStack(alignment: .leading, spacing: 6) {
                Text(event.title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(2)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Text(event.formattedStart(format: "EEE, MMM d 'at' h:mm a"))
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color(red: 0.48, green: 0.77, blue: 1.0))
                    .lineLimit(1)

                Text(event.primaryLocation)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.white.opacity(0.64))
                    .lineLimit(1)
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .fill(Color(red: 0.11, green: 0.11, blue: 0.13))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 24, style: .continuous)
                .strokeBorder(.white.opacity(0.035), lineWidth: 1)
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
            .font(.system(size: 18, weight: .bold))
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct SearchUserRow: View {
    let user: FriendUserSummary
    let seed: Int
    let isSendingRequest: Bool
    let onAddFriend: () -> Void

    private let fallbackColors = [
        Color(red: 0.88, green: 0.48, blue: 0.36),
        Color(red: 0.88, green: 0.68, blue: 0.46),
        Color(red: 0.57, green: 0.35, blue: 0.70),
        Color(red: 0.43, green: 0.70, blue: 0.62),
        Color(red: 0.15, green: 0.63, blue: 0.58),
    ]

    var body: some View {
        HStack(spacing: 14) {
            avatar

            VStack(alignment: .leading, spacing: 3) {
                Text(user.name)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)

                Text(user.usernameText)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.white.opacity(0.58))
                    .lineLimit(1)
            }

            Spacer(minLength: 0)

            if user.friendStatus == FriendUserSummary.FriendStatus.none {
                Button(action: onAddFriend) {
                    ZStack {
                        Circle()
                            .fill(Color.white.opacity(0.08))

                        if isSendingRequest {
                            ProgressView()
                                .scaleEffect(0.75)
                                .tint(.white)
                        } else {
                            Image(systemName: "person.badge.plus")
                                .font(.system(size: 16, weight: .bold))
                                .foregroundStyle(Color(red: 0.48, green: 0.77, blue: 1.0))
                        }
                    }
                    .frame(width: 38, height: 38)
                }
                .buttonStyle(.plain)
                .disabled(isSendingRequest)
            } else if user.friendStatus == .pendingSent {
                Text("Pending")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(.white.opacity(0.62))
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(Color(red: 0.11, green: 0.11, blue: 0.13))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(.white.opacity(0.035), lineWidth: 1)
        )
    }

    @ViewBuilder
    private var avatar: some View {
        Group {
            if let url = user.avatarImageURL {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                    default:
                        fallbackAvatar
                    }
                }
            } else {
                fallbackAvatar
            }
        }
        .frame(width: 48, height: 48)
        .clipShape(Circle())
    }

    private var fallbackAvatar: some View {
        Circle()
            .fill(fallbackColors[abs(seed) % fallbackColors.count])
            .overlay {
                Text(String(user.name.prefix(1)).uppercased())
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.black.opacity(0.86))
            }
    }
}

private struct SearchVenueRow: View {
    let place: PlaceListItem

    var body: some View {
        HStack(spacing: 14) {
            logo

            VStack(alignment: .leading, spacing: 4) {
                Text(place.name)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)

                Text(place.type.displayName)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color(red: 0.48, green: 0.77, blue: 1.0))

                if !place.locationText.isEmpty {
                    Text(place.locationText)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.white.opacity(0.58))
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 0)
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(Color(red: 0.11, green: 0.11, blue: 0.13))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(.white.opacity(0.035), lineWidth: 1)
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
            .frame(width: 48, height: 48)
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        } else {
            logoPlaceholder
        }
    }

    private var logoPlaceholder: some View {
        RoundedRectangle(cornerRadius: 14, style: .continuous)
            .fill(Color.white.opacity(0.08))
            .frame(width: 48, height: 48)
            .overlay {
                Image(systemName: place.type == .venue ? "building.2" : "calendar.badge.clock")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.74))
            }
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
private final class HomeSearchDirectoryViewModel: ObservableObject {
    enum Phase {
        case idle
        case loading
        case loaded
    }

    @Published private(set) var users: [FriendUserSummary] = []
    @Published private(set) var places: [PlaceListItem] = []
    @Published private(set) var phase: Phase = .idle

    var isLoading: Bool {
        phase == .loading
    }

    func prepare(query: String) {
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)

        if normalizedQuery.isEmpty {
            users = []
            places = []
            phase = .idle
        } else {
            phase = .loading
        }
    }

    func load(query: String, using apiClient: APIClient) async {
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !normalizedQuery.isEmpty else {
            users = []
            places = []
            phase = .idle
            return
        }

        phase = .loading

        do {
            let response = try await apiClient.send(
                APIClient.mobileSearch(query: normalizedQuery)
            )
            users = response.users
            places = response.places
        } catch {
            users = []
            places = []
        }

        phase = .loaded
    }

    func updateFriendStatus(for userID: String, status: FriendUserSummary.FriendStatus) {
        users = users.map { user in
            guard user.id == userID else {
                return user
            }

            return FriendUserSummary(
                id: user.id,
                name: user.name,
                username: user.username,
                avatarImageURL: user.avatarImageURL,
                friendStatus: status
            )
        }
    }
}

private extension EventFeedItem {
    var hasCurrentUserSocialRSVP: Bool {
        (friendsGoing + friendsInterested).contains { rsvp in
            rsvp.user.isCurrentUser
        }
    }

    var hasFriendSocialRSVP: Bool {
        (friendsGoing + friendsInterested).contains { rsvp in
            rsvp.user.isFriend
        }
    }

    func matchesSearch(_ query: String) -> Bool {
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
            value.localizedCaseInsensitiveContains(query)
        }
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
        if isEnabled {
            searchable(
                text: text,
                isPresented: isPresented,
                placement: .automatic,
                prompt: "Search events..."
            )
        } else {
            self
        }
    }
}
