import SwiftUI

@MainActor
final class EventFeedViewModel: ObservableObject {
    enum State {
        case idle
        case loading
        case loaded([EventFeedItem])
        case failed(String)
    }

    @Published private(set) var state: State = .idle

    func load(using apiClient: APIClient) async {
        state = .loading

        do {
            let events = try await apiClient.send(
                APIClient.mobileEventsPreview(limit: 40)
            )
            state = .loaded(events)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }
}
