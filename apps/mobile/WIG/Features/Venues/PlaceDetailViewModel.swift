import SwiftUI

@MainActor
final class PlaceDetailViewModel: ObservableObject {
    enum State {
        case idle
        case loading
        case loaded(PlaceDetail)
        case failed(String)
    }

    @Published private(set) var state: State = .idle

    func load(slug: String, using apiClient: APIClient) async {
        state = .loading

        do {
            let detail = try await apiClient.send(APIClient.mobilePlaceDetail(slug: slug))
            state = .loaded(detail)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }
}

