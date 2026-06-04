import ClerkKitUI
import SwiftUI

struct SignedOutView: View {
    @EnvironmentObject private var appSession: AppSession

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(spacing: 26) {
                    header

                    AuthView(isDismissable: false)
                        .frame(maxWidth: .infinity)
                        .padding(.horizontal, 2)
                        .padding(.vertical, 8)
                        .background(
                            RoundedRectangle(cornerRadius: 28, style: .continuous)
                                .fill(Color(red: 0.10, green: 0.10, blue: 0.12))
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 28, style: .continuous)
                                .strokeBorder(.white.opacity(0.08), lineWidth: 1)
                        )

                    #if DEBUG
                    Button {
                        appSession.skipAuth()
                    } label: {
                        Text("Skip auth for local development")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.62))
                            .padding(.horizontal, 14)
                            .padding(.vertical, 9)
                            .background(Color.white.opacity(0.08), in: Capsule())
                    }
                    .buttonStyle(.plain)
                    #endif
                }
                .padding(.horizontal, 22)
                .padding(.top, 92)
                .padding(.bottom, 44)
            }
            .scrollIndicators(.hidden)
            .background(background)
            .navigationBarHidden(true)
        }
    }

    private var header: some View {
        VStack(spacing: 12) {
            Text("Who Is Going")
                .font(.system(size: 42, weight: .black))
                .foregroundStyle(.white)
                .multilineTextAlignment(.center)

            Text("Sign in to see who is going out tonight.")
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(.white.opacity(0.60))
                .multilineTextAlignment(.center)
                .lineSpacing(2)
        }
        .frame(maxWidth: .infinity)
    }

    private var background: some View {
        LinearGradient(
            colors: [
                Color.black,
                Color(red: 0.07, green: 0.07, blue: 0.08),
                Color(red: 0.10, green: 0.10, blue: 0.12),
            ],
            startPoint: .top,
            endPoint: .bottom
        )
        .ignoresSafeArea()
    }
}

#Preview {
    SignedOutView()
}
