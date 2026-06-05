import SwiftUI

extension Notification.Name {
    static let eventRSVPDidChange = Notification.Name("eventRSVPDidChange")
}

@MainActor
final class EventFeedViewModel: ObservableObject {
    enum State {
        case idle
        case loading
        case loaded(MobileEventsResponse)
        case failed(String)
    }

    private static var cachedResponse: MobileEventsResponse?
    private static var inFlightLoad: Task<MobileEventsResponse, Error>?
    private static var inFlightToken: UUID?

    @Published private(set) var state: State

    init() {
        if let cachedResponse = Self.cachedResponse {
            state = .loaded(cachedResponse)
        } else {
            state = .idle
        }
    }

    func load(using apiClient: APIClient, forceRefresh: Bool = false) async {
        if !forceRefresh, let cachedResponse = Self.cachedResponse {
            state = .loaded(cachedResponse)
            return
        }

        if !forceRefresh, let inFlightLoad = Self.inFlightLoad {
            state = .loading

            do {
                let response = try await inFlightLoad.value
                state = .loaded(response)
            } catch {
                state = .failed(error.localizedDescription)
            }

            return
        }

        let token = UUID()
        let shouldShowFullScreenLoading: Bool
        if case .loaded = state, forceRefresh {
            shouldShowFullScreenLoading = false
        } else {
            shouldShowFullScreenLoading = true
        }

        do {
            if shouldShowFullScreenLoading {
                state = .loading
            }

            let loadTask = Task {
                try await apiClient.send(APIClient.mobileEventsPreview(limit: 50))
            }
            Self.inFlightLoad = loadTask
            Self.inFlightToken = token

            let response = try await loadTask.value
            Self.cachedResponse = response
            state = .loaded(response)
        } catch {
            if shouldShowFullScreenLoading {
                state = .failed(error.localizedDescription)
            }
        }

        if Self.inFlightToken == token {
            Self.inFlightLoad = nil
            Self.inFlightToken = nil
        }
    }
}
