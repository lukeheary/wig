import ClerkKit
import SafariServices
import SwiftUI
import UIKit

struct PlaceDetailView: View {
    let place: PlaceListItem
    var onDismiss: (() -> Void)? = nil

    @Environment(\.apiClient) private var apiClient
    @Environment(\.dismiss) private var dismiss
    @Environment(Clerk.self) private var clerk
    @EnvironmentObject private var appSession: AppSession
    @StateObject private var viewModel = PlaceDetailViewModel()
    @State private var selectedTab: PlaceEventsTab = .upcoming
    @State private var isManagePlaceActive = false
    @State private var managePlaceDetail: PlaceDetail?
    @State private var isUnfollowConfirmationPresented = false
    @State private var isHideFromHomeConfirmationPresented = false
    @State private var isLocationPopoverPresented = false
    @State private var presentedWebsite: PlaceWebsiteDestination?
    private let eventCardWidth: CGFloat = 220

    var body: some View {
        ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    switch viewModel.state {
                    case .idle, .loading:
                        let seededDetail = seededDetailState

                        VStack(spacing: 12) {
                            PlaceDetailHeader(
                                slug: seededDetail.slug,
                                name: seededDetail.name,
                                type: seededDetail.type,
                                logoURL: seededDetail.displayLogoURL,
                                cityStateText: seededDetail.cityStateText,
                                followerCount: seededDetail.followerCount,
                                memberCount: seededDetail.memberCount,
                                upcomingEventCount: place.upcomingEventCount
                            )

                            if isAuthenticated {
                                placeFollowProfileButton(for: seededDetail)
                                    .padding(.top, 8)
                                    .allowsHitTesting(false)
                            }
                        }
                        .padding(.bottom, 8)

                        PlaceDetailEventLoadingSection()

                    case .failed(let message):
                        let seededDetail = seededDetailState

                        VStack(spacing: 12) {
                            PlaceDetailHeader(
                                slug: seededDetail.slug,
                                name: seededDetail.name,
                                type: seededDetail.type,
                                logoURL: seededDetail.displayLogoURL,
                                cityStateText: seededDetail.cityStateText,
                                followerCount: seededDetail.followerCount,
                                memberCount: seededDetail.memberCount,
                                upcomingEventCount: place.upcomingEventCount
                            )

                            if isAuthenticated {
                                placeFollowProfileButton(for: seededDetail)
                                    .padding(.top, 8)
                                    .allowsHitTesting(false)
                            }
                        }
                        .padding(.bottom, 8)

                        ContentUnavailableView {
                            Label("Couldn’t Load Place", systemImage: "wifi.exclamationmark")
                        } description: {
                            Text(message)
                        } actions: {
                            Button("Try Again") {
                                Task {
                                    await viewModel.load(
                                        slug: place.slug,
                                        using: apiClient
                                    )
                                }
                            }
                        }
                        .foregroundStyle(.white)

                    case .loaded(let detail):
                        VStack(spacing: 12) {
                            PlaceDetailHeader(
                                slug: detail.slug,
                                name: detail.name,
                                type: detail.type,
                                logoURL: detail.displayLogoURL,
                                cityStateText: detail.cityStateText,
                                followerCount: detail.followerCount,
                                memberCount: detail.memberCount,
                                upcomingEventCount: detail.events.count
                            )

                            if isAuthenticated {
                                placeFollowProfileButton(for: detail)
                                    .padding(.top, 8)
                            }
                        }
                        .padding(.bottom, 8)

                        eventGroups(for: detail)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 74)
                .padding(.bottom, 32)
                .frame(maxWidth: .infinity, alignment: .topLeading)
        }
        .background(AppTheme.background.ignoresSafeArea())
        .background {
            // When embedded over an event, UIKit's native pop gesture targets the
            // event presentation underneath this page. The host supplies a local
            // edge swipe instead.
            if onDismiss == nil {
                SwipeBackEnabler()
            }
        }
        .navigationBarBackButtonHidden()
        .toolbar(.hidden, for: .navigationBar)
        .overlay(alignment: .topLeading) {
            leadingTopControls
        }
        .overlay(alignment: .topTrailing) {
            if case .loaded(let detail) = viewModel.state {
                placeActionsMenu(for: detail)
                    .padding(.trailing, 16)
                    .padding(.top, 0)
            }
        }
        .alert(unfollowAlertTitle, isPresented: $isUnfollowConfirmationPresented) {
            if case .loaded(let detail) = viewModel.state {
                Button("Unfollow", role: .destructive) {
                    UIImpactFeedbackGenerator(style: .heavy).impactOccurred()

                    Task {
                        await viewModel.setFollowed(
                            false,
                            slug: detail.slug,
                            using: apiClient
                        )
                    }
                }
            }

            Button("Cancel", role: .cancel) {}
        }
        .alert(hideFromHomeAlertTitle, isPresented: $isHideFromHomeConfirmationPresented) {
            if case .loaded(let detail) = viewModel.state {
                Button("Hide", role: .destructive) {
                    UIImpactFeedbackGenerator(style: .heavy).impactOccurred()

                    Task {
                        await viewModel.setHiddenFromHome(
                            true,
                            slug: detail.slug,
                            using: apiClient
                        )
                    }
                }
            }

            Button("Cancel", role: .cancel) {}
        } message: {
            Text(hideFromHomeAlertMessage)
        }
        .alert("Couldn’t Update Home", isPresented: homeVisibilityErrorBinding) {
            Button("OK") {
                viewModel.clearHomeVisibilityError()
            }
        } message: {
            Text(viewModel.homeVisibilityErrorMessage ?? "Please try again.")
        }
        .navigationDestination(isPresented: $isManagePlaceActive) {
            if let detail = managePlaceDetail {
                ManagePlaceView(
                    placeSlug: detail.slug,
                    placeName: detail.name,
                    placeDetail: detail,
                    onPlaceDeleted: { dismiss() }
                )
            }
        }
        .sheet(item: $presentedWebsite) { destination in
            PlaceWebsiteBrowser(url: destination.url)
                .ignoresSafeArea()
        }
        .task {
            if case .idle = viewModel.state {
                await viewModel.load(
                    slug: place.slug,
                    using: apiClient
                )
            }
        }
        .task(id: placeEventPrefetchKey) {
            guard case .loaded(let detail) = viewModel.state else {
                return
            }

            await EventArtworkPrefetcher.prefetch(
                events: detail.events + detail.pastEvents
            )
        }
        .onReceive(NotificationCenter.default.publisher(for: .mobileEventDidChange)) { _ in
            Task {
                PlaceDetailViewModel.invalidateCache(for: place.slug)
                await viewModel.load(slug: place.slug, using: apiClient, forceRefresh: true)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .appDataDidChange)) { _ in
            guard !viewModel.isUpdatingFollow else {
                return
            }

            Task {
                PlaceDetailViewModel.invalidateCache(for: place.slug)
                await viewModel.load(slug: place.slug, using: apiClient, forceRefresh: true)
            }
        }
    }

    private var leadingTopControls: some View {
        HStack(spacing: 10) {
            FloatingGlassIconButton(systemImage: "chevron.left") {
                closePlaceDetail()
            }

            if canShowEventFilter {
                PlaceEventFilterDropdown(selection: $selectedTab)
            }
        }
        .padding(.leading, 16)
        .padding(.top, 0)
    }

    private func closePlaceDetail() {
        if let onDismiss {
            onDismiss()
        } else {
            dismiss()
        }
    }

    private var seededDetailState: PlaceDetail {
        if let cachedDetail = PlaceDetailViewModel.cachedDetail(for: place.slug) {
            return cachedDetail
        }

        return PlaceDetail(listItem: place)
    }

    private var canShowEventFilter: Bool {
        guard case .loaded(let detail) = viewModel.state else {
            return false
        }

        return !detail.pastEvents.isEmpty
    }

    private var isAuthenticated: Bool {
        clerk.user != nil
    }

    private var homeVisibilityErrorBinding: Binding<Bool> {
        Binding(
            get: { viewModel.homeVisibilityErrorMessage != nil },
            set: { isPresented in
                if !isPresented {
                    viewModel.clearHomeVisibilityError()
                }
            }
        )
    }

    private var placeEventPrefetchKey: String {
        guard case .loaded(let detail) = viewModel.state else {
            return "idle"
        }

        return (detail.events + detail.pastEvents)
            .map(\.id.uuidString)
            .joined(separator: ",")
    }

    private var unfollowAlertTitle: String {
        if case .loaded(let detail) = viewModel.state {
            return "Are you sure you want to unfollow \(detail.name)?"
        }

        return "Are you sure you want to unfollow \(place.name)?"
    }

    private var hideFromHomeAlertTitle: String {
        if case .loaded(let detail) = viewModel.state {
            return "Hide events from \(detail.name)?"
        }

        return "Hide events from \(place.name)?"
    }

    private var hideFromHomeAlertMessage: String {
        if case .loaded(let detail) = viewModel.state {
            return "Events from \(detail.name) will no longer appear on Home."
        }

        return "Events from \(place.name) will no longer appear on Home."
    }

    private func placeActionsMenu(for detail: PlaceDetail) -> some View {
        let locationText = detail.locationText
        let website = detail.website
        let instagramURL = instagramURL(for: detail.instagram)

        return HStack(spacing: 0) {
            if detail.type == .venue {
                Button {
                    guard locationText != nil else { return }
                    isLocationPopoverPresented = true
                } label: {
                    placeActionIcon("location", isAvailable: locationText != nil)
                }
                .buttonStyle(.plain)
                .disabled(locationText == nil)
                .accessibilityLabel("Show address")
                .popover(
                    isPresented: $isLocationPopoverPresented,
                    attachmentAnchor: .rect(.bounds),
                    arrowEdge: .top
                ) {
                    if let locationText {
                        PlaceLocationPopover(location: locationText) {
                            openInMaps(locationText)
                            isLocationPopoverPresented = false
                        }
                    }
                }
            }

            Button {
                guard let website else { return }
                presentedWebsite = PlaceWebsiteDestination(url: website)
            } label: {
                placeActionIcon("globe", isAvailable: website != nil)
            }
            .buttonStyle(.plain)
            .disabled(website == nil)
            .accessibilityLabel("Open website")

            Button {
                guard let instagramURL else { return }
                UIApplication.shared.open(instagramURL)
            } label: {
                placeInstagramActionIcon(isAvailable: instagramURL != nil)
            }
            .buttonStyle(.plain)
            .disabled(instagramURL == nil)
            .accessibilityLabel("Open Instagram")

            placeOverflowMenu(for: detail)
        }
        .frame(height: 46)
        .clipShape(Capsule())
        .placeDetailLiquidGlass(in: Capsule())
    }

    private func placeActionIcon(_ systemName: String, isAvailable: Bool) -> some View {
        Image(systemName: systemName)
            .font(.system(size: 18, weight: .semibold))
            .foregroundStyle(isAvailable ? .white : .white.opacity(0.32))
            .frame(width: 46, height: 46)
            .contentShape(Rectangle())
            .accessibilityHidden(true)
    }

    private func placeInstagramActionIcon(isAvailable: Bool) -> some View {
        InstagramGlyph()
            .opacity(isAvailable ? 1 : 0.32)
            .frame(width: 46, height: 46)
            .contentShape(Rectangle())
            .accessibilityHidden(true)
    }

    private func placeOverflowMenu(for detail: PlaceDetail) -> some View {
        Menu {
            if appSession.isAdmin {
                Button {
                    managePlaceDetail = detail
                    isManagePlaceActive = true
                } label: {
                    Label("Manage Place", systemImage: "slider.horizontal.3")
                        .foregroundStyle(.white)
                }
                .tint(.white)
            }

            if isAuthenticated {
                if detail.isHiddenFromHome {
                    Button {
                        UIImpactFeedbackGenerator(style: .medium).impactOccurred()

                        Task {
                            await viewModel.setHiddenFromHome(
                                false,
                                slug: detail.slug,
                                using: apiClient
                            )
                        }
                    } label: {
                        Label("Show Events on Home", systemImage: "eye")
                            .foregroundStyle(.white)
                    }
                    .tint(.white)
                } else {
                    Button {
                        isHideFromHomeConfirmationPresented = true
                    } label: {
                        Label("Hide Events from Home", systemImage: "eye.slash")
                            .foregroundStyle(.white)
                    }
                    .tint(.white)
                }

            }
        } label: {
            placeActionIcon("ellipsis", isAvailable: true)
                .accessibilityHidden(false)
        }
        .buttonStyle(.plain)
        .disabled(viewModel.isUpdatingFollow || viewModel.isUpdatingHomeVisibility)
        .accessibilityLabel("More place actions")
    }

    private func openInMaps(_ location: String) {
        guard let encodedLocation = location.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let url = URL(string: "http://maps.apple.com/?q=\(encodedLocation)")
        else {
            return
        }

        UIApplication.shared.open(url)
    }

    private func instagramURL(for handle: String?) -> URL? {
        guard let handle else {
            return nil
        }

        let cleanedHandle = handle
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "@", with: "")

        guard !cleanedHandle.isEmpty else {
            return nil
        }

        return URL(string: "instagram://user?username=\(cleanedHandle)")
            ?? URL(string: "https://www.instagram.com/\(cleanedHandle)")
    }

    private func placeFollowProfileButton(for detail: PlaceDetail) -> some View {
        Button {
            if detail.isFollowed {
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                isUnfollowConfirmationPresented = true
            } else {
                Task {
                    let didFollow = await viewModel.setFollowed(
                        true,
                        slug: detail.slug,
                        using: apiClient
                    )

                    if didFollow {
                        ConfirmationHaptic.play()
                    }
                }
            }
        }
        label: {
            Text(detail.isFollowed ? "Following" : "Follow")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(detail.isFollowed ? .white : .black)
                .frame(maxWidth: .infinity)
                .frame(height: 40)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(detail.isFollowed ? Color.white.opacity(0.08) : AppTheme.accentBlue)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .strokeBorder(.white.opacity(detail.isFollowed ? 0.08 : 0), lineWidth: 1)
                )
        }
        .buttonStyle(.plain)
        .disabled(viewModel.isUpdatingFollow)
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
                PlaceEventFilterIcon(isActive: selection != .upcoming)
            }
            .buttonStyle(.plain)
        }
    }

    private struct PlaceEventFilterIcon: View {
        let isActive: Bool

        var body: some View {
            Image(systemName: "line.3.horizontal.decrease")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(isActive ? AppTheme.accentBlue : .primary)
                .frame(width: 46, height: 46)
                .contentShape(Circle())
                .placeDetailLiquidGlass(in: Circle())
        }
    }

    @ViewBuilder
    private func eventGroups(for detail: PlaceDetail) -> some View {
        let displayWindow = EventFeedDisplayWindow.partition(
            upcoming: detail.events,
            past: detail.pastEvents
        )
        let events = selectedTab == .upcoming ? displayWindow.upcoming : displayWindow.past
        let groups = PlaceEventGrouper.groups(for: events, mode: selectedTab)

        if groups.isEmpty {
            ProfileEmptyEventsPlaceholder(
                message: "There aren’t any \(selectedTab.emptyStateName) events for this place yet."
            )
            .frame(maxWidth: .infinity, minHeight: 220)
        } else {
            VStack(alignment: .leading, spacing: 18) {
                ForEach(groups) { group in
                    EventCardCarousel(
                        events: group.events,
                        cardWidth: eventCardWidth,
                        verticalSpacing: 14
                    ) {
                        Text(group.label)
                            .font(.system(size: 20, weight: .bold))
                            .foregroundStyle(.white)
                    } card: { event in
                        EventDetailNavigationLink(event: event) {
                            EventCardView(event: event)
                        }
                    }
                    .padding(.horizontal, -16)
                }
            }
        }
    }

}

private struct PlaceDetailEventLoadingSection: View {
    var body: some View {
        NativeLoadingView()
            .frame(minHeight: 286)
    }
}

private struct PlaceDetailHeader: View {
    let slug: String
    let name: String
    let type: PlaceListItem.PlaceType
    let logoURL: URL?
    let cityStateText: String?
    let followerCount: Int
    let memberCount: Int
    let upcomingEventCount: Int
    @State private var isImageViewerPresented = false

    var body: some View {
        HStack(alignment: .bottom, spacing: 20) {
            logo

            VStack(alignment: .leading, spacing: 14) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(name)
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(.white)
                        .lineLimit(2)
                        .minimumScaleFactor(0.76)
                        .multilineTextAlignment(.leading)

                    if let cityStateText {
                        Text(cityStateText)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(.white.opacity(0.58))
                            .lineLimit(1)
                            .minimumScaleFactor(0.78)
                    }
                }

                HStack(spacing: 24) {
                    PlaceDetailStat(count: upcomingEventCount, label: "Upcoming")

                    NavigationLink {
                        PlaceFollowersView(slug: slug)
                    } label: {
                        PlaceDetailStat(count: followerCount, label: "Followers")
                    }
                    .buttonStyle(.plain)

                    NavigationLink {
                        PlaceMembersView(slug: slug)
                    } label: {
                        PlaceDetailStat(count: memberCount, label: "Members")
                    }
                    .buttonStyle(.plain)
                }
            }
            .frame(maxWidth: .infinity, minHeight: 104, alignment: .bottomLeading)
        }
        .frame(maxWidth: .infinity)
        .fullScreenCover(isPresented: $isImageViewerPresented) {
            if let logoURL {
                EventArtworkViewer(imageURL: logoURL)
            }
        }
    }

    @ViewBuilder
    private var logo: some View {
        if let logoURL {
            Button {
                isImageViewerPresented = true
            } label: {
                RemoteImageView(url: logoURL) { image in
                    image
                        .resizable()
                        .scaledToFill()
                } placeholder: {
                    logoPlaceholder
                }
                .frame(width: 104, height: 104)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(.white.opacity(0.08), lineWidth: 1)
                )
            }
            .buttonStyle(.plain)
        } else {
            logoPlaceholder
                .frame(width: 104, height: 104)
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(.white.opacity(0.08), lineWidth: 1)
                )
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

private struct PlaceDetailStat: View {
    let count: Int
    let label: String

    private var displayLabel: String {
        guard count == 1 else { return label }

        return switch label {
        case "Followers": "Follower"
        case "Members": "Member"
        default: label
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text("\(count)")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.white)

            Text(displayLabel)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.white.opacity(0.58))
                .lineLimit(1)
                .minimumScaleFactor(0.78)
        }
    }
}

private struct InstagramGlyph: View {
    private let side: CGFloat = 22

    var body: some View {
        let lineWidth = side * 0.09

        RoundedRectangle(cornerRadius: side * 0.28, style: .continuous)
            .strokeBorder(.white, lineWidth: lineWidth)
            .frame(width: side, height: side)
            .overlay {
                Circle()
                    .strokeBorder(.white, lineWidth: lineWidth)
                    .frame(width: side * 0.42, height: side * 0.42)
            }
            .overlay(alignment: .topTrailing) {
                Circle()
                    .fill(.white)
                    .frame(width: side * 0.10, height: side * 0.10)
                    .padding(.top, side * 0.23)
                    .padding(.trailing, side * 0.23)
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

// MARK: - Followers / Members List Views

private struct PlaceFollowersView: View {
    let slug: String

    @Environment(\.apiClient) private var apiClient
    @Environment(\.dismiss) private var dismiss
    @State private var followers: [FriendUserSummary] = []
    @State private var isLoading = true
    @State private var failed = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text("Followers")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(.white)

                if isLoading {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                } else if failed {
                    ContentUnavailableView("Couldn't Load Followers", systemImage: "wifi.exclamationmark")
                        .foregroundStyle(.white)
                } else if followers.isEmpty {
                    ContentUnavailableView("No Followers Yet", systemImage: "person.slash")
                        .foregroundStyle(.white)
                } else {
                    VStack(spacing: 2) {
                        ForEach(followers) { user in
                            NavigationLink {
                                UserProfileView(userID: user.id)
                            } label: {
                                CompactUserListRowView(
                                    imageURL: user.avatarImageURL,
                                    name: user.name,
                                    subtitle: user.usernameText,
                                    identityKey: user.id
                                )
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 74)
            .padding(.bottom, 32)
        }
        .background(AppTheme.background.ignoresSafeArea())
        .background(SwipeBackEnabler())
        .toolbar(.hidden, for: .navigationBar)
        .navigationBarBackButtonHidden()
        .overlay(alignment: .topLeading) {
            FloatingGlassIconButton(systemImage: "chevron.left") { dismiss() }
                .padding(.leading, 16)
        }
        .task {
            await load()
        }
    }

    private func load() async {
        isLoading = true
        failed = false
        do {
            let response = try await apiClient.send(APIClient.mobilePlaceFollowers(slug: slug))
            followers = response.followers
        } catch {
            failed = true
        }
        isLoading = false
    }
}

private struct PlaceMembersView: View {
    let slug: String

    @Environment(\.apiClient) private var apiClient
    @Environment(\.dismiss) private var dismiss
    @State private var members: [PlaceMemberListItem] = []
    @State private var isLoading = true
    @State private var failed = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                Text("Members")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(.white)

                if isLoading {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                } else if failed {
                    ContentUnavailableView("Couldn't Load Members", systemImage: "wifi.exclamationmark")
                        .foregroundStyle(.white)
                } else if members.isEmpty {
                    ContentUnavailableView("No Members Yet", systemImage: "person.slash")
                        .foregroundStyle(.white)
                } else {
                    VStack(spacing: 2) {
                        ForEach(members) { member in
                            NavigationLink {
                                UserProfileView(userID: member.id)
                            } label: {
                                CompactUserListRowView(
                                    imageURL: member.avatarImageURL,
                                    name: member.name,
                                    subtitle: "\(member.usernameText) · \(member.role.displayName)",
                                    identityKey: member.id
                                )
                                .frame(maxWidth: .infinity, alignment: .leading)
                                .contentShape(Rectangle())
                            }
                            .buttonStyle(.plain)
                        }
                    }
                    .frame(maxWidth: .infinity, alignment: .leading)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 74)
            .padding(.bottom, 32)
        }
        .background(AppTheme.background.ignoresSafeArea())
        .background(SwipeBackEnabler())
        .toolbar(.hidden, for: .navigationBar)
        .navigationBarBackButtonHidden()
        .overlay(alignment: .topLeading) {
            FloatingGlassIconButton(systemImage: "chevron.left") { dismiss() }
                .padding(.leading, 16)
        }
        .task {
            await load()
        }
    }

    private func load() async {
        isLoading = true
        failed = false
        do {
            let response = try await apiClient.send(APIClient.mobilePlaceMembers(slug: slug))
            members = response.members
        } catch {
            failed = true
        }
        isLoading = false
    }
}

// MARK: -

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
            let label = label(for: event, mode: mode)

            if let lastIndex = groups.indices.last, groups[lastIndex].label == label {
                groups[lastIndex].events.append(event)
            } else {
                groups.append(PlaceEventGroup(label: label, events: [event]))
            }
        }
    }

    private static func label(for event: EventFeedItem, mode: PlaceEventsTab) -> String {
        if mode == .upcoming, EventFeedDisplayWindow.isLastNight(event) {
            return "Last Night"
        }

        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = event.displayTimeZone
        calendar.firstWeekday = 2
        let now = Date()
        let currentWeekStart = calendar.dateInterval(of: .weekOfYear, for: now)?.start ?? now
        let eventWeekStart = calendar.dateInterval(of: .weekOfYear, for: event.startAt)?.start ?? event.startAt
        let currentMonthStart = calendar.dateInterval(of: .month, for: now)?.start ?? now
        let eventMonthStart = calendar.dateInterval(of: .month, for: event.startAt)?.start ?? event.startAt

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
            address: nil,
            city: "Boston",
            state: "MA",
            website: nil,
            instagram: nil,
            upcomingEventCount: 48,
            updatedAt: nil
        )
    )
}

private struct PlaceWebsiteDestination: Identifiable {
    let id = UUID()
    let url: URL
}

private struct PlaceLocationPopover: View {
    let location: String
    let onOpenInMaps: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            VStack(alignment: .leading, spacing: 6) {
                Text("Address")
                    .font(.system(size: 17, weight: .semibold))

                Text(location)
                    .font(.system(size: 15))
                    .foregroundStyle(.secondary)
            }

            Button(action: onOpenInMaps) {
                Text("Open in Maps")
                    .frame(maxWidth: .infinity)
                    .frame(height: 40)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.black)
                    .background(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(AppTheme.accentBlue)
                    )
                    .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .buttonStyle(.plain)
        }
        .padding(20)
        .frame(width: 260, alignment: .leading)
        .presentationCompactAdaptation(.popover)
    }
}

private struct PlaceWebsiteBrowser: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        SFSafariViewController(url: url)
    }

    func updateUIViewController(
        _ uiViewController: SFSafariViewController,
        context: Context
    ) {}
}

extension View {
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
