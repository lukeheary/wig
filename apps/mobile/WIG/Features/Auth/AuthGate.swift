import ClerkKit
import SwiftUI

struct AuthGate: View {
    @Environment(Clerk.self) private var clerk
    @Environment(\.apiClient) private var apiClient
    @EnvironmentObject private var appSession: AppSession
    @StateObject private var viewModel = MobileAuthGateViewModel()

    var body: some View {
        Group {
            if !requiresOnboardingGate {
                MainTabView()
            } else {
                switch viewModel.state {
                case .idle, .loading:
                    ProgressView("Loading account...")
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                        .tint(.white)
                        .foregroundStyle(.white)
                        .background(AppTheme.background)

                case .failed(let message):
                    MobileOnboardingGateErrorView(message: message) {
                        Task {
                            await viewModel.load(using: apiClient)
                        }
                    }

                case .loaded(let onboardingState):
                    if onboardingState.isOnboarding {
                        MobileOnboardingView(initialState: onboardingState) {
                            viewModel.markCompleted()
                        }
                    } else {
                        MainTabView()
                    }
                }
            }
        }
        .task(id: gateTaskID) {
            guard requiresOnboardingGate else {
                return
            }

            await viewModel.load(using: apiClient)
        }
        .onChange(of: requiresOnboardingGate) { _, requiresOnboardingGate in
            if !requiresOnboardingGate {
                viewModel.reset()
            }
        }
    }

    private var requiresOnboardingGate: Bool {
        !appSession.isAuthBypassed && clerk.user != nil
    }

    private var gateTaskID: String {
        "\(clerk.user?.id ?? "guest")-\(appSession.isAuthBypassed)"
    }
}

@MainActor
private final class MobileAuthGateViewModel: ObservableObject {
    enum State {
        case idle
        case loading
        case loaded(MobileOnboardingState)
        case failed(String)
    }

    @Published private(set) var state: State = .idle

    func load(using apiClient: APIClient) async {
        if case .loading = state {
            return
        }

        state = .loading

        do {
            let response = try await apiClient.send(APIClient.mobileOnboardingState())
            state = .loaded(response)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    func markCompleted() {
        state = .loaded(
            MobileOnboardingState(
                isOnboarding: false,
                username: "",
                dateOfBirth: nil,
                avatarImageURL: nil
            )
        )
    }

    func reset() {
        state = .idle
    }
}

private struct MobileOnboardingGateErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Text("Couldn't Load Account")
                .font(.system(size: 24, weight: .bold))
                .foregroundStyle(.white)

            Text(message)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(.white.opacity(0.64))
                .multilineTextAlignment(.center)

            Button(action: onRetry) {
                Text("Try Again")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.black)
                    .frame(width: 140, height: 50)
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.plain)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AppTheme.background)
    }
}
