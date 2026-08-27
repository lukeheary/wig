import Foundation

@MainActor
final class ProfileViewModel: ObservableObject {
    enum State {
        case idle
        case loading
        case loaded(FriendsFeedResponse)
        case failed(String)
    }

    @Published private(set) var state: State = .idle
    @Published private(set) var isUploadingAvatar = false
    @Published var avatarUploadError: String?
    private static var cachedResponse: FriendsFeedResponse?
    private static var inFlightLoad: Task<FriendsFeedResponse, Error>?
    private static var friendRequestStatusOverrides: [String: FriendRequestStatusOverride] = [:]

    /// The signed-in user's summary, if the friends feed has been loaded.
    static var currentUserSummary: FriendUserSummary? {
        cachedResponse?.profile
    }

    static var pendingFriendRequestCount: Int {
        cachedResponse?.requestCount ?? 0
    }

    func load(using apiClient: APIClient, forceRefresh: Bool = false) async {
        if !forceRefresh, let cachedResponse = Self.cachedResponse {
            state = .loaded(cachedResponse)
            return
        }

        if !forceRefresh, let inFlightLoad = Self.inFlightLoad {
            state = .loading

            do {
                let response = Self.applyingFriendRequestStatusOverrides(to: try await inFlightLoad.value)
                Self.cachedResponse = response
                state = .loaded(response)
            } catch {
                state = .failed(error.localizedDescription)
            }

            return
        }

        if let cachedResponse = Self.cachedResponse {
            state = .loaded(cachedResponse)
        } else {
            state = .loading
        }

        do {
            let loadTask = Task {
                try await apiClient.send(APIClient.mobileFriends())
            }
            Self.inFlightLoad = loadTask

            let response = Self.applyingFriendRequestStatusOverrides(to: try await loadTask.value)
            Self.cachedResponse = response
            state = .loaded(response)
        } catch {
            state = .failed(error.localizedDescription)
        }

        Self.inFlightLoad = nil
    }

    func updateAvatar(imageData: Data, using apiClient: APIClient) async {
        guard !isUploadingAvatar else { return }

        isUploadingAvatar = true
        avatarUploadError = nil

        do {
            let response = try await apiClient.send(
                APIClient.updateMobileProfileAvatar(imageData: imageData)
            )

            if case .loaded(let friendsResponse) = state {
                Self.cachedResponse = friendsResponse.updatingProfileAvatarImageURL(response.avatarImageURL)
                state = .loaded(
                    friendsResponse.updatingProfileAvatarImageURL(response.avatarImageURL)
                )
            }
            NotificationCenter.default.post(name: .activationDidChange, object: nil)
        } catch {
            avatarUploadError = error.localizedDescription
        }

        isUploadingAvatar = false
    }

    func updateLoadedResponse(
        _ transform: (FriendsFeedResponse) -> FriendsFeedResponse
    ) {
        guard case .loaded(let response) = state else {
            return
        }

        let updated = transform(response)
        Self.cachedResponse = updated
        state = .loaded(updated)
    }

    func removeFriend(userID: String) {
        updateLoadedResponse { response in
            FriendsFeedResponse(
                profile: response.profile,
                friendCount: max(response.friendCount - 1, 0),
                requestCount: response.requestCount,
                followingCount: response.followingCount,
                followedPlaces: response.followedPlaces,
                memberPlaceCount: response.memberPlaceCount,
                memberPlaces: response.memberPlaces,
                friends: response.friends.filter { $0.id != userID },
                receivedRequests: response.receivedRequests,
                sentRequests: response.sentRequests,
                upcomingEvents: response.upcomingEvents,
                pastEvents: response.pastEvents
            )
        }
    }

    func applyFriendRequestStatusChange(
        for user: FriendUserSummary,
        status: FriendUserSummary.FriendStatus
    ) {
        let change = FriendRequestStatusOverride(user: user, status: status)
        Self.recordFriendRequestStatusOverride(for: user, status: status)
        updateLoadedResponse { response in
            Self.applying(change, to: response)
        }
    }

    static func recordFriendRequestStatusOverride(
        for user: FriendUserSummary,
        status: FriendUserSummary.FriendStatus
    ) {
        let change = FriendRequestStatusOverride(user: user, status: status)
        friendRequestStatusOverrides[user.id] = change

        if let cachedResponse {
            Self.cachedResponse = applying(change, to: cachedResponse)
        }
    }

    static func confirmFriendRequestStatusChange(userID: String) {
        friendRequestStatusOverrides[userID] = nil
    }

    func snapshotLoadedResponse() -> FriendsFeedResponse? {
        guard case .loaded(let response) = state else {
            return nil
        }

        return response
    }

    func restoreLoadedResponse(_ response: FriendsFeedResponse) {
        Self.cachedResponse = response
        state = .loaded(response)
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
            try await apiClient.send(APIClient.mobileFriends())
        }
        inFlightLoad = loadTask

        do {
            cachedResponse = applyingFriendRequestStatusOverrides(to: try await loadTask.value)
        } catch {
            // Ignore preload failures; the screen can still load normally later.
        }

        inFlightLoad = nil
    }

    static func invalidateCache() {
        cachedResponse = nil
        inFlightLoad?.cancel()
        inFlightLoad = nil
    }

    private static func applyingFriendRequestStatusOverrides(
        to response: FriendsFeedResponse
    ) -> FriendsFeedResponse {
        let sanitizedResponse = removingCurrentUserFromRelationships(in: response)
        var result = sanitizedResponse

        for (userID, change) in Array(friendRequestStatusOverrides) {
            if change.user.id == sanitizedResponse.profile?.id {
                friendRequestStatusOverrides[userID] = nil
            } else if responseReflects(change, in: sanitizedResponse) {
                friendRequestStatusOverrides[userID] = nil
            } else {
                result = applying(change, to: result)
            }
        }

        return result
    }

    private static func removingCurrentUserFromRelationships(
        in response: FriendsFeedResponse
    ) -> FriendsFeedResponse {
        guard let currentUserID = response.profile?.id else {
            return response
        }

        let friends = response.friends.filter { $0.id != currentUserID }
        let receivedRequests = response.receivedRequests.filter { $0.id != currentUserID }
        let sentRequests = response.sentRequests.filter { $0.id != currentUserID }

        return FriendsFeedResponse(
            profile: response.profile,
            friendCount: friends.count,
            requestCount: receivedRequests.count,
            followingCount: response.followingCount,
            followedPlaces: response.followedPlaces,
            memberPlaceCount: response.memberPlaceCount,
            memberPlaces: response.memberPlaces,
            friends: friends,
            receivedRequests: receivedRequests,
            sentRequests: sentRequests,
            upcomingEvents: response.upcomingEvents,
            pastEvents: response.pastEvents
        )
    }

    private static func responseReflects(
        _ change: FriendRequestStatusOverride,
        in response: FriendsFeedResponse
    ) -> Bool {
        let userID = change.user.id

        switch change.status {
        case .none:
            return !response.friends.contains { $0.id == userID }
                && !response.receivedRequests.contains { $0.id == userID }
                && !response.sentRequests.contains { $0.id == userID }
        case .accepted:
            return response.friends.contains { $0.id == userID }
        case .pendingSent:
            return response.sentRequests.contains { $0.id == userID }
        case .pendingReceived:
            return response.receivedRequests.contains { $0.id == userID }
        }
    }

    private static func applying(
        _ change: FriendRequestStatusOverride,
        to response: FriendsFeedResponse
    ) -> FriendsFeedResponse {
        guard change.user.id != response.profile?.id else {
            return response
        }

        let user = change.user
        let status = change.status
        let wasPending = response.receivedRequests.contains { $0.id == user.id }
        let wasFriend = response.friends.contains { $0.id == user.id }
        let isPending = status == .pendingReceived
        let isSent = status == .pendingSent
        var receivedRequests = response.receivedRequests.filter { $0.id != user.id }
        var sentRequests = response.sentRequests.filter { $0.id != user.id }
        var friends = response.friends.filter { $0.id != user.id }
        let updatedUser = FriendUserSummary(
            id: user.id,
            friendshipID: user.friendshipID,
            name: user.name,
            username: user.username,
            avatarImageURL: user.avatarImageURL,
            city: user.city,
            state: user.state,
            friendStatus: status,
            notificationsMuted: user.notificationsMuted
        )

        if isPending {
            receivedRequests.append(updatedUser)
        } else if isSent {
            sentRequests.append(updatedUser)
        } else if status == .accepted {
            friends.append(updatedUser)
        }

        return FriendsFeedResponse(
            profile: response.profile,
            friendCount: max(
                response.friendCount
                    + (status == .accepted && !wasFriend ? 1 : 0)
                    - (status != .accepted && wasFriend ? 1 : 0),
                0
            ),
            requestCount: max(
                response.requestCount
                    + (isPending ? (wasPending ? 0 : 1) : (wasPending ? -1 : 0)),
                0
            ),
            followingCount: response.followingCount,
            followedPlaces: response.followedPlaces,
            memberPlaceCount: response.memberPlaceCount,
            memberPlaces: response.memberPlaces,
            friends: friends,
            receivedRequests: receivedRequests,
            sentRequests: sentRequests,
            upcomingEvents: response.upcomingEvents,
            pastEvents: response.pastEvents
        )
    }
}

private struct FriendRequestStatusOverride {
    let user: FriendUserSummary
    let status: FriendUserSummary.FriendStatus
}

@MainActor
final class UserProfileViewModel: ObservableObject {
    enum State {
        case idle
        case loading
        case loaded(UserProfileResponse)
        case failed(String)
    }

    @Published private(set) var state: State = .idle
    private static var cachedResponses = [String: UserProfileResponse]()
    private static var inFlightLoads = [String: Task<UserProfileResponse, Error>]()

    var canShowEventsFilter: Bool {
        guard case .loaded(let response) = state else {
            return false
        }

        return !response.upcomingEvents.isEmpty || !response.pastEvents.isEmpty
    }

    func load(userID: String, using apiClient: APIClient, forceRefresh: Bool = false) async {
        if !forceRefresh, let cachedResponse = Self.cachedResponses[userID] {
            state = .loaded(cachedResponse)
            return
        }

        if !forceRefresh, let inFlightLoad = Self.inFlightLoads[userID] {
            state = .loading

            do {
                let response = try await inFlightLoad.value
                Self.cachedResponses[userID] = response
                state = .loaded(response)
            } catch {
                state = .failed(error.localizedDescription)
            }

            return
        }

        state = .loading

        do {
            let loadTask = Task {
                try await apiClient.send(APIClient.mobileUserProfile(userID: userID))
            }
            Self.inFlightLoads[userID] = loadTask

            let response = try await loadTask.value
            Self.cachedResponses[userID] = response
            state = .loaded(response)
        } catch {
            state = .failed(error.localizedDescription)
        }

        Self.inFlightLoads[userID] = nil
    }

    static func preload(userID: String, using apiClient: APIClient) async {
        if cachedResponses[userID] != nil {
            return
        }

        if let inFlightLoad = inFlightLoads[userID] {
            _ = try? await inFlightLoad.value
            return
        }

        let loadTask = Task {
            try await apiClient.send(APIClient.mobileUserProfile(userID: userID))
        }
        inFlightLoads[userID] = loadTask

        do {
            cachedResponses[userID] = try await loadTask.value
        } catch {
            // Ignore preload failures; the profile can still load normally later.
        }

        inFlightLoads[userID] = nil
    }

    static func invalidateAllCaches() {
        cachedResponses.removeAll()
        for load in inFlightLoads.values {
            load.cancel()
        }
        inFlightLoads.removeAll()
    }

    func updateLoadedResponse(_ transform: (UserProfileResponse) -> UserProfileResponse) {
        guard case .loaded(let response) = state else {
            return
        }

        let updated = transform(response)
        if let profileID = updated.profile?.id {
            Self.cachedResponses[profileID] = updated
        }
        state = .loaded(updated)
    }

    func snapshotLoadedResponse() -> UserProfileResponse? {
        guard case .loaded(let response) = state else {
            return nil
        }

        return response
    }

    func restoreLoadedResponse(_ response: UserProfileResponse) {
        if let profileID = response.profile?.id {
            Self.cachedResponses[profileID] = response
        }
        state = .loaded(response)
    }
}
