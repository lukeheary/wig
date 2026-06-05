import SwiftUI

@MainActor
final class VenuesViewModel: ObservableObject {
    enum State {
        case idle
        case loading
        case loaded(MobilePlacesResponse)
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
            let response = try await apiClient.send(
                APIClient.mobilePlaces(limit: 150)
            )
            state = .loaded(response)
        } catch {
            if shouldShowFullScreenLoading {
                state = .failed(error.localizedDescription)
            }
        }
    }
}
