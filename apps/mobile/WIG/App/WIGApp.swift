import ClerkKit
import SwiftUI
import UIKit

@main
struct WIGApp: App {
    @StateObject private var appSession = AppSession()
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
            AppRootView()
                .preferredColorScheme(.dark)
                .environment(Clerk.shared)
                .environment(\.apiClient, apiClient)
                .environmentObject(appSession)
        }
    }
}
