import SwiftUI

@MainActor
final class AppSession: ObservableObject {
    @Published var isAuthBypassed = false

    func skipAuth() {
        isAuthBypassed = true
    }

    func reset() {
        isAuthBypassed = false
    }
}
