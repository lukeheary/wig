import ClerkKitUI
import SwiftUI

struct AppRootView: View {
    var body: some View {
        ZStack {
            Color(.systemBackground)
                .ignoresSafeArea()

            AuthGate()
        }
    }
}
