import ClerkKit
import ClerkKitUI
import SwiftUI

// Themed wrapper around ClerkKitUI's AuthView for presentation as a sheet.
//
// The Clerk SDK doesn't expose APIs to remove individual UI elements (title,
// subtitle, "Secured by Clerk"), so those remain. What we can control:
//   - dark background matching the app
//   - WIG logo via .clerkAppIcon()
//   - white Continue button with dark text
//   - Google button using the dark theme
//
// "Secured by Clerk" only appears when branding is enabled in the Clerk
// dashboard — disable it there to remove it permanently.
struct WIGAuthSheetView: View {
    let isDismissible: Bool

    var body: some View {
        AuthView(isDismissible: isDismissible)
            .environment(Clerk.shared)
            .environment(\.clerkTheme, Self.theme)
            .clerkAppIcon(Image("LaunchIcon"))
    }
}

private extension WIGAuthSheetView {
    @MainActor
    static let theme: ClerkTheme = makeTheme()

    @MainActor
    static func makeTheme() -> ClerkTheme {
        let bg = Color(red: 0.09, green: 0.09, blue: 0.11)
        let inputBg = Color(red: 0.15, green: 0.15, blue: 0.19)

        return ClerkTheme(
            colors: .init(
                primary: .white,
                background: bg,
                input: inputBg,
                foreground: .white,
                mutedForeground: Color.white.opacity(0.46),
                primaryForeground: Color(red: 0.08, green: 0.08, blue: 0.10),
                inputForeground: .white,
                neutral: .white,
                ring: Color.white.opacity(0.40),
                muted: Color(red: 0.14, green: 0.14, blue: 0.17),
                shadow: Color.black.opacity(0.30),
                border: Color.white.opacity(0.30)
            )
        )
    }
}
