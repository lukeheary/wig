import ClerkKit
import SwiftUI

struct MobileDefaultEventCityResponse: Decodable {
    let defaultCity: MobileMetroAreaOption?
    let availableCities: [MobileMetroAreaOption]
}

struct MobileDefaultEventCityUpdateResponse: Decodable {
    let defaultCity: MobileMetroAreaOption?
}

struct DefaultEventCityView: View {
    @Environment(\.apiClient) private var apiClient
    @Environment(\.dismiss) private var dismiss
    @Environment(Clerk.self) private var clerk
    @EnvironmentObject private var appSession: AppSession
    @State private var settings: MobileDefaultEventCityResponse?
    @State private var selectedMetroAreaID: UUID?
    @State private var isLoading = false
    @State private var isSaving = false
    @State private var errorMessage: String?

    var body: some View {
        Form {
            Section {
                Text("Choose the city you’ll see when you open the app.")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)
            } footer: {
                Text("This changes your starting city for Home, Places, and Activity. The city on your profile stays unchanged.")
            }

            if let settings {
                Section("Default City") {
                    ForEach(settings.availableCities) { city in
                        cityRow(title: "\(city.name), \(city.state)", id: city.id)
                    }
                }
                .disabled(isSaving)

                Section {
                    Button {
                        Task { await save() }
                    } label: {
                        HStack {
                            Spacer()
                            if isSaving { ProgressView().tint(AppTheme.accentBlue) }
                            Text(isSaving ? "Saving…" : "Save Default City")
                            Spacer()
                        }
                    }
                    .disabled(isSaving || selectedMetroAreaID == nil || selectedMetroAreaID == settings.defaultCity?.id)
                } footer: {
                    Text("You can browse another city without changing this default. Your default city is saved to your account.")
                }
            } else if isLoading {
                ProgressView("Loading cities…")
            } else {
                Button("Try Loading Cities Again") { Task { await load() } }
            }
        }
        .tint(AppTheme.accentBlue)
        .modifier(ProfileSettingsPageChrome(title: "Default Event City"))
        .task { await load() }
        .alert("Default Event City", isPresented: Binding(
            get: { errorMessage != nil },
            set: { if !$0 { errorMessage = nil } }
        )) {
            Button("OK", role: .cancel) {}
        } message: { Text(errorMessage ?? "Please try again.") }
    }

    private func cityRow(title: String, detail: String? = nil, id: UUID?) -> some View {
        Button {
            selectedMetroAreaID = id
        } label: {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text(title).foregroundStyle(.primary)
                    if let detail {
                        Text(detail).font(.footnote).foregroundStyle(.secondary)
                    }
                }
                Spacer()
                if selectedMetroAreaID == id {
                    Image(systemName: "checkmark").foregroundStyle(AppTheme.accentBlue)
                }
            }
            .contentShape(Rectangle())
        }
        .accessibilityAddTraits(selectedMetroAreaID == id ? .isSelected : [])
    }

    @MainActor private func load() async {
        guard settings == nil, !isLoading else { return }
        let userID = clerk.user?.id
        isLoading = true
        defer { isLoading = false }
        do {
            let response = try await apiClient.send(APIClient.mobileDefaultEventCity())
            guard !Task.isCancelled, userID == clerk.user?.id else { return }
            settings = response
            selectedMetroAreaID = response.defaultCity?.id
        } catch {
            guard !Task.isCancelled, userID == clerk.user?.id else { return }
            errorMessage = "Your cities couldn’t be loaded. Please try again."
        }
    }

    @MainActor private func save() async {
        guard !isSaving, let selectedMetroAreaID, let userID = clerk.user?.id else { return }
        isSaving = true
        defer { isSaving = false }
        do {
            let response = try await apiClient.send(APIClient.updateMobileDefaultEventCity(metroAreaID: selectedMetroAreaID))
            guard userID == clerk.user?.id else { return }
            let city = response.defaultCity
            appSession.selectedCityContext = city.map { .city(city: $0.name, state: $0.state) }
            EventFeedViewModel.invalidateSharedCache()
            NotificationCenter.default.post(
                name: .appDataDidChange,
                object: nil,
                userInfo: ["defaultEventCityChanged": true]
            )
            dismiss()
        } catch {
            guard userID == clerk.user?.id else { return }
            errorMessage = error.localizedDescription
        }
    }
}
