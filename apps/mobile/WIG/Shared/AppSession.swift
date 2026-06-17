import SwiftUI

@MainActor
final class AppSession: ObservableObject {
    @Published var isAuthBypassed = false
    @Published var isAdmin = false
    @Published private(set) var eventDetailPresentationCount = 0

    var shouldShowFloatingCreationButton: Bool {
        isAdmin && eventDetailPresentationCount == 0
    }

    func skipAuth() {
        isAuthBypassed = true
    }

    func reset() {
        isAuthBypassed = false
        isAdmin = false
    }

    func updateAdminStatus(_ isAdmin: Bool) {
        self.isAdmin = isAdmin
    }

    func beginEventDetailPresentation() {
        eventDetailPresentationCount += 1
    }

    func endEventDetailPresentation() {
        eventDetailPresentationCount = max(0, eventDetailPresentationCount - 1)
    }
}
