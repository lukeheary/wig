import ClerkKit
import SwiftUI
import UIKit

@main
struct WIGApp: App {
    @UIApplicationDelegateAdaptor(WIGAppDelegate.self) private var appDelegate
    @StateObject private var appSession = AppSession()
    @StateObject private var pushNotificationManager = PushNotificationManager.shared
    private let apiClient: APIClient

    init() {
        let redirectScheme = AppConfig.shared.oauthCallbackScheme
        let redirectURL = "\(redirectScheme)://callback"

        Clerk.configure(
            publishableKey: AppConfig.shared.clerkPublishableKey,
            options: .init(
                redirectConfig: .init(
                    redirectUrl: redirectURL,
                    callbackUrlScheme: redirectScheme
                )
            )
        )

        apiClient = APIClient.live(
            baseURL: AppConfig.shared.apiBaseURL,
            tokenProvider: ClerkSessionTokenProvider(
                clerk: Clerk.shared,
                jwtTemplate: AppConfig.shared.clerkJWTTemplate
            )
        )

        UIWindow.appearance().backgroundColor = AppTheme.uiBackground
        UINavigationBar.appearance().overrideUserInterfaceStyle = .dark
        UITabBar.appearance().overrideUserInterfaceStyle = .dark
    }

    var body: some Scene {
        WindowGroup {
            ZStack {
                AppRootView()
                ClerkEnvironmentSessionGuard()
                    .allowsHitTesting(false)
                PushNotificationSyncView()
                    .allowsHitTesting(false)
            }
                .preferredColorScheme(.dark)
                .environment(Clerk.shared)
                .environment(\.apiClient, apiClient)
                .environmentObject(appSession)
                .environmentObject(pushNotificationManager)
        }
    }
}

private struct ClerkEnvironmentSessionGuard: View {
    @Environment(Clerk.self) private var clerk

    private let configuredPublishableKey = AppConfig.shared.clerkPublishableKey
    private let storedPublishableKeyDefaultsKey = "wig.clerk.configured-publishable-key"

    var body: some View {
        Color.clear
            .task(id: configuredPublishableKey) {
                let defaults = UserDefaults.standard
                let previousPublishableKey = defaults.string(forKey: storedPublishableKeyDefaultsKey)

                if let previousPublishableKey,
                   previousPublishableKey != configuredPublishableKey
                {
                    try? await clerk.auth.signOut()
                }

                defaults.set(configuredPublishableKey, forKey: storedPublishableKeyDefaultsKey)
            }
    }
}

private struct PushNotificationSyncView: View {
    @Environment(Clerk.self) private var clerk
    @Environment(\.apiClient) private var apiClient
    @EnvironmentObject private var appSession: AppSession
    @EnvironmentObject private var pushNotificationManager: PushNotificationManager

    var body: some View {
        Color.clear
            .task(id: "\(clerk.user?.id ?? "guest")-\(appSession.isAuthBypassed)-\(pushNotificationManager.deviceToken ?? "no-token")") {
                pushNotificationManager.requestAuthorizationAfterFirstLoginIfNeeded(
                    clerk: clerk,
                    isAuthBypassed: appSession.isAuthBypassed
                )

                await pushNotificationManager.syncIfNeeded(
                    using: apiClient,
                    clerk: clerk,
                    isAuthBypassed: appSession.isAuthBypassed
                )
            }
    }
}
