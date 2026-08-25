import ClerkKit
import Foundation
import SwiftUI
import UIKit
import UserNotifications

@MainActor
final class PushNotificationManager: NSObject, ObservableObject {
    static let shared = PushNotificationManager()

    private let tokenDefaultsKey = "wig.push.apns-token"
    private let lastUploadedTokenDefaultsKey = "wig.push.last-uploaded-apns-token"
    private let promptedUserIDsDefaultsKey = "wig.push.prompted-user-ids"

    @Published private(set) var deviceToken: String?

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
    }
}
