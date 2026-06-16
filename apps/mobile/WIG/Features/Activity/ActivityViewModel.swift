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
    private static var cachedResponse: ActivityFeedResponse?
    private static var inFlightLoad: Task<ActivityFeedResponse, Error>?

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
            let loadTask = Task {
                try await apiClient.send(APIClient.mobileActivity(limit: 50))
            }
            Self.inFlightLoad = loadTask

            let response = try await loadTask.value
            Self.cachedResponse = response
            state = .loaded(response)
        } catch {
            if shouldShowFullScreenLoading {
                state = .failed(error.localizedDescription)
            }
        }

        Self.inFlightLoad = nil
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
            try await apiClient.send(APIClient.mobileActivity(limit: 50))
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
