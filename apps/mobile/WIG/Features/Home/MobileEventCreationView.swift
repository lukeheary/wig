import PhotosUI
import SwiftUI
import UIKit

struct MobileEventCreationView: View {
    enum Mode {
        case create
        case edit(EventFeedItem)
    }

    @Environment(\.apiClient) private var apiClient
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel = MobileEventCreationViewModel()

    private let mode: Mode
    private let onCompleted: ((EventFeedItem) -> Void)?

    @State private var activePlacePicker: PlacePickerKind?
    @State private var selectedCoverImageItem: PhotosPickerItem?
    @State private var selectedCoverImage: UIImage?
    @State private var existingCoverImageURL: URL?
    @State private var title = ""
    @State private var descriptionText = ""
    @State private var eventURLText = ""
    @State private var address = ""
    @State private var city = ""
    @State private var state = ""
    @State private var startAt = Date()
    @State private var endAt: Date
    @State private var hasEndAt = true
    @State private var selectedStatus: EventStatus = .active
    @State private var selectedVenue: PlaceDetail?
    @State private var selectedOrganizer: PlaceDetail?
    @State private var selectedCategoryKeys = Set<String>()
    @State private var isSubmitting = false
    @State private var alertMessage: String?
    @State private var activeAlert: ActiveAlert?

    init(mode: Mode = .create, onCompleted: ((EventFeedItem) -> Void)? = nil) {
        self.mode = mode
        self.onCompleted = onCompleted

        switch mode {
        case .create:
            let defaultEndDate = Calendar.current.date(byAdding: .hour, value: 2, to: .now) ?? .now
            _endAt = State(initialValue: defaultEndDate)
            _existingCoverImageURL = State(initialValue: nil)

        case .edit(let event):
            _title = State(initialValue: event.title)
            _descriptionText = State(initialValue: event.description ?? "")
            _eventURLText = State(initialValue: event.eventURL?.absoluteString ?? "")
            _address = State(initialValue: event.address ?? "")
            _city = State(initialValue: event.city)
            _state = State(initialValue: event.state)
            _startAt = State(initialValue: event.startAt)
            _endAt = State(initialValue: event.endAt ?? event.startAt.addingTimeInterval(2 * 60 * 60))
            _hasEndAt = State(initialValue: event.endAt != nil)
            _selectedStatus = State(initialValue: event.status)
            _selectedVenue = State(initialValue: Self.prefilledPlace(from: event, kind: .venue))
            _selectedOrganizer = State(initialValue: Self.prefilledPlace(from: event, kind: .organizer))
            _selectedCategoryKeys = State(initialValue: Set(event.categories))
            _existingCoverImageURL = State(initialValue: event.posterImageURL)
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                coverImageSection
                placeSections
                detailsSection
                locationSection
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

                await PlaceLookupViewModel.preload(using: apiClient)
            }
            .sheet(item: $activePlacePicker) { kind in
                PlaceLookupSheet(kind: kind) { place in
                    handleSelectedPlace(place, for: kind)
                }
            }
            .onChange(of: selectedCoverImageItem) { _, item in
                guard let item else {
                    return
                }

                Task {
                    await handleSelectedCoverImage(item)
                }
            }
            .onChange(of: alertMessage) { _, message in
                if let message {
                    activeAlert = .error(message)
                } else if case .error = activeAlert {
                    activeAlert = nil
                }
            }
            .onChange(of: selectedVenue?.id) { _, _ in
                applyVenueScheduleDefaults()
            }
            .onChange(of: scheduleDateKey) { _, _ in
                applyVenueScheduleDefaults()
            }
            .alert(item: $activeAlert) { alert in
                switch alert {
                case .error(let message):
                    return Alert(
                        title: Text(failureAlertTitle),
                        message: Text(message),
                        dismissButton: .cancel(Text("OK")) {
                            alertMessage = nil
                        }
                    )
                case .deleteConfirmation:
                    return Alert(
                        title: Text("Delete Event?"),
                        message: Text("This action cannot be undone."),
                        primaryButton: .destructive(Text("Delete")) {
                            Task {
                                await deleteEvent()
                            }
                        },
                        secondaryButton: .cancel()
                    )
                }
            }
        }
    }

    private var coverImageSection: some View {
        Section("Event Image") {
            PhotosPicker(selection: $selectedCoverImageItem, matching: .images) {
                ZStack {
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .fill(Color(uiColor: .secondarySystemGroupedBackground))

                    if let selectedCoverImage {
                        Image(uiImage: selectedCoverImage)
                            .resizable()
                            .scaledToFill()
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                            .clipped()
                    } else if let existingCoverImageURL {
                        AsyncImage(url: existingCoverImageURL) { phase in
                            switch phase {
                            case .success(let image):
                                image
                                    .resizable()
                                    .scaledToFill()
                                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                                    .clipped()
                            default:
                                coverImagePlaceholder
                            }
                        }
                    } else {
                        coverImagePlaceholder
                    }
                }
                .frame(height: 220)
                .clipShape(RoundedRectangle(cornerRadius: 22, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 22, style: .continuous)
                        .strokeBorder(Color(uiColor: .separator).opacity(0.35), lineWidth: 1)
                )
            }
            .buttonStyle(.plain)
            .listRowInsets(EdgeInsets(top: 10, leading: 16, bottom: 10, trailing: 16))

            if selectedCoverImage != nil || existingCoverImageURL != nil {
                Button("Remove Image", role: .destructive) {
                    selectedCoverImageItem = nil
                    selectedCoverImage = nil
                    existingCoverImageURL = nil
                }
            }
        }
    }

    private var placeSections: some View {
        Section("Linked Places") {
            placeSelectionSection(
                selection: selectedVenue,
                placeholderTitle: "Select Venue",
                systemImage: "building.2"
            ) {
                activePlacePicker = .venue
            } clearAction: {
                selectedVenue = nil
            }

            placeSelectionSection(
                selection: selectedOrganizer,
                placeholderTitle: "Select Organizer (Optional)",
                systemImage: "person.badge.plus"
            ) {
                activePlacePicker = .organizer
            } clearAction: {
                selectedOrganizer = nil
            }
        }
    }

    private var locationSource: PlaceDetail? {
        selectedVenue ?? selectedOrganizer
    }

    private var locationSection: some View {
        Section("Location") {
            ClearableInputField("Address", text: $address)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()

            ClearableInputField("City", text: $city)
                .textInputAutocapitalization(.words)
                .autocorrectionDisabled()

            ClearableInputField("State", text: $state)
                .textInputAutocapitalization(.characters)
                .autocorrectionDisabled()
        }
    }

    @ViewBuilder
    private var detailsSection: some View {
        Section("Details") {
            ClearableInputField("Event Title", text: $title)
                .textInputAutocapitalization(.words)

            VStack(alignment: .leading, spacing: 8) {
                Text("Description")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.secondary)

                TextEditor(text: $descriptionText)
                    .frame(minHeight: 100)
                    .scrollContentBackground(.hidden)
                    .padding(.horizontal, 2)
            }

            ClearableInputField("Event URL", text: $eventURLText)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()

            Picker("Status", selection: $selectedStatus) {
                ForEach(EventStatus.allCases, id: \.self) { status in
                    Text(status.title).tag(status)
                }
            }
        }

        Section("Schedule") {
            DatePicker(
                "Start Date",
                selection: startDateBinding,
                displayedComponents: [.date]
            )

            DatePicker(
                "Start Time",
                selection: $startAt,
                displayedComponents: [.hourAndMinute]
            )

            Toggle("Add End Time", isOn: $hasEndAt)
                .tint(AppTheme.accentBlue)

            if hasEndAt {
                DatePicker(
                    "End Date",
                    selection: endDateBinding,
                    displayedComponents: [.date]
                )

                DatePicker(
                    "End Time",
                    selection: $endAt,
                    displayedComponents: [.hourAndMinute]
                )
            }
        }

    }

    private var categoriesSection: some View {
        Group {
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

            if case .edit = mode {
                Section {
                    Button("Delete Event", role: .destructive) {
                        activeAlert = .deleteConfirmation
                    }
                }
            }
        }
    }

    private func placeSelectionSection(
        selection: PlaceDetail?,
        placeholderTitle: String,
        systemImage: String,
        onSelect: @escaping () -> Void,
        clearAction: @escaping () -> Void
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Button(action: onSelect) {
                HStack(spacing: 12) {
                    placeIcon(selection: selection, placeholderSystemImage: systemImage)

                    Text(selection?.name ?? placeholderTitle)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.primary)
                        .lineLimit(1)

                    Spacer(minLength: 0)

                    Image(systemName: "chevron.right")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.tertiary)
                }
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            if selection != nil {
                Button("Clear", role: .destructive) {
                    clearAction()
                }
            }
        }
    }

    private func placeIcon(selection: PlaceDetail?, placeholderSystemImage: String) -> some View {
        Group {
            if let url = selection?.displayLogoURL {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                    default:
                        placeholderPlaceIcon(systemImage: placeholderSystemImage)
                    }
                }
            } else {
                placeholderPlaceIcon(systemImage: placeholderSystemImage)
            }
        }
        .frame(width: 42, height: 42)
        .clipShape(RoundedRectangle(cornerRadius: 13, style: .continuous))
    }

    private func placeholderPlaceIcon(systemImage: String) -> some View {
        RoundedRectangle(cornerRadius: 13, style: .continuous)
            .fill(Color(uiColor: .secondarySystemGroupedBackground))
            .overlay {
                Image(systemName: systemImage)
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.secondary)
            }
    }

    private func handleSelectedPlace(_ place: PlaceDetail, for kind: PlacePickerKind) {
        switch kind {
        case .venue:
            selectedVenue = place

            if !place.categories.isEmpty {
                selectedCategoryKeys = Set(place.categories)
            }

            if let address = cleaned(place.address) {
                self.address = address
            }
            if let city = cleaned(place.city) {
                self.city = city
            }
            if let state = cleaned(place.state) {
                self.state = state
            }

        case .organizer:
            selectedOrganizer = place

            if selectedVenue == nil {
                if cleaned(address) == nil, let placeAddress = cleaned(place.address) {
                    address = placeAddress
                }

                if cleaned(city) == nil, let placeCity = cleaned(place.city) {
                    city = placeCity
                }

                if cleaned(state) == nil, let placeState = cleaned(place.state) {
                    state = placeState
                }
            }
        }
    }

    private func handleSelectedCoverImage(_ item: PhotosPickerItem) async {
        selectedCoverImageItem = nil

        do {
            guard
                let data = try await item.loadTransferable(type: Data.self),
                let image = UIImage(data: data)
            else {
                alertMessage = "That image couldn’t be loaded."
                return
            }

            selectedCoverImage = image
            existingCoverImageURL = nil
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

        let trimmedTitle = title.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedDescription = descriptionText.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedEventURL = eventURLText.trimmingCharacters(in: .whitespacesAndNewlines)
        let finalVenueID = selectedVenue?.id
        let finalOrganizerID = selectedOrganizer?.id
        let finalAddress = cleaned(locationSource?.address) ?? cleaned(address)
        let finalCity = cleaned(locationSource?.city) ?? cleaned(city)
        let finalState = cleaned(locationSource?.state) ?? cleaned(state)?.uppercased()

        guard !trimmedTitle.isEmpty else {
            alertMessage = "Please enter an event title."
            return
        }

        guard let finalCity, !finalCity.isEmpty else {
            alertMessage = "Please enter a city."
            return
        }

        guard let finalState, !finalState.isEmpty else {
            alertMessage = "Please enter a state."
            return
        }

        let endDate = hasEndAt ? endAt : nil
        if let endDate, endDate <= startAt {
            alertMessage = "End time must be after the start time."
            return
        }

        var eventURLValue: URL?
        if !trimmedEventURL.isEmpty {
            guard let url = URL(string: trimmedEventURL) else {
                alertMessage = "Please enter a valid event URL."
                return
            }

            eventURLValue = url
        }

        isSubmitting = true
        defer {
            isSubmitting = false
        }

        do {
            let uploadedCoverURL = try await uploadedCoverImageURLIfNeeded()

            switch mode {
            case .create:
                let createdEvent = try await apiClient.send(
                    APIClient.mobileCreateEvent(
                        venueID: finalVenueID,
                        organizerID: finalOrganizerID,
                        title: trimmedTitle,
                        description: trimmedDescription.isEmpty ? nil : trimmedDescription,
                        coverImageURL: uploadedCoverURL,
                        eventURL: eventURLValue,
                        startAt: startAt,
                        endAt: endDate,
                        address: finalAddress,
                        city: finalCity,
                        state: finalState,
                        categories: orderedSelectedCategories,
                        status: selectedStatus
                    )
                )

                if uploadedCoverURL == nil, let selectedCoverImage {
                    if let imageData = selectedCoverImage.eventCoverUploadJPEGData(maxBytes: 4 * 1024 * 1024) {
                        do {
                            let uploadedImage = try await apiClient.send(
                                APIClient.mobileUploadImage(
                                    imageData: imageData,
                                    folder: "events/\(createdEvent.id.uuidString)",
                                    fileName: "cover-image.jpg"
                                )
                            )

                            try await apiClient.send(
                                APIClient.mobileSetEventCoverImage(
                                    eventID: createdEvent.id,
                                    coverImageURL: uploadedImage.url
                                )
                            )
                        } catch {
                            // Keep the event creation success even if the cover image upload fails.
                        }
                    }
                }

                NotificationCenter.default.post(name: .mobileEventDidChange, object: createdEvent.id)
                dismiss()

            case .edit(let event):
                let updatedEvent = try await apiClient.send(
                    APIClient.mobileUpdateEvent(
                        eventID: event.id,
                        venueID: finalVenueID,
                        organizerID: finalOrganizerID,
                        title: trimmedTitle,
                        description: trimmedDescription.isEmpty ? nil : trimmedDescription,
                        coverImageURL: uploadedCoverURL ?? existingCoverImageURL,
                        removeCoverImage: uploadedCoverURL == nil && existingCoverImageURL == nil,
                        eventURL: eventURLValue,
                        startAt: startAt,
                        endAt: endDate,
                        address: finalAddress,
                        city: finalCity,
                        state: finalState,
                        categories: orderedSelectedCategories,
                        status: selectedStatus
                    )
                )

                NotificationCenter.default.post(name: .mobileEventDidChange, object: updatedEvent.id)
                onCompleted?(updatedEvent)
                dismiss()
            }
        } catch {
            alertMessage = error.localizedDescription
        }
    }

    private func uploadedCoverImageURLIfNeeded() async throws -> URL? {
        guard let selectedCoverImage else {
            return nil
        }

        guard let imageData = selectedCoverImage.eventCoverUploadJPEGData(maxBytes: 4 * 1024 * 1024) else {
            return nil
        }

        let folder: String
        switch mode {
        case .create:
            folder = "events/pending/\(UUID().uuidString)"
        case .edit(let event):
            folder = "events/\(event.id.uuidString)"
        }

        let uploadedImage = try await apiClient.send(
            APIClient.mobileUploadImage(
                imageData: imageData,
                folder: folder,
                fileName: "cover-image.jpg"
            )
        )

        return uploadedImage.url
    }

    private var navigationTitle: String {
        switch mode {
        case .create:
            return "Create Event"
        case .edit:
            return "Edit Event"
        }
    }

    private var submitButtonTitle: String {
        if isSubmitting {
            switch mode {
            case .create:
                return "Creating..."
            case .edit:
                return "Saving..."
            }
        }

        switch mode {
        case .create:
            return "Create"
        case .edit:
            return "Save"
        }
    }

    private var failureAlertTitle: String {
        switch mode {
        case .create:
            return "Couldn't Create Event"
        case .edit:
            return "Couldn't Save Event"
        }
    }

    private var coverImagePlaceholder: some View {
        VStack(spacing: 10) {
            Image(systemName: "photo.on.rectangle.angled")
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(.secondary)

            Text("Add a cover image")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.primary)

            Text("JPG or PNG up to 4 MB")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.secondary)
        }
        .padding(.horizontal, 20)
    }

    private static func prefilledPlace(
        from event: EventFeedItem,
        kind: PlacePickerKind
    ) -> PlaceDetail? {
        switch kind {
        case .venue:
            guard
                let id = event.venueID,
                let slug = event.venueSlug,
                let name = event.venueName
            else {
                return nil
            }

            return PlaceDetail(
                id: id,
                type: .venue,
                slug: slug,
                name: name,
                description: nil,
                logoImageURL: event.venueLogoImageURL,
                coverImageURL: nil,
                address: event.address,
                city: event.city,
                state: event.state,
                website: nil,
                instagram: nil,
                hours: nil,
                categories: event.categories,
                categoryLabels: event.categoryLabels,
                updatedAt: event.updatedAt,
                isFollowed: event.isFollowed,
                events: [],
                pastEvents: []
            )

        case .organizer:
            guard
                let id = event.organizerID,
                let slug = event.organizerSlug,
                let name = event.organizerName
            else {
                return nil
            }

            return PlaceDetail(
                id: id,
                type: .organizer,
                slug: slug,
                name: name,
                description: nil,
                logoImageURL: event.organizerLogoImageURL,
                coverImageURL: nil,
                address: event.address,
                city: event.city,
                state: event.state,
                website: nil,
                instagram: nil,
                hours: nil,
                categories: event.categories,
                categoryLabels: event.categoryLabels,
                updatedAt: event.updatedAt,
                isFollowed: event.isFollowed,
                events: [],
                pastEvents: []
            )
        }
    }

    private var orderedSelectedCategories: [String] {
        viewModel.categories
            .map(\.key)
            .filter { selectedCategoryKeys.contains($0) }
    }

    private func cleaned(_ value: String?) -> String? {
        guard let value else {
            return nil
        }

        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }

    private var scheduleDateKey: Date {
        Calendar.current.startOfDay(for: startAt)
    }

    private var startDateBinding: Binding<Date> {
        Binding(
            get: { startAt },
            set: { newDate in
                startAt = Self.combineDate(newDate, withTimeFrom: startAt)

                if endAt < startAt {
                    endAt = startAt.addingTimeInterval(2 * 60 * 60)
                }
            }
        )
    }

    private var endDateBinding: Binding<Date> {
        Binding(
            get: { endAt },
            set: { newDate in
                endAt = Self.combineDate(newDate, withTimeFrom: endAt)
            }
        )
    }

    private func applyVenueScheduleDefaults() {
        guard let dayHours = selectedVenue?.hours?.hours(for: startAt),
              !dayHours.closed
        else {
            return
        }

        if let openDate = Self.date(for: dayHours.open, on: startAt) {
            startAt = openDate
        }

        if let closeDate = Self.date(for: dayHours.close, on: startAt) {
            hasEndAt = true

            if closeDate >= startAt {
                endAt = closeDate
            } else if let nextDayClose = Calendar.current.date(byAdding: .day, value: 1, to: closeDate) {
                endAt = nextDayClose
            }
        }
    }

    private static func date(for time: String, on baseDate: Date) -> Date? {
        let parts = time.split(separator: ":")
        guard parts.count == 2,
              let hour = Int(parts[0]),
              let minute = Int(parts[1])
        else {
            return nil
        }

        var components = Calendar.current.dateComponents([.year, .month, .day], from: baseDate)
        components.hour = hour
        components.minute = minute
        components.second = 0
        return Calendar.current.date(from: components)
    }

    private static func combineDate(_ date: Date, withTimeFrom timeSource: Date) -> Date {
        let calendar = Calendar.current
        var dateComponents = calendar.dateComponents([.year, .month, .day], from: date)
        let timeComponents = calendar.dateComponents([.hour, .minute, .second], from: timeSource)
        dateComponents.hour = timeComponents.hour
        dateComponents.minute = timeComponents.minute
        dateComponents.second = timeComponents.second
        return calendar.date(from: dateComponents) ?? date
    }

    private func deleteEvent() async {
        guard !isSubmitting else {
            return
        }

        guard case .edit(let event) = mode else {
            return
        }

        isSubmitting = true
        defer {
            isSubmitting = false
        }

        do {
            try await apiClient.send(APIClient.deleteMobileEvent(eventID: event.id))
            NotificationCenter.default.post(name: .mobileEventDidDelete, object: event.id)
            NotificationCenter.default.post(name: .mobileEventDidChange, object: event.id)
            dismiss()
        } catch {
            alertMessage = error.localizedDescription
            activeAlert = .error(error.localizedDescription)
        }
    }
}

private enum ActiveAlert: Identifiable {
    case error(String)
    case deleteConfirmation

    var id: String {
        switch self {
        case .error(let message):
            return "error-\(message)"
        case .deleteConfirmation:
            return "deleteConfirmation"
        }
    }
}

private struct ClearableInputField: View {
    let title: String
    @Binding var text: String

    init(_ title: String, text: Binding<String>) {
        self.title = title
        _text = text
    }

    var body: some View {
        HStack(spacing: 8) {
            TextField(title, text: $text)

            if !text.isEmpty {
                Button {
                    text = ""
                } label: {
                    Image(systemName: "xmark.circle.fill")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.tertiary)
                }
                .buttonStyle(.plain)
            }
        }
    }
}

@MainActor
private final class MobileEventCreationViewModel: ObservableObject {
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

private enum PlacePickerKind: String, Identifiable {
    case venue
    case organizer

    var id: String { rawValue }

    var title: String {
        switch self {
        case .venue:
            return "Select Venue"
        case .organizer:
            return "Select Organizer"
        }
    }

    var type: PlaceListItem.PlaceType {
        switch self {
        case .venue:
            return .venue
        case .organizer:
            return .organizer
        }
    }

    var placeholderQuery: String {
        switch self {
        case .venue:
            return "Search venues"
        case .organizer:
            return "Search organizers"
        }
    }
}

private struct PlaceLookupSheet: View {
    let kind: PlacePickerKind
    let onSelect: (PlaceDetail) -> Void

    @Environment(\.apiClient) private var apiClient
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel: PlaceLookupViewModel
    @State private var query = ""

    init(kind: PlacePickerKind, onSelect: @escaping (PlaceDetail) -> Void) {
        self.kind = kind
        self.onSelect = onSelect
        _viewModel = StateObject(wrappedValue: PlaceLookupViewModel(type: kind.type))
    }

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

                            TextField(kind.placeholderQuery, text: $query)
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
            .navigationTitle(kind.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        dismiss()
                    }
                }
            }
            .task(id: normalizedQuery) {
                await viewModel.load(
                    query: normalizedQuery,
                    using: apiClient
                )
            }
        }
    }

    @ViewBuilder
    private var content: some View {
        if viewModel.isLoading && viewModel.places.isEmpty {
            ProgressView("Loading...")
                .frame(maxWidth: .infinity, minHeight: 220)
                .tint(.white)
                .foregroundStyle(.white)
        } else if viewModel.places.isEmpty {
            ContentUnavailableView {
                Label(kind.title, systemImage: kind.type == .venue ? "building.2" : "person.badge.plus")
            } description: {
                Text(query.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                     ? "Type to search for a place."
                     : "No results matched your search.")
            }
            .foregroundStyle(.white)
            .frame(maxWidth: .infinity, minHeight: 240)
        } else {
            LazyVStack(spacing: 12) {
                ForEach(viewModel.places) { place in
                    Button {
                        Task {
                            await select(place)
                        }
                    } label: {
                        PlaceSearchRow(place: place)
                    }
                    .buttonStyle(.plain)
                }
            }
        }
    }

    private var normalizedQuery: String {
        query.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func select(_ place: PlaceListItem) async {
        do {
            let detail = try await apiClient.send(
                APIClient.mobilePlaceDetail(slug: place.slug)
            )
            onSelect(detail)
            dismiss()
        } catch {
            // Keep the picker open if the detail lookup fails.
        }
    }
}

@MainActor
private final class PlaceLookupViewModel: ObservableObject {
    enum Phase {
        case idle
        case loading
        case loaded
    }

    private static var cachedResponse: MobilePlacesResponse?
    private static var inFlightLoad: Task<MobilePlacesResponse, Error>?

    let type: PlaceListItem.PlaceType
    @Published private(set) var places: [PlaceListItem] = []
    @Published private(set) var phase: Phase = .idle
    private var activeQuery = ""

    var isLoading: Bool {
        phase == .loading
    }

    init(type: PlaceListItem.PlaceType) {
        self.type = type
    }

    func load(query: String, using apiClient: APIClient) async {
        let normalizedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        activeQuery = normalizedQuery
        phase = .loading

        do {
            if normalizedQuery.isEmpty {
                let response: MobilePlacesResponse

                if let cachedResponse = Self.cachedResponse {
                    response = cachedResponse
                } else if let inFlightLoad = Self.inFlightLoad {
                    response = try await inFlightLoad.value
                    Self.cachedResponse = response
                } else {
                    let loadTask = Task {
                        try await apiClient.send(APIClient.mobilePlaces(limit: 50))
                    }
                    Self.inFlightLoad = loadTask
                    do {
                        response = try await loadTask.value
                        Self.cachedResponse = response
                    } catch {
                        Self.inFlightLoad = nil
                        throw error
                    }
                    Self.inFlightLoad = nil
                }

                guard activeQuery == normalizedQuery else {
                    return
                }

                places = response.places.filter { $0.type == type }
            } else {
                let response = try await apiClient.send(
                    APIClient.mobileSearch(query: normalizedQuery, limit: 20)
                )

                guard activeQuery == normalizedQuery else {
                    return
                }

                places = response.places.filter { $0.type == type }
            }
        } catch {
            guard activeQuery == normalizedQuery else {
                return
            }

            places = []
        }

        if activeQuery == normalizedQuery {
            phase = .loaded
        }
    }

    static func preload(using apiClient: APIClient) async {
        if cachedResponse != nil {
            return
        }

        if let inFlightLoad {
            _ = try? await inFlightLoad.value
            return
        }

        let loadTask = Task {
            try await apiClient.send(
                APIClient.mobilePlaces(limit: 50)
            )
        }
        inFlightLoad = loadTask

        do {
            cachedResponse = try await loadTask.value
        } catch {
            // Ignore preload failures; the picker can still load normally later.
        }

        inFlightLoad = nil
    }
}

private struct PlaceSearchRow: View {
    let place: PlaceListItem

    var body: some View {
        HStack(spacing: 12) {
            logo

            VStack(alignment: .leading, spacing: 4) {
                Text(place.name)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                    .lineLimit(1)

                Text(place.type.displayName)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(AppTheme.accentBlue)

                if !place.locationText.isEmpty {
                    Text(place.locationText)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.white.opacity(0.58))
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 0)
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

    @ViewBuilder
    private var logo: some View {
        Group {
            if let url = place.displayLogoURL {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                    default:
                        placeholder
                    }
                }
            } else {
                placeholder
            }
        }
        .frame(width: 46, height: 46)
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
    }

    private var placeholder: some View {
        RoundedRectangle(cornerRadius: 14, style: .continuous)
            .fill(.white.opacity(0.08))
            .overlay {
                Image(systemName: place.type == .venue ? "building.2" : "person.2")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.76))
            }
    }
}
