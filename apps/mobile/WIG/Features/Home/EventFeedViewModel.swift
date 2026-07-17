import SwiftUI

extension Notification.Name {
    static let eventRSVPDidChange = Notification.Name("eventRSVPDidChange")
    static let mobileEventDidChange = Notification.Name("mobileEventDidChange")
    static let mobileEventDidDelete = Notification.Name("mobileEventDidDelete")
    static let mobilePlaceDidChange = Notification.Name("mobilePlaceDidChange")
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

    private static var inFlightLoads = [Date: Task<MobileEventsResponse, Error>]()
    private static var inFlightTokens = [Date: UUID]()

    @Published private(set) var state: State
    @Published private(set) var responsesByWeek = [Date: MobileEventsResponse]()
    @Published private(set) var loadingWeekStarts = Set<Date>()
    @Published private(set) var currentUserLocation: EventCity?

    init() {
        state = .idle
    }

    func load(using apiClient: APIClient, forceRefresh: Bool = false) async {
        await load(weekStart: Self.cacheKey(for: .now), using: apiClient, forceRefresh: forceRefresh)
    }

    func load(
        weekStart: Date,
        using apiClient: APIClient,
        forceRefresh: Bool = false
    ) async {
        let cacheKey = Self.cacheKey(for: weekStart)

        if !forceRefresh, let cachedResponse = responsesByWeek[cacheKey] {
            rememberCurrentUserLocation(from: cachedResponse)
            state = .loaded(cachedResponse)
            return
        }

        if !forceRefresh, let inFlightLoad = Self.inFlightLoads[cacheKey] {
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
            Self.inFlightLoads[cacheKey] = loadTask
            Self.inFlightTokens[cacheKey] = token

            let response = try await loadTask.value
            responsesByWeek[cacheKey] = response
            rememberCurrentUserLocation(from: response)
            state = .loaded(response)
        } catch {
            if shouldShowFullScreenLoading {
                state = .failed(error.localizedDescription)
            }
        }

        loadingWeekStarts.remove(cacheKey)

        if Self.inFlightTokens[cacheKey] == token {
            Self.inFlightLoads[cacheKey] = nil
            Self.inFlightTokens[cacheKey] = nil
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
