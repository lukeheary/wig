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
    @Published private(set) var feedTimeZoneIdentifier: String?

    init() {
        state = .idle
    }

    static func preload(using apiClient: APIClient, cacheIdentity: String) async {
        let viewModel = EventFeedViewModel()
        let weekStart = Self.startOfWeek(for: .now)
        await viewModel.load(
            weekStart: weekStart,
            using: apiClient,
            cacheIdentity: cacheIdentity
        )

        // Current-week artwork is naturally warmed by the regular Home rows, but
        // future events can appear only in What's New. Warm the initially visible
        // carousel artwork before the launch screen is dismissed so those cards do
        // not reveal their images later than the rest of Home. Keep this bounded so
        // a large update feed cannot materially extend launch time.
        if let response = viewModel.response(for: weekStart),
           let updates = response.latestFromPlaces ?? response.latestFromFollows
        {
            await EventArtworkPrefetcher.prefetch(events: Array(updates.prefix(4)))
        }
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
        timeZone: TimeZone = .autoupdatingCurrent,
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
            let inFlightToken = Self.inFlightTokens[loadKey]
            loadingWeekStarts.insert(cacheKey)
            defer {
                loadingWeekStarts.remove(cacheKey)
            }

            if responsesByWeek.isEmpty {
                state = .loading
            }

            do {
                let response = try await inFlightLoad.value
                guard Self.inFlightTokens[loadKey] == inFlightToken else {
                    return
                }

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

            let requestStartDate = Self.displayRangeStartDate(for: cacheKey, timeZone: timeZone)
            guard let weekEnd = Self.weekEndDate(for: cacheKey, timeZone: timeZone) else {
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
            guard Self.inFlightTokens[loadKey] == token else {
                return
            }

            responsesByWeek[cacheKey] = response
            Self.preloadedResponses[loadKey] = response
            rememberCurrentUserLocation(from: response)
            state = .loaded(response)
        } catch {
            if shouldShowFullScreenLoading,
               Self.inFlightTokens[loadKey] == token {
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
        feedTimeZoneIdentifier = response.feedTimeZone

        guard let location = response.currentUserLocation else {
            return
        }

        currentUserLocation = location
    }

    private static func cacheKey(for date: Date) -> Date {
        weekCalendar.startOfDay(for: date)
    }

    static func displayRangeStartDate(
        for weekStart: Date,
        now: Date = .now,
        timeZone: TimeZone = .autoupdatingCurrent
    ) -> Date {
        let calendar = calendar(timeZone: timeZone)
        let currentWeekStart = startOfWeek(for: now, timeZone: timeZone)
        let startOfToday = calendar.startOfDay(for: now)
        let requestedWeekStart = date(placingLogicalDay: weekStart, in: calendar)

        if requestedWeekStart > currentWeekStart {
            return requestedWeekStart
        }

        if calendar.component(.hour, from: now) < 6 {
            return calendar.date(byAdding: .day, value: -1, to: startOfToday) ?? startOfToday
        }

        return startOfToday
    }

    static func weekEndDate(
        for weekStart: Date,
        timeZone: TimeZone = .autoupdatingCurrent
    ) -> Date? {
        let calendar = calendar(timeZone: timeZone)
        let requestedWeekStart = date(placingLogicalDay: weekStart, in: calendar)
        return calendar.date(byAdding: .day, value: 7, to: requestedWeekStart)
    }

    static func startOfWeek(
        for date: Date,
        timeZone: TimeZone = .autoupdatingCurrent
    ) -> Date {
        let calendar = calendar(timeZone: timeZone)
        let startOfDay = calendar.startOfDay(for: date)
        let weekday = calendar.component(.weekday, from: startOfDay)
        let daysFromMonday = (weekday - calendar.firstWeekday + 7) % 7

        return calendar.date(byAdding: .day, value: -daysFromMonday, to: startOfDay) ?? startOfDay
    }

    private static func date(placingLogicalDay date: Date, in calendar: Calendar) -> Date {
        let components = weekCalendar.dateComponents([.year, .month, .day], from: date)
        return calendar.date(from: components) ?? calendar.startOfDay(for: date)
    }

    private static func calendar(timeZone: TimeZone) -> Calendar {
        var calendar = weekCalendar
        calendar.timeZone = timeZone
        return calendar
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
