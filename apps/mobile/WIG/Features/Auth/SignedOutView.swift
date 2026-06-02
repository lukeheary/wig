import ClerkKitUI
import SwiftUI

struct SignedOutView: View {
    @EnvironmentObject private var appSession: AppSession

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 12) {
                    Text("WIG")
                        .font(.largeTitle.bold())

                    Text("Sign in to access your gifts, people, lists, and account settings.")
                        .font(.body)
                        .foregroundStyle(.secondary)
                }

                Button("Skip Auth for Local Development") {
                    appSession.skipAuth()
                }
                .buttonStyle(.bordered)

                AuthView(isDismissable: false)
                    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            }
            .padding(.horizontal, 24)
            .padding(.top, 24)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(Color(.systemBackground))
            .navigationBarHidden(true)
        }
    }
}

#Preview {
    SignedOutView()
}
