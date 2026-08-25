import FirebaseAnalytics
import FirebaseCore
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
    private static var isExcludedUser = false
    private static let excludedUserIDs: Set<String> = [
        "user_3A5qsDzSX1NPRfpcqfOTLEb2aOG",
    ]

    /// Configures Firebase when GoogleService-Info.plist has been added to the
    /// target. Local builds remain usable before that one-time setup step.
    static func configure() {
        guard !isConfigured, FirebaseApp.app() == nil else {
            isConfigured = FirebaseApp.app() != nil
            return
        }

        guard let path = Bundle.main.path(forResource: "GoogleService-Info", ofType: "plist"),
              let options = FirebaseOptions(contentsOfFile: path)
        else {
            #if DEBUG
            print("Analytics disabled: GoogleService-Info.plist is not configured.")
            #endif
            return
        }

        FirebaseApp.configure(options: options)
        isConfigured = true
    }

    static func log(_ event: Event, _ parameters: Parameters = [:]) {
        guard isConfigured, !isExcludedUser else { return }
        Analytics.logEvent(event.rawValue, parameters: sanitized(parameters))
    }

    static func setUserID(_ userID: String?) {
        guard isConfigured else { return }
        isExcludedUser = userID.map(excludedUserIDs.contains) ?? false
        Analytics.setAnalyticsCollectionEnabled(!isExcludedUser)
        Analytics.setUserID(isExcludedUser ? nil : userID)
    }

    static func setUserProperty(_ value: String?, name: String) {
        guard isConfigured, !isExcludedUser else { return }
        Analytics.setUserProperty(value, forName: name)
    }

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

    private static func sanitized(_ parameters: Parameters) -> Parameters {
        parameters.reduce(into: Parameters()) { result, entry in
            let key = String(entry.key.prefix(40))
            switch entry.value {
            case let value as String:
                result[key] = String(value.prefix(100))
            case let value as Bool:
                result[key] = value ? 1 : 0
            case let value as Int:
                result[key] = value
            case let value as Double:
                result[key] = value
            default:
                assertionFailure("Unsupported analytics parameter: \(entry.key)")
            }
        }
    }
}
