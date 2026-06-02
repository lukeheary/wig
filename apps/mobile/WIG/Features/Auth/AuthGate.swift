import ClerkKit
import SwiftUI

struct AuthGate: View {
    @Environment(Clerk.self) private var clerk
    @EnvironmentObject private var appSession: AppSession

    var body: some View {
        Group {
            if appSession.isAuthBypassed || clerk.user != nil {
                MainTabView()
            } else {
                SignedOutView()
            }
        }
    }
}
