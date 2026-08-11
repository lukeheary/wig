import AuthenticationServices
import ClerkKit
import Foundation

@MainActor
final class GuestGoogleAuthController: ObservableObject {
    enum Outcome: Equatable {
        case completed
        case needsContinuation
        case cancelled
        case failed
    }

    @Published private(set) var isLoading = false
    @Published var errorMessage: String?

    func signIn(using clerk: Clerk) async -> Outcome {
        guard !isLoading else { return .cancelled }

        isLoading = true
        errorMessage = nil
        defer { isLoading = false }

        do {
            let result = try await clerk.auth.signInWithOAuth(
                provider: .google,
                transferable: true
            )

            switch result {
            case .signIn(let signIn):
                return signIn.status == .complete ? .completed : .needsContinuation
            case .signUp(let signUp):
                return signUp.status == .complete ? .completed : .needsContinuation
            }
        } catch {
            guard !Self.isCancellation(error) else { return .cancelled }
            errorMessage = error.localizedDescription
            return .failed
        }
    }

    private static func isCancellation(_ error: Error) -> Bool {
        if case ASWebAuthenticationSessionError.canceledLogin = error {
            return true
        }

        let nsError = error as NSError
        return nsError.domain == ASAuthorizationError.errorDomain &&
            nsError.code == ASAuthorizationError.Code.canceled.rawValue
    }
}
