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
    @State private var partnerRelationship: MobilePartnerRelationship?
    @State private var isPartnerPickerPresented = false
    @State private var isPartnerActionInFlight = false
    @State private var isRemovingPartnerConfirmationPresented = false
    @State private var partnerErrorMessage: String?

    var body: some View {
        NavigationStack {
            content
                .background(ProfileTheme.background.ignoresSafeArea())
                .toolbar(.hidden, for: .navigationBar)
                .task {
                    if case .idle = viewModel.state {
                        await loadProfileScreen()
                    }
                }
                .refreshable {
                    await loadProfileScreen()
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
                .confirmationDialog(
                    "Partner Actions",
                    isPresented: $isRemovingPartnerConfirmationPresented,
                    titleVisibility: .visible
                ) {
                    Button("Remove Partner", role: .destructive) {
                        Task {
                            await removePartner()
                        }
                    }

                    Button("Cancel", role: .cancel) {}
                } message: {
                    if let partnerRelationship {
                        Text("Remove \(partnerRelationship.partner.firstName ?? partnerRelationship.partner.username) as your partner?")
                    }
                }
                .alert(
                    "Partner Update Failed",
                    isPresented: Binding(
                        get: { partnerErrorMessage != nil },
                        set: { isPresented in
                            if !isPresented {
                                partnerErrorMessage = nil
                            }
                        }
                    )
                ) {
                    Button("OK", role: .cancel) {}
                } message: {
                    Text(partnerErrorMessage ?? "Please try again.")
                }
                .sheet(isPresented: $isPartnerPickerPresented) {
                    if case .loaded(let response) = viewModel.state {
                        PartnerPickerSheet(
                            friends: availablePartnerCandidates(from: response),
                            onSelectFriend: { friend in
                                Task {
                                    await sendPartnerRequest(to: friend)
                                }
                            }
                        )
                        .presentationDetents([.medium, .large])
                        .presentationDragIndicator(.visible)
                    }
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
                        await loadProfileScreen()
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

                    PartnerManagementCard(
                        relationship: partnerRelationship,
                        availableFriendCount: availablePartnerCandidates(from: response).count,
                        isBusy: isPartnerActionInFlight,
                        onChoosePartner: {
                            isPartnerPickerPresented = true
                        },
                        onAccept: {
                            Task {
                                await acceptPartnerRequest()
                            }
                        },
                        onDecline: {
                            Task {
                                await declinePartnerRequest()
                            }
                        },
                        onCancelRequest: {
                            Task {
                                await declinePartnerRequest()
                            }
                        },
                        onChangePartner: {
                            Task {
                                await changePartner()
                            }
                        },
                        onRemovePartner: {
                            isRemovingPartnerConfirmationPresented = true
                        }
                    )

                    profileEventsSection(response: response)

                    if appSession.isAuthBypassed {
                        localDevelopmentCard
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 0)
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
                                            .contentShape(Rectangle())
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

    private func loadProfileScreen() async {
        await viewModel.load(using: apiClient)
        await loadPartner(using: apiClient)
    }

    private func loadPartner(using apiClient: APIClient) async {
        do {
            let response = try await apiClient.send(APIClient.mobileMyPartner())
            partnerRelationship = response.relationship
        } catch {
            partnerRelationship = nil
            partnerErrorMessage = error.localizedDescription
        }
    }

    private func availablePartnerCandidates(from response: FriendsFeedResponse) -> [FriendUserSummary] {
        let excludedUserID = partnerRelationship?.partner.id

        return response.friends.filter { friend in
            friend.id != excludedUserID
        }
    }

    private func sendPartnerRequest(to friend: FriendUserSummary) async {
        guard !isPartnerActionInFlight else { return }

        isPartnerActionInFlight = true
        partnerErrorMessage = nil

        do {
            try await apiClient.send(APIClient.sendMobilePartnerRequest(recipientID: friend.id))
            isPartnerPickerPresented = false
            await loadProfileScreen()
        } catch {
            partnerErrorMessage = error.localizedDescription
        }

        isPartnerActionInFlight = false
    }

    private func acceptPartnerRequest() async {
        guard !isPartnerActionInFlight, let partnerRelationship else { return }

        isPartnerActionInFlight = true
        partnerErrorMessage = nil

        do {
            try await apiClient.send(APIClient.acceptMobilePartnerRequest(partnerID: partnerRelationship.id))
            await loadProfileScreen()
        } catch {
            partnerErrorMessage = error.localizedDescription
        }

        isPartnerActionInFlight = false
    }

    private func declinePartnerRequest() async {
        guard !isPartnerActionInFlight, let partnerRelationship else { return }

        isPartnerActionInFlight = true
        partnerErrorMessage = nil

        do {
            try await apiClient.send(APIClient.declineMobilePartnerRequest(partnerID: partnerRelationship.id))
            await loadProfileScreen()
        } catch {
            partnerErrorMessage = error.localizedDescription
        }

        isPartnerActionInFlight = false
    }

    private func removePartner() async {
        guard !isPartnerActionInFlight else { return }

        isPartnerActionInFlight = true
        partnerErrorMessage = nil

        do {
            try await apiClient.send(APIClient.removeMobilePartner())
            await loadProfileScreen()
        } catch {
            partnerErrorMessage = error.localizedDescription
        }

        isPartnerActionInFlight = false
    }

    private func changePartner() async {
        guard !isPartnerActionInFlight else { return }

        isPartnerActionInFlight = true
        partnerErrorMessage = nil

        do {
            if let partnerRelationship {
                if partnerRelationship.isAccepted {
                    try await apiClient.send(APIClient.removeMobilePartner())
                } else {
                    try await apiClient.send(APIClient.declineMobilePartnerRequest(partnerID: partnerRelationship.id))
                }
            }

            partnerRelationship = nil
            await viewModel.load(using: apiClient)
            isPartnerPickerPresented = true
        } catch {
            partnerErrorMessage = error.localizedDescription
        }

        isPartnerActionInFlight = false
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
        Menu {
            Button("Sign Out") {
                Task {
                    try? await clerk.auth.signOut(sessionId: clerk.session?.id)
                }
            }
        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 46, height: 46)
                .contentShape(Circle())
                .profileLiquidGlass(in: Circle())
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
        .padding(.top, 0)
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
                .frame(width: 46, height: 46)
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

private struct PartnerManagementCard: View {
    let relationship: MobilePartnerRelationship?
    let availableFriendCount: Int
    let isBusy: Bool
    let onChoosePartner: () -> Void
    let onAccept: () -> Void
    let onDecline: () -> Void
    let onCancelRequest: () -> Void
    let onChangePartner: () -> Void
    let onRemovePartner: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            Text("Partner")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(.white)

            if let relationship {
                partnerStateView(relationship)
            } else {
                VStack(alignment: .leading, spacing: 14) {
                    Text(
                        availableFriendCount == 0
                            ? "You need an accepted friend before you can choose a partner."
                            : "Choose a partner from your accepted friends."
                    )
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.white.opacity(0.64))

                    Button("Add Partner") {
                        onChoosePartner()
                    }
                    .profileActionButtonStyle(
                        kind: .primary,
                        isDisabled: availableFriendCount == 0 || isBusy
                    )
                    .disabled(availableFriendCount == 0 || isBusy)
                }
            }
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ProfileTheme.cardBackground, in: RoundedRectangle(cornerRadius: 22, style: .continuous))
    }

    @ViewBuilder
    private func partnerStateView(_ relationship: MobilePartnerRelationship) -> some View {
        let partner = relationship.partner

        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 12) {
                FriendAvatarView(
                    user: FriendUserSummary(
                        id: partner.id,
                        name: [partner.firstName, partner.lastName].compactMap { $0 }.joined(separator: " ").trimmingCharacters(in: .whitespacesAndNewlines).ifEmpty(partner.username),
                        username: partner.username,
                        avatarImageURL: partner.avatarImageURL
                    ),
                    size: 52,
                    seed: 0
                )

                VStack(alignment: .leading, spacing: 3) {
                    Text(
                        [partner.firstName, partner.lastName]
                            .compactMap { $0 }
                            .joined(separator: " ")
                            .trimmingCharacters(in: .whitespacesAndNewlines)
                            .ifEmpty(partner.username)
                    )
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.white)

                    Text("@\(partner.username)")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.white.opacity(0.56))
                }

                Spacer(minLength: 8)
            }

            switch relationship.status {
            case "accepted":
                Text("You and \(partner.firstName ?? partner.username) are partners.")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.white.opacity(0.64))

                HStack(spacing: 10) {
                    Button("Change") {
                        onChangePartner()
                    }
                    .profileActionButtonStyle(kind: .secondary, isDisabled: isBusy)
                    .disabled(isBusy)

                    Button("Remove") {
                        onRemovePartner()
                    }
                    .profileActionButtonStyle(kind: .destructive, isDisabled: isBusy)
                    .disabled(isBusy)
                }

            case "pending":
                if relationship.isRequester {
                    Text("Partner request pending, waiting for \(partner.firstName ?? partner.username) to accept.")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.white.opacity(0.64))

                    HStack(spacing: 10) {
                        Button("Choose Someone Else") {
                            onChangePartner()
                        }
                        .profileActionButtonStyle(kind: .secondary, isDisabled: isBusy)
                        .disabled(isBusy)

                        Button("Cancel Request") {
                            onCancelRequest()
                        }
                        .profileActionButtonStyle(kind: .destructive, isDisabled: isBusy)
                        .disabled(isBusy)
                    }
                } else {
                    Text("\(partner.firstName ?? partner.username) sent you a partner request.")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.white.opacity(0.64))

                    HStack(spacing: 10) {
                        Button("Accept") {
                            onAccept()
                        }
                        .profileActionButtonStyle(kind: .primary, isDisabled: isBusy)
                        .disabled(isBusy)

                        Button("Decline") {
                            onDecline()
                        }
                        .profileActionButtonStyle(kind: .secondary, isDisabled: isBusy)
                        .disabled(isBusy)
                    }
                }

            default:
                EmptyView()
            }
        }
    }
}

private struct PartnerPickerSheet: View {
    let friends: [FriendUserSummary]
    let onSelectFriend: (FriendUserSummary) -> Void

    @Environment(\.dismiss) private var dismiss
    @State private var searchText = ""

    private var filteredFriends: [FriendUserSummary] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else {
            return friends
        }

        return friends.filter { friend in
            friend.name.localizedCaseInsensitiveContains(query) ||
            friend.username.localizedCaseInsensitiveContains(query)
        }
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 18) {
                    TextField("Search accepted friends...", text: $searchText)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(.white)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .padding(.horizontal, 16)
                        .frame(height: 50)
                        .background(
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .fill(ProfileTheme.cardBackground)
                        )

                    if friends.isEmpty {
                        EmptyRelationshipCard(
                            systemImage: "person.2",
                            message: "No accepted friends available"
                        )
                    } else if filteredFriends.isEmpty {
                        EmptyRelationshipCard(
                            systemImage: "magnifyingglass",
                            message: "No friends found"
                        )
                    } else {
                        RelationshipCard {
                            ForEach(Array(filteredFriends.enumerated()), id: \.element.id) { index, friend in
                                HStack(spacing: 12) {
                                    FriendRowView(user: friend, seed: index)

                                    Button("Send Request") {
                                        onSelectFriend(friend)
                                        dismiss()
                                    }
                                    .font(.system(size: 14, weight: .bold))
                                    .foregroundStyle(AppTheme.accentBlue)
                                }

                                if friend.id != filteredFriends.last?.id {
                                    Divider()
                                        .overlay(.white.opacity(0.08))
                                        .padding(.leading, 62)
                                }
                            }
                        }
                    }
                }
                .padding(16)
                .padding(.top, 12)
                .padding(.bottom, 40)
            }
            .background(ProfileTheme.background.ignoresSafeArea())
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close") {
                        dismiss()
                    }
                    .font(.system(size: 16, weight: .semibold))
                }

                ToolbarItem(placement: .principal) {
                    Text("Choose Partner")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(.white)
                }
            }
            .toolbarBackground(ProfileTheme.background, for: .navigationBar)
            .toolbarColorScheme(.dark, for: .navigationBar)
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

private enum ProfileActionButtonKind {
    case primary
    case secondary
    case destructive
}

private extension String {
    func ifEmpty(_ fallback: String) -> String {
        trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? fallback : self
    }
}

private extension View {
    func profileActionButtonStyle(
        kind: ProfileActionButtonKind,
        isDisabled: Bool = false
    ) -> some View {
        modifier(ProfileActionButtonModifier(kind: kind, isDisabled: isDisabled))
    }

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

private struct ProfileActionButtonModifier: ViewModifier {
    let kind: ProfileActionButtonKind
    let isDisabled: Bool

    private var foregroundColor: Color {
        switch kind {
        case .primary:
            return .black
        case .secondary:
            return .white
        case .destructive:
            return Color(red: 1.0, green: 0.48, blue: 0.48)
        }
    }

    private var backgroundColor: Color {
        switch kind {
        case .primary:
            return .white
        case .secondary, .destructive:
            return .white.opacity(0.08)
        }
    }

    func body(content: Content) -> some View {
        content
            .font(.system(size: 14, weight: .bold))
            .foregroundStyle(foregroundColor.opacity(isDisabled ? 0.5 : 1))
            .padding(.horizontal, 15)
            .frame(height: 40)
            .background(
                Capsule()
                    .fill(backgroundColor.opacity(isDisabled ? 0.55 : 1))
            )
            .overlay(
                Capsule()
                    .strokeBorder(.white.opacity(kind == .primary ? 0 : 0.08), lineWidth: 1)
            )
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

#Preview {
    ProfileView()
        .environment(Clerk.preview())
}
