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

    func load(using apiClient: APIClient, forceRefresh: Bool = false) async {
        if !forceRefresh, let cachedResponse = Self.cachedResponse {
            state = .loaded(cachedResponse)
            return
        }

        if !forceRefresh, let inFlightLoad = Self.inFlightLoad {
            state = .loading

            do {
                let response = try await inFlightLoad.value
                Self.cachedResponse = response
                state = .loaded(response)
            } catch {
                state = .failed(error.localizedDescription)
            }

            return
        }

        state = .loading

        do {
            let loadTask = Task {
                try await apiClient.send(APIClient.mobileFriends())
            }
            Self.inFlightLoad = loadTask

            let response = try await loadTask.value
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
                friends: response.friends.filter { $0.id != userID },
                receivedRequests: response.receivedRequests,
                sentRequests: response.sentRequests,
                upcomingEvents: response.upcomingEvents,
                pastEvents: response.pastEvents
            )
        }
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
            cachedResponse = try await loadTask.value
        } catch {
            // Ignore preload failures; the screen can still load normally later.
        }

        inFlightLoad = nil
    }
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

    func load(userID: String, using apiClient: APIClient) async {
        if let cachedResponse = Self.cachedResponses[userID] {
            state = .loaded(cachedResponse)
            return
        }

        if let inFlightLoad = Self.inFlightLoads[userID] {
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
}
