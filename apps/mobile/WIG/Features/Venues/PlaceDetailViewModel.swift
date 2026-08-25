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
    @Published private(set) var isUpdatingHomeVisibility = false
    @Published private(set) var homeVisibilityErrorMessage: String?

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

    func load(
        slug: String,
        using apiClient: APIClient,
        forceRefresh: Bool = false
    ) async {
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

    @discardableResult
    func setFollowed(_ isFollowed: Bool, slug: String, using apiClient: APIClient) async -> Bool {
        guard case .loaded(var detail) = state else {
            return false
        }

        let previousDetail = detail
        applyFollowState(isFollowed, to: &detail)
        Self.seedCache(with: detail)
        state = .loaded(detail)
        postFollowChange(for: detail)
        isUpdatingFollow = true

        do {
            let followState: PlaceFollowState
            if isFollowed {
                followState = try await apiClient.send(APIClient.followMobilePlace(slug: slug))
            } else {
                followState = try await apiClient.send(APIClient.unfollowMobilePlace(slug: slug))
            }

            applyFollowState(followState.isFollowed, to: &detail)
            Self.seedCache(with: detail)
            state = .loaded(detail)
            postFollowChange(for: detail, notifiesGlobalDataChange: true)
            if isFollowed {
                NotificationCenter.default.post(name: .activationDidChange, object: nil)
            }
            if followState.isFollowed == isFollowed {
                AppAnalytics.log(.placeFollowed, [
                    "followed": isFollowed,
                    "place_type": detail.type.rawValue,
                ])
            }
            isUpdatingFollow = false
            return followState.isFollowed == isFollowed
        } catch {
            Self.seedCache(with: previousDetail)
            state = .loaded(previousDetail)
            postFollowChange(for: previousDetail)
            isUpdatingFollow = false
            return false
        }
    }

    private func applyFollowState(_ isFollowed: Bool, to detail: inout PlaceDetail) {
        guard detail.isFollowed != isFollowed else {
            return
        }

        detail.isFollowed = isFollowed
        detail.followerCount = max(0, detail.followerCount + (isFollowed ? 1 : -1))
    }

    private func postFollowChange(
        for detail: PlaceDetail,
        notifiesGlobalDataChange: Bool = false
    ) {
        NotificationCenter.default.post(
            name: .placeFollowDidChange,
            object: PlaceFollowChange(slug: detail.slug, isFollowed: detail.isFollowed)
        )

        if notifiesGlobalDataChange {
            NotificationCenter.default.post(name: .appDataDidChange, object: nil)
        }
    }

    func setHiddenFromHome(
        _ isHiddenFromHome: Bool,
        slug: String,
        using apiClient: APIClient
    ) async {
        guard case .loaded(var detail) = state else {
            return
        }

        let previousDetail = detail
        homeVisibilityErrorMessage = nil
        detail.isHiddenFromHome = isHiddenFromHome
        state = .loaded(detail)
        isUpdatingHomeVisibility = true
        defer { isUpdatingHomeVisibility = false }

        do {
            let visibilityState: PlaceHomeVisibilityState
            if isHiddenFromHome {
                visibilityState = try await apiClient.send(
                    APIClient.hideMobilePlaceFromHome(slug: slug)
                )
            } else {
                visibilityState = try await apiClient.send(
                    APIClient.showMobilePlaceOnHome(slug: slug)
                )
            }

            detail.isHiddenFromHome = visibilityState.isHiddenFromHome
            Self.seedCache(with: detail)
            state = .loaded(detail)
            EventFeedViewModel.invalidateSharedCache()
            NotificationCenter.default.post(
                name: .homeFeedVisibilityDidChange,
                object: detail.id
            )
        } catch {
            state = .loaded(previousDetail)
            homeVisibilityErrorMessage = error.localizedDescription
        }
    }

    func clearHomeVisibilityError() {
        homeVisibilityErrorMessage = nil
    }
}
