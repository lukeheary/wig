import PhotosUI
import SwiftUI
import UIKit

struct MobilePlaceCreationView: View {
    enum Mode {
        case create(PlaceListItem.PlaceType)
        case edit(PlaceDetail)
    }

    @Environment(\.apiClient) private var apiClient
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel = MobilePlaceCreationViewModel()

    private let mode: Mode
    private let onCompleted: (() -> Void)?

    @State private var selectedLogoImageItem: PhotosPickerItem?
    @State private var selectedLogoImage: UIImage?
    @State private var selectedGooglePlaceName: String?
    @State private var name = ""
    @State private var descriptionText = ""
    @State private var address = ""
    @State private var city = ""
    @State private var state = ""
    @State private var websiteText = ""
    @State private var instagramText = ""
    @State private var hours: VenueHours?
    @State private var selectedCategoryKeys = Set<String>()
    @State private var isSubmitting = false
    @State private var alertMessage: String?
    @State private var isGooglePlacePickerPresented = false

    init(type: PlaceListItem.PlaceType, onCompleted: (() -> Void)? = nil) {
        self.init(mode: .create(type), onCompleted: onCompleted)
    }

    init(mode: Mode, onCompleted: (() -> Void)? = nil) {
        self.mode = mode
        self.onCompleted = onCompleted

        if case .edit(let place) = mode {
            _name = State(initialValue: place.name)
            _descriptionText = State(initialValue: place.description ?? "")
            _address = State(initialValue: place.address ?? "")
            _city = State(initialValue: place.city ?? "")
            _state = State(initialValue: place.state ?? "")
            _websiteText = State(initialValue: place.website?.absoluteString ?? "")
            _instagramText = State(initialValue: place.instagram ?? "")
            _hours = State(initialValue: place.hours)
            _selectedCategoryKeys = State(initialValue: Set(place.categories))
            _selectedGooglePlaceName = State(initialValue: place.name)
        }
    }

    private var type: PlaceListItem.PlaceType {
        switch mode {
        case .create(let type):
            return type
        case .edit(let place):
            return place.type
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                logoSection
                locationSection
                detailsSection
                categoriesSection
            }
            .scrollContentBackground(.hidden)
            .background(Color(uiColor: .systemGroupedBackground))
            .navigationTitle(navigationTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }

                ToolbarItem(placement: .confirmationAction) {
                    Button(submitButtonTitle) {
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
            .sheet(isPresented: $isGooglePlacePickerPresented) {
                GooglePlaceLookupSheet { place in
                    applyGooglePlace(place)
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
                "Couldn't Save \(type.displayName)",
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

    private var navigationTitle: String {
        switch mode {
        case .create:
            return "Create \(type.displayName)"
        case .edit:
            return "Edit \(type.displayName)"
        }
    }

    private var submitButtonTitle: String {
        if isSubmitting {
            return "Saving..."
        }

        switch mode {
        case .create:
            return "Create"
        case .edit:
            return "Save"
        }
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
                InlineActionButton(title: "Remove Image", systemImage: "trash", role: .destructive) {
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
                venueGooglePlacesButton

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

                if hours != nil {
                    Label("Hours will be auto-filled from Google Places.", systemImage: "clock")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.secondary)
                }
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

    private var venueGooglePlacesButton: some View {
        Button {
            isGooglePlacePickerPresented = true
        } label: {
            HStack(spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 13, style: .continuous)
                        .fill(Color(uiColor: .secondarySystemGroupedBackground))

                    Image(systemName: "magnifyingglass")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(AppTheme.accentBlue)
                }
                .frame(width: 42, height: 42)

                VStack(alignment: .leading, spacing: 3) {
                    Text(selectedGooglePlaceName ?? "Search Google Places")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)
                }

                Spacer(minLength: 0)

                Image(systemName: "chevron.right")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(.tertiary)
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
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

    private func applyGooglePlace(_ place: MobileGooglePlaceDetail) {
        selectedGooglePlaceName = place.name
        name = place.name
        address = place.address
        city = place.city
        state = place.state
        if let website = place.website?.absoluteString {
            websiteText = website
        }
        hours = place.hours
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
            let savedPlace: MobilePlaceCreateResponse
            switch mode {
            case .create:
                savedPlace = try await apiClient.send(
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
                        hours: isVenue ? hours : nil,
                        categories: orderedSelectedCategories
                    )
                )
            case .edit(let place):
                savedPlace = try await apiClient.send(
                    APIClient.mobileUpdatePlace(
                        slug: place.slug,
                        type: type,
                        name: trimmedName,
                        description: trimmedDescription.isEmpty ? nil : trimmedDescription,
                        logoImageURL: uploadedLogoURL,
                        keepExistingLogo: selectedLogoImage == nil,
                        address: isVenue && !trimmedAddress.isEmpty ? trimmedAddress : nil,
                        city: trimmedCity.isEmpty ? nil : trimmedCity,
                        state: trimmedState.isEmpty ? nil : trimmedState,
                        website: websiteURL,
                        instagram: trimmedInstagram.isEmpty ? nil : trimmedInstagram,
                        hours: isVenue ? hours : nil,
                        categories: orderedSelectedCategories
                    )
                )
            }

            NotificationCenter.default.post(name: .mobilePlaceDidChange, object: savedPlace.id)
            onCompleted?()
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
            categories = try await MobileCategoryStore.load(using: apiClient)
            loadError = nil
        } catch {
            categories = []
            loadError = error.localizedDescription
        }
    }
}

private struct InlineActionButton: View {
    let title: String
    let systemImage: String
    let role: ButtonRole?
    let action: () -> Void

    var body: some View {
        Button(role: role, action: action) {
            Label(title, systemImage: systemImage)
                .font(.system(size: 13, weight: .semibold))
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(
                    Capsule()
                        .fill(backgroundColor)
                )
        }
        .buttonStyle(.plain)
        .foregroundStyle(foregroundColor)
    }

    private var foregroundColor: Color {
        role == .destructive ? .red : AppTheme.accentBlue
    }

    private var backgroundColor: Color {
        role == .destructive
            ? Color.red.opacity(0.10)
            : AppTheme.accentBlue.opacity(0.12)
    }
}

@MainActor
private final class GooglePlaceLookupViewModel: ObservableObject {
    @Published private(set) var predictions: [MobileGooglePlacePrediction] = []
    @Published private(set) var isLoading = false
    @Published private(set) var loadError: String?
    private var activeQuery = ""

    func load(query: String, using apiClient: APIClient) async {
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        activeQuery = normalizedQuery

        guard normalizedQuery.count >= 2 else {
            predictions = []
            isLoading = false
            loadError = nil
            return
        }

        isLoading = true
        loadError = nil
        defer {
            if activeQuery == normalizedQuery {
                isLoading = false
            }
        }

        do {
            let response = try await apiClient.send(
                APIClient.mobileGooglePlaceSearch(query: normalizedQuery)
            )

            guard activeQuery == normalizedQuery else {
                return
            }

            predictions = response.predictions
        } catch {
            guard activeQuery == normalizedQuery else {
                return
            }

            predictions = []
            loadError = error.localizedDescription
        }
    }
}

private struct GooglePlaceLookupSheet: View {
    let onSelect: (MobileGooglePlaceDetail) -> Void

    @Environment(\.apiClient) private var apiClient
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel = GooglePlaceLookupViewModel()
    @State private var query = ""
    @State private var selectedPlaceID: String?

    var body: some View {
        NavigationStack {
            ZStack {
                AppTheme.background
                    .ignoresSafeArea()

                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        HStack(spacing: 10) {
                            Image(systemName: "magnifyingglass")
                                .font(.system(size: 16, weight: .medium))
                                .foregroundStyle(.white.opacity(0.65))

                            TextField("Search Google Places", text: $query)
                                .font(.system(size: 16, weight: .medium))
                                .foregroundStyle(.white)
                                .textInputAutocapitalization(.words)
                                .autocorrectionDisabled()

                            if !query.isEmpty {
                                Button {
                                    query = ""
                                } label: {
                                    Image(systemName: "xmark.circle.fill")
                                        .font(.system(size: 16, weight: .semibold))
                                        .foregroundStyle(.white.opacity(0.4))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                        .padding(.horizontal, 16)
                        .frame(height: 50)
                        .background(
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .fill(Color.white.opacity(0.08))
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 18, style: .continuous)
                                .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
                        )
                        .padding(.horizontal, 16)
                        .padding(.top, 12)

                        content
                            .padding(.horizontal, 16)
                    }
                    .padding(.bottom, 24)
                }
                .scrollIndicators(.hidden)
            }
            .navigationTitle("Search Google Places")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .task(id: normalizedQuery) {
                await viewModel.load(query: normalizedQuery, using: apiClient)
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if viewModel.isLoading && viewModel.predictions.isEmpty {
            ProgressView("Loading...")
                .frame(maxWidth: .infinity, minHeight: 220)
                .tint(.white)
                .foregroundStyle(.white)
        } else if let loadError = viewModel.loadError, viewModel.predictions.isEmpty {
            ContentUnavailableView {
                Label("Google Places", systemImage: "wifi.exclamationmark")
            } description: {
                Text(loadError)
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 220)
        } else if viewModel.predictions.isEmpty {
            ContentUnavailableView {
                Label("Google Places", systemImage: "building.2")
            } description: {
                Text(normalizedQuery.isEmpty
                     ? "Search for a venue to auto-fill its details."
                     : "No results matched your search.")
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 240)
        } else {
            LazyVStack(spacing: 12) {
                ForEach(viewModel.predictions) { prediction in
                    Button {
                        Task {
                            await select(prediction)
                        }
                    } label: {
                        HStack(spacing: 12) {
                            ZStack {
                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    .fill(Color.white.opacity(0.08))

                                Image(systemName: "building.2")
                                    .font(.system(size: 17, weight: .semibold))
                                    .foregroundStyle(AppTheme.accentBlue)
                            }
                            .frame(width: 46, height: 46)

                            VStack(alignment: .leading, spacing: 4) {
                                Text(prediction.primaryText)
                                    .font(.system(size: 15, weight: .semibold))
                                    .foregroundStyle(.white)
                                    .lineLimit(1)

                                if let secondaryText = prediction.secondaryText {
                                    Text(secondaryText)
                                        .font(.system(size: 13, weight: .medium))
                                        .foregroundStyle(.white.opacity(0.58))
                                        .lineLimit(2)
                                }
                            }

                            Spacer(minLength: 0)

                            if selectedPlaceID == prediction.placeID {
                                ProgressView()
                                    .tint(.white)
                            }
                        }
                        .padding(12)
                        .background(
                            RoundedRectangle(cornerRadius: 20, style: .continuous)
                                .fill(Color.white.opacity(0.06))
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 20, style: .continuous)
                                .strokeBorder(.white.opacity(0.05), lineWidth: 1)
                        )
                    }
                    .buttonStyle(.plain)
                    .disabled(selectedPlaceID != nil)
                }
            }
        }
    }

    private var normalizedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func select(_ prediction: MobileGooglePlacePrediction) async {
        selectedPlaceID = prediction.placeID
        defer {
            selectedPlaceID = nil
        }

        do {
            let detail = try await apiClient.send(
                APIClient.mobileGooglePlaceDetail(placeID: prediction.placeID)
            )
            onSelect(detail)
            dismiss()
        } catch {
            // Keep the sheet open so the user can try another result.
        }
    }
}
