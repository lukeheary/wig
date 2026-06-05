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
    @Published private(set) var isUpdatingFollow = false

    func load(slug: String, using apiClient: APIClient) async {
        state = .loading

        do {
            let detail = try await apiClient.send(APIClient.mobilePlaceDetail(slug: slug))
            state = .loaded(detail)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    func setFollowed(_ isFollowed: Bool, slug: String, using apiClient: APIClient) async {
        guard case .loaded(var detail) = state else {
            return
        }

        let previousDetail = detail
        detail.isFollowed = isFollowed
        state = .loaded(detail)
        isUpdatingFollow = true

        do {
            let followState: PlaceFollowState
            if isFollowed {
                followState = try await apiClient.send(APIClient.followMobilePlace(slug: slug))
            } else {
                followState = try await apiClient.send(APIClient.unfollowMobilePlace(slug: slug))
            }

            detail.isFollowed = followState.isFollowed
            state = .loaded(detail)
        } catch {
            state = .loaded(previousDetail)
        }

        isUpdatingFollow = false
    }
}
