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
    private let onDeleted: (() -> Void)?

    @State private var selectedLogoImageItem: PhotosPickerItem?
    @State private var selectedLogoImage: UIImage?
    @State private var didRemoveExistingLogo = false
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
    @State private var isDeleteConfirmationPresented = false
    @State private var isDeleting = false
    @State private var isEnabled = true
    @State private var alertMessage: String?
    @State private var isGooglePlacePickerPresented = false
    @State private var venueScraperRows: [EditablePlaceScraperRow] = []

    init(type: PlaceListItem.PlaceType, onCompleted: (() -> Void)? = nil) {
        self.init(mode: .create(type), onCompleted: onCompleted, onDeleted: nil)
    }

    init(mode: Mode, onCompleted: (() -> Void)? = nil, onDeleted: (() -> Void)? = nil) {
        self.mode = mode
        self.onCompleted = onCompleted
        self.onDeleted = onDeleted

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
            _isEnabled = State(initialValue: place.isEnabled)
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

    // The place's current logo (edit mode only), shown until the user picks a new
    // image or removes it.
    private var existingLogoURL: URL? {
        guard case .edit(let place) = mode else {
            return nil
        }

        return place.displayLogoURL
    }

    private var hasExistingLogo: Bool {
        existingLogoURL != nil && !didRemoveExistingLogo
    }

    var body: some View {
        NavigationStack {
            Form {
                logoSection
                locationSection
                detailsSection
                categoriesSection
                if showsScrapersSection {
                    placeScrapersSection
                }
                if case .edit = mode {
                    placeActionsSection
                }
            }
            .scrollContentBackground(.hidden)
            .background(Color(uiColor: .systemGroupedBackground))
            .navigationTitle(navigationTitle)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
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

                await loadVenueScrapersIfNeeded()
            }
            .sheet(isPresented: $isGooglePlacePickerPresented) {
                GooglePlaceSearchSheet(
                    title: "Search Google Places",
                    placeholder: "Search Google Places",
                    emptyPrompt: "Search for a venue to auto-fill its details.",
                    iconSystemName: "building.2",
                    searchType: .establishments
                ) { place in
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
            .alert("Delete \(type.displayName)?", isPresented: $isDeleteConfirmationPresented) {
                Button("Delete \(type.displayName)", role: .destructive) {
                    Task {
                        await deletePlace()
                    }
                }

                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This will delete the \(type.displayName.lowercased()) and all of its upcoming events.")
            }
        }
    }

    private var isVenue: Bool {
        type == .venue
    }

    private var showsScrapersSection: Bool {
        if case .edit = mode {
            return true
        }

        return isVenue
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
                    } else if hasExistingLogo {
                        RemoteImageView(url: existingLogoURL) { image in
                            image
                                .resizable()
                                .scaledToFill()
                                .frame(maxWidth: .infinity, maxHeight: .infinity)
                                .clipped()
                        } placeholder: {
                            logoPlaceholder
                        }
                    } else {
                        logoPlaceholder
                    }
                }
                .frame(width: 104, height: 104)
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .strokeBorder(Color(uiColor: .separator).opacity(0.35), lineWidth: 1)
                )
            }
            .buttonStyle(.plain)
            .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))

            if selectedLogoImage != nil || hasExistingLogo {
                InlineActionButton(title: "Remove Image", systemImage: "trash", role: .destructive) {
                    selectedLogoImageItem = nil
                    selectedLogoImage = nil
                    if existingLogoURL != nil {
                        didRemoveExistingLogo = true
                    }
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
                NativeLoadingView(fillsAvailableSpace: false)
                    .tint(AppTheme.accentBlue)
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

    private var placeScrapersSection: some View {
        Section("\(type.displayName) Scrapers") {
            if venueScraperRows.isEmpty {
                Text("No scrapers configured.")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.secondary)
            } else {
                ForEach(venueScraperRows) { row in
                    VStack(alignment: .leading, spacing: 12) {
                        Picker(
                            "Scraper Type",
                            selection: scraperBinding(for: row.id, keyPath: \.scraper)
                        ) {
                            ForEach(MobileScraperType.allCases, id: \.self) { scraper in
                                Text(scraper.title).tag(scraper)
                            }
                        }

                        ClearableInputField(
                            row.scraper == .ticketmaster
                                ? "\(type.displayName) Name"
                                : row.scraper == .posh
                                    ? "Posh URL"
                                    : "Scraper URL",
                            text: scraperBinding(for: row.id, keyPath: \.searchString)
                        )
                        .textInputAutocapitalization(.never)
                        .autocorrectionDisabled()

                        if row.scraper == .ticketmaster {
                            ClearableInputField(
                                "Classification Name (Optional)",
                                text: scraperBinding(for: row.id, keyPath: \.classificationNameText)
                            )
                            .textInputAutocapitalization(.never)
                            .autocorrectionDisabled()
                        }

                        InlineActionButton(title: "Remove Scraper", systemImage: "trash", role: .destructive) {
                            venueScraperRows.removeAll { $0.id == row.id }
                        }
                    }
                    .padding(.vertical, 4)
                }
            }

            InlineActionButton(title: "Add Scraper", systemImage: "plus", role: nil) {
                venueScraperRows.append(EditablePlaceScraperRow())
            }
        }
    }

    @ViewBuilder
    private var placeActionsSection: some View {
        Section {
            HStack(spacing: 14) {
                Toggle(isOn: Binding(
                    get: { !isEnabled },
                    set: { isEnabled = !$0 }
                )) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("Disable Place")
                        Text("Hide without deleting past events")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                }
                .tint(AppTheme.accentBlue)

                Divider()

                Button(role: .destructive) {
                    isDeleteConfirmationPresented = true
                } label: {
                    HStack(spacing: 6) {
                        if isDeleting {
                            ProgressView()
                                .tint(.red)
                        }

                        Text(isDeleting ? "Deleting..." : "Delete")
                    }
                }
                .disabled(isSubmitting || isDeleting)
            }
            .disabled(isSubmitting || isDeleting)
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
                        keepExistingLogo: selectedLogoImage == nil && !didRemoveExistingLogo,
                        address: isVenue && !trimmedAddress.isEmpty ? trimmedAddress : nil,
                        city: trimmedCity.isEmpty ? nil : trimmedCity,
                        state: trimmedState.isEmpty ? nil : trimmedState,
                        website: websiteURL,
                        instagram: trimmedInstagram.isEmpty ? nil : trimmedInstagram,
                        hours: isVenue ? hours : nil,
                        categories: orderedSelectedCategories,
                        isEnabled: isEnabled
                    )
                )
            }

            try await saveVenueScrapers(slug: savedPlace.slug)
            NotificationCenter.default.post(name: .mobilePlaceDidChange, object: savedPlace.id)
            onCompleted?()
            dismiss()
        } catch {
            alertMessage = error.localizedDescription
        }
    }

    private func deletePlace() async {
        guard !isDeleting else {
            return
        }

        guard case .edit(let place) = mode else {
            return
        }

        isDeleting = true
        defer {
            isDeleting = false
        }

        do {
            _ = try await apiClient.send(APIClient.mobileDeletePlace(slug: place.slug))
            NotificationCenter.default.post(name: .mobilePlaceDidChange, object: place.id)
            onDeleted?()
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

    private func loadVenueScrapersIfNeeded() async {
        guard case .edit(let place) = mode else {
            venueScraperRows = []
            return
        }

        do {
            let response = try await apiClient.send(APIClient.mobilePlaceScrapers(slug: place.slug))
            venueScraperRows = response.scrapers.map(EditablePlaceScraperRow.init)
        } catch {
            venueScraperRows = []
        }
    }

    private func saveVenueScrapers(slug: String) async throws {
        guard showsScrapersSection else {
            return
        }

        _ = try await apiClient.send(
            APIClient.replaceMobilePlaceScrapers(
                slug: slug,
                scrapers: venueScraperRows.compactMap(\.apiValue)
            )
        )
    }

    private func scraperBinding<Value>(
        for id: UUID,
        keyPath: WritableKeyPath<EditablePlaceScraperRow, Value>
    ) -> Binding<Value> {
        Binding(
            get: {
                guard let row = venueScraperRows.first(where: { $0.id == id }) else {
                    fatalError("Missing scraper row for binding")
                }
                return row[keyPath: keyPath]
            },
            set: { newValue in
                guard let index = venueScraperRows.firstIndex(where: { $0.id == id }) else {
                    return
                }
                venueScraperRows[index][keyPath: keyPath] = newValue
            }
        )
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

private struct EditablePlaceScraperRow: Identifiable, Hashable {
    let id: UUID
    var persistedID: UUID?
    var scraper: MobileScraperType
    var searchString: String
    var classificationNameText: String

    init(
        id: UUID = UUID(),
        persistedID: UUID? = nil,
        scraper: MobileScraperType = .dice,
        searchString: String = "",
        classificationNameText: String = ""
    ) {
        self.id = id
        self.persistedID = persistedID
        self.scraper = scraper
        self.searchString = searchString
        self.classificationNameText = classificationNameText
    }

    init(config: MobilePlaceScraperConfig) {
        self.init(
            persistedID: config.id,
            scraper: config.scraper,
            searchString: config.searchString,
            classificationNameText: config.classificationName ?? ""
        )
    }

    var apiValue: MobilePlaceScraperConfig? {
        let trimmedSearchString = searchString.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedSearchString.isEmpty else {
            return nil
        }

        let trimmedClassificationName = classificationNameText.trimmingCharacters(in: .whitespacesAndNewlines)
        return MobilePlaceScraperConfig(
            id: persistedID,
            scraper: scraper,
            searchString: trimmedSearchString,
            classificationName: scraper == .ticketmaster && !trimmedClassificationName.isEmpty
                ? trimmedClassificationName
                : nil
        )
    }
}

@MainActor
private final class GooglePlaceSearchViewModel: ObservableObject {
    @Published private(set) var predictions: [MobileGooglePlacePrediction] = []
    @Published private(set) var isLoading = false
    @Published private(set) var loadError: String?
    private var activeQuery = ""

    func load(
        query: String,
        searchType: MobileGooglePlaceSearchType,
        using apiClient: APIClient
    ) async {
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        activeQuery = normalizedQuery

        guard normalizedQuery.count >= 2 else {
            predictions = []
            loadError = nil
            isLoading = false
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
                APIClient.mobileGooglePlaceSearch(
                    query: normalizedQuery,
                    searchType: searchType
                )
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

struct GooglePlaceSearchSheet: View {
    let title: String
    let placeholder: String
    let emptyPrompt: String
    let iconSystemName: String
    let searchType: MobileGooglePlaceSearchType
    let onSelect: (MobileGooglePlaceDetail) -> Void

    @Environment(\.apiClient) private var apiClient
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel = GooglePlaceSearchViewModel()
    @State private var query = ""
    @State private var selectedPlaceID: String?
    @State private var selectionErrorMessage: String?
    @FocusState private var isSearchFocused: Bool

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

                            TextField(placeholder, text: $query)
                                .font(.system(size: 16, weight: .medium))
                                .foregroundStyle(.white)
                                .tint(AppTheme.accentBlue)
                                .textInputAutocapitalization(.words)
                                .autocorrectionDisabled()
                                .focused($isSearchFocused)

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
                        .contentShape(Rectangle())
                        .onTapGesture {
                            isSearchFocused = true
                        }
                        .padding(.horizontal, 16)
                        .padding(.top, 12)

                        content
                            .padding(.horizontal, 16)
                    }
                    .padding(.bottom, 24)
                }
                .scrollIndicators(.hidden)
            }
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .alert(
                "Couldn't Load Place",
                isPresented: Binding(
                    get: { selectionErrorMessage != nil },
                    set: { isPresented in
                        if !isPresented {
                            selectionErrorMessage = nil
                        }
                    }
                )
            ) {
                Button("OK", role: .cancel) {}
            } message: {
                Text(selectionErrorMessage ?? "Please try another result.")
            }
            .task(id: normalizedQuery) {
                await viewModel.load(
                    query: normalizedQuery,
                    searchType: searchType,
                    using: apiClient
                )
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if viewModel.isLoading && viewModel.predictions.isEmpty {
            NativeLoadingView()
                .frame(maxWidth: .infinity, minHeight: 220)
                .tint(.white)
                .foregroundStyle(.white)
        } else if let loadError = viewModel.loadError, viewModel.predictions.isEmpty {
            ContentUnavailableView {
                Label(title, systemImage: "wifi.exclamationmark")
            } description: {
                Text(loadError)
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 220)
        } else if viewModel.predictions.isEmpty {
            ContentUnavailableView {
                Label(title, systemImage: iconSystemName)
            } description: {
                Text(normalizedQuery.isEmpty ? emptyPrompt : "No results matched your search.")
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

                                Image(systemName: iconSystemName)
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
                APIClient.mobileGooglePlaceDetail(
                    placeID: prediction.placeID,
                    searchType: searchType
                )
            )
            isSearchFocused = false
            UIApplication.shared.sendAction(
                #selector(UIResponder.resignFirstResponder),
                to: nil,
                from: nil,
                for: nil
            )
            try? await Task.sleep(for: .milliseconds(120))
            onSelect(detail)
            dismiss()
        } catch {
            selectionErrorMessage = error.localizedDescription
        }
    }
}
