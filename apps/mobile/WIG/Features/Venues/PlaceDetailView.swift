import SwiftUI

struct PlaceDetailView: View {
    let place: PlaceListItem

    @Environment(\.apiClient) private var apiClient
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel = PlaceDetailViewModel()
    @State private var selectedTab: PlaceEventsTab = .upcoming

    private let eventCardWidth: CGFloat = 220

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                switch viewModel.state {
                case .idle, .loading:
                    PlaceDetailHeader(
                        name: place.name,
                        slug: place.slug,
                        type: place.type,
                        logoURL: place.displayLogoURL,
                        locationText: place.locationText.isEmpty ? nil : place.locationText,
                        categoryLabel: nil,
                        instagram: nil,
                        websiteText: nil
                    )

                    ProgressView("Loading events...")
                        .frame(maxWidth: .infinity, minHeight: 180)
                        .tint(.white)
                        .foregroundStyle(.white)

                case .failed(let message):
                    PlaceDetailHeader(
                        name: place.name,
                        slug: place.slug,
                        type: place.type,
                        logoURL: place.displayLogoURL,
                        locationText: place.locationText.isEmpty ? nil : place.locationText,
                        categoryLabel: nil,
                        instagram: nil,
                        websiteText: nil
                    )

                    ContentUnavailableView {
                        Label("Couldn’t Load Place", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text(message)
                    } actions: {
                        Button("Try Again") {
                            Task {
                                await viewModel.load(slug: place.slug, using: apiClient)
                            }
                        }
                    }
                    .foregroundStyle(.white)

                case .loaded(let detail):
                    PlaceDetailHeader(
                        name: detail.name,
                        slug: detail.slug,
                        type: detail.type,
                        logoURL: detail.displayLogoURL,
                        locationText: detail.locationText,
                        categoryLabel: detail.primaryCategoryLabel,
                        instagram: detail.instagram,
                        websiteText: detail.websiteDisplayText
                    )

                    actionControls

                    eventGroups(for: detail)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 18)
            .padding(.bottom, 104)
        }
        .background(placeBackground)
        .background(SwipeBackEnabler())
        .navigationBarBackButtonHidden()
        .toolbar(.hidden, for: .navigationBar)
        .overlay(alignment: .topLeading) {
            leadingTopControls
        }
        .overlay(alignment: .topTrailing) {
            PlaceDetailActionMenu()
                .padding(.trailing, 16)
                .padding(.top, 14)
        }
        .task {
            if case .idle = viewModel.state {
                await viewModel.load(slug: place.slug, using: apiClient)
            }
        }
    }

    private var actionControls: some View {
        Button {} label: {
            Text("Follow")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 50)
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .strokeBorder(Color(red: 0.48, green: 0.77, blue: 1.0), lineWidth: 1.4)
                )
        }
        .buttonStyle(.plain)
    }

    private var leadingTopControls: some View {
        HStack(spacing: 10) {
            FloatingGlassIconButton(systemImage: "chevron.left") {
                dismiss()
            }

            if canShowEventFilter {
                PlaceEventFilterDropdown(selection: $selectedTab)
            }
        }
        .padding(.leading, 16)
        .padding(.top, 14)
    }

    private struct PlaceDetailActionMenu: View {
        var body: some View {
            Menu {
                Button {} label: {
                    Label("Edit Venue", systemImage: "building.2")
                }

                Button {} label: {
                    Label("Create Event", systemImage: "calendar.badge.plus")
                }

                Button {} label: {
                    Label("Create Event Series", systemImage: "calendar.badge.clock")
                }
            } label: {
                Image(systemName: "ellipsis")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.primary)
                    .frame(width: 44, height: 44)
                    .contentShape(Circle())
                    .placeDetailLiquidGlass(in: Circle())
            }
            .buttonStyle(.plain)
        }
    }

    private var canShowEventFilter: Bool {
        guard case .loaded(let detail) = viewModel.state else {
            return false
        }

        return !detail.pastEvents.isEmpty
    }

    private struct PlaceEventFilterDropdown: View {
        @Binding var selection: PlaceEventsTab

        var body: some View {
            Menu {
                ForEach(PlaceEventsTab.allCases) { tab in
                    Button {
                        withAnimation(.snappy(duration: 0.22)) {
                            selection = tab
                        }
                    } label: {
                        if tab == selection {
                            Label(tab.title, systemImage: "checkmark")
                        } else {
                            Text(tab.title)
                        }
                    }
                }
            } label: {
                PlaceEventFilterPill(title: selection.title)
            }
            .buttonStyle(.plain)
        }
    }

    private struct PlaceEventFilterPill: View {
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
            .frame(height: 44)
            .fixedSize(horizontal: true, vertical: false)
            .contentShape(Capsule())
            .placeDetailLiquidGlass(in: Capsule())
        }
    }

    @ViewBuilder
    private func eventGroups(for detail: PlaceDetail) -> some View {
        let events = selectedTab == .upcoming ? detail.events : detail.pastEvents
        let groups = PlaceEventGrouper.groups(for: events, mode: selectedTab)

        if groups.isEmpty {
            ContentUnavailableView {
                Label("No Events", systemImage: "calendar")
            } description: {
                Text("There aren’t any \(selectedTab.emptyStateName) events for this place yet.")
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 220)
        } else {
            ForEach(groups) { group in
                VStack(alignment: .leading, spacing: 14) {
                    Text(group.label)
                        .font(.system(size: 20, weight: .bold))
                        .foregroundStyle(.white)
                        .padding(.horizontal, 16)

                    ScrollView(.horizontal) {
                        LazyHStack(alignment: .top, spacing: 12) {
                            ForEach(group.events) { event in
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
                .padding(.horizontal, -16)
            }
        }
    }

    private var placeBackground: some View {
        Color(red: 0.07, green: 0.07, blue: 0.08)
            .ignoresSafeArea()
    }
}

private struct PlaceDetailHeader: View {
    let name: String
    let slug: String
    let type: PlaceListItem.PlaceType
    let logoURL: URL?
    let locationText: String?
    let categoryLabel: String?
    let instagram: String?
    let websiteText: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top, spacing: 14) {
                logo

                VStack(alignment: .leading, spacing: 7) {
                    Text(name)
                        .font(.system(size: 24, weight: .bold))
                        .foregroundStyle(.white)
                        .lineLimit(2)
                        .minimumScaleFactor(0.72)

                    Text("@\(slug)")
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(.white.opacity(0.62))

                    if let categoryLabel {
                        Text(categoryLabel)
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.78))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .background(Color.white.opacity(0.10), in: Capsule())
                    }
                }
            }
            .padding(.top, 64)

            VStack(alignment: .leading, spacing: 12) {
                if let locationText {
                    Label(locationText, systemImage: "mappin.circle")
                }

                HStack(spacing: 16) {
                    if let instagram, !instagram.isEmpty {
                        Label("@\(instagram)", systemImage: "camera")
                    }

                    if let websiteText {
                        Label(websiteText, systemImage: "globe")
                    }
                }
            }
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(.white.opacity(0.62))
            .lineLimit(1)
        }
    }

    @ViewBuilder
    private var logo: some View {
        if let logoURL {
            AsyncImage(url: logoURL) { phase in
                switch phase {
                case .empty:
                    logoPlaceholder
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFill()
                case .failure:
                    logoPlaceholder
                @unknown default:
                    logoPlaceholder
                }
            }
            .frame(width: 92, height: 92)
            .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        } else {
            logoPlaceholder
                .frame(width: 92, height: 92)
        }
    }

    private var logoPlaceholder: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color(red: 0.14, green: 0.14, blue: 0.16))

            Image(systemName: type == .venue ? "building.2" : "sparkles")
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(.white.opacity(0.70))
        }
    }
}

private enum PlaceEventsTab: CaseIterable, Identifiable {
    case upcoming
    case past

    var id: Self { self }

    var title: String {
        switch self {
        case .upcoming:
            return "Upcoming Events"
        case .past:
            return "Past Events"
        }
    }

    var emptyStateName: String {
        switch self {
        case .upcoming:
            return "upcoming"
        case .past:
            return "past"
        }
    }
}

private struct PlaceEventGroup: Identifiable {
    let label: String
    var events: [EventFeedItem]

    var id: String { label }
}

private enum PlaceEventGrouper {
    static func groups(for events: [EventFeedItem], mode: PlaceEventsTab) -> [PlaceEventGroup] {
        let sortedEvents = events.sorted {
            mode == .past ? $0.startAt > $1.startAt : $0.startAt < $1.startAt
        }

        return sortedEvents.reduce(into: [PlaceEventGroup]()) { groups, event in
            let label = label(for: event.startAt, mode: mode)

            if let lastIndex = groups.indices.last, groups[lastIndex].label == label {
                groups[lastIndex].events.append(event)
            } else {
                groups.append(PlaceEventGroup(label: label, events: [event]))
            }
        }
    }

    private static func label(for date: Date, mode: PlaceEventsTab) -> String {
        let calendar = Calendar.current
        let now = Date()
        let currentWeekStart = calendar.dateInterval(of: .weekOfYear, for: now)?.start ?? now
        let eventWeekStart = calendar.dateInterval(of: .weekOfYear, for: date)?.start ?? date
        let currentMonthStart = calendar.dateInterval(of: .month, for: now)?.start ?? now
        let eventMonthStart = calendar.dateInterval(of: .month, for: date)?.start ?? date

        let weekDifference = calendar.dateComponents(
            [.weekOfYear],
            from: currentWeekStart,
            to: eventWeekStart
        ).weekOfYear ?? 0
        let monthDifference = calendar.dateComponents(
            [.month],
            from: currentMonthStart,
            to: eventMonthStart
        ).month ?? 0
        let weeksFromNow = abs(weekDifference)
        let monthsFromNow = abs(monthDifference)

        if weeksFromNow <= 3 {
            return mode == .past
                ? pastWeekLabel(weeksAgo: weeksFromNow)
                : weekLabel(weeksAway: weeksFromNow)
        }

        return mode == .past
            ? pastMonthLabel(monthsAgo: monthsFromNow)
            : monthLabel(monthsAway: monthsFromNow)
    }

    private static func weekLabel(weeksAway: Int) -> String {
        if weeksAway <= 0 { return "This Week" }
        if weeksAway == 1 { return "Next Week" }
        return "In \(weeksAway) Weeks"
    }

    private static func monthLabel(monthsAway: Int) -> String {
        if monthsAway <= 1 { return "Next Month" }
        return "In \(monthsAway) Months"
    }

    private static func pastWeekLabel(weeksAgo: Int) -> String {
        if weeksAgo <= 1 { return "Last Week" }
        return "\(weeksAgo) Weeks Ago"
    }

    private static func pastMonthLabel(monthsAgo: Int) -> String {
        if monthsAgo <= 1 { return "Last Month" }
        return "\(monthsAgo) Months Ago"
    }
}

#Preview {
    PlaceDetailView(
        place: PlaceListItem(
            id: UUID(),
            type: .venue,
            slug: "big-night-live",
            name: "Big Night Live",
            logoImageURL: nil,
            city: "Boston",
            state: "MA",
            upcomingEventCount: 48,
            updatedAt: nil
        )
    )
}

private extension View {
    @ViewBuilder
    func placeDetailLiquidGlass<S: InsettableShape>(in shape: S) -> some View {
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
