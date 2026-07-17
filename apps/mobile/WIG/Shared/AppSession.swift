import SwiftUI

// The city filter selection shared across the Home, Places, and Activity tabs so it
// persists when switching between them. `nil` means "unset" (each page falls back to
// its own default, e.g. the user's city); `.all` and `.city` are explicit user
// choices that propagate to every tab.
enum SelectedCityContext: Hashable, Sendable {
    case all
    case city(city: String, state: String)
}

struct EventDetailPresentation: Identifiable, Hashable {
    let id = UUID()
    let event: EventFeedItem
    let transitionSourceID: UUID?
}

@MainActor
final class AppSession: ObservableObject {
    @Published var isAuthBypassed = false
    @Published var isAdmin = false
    @Published var presentedEventDetail: EventDetailPresentation?
    @Published var selectedCityContext: SelectedCityContext?

    var shouldShowFloatingCreationButton: Bool {
        isAdmin && presentedEventDetail == nil
    }

    // True while an individual event detail page is on screen. The event page shows
    // its own artwork-tinted background to the top, so the global status-bar scrim is
    // hidden there.
    var isEventDetailPresented: Bool {
        presentedEventDetail != nil
    }

    func skipAuth() {
        isAuthBypassed = true
    }

    func reset() {
        isAuthBypassed = false
        isAdmin = false
        presentedEventDetail = nil
        selectedCityContext = nil
    }

    func updateAdminStatus(_ isAdmin: Bool) {
        self.isAdmin = isAdmin
    }

    func presentEventDetail(_ event: EventFeedItem, transitionSourceID: UUID? = nil) {
        presentedEventDetail = EventDetailPresentation(
            event: event,
            transitionSourceID: transitionSourceID
        )
    }
}
