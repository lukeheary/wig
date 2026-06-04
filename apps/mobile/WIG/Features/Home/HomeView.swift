import SwiftUI

struct HomeView: View {
    let showsNativeSearch: Bool
    let isSearchPresentedOnAppear: Bool
    let onShowActivity: () -> Void

    @Environment(\.apiClient) private var apiClient
    @StateObject private var viewModel = EventFeedViewModel()
    @StateObject private var recentActivityViewModel = HomeRecentActivityViewModel()
    @State private var selectedWeekStart = Self.startOfWeek(for: .now)
    @State private var isSearchPresented = false
    @State private var searchText = ""
    @State private var selectedLocationFilter: HomeLocationFilter?
    @State private var selectedEventFilter: HomeEventFilter = .all
    @State private var weekNavigationDirection = 1

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
        onShowActivity: @escaping () -> Void = {}
    ) {
        self.showsNativeSearch = showsNativeSearch
        self.isSearchPresentedOnAppear = isSearchPresentedOnAppear
        self.onShowActivity = onShowActivity
    }

    var body: some View {
        NavigationStack {
            content
                .background(feedBackground)
                .toolbar(.hidden, for: .navigationBar)
                .task {
                    if case .idle = viewModel.state {
                        await loadHome(using: apiClient)
                    }
                }
                .refreshable {
                    await loadHome(using: apiClient, forceRefresh: true)
                }
                .onAppear {
                    if showsNativeSearch && isSearchPresentedOnAppear {
                        isSearchPresented = true
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: .eventRSVPDidChange)) { _ in
                    Task {
                        await loadHome(using: apiClient, forceRefresh: true)
                    }
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
                        await loadHome(using: apiClient)
                    }
                }
                .foregroundStyle(.white)
                .buttonStyle(.borderedProminent)
                .tint(.black)
            }
            .foregroundStyle(.white)
            .background(feedBackground)

        case .loaded(let response):
            if response.events.isEmpty {
                ContentUnavailableView {
                    Label("No Upcoming Events", systemImage: "calendar")
                } description: {
                    Text("The mobile feed is connected, but there are no public upcoming events right now.")
                }
                .background(feedBackground)
            } else {
                ZStack(alignment: .top) {
                    if isShowingSearchResults {
                        searchResultsContent
                    } else {
                        weeklyContent
                            .id(selectedWeekStart)
                            .transition(weekTransition)
                    }

                    homeTopControls
                }
                .background(feedBackground)
            }
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
                if searchEvents.isEmpty {
                    ContentUnavailableView {
                        Label("No Events Found", systemImage: "magnifyingglass")
                    } description: {
                        Text("Try a different event, venue, or city.")
                    }
                    .foregroundStyle(.white)
                    .frame(maxWidth: .infinity)
                    .padding(.top, 48)
                } else {
                    ForEach(searchEvents) { event in
                        NavigationLink {
                            EventDetailView(event: event)
                        } label: {
                            EventSearchRow(event: event)
                                .padding(.horizontal, 16)
                        }
                        .buttonStyle(.plain)
                        .simultaneousGesture(
                            TapGesture().onEnded {
                                isSearchPresented = false
                            }
                        )
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
                        moveWeek(by: -1)
                    }
                }

                FloatingGlassIconButton(systemImage: "chevron.right") {
                    moveWeek(by: 1)
                }
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 14)
    }

    private var groupedEvents: [EventSection] {
        let grouped = Dictionary(grouping: eventsForSelectedWeek) { event in
            Self.weekCalendar.startOfDay(for: event.startAt)
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
        guard let nextWeekStart = Self.weekCalendar.date(byAdding: .day, value: 7, to: selectedWeekStart) else {
            return filteredCurrentEvents
        }

        return filteredCurrentEvents.filter { event in
            event.startAt >= selectedWeekStart && event.startAt < nextWeekStart
        }
    }

    private var searchEvents: [EventFeedItem] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        let upcomingEvents = filteredCurrentEvents
            .filter { $0.startAt >= .now }
            .sorted(by: { $0.startAt < $1.startAt })

        guard !query.isEmpty else {
            return Array(upcomingEvents.prefix(20))
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
        !isViewingFutureWeek && !recentActivityViewModel.activities.isEmpty
    }

    private var isShowingSearchResults: Bool {
        isSearchPresented || !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    private func moveWeek(by offset: Int) {
        guard let weekStart = Self.weekCalendar.date(byAdding: .day, value: offset * 7, to: selectedWeekStart) else {
            return
        }

        withAnimation(.snappy(duration: 0.24)) {
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

    private func loadHome(using apiClient: APIClient, forceRefresh: Bool = false) async {
        await viewModel.load(using: apiClient, forceRefresh: forceRefresh)
        await recentActivityViewModel.load(using: apiClient)
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
            return event.city.localizedCaseInsensitiveCompare(city) == .orderedSame &&
                event.state.localizedCaseInsensitiveCompare(state) == .orderedSame
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

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEE, MMM d 'at' h:mm a"
        return formatter
    }()

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

                Text(Self.dateFormatter.string(from: event.startAt))
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
