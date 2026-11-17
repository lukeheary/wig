import ClerkKit
import SwiftUI
import UIKit
import UserNotifications

enum NotificationPreferenceKey: String, CaseIterable, Identifiable {
    case pushEnabled, friendsGoing, friendsInterested, friendRequests, friendRequestAccepted
    case partnerRequests, partnerRequestAccepted, partnerRsvps, eventChanges, supportUpdates
    case goingReminders, interestedReminders
    var id: String { rawValue }

    var title: String {
        switch self {
        case .pushEnabled: "Push Notifications"
        case .friendsGoing: "Friends Going to Events"
        case .friendsInterested: "Friends Interested in Events"
        case .friendRequests: "Friend Requests"
        case .friendRequestAccepted: "Friend Request Accepted"
        case .partnerRequests: "Partner Requests"
        case .partnerRequestAccepted: "Partner Request Accepted"
        case .partnerRsvps: "Partner RSVPs"
        case .goingReminders: "Going Reminders"
        case .interestedReminders: "Interested Reminders"
        case .eventChanges: "Event Changes"
        case .supportUpdates: "Support Updates"
        }
    }

    var detail: String {
        switch self {
        case .pushEnabled: "Receive push alerts from Who Is Going. Requests and activity remain available in the app when alerts are off."
        case .friendsGoing: "When a friend says they’re going to an event."
        case .friendsInterested: "When a friend says they’re interested in an event."
        case .friendRequests: "When someone adds you as a friend."
        case .friendRequestAccepted: "When someone accepts your friend request."
        case .partnerRequests: "When someone sends you a partner request."
        case .partnerRequestAccepted: "When someone accepts your partner request."
        case .partnerRsvps: "When your partner RSVPs for both of you."
        case .goingReminders: "Reminders for events you’re Going to: 1 PM on the day for events starting at 5 PM or later, or 8 PM the evening before for earlier events. Uses the event’s time zone."
        case .interestedReminders: "Reminders for events you’re Interested in, with the same timing as Going reminders."
        case .eventChanges: "Updates, cancellations, postponements, and rescheduling for events you’re Going to or Interested in."
        case .supportUpdates: "Updates to a support request you submitted."
        }
    }
}

struct MobileNotificationPreferences: Codable {
    var pushEnabled = true
    var friendsGoing = true
    var friendsInterested = true
    var friendRequests = true
    var friendRequestAccepted = true
    var partnerRequests = true
    var partnerRequestAccepted = true
    var partnerRsvps = true
    var goingReminders = true
    var interestedReminders = true
    var eventChanges = true
    var supportUpdates = true

    init() {}

    enum CodingKeys: String, CodingKey {
        case pushEnabled, friendsGoing, friendsInterested, friendRequests, friendRequestAccepted, partnerRequests, partnerRequestAccepted, partnerRsvps, goingReminders, interestedReminders, eventChanges, supportUpdates
    }

    init(from decoder: Decoder) throws {
        let values = try decoder.container(keyedBy: CodingKeys.self)
        pushEnabled = try values.decodeIfPresent(Bool.self, forKey: .pushEnabled) ?? true
        friendsGoing = try values.decodeIfPresent(Bool.self, forKey: .friendsGoing) ?? true
        friendsInterested = try values.decodeIfPresent(Bool.self, forKey: .friendsInterested) ?? true
        friendRequests = try values.decodeIfPresent(Bool.self, forKey: .friendRequests) ?? true
        friendRequestAccepted = try values.decodeIfPresent(Bool.self, forKey: .friendRequestAccepted) ?? true
        partnerRequests = try values.decodeIfPresent(Bool.self, forKey: .partnerRequests) ?? true
        partnerRequestAccepted = try values.decodeIfPresent(Bool.self, forKey: .partnerRequestAccepted) ?? true
        partnerRsvps = try values.decodeIfPresent(Bool.self, forKey: .partnerRsvps) ?? true
        goingReminders = try values.decodeIfPresent(Bool.self, forKey: .goingReminders) ?? true
        interestedReminders = try values.decodeIfPresent(Bool.self, forKey: .interestedReminders) ?? true
        eventChanges = try values.decodeIfPresent(Bool.self, forKey: .eventChanges) ?? true
        supportUpdates = try values.decodeIfPresent(Bool.self, forKey: .supportUpdates) ?? true
    }

    subscript(key: NotificationPreferenceKey) -> Bool {
        get {
            switch key {
            case .pushEnabled: pushEnabled
            case .friendsGoing: friendsGoing
            case .friendsInterested: friendsInterested
            case .friendRequests: friendRequests
            case .friendRequestAccepted: friendRequestAccepted
            case .partnerRequests: partnerRequests
            case .partnerRequestAccepted: partnerRequestAccepted
            case .partnerRsvps: partnerRsvps
            case .goingReminders: goingReminders
            case .interestedReminders: interestedReminders
            case .eventChanges: eventChanges
            case .supportUpdates: supportUpdates
            }
        }
        set {
            switch key {
            case .pushEnabled: pushEnabled = newValue
            case .friendsGoing: friendsGoing = newValue
            case .friendsInterested: friendsInterested = newValue
            case .friendRequests: friendRequests = newValue
            case .friendRequestAccepted: friendRequestAccepted = newValue
            case .partnerRequests: partnerRequests = newValue
            case .partnerRequestAccepted: partnerRequestAccepted = newValue
            case .partnerRsvps: partnerRsvps = newValue
            case .goingReminders: goingReminders = newValue
            case .interestedReminders: interestedReminders = newValue
            case .eventChanges: eventChanges = newValue
            case .supportUpdates: supportUpdates = newValue
            }
        }
    }
}

struct MobileNotificationSettingsResponse: Decodable {
    let preferences: MobileNotificationPreferences
}

struct MobileMutedPerson: Decodable, Identifiable {
    let id: String
    let name: String
    let username: String
    let avatarImageUrl: URL?
}

struct MobileMutedPeopleResponse: Decodable {
    let users: [MobileMutedPerson]
}

@MainActor
private final class NotificationSettingsViewModel: ObservableObject {
    @Published var preferences: MobileNotificationPreferences?
    @Published var isSaving = false
    @Published var isLoading = false
    @Published var errorMessage: String?
    private var loadToken = UUID()

    func load(using apiClient: APIClient) async {
        guard !isSaving else { return }
        let token = UUID()
        loadToken = token
        isLoading = preferences == nil
        defer { if loadToken == token { isLoading = false } }
        do {
            let response = try await apiClient.send(APIClient.mobileNotificationSettings())
            guard !Task.isCancelled, loadToken == token else { return }
            preferences = response.preferences
        } catch {
            guard !Task.isCancelled, loadToken == token else { return }
            errorMessage = "Your notification settings couldn’t be loaded. Please try again."
        }
    }

    func update(_ key: NotificationPreferenceKey, enabled: Bool, using apiClient: APIClient) async {
        guard !isSaving, let previous = preferences else { return }
        loadToken = UUID()
        isLoading = false
        isSaving = true
        defer { isSaving = false }
        var updated = previous
        updated[key] = enabled
        preferences = updated
        do {
            let response = try await apiClient.send(APIClient.updateMobileNotificationSettings(key: key, enabled: enabled))
            preferences = response.preferences
        } catch {
            preferences = previous
            errorMessage = "That change couldn’t be saved. Your previous setting has been restored."
        }
    }
}

struct NotificationSettingsView: View {
    @Environment(\.apiClient) private var apiClient
    @Environment(\.scenePhase) private var scenePhase
    @StateObject private var viewModel = NotificationSettingsViewModel()
    @State private var authorizationStatus: UNAuthorizationStatus = .notDetermined
    @State private var hasLoadedAuthorization = false

    var body: some View {
        Form {
            if let preferences = viewModel.preferences {
                Section {
                    preferenceToggle(.pushEnabled)
                    if viewModel.isSaving {
                        HStack(spacing: 8) {
                            ProgressView()
                            Text("Saving…").foregroundStyle(.secondary)
                        }
                    }
                } footer: {
                    Text("These choices apply to your account on every device. Sounds, banners, and badges can also be managed in iPhone Settings.")
                }
                Section("On This iPhone") {
                    if hasLoadedAuthorization {
                        Text(authorizationStatus == .denied ? "Notifications are disabled in iPhone Settings." :
                            authorizationStatus == .notDetermined ? "Push permission hasn’t been requested yet." : "Notifications are allowed on this iPhone.")
                            .font(.subheadline)
                            .foregroundStyle(.secondary)
                        if authorizationStatus == .notDetermined {
                            Button("Enable on This iPhone") { Task { await requestPermission() } }
                        } else {
                            Button("Open iPhone Settings") {
                                guard let url = URL(string: UIApplication.openSettingsURLString) else { return }
                                UIApplication.shared.open(url)
                            }
                        }
                    } else {
                        ProgressView()
                    }
                }
                Section("Event Reminders") {
                    preferenceToggle(.goingReminders)
                    preferenceToggle(.interestedReminders)
                }
                .disabled(!preferences.pushEnabled)
                Section("Friends") {
                    ForEach([NotificationPreferenceKey.friendsGoing, .friendsInterested, .friendRequests, .friendRequestAccepted]) {
                        preferenceToggle($0)
                    }
                }
                .disabled(!preferences.pushEnabled)
                Section("Partner") {
                    ForEach([NotificationPreferenceKey.partnerRequests, .partnerRequestAccepted, .partnerRsvps]) {
                        preferenceToggle($0)
                    }
                }
                .disabled(!preferences.pushEnabled)
                Section {
                    NavigationLink {
                        MutedPeopleView()
                    } label: {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Muted People")
                            Text("Manage friends whose event RSVP alerts you’ve muted.")
                                .font(.footnote).foregroundStyle(.secondary)
                        }
                    }
                }
                Section {
                    forActivityOnly(.eventChanges)
                    forActivityOnly(.supportUpdates)
                } header: {
                    Text("Also in Activity")
                } footer: {
                    Text("Event changes and support updates currently appear in Activity without push alerts.")
                }
            } else if viewModel.isLoading {
                ProgressView("Loading settings…")
            } else {
                Button("Try Loading Settings Again") { Task { await viewModel.load(using: apiClient) } }
            }
        }
        .modifier(ProfileSettingsPageChrome(title: "Notification Settings"))
        .task(id: scenePhase) {
            guard scenePhase == .active else { return }
            async let settings: Void = viewModel.load(using: apiClient)
            await loadAuthorization()
            await settings
        }
        .alert("Notification Settings", isPresented: Binding(
            get: { viewModel.errorMessage != nil },
            set: { if !$0 { viewModel.errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: { Text(viewModel.errorMessage ?? "Please try again.") }
    }

    private func preferenceToggle(_ key: NotificationPreferenceKey) -> some View {
        Toggle(isOn: Binding(
            get: { viewModel.preferences?[key] ?? true },
            set: { enabled in Task { await viewModel.update(key, enabled: enabled, using: apiClient) } }
        )) {
            VStack(alignment: .leading, spacing: 4) {
                Text(key.title)
                Text(key.detail).font(.footnote).foregroundStyle(.secondary)
            }
        }
        .tint(AppTheme.accentBlue)
        .disabled(viewModel.isSaving)
    }

    private func forActivityOnly(_ key: NotificationPreferenceKey) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            HStack {
                Text(key.title)
                Spacer()
                Text("In Activity").font(.caption).foregroundStyle(.secondary)
            }
            Text(key.detail).font(.footnote).foregroundStyle(.secondary)
        }
    }

    @MainActor private func loadAuthorization() async {
        authorizationStatus = await UNUserNotificationCenter.current().notificationSettings().authorizationStatus
        hasLoadedAuthorization = true
    }

    @MainActor private func requestPermission() async {
        do {
            let allowed = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .badge, .sound])
            if allowed { UIApplication.shared.registerForRemoteNotifications() }
            await loadAuthorization()
        } catch {
            viewModel.errorMessage = "Notification permission couldn’t be requested. Please try again."
        }
    }
}

private struct MutedPeopleView: View {
    @Environment(\.apiClient) private var apiClient
    @Environment(\.scenePhase) private var scenePhase
    @State private var users: [MobileMutedPerson] = []
    @State private var hasLoaded = false
    @State private var isLoading = false
    @State private var unmutingID: String?
    @State private var errorMessage: String?
    @State private var loadToken = UUID()

    var body: some View {
        Form {
            Section {
                Text("Muted friends’ event RSVP alerts are silenced. Their activity remains visible in the app.")
                    .font(.subheadline).foregroundStyle(.secondary)
            }
            Section {
                if isLoading && !hasLoaded {
                    ProgressView("Loading muted people…")
                } else if users.isEmpty && hasLoaded {
                    Text("No muted people").foregroundStyle(.secondary)
                } else if !hasLoaded {
                    Button("Try Again") { Task { await load() } }
                }
                ForEach(users) { user in
                    HStack(spacing: 12) {
                        UserAvatarView(imageURL: user.avatarImageUrl, name: user.name, size: 40, identityKey: user.id)
                        VStack(alignment: .leading, spacing: 3) {
                            Text(user.name)
                            Text("@\(user.username)").font(.footnote).foregroundStyle(.secondary)
                        }
                        Spacer()
                        Button(unmutingID == user.id ? "Unmuting…" : "Unmute") {
                            Task { await unmute(user) }
                        }
                        .buttonStyle(.borderless)
                        .disabled(unmutingID != nil)
                    }
                }
            }
        }
        .modifier(ProfileSettingsPageChrome(title: "Muted People"))
        .task(id: scenePhase) { if scenePhase == .active { await load() } }
        .refreshable { await load() }
        .alert("Muted People", isPresented: Binding(
            get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } }
        )) { Button("OK", role: .cancel) {} } message: { Text(errorMessage ?? "Please try again.") }
    }

    @MainActor private func load() async {
        guard unmutingID == nil else { return }
        let token = UUID()
        loadToken = token
        isLoading = true
        defer { isLoading = false }
        do {
            let response = try await apiClient.send(APIClient.mobileMutedPeople())
            guard !Task.isCancelled, unmutingID == nil, loadToken == token else { return }
            users = response.users
            hasLoaded = true
        } catch {
            if !Task.isCancelled { errorMessage = "Muted people couldn’t be loaded. Please try again." }
        }
    }

    @MainActor private func unmute(_ user: MobileMutedPerson) async {
        guard unmutingID == nil else { return }
        unmutingID = user.id
        loadToken = UUID()
        defer { unmutingID = nil }
        do {
            _ = try await apiClient.send(APIClient.setMobileFriendNotificationsMuted(friendUserID: user.id, muted: false))
            users.removeAll { $0.id == user.id }
        } catch {
            errorMessage = "That person couldn’t be unmuted. Please try again."
        }
    }
}

struct ProfileSettingsPageChrome: ViewModifier {
    let title: String
    @Environment(\.dismiss) private var dismiss

    func body(content: Content) -> some View {
        content
            .scrollContentBackground(.hidden)
            .background(Color.black.ignoresSafeArea())
            .toolbar(.hidden, for: .navigationBar)
            .navigationBarBackButtonHidden()
            .background(SwipeBackEnabler())
            .safeAreaInset(edge: .top) {
                ZStack {
                    Text(title).font(.system(size: 17, weight: .semibold))
                    HStack {
                        FloatingGlassIconButton(systemImage: "chevron.left") { dismiss() }
                        Spacer()
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 8)
                .background(Color.black)
            }
    }
}
