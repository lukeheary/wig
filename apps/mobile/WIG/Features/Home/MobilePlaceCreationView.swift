import PhotosUI
import SwiftUI
import UIKit

struct MobilePlaceCreationView: View {
    @Environment(\.apiClient) private var apiClient
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel = MobilePlaceCreationViewModel()

    let type: PlaceListItem.PlaceType

    @State private var selectedLogoImageItem: PhotosPickerItem?
    @State private var selectedLogoImage: UIImage?
    @State private var name = ""
    @State private var descriptionText = ""
    @State private var address = ""
    @State private var city = ""
    @State private var state = ""
    @State private var websiteText = ""
    @State private var instagramText = ""
    @State private var selectedCategoryKeys = Set<String>()
    @State private var isSubmitting = false
    @State private var alertMessage: String?

    var body: some View {
        NavigationStack {
            Form {
                logoSection
                detailsSection
                locationSection
                categoriesSection
            }
            .scrollContentBackground(.hidden)
            .background(Color(uiColor: .systemGroupedBackground))
            .navigationTitle("Create \(type.displayName)")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button(isSubmitting ? "Creating..." : "Create") {
                        Task {
                            await submit()
                        }
                    }
                    .disabled(isSubmitting)
                }
            }
            .task {
                if viewModel.categories.isEmpty && !viewModel.isLoadingCategories {
                    await viewModel.loadCategories(using: apiClient)
                }
            }
            .onChange(of: selectedLogoImageItem) { _, item in
                guard let item else {
                    return
                }

                Task {
                    await handleSelectedLogoImage(item)
                }
            }
            .alert(
                "Couldn't Create \(type.displayName)",
                isPresented: Binding(
                    get: { alertMessage != nil },
                    set: { isPresented in
                        if !isPresented {
                            alertMessage = nil
                        }
                    }
                )
            ) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(alertMessage ?? "Please try again.")
            }
        }
    }

    private var isVenue: Bool {
        type == .venue
    }

    private var logoSection: some View {
        Section("\(type.displayName) Image") {
            PhotosPicker(selection: $selectedLogoImageItem, matching: .images) {
                ZStack {
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .fill(Color(uiColor: .secondarySystemGroupedBackground))

                    if let selectedLogoImage {
                        Image(uiImage: selectedLogoImage)
                            .resizable()
                            .scaledToFill()
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .clipped()
                    } else {
                        logoPlaceholder
                    }
                }
                .frame(height: 200)
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .strokeBorder(Color(uiColor: .separator).opacity(0.35), lineWidth: 1)
                )
            }
            .buttonStyle(.plain)
            .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))

            if selectedLogoImage != nil {
                Button("Remove Image", role: .destructive) {
                    selectedLogoImageItem = nil
                    selectedLogoImage = nil
                }
            }
        }
    }

    @ViewBuilder
    private var detailsSection: some View {
        Section("Details") {
            TextField("\(type.displayName) Name", text: $name)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()

            VStack(alignment: .leading, spacing: 8) {
                Text("Description")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.secondary)

                TextEditor(text: $descriptionText)
                    .frame(minHeight: 100)
                    .scrollContentBackground(.hidden)
                    .padding(.horizontal, 2)
            }

            TextField("Website", text: $websiteText)
                .keyboardType(.URL)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()

            TextField("Instagram", text: $instagramText)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
        }
    }

    @ViewBuilder
    private var locationSection: some View {
        Section("Location") {
            if isVenue {
                TextField("Address", text: $address)
                    .textInputAutocapitalization(.words)
                    .autocorrectionDisabled()
            }

            TextField("City\(isVenue ? "" : " (Optional)")", text: $city)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()

            TextField("State\(isVenue ? "" : " (Optional)")", text: $state)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
                .onChange(of: state) { _, newValue in
                    let uppercase = String(newValue.uppercased().prefix(2))
                    if uppercase != newValue {
                        state = uppercase
                    }
                }

            if isVenue {
                Text("Venues need a city and state so events can be placed correctly.")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.secondary)
            } else {
                Text("Organizer location is optional, but if you enter one, include both city and state.")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.secondary)
            }
        }
    }

    private var categoriesSection: some View {
        Section("Categories") {
            if viewModel.isLoadingCategories {
                HStack(spacing: 10) {
                    ProgressView()
                        .tint(AppTheme.accentBlue)
                    Text("Loading categories...")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.secondary)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else if viewModel.categories.isEmpty {
                VStack(alignment: .leading, spacing: 8) {
                    Text("No categories are available right now.")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.secondary)

                    if let loadError = viewModel.loadError {
                        Text(loadError)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(.secondary)
                    }

                    Button("Retry") {
                        Task {
                            await viewModel.loadCategories(using: apiClient)
                        }
                    }
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(AppTheme.accentBlue)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            } else {
                LazyVGrid(
                    columns: [
                        GridItem(.adaptive(minimum: 96), spacing: 10),
                    ],
                    alignment: .leading,
                    spacing: 10
                ) {
                    ForEach(viewModel.categories, id: \.key) { category in
                        Button {
                            toggleCategory(category.key)
                        } label: {
                            Text(category.label)
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(selectedCategoryKeys.contains(category.key) ? .black : .primary)
                                .padding(.horizontal, 12)
                                .padding(.vertical, 10)
                                .frame(maxWidth: .infinity)
                                .background(
                                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                                        .fill(selectedCategoryKeys.contains(category.key) ? AppTheme.accentBlue : Color(uiColor: .secondarySystemGroupedBackground))
                                )
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
    }

    private var logoPlaceholder: some View {
        VStack(spacing: 10) {
            Image(systemName: isVenue ? "building.2.crop.circle" : "person.crop.circle.badge.plus")
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(.secondary)

            Text("Add a profile image")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.primary)

            Text("Square JPG or PNG up to 4 MB")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 20)
    }

    private func handleSelectedLogoImage(_ item: PhotosPickerItem) async {
        selectedLogoImageItem = nil

        do {
            guard
                let data = try await item.loadTransferable(type: Data.self),
                let image = UIImage(data: data)
            else {
                alertMessage = "That image couldn’t be loaded."
                return
            }

            selectedLogoImage = image
        } catch {
            alertMessage = error.localizedDescription
        }
    }

    private func toggleCategory(_ key: String) {
        if selectedCategoryKeys.contains(key) {
            selectedCategoryKeys.remove(key)
        } else {
            selectedCategoryKeys.insert(key)
        }
    }

    private func submit() async {
        guard !isSubmitting else {
            return
        }

        let trimmedName = name.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedDescription = descriptionText.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedAddress = address.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedCity = city.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedState = state.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
        let trimmedWebsite = websiteText.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedInstagram = instagramText
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "@", with: "")

        guard !trimmedName.isEmpty else {
            alertMessage = "Please enter a \(type.displayName.lowercased()) name."
            return
        }

        if isVenue {
            guard !trimmedCity.isEmpty else {
                alertMessage = "Please enter a city."
                return
            }

            guard trimmedState.count == 2 else {
                alertMessage = "Please enter a 2-letter state."
                return
            }
        } else if trimmedCity.isEmpty != trimmedState.isEmpty {
            alertMessage = "If you add a location for an organizer, include both city and state."
            return
        } else if !trimmedState.isEmpty && trimmedState.count != 2 {
            alertMessage = "Please enter a 2-letter state."
            return
        }

        var websiteURL: URL?
        if !trimmedWebsite.isEmpty {
            let normalizedWebsite = normalizedWebsiteString(trimmedWebsite)

            guard let url = URL(string: normalizedWebsite) else {
                alertMessage = "Please enter a valid website URL."
                return
            }

            websiteURL = url
        }

        if !trimmedInstagram.isEmpty && trimmedInstagram.contains(" ") {
            alertMessage = "Please enter a valid Instagram handle."
            return
        }

        isSubmitting = true
        defer {
            isSubmitting = false
        }

        do {
            let uploadedLogoURL = try await uploadedLogoImageURLIfNeeded()
            let createdPlace = try await apiClient.send(
                APIClient.mobileCreatePlace(
                    type: type,
                    name: trimmedName,
                    description: trimmedDescription.isEmpty ? nil : trimmedDescription,
                    logoImageURL: uploadedLogoURL,
                    address: isVenue && !trimmedAddress.isEmpty ? trimmedAddress : nil,
                    city: trimmedCity.isEmpty ? nil : trimmedCity,
                    state: trimmedState.isEmpty ? nil : trimmedState,
                    website: websiteURL,
                    instagram: trimmedInstagram.isEmpty ? nil : trimmedInstagram,
                    categories: orderedSelectedCategories
                )
            )

            NotificationCenter.default.post(name: .mobilePlaceDidChange, object: createdPlace.id)
            dismiss()
        } catch {
            alertMessage = error.localizedDescription
        }
    }

    private func uploadedLogoImageURLIfNeeded() async throws -> URL? {
        guard let selectedLogoImage else {
            return nil
        }

        guard let imageData = selectedLogoImage.placeLogoUploadJPEGData(maxBytes: 4 * 1024 * 1024) else {
            return nil
        }

        let uploadedImage = try await apiClient.send(
            APIClient.mobileUploadImage(
                imageData: imageData,
                folder: "places/pending/\(UUID().uuidString)",
                fileName: "logo-image.jpg"
            )
        )

        return uploadedImage.url
    }

    private var orderedSelectedCategories: [String] {
        viewModel.categories
            .map(\.key)
            .filter { selectedCategoryKeys.contains($0) }
    }

    private func normalizedWebsiteString(_ value: String) -> String {
        if value.lowercased().hasPrefix("http://") || value.lowercased().hasPrefix("https://") {
            return value
        }

        return "https://\(value)"
    }
}

@MainActor
private final class MobilePlaceCreationViewModel: ObservableObject {
    @Published private(set) var categories: [MobileCategoryOption] = []
    @Published private(set) var isLoadingCategories = false
    @Published private(set) var loadError: String?

    func loadCategories(using apiClient: APIClient) async {
        guard !isLoadingCategories else {
            return
        }

        isLoadingCategories = true
        defer {
            isLoadingCategories = false
        }

        do {
            let response = try await apiClient.send(APIClient.mobileCategories())
            categories = response.categories.filter(\.isActive)
            loadError = nil
        } catch {
            categories = []
            loadError = error.localizedDescription
        }
    }
}
