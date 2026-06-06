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

    func load(using apiClient: APIClient) async {
        state = .loading

        do {
            let response = try await apiClient.send(APIClient.mobileFriends())
            state = .loaded(response)
        } catch {
            state = .failed(error.localizedDescription)
        }
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
                state = .loaded(
                    friendsResponse.updatingProfileAvatarImageURL(response.avatarImageURL)
                )
            }
        } catch {
            avatarUploadError = error.localizedDescription
        }

        isUploadingAvatar = false
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

    var canShowEventsFilter: Bool {
        guard case .loaded(let response) = state else {
            return false
        }

        return !response.upcomingEvents.isEmpty || !response.pastEvents.isEmpty
    }

    func load(userID: String, using apiClient: APIClient) async {
        state = .loading

        do {
            let response = try await apiClient.send(APIClient.mobileUserProfile(userID: userID))
            state = .loaded(response)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }
}
