import ClerkKit
import Foundation
import SwiftUI
import UIKit
import UserNotifications

enum PushNotificationDestination: Hashable, Sendable {
    case event(String)
    case profileRequests

    init?(userInfo: [AnyHashable: Any]) {
        let data = userInfo["data"] as? [String: Any] ?? [:]
        let type = data["type"] as? String ?? userInfo["type"] as? String
        if type == "friend_request" || type == "partner_request" {
            self = .profileRequests
            return
        }
        if let actionURL = data["actionUrl"] as? String ?? userInfo["actionUrl"] as? String,
           let components = URLComponents(string: actionURL),
           components.scheme == nil || ["http", "https"].contains(components.scheme?.lowercased() ?? ""),
           components.host == nil || ["whoisgoing.com", "www.whoisgoing.com"].contains(components.host?.lowercased() ?? "") {
            let path = components.path.split(separator: "/").map(String.init)
            if path.count == 2, path[0] == "event", Self.isEventIdentifier(path[1]) {
                self = .event(path[1])
                return
            }
            if ["/activity", "/profile"].contains(components.path),
               components.queryItems?.contains(where: { $0.name == "view" && $0.value == "requests" }) == true {
                self = .profileRequests
                return
            }
        }
        if ["event_update", "event_reminder", "rsvp_going", "rsvp_interested"].contains(type ?? ""),
           let eventID = data["entityId"] as? String ?? userInfo["entityId"] as? String,
           Self.isEventIdentifier(eventID) {
            self = .event(eventID)
            return
        }
        return nil
    }

    private static func isEventIdentifier(_ value: String) -> Bool {
        UUID(uuidString: value) != nil ||
            (value.count == 20 && value.unicodeScalars.allSatisfy {
                (48...57).contains($0.value) || (65...90).contains($0.value) || (97...122).contains($0.value)
            })
    }
}

struct PushNotificationNavigation: Identifiable, Equatable, Sendable {
    let id = UUID()
    let destination: PushNotificationDestination
}

@MainActor
final class PushNotificationManager: NSObject, ObservableObject {
    static let shared = PushNotificationManager()

    private let tokenDefaultsKey = "wig.push.apns-token"
    private let lastUploadedTokenDefaultsKey = "wig.push.last-uploaded-apns-token"
    private let promptedUserIDsDefaultsKey = "wig.push.prompted-user-ids"

    @Published private(set) var deviceToken: String?
    // Retain taps until the app shell and authentication are ready, including cold launches.
    @Published private(set) var pendingNavigation: PushNotificationNavigation?

    func navigate(to destination: PushNotificationDestination) {
        pendingNavigation = PushNotificationNavigation(destination: destination)
    }

    func finishNavigation(id: UUID) {
        guard pendingNavigation?.id == id else { return }
        pendingNavigation = nil
    }

    override init() {
        self.deviceToken = UserDefaults.standard.string(forKey: tokenDefaultsKey)
        super.init()
    }

    func requestAuthorizationAfterFirstLoginIfNeeded(clerk: Clerk, isAuthBypassed: Bool) {
        guard !isAuthBypassed, let userID = clerk.user?.id else {
            return
        }

        // Registration is also required for silent data-refresh pushes and does
        // not itself display a notification permission prompt.
        UIApplication.shared.registerForRemoteNotifications()

        UNUserNotificationCenter.current().getNotificationSettings { [weak self] settings in
            guard let self else { return }

            switch settings.authorizationStatus {
            case .notDetermined:
                Task { @MainActor in
                    guard !self.hasPromptedForNotifications(userID: userID) else {
                        return
                    }

                    self.markPromptedForNotifications(userID: userID)
                    self.requestAuthorization()
                }

            case .authorized, .provisional, .ephemeral:
                DispatchQueue.main.async {
                    UIApplication.shared.registerForRemoteNotifications()
                }

            case .denied:
                Task { @MainActor in
                    self.markPromptedForNotifications(userID: userID)
                }

            @unknown default:
                break
            }
        }
    }

    private func requestAuthorization() {
        UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound]) { granted, error in
            AppAnalytics.log(.pushPermissionResult, [
                "status": error == nil ? (granted ? "authorized" : "denied") : "error",
                "prompt_context": "after_first_login",
            ])
            if let error {
                print("Push authorization error:", error.localizedDescription)
            }

            guard granted else {
                return
            }

            DispatchQueue.main.async {
                UIApplication.shared.registerForRemoteNotifications()
            }
        }
    }

    private func hasPromptedForNotifications(userID: String) -> Bool {
        promptedNotificationUserIDs.contains(userID)
    }

    private func markPromptedForNotifications(userID: String) {
        var userIDs = promptedNotificationUserIDs
        userIDs.insert(userID)
        UserDefaults.standard.set(Array(userIDs), forKey: promptedUserIDsDefaultsKey)
    }

    private var promptedNotificationUserIDs: Set<String> {
        Set(UserDefaults.standard.stringArray(forKey: promptedUserIDsDefaultsKey) ?? [])
    }

    func updateDeviceToken(_ tokenData: Data) {
        let token = tokenData.map { String(format: "%02x", $0) }.joined()
        deviceToken = token
        UserDefaults.standard.set(token, forKey: tokenDefaultsKey)
    }

    func syncIfNeeded(using apiClient: APIClient, clerk: Clerk, isAuthBypassed: Bool) async {
        guard !isAuthBypassed, clerk.user != nil, let token = deviceToken else {
            return
        }

        let uploadedToken = UserDefaults.standard.string(forKey: lastUploadedTokenDefaultsKey)
        guard uploadedToken != token else {
            return
        }

        do {
            let endpoint = try APIClient.registerMobilePushToken(token: token, platform: "ios")
            try await apiClient.send(endpoint)
            UserDefaults.standard.set(token, forKey: lastUploadedTokenDefaultsKey)
        } catch {
            print("Failed to sync push token:", error.localizedDescription)
        }
    }
}

final class WIGAppDelegate: NSObject, UIApplicationDelegate {
    func application(
        _ application: UIApplication,
        didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil
    ) -> Bool {
        AppAnalytics.configure()
        UNUserNotificationCenter.current().delegate = self
        return true
    }

    func application(
        _ application: UIApplication,
        didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data
    ) {
        Task { @MainActor in
            PushNotificationManager.shared.updateDeviceToken(deviceToken)
        }
    }

    func application(
        _ application: UIApplication,
        didFailToRegisterForRemoteNotificationsWithError error: Error
    ) {
        print("Failed to register for remote notifications:", error.localizedDescription)
    }

    func application(
        _ application: UIApplication,
        didReceiveRemoteNotification userInfo: [AnyHashable: Any],
        fetchCompletionHandler completionHandler: @escaping (UIBackgroundFetchResult) -> Void
    ) {
        guard let data = userInfo["data"] as? [String: Any],
              data["type"] as? String == "profile_updated"
        else {
            completionHandler(.noData)
            return
        }

        Task { @MainActor in
            NotificationCenter.default.post(
                name: .appDataDidChange,
                object: nil,
                userInfo: data
            )
            completionHandler(.newData)
        }
    }
}

extension WIGAppDelegate: UNUserNotificationCenterDelegate {
    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse
    ) async {
        let userInfo = response.notification.request.content.userInfo
        let notificationType = (userInfo["data"] as? [String: Any])?["type"] as? String
            ?? userInfo["type"] as? String
            ?? "unknown"
        AppAnalytics.log(.notificationOpened, [
            "notification_type": notificationType,
            "action": response.actionIdentifier,
        ])
        guard response.actionIdentifier == UNNotificationDefaultActionIdentifier,
              let destination = PushNotificationDestination(userInfo: userInfo) else { return }
        await MainActor.run {
            PushNotificationManager.shared.navigate(to: destination)
        }
    }
}
