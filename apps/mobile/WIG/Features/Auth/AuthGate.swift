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
                avatarImageURL: nil,
                debug: nil
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

private struct MobileOnboardingView: View {
    let initialState: MobileOnboardingState
    let onComplete: () -> Void

    @Environment(\.apiClient) private var apiClient
    @Environment(Clerk.self) private var clerk
    @StateObject private var viewModel: MobileOnboardingViewModel
    @State private var username: String
    @State private var dateOfBirth: Date
    @State private var errorMessage: String?

    init(initialState: MobileOnboardingState, onComplete: @escaping () -> Void) {
        self.initialState = initialState
        self.onComplete = onComplete

        let initialDate = Self.date(from: initialState.dateOfBirth) ?? Self.defaultDateOfBirth
        _viewModel = StateObject(wrappedValue: MobileOnboardingViewModel())
        _username = State(initialValue: initialState.username)
        _dateOfBirth = State(initialValue: initialDate)
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: 24) {
                    header
                    usernameSection
                    birthdaySection
                    submitButton

                    if let errorMessage {
                        Text(errorMessage)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(.red.opacity(0.92))
                    }

                    #if DEBUG
                    if let debug = initialState.debug {
                        Text("debug: \(debug.reason) user=\(debug.userID) matched=\(debug.matchedUserID ?? "none") email=\(debug.matchedByEmail ? "yes" : "no")")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(.white.opacity(0.36))
                            .textSelection(.enabled)
                    }
                    #endif

                    signOutButton
                }
                .padding(.horizontal, 20)
                .padding(.top, 48)
                .padding(.bottom, 40)
            }
            .scrollIndicators(.hidden)
            .background(AppTheme.background.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Complete your profile")
                .font(.system(size: 32, weight: .black))
                .foregroundStyle(.white)

            Text("Add your username and birthday to finish setting up your account.")
                .font(.system(size: 16, weight: .medium))
                .foregroundStyle(.white.opacity(0.64))
                .lineSpacing(3)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var usernameSection: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Username")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(.white)

            TextField("johndoe", text: $username)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.asciiCapable)
                .submitLabel(.done)
                .font(.system(size: 16, weight: .semibold))
                .foregroundStyle(.white)
                .padding(.horizontal, 16)
                .frame(height: 54)
                .background(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .fill(Color.white.opacity(0.06))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(.white.opacity(0.08), lineWidth: 1)
                )
                .onChange(of: username) { _, value in
                    let lowered = value.lowercased()
                    if lowered != value {
                        username = lowered
                    }
                }

            Text("3-20 characters, letters, numbers, and underscores only")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.white.opacity(0.52))
        }
    }

    private var birthdaySection: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Birthday")
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(.white)

            DatePicker(
                "",
                selection: $dateOfBirth,
                in: ...Self.maximumDateOfBirth,
                displayedComponents: .date
            )
            .datePickerStyle(.wheel)
            .labelsHidden()
            .frame(maxWidth: .infinity)
            .padding(.vertical, 6)
            .background(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .fill(Color.white.opacity(0.06))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 24, style: .continuous)
                    .strokeBorder(.white.opacity(0.08), lineWidth: 1)
            )
        }
    }

    private var submitButton: some View {
        Button {
            submit()
        } label: {
            HStack(spacing: 10) {
                if viewModel.isSubmitting {
                    ProgressView()
                        .tint(.black)
                }

                Text("Continue")
                    .font(.system(size: 17, weight: .bold))
            }
            .foregroundStyle(.black)
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(Color.white)
            )
        }
        .buttonStyle(.plain)
        .disabled(viewModel.isSubmitting)
        .opacity(viewModel.isSubmitting ? 0.72 : 1)
    }

    private var signOutButton: some View {
        Button {
            Task {
                try? await clerk.auth.signOut(sessionId: clerk.session?.id)
            }
        } label: {
            Text("Sign out")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(.white.opacity(0.72))
                .frame(maxWidth: .infinity)
                .frame(height: 44)
        }
        .buttonStyle(.plain)
    }

    private func submit() {
        let normalizedUsername = username.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard Self.isValidUsername(normalizedUsername) else {
            errorMessage = "Username must be 3-20 characters and use only letters, numbers, or underscores."
            return
        }

        let formattedDateOfBirth = Self.serverDateFormatter.string(from: dateOfBirth)
        errorMessage = nil

        Task {
            do {
                _ = try await viewModel.complete(
                    username: normalizedUsername,
                    dateOfBirth: formattedDateOfBirth,
                    using: apiClient
                )
                onComplete()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private static func isValidUsername(_ value: String) -> Bool {
        value.range(of: #"^[a-zA-Z0-9_]{3,20}$"#, options: .regularExpression) != nil
    }

    private static func date(from value: String?) -> Date? {
        guard let value else {
            return nil
        }

        return serverDateFormatter.date(from: value)
    }

    private static let serverDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    private static let defaultDateOfBirth: Date = {
        Calendar(identifier: .gregorian).date(byAdding: .year, value: -24, to: .now) ?? .now
    }()

    private static let maximumDateOfBirth: Date = .now
}

@MainActor
private final class MobileOnboardingViewModel: ObservableObject {
    @Published private(set) var isSubmitting = false

    func complete(
        username: String,
        dateOfBirth: String,
        using apiClient: APIClient
    ) async throws -> MobileOnboardingState {
        guard !isSubmitting else {
            throw APIClient.APIError.invalidResponse
        }

        isSubmitting = true
        defer { isSubmitting = false }

        let endpoint = try APIClient.completeMobileOnboarding(
            username: username,
            dateOfBirth: dateOfBirth
        )
        return try await apiClient.send(endpoint)
    }
}
