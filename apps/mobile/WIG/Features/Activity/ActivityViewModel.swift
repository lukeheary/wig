import Foundation

@MainActor
final class ActivityViewModel: ObservableObject {
    enum State {
        case idle
        case loading
        case loaded(ActivityFeedResponse)
        case failed(String)
    }

    @Published private(set) var state: State = .idle

    func load(using apiClient: APIClient, forceRefresh: Bool = false) async {
        let shouldShowFullScreenLoading: Bool
        if case .loaded = state, forceRefresh {
            shouldShowFullScreenLoading = false
        } else {
            shouldShowFullScreenLoading = true
        }

        if shouldShowFullScreenLoading {
            state = .loading
        }

        do {
            let response = try await apiClient.send(APIClient.mobileActivity(limit: 50))
            state = .loaded(response)
        } catch {
            if shouldShowFullScreenLoading {
                state = .failed(error.localizedDescription)
            }
        }
    }
}
