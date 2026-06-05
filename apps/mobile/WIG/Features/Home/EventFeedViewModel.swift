import SwiftUI

extension Notification.Name {
    static let eventRSVPDidChange = Notification.Name("eventRSVPDidChange")
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

        if !forceRefresh, let inFlightLoad = Self.inFlightLoads[cacheKey] {
            state = .loading

            do {
                let response = try await inFlightLoad.value
                state = .loaded(response)
            } catch {
                state = .failed(error.localizedDescription)
            }

            return
        }

        let token = UUID()
        let shouldShowFullScreenLoading: Bool
        if case .loaded = state, forceRefresh {
            shouldShowFullScreenLoading = false
        } else {
            shouldShowFullScreenLoading = true
        }

        do {
            if shouldShowFullScreenLoading {
                state = .loading
            }

            guard let weekEnd = Self.weekCalendar.date(byAdding: .day, value: 7, to: cacheKey) else {
                throw EventFeedError.invalidWeekRange
            }

            let loadTask = Task {
                try await apiClient.send(
                    APIClient.mobileEventsPreview(
                        startDate: cacheKey,
                        endDate: weekEnd,
                        limit: 500
                    )
                )
            }
            Self.inFlightLoads[cacheKey] = loadTask
            Self.inFlightTokens[cacheKey] = token

            let response = try await loadTask.value
            state = .loaded(response)
        } catch {
            if shouldShowFullScreenLoading {
                state = .failed(error.localizedDescription)
            }
        }

        if Self.inFlightTokens[cacheKey] == token {
            Self.inFlightLoads[cacheKey] = nil
            Self.inFlightTokens[cacheKey] = nil
        }
    }

    private static func cacheKey(for date: Date) -> Date {
        weekCalendar.startOfDay(for: date)
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
