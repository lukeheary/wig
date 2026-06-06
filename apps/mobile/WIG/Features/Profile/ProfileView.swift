import ClerkKit
import PhotosUI
import SwiftUI
import UIKit

struct ProfileView: View {
    @Environment(Clerk.self) private var clerk
    @Environment(\.apiClient) private var apiClient
    @EnvironmentObject private var appSession: AppSession
    @StateObject private var viewModel = ProfileViewModel()
    @State private var selectedAvatarPhotoItem: PhotosPickerItem?
    @State private var isAvatarSourceDialogPresented = false
    @State private var isAvatarPhotoPickerPresented = false
    @State private var isAvatarCameraPresented = false
    @State private var selectedEventsTab: ProfileEventsTab = .upcoming

    var body: some View {
        NavigationStack {
            content
                .background(ProfileTheme.background.ignoresSafeArea())
                .toolbar(.hidden, for: .navigationBar)
                .task {
                    if case .idle = viewModel.state {
                        await viewModel.load(using: apiClient)
                    }
                }
                .refreshable {
                    await viewModel.load(using: apiClient)
                }
                .confirmationDialog(
                    "Update profile picture",
                    isPresented: $isAvatarSourceDialogPresented,
                    titleVisibility: .visible
                ) {
                    Button("Choose Photo") {
                        isAvatarPhotoPickerPresented = true
                    }

                    if UIImagePickerController.isSourceTypeAvailable(.camera) {
                        Button("Take Photo") {
                            isAvatarCameraPresented = true
                        }
                    }

                    Button("Cancel", role: .cancel) {}
                }
                .photosPicker(
                    isPresented: $isAvatarPhotoPickerPresented,
                    selection: $selectedAvatarPhotoItem,
                    matching: .images
                )
                .sheet(isPresented: $isAvatarCameraPresented) {
                    CameraImagePicker { image in
                        Task {
                            await uploadAvatarImage(image)
                        }
                    }
                    .ignoresSafeArea()
                }
                .onChange(of: selectedAvatarPhotoItem) { _, item in
                    guard let item else { return }

                    Task {
                        await handleSelectedAvatarPhoto(item)
                    }
                }
                .alert(
                    "Couldn't Update Photo",
                    isPresented: Binding(
                        get: { viewModel.avatarUploadError != nil },
                        set: { isPresented in
                            if !isPresented {
                                viewModel.avatarUploadError = nil
                            }
                        }
                    )
                ) {
                    Button("OK", role: .cancel) {}
                } message: {
                    Text(viewModel.avatarUploadError ?? "Please try again.")
                }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            ProgressView("Loading profile...")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .tint(.white)
                .foregroundStyle(.white)
                .background(ProfileTheme.background)

        case .failed(let message):
            ContentUnavailableView {
                Label("Couldn't Load Profile", systemImage: "wifi.exclamationmark")
            } description: {
                Text(message)
            } actions: {
                Button("Try Again") {
                    Task {
                        await viewModel.load(using: apiClient)
                    }
                }
            }
            .foregroundStyle(.white)
            .background(ProfileTheme.background)

        case .loaded(let response):
            ScrollView {
                VStack(spacing: 22) {
                    HStack {
                        if canShowEventsFilter(for: response) {
                            ProfileEventsFilterButton(selection: $selectedEventsTab)
                        }

                        Spacer()

                        signOutButton
                    }

                    ProfileHeader(
                        profile: response.profile,
                        isUploadingAvatar: viewModel.isUploadingAvatar
                    ) {
                        isAvatarSourceDialogPresented = true
                    }

                    RelationshipSummaryRow(response: response)

                    profileEventsSection(response: response)

                    if appSession.isAuthBypassed {
                        localDevelopmentCard
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 24)
                .padding(.bottom, 104)
            }
            .scrollIndicators(.hidden)
            .background(ProfileTheme.background)
        }
    }

    @ViewBuilder
    private func profileEventsSection(response: FriendsFeedResponse) -> some View {
        let events = selectedEventsTab == .upcoming ? response.upcomingEvents : response.pastEvents
        let groups = ProfileEventGrouper.groups(for: events, mode: selectedEventsTab)

        VStack(alignment: .leading, spacing: 18) {
            if groups.isEmpty {
                ContentUnavailableView {
                    Label("No Events", systemImage: "calendar")
                } description: {
                    Text("There aren’t any \(selectedEventsTab.emptyStateName) events to show yet.")
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
                                            .frame(width: 220)
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
    }

    private func canShowEventsFilter(for response: FriendsFeedResponse) -> Bool {
        !response.upcomingEvents.isEmpty || !response.pastEvents.isEmpty
    }

    private func handleSelectedAvatarPhoto(_ item: PhotosPickerItem) async {
        selectedAvatarPhotoItem = nil

        do {
            guard
                let data = try await item.loadTransferable(type: Data.self),
                let image = UIImage(data: data)
            else {
                viewModel.avatarUploadError = "That image couldn't be loaded."
                return
            }

            await uploadAvatarImage(image)
        } catch {
            viewModel.avatarUploadError = error.localizedDescription
        }
    }

    private func uploadAvatarImage(_ image: UIImage) async {
        guard let data = image.avatarUploadJPEGData(maxBytes: 4 * 1024 * 1024) else {
            viewModel.avatarUploadError = "That image is too large to upload."
            return
        }

        await viewModel.updateAvatar(imageData: data, using: apiClient)
    }

    private var localDevelopmentCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Local Development")
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(.white)

            Text("Auth is currently bypassed on this device.")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(.white.opacity(0.62))

            Button("Return to Sign In") {
                appSession.reset()
            }
            .font(.system(size: 15, weight: .bold))
            .foregroundStyle(Color(red: 0.27, green: 0.72, blue: 0.48))
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ProfileTheme.cardBackground, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private var signOutButton: some View {
        Button {
            Task {
                try? await clerk.auth.signOut(sessionId: clerk.session?.id)
            }
        } label: {
            Text("Sign out")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .frame(height: 40)
                .contentShape(Capsule())
                .profileLiquidGlass(in: Capsule())
        }
        .buttonStyle(.plain)
    }
}

struct UserProfileView: View {
    let userID: String

    @Environment(\.apiClient) private var apiClient
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel = UserProfileViewModel()
    @State private var selectedEventsTab: ProfileEventsTab = .upcoming

    var body: some View {
        content
            .background(ProfileTheme.background.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
            .background(SwipeBackEnabler())
            .navigationBarBackButtonHidden()
            .overlay(alignment: .top) {
                topControls
            }
            .task {
                if case .idle = viewModel.state {
                    await viewModel.load(userID: userID, using: apiClient)
                }
            }
            .refreshable {
                await viewModel.load(userID: userID, using: apiClient)
            }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            ProgressView("Loading profile...")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .tint(.white)
                .foregroundStyle(.white)
                .background(ProfileTheme.background)

        case .failed(let message):
            ContentUnavailableView {
                Label("Couldn't Load Profile", systemImage: "wifi.exclamationmark")
            } description: {
                Text(message)
            } actions: {
                Button("Try Again") {
                    Task {
                        await viewModel.load(userID: userID, using: apiClient)
                    }
                }
            }
            .foregroundStyle(.white)
            .background(ProfileTheme.background)

        case .loaded(let response):
            ScrollView {
                VStack(spacing: 22) {
                    ProfileHeader(
                        profile: response.profile,
                        isUploadingAvatar: false,
                        onEditAvatar: nil
                    )

                    UserRelationshipSummaryRow(response: response)

                    UserProfileEventsSection(
                        response: response,
                        selectedEventsTab: $selectedEventsTab
                    )
                }
                .padding(.horizontal, 16)
                .padding(.top, 24)
                .padding(.bottom, 104)
            }
            .scrollIndicators(.hidden)
            .background(ProfileTheme.background)
        }
    }

    private var topControls: some View {
        HStack {
            FloatingGlassIconButton(systemImage: "chevron.left") {
                dismiss()
            }

            Spacer()

            if viewModel.canShowEventsFilter {
                ProfileEventsFilterButton(selection: $selectedEventsTab)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 14)
    }
}

private enum ProfileEventsTab: String, CaseIterable, Identifiable {
    case upcoming
    case past

    var id: String { rawValue }

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

private struct ProfileEventsFilterButton: View {
    @Binding var selection: ProfileEventsTab

    var body: some View {
        Menu {
            ForEach(ProfileEventsTab.allCases) { tab in
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
            Image(systemName: "line.3.horizontal.decrease")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(selection == .upcoming ? .primary : AppTheme.accentBlue)
                .frame(width: 44, height: 44)
                .contentShape(Circle())
                .profileLiquidGlass(in: Circle())
        }
        .buttonStyle(.plain)
    }
}

private struct UserProfileEventsSection: View {
    let response: UserProfileResponse
    @Binding var selectedEventsTab: ProfileEventsTab

    var body: some View {
        let events = selectedEventsTab == .upcoming ? response.upcomingEvents : response.pastEvents
        let groups = ProfileEventGrouper.groups(for: events, mode: selectedEventsTab)

        VStack(alignment: .leading, spacing: 18) {
            if groups.isEmpty {
                ContentUnavailableView {
                    Label("No Events", systemImage: "calendar")
                } description: {
                    Text("There aren’t any \(selectedEventsTab.emptyStateName) events to show yet.")
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
                                            .frame(width: 220)
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
    }
}

private struct ProfileEventGroup: Identifiable {
    let label: String
    var events: [EventFeedItem]

    var id: String { label }
}

private enum ProfileEventGrouper {
    static func groups(for events: [EventFeedItem], mode: ProfileEventsTab) -> [ProfileEventGroup] {
        let sortedEvents = events.sorted {
            mode == .past ? $0.startAt > $1.startAt : $0.startAt < $1.startAt
        }

        return sortedEvents.reduce(into: [ProfileEventGroup]()) { groups, event in
            let label = label(for: event, mode: mode)

            if let lastIndex = groups.indices.last, groups[lastIndex].label == label {
                groups[lastIndex].events.append(event)
            } else {
                groups.append(ProfileEventGroup(label: label, events: [event]))
            }
        }
    }

    private static func label(for event: EventFeedItem, mode: ProfileEventsTab) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = event.displayTimeZone
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

private struct ProfileHeader: View {
    let profile: FriendUserSummary?
    let isUploadingAvatar: Bool
    let onEditAvatar: (() -> Void)?

    var body: some View {
        VStack(spacing: 12) {
            ZStack(alignment: .bottomTrailing) {
                FriendAvatarView(user: profile, size: 104, seed: 0)

                if let onEditAvatar {
                    Button(action: onEditAvatar) {
                        ZStack {
                            Circle()
                                .fill(Color(red: 0.14, green: 0.14, blue: 0.16))
                                .shadow(color: .black.opacity(0.34), radius: 8, x: 0, y: 4)

                            if isUploadingAvatar {
                                ProgressView()
                                    .scaleEffect(0.72)
                                    .tint(.white)
                            } else {
                                Image(systemName: "camera.fill")
                                    .font(.system(size: 14, weight: .bold))
                                    .foregroundStyle(.white)
                            }
                        }
                        .frame(width: 34, height: 34)
                        .overlay(
                            Circle()
                                .stroke(ProfileTheme.background, lineWidth: 3)
                        )
                    }
                    .buttonStyle(.plain)
                    .disabled(isUploadingAvatar)
                    .accessibilityLabel("Edit profile picture")
                    .offset(x: 2, y: 2)
                }
            }

            if let profile {
                VStack(spacing: 3) {
                    Text(profile.name)
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(.white)

                    Text(profile.usernameText)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(.white.opacity(0.56))
                }
            }
        }
        .frame(maxWidth: .infinity)
    }
}

private struct RelationshipSummaryRow: View {
    let response: FriendsFeedResponse

    var body: some View {
        HStack(spacing: 12) {
            NavigationLink {
                FriendsListView(title: "My Friends", friends: response.friends)
            } label: {
                RelationshipSummaryPill(count: response.friendCount, label: "Friends")
            }
            .buttonStyle(.plain)

            NavigationLink {
                FriendRequestsView(
                    receivedRequests: response.receivedRequests,
                    sentRequests: response.sentRequests
                )
            } label: {
                RelationshipSummaryPill(count: response.requestCount, label: "Requests")
            }
            .buttonStyle(.plain)
        }
    }
}

private struct UserRelationshipSummaryRow: View {
    let response: UserProfileResponse

    var body: some View {
        HStack(spacing: 12) {
            NavigationLink {
                FriendsListView(title: "Friends", friends: response.friends)
            } label: {
                RelationshipSummaryPill(count: response.friendCount, label: "Friends")
            }
            .buttonStyle(.plain)
        }
    }
}

private struct RelationshipSummaryPill: View {
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

private struct FriendsListView: View {
    let title: String
    let friends: [FriendUserSummary]

    var body: some View {
        RelationshipListScreen(title: title) {
            if friends.isEmpty {
                EmptyRelationshipCard(
                    systemImage: "person.2",
                    message: "No friends yet"
                )
            } else {
                RelationshipCard {
                    ForEach(Array(friends.enumerated()), id: \.element.id) { index, friend in
                        NavigationLink {
                            UserProfileView(userID: friend.id)
                        } label: {
                            FriendRowView(user: friend, seed: index)
                        }
                        .buttonStyle(.plain)

                        if friend.id != friends.last?.id {
                            Divider()
                                .overlay(.white.opacity(0.08))
                                .padding(.leading, 62)
                        }
                    }
                }
            }
        }
    }
}

private struct FriendRequestsView: View {
    let receivedRequests: [FriendUserSummary]
    let sentRequests: [FriendUserSummary]

    var body: some View {
        RelationshipListScreen(title: "Received Requests") {
            VStack(alignment: .leading, spacing: 22) {
                if receivedRequests.isEmpty {
                    EmptyRelationshipCard(
                        systemImage: "envelope",
                        message: "No pending friend requests"
                    )
                } else {
                    RelationshipCard {
                        ForEach(Array(receivedRequests.enumerated()), id: \.element.id) { index, request in
                            NavigationLink {
                                UserProfileView(userID: request.id)
                            } label: {
                                FriendRowView(user: request, seed: index)
                            }
                            .buttonStyle(.plain)

                            if request.id != receivedRequests.last?.id {
                                Divider()
                                    .overlay(.white.opacity(0.08))
                                    .padding(.leading, 62)
                            }
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 12) {
                    Text("Sent Requests")
                        .font(.system(size: 23, weight: .bold))
                        .foregroundStyle(.white)

                    if sentRequests.isEmpty {
                        EmptyRelationshipCard(
                            systemImage: "paperplane",
                            message: "No sent requests"
                        )
                    } else {
                        RelationshipCard {
                            ForEach(Array(sentRequests.enumerated()), id: \.element.id) { index, request in
                                NavigationLink {
                                    UserProfileView(userID: request.id)
                                } label: {
                                    FriendRowView(user: request, seed: index, badge: "Pending")
                                }
                                .buttonStyle(.plain)

                                if request.id != sentRequests.last?.id {
                                    Divider()
                                        .overlay(.white.opacity(0.08))
                                        .padding(.leading, 62)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

private struct RelationshipListScreen<Content: View>: View {
    let title: String
    let content: Content

    init(title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text(title)
                    .font(.system(size: 26, weight: .bold))
                    .foregroundStyle(.white)

                content
            }
            .padding(.horizontal, 16)
            .padding(.top, 18)
            .padding(.bottom, 104)
        }
        .background(ProfileTheme.background.ignoresSafeArea())
        .background(SwipeBackEnabler())
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct RelationshipCard<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        VStack(spacing: 0) {
            content
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(ProfileTheme.cardBackground)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(.white.opacity(0.08), lineWidth: 1)
        )
    }
}

private struct EmptyRelationshipCard: View {
    let systemImage: String
    let message: String

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: systemImage)
                .font(.system(size: 42, weight: .medium))
                .foregroundStyle(.white.opacity(0.56))

            Text(message)
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(.white.opacity(0.58))
        }
        .frame(maxWidth: .infinity, minHeight: 172)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(ProfileTheme.cardBackground)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(.white.opacity(0.08), lineWidth: 1)
        )
    }
}

private struct FriendRowView: View {
    let user: FriendUserSummary
    let seed: Int
    var badge: String?

    var body: some View {
        HStack(spacing: 14) {
            FriendAvatarView(user: user, size: 48, seed: seed)

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 10) {
                    Text(user.name)
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(.white)
                        .lineLimit(1)

                    if let badge {
                        Text(badge)
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(
                                Capsule()
                                    .strokeBorder(.white.opacity(0.10), lineWidth: 1)
                            )
                    }
                }

                Text(user.usernameText)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.white.opacity(0.58))
                    .lineLimit(1)
            }

            Spacer(minLength: 0)
        }
        .padding(.vertical, 12)
    }
}

private struct FriendAvatarView: View {
    let user: FriendUserSummary?
    let size: CGFloat
    let seed: Int

    private let fallbackColors = [
        Color(red: 0.88, green: 0.48, blue: 0.36),
        Color(red: 0.88, green: 0.68, blue: 0.46),
        Color(red: 0.57, green: 0.35, blue: 0.70),
        Color(red: 0.43, green: 0.70, blue: 0.62),
        Color(red: 0.15, green: 0.63, blue: 0.58),
    ]

    var body: some View {
        Group {
            if let url = user?.avatarImageURL {
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
        .frame(width: size, height: size)
        .clipShape(Circle())
    }

    private var fallbackAvatar: some View {
        Circle()
            .fill(fallbackColors[abs(seed) % fallbackColors.count])
            .overlay {
                Text(faceGlyph)
                    .font(.system(size: size * 0.34, weight: .bold))
                    .foregroundStyle(.black.opacity(0.86))
            }
    }

    private var faceGlyph: String {
        guard let user else { return "J" }
        return String(user.name.prefix(1)).uppercased()
    }
}

private enum ProfileTheme {
    static let background = Color(red: 0.07, green: 0.07, blue: 0.08)
    static let cardBackground = Color(red: 0.11, green: 0.11, blue: 0.13)
}

private extension View {
    @ViewBuilder
    func profileLiquidGlass<S: InsettableShape>(in shape: S) -> some View {
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

private struct CameraImagePicker: UIViewControllerRepresentable {
    let onImagePicked: (UIImage) -> Void
    @Environment(\.dismiss) private var dismiss

    func makeUIViewController(context: Context) -> UIImagePickerController {
        let picker = UIImagePickerController()
        picker.sourceType = .camera
        picker.allowsEditing = true
        picker.delegate = context.coordinator
        return picker
    }

    func updateUIViewController(_ uiViewController: UIImagePickerController, context: Context) {}

    func makeCoordinator() -> Coordinator {
        Coordinator(
            onImagePicked: onImagePicked,
            dismiss: { dismiss() }
        )
    }

    final class Coordinator: NSObject, UIImagePickerControllerDelegate, UINavigationControllerDelegate {
        private let onImagePicked: (UIImage) -> Void
        private let dismiss: () -> Void

        init(onImagePicked: @escaping (UIImage) -> Void, dismiss: @escaping () -> Void) {
            self.onImagePicked = onImagePicked
            self.dismiss = dismiss
        }

        func imagePickerController(
            _ picker: UIImagePickerController,
            didFinishPickingMediaWithInfo info: [UIImagePickerController.InfoKey: Any]
        ) {
            let image = (info[.editedImage] ?? info[.originalImage]) as? UIImage

            if let image {
                onImagePicked(image)
            }

            dismiss()
        }

        func imagePickerControllerDidCancel(_ picker: UIImagePickerController) {
            dismiss()
        }
    }
}

private extension UIImage {
    func avatarUploadJPEGData(maxBytes: Int) -> Data? {
        let image = resizedForAvatarUpload(maxDimension: 1024)

        for quality in [0.86, 0.72, 0.58, 0.44, 0.32] {
            guard let data = image.jpegData(compressionQuality: quality) else {
                continue
            }

            if data.count <= maxBytes {
                return data
            }
        }

        return nil
    }

    private func resizedForAvatarUpload(maxDimension: CGFloat) -> UIImage {
        let longestSide = max(size.width, size.height)

        guard longestSide > maxDimension else {
            return self
        }

        let scale = maxDimension / longestSide
        let targetSize = CGSize(
            width: size.width * scale,
            height: size.height * scale
        )

        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        format.opaque = true

        return UIGraphicsImageRenderer(size: targetSize, format: format).image { _ in
            draw(in: CGRect(origin: .zero, size: targetSize))
        }
    }
}

#Preview {
    ProfileView()
        .environment(Clerk.preview())
}
