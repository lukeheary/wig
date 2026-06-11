import SwiftUI

@MainActor
final class AppSession: ObservableObject {
    @Published var isAuthBypassed = false
    @Published private(set) var eventDetailPresentationCount = 0

    var shouldShowFloatingCreationButton: Bool {
        eventDetailPresentationCount == 0
    }

    func skipAuth() {
        isAuthBypassed = true
    }

    func reset() {
        isAuthBypassed = false
    }

    func beginEventDetailPresentation() {
        eventDetailPresentationCount += 1
    }

    func endEventDetailPresentation() {
        eventDetailPresentationCount = max(0, eventDetailPresentationCount - 1)
    }
}
