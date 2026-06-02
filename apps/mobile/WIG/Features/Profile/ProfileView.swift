import ClerkKit
import ClerkKitUI
import SwiftUI

struct ProfileView: View {
    @Environment(Clerk.self) private var clerk
    @EnvironmentObject private var appSession: AppSession

    var body: some View {
        NavigationStack {
            List {
                if appSession.isAuthBypassed {
                    Section("Local Development") {
                        Text("Auth is currently bypassed on this device.")
                            .foregroundStyle(.white.opacity(0.68))

                        Button("Return to Sign In") {
                            appSession.reset()
                        }
                        .foregroundStyle(Color(red: 0.27, green: 0.72, blue: 0.48))
                    }
                    .listRowBackground(ProfileTheme.cardBackground)
                }

                Section {
                    HStack {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Account")
                                .font(.headline)
                                .foregroundStyle(.white)

                            Text("Manage your Clerk profile and session.")
                                .font(.subheadline)
                                .foregroundStyle(.white.opacity(0.68))
                        }

                        Spacer()

                        if clerk.user != nil {
                            UserButton()
                        }
                    }
                    .padding(.vertical, 4)
                }
                .listRowBackground(ProfileTheme.cardBackground)

                Section("App") {
                    LabeledContent("API Base URL", value: AppConfig.shared.apiBaseURL.absoluteString)
                        .foregroundStyle(.white)
                }
                .listRowBackground(ProfileTheme.cardBackground)
            }
            .navigationTitle("Profile")
            .foregroundStyle(.white)
            .scrollContentBackground(.hidden)
            .background(ProfileTheme.background.ignoresSafeArea())
            .toolbarBackground(ProfileTheme.background, for: .navigationBar)
        }
    }
}

private enum ProfileTheme {
    static let background = Color(red: 0.07, green: 0.07, blue: 0.08)
    static let cardBackground = Color(red: 0.11, green: 0.11, blue: 0.13)
}
