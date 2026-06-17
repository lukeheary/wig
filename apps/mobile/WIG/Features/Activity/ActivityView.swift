import SwiftUI
import UIKit

struct ActivityView: View {
    @Environment(\.apiClient) private var apiClient
    @StateObject private var viewModel = ActivityViewModel()
    @State private var selectedFilter: ActivityFeedFilter = .upcoming
    @State private var selectedCityFilter: ActivityCityFilter?
    @State private var activityActionErrorMessage: String?
    @State private var visibleActivityCount = ActivityView.activityPageSize

    private let background = Color(red: 0.07, green: 0.07, blue: 0.08)
    private static let activityPageSize = 20

    var body: some View {
        NavigationStack {
            content
                .background(background.ignoresSafeArea())
                .toolbar(.hidden, for: .navigationBar)
                .overlay(alignment: .topLeading) {
                    HStack(spacing: 10) {
                        if case .loaded(let response) = viewModel.state {
                            ActivityLeadingControls(
                                citySelection: Binding(
                                    get: { effectiveCityFilter(for: response) },
                                    set: { selectedCityFilter = $0 }
                                ),
                                cities: availableCityFilters,
                                hasActiveCitySelection: effectiveCityFilter(for: response) != defaultCityFilter(for: response),
                                selection: $selectedFilter
                            )
                        } else {
                            ActivityLeadingControls(
                                citySelection: Binding(
                                    get: { .all },
                                    set: { selectedCityFilter = $0 }
                                ),
                                cities: [.all],
                                hasActiveCitySelection: false,
                                selection: $selectedFilter
                            )
                        }
                    }
                        .padding(.leading, 16)
                        .padding(.top, 0)
                }
                .task {
                    if case .idle = viewModel.state {
                        await viewModel.load(using: apiClient)
                    }
                }
                .refreshable {
                    await viewModel.load(using: apiClient, forceRefresh: true)
                }
                .onChange(of: selectedFilter) { _, _ in
                    resetVisibleActivityCount()
                }
                .onChange(of: selectedCityFilter) { _, _ in
                    resetVisibleActivityCount()
                }
                .alert(
                    "Couldn't Update Request",
                    isPresented: Binding(
                        get: { activityActionErrorMessage != nil },
                        set: { isPresented in
                            if !isPresented {
                                activityActionErrorMessage = nil
                            }
                        }
                    )
                ) {
                    Button("OK", role: .cancel) {}
                } message: {
                    Text(activityActionErrorMessage ?? "Please try again.")
                }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            ProgressView("Loading activity...")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .tint(.white)
                .foregroundStyle(.white)
                .background(background)

        case .failed(let message):
            ContentUnavailableView {
                Label("Couldn't Load Activity", systemImage: "wifi.exclamationmark")
            } description: {
                Text(message)
            } actions: {
                Button("Try Again") {
                    Task {
                        await viewModel.load(using: apiClient)
                    }
                }
            }
                .background(background)

        case .loaded(let response):
            let activities = effectiveCityFilter(for: response).filtered(
                selectedFilter.filtered(response.activities)
            )
            let visibleActivities = Array(activities.prefix(visibleActivityCount))

            if response.activities.isEmpty {
                ContentUnavailableView {
                    Label("No Recent Activity", systemImage: "bolt")
                } description: {
                    Text("Recent friend activity will show up here.")
                }
                .background(background)
            } else if activities.isEmpty {
                ContentUnavailableView {
                    Label(selectedFilter.emptyTitle, systemImage: "bolt")
                } description: {
                    Text(selectedFilter.emptyMessage)
                }
                .foregroundStyle(.white)
                .padding(.top, 60)
                .background(background)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 22) {
                        ForEach(groupedActivities(visibleActivities)) { section in
                            ActivitySectionView(
                                section: section,
                                onRespondToRequest: { activity, response in
                                    await respondToRequest(activity: activity, response: response)
                                }
                            )
                        }

                        if visibleActivityCount < activities.count {
                            Color.clear
                                .frame(height: 1)
                                .onAppear {
                                    loadMoreActivities(totalCount: activities.count)
                                }
                        }
                    }
                    .padding(.top, 82)
                    .padding(.bottom, 48)
                }
                .scrollIndicators(.hidden)
                .background(background)
            }
        }
    }

    private func groupedActivities(_ activities: [ActivityFeedItem]) -> [ActivitySection] {
        var sections: [ActivitySection] = []

        for activity in activities.sorted(by: { $0.timestamp > $1.timestamp }) {
            let label = recencyLabel(for: activity.timestamp)

            if let index = sections.firstIndex(where: { $0.title == label }) {
                sections[index].activities.append(activity)
            } else {
                sections.append(ActivitySection(title: label, activities: [activity]))
            }
        }

        return sections
    }

    private func recencyLabel(for date: Date) -> String {
        let calendar = Calendar.current
        let startOfToday = calendar.startOfDay(for: .now)
        let startOfDate = calendar.startOfDay(for: date)
        let daysAgo = max(calendar.dateComponents([.day], from: startOfDate, to: startOfToday).day ?? 0, 0)

        if daysAgo == 0 {
            return "Today"
        }

        if daysAgo == 1 {
            return "Yesterday"
        }

        if daysAgo < 7 {
            return "This Week"
        }

        let weekDifference = calendar.dateComponents([.weekOfYear], from: startOfDate, to: startOfToday).weekOfYear ?? 0
        let monthDifference = calendar.dateComponents([.month], from: startOfDate, to: startOfToday).month ?? 0
        let weeksAgo = max(abs(weekDifference), 1)
        let monthsAgo = max(abs(monthDifference), 1)

        if weeksAgo <= 3 {
            return weeksAgo == 1 ? "1 Week Ago" : "\(weeksAgo) Weeks Ago"
        }

        return monthsAgo == 1 ? "Last Month" : "\(monthsAgo) Months Ago"
    }

    private var availableCityFilters: [ActivityCityFilter] {
        guard case .loaded(let response) = viewModel.state else {
            return [.all]
        }

        let cities = response.activities.reduce(into: [ActivityCityFilter]()) { filters, activity in
            guard let event = activity.event else {
                return
            }

            let filter = ActivityCityFilter.city(
                city: event.city,
                state: event.state
            )

            guard !filters.contains(filter) else {
                return
            }

            filters.append(filter)
        }
        .sorted { lhs, rhs in
            lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
        }

        if let currentUserLocation = response.currentUserLocation {
            let userFilter = ActivityCityFilter.city(
                city: currentUserLocation.city,
                state: currentUserLocation.state
            )

            if !cities.contains(userFilter) {
                return [userFilter, .all] + cities
            }
        }

        return [.all] + cities
    }

    private func effectiveCityFilter(for response: ActivityFeedResponse) -> ActivityCityFilter {
        let cities = availableCityFilters

        if let selectedCityFilter, cities.contains(selectedCityFilter) {
            return selectedCityFilter
        }

        return defaultCityFilter(for: response)
    }

    private func defaultCityFilter(for response: ActivityFeedResponse) -> ActivityCityFilter {
        if let currentUserLocation = response.currentUserLocation {
            return .city(city: currentUserLocation.city, state: currentUserLocation.state)
        }

        return availableCityFilters.first { $0 != .all } ?? .all
    }

    private func respondToRequest(
        activity: ActivityFeedItem,
        response: ActivityRequestResponse
    ) async {
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

            // Don't reload here — the store records the response and keeps the
            // item visible with settled text. A pull-to-refresh will clean it up.
        } catch {
            activityActionErrorMessage = error.localizedDescription
        }
    }

    private func resetVisibleActivityCount() {
        visibleActivityCount = Self.activityPageSize
    }

    private func loadMoreActivities(totalCount: Int) {
        guard visibleActivityCount < totalCount else {
            return
        }

        visibleActivityCount = min(visibleActivityCount + Self.activityPageSize, totalCount)
    }
}

private struct ActivityFilterDropdown: View {
    @Binding var selection: ActivityFeedFilter
    var useCombinedStyle = false

    var body: some View {
        Menu {
            ForEach(ActivityFeedFilter.allCases) { filter in
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
            Image(systemName: "line.3.horizontal.decrease")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(selection == .upcoming ? .primary : AppTheme.accentBlue)
                .frame(width: 46, height: 46)
                .contentShape(Rectangle())
                .modifier(ActivityStandaloneControlStyle(isStandalone: !useCombinedStyle))
        }
        .buttonStyle(.plain)
    }
}

private struct ActivityCityFilterDropdown: View {
    @Binding var selection: ActivityCityFilter
    let cities: [ActivityCityFilter]
    let hasActiveSelection: Bool
    var useCombinedStyle = false

    var body: some View {
        Menu {
            ForEach(cities) { city in
                Button {
                    selection = city
                } label: {
                    if city == selection {
                        Label(city.title, systemImage: "checkmark")
                    } else {
                        Text(city.title)
                    }
                }
            }
        } label: {
            Image(systemName: "map")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(hasActiveSelection ? AppTheme.accentBlue : .primary)
                .frame(width: 46, height: 46)
                .contentShape(Rectangle())
                .modifier(ActivityStandaloneControlStyle(isStandalone: !useCombinedStyle))
        }
        .buttonStyle(.plain)
    }
}

private struct ActivityLeadingControls: View {
    @Binding var citySelection: ActivityCityFilter
    let cities: [ActivityCityFilter]
    let hasActiveCitySelection: Bool
    @Binding var selection: ActivityFeedFilter

    var body: some View {
        HStack(spacing: 0) {
            ActivityCityFilterDropdown(
                selection: $citySelection,
                cities: cities,
                hasActiveSelection: hasActiveCitySelection,
                useCombinedStyle: true
            )

            ActivityFilterDropdown(
                selection: $selection,
                useCombinedStyle: true
            )
        }
        .frame(height: 46)
        .clipShape(Capsule())
        .activityLiquidGlass(in: Capsule())
        .shadow(color: .black.opacity(0.12), radius: 14, x: 0, y: 8)
    }
}

private struct ActivityStandaloneControlStyle: ViewModifier {
    let isStandalone: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if isStandalone {
            content.activityLiquidGlass(in: Circle())
        } else {
            content
        }
    }
}

private struct ActivityFilterPill: View {
    let title: String

    var body: some View {
        HStack(spacing: 10) {
            Text(title)
                .font(.system(size: 15, weight: .semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.78)

            Image(systemName: "chevron.down")
                .font(.system(size: 12, weight: .semibold))
                .opacity(0.62)
        }
        .foregroundStyle(.primary)
        .padding(.horizontal, 15)
        .frame(height: 46)
        .fixedSize(horizontal: true, vertical: false)
        .contentShape(Capsule())
        .activityLiquidGlass(in: Capsule())
    }
}

private enum ActivityFeedFilter: String, CaseIterable, Identifiable {
    case upcoming
    case past
    case all

    var id: String { rawValue }

    var title: String {
        switch self {
        case .upcoming:
            return "Upcoming"
        case .past:
            return "Past"
        case .all:
            return "All"
        }
    }

    var emptyTitle: String {
        switch self {
        case .upcoming:
            return "No Upcoming Activity"
        case .past:
            return "No Past Activity"
        case .all:
            return "No Activity"
        }
    }

    var emptyMessage: String {
        switch self {
        case .upcoming:
            return "Upcoming friend activity will show up here."
        case .past:
            return "Past friend activity will show up here."
        case .all:
            return "Friend activity will show up here."
        }
    }

    func filtered(_ activities: [ActivityFeedItem]) -> [ActivityFeedItem] {
        switch self {
        case .upcoming:
            return activities.filter { activity in
                if activity.type == .friendRequestAccepted || activity.type == .partnerRequestAccepted {
                    return false
                }

                guard let event = activity.event else { return true }
                return event.startAt >= .now
            }
        case .past:
            return activities.filter { activity in
                if activity.type == .friendRequestAccepted || activity.type == .partnerRequestAccepted {
                    return true
                }

                guard let event = activity.event else { return false }
                return event.startAt < .now
            }
        case .all:
            return activities
        }
    }
}

private enum ActivityCityFilter: Hashable, Identifiable {
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

    func filtered(_ activities: [ActivityFeedItem]) -> [ActivityFeedItem] {
        switch self {
        case .all:
            return activities
        case .city(let city, let state):
            return activities.filter { activity in
                guard let event = activity.event else {
                    return true
                }

                return event.city.localizedCaseInsensitiveCompare(city) == .orderedSame &&
                    event.state.localizedCaseInsensitiveCompare(state) == .orderedSame
            }
        }
    }
}

private struct ActivitySummaryRow: View {
    let friendCount: Int
    let requestCount: Int

    var body: some View {
        HStack(spacing: 12) {
            ActivitySummaryPill(count: friendCount, label: "Friends")
            ActivitySummaryPill(count: requestCount, label: "Requests")
        }
    }
}

private struct ActivitySummaryPill: View {
    let count: Int
    let label: String

    var body: some View {
        HStack {
            (
                Text("\(count)")
                    .foregroundColor(.white)
                    .fontWeight(.medium)
                +
                Text(" \(label)")
                    .foregroundColor(.white.opacity(0.64))
            )
            .font(.system(size: 15, weight: .regular))

            Spacer(minLength: 8)

            Image(systemName: "chevron.right")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white.opacity(0.58))
        }
        .padding(.horizontal, 17)
        .frame(height: 52)
        .background(
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .fill(Color.white.opacity(0.09))
        )
    }
}

private struct ActivitySectionView: View {
    let section: ActivitySection
    let onRespondToRequest: (ActivityFeedItem, ActivityRequestResponse) async -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(section.title)
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 16)

            VStack(alignment: .leading, spacing: 16) {
                ForEach(section.activities) { activity in
                    ActivityRowView(
                        activity: activity,
                        onRespondToRequest: onRespondToRequest
                    )
                }
            }
            .padding(.horizontal, 16)
        }
    }
}

private struct ActivityRowView: View {
    let activity: ActivityFeedItem
    let onRespondToRequest: (ActivityFeedItem, ActivityRequestResponse) async -> Void
    @EnvironmentObject private var requestStore: ActivityRequestStore
    @State private var selectedEvent: EventFeedItem?
    @State private var selectedVenue: PlaceListItem?
    @State private var selectedUserProfile: SelectedUserProfile?
    @State private var isSubmittingResponse = false

    private static let relativeFormatter: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        return formatter
    }()

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ActivityAvatarView(activity: activity)
                .padding(.top, 6)

            if activity.type.isRequest {
                requestContent
            } else {
                VStack(alignment: .leading, spacing: 4) {
                    InlineLinkedActivityText(
                        activity: activity,
                        onTapEvent: {
                            if let event = activity.event?.eventFeedItem {
                                selectedEvent = event
                            }
                        },
                        onTapVenue: { venue in
                            selectedVenue = venue
                        },
                        onTapUser: { userID in
                            selectedUserProfile = SelectedUserProfile(id: userID)
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
        .navigationDestination(item: $selectedEvent) { event in
            EventDetailView(event: event)
        }
        .navigationDestination(item: $selectedVenue) { venue in
            PlaceDetailView(place: venue)
        }
        .navigationDestination(item: $selectedUserProfile) { selection in
            UserProfileView(userID: selection.id)
        }
    }

    private var requestContent: some View {
        HStack(alignment: .top, spacing: 14) {
            VStack(alignment: .leading, spacing: 4) {
                requestText
                    .font(.system(size: 14))
                    .lineSpacing(3)
                    .onTapGesture {
                        if requestStore.response(for: activity.id) == nil {
                            selectedUserProfile = SelectedUserProfile(id: activity.actorUserID)
                        }
                    }

                Text(
                    Self.relativeFormatter
                        .localizedString(for: activity.timestamp, relativeTo: .now)
                        .capitalizingRelativeAgo()
                )
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.white.opacity(0.42))
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            if activity.type.isActionableRequest && requestStore.response(for: activity.id) == nil {
                HStack(spacing: 10) {
                    Button {
                        submit(.decline)
                    } label: {
                        Image(systemName: "xmark")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(.white.opacity(0.75))
                            .frame(width: 36, height: 36)
                            .background(Circle().fill(Color.white.opacity(0.1)))
                    }
                    .disabled(isSubmittingResponse)

                    Button {
                        submit(.accept)
                    } label: {
                        Image(systemName: "checkmark")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: 42, height: 42)
                            .background(Circle().fill(AppTheme.accentBlue))
                    }
                    .disabled(isSubmittingResponse)
                }
                .opacity(isSubmittingResponse ? 0.5 : 1)
            }
        }
    }

    @ViewBuilder
    private var requestText: some View {
        let requestType = activity.type == .partnerRequestReceived ? "partner" : "friend"
        if let settled = requestStore.response(for: activity.id) {
            let verb = settled == .accept ? "accepted" : "declined"
            (
                Text("You \(verb) a \(requestType) request from ")
                .foregroundColor(.white.opacity(0.62))
                + Text(activity.actorName)
                .fontWeight(.medium)
                .foregroundColor(.white.opacity(0.62))
                + Text(".")
                .foregroundColor(.white.opacity(0.62))
            )
        } else if activity.type == .friendRequestAccepted || activity.type == .partnerRequestAccepted {
            let acceptedType = activity.type == .partnerRequestAccepted ? "partner" : "friend"
            (
                Text("You accepted a \(acceptedType) request from ")
                .foregroundColor(.white.opacity(0.62))
                + Text(activity.actorName)
                .fontWeight(.medium)
                .foregroundColor(.white.opacity(0.62))
                + Text(".")
                .foregroundColor(.white.opacity(0.62))
            )
        } else {
            (
                Text(activity.actorName)
                .fontWeight(.medium)
                .foregroundColor(.white)
                + Text(" sent you a \(requestType) request.")
                .foregroundColor(.white.opacity(0.62))
            )
        }
    }

    private func submit(_ response: ActivityRequestResponse) {
        guard !isSubmittingResponse else { return }

        isSubmittingResponse = true
        Task {
            await onRespondToRequest(activity, response)
            requestStore.record(response, for: activity.id)
            isSubmittingResponse = false
        }
    }

}

private struct SelectedUserProfile: Identifiable, Hashable {
    let id: String
}

struct InlineLinkedActivityText: UIViewRepresentable {
    let activity: ActivityFeedItem
    let onTapEvent: () -> Void
    let onTapVenue: (PlaceListItem) -> Void
    let onTapUser: (String) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> UITextView {
        let textView = UITextView()
        textView.backgroundColor = .clear
        textView.isEditable = false
        textView.isScrollEnabled = false
        textView.textContainerInset = .zero
        textView.textContainer.lineFragmentPadding = 0
        textView.delegate = context.coordinator
        textView.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        textView.linkTextAttributes = [
            .foregroundColor: UIColor.white,
            .underlineStyle: 0,
        ]
        return textView
    }

    func updateUIView(_ textView: UITextView, context: Context) {
        context.coordinator.parent = self
        textView.attributedText = attributedText(image: context.coordinator.cachedImage)

        guard let event = activity.event else {
            context.coordinator.imageURL = nil
            context.coordinator.cachedImage = nil
            context.coordinator.task?.cancel()
            return
        }

        guard context.coordinator.imageURL != event.coverImageURL else {
            return
        }

        context.coordinator.imageURL = event.coverImageURL
        context.coordinator.cachedImage = nil
        context.coordinator.task?.cancel()
        textView.attributedText = attributedText(image: nil)

        guard let url = event.coverImageURL else {
            return
        }

        context.coordinator.task = URLSession.shared.dataTask(with: url) { data, _, _ in
            guard let data, let image = UIImage(data: data) else {
                return
            }

            DispatchQueue.main.async {
                guard context.coordinator.imageURL == url else {
                    return
                }

                context.coordinator.cachedImage = image
                textView.attributedText = attributedText(image: image)
            }
        }
        context.coordinator.task?.resume()
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        let width = proposal.width ?? UIScreen.main.bounds.width - 100
        let size = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        return CGSize(width: width, height: size.height)
    }

    private func attributedText(image: UIImage?) -> NSAttributedString {
        let font = UIFont.systemFont(ofSize: 14, weight: .regular)
        let mediumFont = UIFont.systemFont(ofSize: 14, weight: .medium)
        let mutedColor = UIColor.white.withAlphaComponent(0.62)
        let text = NSMutableAttributedString()
        guard let event = activity.event else {
            return text
        }

        if let partnerFirstName = activity.partnerFirstName {
            text.append(linkedNameText(actorDisplayName, userID: activity.actorUserID, font: mediumFont))
            text.append(
                NSAttributedString(
                    string: " and ",
                    attributes: [.font: font, .foregroundColor: mutedColor]
                )
            )

            if let partnerUserID = activity.partnerUserID {
                text.append(linkedNameText(partnerFirstName, userID: partnerUserID, font: mediumFont))
            } else {
                text.append(
                    NSAttributedString(
                        string: partnerFirstName,
                        attributes: [.font: mediumFont, .foregroundColor: UIColor.white]
                    )
                )
            }
        } else {
            text.append(linkedNameText(activity.actorName, userID: activity.actorUserID, font: mediumFont))
        }

        text.append(
            NSAttributedString(
                string: " \(actionPhrase) \u{2009}",
                attributes: [.font: font, .foregroundColor: mutedColor]
            )
        )
        text.append(thumbnailAttachment(image: image))
        text.append(
            NSAttributedString(
                string: "\u{2009}\u{00a0}\(event.title)",
                attributes: [
                    .font: mediumFont,
                    .foregroundColor: UIColor.white,
                    .link: URL(string: "wig-event://\(event.id.uuidString)")!,
                ]
            )
        )

        if let venue = event.venue {
            text.append(
                NSAttributedString(
                    string: " at ",
                    attributes: [.font: font, .foregroundColor: mutedColor]
                )
            )
            text.append(
                NSAttributedString(
                    string: venue.name,
                    attributes: [
                        .font: mediumFont,
                        .foregroundColor: UIColor.white,
                        .link: URL(string: "wig-venue://\(venue.slug)")!,
                    ]
                )
            )
        } else {
            text.append(
                NSAttributedString(
                    string: " at \(event.primaryLocation)",
                    attributes: [.font: font, .foregroundColor: mutedColor]
                )
            )
        }

        text.append(
            NSAttributedString(
                string: " on \(event.eventFeedItem.formattedStart(format: "MMM d"))",
                attributes: [.font: font, .foregroundColor: mutedColor]
            )
        )

        if activity.type == .rsvpNotGoing,
           let reasonPhrase = activity.notGoingReason?.activityPhrase
        {
            let reasonText = activity.partnerFirstName == nil
                ? "because \(activity.actorGender.contractedBe) \(reasonPhrase)"
                : "because they're \(reasonPhrase)"
            text.append(
                NSAttributedString(
                    string: " \(reasonText)",
                    attributes: [.font: font, .foregroundColor: mutedColor]
                )
            )
        }

        let paragraphStyle = NSMutableParagraphStyle()
        paragraphStyle.lineSpacing = 3
        paragraphStyle.lineBreakMode = .byWordWrapping
        text.addAttribute(.paragraphStyle, value: paragraphStyle, range: NSRange(location: 0, length: text.length))
        return text
    }

    private var actorDisplayName: String {
        activity.actorFirstName ?? activity.actorName.components(separatedBy: " ").first ?? activity.actorName
    }

    private func linkedNameText(_ name: String, userID: String, font: UIFont) -> NSAttributedString {
        NSAttributedString(
            string: name,
            attributes: [
                .font: font,
                .foregroundColor: UIColor.white,
                .link: URL(string: "wig-user://\(userID)")!,
            ]
        )
    }

    private func thumbnailAttachment(image: UIImage?) -> NSAttributedString {
        let attachment = NSTextAttachment()
        attachment.bounds = CGRect(x: 0, y: -4, width: 20, height: 20)
        attachment.image = image.map { Self.squareThumbnail(from: $0) } ?? Self.placeholderImage
        return NSAttributedString(attachment: attachment)
    }

    private static var placeholderImage: UIImage {
        UIGraphicsImageRenderer(size: CGSize(width: 20, height: 20)).image { context in
            UIColor.white.withAlphaComponent(0.12).setFill()
            UIBezierPath(roundedRect: CGRect(x: 0, y: 0, width: 20, height: 20), cornerRadius: 5).fill()
            context.cgContext.setStrokeColor(UIColor.white.withAlphaComponent(0.08).cgColor)
            context.cgContext.stroke(CGRect(x: 0.5, y: 0.5, width: 19, height: 19))
        }
    }

    private static func squareThumbnail(from image: UIImage) -> UIImage {
        UIGraphicsImageRenderer(size: CGSize(width: 22, height: 22)).image { _ in
            let side = min(image.size.width, image.size.height)
            let cropRect = CGRect(
                x: (image.size.width - side) / 2,
                y: (image.size.height - side) / 2,
                width: side,
                height: side
            )

            guard let cgImage = image.cgImage?.cropping(to: cropRect) else {
                image.draw(in: CGRect(x: 0, y: 0, width: 22, height: 22))
                return
            }

            UIBezierPath(roundedRect: CGRect(x: 0, y: 0, width: 22, height: 22), cornerRadius: 5).addClip()
            UIImage(cgImage: cgImage).draw(in: CGRect(x: 0, y: 0, width: 22, height: 22))
        }
    }

    private var actionPhrase: String {
        let isPluralSubject = activity.partnerFirstName != nil
        let eventStartAt = activity.event?.startAt ?? .distantFuture
        let isPastEvent = eventStartAt < .now

        switch activity.type {
        case .rsvpGoing:
            return isPastEvent
                ? "went to"
                : (isPluralSubject ? "are going to" : "is going to")
        case .rsvpInterested:
            return isPastEvent
                ? (isPluralSubject ? "were interested in" : "was interested in")
                : (isPluralSubject ? "are interested in" : "is interested in")
        case .rsvpNotGoing:
            return isPastEvent ? "couldn't go to" : "can't go to"
        case .friendRequestReceived,
             .partnerRequestReceived,
             .friendRequestAccepted,
             .partnerRequestAccepted:
            return ""
        }
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: InlineLinkedActivityText
        var imageURL: URL?
        var cachedImage: UIImage?
        var task: URLSessionDataTask?

        init(parent: InlineLinkedActivityText) {
            self.parent = parent
        }

        @available(iOS 17.0, *)
        func textView(
            _ textView: UITextView,
            primaryActionFor textItem: UITextItem,
            defaultAction: UIAction
        ) -> UIAction? {
            switch textItem.content {
            case .link(let url):
                switch url.scheme {
                case "wig-event":
                    return UIAction { [weak self] _ in
                        self?.parent.onTapEvent()
                    }
                case "wig-venue":
                    return UIAction { [weak self] _ in
                        guard let venue = self?.parent.activity.event?.venue else {
                            return
                        }

                        self?.parent.onTapVenue(venue)
                    }
                case "wig-user":
                    return UIAction { [weak self] _ in
                        guard let userID = url.host(percentEncoded: false), !userID.isEmpty else {
                            return
                        }

                        self?.parent.onTapUser(userID)
                    }
                default:
                    return defaultAction
                }
            default:
                return defaultAction
            }
        }

        deinit {
            task?.cancel()
        }
    }
}

struct ActivityAvatarView: View {
    let activity: ActivityFeedItem

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            avatar
                .frame(width: 44, height: 44)
                .clipShape(Circle())

            statusBadge
                .offset(x: 4, y: 4)
        }
    }

    @ViewBuilder
    private var avatar: some View {
        if let url = activity.actorAvatarImageURL {
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

    private var fallbackAvatar: some View {
        Circle()
            .fill(Color(red: 0.88, green: 0.68, blue: 0.46))
            .overlay {
                Text("}")
                    .font(.system(size: 22, weight: .bold))
                    .rotationEffect(.degrees(90))
                    .foregroundStyle(.black.opacity(0.84))
            }
    }

    private var statusBadge: some View {
        ZStack {
            Circle()
                .fill(Color(red: 0.05, green: 0.06, blue: 0.08))
                .frame(width: 24, height: 24)

            Image(systemName: badgeSystemImage)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(badgeColor)
        }
    }

    private var badgeSystemImage: String {
        switch activity.type {
        case .rsvpGoing:
            return "checkmark"
        case .rsvpInterested:
            return "star.fill"
        case .rsvpNotGoing:
            return "xmark"
        case .friendRequestReceived:
            return "person.badge.plus"
        case .partnerRequestReceived:
            return "heart.fill"
        case .friendRequestAccepted:
            return "person.badge.checkmark"
        case .partnerRequestAccepted:
            return "heart.circle.fill"
        }
    }

    private var badgeColor: Color {
        switch activity.type {
        case .rsvpGoing:
            return Color(red: 0.45, green: 0.76, blue: 1)
        case .rsvpInterested:
            return Color.yellow
        case .rsvpNotGoing:
            return Color.red
        case .friendRequestReceived:
            return AppTheme.accentBlue
        case .partnerRequestReceived:
            return Color(red: 1.0, green: 0.43, blue: 0.66)
        case .friendRequestAccepted:
            return Color(red: 0.45, green: 0.76, blue: 1)
        case .partnerRequestAccepted:
            return Color(red: 1.0, green: 0.43, blue: 0.66)
        }
    }
}

enum ActivityRequestResponse {
    case accept
    case decline
}

enum ActivityRequestButtonKind {
    case primary
    case secondary
}

struct ActivityRequestButtonModifier: ViewModifier {
    let kind: ActivityRequestButtonKind
    let isDisabled: Bool

    func body(content: Content) -> some View {
        content
            .font(.system(size: 13, weight: .semibold))
            .foregroundStyle(foregroundColor)
            .frame(height: 34)
            .frame(minWidth: 84)
            .padding(.horizontal, 14)
            .background(background)
            .overlay {
                Capsule(style: .continuous)
                    .strokeBorder(borderColor, lineWidth: 1)
            }
            .clipShape(Capsule(style: .continuous))
            .opacity(isDisabled ? 0.55 : 1)
    }

    private var foregroundColor: Color {
        switch kind {
        case .primary:
            return .white
        case .secondary:
            return .white.opacity(0.88)
        }
    }

    private var background: some View {
        Group {
            switch kind {
            case .primary:
                Capsule(style: .continuous)
                    .fill(AppTheme.accentBlue.opacity(isDisabled ? 0.45 : 0.92))
            case .secondary:
                Capsule(style: .continuous)
                    .fill(Color.white.opacity(0.08))
            }
        }
    }

    private var borderColor: Color {
        switch kind {
        case .primary:
            return AppTheme.accentBlue.opacity(0.18)
        case .secondary:
            return Color.white.opacity(0.1)
        }
    }
}

extension View {
    func activityRequestButtonStyle(
        kind: ActivityRequestButtonKind,
        isDisabled: Bool
    ) -> some View {
        modifier(ActivityRequestButtonModifier(kind: kind, isDisabled: isDisabled))
    }
}

private extension EventRSVPDeclineReason {
    var activityPhrase: String {
        switch self {
        case .busy:
            return "busy"
        case .outOfTown:
            return "out of town"
        case .working:
            return "working"
        case .layingLow:
            return "laying low"
        }
    }
}

private extension Optional where Wrapped == UserGender {
    var contractedBe: String {
        switch self {
        case .some(.male):
            return "he's"
        case .some(.female):
            return "she's"
        case .some(.other), .none:
            return "they're"
        }
    }
}

private struct ActivityEventThumbnail: View {
    let url: URL?

    var body: some View {
        Group {
            if let url {
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
        .frame(width: 24, height: 24)
        .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
    }

    private var placeholder: some View {
        RoundedRectangle(cornerRadius: 6, style: .continuous)
            .fill(Color.white.opacity(0.12))
    }
}

private struct ActivitySection: Identifiable {
    let id = UUID()
    let title: String
    var activities: [ActivityFeedItem]
}

#Preview {
    ActivityView()
}

private extension View {
    @ViewBuilder
    func activityLiquidGlass<S: InsettableShape>(in shape: S) -> some View {
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
}
