import SwiftUI

extension Notification.Name {
    static let eventRSVPDidChange = Notification.Name("eventRSVPDidChange")
    static let mobileEventDidChange = Notification.Name("mobileEventDidChange")
    static let mobileEventDidDelete = Notification.Name("mobileEventDidDelete")
    static let mobilePlaceDidChange = Notification.Name("mobilePlaceDidChange")
    static let homeFeedVisibilityDidChange = Notification.Name("homeFeedVisibilityDidChange")
    static let friendRequestDidChange = Notification.Name("friendRequestDidChange")
    static let activationDidChange = Notification.Name("activationDidChange")
}

@MainActor
final class EventFeedViewModel: ObservableObject {
    enum State {
        case idle
        case loading
        case loaded(MobileEventsResponse)
        case failed(String)
    }

    private struct LoadKey: Hashable {
        let weekStart: Date
        let cacheIdentity: String
    }

    private static var preloadedResponses = [LoadKey: MobileEventsResponse]()
    private static var inFlightLoads = [LoadKey: Task<MobileEventsResponse, Error>]()
    private static var inFlightTokens = [LoadKey: UUID]()

    @Published private(set) var state: State
    @Published private(set) var responsesByWeek = [Date: MobileEventsResponse]()
    @Published private(set) var loadingWeekStarts = Set<Date>()
    @Published private(set) var currentUserLocation: EventCity?

    init() {
        state = .idle
    }

    static func preload(using apiClient: APIClient, cacheIdentity: String) async {
        let viewModel = EventFeedViewModel()
        await viewModel.load(
            weekStart: Self.startOfWeek(for: .now),
            using: apiClient,
            cacheIdentity: cacheIdentity
        )
    }

    static func invalidateSharedCache() {
        preloadedResponses.removeAll()
        inFlightLoads.values.forEach { $0.cancel() }
        inFlightLoads.removeAll()
        inFlightTokens.removeAll()
    }

    func invalidateResponses(keeping weekStart: Date) {
        let retainedKey = Self.cacheKey(for: weekStart)
        let retainedResponse = responsesByWeek[retainedKey]

        responsesByWeek.removeAll()
        if let retainedResponse {
            responsesByWeek[retainedKey] = retainedResponse
        }
    }

    func load(
        using apiClient: APIClient,
        cacheIdentity: String = "guest",
        forceRefresh: Bool = false
    ) async {
        await load(
            weekStart: Self.startOfWeek(for: .now),
            using: apiClient,
            cacheIdentity: cacheIdentity,
            forceRefresh: forceRefresh
        )
    }

    func load(
        weekStart: Date,
        using apiClient: APIClient,
        cacheIdentity: String = "guest",
        forceRefresh: Bool = false
    ) async {
        let cacheKey = Self.cacheKey(for: weekStart)
        let loadKey = LoadKey(weekStart: cacheKey, cacheIdentity: cacheIdentity)

        if !forceRefresh, let cachedResponse = responsesByWeek[cacheKey] {
            rememberCurrentUserLocation(from: cachedResponse)
            state = .loaded(cachedResponse)
            return
        }

        if !forceRefresh, let preloadedResponse = Self.preloadedResponses[loadKey] {
            responsesByWeek[cacheKey] = preloadedResponse
            rememberCurrentUserLocation(from: preloadedResponse)
            state = .loaded(preloadedResponse)
            return
        }

        if !forceRefresh, let inFlightLoad = Self.inFlightLoads[loadKey] {
            loadingWeekStarts.insert(cacheKey)
            defer {
                loadingWeekStarts.remove(cacheKey)
            }

            if responsesByWeek.isEmpty {
                state = .loading
            }

            do {
                let response = try await inFlightLoad.value
                responsesByWeek[cacheKey] = response
                Self.preloadedResponses[loadKey] = response
                rememberCurrentUserLocation(from: response)
                state = .loaded(response)
            } catch {
                if responsesByWeek.isEmpty {
                    state = .failed(error.localizedDescription)
                }
            }

            return
        }

        let token = UUID()
        let shouldShowFullScreenLoading = responsesByWeek.isEmpty

        do {
            loadingWeekStarts.insert(cacheKey)

            if shouldShowFullScreenLoading {
                state = .loading
            }

            let requestStartDate = Self.displayRangeStartDate(for: cacheKey)
            guard let weekEnd = Self.weekEndDate(for: cacheKey) else {
                throw EventFeedError.invalidWeekRange
            }

            let loadTask = Task {
                try await apiClient.send(
                    APIClient.mobileEventsPreview(
                        startDate: requestStartDate,
                        endDate: weekEnd,
                        limit: 500
                    )
                )
            }
            Self.inFlightLoads[loadKey] = loadTask
            Self.inFlightTokens[loadKey] = token

            let response = try await loadTask.value
            responsesByWeek[cacheKey] = response
            Self.preloadedResponses[loadKey] = response
            rememberCurrentUserLocation(from: response)
            state = .loaded(response)
        } catch {
            if shouldShowFullScreenLoading {
                state = .failed(error.localizedDescription)
            }
        }

        loadingWeekStarts.remove(cacheKey)

        if Self.inFlightTokens[loadKey] == token {
            Self.inFlightLoads[loadKey] = nil
            Self.inFlightTokens[loadKey] = nil
        }
    }

    func response(for weekStart: Date) -> MobileEventsResponse? {
        responsesByWeek[Self.cacheKey(for: weekStart)]
    }

    func isLoading(weekStart: Date) -> Bool {
        loadingWeekStarts.contains(Self.cacheKey(for: weekStart))
    }

    private func rememberCurrentUserLocation(from response: MobileEventsResponse) {
        guard let location = response.currentUserLocation else {
            return
        }

        currentUserLocation = location
    }

    private static func cacheKey(for date: Date) -> Date {
        weekCalendar.startOfDay(for: date)
    }

    static func displayRangeStartDate(for weekStart: Date, now: Date = .now) -> Date {
        let currentWeekStart = startOfWeek(for: now)
        let startOfToday = weekCalendar.startOfDay(for: now)

        if weekStart > currentWeekStart {
            return cacheKey(for: weekStart)
        }

        if weekCalendar.component(.hour, from: now) < 6 {
            return weekCalendar.date(byAdding: .day, value: -1, to: startOfToday) ?? startOfToday
        }

        return startOfToday
    }

    static func weekEndDate(for weekStart: Date) -> Date? {
        weekCalendar.date(byAdding: .day, value: 7, to: cacheKey(for: weekStart))
    }

    static func startOfWeek(for date: Date) -> Date {
        let startOfDay = weekCalendar.startOfDay(for: date)
        let weekday = weekCalendar.component(.weekday, from: startOfDay)
        let daysFromMonday = (weekday - weekCalendar.firstWeekday + 7) % 7

        return weekCalendar.date(byAdding: .day, value: -daysFromMonday, to: startOfDay) ?? startOfDay
    }

    private static var weekCalendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.firstWeekday = 2
        return calendar
    }
}

private enum EventFeedError: LocalizedError {
    case invalidWeekRange

    var errorDescription: String? {
        "Couldn't calculate the selected week."
    }
}
