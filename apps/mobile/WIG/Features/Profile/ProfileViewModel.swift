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

    func load(using apiClient: APIClient) async {
        state = .loading

        do {
            let response = try await apiClient.send(APIClient.mobileFriends())
            state = .loaded(response)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }
}
