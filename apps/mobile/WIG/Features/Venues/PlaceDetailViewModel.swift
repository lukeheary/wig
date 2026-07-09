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

    private static var cachedDetails: [String: PlaceDetail] = [:]
    private static var inFlightLoads: [String: Task<PlaceDetail, Error>] = [:]

    static func cachedDetail(for slug: String) -> PlaceDetail? {
        cachedDetails[slug]
    }

    static func invalidateCache(for slug: String) {
        cachedDetails[slug] = nil
        inFlightLoads[slug]?.cancel()
        inFlightLoads[slug] = nil
    }

    static func seedCache(with detail: PlaceDetail) {
        cachedDetails[detail.slug] = detail
    }

    func load(slug: String, using apiClient: APIClient, forceRefresh: Bool = false) async {
        if !forceRefresh, let cachedDetail = Self.cachedDetail(for: slug) {
            state = .loaded(cachedDetail)
        } else {
            state = .loading
        }

        if !forceRefresh, let inFlightLoad = Self.inFlightLoads[slug] {
            do {
                let detail = try await inFlightLoad.value
                Self.seedCache(with: detail)
                state = .loaded(detail)
            } catch {
                if Self.cachedDetail(for: slug) == nil {
                    state = .failed(error.localizedDescription)
                }
            }

            return
        }

        do {
            let loadTask = Task {
                try await apiClient.send(APIClient.mobilePlaceDetail(slug: slug))
            }
            Self.inFlightLoads[slug] = loadTask

            let detail = try await loadTask.value
            Self.seedCache(with: detail)
            state = .loaded(detail)
        } catch {
            if Self.cachedDetail(for: slug) == nil {
                state = .failed(error.localizedDescription)
            }
        }

        Self.inFlightLoads[slug] = nil
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
            Self.seedCache(with: detail)
            state = .loaded(detail)
        } catch {
            state = .loaded(previousDetail)
        }

        isUpdatingFollow = false
    }
}
