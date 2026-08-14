import ClerkKit
import PhotosUI
import SwiftUI
import UIKit

struct ProfileView: View {
    let resetFiltersTrigger: Int
    let addPhotoTrigger: Int

    @Environment(Clerk.self) private var clerk
    @Environment(\.apiClient) private var apiClient
    @EnvironmentObject private var appSession: AppSession
    @StateObject private var viewModel = ProfileViewModel()
    @State private var selectedAvatarPhotoItem: PhotosPickerItem?
    @State private var isAvatarSourceDialogPresented = false
    @State private var isAvatarPhotoPickerPresented = false
    @State private var isAvatarCameraPresented = false
    @State private var selectedEventsTab: ProfileEventsTab = .upcoming
    @State private var selectedEventsRSVPFilter: ProfileEventsRSVPFilter = .all
    @State private var partnerRelationship: MobilePartnerRelationship?
    @State private var isPartnerPickerPresented = false
    @State private var isPartnerActionInFlight = false
    @State private var isRemovingPartnerConfirmationPresented = false
    @State private var partnerErrorMessage: String?
    @State private var friendRequestActionErrorMessage: String?
    @State private var isAdminSettingsPresented = false
    @State private var isEditProfilePresented = false
    @State private var isSignOutConfirmationPresented = false
    @State private var profileShareURL: URL?
    @State private var handledAddPhotoTrigger = 0
    @State private var headerVisibility = ScrollableHeaderVisibility()

    init(resetFiltersTrigger: Int = 0, addPhotoTrigger: Int = 0) {
        self.resetFiltersTrigger = resetFiltersTrigger
        self.addPhotoTrigger = addPhotoTrigger
    }

    var body: some View {
        NavigationStack {
            content
                .background(ProfileTheme.background.ignoresSafeArea())
                .topStatusBarScrim()
                .toolbar(.hidden, for: .navigationBar)
                .task {
                    if case .idle = viewModel.state {
                        await loadProfileScreen()
                    }
                }
                .onAppear {
                    presentActivationPhotoPickerIfNeeded()
                }
                .onChange(of: addPhotoTrigger) { _, _ in
                    presentActivationPhotoPickerIfNeeded()
                }
                .onChange(of: resetFiltersTrigger) { _, _ in
                    resetProfileFilters()
                }
                .onReceive(NotificationCenter.default.publisher(for: .eventRSVPDidChange)) { _ in
                    Task {
                        ProfileViewModel.invalidateCache()
                        UserProfileViewModel.invalidateAllCaches()
                        await loadProfileScreen()
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: .mobileEventDidChange)) { _ in
                    Task {
                        ProfileViewModel.invalidateCache()
                        UserProfileViewModel.invalidateAllCaches()
                        await loadProfileScreen()
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: .friendRequestDidChange)) { notification in
                    UserProfileViewModel.invalidateAllCaches()

                    if let user = notification.object as? FriendUserSummary,
                       let rawStatus = notification.userInfo?["friendStatus"] as? String,
                       let status = FriendUserSummary.FriendStatus(rawValue: rawStatus) {
                        viewModel.applyFriendRequestStatusChange(for: user, status: status)
                    } else {
                        ProfileViewModel.invalidateCache()

                        Task {
                            await loadProfileScreen()
                        }
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: .appDataDidChange)) { _ in
                    ProfileViewModel.invalidateCache()
                    UserProfileViewModel.invalidateAllCaches()

                    Task {
                        await loadProfileScreen()
                    }
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
                .alert(
                    "Couldn't Update Request",
                    isPresented: Binding(
                        get: { friendRequestActionErrorMessage != nil },
                        set: { isPresented in
                            if !isPresented {
                                friendRequestActionErrorMessage = nil
                            }
                        }
                    )
                ) {
                    Button("OK", role: .cancel) {}
                } message: {
                    Text(friendRequestActionErrorMessage ?? "Please try again.")
                }
                .alert("Sign Out?", isPresented: $isSignOutConfirmationPresented) {
                    Button("Cancel", role: .cancel) {}

                    Button("Sign Out", role: .destructive) {
                        Task {
                            try? await clerk.auth.signOut(sessionId: clerk.session?.id)
                        }
                    }
                } message: {
                    Text("Are you sure you want to sign out?")
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
                        .presentationBackground(ProfileTheme.cardBackground)
                    }
                }
                .navigationDestination(isPresented: $isAdminSettingsPresented) {
                    AdminSettingsView()
                }
                .navigationDestination(isPresented: $isEditProfilePresented) {
                    MobileEditProfileView {
                        ProfileViewModel.invalidateCache()
                        UserProfileViewModel.invalidateAllCaches()
                        NotificationCenter.default.post(name: .appDataDidChange, object: nil)
                        NotificationCenter.default.post(name: .activationDidChange, object: nil)
                        isEditProfilePresented = false
                    }
                }
                .sheet(
                    isPresented: Binding(
                        get: { profileShareURL != nil },
                        set: { isPresented in
                            if !isPresented {
                                profileShareURL = nil
                            }
                        }
                    )
                ) {
                    if let profileShareURL {
                        ProfileShareSheet(activityItems: [profileShareURL])
                    }
                }
        }
    }

    private func presentActivationPhotoPickerIfNeeded() {
        guard addPhotoTrigger > handledAddPhotoTrigger else { return }
        handledAddPhotoTrigger = addPhotoTrigger
        isAvatarSourceDialogPresented = true
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            NativeLoadingView()
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
                    VStack(spacing: 12) {
                        ProfileHeader(
                            profile: response.profile,
                            isUploadingAvatar: viewModel.isUploadingAvatar,
                            isAvatarMenuPresented: $isAvatarSourceDialogPresented,
                            onChooseAvatarPhoto: {
                                isAvatarSourceDialogPresented = false
                                isAvatarPhotoPickerPresented = true
                            },
                            onTakeAvatarPhoto: {
                                isAvatarSourceDialogPresented = false
                                isAvatarCameraPresented = true
                            }
                        ) {
                            RelationshipSummaryRow(
                                response: response,
                                partnerRelationship: partnerRelationship,
                                availablePartnerCount: availablePartnerCandidates(from: response).count,
                                isPartnerBusy: isPartnerActionInFlight,
                                onChoosePartner: {
                                    isPartnerPickerPresented = true
                                },
                                onAcceptPartner: {
                                    Task {
                                        await acceptPartnerRequest()
                                    }
                                },
                                onDeclinePartner: {
                                    Task {
                                        await declinePartnerRequest()
                                    }
                                },
                                onCancelPartnerRequest: {
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
                                },
                                onRemoveFriend: { friend in
                                    Task {
                                        await removeFriend(friend)
                                    }
                                },
                                onAcceptFriendRequest: { request in
                                    await respondToFriendRequest(request, response: .accept)
                                },
                                onDeclineFriendRequest: { request in
                                    await respondToFriendRequest(request, response: .decline)
                                }
                            )
                        }

                        CurrentUserProfileEventsControls(
                            selection: $selectedEventsTab,
                            rsvpFilter: $selectedEventsRSVPFilter
                        )
                            .padding(.top, 8)
                    }
                    .padding(.bottom, 8)

                    profileEventsSection(response: response)

                    if appSession.isAuthBypassed {
                        localDevelopmentCard
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 74)
                .padding(.bottom, 18)
            }
            .scrollIndicators(.hidden)
            .modifier(ScrollableHeaderVisibilityTrackingModifier(visibility: headerVisibility))
            .background(ProfileTheme.background)
            .overlay(alignment: .top) {
                ZStack {
                    HStack {
                        Color.clear
                            .frame(width: 46, height: 46)

                        Spacer()

                        signOutButton
                    }

                    if let username = response.profile?.username {
                        ProfileFadingTopUsername(
                            username: username,
                            visibility: headerVisibility
                        )
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 0)
            }
            .task(id: profileEventPrefetchKey(response: response)) {
                await EventArtworkPrefetcher.prefetch(
                    events: response.upcomingEvents + response.pastEvents
                )
            }
        }
    }

    @ViewBuilder
    private func profileEventsSection(response: FriendsFeedResponse) -> some View {
        let displayWindow = EventFeedDisplayWindow.partition(
            upcoming: response.upcomingEvents,
            past: response.pastEvents
        )
        let events = selectedEventsRSVPFilter.filtered(
            events: selectedEventsTab == .upcoming ? displayWindow.upcoming : displayWindow.past
        )
        let groups = ProfileEventGrouper.groups(for: events, mode: selectedEventsTab)

        VStack(alignment: .leading, spacing: 18) {
            if groups.isEmpty {
                ProfileEmptyEventsPlaceholder(
                    message: "There aren’t any \(selectedEventsTab.emptyStateName) events to show yet."
                )
            } else {
                ForEach(groups) { group in
                    EventCardCarousel(
                        events: group.events,
                        cardWidth: 220,
                        verticalSpacing: 10
                    ) {
                        Text(group.label)
                            .font(AppTheme.contentHeaderFont)
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

    private func canShowEventsFilter(for response: FriendsFeedResponse) -> Bool {
        !response.upcomingEvents.isEmpty || !response.pastEvents.isEmpty
    }

    private func resetProfileFilters() {
        selectedEventsTab = .upcoming
        selectedEventsRSVPFilter = .all
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
            guard !isCancellationLikeError(error) else {
                return
            }
            partnerErrorMessage = error.localizedDescription
        }
    }

    private func availablePartnerCandidates(from response: FriendsFeedResponse) -> [FriendUserSummary] {
        let excludedUserID = partnerRelationship?.partner.id

        return response.friends.filter { friend in
            friend.id != excludedUserID
        }
    }

    private func profileEventPrefetchKey(response: FriendsFeedResponse) -> String {
        (response.upcomingEvents + response.pastEvents)
            .map(\.id.uuidString)
            .joined(separator: ",")
    }

    private func sendPartnerRequest(to friend: FriendUserSummary) async {
        guard !isPartnerActionInFlight else { return }

        isPartnerActionInFlight = true
        partnerErrorMessage = nil
        let previousRelationship = partnerRelationship

        partnerRelationship = MobilePartnerRelationship(
            id: friend.id,
            status: "pending",
            isRequester: true,
            partner: MobilePartnerUser(
                id: friend.id,
                firstName: friend.name.partnerFirstName,
                lastName: friend.name.partnerLastName,
                username: friend.username,
                avatarImageURL: friend.avatarImageURL
            )
        )

        do {
            try await apiClient.send(APIClient.sendMobilePartnerRequest(recipientID: friend.id))
            isPartnerPickerPresented = false
        } catch {
            partnerRelationship = previousRelationship
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
        let previousRelationship = partnerRelationship
        self.partnerRelationship = nil

        do {
            try await apiClient.send(APIClient.declineMobilePartnerRequest(partnerID: partnerRelationship.id))
        } catch {
            self.partnerRelationship = previousRelationship
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

    private func removeFriend(_ friend: FriendUserSummary) async {
        guard
            let friendshipID = friend.friendshipID,
            !friendshipID.isEmpty
        else {
            return
        }

        let previousResponse = viewModel.snapshotLoadedResponse()
        viewModel.removeFriend(userID: friend.id)
        updateSearchFriendStatus(userID: friend.id, status: .none)

        do {
            try await apiClient.send(APIClient.declineMobileFriendRequest(friendRequestID: friendshipID))
        } catch {
            if let previousResponse {
                viewModel.restoreLoadedResponse(previousResponse)
            }
            updateSearchFriendStatus(userID: friend.id, status: .accepted)
        }
    }

    private func updateSearchFriendStatus(
        userID: String,
        status: FriendUserSummary.FriendStatus
    ) {
        HomeSearchDirectoryViewModel.updateCachedFriendStatus(for: userID, status: status)
        NotificationCenter.default.post(
            name: .friendRequestDidChange,
            object: nil,
            userInfo: [
                "userID": userID,
                "friendStatus": status.rawValue,
            ]
        )
    }

    private func respondToFriendRequest(
        _ request: FriendUserSummary,
        response: ActivityRequestResponse
    ) async -> Bool {
        var resolvedRequest = request

        if resolvedRequest.friendshipID == nil || resolvedRequest.friendshipID?.isEmpty == true {
            await viewModel.load(using: apiClient, forceRefresh: true)

            if let refreshedRequest = viewModel
                .snapshotLoadedResponse()?
                .receivedRequests
                .first(where: { $0.id == request.id && $0.friendshipID?.isEmpty == false }) {
                resolvedRequest = refreshedRequest
            }
        }

        let requestIdentifier = resolvedRequest.friendshipID?.isEmpty == false
            ? resolvedRequest.friendshipID!
            : resolvedRequest.id

        let previousResponse = viewModel.snapshotLoadedResponse()

        switch response {
        case .accept:
            viewModel.updateLoadedResponse { current in
                FriendsFeedResponse(
                    profile: current.profile,
                    friendCount: current.friendCount + 1,
                    requestCount: max(current.requestCount - 1, 0),
                    followingCount: current.followingCount,
                    followedPlaces: current.followedPlaces,
                    friends: current.friends + [
                        FriendUserSummary(
                            id: resolvedRequest.id,
                            friendshipID: resolvedRequest.friendshipID,
                            name: resolvedRequest.name,
                            username: resolvedRequest.username,
                            avatarImageURL: resolvedRequest.avatarImageURL,
                            city: resolvedRequest.city,
                            state: resolvedRequest.state,
                            friendStatus: .accepted
                        )
                    ],
                    receivedRequests: current.receivedRequests.filter { $0.id != resolvedRequest.id },
                    sentRequests: current.sentRequests,
                    upcomingEvents: current.upcomingEvents,
                    pastEvents: current.pastEvents
                )
            }
        case .decline:
            viewModel.updateLoadedResponse { current in
                FriendsFeedResponse(
                    profile: current.profile,
                    friendCount: current.friendCount,
                    requestCount: max(current.requestCount - 1, 0),
                    followingCount: current.followingCount,
                    followedPlaces: current.followedPlaces,
                    friends: current.friends,
                    receivedRequests: current.receivedRequests.filter { $0.id != resolvedRequest.id },
                    sentRequests: current.sentRequests,
                    upcomingEvents: current.upcomingEvents,
                    pastEvents: current.pastEvents
                )
            }
        }

        postOptimisticFriendRequestChange(
            for: resolvedRequest,
            status: response == .accept ? .accepted : .none
        )

        do {
            switch response {
            case .accept:
                try await apiClient.send(APIClient.acceptMobileFriendRequest(friendRequestID: requestIdentifier))
            case .decline:
                try await apiClient.send(APIClient.declineMobileFriendRequest(friendRequestID: requestIdentifier))
            }
            return true
        } catch {
            if let previousResponse {
                viewModel.restoreLoadedResponse(previousResponse)
            }
            postOptimisticFriendRequestChange(for: resolvedRequest, status: .pendingReceived)
            friendRequestActionErrorMessage = error.localizedDescription
            return false
        }
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
            Button {
                isEditProfilePresented = true
            } label: {
                Label("Edit Profile", systemImage: "pencil")
                    .foregroundStyle(.white)
            }
            .tint(.white)

            if case .loaded(let response) = viewModel.state,
               let username = response.profile?.username
            {
                Button {
                    profileShareURL = ProfileShareURL.url(for: username)
                } label: {
                    Label("Share Profile", systemImage: "square.and.arrow.up")
                        .foregroundStyle(.white)
                }
                .tint(.white)
            }

            if appSession.isAdmin {
                Button {
                    isAdminSettingsPresented = true
                } label: {
                    Label("Admin Settings", systemImage: "gearshape")
                        .foregroundStyle(.white)
                }
                .tint(.white)
            }

            Button(role: .destructive) {
                isSignOutConfirmationPresented = true
            } label: {
                Label("Sign Out", systemImage: "rectangle.portrait.and.arrow.right")
                    .foregroundStyle(.red)
            }
            .tint(.red)
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

    private func isCancellationLikeError(_ error: Error) -> Bool {
        if error is CancellationError {
            return true
        }

        let nsError = error as NSError
        if nsError.domain == NSURLErrorDomain, nsError.code == NSURLErrorCancelled {
            return true
        }

        return error.localizedDescription.trimmingCharacters(in: .whitespacesAndNewlines)
            .localizedCaseInsensitiveCompare("cancelled") == .orderedSame
    }
}

private struct MobileEditProfileView: View {
    let onComplete: () -> Void

    @Environment(\.apiClient) private var apiClient
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel = MobileEditProfileViewModel()

    var body: some View {
        Group {
            switch viewModel.state {
            case .idle, .loading:
                NativeLoadingView()
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

            case .loaded(let profile):
                MobileOnboardingView(
                    initialState: profile,
                    mode: .editing,
                    onComplete: onComplete
                )
            }
        }
        .toolbar(.hidden, for: .navigationBar)
        .background(SwipeBackEnabler())
        .navigationBarBackButtonHidden()
        .overlay(alignment: .topLeading) {
            if !isFormLoaded {
                Button {
                    dismiss()
                } label: {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: 46, height: 46)
                        .contentShape(Circle())
                        .profileLiquidGlass(in: Circle())
                }
                .buttonStyle(.plain)
                .padding(.leading, 16)
            }
        }
        .task {
            if case .idle = viewModel.state {
                await viewModel.load(using: apiClient)
            }
        }
    }

    private var isFormLoaded: Bool {
        if case .loaded = viewModel.state {
            return true
        }

        return false
    }
}

@MainActor
private final class MobileEditProfileViewModel: ObservableObject {
    enum State {
        case idle
        case loading
        case loaded(MobileOnboardingState)
        case failed(String)
    }

    @Published private(set) var state: State = .idle

    func load(using apiClient: APIClient) async {
        if case .loading = state {
            return
        }

        state = .loading

        do {
            let profile = try await apiClient.send(APIClient.mobileOnboardingState())
            state = .loaded(profile)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }
}

private enum ProfileShareURL {
    static func url(for username: String) -> URL? {
        let path = username.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed) ?? username
        return URL(string: "https://www.whoisgoing.com/\(path)")
    }
}

private struct ProfileShareSheet: UIViewControllerRepresentable {
    let activityItems: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: activityItems, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

struct UserProfileView: View {
    let userID: String
    var showsFriendAction = true

    @Environment(Clerk.self) private var clerk
    @Environment(\.apiClient) private var apiClient
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel = UserProfileViewModel()
    @State private var selectedEventsTab: ProfileEventsTab = .upcoming
    @State private var selectedEventsRSVPFilter: ProfileEventsRSVPFilter = .all
    @State private var isSendingFriendRequest = false
    @State private var isRespondingToFriendRequest = false
    @State private var pendingUnfriendProfile: FriendUserSummary?
    @State private var profileShareURL: URL?
    @State private var headerVisibility = ScrollableHeaderVisibility()

    var body: some View {
        content
            .background(ProfileTheme.background.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
            .background(SwipeBackEnabler())
            .navigationBarBackButtonHidden()
            .overlay(alignment: .top) {
                topControls
            }
            .task(id: userID) {
                if case .loaded(let response) = viewModel.state,
                   response.profile?.id == userID {
                    return
                }

                await viewModel.load(userID: userID, using: apiClient)
            }
            .onReceive(NotificationCenter.default.publisher(for: .appDataDidChange)) { _ in
                // Friend actions update this profile optimistically below. Ignore the
                // mutation's global refresh notification so the screen does not fall
                // back to its loading state just to redraw the action button.
                guard !isSendingFriendRequest, !isRespondingToFriendRequest else {
                    return
                }

                Task {
                    await viewModel.load(userID: userID, using: apiClient, forceRefresh: true)
                }
            }
            .alert(item: $pendingUnfriendProfile) { profile in
                Alert(
                    title: Text("Unfriend \(profile.name)?"),
                    message: Text("Are you sure you want to unfriend \(profile.name)?"),
                    primaryButton: .destructive(Text("Unfriend")) {
                        unfriend(profile: profile)
                    },
                    secondaryButton: .cancel()
                )
            }
            .sheet(
                isPresented: Binding(
                    get: { profileShareURL != nil },
                    set: { isPresented in
                        if !isPresented {
                            profileShareURL = nil
                        }
                    }
                )
            ) {
                if let profileShareURL {
                    ProfileShareSheet(activityItems: [profileShareURL])
                }
            }
            .task(id: userProfileEventPrefetchKey) {
                guard case .loaded(let response) = viewModel.state else {
                    return
                }

                await EventArtworkPrefetcher.prefetch(
                    events: response.upcomingEvents + response.pastEvents
                )
            }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            NativeLoadingView()
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
                    VStack(spacing: 12) {
                        ProfileHeader(profile: response.profile, isUploadingAvatar: false, isAvatarMenuPresented: nil) {
                            UserRelationshipSummaryRow(response: response)
                        }

                        userProfileEventActions(response: response)
                            .padding(.top, 8)
                    }
                    .padding(.bottom, 8)

                    UserProfileEventsSection(
                        response: response,
                        isCurrentUser: isCurrentUserProfile,
                        selectedEventsTab: $selectedEventsTab,
                        selectedEventsRSVPFilter: $selectedEventsRSVPFilter
                    )
                }
                .padding(.horizontal, 16)
                .padding(.top, 74)
                .padding(.bottom, 18)
            }
            .scrollIndicators(.hidden)
            .modifier(ScrollableHeaderVisibilityTrackingModifier(visibility: headerVisibility))
            .background(ProfileTheme.background)
        }
    }

    private var topControls: some View {
        ZStack {
            HStack {
                HStack(spacing: 10) {
                    FloatingGlassIconButton(systemImage: "chevron.left") {
                        dismiss()
                    }

                    if isCurrentUserProfile,
                       case .loaded = viewModel.state {
                        Color.clear
                            .frame(width: 46, height: 46)
                    } else if case .loaded(let response) = viewModel.state,
                              let username = response.profile?.username {
                        ProfileFadingTopUsername(
                            username: username,
                            alignment: .leading,
                            visibility: headerVisibility
                        )
                    }
                }

                Spacer()

                if case .loaded(let response) = viewModel.state, let profile = response.profile {
                    HStack(spacing: 10) {
                        if isCurrentUserProfile {
                            currentUserMenu(for: profile)
                        } else if showsConfirmedFriendMenu(for: profile) {
                            confirmedFriendMenu(for: profile)
                        } else {
                            profileShareMenu(for: profile)
                        }

                    }
                }
            }

            if isCurrentUserProfile,
               case .loaded(let response) = viewModel.state,
               let username = response.profile?.username
            {
                ProfileFadingTopUsername(
                    username: username,
                    visibility: headerVisibility
                )
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 0)
    }

    private func showsConfirmedFriendMenu(for profile: FriendUserSummary) -> Bool {
        displaysFriendActions && profile.friendStatus == .accepted
    }

    private var displaysFriendActions: Bool {
        showsFriendAction && !isCurrentUserProfile
    }

    private var displaysReceivedFriendRequestActions: Bool {
        guard displaysFriendActions,
              case .loaded(let response) = viewModel.state
        else {
            return false
        }

        return response.profile?.friendStatus == .pendingReceived
    }

    private var isCurrentUserProfile: Bool {
        userID == clerk.user?.id || userID == ProfileViewModel.currentUserSummary?.id
    }

    @ViewBuilder
    private func userProfileEventActions(response: UserProfileResponse) -> some View {
        if isCurrentUserProfile {
            CurrentUserProfileEventsControls(
                selection: $selectedEventsTab,
                rsvpFilter: $selectedEventsRSVPFilter
            )
        } else if displaysReceivedFriendRequestActions {
            VStack(spacing: 10) {
                ProfileEventsPeriodFilterButton(
                    selection: $selectedEventsTab,
                    rsvpFilter: $selectedEventsRSVPFilter
                )
                receivedFriendRequestAction(response: response)
            }
        } else if displaysFriendActions, let profile = response.profile {
            if profile.friendStatus == .accepted, selectedEventsTab == .past {
                HStack(spacing: 10) {
                    ProfileEventsPeriodFilterButton(
                        selection: $selectedEventsTab,
                        rsvpFilter: $selectedEventsRSVPFilter
                    )
                    ProfilePastEventsFilterButton(rsvpFilter: $selectedEventsRSVPFilter)
                }
                .id("friend-past-event-controls")
                .transaction(disablingProfileEventControlAnimations)
            } else {
                HStack(spacing: 10) {
                    ProfileEventsPeriodFilterButton(
                        selection: $selectedEventsTab,
                        rsvpFilter: $selectedEventsRSVPFilter
                    )
                    userFriendProfileAction(for: profile)
                }
                .id("friend-upcoming-event-controls")
                .transaction(disablingProfileEventControlAnimations)
            }
        } else {
            ProfileEventsPeriodFilterButton(
                selection: $selectedEventsTab,
                rsvpFilter: $selectedEventsRSVPFilter
            )
        }
    }

    private func disablingProfileEventControlAnimations(_ transaction: inout Transaction) {
        transaction.animation = nil
        transaction.disablesAnimations = true
    }

    private func currentUserMenu(for profile: FriendUserSummary) -> some View {
        Menu {
            Button {
                profileShareURL = ProfileShareURL.url(for: profile.username)
            } label: {
                Label("Share Profile", systemImage: "square.and.arrow.up")
                    .foregroundStyle(.white)
            }
            .tint(.white)
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

    private func profileShareMenu(for profile: FriendUserSummary) -> some View {
        Menu {
            Button {
                profileShareURL = ProfileShareURL.url(for: profile.username)
            } label: {
                Label("Share Profile", systemImage: "square.and.arrow.up")
                    .foregroundStyle(.white)
            }
            .tint(.white)
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

    private func confirmedFriendMenu(for profile: FriendUserSummary) -> some View {
        Menu {
            Button {
                profileShareURL = ProfileShareURL.url(for: profile.username)
            } label: {
                Label("Share Profile", systemImage: "square.and.arrow.up")
                    .foregroundStyle(.white)
            }
            .tint(.white)

        } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 46, height: 46)
                .contentShape(Circle())
                .profileLiquidGlass(in: Circle())
        }
        .buttonStyle(.plain)
        .disabled(isRespondingToFriendRequest)
    }

    @ViewBuilder
    private func userFriendProfileAction(for profile: FriendUserSummary) -> some View {
        switch profile.friendStatus ?? FriendUserSummary.FriendStatus.none {
        case FriendUserSummary.FriendStatus.none:
            Button {
                sendFriendRequest(to: profile.id)
            } label: {
                Text("Add Friend")
                    .frame(maxWidth: .infinity)
                    .frame(height: 40)
                    .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .profileActionButtonStyle(
                kind: .accent,
                isDisabled: isSendingFriendRequest,
                fillsAvailableWidth: true,
                fontWeight: .semibold,
                cornerRadius: 12,
                fontSize: 14
            )
            .disabled(isSendingFriendRequest)
        case .pendingSent:
            Button("Added") {}
                .profileActionButtonStyle(
                    kind: .secondary,
                    isDisabled: true,
                    fillsAvailableWidth: true,
                    cornerRadius: 12,
                    fontSize: 14
                )
                .disabled(true)
        case .accepted:
            Button {
                UIImpactFeedbackGenerator(style: .light).impactOccurred()
                pendingUnfriendProfile = profile
            } label: {
                Text("Friends")
                    .frame(maxWidth: .infinity)
                    .frame(height: 40)
                    .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            }
            .profileActionButtonStyle(
                kind: .secondary,
                isDisabled: isRespondingToFriendRequest,
                fillsAvailableWidth: true,
                fontWeight: .semibold,
                cornerRadius: 12,
                fontSize: 14
            )
            .disabled(isRespondingToFriendRequest)
        case .pendingReceived:
            EmptyView()
        }
    }

    @ViewBuilder
    private func receivedFriendRequestAction(response: UserProfileResponse) -> some View {
        if let profile = response.profile {
            switch profile.friendStatus ?? FriendUserSummary.FriendStatus.none {
            case .pendingReceived:
                HStack(spacing: 12) {
                    Button("Decline") {
                        respondToFriendRequest(profile: profile, response: .decline)
                    }
                    .profileActionButtonStyle(
                        kind: .secondary,
                        isDisabled: isRespondingToFriendRequest,
                        fillsAvailableWidth: true,
                        fontWeight: .semibold,
                        cornerRadius: 12
                    )
                    .disabled(isRespondingToFriendRequest)

                    Button("Accept") {
                        respondToFriendRequest(profile: profile, response: .accept)
                    }
                    .profileActionButtonStyle(
                        kind: .accent,
                        isDisabled: isRespondingToFriendRequest,
                        fillsAvailableWidth: true,
                        fontWeight: .semibold,
                        cornerRadius: 12
                    )
                    .disabled(isRespondingToFriendRequest)
                }
            case FriendUserSummary.FriendStatus.none, .pendingSent, .accepted:
                EmptyView()
            }
        }
    }

    private func sendFriendRequest(to userID: String) {
        guard !isSendingFriendRequest,
              let previousResponse = viewModel.snapshotLoadedResponse(),
              let profile = previousResponse.profile,
              profile.id == userID,
              profile.id != ProfileViewModel.currentUserSummary?.id
        else {
            return
        }

        let optimisticProfile = FriendUserSummary(
            id: profile.id,
            friendshipID: profile.friendshipID,
            name: profile.name,
            username: profile.username,
            avatarImageURL: profile.avatarImageURL,
            city: profile.city,
            state: profile.state,
            friendStatus: .pendingSent
        )

        ConfirmationHaptic.play()
        isSendingFriendRequest = true
        viewModel.updateLoadedResponse { current in
            UserProfileResponse(
                profile: current.profile.map {
                    FriendUserSummary(
                        id: $0.id,
                        friendshipID: $0.friendshipID,
                        name: $0.name,
                        username: $0.username,
                        avatarImageURL: $0.avatarImageURL,
                        city: $0.city,
                        state: $0.state,
                        friendStatus: .pendingSent
                    )
                },
                friendCount: current.friendCount,
                followingCount: current.followingCount,
                followedPlaces: current.followedPlaces,
                friends: current.friends,
                upcomingEvents: current.upcomingEvents,
                pastEvents: current.pastEvents
            )
        }
        postFriendStatusChange(
            userID: userID,
            status: .pendingSent,
            sourceUser: optimisticProfile
        )

        Task {
            defer {
                isSendingFriendRequest = false
            }

            do {
                let response = try await apiClient.send(
                    APIClient.sendMobileFriendRequest(friendUserID: userID)
                )
                viewModel.updateLoadedResponse { current in
                    UserProfileResponse(
                        profile: current.profile.map {
                            FriendUserSummary(
                                id: $0.id,
                                friendshipID: $0.friendshipID,
                                name: $0.name,
                                username: $0.username,
                                avatarImageURL: $0.avatarImageURL,
                                city: $0.city,
                                state: $0.state,
                                friendStatus: response.friendStatus
                            )
                        },
                        friendCount: current.friendCount,
                        followingCount: current.followingCount,
                        followedPlaces: current.followedPlaces,
                        friends: current.friends,
                        upcomingEvents: current.upcomingEvents,
                        pastEvents: current.pastEvents
                    )
                }
                postFriendStatusChange(
                    userID: userID,
                    status: response.friendStatus,
                    sourceUser: optimisticProfile
                )
            } catch {
                viewModel.restoreLoadedResponse(previousResponse)
                postFriendStatusChange(
                    userID: userID,
                    status: .none,
                    sourceUser: optimisticProfile
                )
                ProfileViewModel.confirmFriendRequestStatusChange(userID: userID)
            }
        }
    }

    private func respondToFriendRequest(
        profile: FriendUserSummary,
        response: ActivityRequestResponse
    ) {
        guard let friendshipID = profile.friendshipID, !friendshipID.isEmpty else {
            return
        }

        guard !isRespondingToFriendRequest else {
            return
        }

        isRespondingToFriendRequest = true
        let previousResponse = viewModel.snapshotLoadedResponse()
        let optimisticStatus: FriendUserSummary.FriendStatus = response == .accept ? .accepted : .none

        viewModel.updateLoadedResponse { current in
            UserProfileResponse(
                profile: current.profile.map {
                    FriendUserSummary(
                        id: $0.id,
                        friendshipID: $0.friendshipID,
                        name: $0.name,
                        username: $0.username,
                        avatarImageURL: $0.avatarImageURL,
                        city: $0.city,
                        state: $0.state,
                        friendStatus: optimisticStatus
                    )
                },
                friendCount: current.friendCount,
                followingCount: current.followingCount,
                followedPlaces: current.followedPlaces,
                friends: current.friends,
                upcomingEvents: current.upcomingEvents,
                pastEvents: current.pastEvents
            )
        }
        postFriendStatusChange(
            userID: profile.id,
            status: optimisticStatus,
            sourceUser: profile
        )
        playFriendRequestResponseHaptic(response)

        Task {
            defer {
                isRespondingToFriendRequest = false
            }

            do {
                switch response {
                case .accept:
                    try await apiClient.send(APIClient.acceptMobileFriendRequest(friendRequestID: friendshipID))
                case .decline:
                    try await apiClient.send(APIClient.declineMobileFriendRequest(friendRequestID: friendshipID))
                }
            } catch {
                if let previousResponse {
                    viewModel.restoreLoadedResponse(previousResponse)
                }
                postFriendStatusChange(
                    userID: profile.id,
                    status: .pendingReceived,
                    sourceUser: profile
                )
                ProfileViewModel.confirmFriendRequestStatusChange(userID: profile.id)
            }
        }
    }

    private func unfriend(profile: FriendUserSummary) {
        guard let friendshipID = profile.friendshipID, !friendshipID.isEmpty else {
            return
        }

        guard !isRespondingToFriendRequest else {
            return
        }

        isRespondingToFriendRequest = true
        let previousResponse = viewModel.snapshotLoadedResponse()

        viewModel.updateLoadedResponse { current in
            UserProfileResponse(
                profile: current.profile.map {
                    FriendUserSummary(
                        id: $0.id,
                        friendshipID: nil,
                        name: $0.name,
                        username: $0.username,
                        avatarImageURL: $0.avatarImageURL,
                        city: $0.city,
                        state: $0.state,
                        friendStatus: FriendUserSummary.FriendStatus.none
                    )
                },
                friendCount: max(current.friendCount - 1, 0),
                followingCount: current.followingCount,
                followedPlaces: current.followedPlaces,
                friends: current.friends.filter { $0.id != profile.id },
                upcomingEvents: current.upcomingEvents,
                pastEvents: current.pastEvents
            )
        }
        ProfileViewModel.invalidateCache()
        postFriendStatusChange(userID: profile.id, status: .none)

        Task {
            defer {
                isRespondingToFriendRequest = false
            }

            do {
                try await apiClient.send(
                    APIClient.declineMobileFriendRequest(friendRequestID: friendshipID)
                )
            } catch {
                if let previousResponse {
                    viewModel.restoreLoadedResponse(previousResponse)
                }
                postFriendStatusChange(userID: profile.id, status: .accepted)
            }
        }
    }

    private func postFriendStatusChange(
        userID: String,
        status: FriendUserSummary.FriendStatus,
        sourceUser: FriendUserSummary? = nil
    ) {
        HomeSearchDirectoryViewModel.updateCachedFriendStatus(for: userID, status: status)

        if let sourceUser {
            ProfileViewModel.recordFriendRequestStatusOverride(
                for: sourceUser,
                status: status
            )
        }

        NotificationCenter.default.post(
            name: .friendRequestDidChange,
            object: sourceUser,
            userInfo: [
                "userID": userID,
                "friendStatus": status.rawValue,
            ]
        )
    }

    private var userProfileEventPrefetchKey: String {
        guard case .loaded(let response) = viewModel.state else {
            return "idle"
        }

        return (response.upcomingEvents + response.pastEvents)
            .map(\.id.uuidString)
            .joined(separator: ",")
    }
}

private enum ProfileEventsTab: String, CaseIterable, Identifiable {
    case upcoming
    case past

    var id: String { rawValue }

    var title: String {
        switch self {
        case .upcoming:
            return "Upcoming"
        case .past:
            return "Past"
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

private struct CurrentUserProfileEventsControls: View {
    @Binding var selection: ProfileEventsTab
    @Binding var rsvpFilter: ProfileEventsRSVPFilter

    var body: some View {
        if selection == .past {
            HStack(spacing: 10) {
                ProfileEventsPeriodFilterButton(
                    selection: $selection,
                    rsvpFilter: $rsvpFilter
                )

                ProfilePastEventsFilterButton(rsvpFilter: $rsvpFilter)
            }
            .id("past-event-controls")
            .transaction(disablingAnimations)
        } else {
            ProfileEventsPeriodFilterButton(
                selection: $selection,
                rsvpFilter: $rsvpFilter
            )
            .id("upcoming-event-controls")
            .transaction(disablingAnimations)
        }
    }

    private func disablingAnimations(_ transaction: inout Transaction) {
        transaction.animation = nil
        transaction.disablesAnimations = true
    }
}

private struct ProfileEventsPeriodFilterButton: View {
    @Binding var selection: ProfileEventsTab
    @Binding var rsvpFilter: ProfileEventsRSVPFilter

    var body: some View {
        Menu {
            filterButton(title: "Upcoming", tab: .upcoming, filter: .all)
            filterButton(title: "Past", tab: .past, filter: .going)
        } label: {
            HStack(spacing: 6) {
                Text(selection.title)
                    .lineLimit(1)

                Image(systemName: "chevron.down")
                    .font(.system(size: 11, weight: .bold))
            }
            .frame(maxWidth: .infinity)
            .frame(height: 40)
            .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .accessibilityLabel("Event filter")
        .accessibilityValue("\(selection.title), \(rsvpFilter.title(for: selection))")
        .profileActionButtonStyle(
            kind: .secondary,
            fillsAvailableWidth: true,
            fontWeight: .semibold,
            cornerRadius: 12,
            fontSize: 14
        )
    }

    @ViewBuilder
    private func filterButton(
        title: String,
        tab: ProfileEventsTab,
        filter: ProfileEventsRSVPFilter
    ) -> some View {
        Button {
            var transaction = Transaction(animation: nil)
            transaction.disablesAnimations = true

            withTransaction(transaction) {
                selection = tab
                rsvpFilter = filter
            }
        } label: {
            if tab == selection, filter == rsvpFilter {
                Label(title, systemImage: "checkmark")
            } else {
                Text(title)
            }
        }
    }
}

private struct ProfilePastEventsFilterButton: View {
    @Binding var rsvpFilter: ProfileEventsRSVPFilter

    var body: some View {
        Menu {
            filterButton(title: "Attended", filter: .going)
            filterButton(title: "Interested", filter: .interested)
        } label: {
            HStack(spacing: 6) {
                Text(rsvpFilter == .interested ? "Interested" : "Attended")
                    .lineLimit(1)

                Image(systemName: "chevron.down")
                    .font(.system(size: 11, weight: .bold))
            }
            .frame(maxWidth: .infinity)
            .frame(height: 40)
            .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .accessibilityLabel("Past event filter")
        .profileActionButtonStyle(
            kind: .secondary,
            fillsAvailableWidth: true,
            fontWeight: .semibold,
            cornerRadius: 12,
            fontSize: 14
        )
    }

    @ViewBuilder
    private func filterButton(title: String, filter: ProfileEventsRSVPFilter) -> some View {
        Button {
            var transaction = Transaction(animation: nil)
            transaction.disablesAnimations = true

            withTransaction(transaction) {
                rsvpFilter = filter
            }
        } label: {
            if filter == rsvpFilter {
                Label(title, systemImage: "checkmark")
            } else {
                Text(title)
            }
        }
    }
}

private struct ProfileEventNavControls: View {
    @Binding var selection: ProfileEventsTab
    @Binding var rsvpFilter: ProfileEventsRSVPFilter
    let showsFilter: Bool
    let username: String?
    var showsShare = true
    let onShare: (String) -> Void

    var body: some View {
        if showsFilter, showsShare, let username {
            HStack(spacing: 0) {
                ProfileEventsFilterButton(
                    selection: $selection,
                    rsvpFilter: $rsvpFilter,
                    useCombinedStyle: true
                )

                ProfileShareNavButton(username: username, onShare: onShare, useCombinedStyle: true)
            }
            .frame(height: 46)
            .clipShape(Capsule())
            .profileLiquidGlass(in: Capsule())
        } else if showsFilter {
            ProfileEventsFilterButton(selection: $selection, rsvpFilter: $rsvpFilter)
        } else if showsShare, let username {
            ProfileShareNavButton(username: username, onShare: onShare)
        }
    }
}

private struct ProfileTopUsername: View {
    let username: String
    var alignment: Alignment = .center

    var body: some View {
        Text(username)
            .font(.system(size: 17, weight: .bold))
            .foregroundStyle(.white)
            .lineLimit(1)
            .minimumScaleFactor(0.72)
            .frame(maxWidth: 150, alignment: alignment)
            .allowsHitTesting(false)
            .accessibilityAddTraits(.isHeader)
    }
}

private struct ProfileFadingTopUsername: View {
    let username: String
    var alignment: Alignment = .center
    let visibility: ScrollableHeaderVisibility

    var body: some View {
        ProfileTopUsername(username: username, alignment: alignment)
            .opacity(visibility.isVisible ? 1 : 0)
    }
}

private struct ProfileShareNavButton: View {
    let username: String
    let onShare: (String) -> Void
    var useCombinedStyle = false

    var body: some View {
        Button {
            onShare(username)
        } label: {
            Image(systemName: "square.and.arrow.up")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 46, height: 46)
                .contentShape(Rectangle())
                .modifier(ProfileNavControlStyle(isCombined: useCombinedStyle))
        }
        .buttonStyle(.plain)
    }
}

private struct ProfileEventsFilterButton: View {
    @Binding var selection: ProfileEventsTab
    @Binding var rsvpFilter: ProfileEventsRSVPFilter
    var useCombinedStyle = false

    private var hasActiveFilter: Bool {
        selection != .upcoming || rsvpFilter != .all
    }

    var body: some View {
        Menu {
            Section("Events") {
                ForEach(ProfileEventsTab.allCases) { tab in
                    Button {
                        withAnimation(.snappy(duration: 0.22)) {
                            selection = tab
                            if tab == .past {
                                rsvpFilter = .going
                            }
                        }
                    } label: {
                        if tab == selection {
                            Label(tab.title, systemImage: "checkmark")
                        } else {
                            Text(tab.title)
                        }
                    }
                }
            }

            Section("RSVP") {
                ForEach(ProfileEventsRSVPFilter.allCases) { filter in
                    Button {
                        withAnimation(.snappy(duration: 0.22)) {
                            rsvpFilter = filter
                        }
                    } label: {
                        if filter == rsvpFilter {
                            Label(filter.title(for: selection), systemImage: "checkmark")
                        } else {
                            Text(filter.title(for: selection))
                        }
                    }
                }
            }
        } label: {
            Image(systemName: "line.3.horizontal.decrease")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(hasActiveFilter ? AppTheme.accentBlue : .primary)
                .frame(width: 46, height: 46)
                .contentShape(Rectangle())
                .modifier(ProfileNavControlStyle(isCombined: useCombinedStyle))
        }
        .buttonStyle(.plain)
    }
}

private struct ProfileNavControlStyle: ViewModifier {
    let isCombined: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if isCombined {
            content
        } else {
            content.profileLiquidGlass(in: Circle())
        }
    }
}

private enum ProfileEventsRSVPFilter: String, CaseIterable, Identifiable {
    case all
    case going
    case interested

    var id: String { rawValue }

    func title(for tab: ProfileEventsTab) -> String {
        switch self {
        case .all:
            return "All RSVPs"
        case .going:
            return tab == .past ? "Attended" : "Going"
        case .interested:
            return "Interested"
        }
    }

    func filtered(events: [EventFeedItem]) -> [EventFeedItem] {
        switch self {
        case .all:
            return events
        case .going:
            return events.filter { $0.userRsvpStatus == .going }
        case .interested:
            return events.filter { $0.userRsvpStatus == .interested }
        }
    }
}

private struct UserProfileEventsSection: View {
    let response: UserProfileResponse
    let isCurrentUser: Bool
    @Binding var selectedEventsTab: ProfileEventsTab
    @Binding var selectedEventsRSVPFilter: ProfileEventsRSVPFilter

    private var canViewEventDetails: Bool {
        isCurrentUser || response.profile?.friendStatus == .accepted
    }

    var body: some View {
        let displayWindow = EventFeedDisplayWindow.partition(
            upcoming: response.upcomingEvents,
            past: response.pastEvents
        )
        let events = selectedEventsRSVPFilter.filtered(
            events: selectedEventsTab == .upcoming ? displayWindow.upcoming : displayWindow.past
        )
        let groups = ProfileEventGrouper.groups(for: events, mode: selectedEventsTab)

        VStack(alignment: .leading, spacing: 18) {
            if groups.isEmpty {
                ProfileEmptyEventsPlaceholder(
                    message: "There aren’t any \(selectedEventsTab.emptyStateName) events to show yet."
                )
            } else {
                ForEach(groups) { group in
                    EventCardCarousel(
                        events: group.events,
                        cardWidth: 220,
                        verticalSpacing: 10
                    ) {
                        Text(group.label)
                            .font(.system(size: 20, weight: .bold))
                            .foregroundStyle(.white)
                    } card: { event in
                        if canViewEventDetails {
                            EventDetailNavigationLink(event: event) {
                                EventCardView(event: event)
                            }
                        } else {
                            EventCardView(event: event, obscuresDetails: true)
                        }
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

private struct ProfileHeader: View {
    let profile: FriendUserSummary?
    let isUploadingAvatar: Bool
    let isAvatarMenuPresented: Binding<Bool>?
    let onChooseAvatarPhoto: (() -> Void)?
    let onTakeAvatarPhoto: (() -> Void)?
    let summary: AnyView
    @State private var isAvatarImageViewerPresented = false

    init<Summary: View>(
        profile: FriendUserSummary?,
        isUploadingAvatar: Bool,
        isAvatarMenuPresented: Binding<Bool>?,
        onChooseAvatarPhoto: (() -> Void)? = nil,
        onTakeAvatarPhoto: (() -> Void)? = nil,
        @ViewBuilder summary: () -> Summary
    ) {
        self.profile = profile
        self.isUploadingAvatar = isUploadingAvatar
        self.isAvatarMenuPresented = isAvatarMenuPresented
        self.onChooseAvatarPhoto = onChooseAvatarPhoto
        self.onTakeAvatarPhoto = onTakeAvatarPhoto
        self.summary = AnyView(summary())
    }

    var body: some View {
        HStack(alignment: .bottom, spacing: 20) {
            avatar

            if let profile {
                VStack(alignment: .leading, spacing: 14) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text(profile.name)
                            .font(.system(size: 17, weight: .bold))
                            .foregroundStyle(.white)
                            .lineLimit(2)
                            .minimumScaleFactor(0.76)

                        if let locationText = profile.locationText {
                            Text(locationText)
                                .font(.system(size: 12, weight: .medium))
                                .lineLimit(1)
                                .foregroundStyle(.white.opacity(0.58))
                        }
                    }

                    summary
                }
                .frame(maxWidth: .infinity, minHeight: 104, alignment: .bottomLeading)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .fullScreenCover(isPresented: $isAvatarImageViewerPresented) {
            if let avatarImageURL = profile?.avatarImageURL {
                EventArtworkViewer(imageURL: avatarImageURL)
            }
        }
    }

    @ViewBuilder
    private var avatar: some View {
        if let isAvatarMenuPresented {
            Button {
                isAvatarMenuPresented.wrappedValue = true
            } label: {
                ZStack(alignment: .bottomTrailing) {
                    FriendAvatarView(user: profile, size: 104)

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
                    .offset(x: 2, y: 2)
                }
            }
            .buttonStyle(.plain)
            .disabled(isUploadingAvatar)
            .accessibilityLabel("Edit profile picture")
            .popover(
                isPresented: isAvatarMenuPresented,
                attachmentAnchor: .rect(.bounds),
                arrowEdge: .top
            ) {
                ProfileAvatarActionPopover(
                    canShowCamera: UIImagePickerController.isSourceTypeAvailable(.camera),
                    onChoosePhoto: {
                        onChooseAvatarPhoto?()
                    },
                    onTakePhoto: {
                        onTakeAvatarPhoto?()
                    }
                )
                .presentationCompactAdaptation(.popover)
            }
        } else if profile?.avatarImageURL != nil {
            Button {
                isAvatarImageViewerPresented = true
            } label: {
                FriendAvatarView(user: profile, size: 104)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("View profile picture")
        } else {
            FriendAvatarView(user: profile, size: 104)
        }
    }
}

private struct ProfileAvatarActionPopover: View {
    let canShowCamera: Bool
    let onChoosePhoto: () -> Void
    let onTakePhoto: () -> Void

    @Environment(\.dismiss) private var dismiss

    var body: some View {
        VStack(alignment: .leading, spacing: 4) {
            Button {
                dismiss()
                onChoosePhoto()
            } label: {
                Label("Choose Photo", systemImage: "photo.on.rectangle")
                    .frame(maxWidth: .infinity, alignment: .leading)
            }
            .buttonStyle(.plain)
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .padding(.vertical, 10)

            if canShowCamera {
                Button {
                    dismiss()
                    onTakePhoto()
                } label: {
                    Label("Take Photo", systemImage: "camera")
                        .frame(maxWidth: .infinity, alignment: .leading)
                }
                .buttonStyle(.plain)
                .foregroundStyle(.white)
                .padding(.horizontal, 14)
                .padding(.vertical, 10)
            }
        }
        .frame(width: 190, alignment: .leading)
        .padding(.vertical, 8)
        .background(ProfileTheme.cardBackground)
    }
}

private struct RelationshipSummaryRow: View {
    let response: FriendsFeedResponse
    let partnerRelationship: MobilePartnerRelationship?
    let availablePartnerCount: Int
    let isPartnerBusy: Bool
    let onChoosePartner: () -> Void
    let onAcceptPartner: () -> Void
    let onDeclinePartner: () -> Void
    let onCancelPartnerRequest: () -> Void
    let onChangePartner: () -> Void
    let onRemovePartner: () -> Void
    let onRemoveFriend: (FriendUserSummary) -> Void
    let onAcceptFriendRequest: (FriendUserSummary) async -> Bool
    let onDeclineFriendRequest: (FriendUserSummary) async -> Bool

    var body: some View {
        HStack(spacing: 0) {
            NavigationLink {
                MyFriendsView(
                    response: response,
                    partnerRelationship: partnerRelationship,
                    availablePartnerCount: availablePartnerCount,
                    isPartnerBusy: isPartnerBusy,
                    onChoosePartner: onChoosePartner,
                    onAcceptPartner: onAcceptPartner,
                    onDeclinePartner: onDeclinePartner,
                    onCancelPartnerRequest: onCancelPartnerRequest,
                    onChangePartner: onChangePartner,
                    onRemovePartner: onRemovePartner,
                    onRemoveFriend: onRemoveFriend
                )
            } label: {
                RelationshipSummaryLink(count: response.friendCount, label: "Friends")
            }
            .buttonStyle(.plain)

            NavigationLink {
                FollowingPlacesView(places: response.followedPlaces)
            } label: {
                RelationshipSummaryLink(count: response.followingCount, label: "Following")
            }
            .buttonStyle(.plain)

            NavigationLink {
                FriendRequestsView(
                    receivedRequests: response.receivedRequests,
                    sentRequests: response.sentRequests,
                    onAcceptRequest: onAcceptFriendRequest,
                    onDeclineRequest: onDeclineFriendRequest
                )
            } label: {
                RelationshipSummaryLink(
                    count: response.requestCount,
                    label: "Requests",
                    showsIndicator: response.requestCount > 0
                )
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity)
    }
}

private struct MyFriendsView: View {
    let response: FriendsFeedResponse
    let partnerRelationship: MobilePartnerRelationship?
    let availablePartnerCount: Int
    let isPartnerBusy: Bool
    let onChoosePartner: () -> Void
    let onAcceptPartner: () -> Void
    let onDeclinePartner: () -> Void
    let onCancelPartnerRequest: () -> Void
    let onChangePartner: () -> Void
    let onRemovePartner: () -> Void
    let onRemoveFriend: (FriendUserSummary) -> Void
    @State private var selectedSection: FriendsPageSection = .friends
    @State private var pendingFriendRemoval: FriendUserSummary?

    var body: some View {
        RelationshipListScreen(title: "Friends") {
            VStack(alignment: .leading, spacing: 14) {
                RelationshipFilterPills(
                    titles: FriendsPageSection.allCases.map(\.title),
                    selection: Binding(
                        get: { FriendsPageSection.allCases.firstIndex(of: selectedSection) ?? 0 },
                        set: { selectedSection = FriendsPageSection.allCases[$0] }
                    )
                )

                switch selectedSection {
                case .friends:
                    FriendsListViewContent(
                        friends: response.friends,
                        onRemoveFriend: { friend in
                            pendingFriendRemoval = friend
                        }
                    )

                case .partner:
                    PartnerManagementCard(
                        relationship: partnerRelationship,
                        availableFriendCount: availablePartnerCount,
                        isBusy: isPartnerBusy,
                        onChoosePartner: onChoosePartner,
                        onAccept: onAcceptPartner,
                        onDecline: onDeclinePartner,
                        onCancelRequest: onCancelPartnerRequest,
                        onChangePartner: onChangePartner,
                        onRemovePartner: onRemovePartner
                    )
                }
            }
        }
        .alert(
            "Remove Friend?",
            isPresented: Binding(
                get: { pendingFriendRemoval != nil },
                set: { isPresented in
                    if !isPresented {
                        pendingFriendRemoval = nil
                    }
                }
            )
        ) {
            Button("Remove", role: .destructive) {
                if let pendingFriendRemoval {
                    onRemoveFriend(pendingFriendRemoval)
                    self.pendingFriendRemoval = nil
                }
            }

            Button("Cancel", role: .cancel) {
                pendingFriendRemoval = nil
            }
        } message: {
            if let pendingFriendRemoval {
                Text("Remove \(pendingFriendRemoval.name) from your friends?")
            }
        }
    }
}

private enum FriendsPageSection: CaseIterable {
    case friends
    case partner

    var title: String {
        switch self {
        case .friends: "Friends"
        case .partner: "Partner"
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
            if let relationship {
                partnerStateView(relationship)
            } else {
                Button {
                    onChoosePartner()
                } label: {
                    Text("Add Partner")
                        .frame(maxWidth: .infinity)
                        .frame(height: 40)
                        .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                }
                .profileActionButtonStyle(
                    kind: .accent,
                    isDisabled: availableFriendCount == 0 || isBusy,
                    fillsAvailableWidth: true,
                    fontWeight: .semibold,
                    cornerRadius: 12,
                    fontSize: 15
                )
                .disabled(availableFriendCount == 0 || isBusy)
                .accessibilityHint(
                    availableFriendCount == 0
                        ? "Add an accepted friend before choosing a partner."
                        : "Choose a partner from your accepted friends."
                )
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    @ViewBuilder
    private func partnerAvatarRow(_ partner: MobilePartnerUser, trailing: AnyView? = nil) -> some View {
        HStack(spacing: 8) {
            NavigationLink {
                UserProfileView(userID: partner.id)
            } label: {
                CompactUserListRowView(
                    imageURL: partner.avatarImageURL,
                    name: [partner.firstName, partner.lastName]
                        .compactMap { $0 }
                        .joined(separator: " ")
                        .trimmingCharacters(in: .whitespacesAndNewlines)
                        .ifEmpty(partner.username),
                    subtitle: "@\(partner.username)",
                    identityKey: partner.id
                )
            }
            .buttonStyle(.plain)

            if let trailing {
                trailing
            }
        }
    }

    @ViewBuilder
    private func partnerStateView(_ relationship: MobilePartnerRelationship) -> some View {
        let partner = relationship.partner

        VStack(alignment: .leading, spacing: 14) {
            switch relationship.status {
            case "accepted":
                partnerAvatarRow(
                    partner,
                    trailing: AnyView(
                        Menu {
                            Button("Remove", role: .destructive) {
                                onRemovePartner()
                            }
                        } label: {
                            Image(systemName: "ellipsis")
                                .font(.system(size: 18, weight: .bold))
                                .foregroundStyle(.white.opacity(isBusy ? 0.4 : 0.9))
                                .frame(width: 32, height: 32)
                                .contentShape(Circle())
                        }
                        .disabled(isBusy)
                    )
                )

            case "pending":
                if relationship.isRequester {
                    partnerAvatarRow(
                        partner,
                        trailing: AnyView(
                            Button("Cancel") {
                                onCancelRequest()
                            }
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(.red.opacity(0.85))
                            .disabled(isBusy)
                        )
                    )
                } else {
                    partnerAvatarRow(partner)
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
    @State private var pendingPartner: FriendUserSummary?

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
        ZStack {
            Color(red: 0.11, green: 0.11, blue: 0.13)
                .ignoresSafeArea()

            ScrollView {
                VStack(alignment: .leading, spacing: 20) {
                    VStack(alignment: .leading, spacing: 8) {
                        Text("Choose a partner from your accepted friends.")
                            .font(.system(size: 20, weight: .bold))
                            .foregroundStyle(.white)

                        Text("Partners can add or update RSVP statuses for both of you. Your friends may see your names together in activity and event attendance.")
                            .font(.system(size: 14, weight: .medium))
                            .foregroundStyle(.white.opacity(0.64))
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    TextField("Search accepted friends...", text: $searchText)
                        .font(.system(size: 16, weight: .medium))
                        .foregroundStyle(.white)
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()
                        .padding(.horizontal, 16)
                        .frame(height: 50)
                        .background(
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .fill(.black.opacity(0.28))
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .strokeBorder(.white.opacity(0.08), lineWidth: 1)
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
                        VStack(spacing: 2) {
                            ForEach(filteredFriends) { friend in
                                Button {
                                    pendingPartner = friend
                                } label: {
                                    CompactUserListRowView(
                                        imageURL: friend.avatarImageURL,
                                        name: friend.name,
                                        subtitle: friend.usernameText,
                                        identityKey: friend.id
                                    )
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                }
                .padding(16)
                .padding(.top, 16)
                .padding(.bottom, 26)
            }
        }
        .alert(item: $pendingPartner) { friend in
            Alert(
                title: Text("Add \(friend.name) as your partner?"),
                message: Text("This will send \(friend.name) a partner request. They’ll need to accept before either of you can manage RSVP statuses for both of you."),
                primaryButton: .default(Text("Send Request")) {
                    onSelectFriend(friend)
                    dismiss()
                },
                secondaryButton: .cancel()
            )
        }
    }
}

private struct UserRelationshipSummaryRow: View {
    let response: UserProfileResponse

    var body: some View {
        HStack(spacing: 0) {
            NavigationLink {
                FriendsListView(title: "Friends", friends: response.friends)
            } label: {
                RelationshipSummaryLink(count: response.friendCount, label: "Friends")
            }
            .buttonStyle(.plain)

            NavigationLink {
                FollowingPlacesView(places: response.followedPlaces ?? [])
            } label: {
                RelationshipSummaryLink(count: response.followingCount ?? 0, label: "Following")
            }
            .buttonStyle(.plain)

            RelationshipSummaryLink(count: 0, label: "Requests")
                .hidden()
                .accessibilityHidden(true)
        }
        .frame(maxWidth: .infinity)
    }
}

private struct RelationshipSummaryLink: View {
    let count: Int
    let label: String
    var showsIndicator = false

    private var displayLabel: String {
        guard count == 1 else { return label }

        return switch label {
        case "Friends": "Friend"
        case "Requests": "Request"
        default: label
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            HStack(spacing: 4) {
                Text("\(count)")
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white)

                if showsIndicator {
                    Circle()
                        .fill(.red)
                        .frame(width: 6, height: 6)
                }
            }

            Text(displayLabel)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.white.opacity(0.58))
                .lineLimit(1)
                .minimumScaleFactor(0.78)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct RelationshipSectionHeader: View {
    let title: String

    var body: some View {
        Text(title)
            .font(.system(size: 20, weight: .bold))
            .foregroundStyle(.white)
    }
}

private struct FriendsListView: View {
    let title: String
    let friends: [FriendUserSummary]

    var body: some View {
        RelationshipListScreen(title: title) {
            FriendsListViewContent(friends: friends)
        }
    }
}

private struct FollowingPlacesView: View {
    let places: [PlaceListItem]

    var body: some View {
        RelationshipListScreen(title: "Following") {
            if places.isEmpty {
                EmptyRelationshipCard(
                    systemImage: "building.2",
                    message: "No followed places yet"
                )
            } else {
                CompactPlaceListView(places: places)
            }
        }
    }
}

private struct FriendsListViewContent: View {
    let friends: [FriendUserSummary]
    var onRemoveFriend: ((FriendUserSummary) -> Void)? = nil

    var body: some View {
        if friends.isEmpty {
            EmptyRelationshipCard(
                systemImage: "person.2",
                message: "No friends yet"
            )
        } else {
            VStack(spacing: 2) {
                ForEach(friends) { friend in
                    HStack(spacing: 8) {
                        NavigationLink {
                            UserProfileView(userID: friend.id)
                        } label: {
                            friendRow(friend)
                        }
                        .buttonStyle(.plain)

                        if let onRemoveFriend {
                            Menu {
                                Button("Remove", role: .destructive) {
                                    onRemoveFriend(friend)
                                }
                            } label: {
                                Image(systemName: "ellipsis")
                                    .font(.system(size: 18, weight: .bold))
                                    .foregroundStyle(.white.opacity(0.9))
                                    .frame(width: 32, height: 32)
                                    .contentShape(Circle())
                            }
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func friendRow(_ friend: FriendUserSummary) -> some View {
        CompactUserListRowView(
            imageURL: friend.avatarImageURL,
            name: friend.name,
            subtitle: friend.usernameText,
            identityKey: friend.id
        )
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }
}

private struct FriendRequestsView: View {
    let sourceReceivedRequests: [FriendUserSummary]
    let sourceSentRequests: [FriendUserSummary]
    let onAcceptRequest: (FriendUserSummary) async -> Bool
    let onDeclineRequest: (FriendUserSummary) async -> Bool
    @EnvironmentObject private var activityRequestStore: ActivityRequestStore
    @State private var receivedRequests: [FriendUserSummary]
    @State private var sentRequests: [FriendUserSummary]
    @State private var selectedSection: RequestsPageSection = .received
    @State private var activeRequestID: String?
    @State private var selectedUserProfile: RequestSelectedUserProfile?
    @State private var pendingDeleteRequest: FriendUserSummary?
    @State private var requestConfirmation: FriendRequestConfirmation?
    @State private var requestConfirmationToken = UUID()
    @State private var isRequestConfirmationVisible = false

    init(
        receivedRequests: [FriendUserSummary],
        sentRequests: [FriendUserSummary],
        onAcceptRequest: @escaping (FriendUserSummary) async -> Bool,
        onDeclineRequest: @escaping (FriendUserSummary) async -> Bool
    ) {
        self.sourceReceivedRequests = receivedRequests
        self.sourceSentRequests = sentRequests
        self.onAcceptRequest = onAcceptRequest
        self.onDeclineRequest = onDeclineRequest
        _receivedRequests = State(initialValue: receivedRequests)
        _sentRequests = State(initialValue: sentRequests)
    }

    var body: some View {
        RelationshipListScreen(title: "Requests") {
            VStack(alignment: .leading, spacing: 14) {
                RelationshipFilterPills(
                    titles: RequestsPageSection.allCases.map(\.title),
                    counts: [receivedRequests.count, sentRequests.count],
                    selection: Binding(
                        get: { RequestsPageSection.allCases.firstIndex(of: selectedSection) ?? 0 },
                        set: { selectedSection = RequestsPageSection.allCases[$0] }
                    )
                )

                switch selectedSection {
                case .received:
                    receivedRequestsContent
                case .sent:
                    if sentRequests.isEmpty {
                        EmptyRequestPlaceholder(message: "No sent requests")
                    } else {
                        VStack(spacing: 2) {
                            ForEach(sentRequests) { request in
                                Button {
                                    selectedUserProfile = RequestSelectedUserProfile(id: request.id)
                                } label: {
                                    CompactUserListRowView(
                                        imageURL: request.avatarImageURL,
                                        name: request.name,
                                        subtitle: request.usernameText,
                                        identityKey: request.id
                                    )
                                    .frame(maxWidth: .infinity, alignment: .leading)
                                    .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .frame(maxWidth: .infinity, alignment: .leading)
                            }
                        }
                    }
                }
            }
        }
        .navigationDestination(item: $selectedUserProfile) { selection in
            UserProfileView(userID: selection.id)
        }
        .onChange(of: sourceReceivedRequests) { _, newRequests in
            receivedRequests = newRequests
        }
        .onChange(of: sourceSentRequests) { _, newRequests in
            sentRequests = newRequests
        }
        .alert(item: $pendingDeleteRequest) { request in
            Alert(
                title: Text("Decline friend request?"),
                message: Text("Decline the friend request from \(request.name)?"),
                primaryButton: .destructive(Text("Decline")) {
                    submit(.decline, for: request)
                },
                secondaryButton: .cancel()
            )
        }
        .overlay {
            if let requestConfirmation {
                VStack {
                    HStack {
                        Spacer(minLength: 0)

                        FriendRequestConfirmationToast(confirmation: requestConfirmation)
                            .fixedSize(horizontal: true, vertical: false)

                        Spacer(minLength: 0)
                    }
                    .padding(.top, 10)

                    Spacer(minLength: 0)
                }
                .offset(y: isRequestConfirmationVisible ? 0 : -110)
                .opacity(isRequestConfirmationVisible ? 1 : 0)
                .scaleEffect(isRequestConfirmationVisible ? 1 : 0.94)
                .allowsHitTesting(false)
                .animation(
                    .spring(response: 0.35, dampingFraction: 0.60),
                    value: isRequestConfirmationVisible
                )
            }
        }
    }

    @ViewBuilder
    private var receivedRequestsContent: some View {
        if receivedRequests.isEmpty {
            EmptyRequestPlaceholder(message: "No pending friend requests")
        } else {
            VStack(spacing: 2) {
                ForEach(receivedRequests) { request in
                    HStack(spacing: 8) {
                        Button {
                            selectedUserProfile = RequestSelectedUserProfile(id: request.id)
                        } label: {
                            CompactUserListRowView(
                                imageURL: request.avatarImageURL,
                                name: request.name,
                                subtitle: request.usernameText,
                                identityKey: request.id
                            )
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .frame(maxWidth: .infinity, alignment: .leading)

                        HStack(spacing: 8) {
                            Button {
                                pendingDeleteRequest = request
                            } label: {
                                Text("Decline")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(.white.opacity(0.82))
                                    .padding(.horizontal, 11)
                                    .frame(height: 34)
                                    .background(
                                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                                            .fill(Color.white.opacity(0.10))
                                    )
                            }
                            .buttonStyle(.plain)
                            .disabled(activeRequestID != nil)

                            Button {
                                submit(.accept, for: request)
                            } label: {
                                Text("Accept")
                                    .font(.system(size: 12, weight: .semibold))
                                    .foregroundStyle(.black)
                                    .padding(.horizontal, 12)
                                    .frame(height: 34)
                                    .background(
                                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                                            .fill(AppTheme.accentBlue)
                                    )
                            }
                            .buttonStyle(.plain)
                            .disabled(activeRequestID != nil)
                        }
                        .opacity(activeRequestID != nil ? 0.5 : 1)
                    }
                }
            }
        }
    }

    private func submit(_ response: ActivityRequestResponse, for request: FriendUserSummary) {
        activeRequestID = request.id
        playFriendRequestResponseHaptic(response)

        Task {
            let previousReceivedRequests = receivedRequests
            withAnimation(.snappy(duration: 0.2)) {
                receivedRequests.removeAll { $0.id == request.id }
            }

            let succeeded: Bool
            switch response {
            case .accept:
                succeeded = await onAcceptRequest(request)
            case .decline:
                succeeded = await onDeclineRequest(request)
            }

            if !succeeded {
                withAnimation(.snappy(duration: 0.2)) {
                    receivedRequests = previousReceivedRequests
                }
            } else if let friendshipID = request.friendshipID, let requestID = UUID(uuidString: friendshipID) {
                activityRequestStore.record(response, for: requestID)
            }

            if succeeded {
                showRequestConfirmation(response, for: request)
            }

            activeRequestID = nil
        }
    }

    private func showRequestConfirmation(
        _ response: ActivityRequestResponse,
        for request: FriendUserSummary
    ) {
        let confirmation = FriendRequestConfirmation(response: response, name: request.name)
        requestConfirmationToken = confirmation.id
        isRequestConfirmationVisible = false
        requestConfirmation = confirmation

        Task { @MainActor in
            await Task.yield()
            guard requestConfirmationToken == confirmation.id else {
                return
            }

            withAnimation(.spring(response: 0.35, dampingFraction: 0.60)) {
                isRequestConfirmationVisible = true
            }
        }

        Task { @MainActor in
            try? await Task.sleep(for: .seconds(2))
            guard requestConfirmationToken == confirmation.id else {
                return
            }

            withAnimation(.spring(response: 0.28, dampingFraction: 0.82)) {
                isRequestConfirmationVisible = false
            }

            try? await Task.sleep(for: .milliseconds(300))
            guard requestConfirmationToken == confirmation.id else {
                return
            }

            requestConfirmation = nil
        }
    }
}

private enum RequestsPageSection: CaseIterable {
    case received
    case sent

    var title: String {
        switch self {
        case .received: "Requests"
        case .sent: "Sent"
        }
    }
}

private struct FriendRequestConfirmation: Identifiable, Equatable {
    let id = UUID()
    let response: ActivityRequestResponse
    let name: String

    var title: String {
        switch response {
        case .accept:
            return "Accepted \(firstName)"
        case .decline:
            return "Declined \(firstName)'s request"
        }
    }

    var systemImage: String {
        response == .accept ? "checkmark.circle.fill" : "trash.circle.fill"
    }

    var tint: Color {
        response == .accept ? AppTheme.accentBlue : Color(red: 0.92, green: 0.36, blue: 0.40)
    }

    private var firstName: String {
        name.split(separator: " ").first.map(String.init) ?? name
    }
}

private struct FriendRequestConfirmationToast: View {
    let confirmation: FriendRequestConfirmation

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: confirmation.systemImage)
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(confirmation.tint)
                .symbolEffect(.bounce, value: confirmation.id)

            Text(confirmation.title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)
        }
        .padding(.horizontal, 16)
        .frame(height: 52)
        .profileLiquidGlass(in: Capsule())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(confirmation.title)
    }
}

private struct RequestsPageLoadingContent: View {
    var body: some View {
        RelationshipListScreen(title: "Requests") {
            NativeLoadingView()
                .frame(minHeight: 320)
        }
    }
}

struct RequestsPageView: View {
    @Environment(\.apiClient) private var apiClient
    @StateObject private var viewModel = ProfileViewModel()
    @State private var errorMessage: String?

    var body: some View {
        Group {
            switch viewModel.state {
            case .idle, .loading:
                RequestsPageLoadingContent()

            case .failed(let message):
                RelationshipListScreen(title: "Requests") {
                    ContentUnavailableView {
                        Label("Couldn't Load Requests", systemImage: "wifi.exclamationmark")
                    } description: {
                        Text(message)
                    } actions: {
                        Button("Try Again") {
                            Task {
                                await viewModel.load(using: apiClient, forceRefresh: true)
                            }
                        }
                    }
                    .foregroundStyle(.white)
                    .frame(minHeight: 320)
                }

            case .loaded(let response):
                FriendRequestsView(
                    receivedRequests: response.receivedRequests,
                    sentRequests: response.sentRequests,
                    onAcceptRequest: { request in
                        await respondToFriendRequest(request, response: .accept)
                    },
                    onDeclineRequest: { request in
                        await respondToFriendRequest(request, response: .decline)
                    }
                )
            }
        }
        .onAppear {
            Task {
                await viewModel.load(using: apiClient, forceRefresh: true)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .friendRequestDidChange)) { notification in
            if let user = notification.object as? FriendUserSummary,
               let rawStatus = notification.userInfo?["friendStatus"] as? String,
               let status = FriendUserSummary.FriendStatus(rawValue: rawStatus) {
                viewModel.applyFriendRequestStatusChange(for: user, status: status)
            } else {
                Task {
                    await viewModel.load(using: apiClient, forceRefresh: true)
                }
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .appDataDidChange)) { _ in
            Task {
                await viewModel.load(using: apiClient, forceRefresh: true)
            }
        }
        .refreshable {
            await viewModel.load(using: apiClient, forceRefresh: true)
        }
        .alert(
            "Couldn't Update Request",
            isPresented: Binding(
                get: { errorMessage != nil },
                set: { isPresented in
                    if !isPresented {
                        errorMessage = nil
                    }
                }
            )
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(errorMessage ?? "Please try again.")
        }
    }

    private func respondToFriendRequest(
        _ request: FriendUserSummary,
        response: ActivityRequestResponse
    ) async -> Bool {
        var resolvedRequest = request

        if resolvedRequest.friendshipID == nil || resolvedRequest.friendshipID?.isEmpty == true {
            await viewModel.load(using: apiClient, forceRefresh: true)

            if let refreshedRequest = viewModel
                .snapshotLoadedResponse()?
                .receivedRequests
                .first(where: { $0.id == request.id && $0.friendshipID?.isEmpty == false }) {
                resolvedRequest = refreshedRequest
            }
        }

        let requestIdentifier = resolvedRequest.friendshipID?.isEmpty == false
            ? resolvedRequest.friendshipID!
            : resolvedRequest.id

        let previousResponse = viewModel.snapshotLoadedResponse()

        switch response {
        case .accept:
            viewModel.updateLoadedResponse { current in
                FriendsFeedResponse(
                    profile: current.profile,
                    friendCount: current.friendCount + 1,
                    requestCount: max(current.requestCount - 1, 0),
                    followingCount: current.followingCount,
                    followedPlaces: current.followedPlaces,
                    friends: current.friends + [
                        FriendUserSummary(
                            id: resolvedRequest.id,
                            friendshipID: resolvedRequest.friendshipID,
                            name: resolvedRequest.name,
                            username: resolvedRequest.username,
                            avatarImageURL: resolvedRequest.avatarImageURL,
                            city: resolvedRequest.city,
                            state: resolvedRequest.state,
                            friendStatus: .accepted
                        )
                    ],
                    receivedRequests: current.receivedRequests.filter { $0.id != resolvedRequest.id },
                    sentRequests: current.sentRequests,
                    upcomingEvents: current.upcomingEvents,
                    pastEvents: current.pastEvents
                )
            }
        case .decline:
            viewModel.updateLoadedResponse { current in
                FriendsFeedResponse(
                    profile: current.profile,
                    friendCount: current.friendCount,
                    requestCount: max(current.requestCount - 1, 0),
                    followingCount: current.followingCount,
                    followedPlaces: current.followedPlaces,
                    friends: current.friends,
                    receivedRequests: current.receivedRequests.filter { $0.id != resolvedRequest.id },
                    sentRequests: current.sentRequests,
                    upcomingEvents: current.upcomingEvents,
                    pastEvents: current.pastEvents
                )
            }
        }

        postOptimisticFriendRequestChange(
            for: resolvedRequest,
            status: response == .accept ? .accepted : .none
        )

        do {
            switch response {
            case .accept:
                try await apiClient.send(APIClient.acceptMobileFriendRequest(friendRequestID: requestIdentifier))
            case .decline:
                try await apiClient.send(APIClient.declineMobileFriendRequest(friendRequestID: requestIdentifier))
            }
            return true
        } catch {
            if let previousResponse {
                viewModel.restoreLoadedResponse(previousResponse)
            }
            postOptimisticFriendRequestChange(for: resolvedRequest, status: .pendingReceived)
            errorMessage = error.localizedDescription
            return false
        }
    }
}

@MainActor
private func postOptimisticFriendRequestChange(
    for user: FriendUserSummary,
    status: FriendUserSummary.FriendStatus
) {
    ProfileViewModel.recordFriendRequestStatusOverride(for: user, status: status)
    HomeSearchDirectoryViewModel.updateCachedFriendStatus(for: user.id, status: status)
    NotificationCenter.default.post(
        name: .friendRequestDidChange,
        object: user,
        userInfo: [
            "userID": user.id,
            "friendStatus": status.rawValue,
        ]
    )
}

@MainActor
private func playFriendRequestResponseHaptic(_ response: ActivityRequestResponse) {
    switch response {
    case .accept:
        ConfirmationHaptic.play()
    case .decline:
        UIImpactFeedbackGenerator(style: .medium).impactOccurred()
    }
}

private struct RequestSelectedUserProfile: Identifiable, Hashable {
    let id: String
}

private struct RelationshipListScreen<Content: View>: View {
    let title: String?
    let content: Content
    @Environment(\.dismiss) private var dismiss

    init(title: String? = nil, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                content
            }
            .padding(.horizontal, 16)
            .padding(.top, 60)
            .padding(.bottom, 18)
        }
        .background(ProfileTheme.background.ignoresSafeArea())
        .background(SwipeBackEnabler())
        .toolbar(.hidden, for: .navigationBar)
        .navigationBarBackButtonHidden()
        .navigationBarTitleDisplayMode(.inline)
        .overlay(alignment: .top) {
            ZStack {
                if let title {
                    Text(title)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .accessibilityAddTraits(.isHeader)
                }

                HStack {
                    FloatingGlassIconButton(systemImage: "chevron.left") {
                        dismiss()
                    }

                    Spacer()
                }
            }
            .frame(height: 46)
            .padding(.horizontal, 16)
        }
    }
}

private struct RelationshipFilterPills: View {
    let titles: [String]
    var counts: [Int]? = nil
    @Binding var selection: Int

    var body: some View {
        ScopePillBar {
            ForEach(titles.indices, id: \.self) { index in
                ScopePill(
                    title: titles[index],
                    count: counts.flatMap { values in
                        values.indices.contains(index) ? values[index] : nil
                    },
                    isSelected: selection == index
                ) {
                    selection = index
                }
            }
        }
    }
}

private struct RelationshipCard<Content: View>: View {
    let horizontalPadding: CGFloat
    let verticalPadding: CGFloat
    let content: Content

    init(
        horizontalPadding: CGFloat = 16,
        verticalPadding: CGFloat = 14,
        @ViewBuilder content: () -> Content
    ) {
        self.horizontalPadding = horizontalPadding
        self.verticalPadding = verticalPadding
        self.content = content()
    }

    var body: some View {
        VStack(spacing: 0) {
            content
        }
        .padding(.horizontal, horizontalPadding)
        .padding(.vertical, verticalPadding)
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

struct ProfileEmptyEventsPlaceholder: View {
    let message: String

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

private struct EmptyRequestPlaceholder: View {
    let message: String

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

private struct FriendRowView: View {
    let user: FriendUserSummary
    var badge: String?
    var avatarSize: CGFloat = 48
    var verticalPadding: CGFloat = 12

    var body: some View {
        HStack(spacing: 14) {
            FriendAvatarView(user: user, size: avatarSize)

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 10) {
                    Text(user.name)
                        .font(.system(size: 15, weight: .medium))
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
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.white.opacity(0.58))
                    .lineLimit(1)
            }

            Spacer(minLength: 0)
        }
        .padding(.vertical, verticalPadding)
    }
}

private struct FriendAvatarView: View {
    let user: FriendUserSummary?
    let size: CGFloat

    var body: some View {
        UserAvatarView(
            imageURL: user?.avatarImageURL,
            name: user?.name ?? "J",
            size: size,
            identityKey: user?.id ?? user?.username ?? user?.name
        )
        .overlay(
            Circle()
                .strokeBorder(.white.opacity(0.08), lineWidth: 1)
        )
    }
}

private enum ProfileTheme {
    static let background = AppTheme.background
    static let cardBackground = Color(red: 0.11, green: 0.11, blue: 0.13)
}

private enum ProfileActionButtonKind {
    case primary
    case accent
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
        isDisabled: Bool = false,
        fillsAvailableWidth: Bool = false,
        fontWeight: Font.Weight = .bold,
        cornerRadius: CGFloat = 20,
        fontSize: CGFloat = 14
    ) -> some View {
        buttonStyle(
            ProfileActionButtonStyle(
                kind: kind,
                isDisabled: isDisabled,
                fillsAvailableWidth: fillsAvailableWidth,
                fontWeight: fontWeight,
                cornerRadius: cornerRadius,
                fontSize: fontSize
            )
        )
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

private extension String {
    var partnerFirstName: String? {
        let parts = trimmingCharacters(in: .whitespacesAndNewlines)
            .split(separator: " ")
            .map(String.init)

        return parts.first
    }

    var partnerLastName: String? {
        let parts = trimmingCharacters(in: .whitespacesAndNewlines)
            .split(separator: " ")
            .map(String.init)

        guard parts.count > 1 else {
            return nil
        }

        return parts.dropFirst().joined(separator: " ")
    }
}

private struct AdminSettingsView: View {
    @Environment(\.dismiss) private var dismiss
    @State private var presentedPlaceCreationType: PlaceListItem.PlaceType?
    @State private var isEventCreationSheetPresented = false
    @State private var isEventSeriesCreationSheetPresented = false
    @State private var isMetroAreaSheetPresented = false
    @State private var isAdminScrapersPresented = false

    var body: some View {
        ScrollView {
            VStack(spacing: 12) {
                AdminSettingsActionButton(
                    title: "Add Event",
                    systemImage: "calendar.badge.plus"
                ) {
                    isEventCreationSheetPresented = true
                }

                AdminSettingsActionButton(
                    title: "Add Event Series",
                    systemImage: "calendar.badge.clock"
                ) {
                    isEventSeriesCreationSheetPresented = true
                }

                AdminSettingsActionButton(
                    title: "Add Venue",
                    systemImage: "building.2"
                ) {
                    presentedPlaceCreationType = .venue
                }

                AdminSettingsActionButton(
                    title: "Add Organizer",
                    systemImage: "person.2.badge.plus"
                ) {
                    presentedPlaceCreationType = .organizer
                }

                AdminSettingsActionButton(
                    title: "Add Metro Area",
                    systemImage: "mappin.and.ellipse"
                ) {
                    isMetroAreaSheetPresented = true
                }

                AdminSettingsActionButton(
                    title: "Scrapers",
                    systemImage: "play.rectangle.on.rectangle"
                ) {
                    isAdminScrapersPresented = true
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 58)
            .padding(.bottom, 18)
        }
        .scrollIndicators(.hidden)
        .background(ProfileTheme.background.ignoresSafeArea())
        .background(SwipeBackEnabler())
        .toolbar(.hidden, for: .navigationBar)
        .navigationBarBackButtonHidden()
        .overlay(alignment: .top) {
            ZStack {
                Text("Admin Settings")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.white)

                HStack {
                    FloatingGlassIconButton(systemImage: "chevron.left") {
                        dismiss()
                    }

                    Spacer()
                }
            }
            .padding(.horizontal, 16)
        }
        .navigationDestination(isPresented: $isAdminScrapersPresented) {
            AdminScrapersView()
        }
        .sheet(isPresented: $isEventCreationSheetPresented) {
            MobileEventCreationView()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $isEventSeriesCreationSheetPresented) {
            MobileEventCreationView(creationKind: .eventSeries)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
        .sheet(item: $presentedPlaceCreationType) { type in
            MobilePlaceCreationView(type: type)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $isMetroAreaSheetPresented) {
            MetroAreaCreationView()
                .presentationDetents([.medium, .large])
                .presentationDragIndicator(.visible)
        }
    }
}

private struct AdminSettingsActionButton: View {
    let title: String
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(Color.white.opacity(0.08))

                    Image(systemName: systemImage)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(AppTheme.accentBlue)
                }
                .frame(width: 44, height: 44)

                Text(title)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)

                Spacer(minLength: 12)

                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.4))
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(ProfileTheme.cardBackground)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(.white.opacity(0.08), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }
}

@MainActor
private final class AdminScrapersViewModel: ObservableObject {
    @Published private(set) var scraperRows: [MobileAdminScraperRow] = []
    @Published private(set) var isLoadingRows = false
    @Published private(set) var isRunning = false
    @Published private(set) var isImporting = false
    @Published private(set) var runResult: MobileAdminScraperRunResponse?
    @Published private(set) var importedCount: Int?
    @Published var errorMessage: String?

    func resetSession() {
        runResult = nil
        importedCount = nil
        errorMessage = nil
    }

    func loadRows(search: String, using apiClient: APIClient) async {
        isLoadingRows = true
        defer { isLoadingRows = false }

        do {
            let response = try await apiClient.send(
                APIClient.mobileAdminScrapers(
                    search: search.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        ? nil
                        : search.trimmingCharacters(in: .whitespacesAndNewlines)
                )
            )
            scraperRows = response.scrapers
        } catch {
            scraperRows = []
            errorMessage = error.localizedDescription
        }
    }

    func runScraper(id: UUID, using apiClient: APIClient) async {
        isRunning = true
        resetSession()
        defer { isRunning = false }

        do {
            runResult = try await apiClient.send(APIClient.mobileRunAdminScraper(scraperID: id))
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func importEvents(
        scraperID: UUID,
        events: [MobileAdminScrapedEvent],
        overrideExisting: Bool,
        using apiClient: APIClient
    ) async {
        isImporting = true
        errorMessage = nil
        defer { isImporting = false }

        do {
            let payload = events.map { event in
                MobileAdminScrapedEventImport(
                    title: event.title,
                    description: event.description,
                    coverImageUrl: event.coverImageURL?.absoluteString,
                    eventUrl: event.eventURL?.absoluteString,
                    externalId: event.externalID,
                    source: event.source,
                    startAt: ISO8601DateFormatter.wigFractional.string(from: event.startAt),
                    endAt: event.endAt.map { ISO8601DateFormatter.wigFractional.string(from: $0) },
                    venueName: event.venueName,
                    address: event.address,
                    city: event.city,
                    state: event.state,
                    categories: event.categories,
                    visibility: event.visibility,
                    status: "active",
                    timeZone: nil,
                    venueId: event.venueMatch?.id.uuidString
                )
            }

            let response = try await apiClient.send(
                APIClient.mobileImportAdminScraperEvents(
                    scraperID: scraperID,
                    overrideExisting: overrideExisting,
                    events: payload
                )
            )
            importedCount = response.created
        } catch {
            errorMessage = error.localizedDescription
        }
    }
}

private struct AdminScrapersView: View {
    @Environment(\.dismiss) private var dismiss
    @Environment(\.apiClient) private var apiClient
    @StateObject private var viewModel = AdminScrapersViewModel()
    @State private var searchText = ""
    @State private var selectedScraperID: UUID?
    @State private var overrideExisting = false

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Text("Scrapers")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(.bottom, -10)

                searchBar
                scraperSelectionSection

                if let selectedRow {
                    selectedScraperCard(selectedRow)
                }

                if let errorMessage = viewModel.errorMessage {
                    errorCard(errorMessage)
                }

                if let runResult = viewModel.runResult {
                    runResultSection(runResult)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 74)
            .padding(.bottom, 18)
        }
        .scrollIndicators(.hidden)
        .background(ProfileTheme.background.ignoresSafeArea())
        .background(SwipeBackEnabler())
        .toolbar(.hidden, for: .navigationBar)
        .navigationBarBackButtonHidden()
        .overlay(alignment: .topLeading) {
            FloatingGlassIconButton(systemImage: "chevron.left") {
                dismiss()
            }
            .padding(.leading, 16)
            .padding(.top, 0)
        }
        .task {
            await viewModel.loadRows(search: "", using: apiClient)
            if selectedScraperID == nil {
                selectedScraperID = viewModel.scraperRows.first?.id
            }
        }
        .task(id: searchText) {
            await viewModel.loadRows(search: searchText, using: apiClient)
            if let selectedScraperID,
               !viewModel.scraperRows.contains(where: { $0.id == selectedScraperID }) {
                self.selectedScraperID = viewModel.scraperRows.first?.id
            } else if self.selectedScraperID == nil {
                self.selectedScraperID = viewModel.scraperRows.first?.id
            }
        }
    }

    private var selectedRow: MobileAdminScraperRow? {
        guard let selectedScraperID else { return nil }
        return viewModel.scraperRows.first(where: { $0.id == selectedScraperID })
    }

    private var searchBar: some View {
        HStack(spacing: 10) {
            Image(systemName: "magnifyingglass")
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(.white.opacity(0.65))

            TextField("Search scraper rows...", text: $searchText)
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(.white)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()

            if !searchText.isEmpty {
                Button {
                    searchText = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.4))
                }
                .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16)
        .frame(height: 50)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color.white.opacity(0.08))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
        )
    }

    private var scraperSelectionSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Select scraper")
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.white)

            if viewModel.isLoadingRows && viewModel.scraperRows.isEmpty {
                NativeLoadingView(fillsAvailableSpace: false)
                    .foregroundStyle(.white.opacity(0.56))
                    .frame(minHeight: 64)
            } else if viewModel.scraperRows.isEmpty {
                Text("No scraper rows found. Configure them from a venue or organizer first.")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.white.opacity(0.56))
                    .padding(16)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: 20, style: .continuous)
                            .fill(ProfileTheme.cardBackground)
                    )
            } else {
                VStack(spacing: 10) {
                    ForEach(viewModel.scraperRows.prefix(12)) { row in
                        Button {
                            selectedScraperID = row.id
                            viewModel.resetSession()
                        } label: {
                            HStack(spacing: 12) {
                                VStack(alignment: .leading, spacing: 4) {
                                    Text(row.place.name)
                                        .font(.system(size: 15, weight: .semibold))
                                        .foregroundStyle(.white)
                                        .lineLimit(1)

                                    Text("\(row.scraper.title) • \(row.searchString)")
                                        .font(.system(size: 12, weight: .medium))
                                        .foregroundStyle(.white.opacity(0.54))
                                        .lineLimit(1)
                                }

                                Spacer(minLength: 8)

                                if selectedScraperID == row.id {
                                    Image(systemName: "checkmark.circle.fill")
                                        .font(.system(size: 18, weight: .semibold))
                                        .foregroundStyle(AppTheme.accentBlue)
                                }
                            }
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(
                                RoundedRectangle(cornerRadius: 18, style: .continuous)
                                    .fill(ProfileTheme.cardBackground)
                            )
                            .overlay(
                                RoundedRectangle(cornerRadius: 18, style: .continuous)
                                    .strokeBorder(
                                        selectedScraperID == row.id
                                            ? AppTheme.accentBlue.opacity(0.45)
                                            : .white.opacity(0.08),
                                        lineWidth: 1
                                    )
                            )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private func selectedScraperCard(_ row: MobileAdminScraperRow) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(spacing: 8) {
                Text(row.place.name)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.white)
                Text(row.scraper.title)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.76))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.white.opacity(0.08), in: Capsule())
            }

            Text(row.searchString)
                .font(.system(size: 13, weight: .medium, design: .monospaced))
                .foregroundStyle(.white.opacity(0.54))

            Button {
                Task {
                    await viewModel.runScraper(id: row.id, using: apiClient)
                }
            } label: {
                HStack(spacing: 8) {
                    if viewModel.isRunning {
                        ProgressView()
                            .tint(.white)
                    } else {
                        Image(systemName: "play.fill")
                    }

                    Text(viewModel.isRunning ? "Running..." : "Run Scraper")
                        .font(.system(size: 15, weight: .semibold))
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 48)
                .background(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(AppTheme.accentBlue.opacity(0.9))
                )
            }
            .buttonStyle(.plain)
            .disabled(viewModel.isRunning || viewModel.isImporting)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 20, style: .continuous)
                .fill(ProfileTheme.cardBackground)
        )
    }

    private func errorCard(_ message: String) -> some View {
        Text(message)
            .font(.system(size: 14, weight: .medium))
            .foregroundStyle(.red.opacity(0.9))
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(ProfileTheme.cardBackground)
            )
    }

    private func runResultSection(_ result: MobileAdminScraperRunResponse) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack {
                Text("\(result.totalEvents) events found")
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(.white)
                Spacer()
                if let importedCount = viewModel.importedCount {
                    Text("\(importedCount) added")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.green.opacity(0.9))
                }
            }

            if result.scraperRow.place.type == .organizer {
                Toggle(isOn: $overrideExisting) {
                    VStack(alignment: .leading, spacing: 4) {
                        Text("Override existing")
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(.white)
                        Text("Update events that already exist instead of skipping them.")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(.white.opacity(0.5))
                    }
                }
                .tint(AppTheme.accentBlue)
            }

            Button {
                Task {
                    await viewModel.importEvents(
                        scraperID: result.scraperRow.id,
                        events: result.events,
                        overrideExisting: overrideExisting,
                        using: apiClient
                    )
                }
            } label: {
                HStack(spacing: 8) {
                    if viewModel.isImporting {
                        ProgressView()
                            .tint(.white)
                    } else {
                        Image(systemName: overrideExisting ? "arrow.triangle.2.circlepath" : "square.and.arrow.down")
                    }

                    Text(viewModel.isImporting
                        ? "Adding..."
                        : (overrideExisting ? "Update All in WIG" : "Add All to WIG"))
                        .font(.system(size: 15, weight: .semibold))
                }
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 48)
                .background(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(.white.opacity(0.12))
                )
            }
            .buttonStyle(.plain)
            .disabled(viewModel.isImporting || result.events.isEmpty)

            if !result.errors.isEmpty {
                VStack(alignment: .leading, spacing: 6) {
                    Text("Scrape errors")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.yellow.opacity(0.9))

                    ForEach(result.errors) { error in
                        Text("\(error.url): \(error.error)")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(.white.opacity(0.56))
                    }
                }
            }

            VStack(spacing: 12) {
                ForEach(result.events) { event in
                    AdminScrapedEventCard(event: event)
                }
            }
        }
    }
}

private struct AdminScrapedEventCard: View {
    let event: MobileAdminScrapedEvent

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(event.title)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.white)

            Text(dateText)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(AppTheme.accentBlue)

            Text(locationText)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.white.opacity(0.56))

            if let venueMatch = event.venueMatch {
                Text("Matched venue: \(venueMatch.name)")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.72))
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(ProfileTheme.cardBackground)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .strokeBorder(.white.opacity(0.08), lineWidth: 1)
        )
    }

    private var dateText: String {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEE, MMM d 'at' h:mm a"
        return formatter.string(from: event.startAt)
    }

    private var locationText: String {
        let venue = event.venueName.trimmingCharacters(in: .whitespacesAndNewlines)
        if !venue.isEmpty {
            return venue
        }

        return [event.city, event.state]
            .filter { !$0.isEmpty }
            .joined(separator: ", ")
    }
}

private struct MetroAreaCreationView: View {
    @Environment(\.apiClient) private var apiClient
    @Environment(\.dismiss) private var dismiss

    @State private var selectedCityDetail: MobileGooglePlaceDetail?
    @State private var isCitySearchPresented = false
    @State private var radiusMiles = "20"
    @State private var isSubmitting = false
    @State private var alertMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Button {
                        isCitySearchPresented = true
                    } label: {
                        HStack(spacing: 12) {
                            Image(systemName: "mappin.and.ellipse")
                                .foregroundStyle(AppTheme.accentBlue)

                            VStack(alignment: .leading, spacing: 4) {
                                Text(selectedCityLabel)
                                    .foregroundStyle(selectedCityDetail == nil ? .white.opacity(0.62) : .white)

                                if let selectedCityDetail,
                                   let latitude = selectedCityDetail.latitude,
                                   let longitude = selectedCityDetail.longitude {
                                    Text("\(latitude.formatted(.number.precision(.fractionLength(4)))), \(longitude.formatted(.number.precision(.fractionLength(4))))")
                                        .font(.system(size: 12, weight: .medium))
                                        .foregroundStyle(.white.opacity(0.5))
                                }
                            }

                            Spacer(minLength: 8)

                            Image(systemName: "chevron.right")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(.white.opacity(0.36))
                        }
                    }
                    .buttonStyle(.plain)
                } header: {
                    Text("City")
                } footer: {
                    Text("Search for a city using Google Places, then we’ll use that city center for the metro area.")
                }

                Section {
                    TextField("Radius in miles", text: $radiusMiles)
                        .keyboardType(.decimalPad)
                } header: {
                    Text("Radius")
                } footer: {
                    Text("Events within this radius of the selected city center will be included.")
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color(uiColor: .systemGroupedBackground))
            .navigationTitle("Add Metro Area")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button("Add") {
                        Task {
                            await submit()
                        }
                    }
                    .disabled(isSubmitting)
                }
            }
            .sheet(isPresented: $isCitySearchPresented) {
                GooglePlaceSearchSheet(
                    title: "Search Cities",
                    placeholder: "Search for a city",
                    emptyPrompt: "Search for a city to create a metro area.",
                    iconSystemName: "mappin.and.ellipse",
                    searchType: .cities
                ) { detail in
                    selectedCityDetail = detail
                }
            }
            .alert(
                "Couldn't Add Metro Area",
                isPresented: Binding(
                    get: { alertMessage != nil },
                    set: { isPresented in
                        if !isPresented {
                            alertMessage = nil
                        }
                    }
                )
            ) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(alertMessage ?? "Please try again.")
            }
        }
    }

    private var selectedCityLabel: String {
        guard let selectedCityDetail else {
            return "Select a city"
        }

        let cityName = selectedCityDetail.city.ifEmpty(selectedCityDetail.name)
        return "\(cityName), \(selectedCityDetail.state)"
    }

    private func submit() async {
        guard let selectedCityDetail else {
            alertMessage = "Please select a city."
            return
        }

        let cityName = selectedCityDetail.city.ifEmpty(selectedCityDetail.name)
        let state = selectedCityDetail.state.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()

        guard !cityName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty, state.count == 2 else {
            alertMessage = "Please select a valid city."
            return
        }

        guard let latitude = selectedCityDetail.latitude, let longitude = selectedCityDetail.longitude else {
            alertMessage = "We couldn't load coordinates for that city. Please try another result."
            return
        }

        guard let parsedRadius = Double(radiusMiles), parsedRadius >= 1, parsedRadius <= 200 else {
            alertMessage = "Please enter a radius between 1 and 200 miles."
            return
        }

        isSubmitting = true
        defer {
            isSubmitting = false
        }

        do {
            _ = try await apiClient.send(
                APIClient.mobileCreateMetroArea(
                    name: cityName,
                    state: state,
                    latitude: latitude,
                    longitude: longitude,
                    radiusMiles: parsedRadius
                )
            )
            dismiss()
        } catch {
            alertMessage = error.localizedDescription
        }
    }
}

private struct ProfileActionButtonStyle: ButtonStyle {
    let kind: ProfileActionButtonKind
    let isDisabled: Bool
    let fillsAvailableWidth: Bool
    let fontWeight: Font.Weight
    let cornerRadius: CGFloat
    let fontSize: CGFloat

    private var foregroundColor: Color {
        switch kind {
        case .primary:
            return .black
        case .accent:
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
        case .accent:
            return AppTheme.accentBlue
        case .secondary, .destructive:
            return .white.opacity(0.08)
        }
    }

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .font(.system(size: fontSize, weight: fontWeight))
            .foregroundStyle(foregroundColor.opacity(isDisabled ? 0.5 : 1))
            .padding(.horizontal, 15)
            .frame(maxWidth: fillsAvailableWidth ? .infinity : nil)
            .frame(height: 40)
            .background(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .fill(backgroundColor.opacity(isDisabled ? 0.55 : 1))
            )
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .strokeBorder(.white.opacity(kind == .primary || kind == .accent ? 0 : 0.08), lineWidth: 1)
            )
            .contentShape(RoundedRectangle(cornerRadius: cornerRadius, style: .continuous))
            .opacity(configuration.isPressed ? 0.82 : 1)
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
