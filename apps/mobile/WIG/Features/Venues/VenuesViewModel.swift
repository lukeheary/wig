import SwiftUI

@MainActor
final class VenuesViewModel: ObservableObject {
    enum State {
        case idle
        case loading
        case loaded([PlaceListItem])
        case failed(String)
    }

    @Published private(set) var state: State = .idle

    func load(using apiClient: APIClient) async {
        state = .loading

        do {
            let places = try await apiClient.send(
                APIClient.mobilePlaces(limit: 150)
            )
            state = .loaded(places)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }
}

