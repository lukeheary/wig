import ClerkKit
import PhotosUI
import SwiftUI
import UIKit

struct ProfileView: View {
    let resetFiltersTrigger: Int

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

    init(resetFiltersTrigger: Int = 0) {
        self.resetFiltersTrigger = resetFiltersTrigger
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
                .refreshable {
                    await loadProfileScreen()
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
                .navigationDestination(isPresented: $isAdminSettingsPresented) {
                    AdminSettingsView()
                }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            ScrollView {
                ProfilePageSkeletonContent(showsTopActions: false)
                    .padding(.horizontal, 16)
                    .padding(.top, 82)
                    .padding(.bottom, 48)
            }
            .scrollIndicators(.hidden)
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
                        )

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

                    profileEventsSection(response: response)

                    if appSession.isAuthBypassed {
                        localDevelopmentCard
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 82)
                .padding(.bottom, 48)
            }
            .scrollIndicators(.hidden)
            .background(ProfileTheme.background)
            .overlay(alignment: .top) {
                HStack {
                    if canShowEventsFilter(for: response) {
                        ProfileEventsFilterButton(
                            selection: $selectedEventsTab,
                            rsvpFilter: $selectedEventsRSVPFilter
                        )
                    }

                    Spacer()

                    signOutButton
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
        let events = selectedEventsRSVPFilter.filtered(
            events: selectedEventsTab == .upcoming ? response.upcomingEvents : response.pastEvents
        )
        let groups = ProfileEventGrouper.groups(for: events, mode: selectedEventsTab)

        VStack(alignment: .leading, spacing: 18) {
            if groups.isEmpty {
                ProfileEmptyEventsPlaceholder(
                    message: "There aren’t any \(selectedEventsTab.emptyStateName) events to show yet."
                )
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
                            .scrollTargetLayout()
                        }
                        .scrollIndicators(.hidden)
                        .contentMargins(.horizontal, 16, for: .scrollContent)
                        .scrollTargetBehavior(.viewAligned)
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

        do {
            try await apiClient.send(APIClient.declineMobileFriendRequest(friendRequestID: friendshipID))
        } catch {
            if let previousResponse {
                viewModel.restoreLoadedResponse(previousResponse)
            }
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
                    friends: current.friends,
                    receivedRequests: current.receivedRequests.filter { $0.id != resolvedRequest.id },
                    sentRequests: current.sentRequests,
                    upcomingEvents: current.upcomingEvents,
                    pastEvents: current.pastEvents
                )
            }
        }

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
            if appSession.isAdmin {
                Button("Admin Settings") {
                    isAdminSettingsPresented = true
                }
            }

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

struct UserProfileView: View {
    let userID: String
    var showsFriendAction = true

    @Environment(\.apiClient) private var apiClient
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel = UserProfileViewModel()
    @State private var selectedEventsTab: ProfileEventsTab = .upcoming
    @State private var selectedEventsRSVPFilter: ProfileEventsRSVPFilter = .all
    @State private var isSendingFriendRequest = false
    @State private var isRespondingToFriendRequest = false
    @State private var pendingUnfriendProfile: FriendUserSummary?

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
            ScrollView {
                ProfilePageSkeletonContent(showsTopActions: false)
                    .padding(.horizontal, 16)
                    .padding(.top, 82)
                    .padding(.bottom, 48)
            }
            .scrollIndicators(.hidden)
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
                        ProfileHeader(profile: response.profile, isUploadingAvatar: false, isAvatarMenuPresented: nil)

                        if showsFriendAction {
                            userFriendAction(response: response)
                        }

                        UserRelationshipSummaryRow(response: response)
                    }

                    UserProfileEventsSection(
                        response: response,
                        selectedEventsTab: $selectedEventsTab,
                        selectedEventsRSVPFilter: $selectedEventsRSVPFilter
                    )
                }
                .padding(.horizontal, 16)
                .padding(.top, 82)
                .padding(.bottom, 48)
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

            if viewModel.canShowEventsFilter {
                ProfileEventsFilterButton(
                    selection: $selectedEventsTab,
                    rsvpFilter: $selectedEventsRSVPFilter
                )
            }

            Spacer()

            if showsFriendAction, case .loaded(let response) = viewModel.state, let profile = response.profile {
                navFriendAction(for: profile)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 0)
    }

    @ViewBuilder
    private func userFriendAction(response: UserProfileResponse) -> some View {
        if let profile = response.profile {
            switch profile.friendStatus ?? FriendUserSummary.FriendStatus.none {
            case .none:
                EmptyView()
            case .pendingSent:
                EmptyView()
            case .pendingReceived:
                HStack(spacing: 12) {
                    Button("Decline") {
                        _ = respondToFriendRequest(profile: profile, response: .decline)
                    }
                    .profileActionButtonStyle(kind: .secondary, isDisabled: isRespondingToFriendRequest)
                    .disabled(isRespondingToFriendRequest)

                    Button("Accept") {
                        _ = respondToFriendRequest(profile: profile, response: .accept)
                    }
                    .profileActionButtonStyle(kind: .accent, isDisabled: isRespondingToFriendRequest)
                    .disabled(isRespondingToFriendRequest)
                }
            case .accepted:
                EmptyView()
            }
        }
    }

    @ViewBuilder
    private func navFriendAction(for profile: FriendUserSummary) -> some View {
        switch profile.friendStatus ?? .none {
        case .none:
            Button("Add Friend") {
                sendFriendRequest(to: profile.id)
            }
            .profileActionButtonStyle(kind: .primary, isDisabled: isSendingFriendRequest)
            .disabled(isSendingFriendRequest)
        case .pendingSent:
            Button("Request Sent") {}
                .profileActionButtonStyle(kind: .secondary, isDisabled: true)
                .disabled(true)
        case .pendingReceived:
            EmptyView()
        case .accepted:
            Button("Friends") {
                pendingUnfriendProfile = profile
            }
            .profileActionButtonStyle(
                kind: .secondary,
                isDisabled: isRespondingToFriendRequest
            )
            .disabled(isRespondingToFriendRequest)
        }
    }

    private func sendFriendRequest(to userID: String) {
        guard !isSendingFriendRequest else {
            return
        }

        isSendingFriendRequest = true

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
                        friends: current.friends,
                        upcomingEvents: current.upcomingEvents,
                        pastEvents: current.pastEvents
                    )
                }
            } catch {
                // Keep the current profile visible without interrupting the screen.
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
                        friendStatus: response == .accept ? .accepted : FriendUserSummary.FriendStatus.none
                    )
                },
                friendCount: current.friendCount,
                friends: current.friends,
                upcomingEvents: current.upcomingEvents,
                pastEvents: current.pastEvents
            )
        }

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
                await viewModel.load(userID: userID, using: apiClient)
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
                        friendStatus: .none
                    )
                },
                friendCount: max(current.friendCount - 1, 0),
                friends: current.friends.filter { $0.id != profile.id },
                upcomingEvents: current.upcomingEvents,
                pastEvents: current.pastEvents
            )
        }
        ProfileViewModel.invalidateCache()
        UserProfileViewModel.invalidateAllCaches()

        Task {
            defer {
                isRespondingToFriendRequest = false
            }

            do {
                try await apiClient.send(
                    APIClient.declineMobileFriendRequest(friendRequestID: friendshipID)
                )
            } catch {
                await viewModel.load(userID: userID, using: apiClient)
            }
        }
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
    @Binding var rsvpFilter: ProfileEventsRSVPFilter

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
                .contentShape(Circle())
                .profileLiquidGlass(in: Circle())
        }
        .buttonStyle(.plain)
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
            return tab == .past ? "Went" : "Going"
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
    @Binding var selectedEventsTab: ProfileEventsTab
    @Binding var selectedEventsRSVPFilter: ProfileEventsRSVPFilter

    var body: some View {
        let events = selectedEventsRSVPFilter.filtered(
            events: selectedEventsTab == .upcoming ? response.upcomingEvents : response.pastEvents
        )
        let groups = ProfileEventGrouper.groups(for: events, mode: selectedEventsTab)

        VStack(alignment: .leading, spacing: 18) {
            if groups.isEmpty {
                ProfileEmptyEventsPlaceholder(
                    message: "There aren’t any \(selectedEventsTab.emptyStateName) events to show yet."
                )
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
                            .scrollTargetLayout()
                        }
                        .scrollIndicators(.hidden)
                        .contentMargins(.horizontal, 16, for: .scrollContent)
                        .scrollTargetBehavior(.viewAligned)
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
    let isAvatarMenuPresented: Binding<Bool>?
    var onChooseAvatarPhoto: (() -> Void)? = nil
    var onTakeAvatarPhoto: (() -> Void)? = nil

    var body: some View {
        VStack(spacing: 12) {
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
            } else {
                FriendAvatarView(user: profile, size: 104)
            }

            if let profile {
                VStack(spacing: 3) {
                    Text(profile.name)
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(.white)
                        .lineLimit(3)
                        .minimumScaleFactor(0.76)
                        .fixedSize(horizontal: false, vertical: true)
                        .multilineTextAlignment(.center)

                    Text(profile.usernameText)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(.white.opacity(0.56))
                        .lineLimit(2)
                        .minimumScaleFactor(0.78)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
        }
        .frame(maxWidth: .infinity)
    }
}

private struct ProfilePageSkeletonContent: View {
    let showsTopActions: Bool

    var body: some View {
        VStack(spacing: 22) {
            if showsTopActions {
                HStack {
                    Circle()
                        .fill(shimmerFill)
                        .frame(width: 46, height: 46)

                    Spacer()

                    Capsule()
                        .fill(shimmerFill)
                        .frame(width: 104, height: 40)
                }
            }

            VStack(spacing: 12) {
                Circle()
                    .fill(shimmerFill)
                    .frame(width: 104, height: 104)

                VStack(spacing: 6) {
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(shimmerFill)
                        .frame(width: 170, height: 24)

                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(shimmerFill)
                        .frame(width: 118, height: 16)
                }
            }
            .frame(maxWidth: .infinity)

            HStack(spacing: 16) {
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(shimmerFill)
                    .frame(width: 110, height: 14)

                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(shimmerFill)
                    .frame(width: 88, height: 14)

                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .fill(shimmerFill)
                    .frame(width: 94, height: 14)
            }
            .frame(maxWidth: .infinity)

            VStack(alignment: .leading, spacing: 18) {
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(shimmerFill)
                    .frame(width: 106, height: 26)

                ScrollView(.horizontal) {
                    LazyHStack(alignment: .top, spacing: 12) {
                        ForEach(0..<3, id: \.self) { index in
                            EventCardSkeletonView(seed: index)
                                .frame(width: 220)
                        }
                    }
                    .scrollTargetLayout()
                }
                .scrollIndicators(.hidden)
                .contentMargins(.horizontal, 16, for: .scrollContent)
                .scrollTargetBehavior(.viewAligned)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, -16)
        }
    }

    private var shimmerFill: LinearGradient {
        LinearGradient(
            colors: [
                .white.opacity(0.08),
                .white.opacity(0.16),
                .white.opacity(0.08),
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
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

    private var locationText: String? {
        response.profile?.locationText
    }

    var body: some View {
        HStack(spacing: 16) {
            if let locationText {
                Text(locationText)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.white.opacity(0.58))
                    .lineLimit(1)
            }

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
                FriendRequestsView(
                    receivedRequests: response.receivedRequests,
                    sentRequests: response.sentRequests,
                    onAcceptRequest: onAcceptFriendRequest,
                    onDeclineRequest: onDeclineFriendRequest
                )
            } label: {
                RelationshipSummaryLink(count: response.requestCount, label: "Requests")
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, alignment: .center)
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
    @State private var pendingFriendRemoval: FriendUserSummary?

    var body: some View {
        RelationshipListScreen {
            VStack(alignment: .leading, spacing: 18) {
                VStack(alignment: .leading, spacing: 14) {
                    RelationshipSectionHeader(title: "Partner")

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

                VStack(alignment: .leading, spacing: 14) {
                    RelationshipSectionHeader(title: "My Friends")

                    FriendsListViewContent(
                        friends: response.friends,
                        onRemoveFriend: { friend in
                            pendingFriendRemoval = friend
                        }
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
                VStack(alignment: .leading, spacing: 16) {
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
                .padding(.vertical, 8)
            }
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ProfileTheme.cardBackground, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(.white.opacity(0.08), lineWidth: 1)
        )
    }

    @ViewBuilder
    private func partnerAvatarRow(_ partner: MobilePartnerUser, trailing: AnyView? = nil) -> some View {
        NavigationLink {
            UserProfileView(userID: partner.id)
        } label: {
            UserListRowView(
                imageURL: partner.avatarImageURL,
                name: [partner.firstName, partner.lastName]
                    .compactMap { $0 }
                    .joined(separator: " ")
                    .trimmingCharacters(in: .whitespacesAndNewlines)
                    .ifEmpty(partner.username),
                subtitle: "@\(partner.username)",
                identityKey: partner.id
            ) {
                trailing
            }
        }
        .buttonStyle(.plain)
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
        VStack(spacing: 0) {
            Text("Choose Partner")
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .padding(.top, 10)
                .padding(.bottom, 14)

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
                                    FriendRowView(user: friend)

                                    Button("Send") {
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
                .padding(.bottom, 40)
            }
        }
        .background(ProfileTheme.background.ignoresSafeArea())
    }
}

private struct UserRelationshipSummaryRow: View {
    let response: UserProfileResponse

    private var locationText: String? {
        response.profile?.locationText
    }

    var body: some View {
        HStack(spacing: 16) {
            if let locationText {
                Text(locationText)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.white.opacity(0.58))
                    .lineLimit(1)
            }

            NavigationLink {
                FriendsListView(title: "Friends", friends: response.friends)
            } label: {
                RelationshipSummaryLink(count: response.friendCount, label: "Friends")
            }
            .buttonStyle(.plain)
        }
        .frame(maxWidth: .infinity, alignment: .center)
    }
}

private struct RelationshipSummaryLink: View {
    let count: Int
    let label: String

    var body: some View {
        HStack(spacing: 0) {
            (
                Text("\(count)")
                    .foregroundColor(.white)
                    .fontWeight(.medium)
                +
                Text(" \(label)")
                    .foregroundColor(.white.opacity(0.58))
            )
            .font(.system(size: 13, weight: .regular))
        }
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
                VStack(spacing: 0) {
                    ForEach(Array(friends.enumerated()), id: \.element.id) { _, friend in
                    HStack(spacing: 12) {
                        NavigationLink {
                            UserProfileView(userID: friend.id)
                        } label: {
                            UserListRowView(
                                imageURL: friend.avatarImageURL,
                                name: friend.name,
                                subtitle: friend.usernameText,
                                identityKey: friend.id
                            )
                        }
                        .buttonStyle(.plain)

                        if let onRemoveFriend, friend.friendshipID != nil {
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

                        if friend.id != friends.last?.id {
                            Divider()
                                .overlay(.white.opacity(0.08))
                                .padding(.leading, 62)
                        }
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
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
}

private struct FriendRequestsView: View {
    let onAcceptRequest: (FriendUserSummary) async -> Bool
    let onDeclineRequest: (FriendUserSummary) async -> Bool
    @EnvironmentObject private var activityRequestStore: ActivityRequestStore
    @State private var receivedRequests: [FriendUserSummary]
    @State private var sentRequests: [FriendUserSummary]
    @State private var activeRequestID: String?
    @State private var selectedUserProfile: RequestSelectedUserProfile?

    init(
        receivedRequests: [FriendUserSummary],
        sentRequests: [FriendUserSummary],
        onAcceptRequest: @escaping (FriendUserSummary) async -> Bool,
        onDeclineRequest: @escaping (FriendUserSummary) async -> Bool
    ) {
        self.onAcceptRequest = onAcceptRequest
        self.onDeclineRequest = onDeclineRequest
        _receivedRequests = State(initialValue: receivedRequests)
        _sentRequests = State(initialValue: sentRequests)
    }

    var body: some View {
        RelationshipListScreen(title: "Received Requests") {
            VStack(alignment: .leading, spacing: 6) {
                if receivedRequests.isEmpty {
                    EmptyRequestPlaceholder(message: "No pending friend requests")
                } else {
                    RelationshipCard {
                        ForEach(Array(receivedRequests.enumerated()), id: \.element.id) { index, request in
                            HStack(spacing: 12) {
                                Button {
                                    selectedUserProfile = RequestSelectedUserProfile(id: request.id)
                                } label: {
                                    UserListRowView(
                                        imageURL: request.avatarImageURL,
                                        name: request.name,
                                        subtitle: request.usernameText,
                                        identityKey: request.id,
                                        avatarSize: 44,
                                        verticalPadding: 8
                                    )
                                }
                                .buttonStyle(.plain)
                                .frame(maxWidth: .infinity, alignment: .leading)

                                HStack(spacing: 8) {
                                    Button {
                                        submit(.decline, for: request)
                                    } label: {
                                        Image(systemName: "xmark")
                                            .font(.system(size: 13, weight: .bold))
                                            .foregroundStyle(.white.opacity(0.75))
                                            .frame(width: 36, height: 36)
                                            .background(Circle().fill(Color.white.opacity(0.1)))
                                    }
                                    .buttonStyle(.plain)
                                    .disabled(activeRequestID != nil)

                                    Button {
                                        submit(.accept, for: request)
                                    } label: {
                                        Image(systemName: "checkmark")
                                            .font(.system(size: 15, weight: .bold))
                                            .foregroundStyle(.white)
                                            .frame(width: 42, height: 42)
                                            .background(Circle().fill(AppTheme.accentBlue))
                                    }
                                    .buttonStyle(.plain)
                                    .disabled(activeRequestID != nil)
                                }
                                .opacity(activeRequestID != nil ? 0.5 : 1)
                            }

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
                        .font(.system(size: 20, weight: .bold))
                        .foregroundStyle(.white)

                    if sentRequests.isEmpty {
                        EmptyRequestPlaceholder(message: "No sent requests")
                    } else {
                        RelationshipCard {
                            ForEach(Array(sentRequests.enumerated()), id: \.element.id) { index, request in
                                Button {
                                    selectedUserProfile = RequestSelectedUserProfile(id: request.id)
                                } label: {
                                    UserListRowView(
                                        imageURL: request.avatarImageURL,
                                        name: request.name,
                                        subtitle: request.usernameText,
                                        identityKey: request.id,
                                        avatarSize: 44,
                                        verticalPadding: 8
                                    ) {
                                        PendingRequestBadge()
                                    }
                                }
                                .buttonStyle(.plain)
                                .frame(maxWidth: .infinity, alignment: .leading)

                                if request.id != sentRequests.last?.id {
                                    Divider()
                                        .overlay(.white.opacity(0.08))
                                        .padding(.leading, 62)
                                }
                            }
                        }
                    }
                }
                .padding(.top, 28)
            }
        }
        .navigationDestination(item: $selectedUserProfile) { selection in
            UserProfileView(userID: selection.id)
        }
    }

    private func submit(_ response: ActivityRequestResponse, for request: FriendUserSummary) {
        activeRequestID = request.id
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
                NotificationCenter.default.post(name: .friendRequestDidChange, object: requestID)
            } else if succeeded {
                NotificationCenter.default.post(name: .friendRequestDidChange, object: nil)
            }

            activeRequestID = nil
        }
    }
}

private struct PendingRequestBadge: View {
    var body: some View {
        Text("Pending")
            .font(.system(size: 13, weight: .bold))
            .foregroundStyle(.white)
            .padding(.horizontal, 14)
            .frame(height: 34)
            .background(
                Capsule()
                    .strokeBorder(.white.opacity(0.10), lineWidth: 1)
            )
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
                ProgressView("Loading requests...")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .tint(.white)
                    .foregroundStyle(.white)
                    .background(ProfileTheme.background)

            case .failed(let message):
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
                .background(ProfileTheme.background)

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
        .task {
            if case .idle = viewModel.state {
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
                    friends: current.friends,
                    receivedRequests: current.receivedRequests.filter { $0.id != resolvedRequest.id },
                    sentRequests: current.sentRequests,
                    upcomingEvents: current.upcomingEvents,
                    pastEvents: current.pastEvents
                )
            }
        }

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
            errorMessage = error.localizedDescription
            return false
        }
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
                if let title {
                    Text(title)
                        .font(.system(size: 20, weight: .bold))
                        .foregroundStyle(.white)
                }

                content
            }
            .padding(.horizontal, 16)
            .padding(.top, 82)
            .padding(.bottom, 48)
        }
        .background(ProfileTheme.background.ignoresSafeArea())
        .background(SwipeBackEnabler())
        .toolbar(.hidden, for: .navigationBar)
        .navigationBarBackButtonHidden()
        .navigationBarTitleDisplayMode(.inline)
        .overlay(alignment: .topLeading) {
            FloatingGlassIconButton(systemImage: "chevron.left") {
                dismiss()
            }
            .padding(.leading, 16)
            .padding(.top, 0)
        }
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

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                Text("Admin Settings")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(.bottom, -10)

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
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 82)
            .padding(.bottom, 48)
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
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(AppTheme.accentBlue)
                }
                .frame(width: 52, height: 52)

                Text(title)
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.white)

                Spacer(minLength: 12)

                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.4))
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(ProfileTheme.cardBackground)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .strokeBorder(.white.opacity(0.08), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
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

private struct ProfileActionButtonModifier: ViewModifier {
    let kind: ProfileActionButtonKind
    let isDisabled: Bool

    private var foregroundColor: Color {
        switch kind {
        case .primary:
            return .black
        case .accent:
            return .white
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
                    .strokeBorder(.white.opacity(kind == .primary || kind == .accent ? 0 : 0.08), lineWidth: 1)
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
