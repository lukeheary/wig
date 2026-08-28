import SwiftUI

struct AddUserToPlaceView: View {
    let placeSlug: String
    var onCompleted: (() -> Void)? = nil

    @Environment(\.apiClient) private var apiClient
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel = AddUserToPlaceViewModel()
    @FocusState private var isSearchFocused: Bool

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                if let selected = viewModel.selectedUser {
                    ScrollView {
                        selectedUserSection(selected)
                            .padding(16)
                    }
                } else {
                    searchField
                        .padding(.horizontal, 16)
                        .padding(.vertical, 12)

                    Divider()

                    userResultsList
                }
            }
            .animation(.easeInOut(duration: 0.2), value: viewModel.selectedUser?.id)
            .background(AppTheme.background.ignoresSafeArea())
            .navigationTitle("Add User to Place")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                }

                ToolbarItem(placement: .confirmationAction) {
                    if viewModel.selectedUser != nil {
                        Button("Add") {
                            Task {
                                let success = await viewModel.submit(slug: placeSlug, using: apiClient)
                                if success {
                                    onCompleted?()
                                    dismiss()
                                }
                            }
                        }
                        .disabled(viewModel.isSubmitting)
                    }
                }
            }
            .alert("Couldn't Add User", isPresented: $viewModel.showError) {
                Button("OK") {}
            } message: {
                Text(viewModel.errorMessage ?? "Please try again.")
            }
        }
    }

    private var searchField: some View {
        HStack(spacing: 8) {
            Image(systemName: "magnifyingglass")
                .foregroundStyle(.secondary)

            TextField("Search users", text: $viewModel.searchText)
                .focused($isSearchFocused)
                .autocorrectionDisabled()
                .textInputAutocapitalization(.never)
                .onChange(of: viewModel.searchText) { _, query in
                    viewModel.scheduleSearch(query: query, using: apiClient)
                }
        }
        .padding(10)
        .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 10))
    }

    private var userResultsList: some View {
        ScrollView {
            LazyVStack(spacing: 2) {
                if viewModel.isSearching {
                    ProgressView()
                        .frame(maxWidth: .infinity)
                        .padding(.top, 40)
                } else if viewModel.searchResults.isEmpty && !viewModel.searchText.isEmpty {
                    ContentUnavailableView("No users found", systemImage: "person.slash")
                        .foregroundStyle(.white)
                } else {
                    ForEach(viewModel.searchResults) { user in
                        Button {
                            isSearchFocused = false
                            viewModel.selectUser(user)
                        } label: {
                            CompactUserListRowView(
                                imageURL: user.avatarImageURL,
                                name: user.name,
                                subtitle: user.usernameText,
                                identityKey: user.id
                            )
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .padding(.horizontal, 16)
                    }
                }
            }
            .padding(.vertical, 8)
        }
        .scrollDismissesKeyboard(.interactively)
    }

    private func selectedUserSection(_ user: FriendUserSummary) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            HStack(spacing: 12) {
                CompactUserListRowView(
                    imageURL: user.avatarImageURL,
                    name: user.name,
                    subtitle: user.usernameText,
                    identityKey: user.id
                )

                Spacer()

                Button {
                    viewModel.clearSelection()
                    isSearchFocused = true
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .foregroundStyle(.secondary)
                        .imageScale(.large)
                }
                .buttonStyle(.plain)
            }
            .padding(12)
            .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 12))

            VStack(alignment: .leading, spacing: 8) {
                Text("Role")
                    .font(.subheadline)
                    .foregroundStyle(.secondary)

                Picker("Role", selection: $viewModel.selectedRole) {
                    ForEach(PlaceMemberRole.allCases, id: \.self) { role in
                        Text(role.displayName).tag(role)
                    }
                }
                .pickerStyle(.segmented)
            }

            if viewModel.isSubmitting {
                HStack {
                    Spacer()
                    ProgressView()
                    Spacer()
                }
            }
        }
    }
}

@MainActor
final class AddUserToPlaceViewModel: ObservableObject {
    @Published var searchText = ""
    @Published var searchResults: [FriendUserSummary] = []
    @Published var isSearching = false
    @Published var selectedUser: FriendUserSummary?
    @Published var selectedRole: PlaceMemberRole = .staff
    @Published var isSubmitting = false
    @Published var showError = false
    @Published(wrappedValue: nil) var errorMessage: String?

    private var searchTask: Task<Void, Never>?

    func scheduleSearch(query: String, using apiClient: APIClient) {
        searchTask?.cancel()

        guard !query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            searchResults = []
            isSearching = false
            return
        }

        searchTask = Task {
            try? await Task.sleep(nanoseconds: 350_000_000)
            guard !Task.isCancelled else { return }
            await performSearch(query: query, using: apiClient)
        }
    }

    func selectUser(_ user: FriendUserSummary) {
        selectedUser = user
        searchText = ""
        searchResults = []
    }

    func clearSelection() {
        selectedUser = nil
        selectedRole = .staff
    }

    func submit(slug: String, using apiClient: APIClient) async -> Bool {
        guard let user = selectedUser else { return false }

        isSubmitting = true
        defer { isSubmitting = false }

        do {
            let endpoint = try APIClient.mobileAddUserToPlace(
                slug: slug,
                userId: user.id,
                role: selectedRole
            )
            _ = try await apiClient.send(endpoint)
            return true
        } catch {
            errorMessage = (error as? LocalizedError)?.errorDescription ?? "Please try again."
            showError = true
            return false
        }
    }

    private func performSearch(query: String, using apiClient: APIClient) async {
        isSearching = true
        defer { isSearching = false }

        do {
            let response = try await apiClient.send(
                APIClient.mobileSearch(query: query, includeCurrentUser: true)
            )
            searchResults = response.users
        } catch {
            searchResults = []
        }
    }
}
