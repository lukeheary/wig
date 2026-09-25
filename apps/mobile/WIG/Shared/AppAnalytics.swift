import Foundation

/// The single analytics boundary for the app. Keep event names and parameter
/// values low-cardinality and never pass user-entered text or personal data.
enum AppAnalytics {
    enum Event: String {
        case authStarted = "auth_started"
        case login
        case signUp = "sign_up"
        case onboardingStart = "onboarding_start"
        case onboardingComplete = "onboarding_complete"
        case screenView = "screen_view"
        case search
        case viewSearchResults = "view_search_results"
        case selectContent = "select_content"
        case viewItem = "view_item"
        case rsvpUpdated = "rsvp_updated"
        case share
        case placeFollowed = "place_followed"
        case friendRequestSent = "friend_request_sent"
        case friendRequestResponded = "friend_request_responded"
        case pushPermissionResult = "push_permission_result"
        case notificationOpened = "notification_opened"
        case eventReviewSubmitted = "event_review_submitted"
    }

    typealias Parameters = [String: Any]

    private(set) static var isConfigured = false

    /// Analytics is temporarily disabled. This boundary remains in place so
    /// tracking can be restored without changing every call site.
    static func configure() {
        isConfigured = false
    }

    static func log(_ event: Event, _ parameters: Parameters = [:]) {}

    static func setUserID(_ userID: String?) {}

    static func setUserProperty(_ value: String?, name: String) {}

    static func resultCountBucket(_ count: Int) -> String {
        switch count {
        case 0: "0"
        case 1...5: "1_5"
        case 6...20: "6_20"
        default: "21_plus"
        }
    }

    static func daysUntilBucket(_ date: Date) -> String {
        let days = Calendar.current.dateComponents(
            [.day],
            from: Calendar.current.startOfDay(for: .now),
            to: Calendar.current.startOfDay(for: date)
        ).day ?? 0

        return switch days {
        case Int.min ... -1: "past"
        case 0: "today"
        case 1: "tomorrow"
        case 2...7: "2_7_days"
        case 8...30: "8_30_days"
        default: "31_plus_days"
        }
    }
}
