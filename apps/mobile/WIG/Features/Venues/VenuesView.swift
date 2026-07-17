import CoreImage
import CoreImage.CIFilterBuiltins
import SwiftUI
import UIKit

struct VenuesView: View {
    let resetFiltersTrigger: Int

    @Environment(\.apiClient) private var apiClient
    @EnvironmentObject private var appSession: AppSession
    @StateObject private var viewModel = VenuesViewModel()
    @State private var selectedLocationFilter: PlaceLocationFilter?
    @State private var selectedPlaceFilter: PlaceKindFilter = .all
    @State private var selectedCategoryID: String?
    @State private var isPlaceSearchPresented = false
    @State private var placeSearchText = ""
    @FocusState private var isPlaceSearchFocused: Bool

    init(resetFiltersTrigger: Int = 0) {
        self.resetFiltersTrigger = resetFiltersTrigger
    }

    var body: some View {
        NavigationStack {
            content
                .background(venuesBackground)
                .topStatusBarScrim()
                .navigationDestination(for: PlaceListItem.self) { place in
                    PlaceDetailView(place: place)
                }
                .toolbar(.hidden, for: .navigationBar)
                .task {
                    if case .idle = viewModel.state {
                        await viewModel.load(using: apiClient)
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: .mobilePlaceDidChange)) { _ in
                    Task {
                        await viewModel.load(using: apiClient, forceRefresh: true)
                    }
                }
                .onReceive(NotificationCenter.default.publisher(for: .appDataDidChange)) { _ in
                    Task {
                        await viewModel.load(using: apiClient, forceRefresh: true)
                    }
                }
                .onChange(of: resetFiltersTrigger) { _, _ in
                    resetFilters()
                }
                .onChange(of: selectedLocationFilter) { _, newValue in
                    appSession.selectedCityContext = newValue?.selectedCityContext
                }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            ScrollView {
                LazyVStack(alignment: .leading, spacing: 12) {
                    placesHeader(locationName: selectedLocationName)

                    NativeLoadingView(title: "Loading venues…")
                        .frame(minHeight: 360)
                }
                .padding(.horizontal, 16)
                .padding(.top, 74)
                .padding(.bottom, 48)
            }
            .overlay(alignment: .topLeading) {
                topControls(for: nil)
                    .padding(.horizontal, 16)
                    .padding(.top, 0)
            }
            .scrollIndicators(.hidden)
            .scrollDismissesKeyboard(.interactively)
            .background(venuesBackground)

        case .failed(let message):
            ContentUnavailableView {
                Label("Couldn’t Load Venues", systemImage: "wifi.exclamationmark")
            } description: {
                Text(message)
            } actions: {
                Button("Try Again") {
                    Task {
                        await viewModel.load(using: apiClient)
                    }
                }
            }
            .foregroundStyle(.white)
            .background(venuesBackground)

        case .loaded(let response):
            if response.places.isEmpty {
                ContentUnavailableView {
                    Label("No Venues Yet", systemImage: "building.2")
                } description: {
                    Text("The mobile places feed is connected, but no venues or organizers are available yet.")
                }
                .foregroundStyle(.white)
                .background(venuesBackground)
            } else {
                ScrollView {
                    VStack(alignment: .leading, spacing: 12) {
                        placesHeaderMenu(for: response)
                        let sections = groupedPlaces(in: response)

                        if sections.isEmpty {
                            ContentUnavailableView {
                                Label("No Places Found", systemImage: "building.2")
                            } description: {
                                Text("Try adjusting your city or place filter.")
                            }
                            .foregroundStyle(.white)
                            .padding(.top, 48)
                        }

                        // A plain VStack (not LazyVStack): the lazy layout was
                        // estimating row positions that drifted from where rows
                        // actually drew, which offset each NavigationLink's tap target
                        // onto the adjacent row. Eager layout keeps hit-testing aligned.
                        VStack(alignment: .leading, spacing: 12) {
                            ForEach(Array(sections.enumerated()), id: \.element.id) { index, section in
                                VStack(alignment: .leading, spacing: 12) {
                                    Text(section.title)
                                        .font(.system(size: 16, weight: .medium))
                                        .foregroundStyle(.white.opacity(0.42))
                                        .padding(.horizontal, 2)

                                    ForEach(section.places, id: \.listRowID) { place in
                                        NavigationLink(value: place) {
                                            PlaceRowView(place: place)
                                        }
                                        .buttonStyle(.plain)
                                    }
                                }
                                // The page header already has the shared 12pt stack gap
                                // before its first section. Keep the extra breathing room
                                // only between later alphabetical sections.
                                .padding(.top, index == 0 ? 0 : 6)
                            }
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 74)
                    .padding(.bottom, 48)
                }
                .overlay(alignment: .topLeading) {
                    topControls(for: response)
                        .padding(.horizontal, 16)
                        .padding(.top, 0)
                }
                .scrollIndicators(.hidden)
                .scrollDismissesKeyboard(.interactively)
                .background(venuesBackground)
            }
        }
    }

    private var venuesBackground: some View {
        AppTheme.background
            .ignoresSafeArea()
    }

    private func placesHeader(locationName: String?) -> some View {
        return (
            Text(selectedPlaceFilter.headerTitle)
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(.white)
            +
            (locationName.map { location in
                Text(" in \(location)")
                    .font(.system(size: 20, weight: .medium))
                    .foregroundStyle(.white.opacity(0.5))
            } ?? Text(""))
        )
    }

    private func placesHeaderMenu(for response: MobilePlacesResponse) -> some View {
        Menu {
            ForEach(availableLocationFilters(for: response)) { location in
                Button {
                    selectedLocationFilter = location
                } label: {
                    if location == effectiveLocationFilter(for: response) {
                        Label(location.title, systemImage: "checkmark")
                    } else {
                        Text(location.title)
                    }
                }
            }
        } label: {
            placesHeader(locationName: headerLocationName(for: response))
        }
        .buttonStyle(.plain)
    }

    private var selectedLocationName: String? {
        switch selectedLocationFilter {
        case .city(let city, _):
            return city
        default:
            return nil
        }
    }

    private func headerLocationName(for response: MobilePlacesResponse) -> String? {
        switch effectiveLocationFilter(for: response) {
        case .city(let city, _):
            return city
        case .all:
            return nil
        }
    }

    private func filterControls(for response: MobilePlacesResponse) -> some View {
        HStack(spacing: 10) {
            PlaceLeadingControls(
                selection: $selectedPlaceFilter,
                categories: availableCategoryFilters(for: response),
                selectedCategoryID: selectedCategoryID,
                onSelectCategory: { selectedCategoryID = $0 },
                onSearch: presentPlaceSearch,
                locationSelection: Binding(
                    get: { effectiveLocationFilter(for: response) },
                    set: { selectedLocationFilter = $0 }
                ),
                locations: availableLocationFilters(for: response),
                hasActiveLocationSelection: effectiveLocationFilter(for: response) != defaultLocationFilter(for: response)
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.bottom, 4)
    }

    private var loadingFilterControls: some View {
        HStack(spacing: 10) {
            PlaceLeadingControls(
                selection: .constant(.all),
                categories: [],
                selectedCategoryID: nil,
                onSelectCategory: { _ in },
                onSearch: presentPlaceSearch,
                locationSelection: .constant(.city(city: "Boston", state: "MA")),
                locations: [.city(city: "Boston", state: "MA")],
                hasActiveLocationSelection: false
            )
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.bottom, 4)
    }

    @ViewBuilder
    private func topControls(for response: MobilePlacesResponse?) -> some View {
        if isPlaceSearchPresented {
            placeSearchControls
        } else if let response {
            filterControls(for: response)
        } else {
            loadingFilterControls
        }
    }

    private var placeSearchControls: some View {
        HStack(spacing: 10) {
            HStack(spacing: 10) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 18, weight: .medium))
                    .foregroundStyle(.white.opacity(0.62))

                TextField("Search places...", text: $placeSearchText)
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(.white)
                    .textInputAutocapitalization(.never)
                    .autocorrectionDisabled()
                    .submitLabel(.search)
                    .focused($isPlaceSearchFocused)

                if !placeSearchText.isEmpty {
                    Button {
                        placeSearchText = ""
                    } label: {
                        Image(systemName: "xmark.circle.fill")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(.white.opacity(0.48))
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(.horizontal, 16)
            .frame(height: 46)
            .frame(maxWidth: .infinity)
            .contentShape(Capsule())
            .placeLiquidGlass(in: Capsule())

            FloatingGlassIconButton(systemImage: "xmark") {
                dismissPlaceSearch()
            }
        }
        .padding(.bottom, 4)
    }

    private func filteredPlaces(in response: MobilePlacesResponse) -> [PlaceListItem] {
        var seen = Set<String>()
        return response.places
            .filter(effectiveLocationFilter(for: response).includes)
            .filter(selectedPlaceFilter.includes)
            .filter(categoryFilterIncludes)
            .filter(matchesPlaceSearch)
            // Drop any duplicate rows so ForEach identities stay unique.
            .filter { seen.insert($0.listRowID).inserted }
    }

    private func groupedPlaces(in response: MobilePlacesResponse) -> [PlaceListSection] {
        Dictionary(
            grouping: filteredPlaces(in: response).sorted(by: sortPlaces),
            by: sectionTitle(for:)
        )
        .map { key, places in
            PlaceListSection(title: key, places: places)
        }
        .sorted(by: sortPlaceSections)
    }

    private func sortPlaces(_ lhs: PlaceListItem, _ rhs: PlaceListItem) -> Bool {
        let lhsName = lhs.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let rhsName = rhs.name.trimmingCharacters(in: .whitespacesAndNewlines)
        let comparison = lhsName.localizedCaseInsensitiveCompare(rhsName)

        if comparison != .orderedSame {
            return comparison == .orderedAscending
        }

        return lhs.listRowID < rhs.listRowID
    }

    private func sectionTitle(for place: PlaceListItem) -> String {
        let name = place.name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let first = name.first else {
            return "#"
        }

        let letter = String(first).uppercased()
        return letter.range(of: "[A-Z]", options: .regularExpression) != nil ? letter : "#"
    }

    private func sortPlaceSections(_ lhs: PlaceListSection, _ rhs: PlaceListSection) -> Bool {
        switch (lhs.title, rhs.title) {
        case ("#", "#"):
            return false
        case ("#", _):
            return false
        case (_, "#"):
            return true
        default:
            return lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
        }
    }

    private func availableLocationFilters(for response: MobilePlacesResponse) -> [PlaceLocationFilter] {
        var cityFilters = response.availableCities.reduce(into: [PlaceLocationFilter]()) { filters, city in
            let filter = PlaceLocationFilter.city(city: city.city, state: city.state)

            guard !filters.contains(filter) else {
                return
            }

            filters.append(filter)
        }
        .sorted { lhs, rhs in
            lhs.title.localizedCaseInsensitiveCompare(rhs.title) == .orderedAscending
        }

        let bostonFilter = PlaceLocationFilter.city(city: "Boston", state: "MA")
        if !cityFilters.contains(bostonFilter) {
            cityFilters.append(bostonFilter)
        }

        return cityFilters
    }

    private func effectiveLocationFilter(for response: MobilePlacesResponse) -> PlaceLocationFilter {
        let locations = availableLocationFilters(for: response)

        // Prefer the selection shared across tabs so the most recent city choice on any
        // page (Home / Places / Activity) wins here too — the tabs stay alive, so local
        // state would otherwise keep showing this page's own stale selection.
        if let sharedFilter = appSession.selectedCityContext.flatMap(PlaceLocationFilter.init),
           locations.contains(sharedFilter)
        {
            return sharedFilter
        }

        if let selectedLocationFilter, locations.contains(selectedLocationFilter) {
            return selectedLocationFilter
        }

        return defaultLocationFilter(for: response)
    }

    private func defaultLocationFilter(for response: MobilePlacesResponse) -> PlaceLocationFilter {
        let locations = availableLocationFilters(for: response)

        if let currentUserLocation = response.currentUserLocation {
            let userFilter = PlaceLocationFilter.city(
                city: currentUserLocation.city,
                state: currentUserLocation.state
            )

            if locations.contains(userFilter) {
                return userFilter
            }
        }

        return locations.first { location in
            guard case .city(let city, _) = location else {
                return false
            }

            return city.localizedCaseInsensitiveCompare("Boston") == .orderedSame
        } ?? .city(city: "Boston", state: "MA")
    }

    private func availableCategoryFilters(for response: MobilePlacesResponse) -> [PlaceCategoryFilter] {
        var counts: [String: Int] = [:]

        for place in response.places {
            for category in place.categories {
                counts[category, default: 0] += 1
            }
        }

        return counts.keys
            .sorted { lhs, rhs in
                categoryTitle(for: lhs, in: response).localizedCaseInsensitiveCompare(categoryTitle(for: rhs, in: response)) == .orderedAscending
            }
            .map { category in
                PlaceCategoryFilter(
                    id: category,
                    title: categoryTitle(for: category, in: response)
                )
            }
    }

    private func categoryTitle(for category: String, in response: MobilePlacesResponse) -> String {
        response.places
            .compactMap { $0.categoryLabels[category] }
            .first(where: { !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty })
            ?? category.capitalized
    }

    private func categoryFilterIncludes(_ place: PlaceListItem) -> Bool {
        guard let selectedCategoryID else {
            return true
        }

        return place.categories.contains(selectedCategoryID)
    }

    private func matchesPlaceSearch(_ place: PlaceListItem) -> Bool {
        let query = placeSearchText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !query.isEmpty else {
            return true
        }

        return [place.name, place.city, place.state]
            .compactMap { $0 }
            .contains { value in
                value.localizedCaseInsensitiveContains(query)
            }
    }

    private func presentPlaceSearch() {
        isPlaceSearchPresented = true

        Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(150))

            if isPlaceSearchPresented {
                isPlaceSearchFocused = true
            }
        }
    }

    private func dismissPlaceSearch() {
        isPlaceSearchFocused = false
        placeSearchText = ""
        isPlaceSearchPresented = false
    }

    private func resetFilters() {
        selectedLocationFilter = nil
        selectedPlaceFilter = .all
        selectedCategoryID = nil
    }
}

private extension PlaceLocationFilter {
    init?(_ context: SelectedCityContext) {
        switch context {
        case .all:
            self = .all
        case .city(let city, let state):
            self = .city(city: city, state: state)
        }
    }

    var selectedCityContext: SelectedCityContext? {
        switch self {
        case .all:
            return .all
        case .city(let city, let state):
            return .city(city: city, state: state)
        }
    }
}

private struct PlaceListSection: Identifiable {
    let title: String
    let places: [PlaceListItem]

    var id: String { title }
}

private enum PlaceLocationFilter: Hashable, Identifiable {
    case all
    case city(city: String, state: String)

    var id: String {
        switch self {
        case .all:
            return "all"
        case .city(let city, let state):
            return "\(city)|\(state)"
        }
    }

    var title: String {
        switch self {
        case .all:
            return "All Cities"
        case .city(let city, _):
            return city
        }
    }

    func includes(_ place: PlaceListItem) -> Bool {
        switch self {
        case .all:
            return true
        case .city(let city, let state):
            let placeCity = place.metroAreaCity ?? place.city
            let placeState = place.metroAreaState ?? place.state

            return placeCity?.localizedCaseInsensitiveCompare(city) == .orderedSame &&
                placeState?.localizedCaseInsensitiveCompare(state) == .orderedSame
        }
    }
}

private enum PlaceKindFilter: String, CaseIterable, Identifiable {
    case all
    case venues
    case organizers
    case following

    var id: String { rawValue }

    var title: String {
        switch self {
        case .all:
            return "All"
        case .venues:
            return "Venues"
        case .organizers:
            return "Organizers"
        case .following:
            return "Following"
        }
    }

    var headerTitle: String {
        switch self {
        case .all:
            return "Places"
        case .venues:
            return "Venues"
        case .organizers:
            return "Organizers"
        case .following:
            return "Following"
        }
    }

    func includes(_ place: PlaceListItem) -> Bool {
        switch self {
        case .all:
            return true
        case .venues:
            return place.type == .venue
        case .organizers:
            return place.type == .organizer
        case .following:
            return place.isFollowed
        }
    }
}

private struct PlaceKindFilterMenu: View {
    @Binding var selection: PlaceKindFilter
    let categories: [PlaceCategoryFilter]
    let selectedCategoryID: String?
    let onSelectCategory: (String?) -> Void
    var useCombinedStyle = false

    private var hasActiveFilters: Bool {
        selection != .all || selectedCategoryID != nil
    }

    var body: some View {
        Menu {
            Section("Places") {
                ForEach(PlaceKindFilter.allCases) { filter in
                    Button {
                        selection = filter
                    } label: {
                        if filter == selection {
                            Label(filter.title, systemImage: "checkmark")
                        } else {
                            Text(filter.title)
                        }
                    }
                }
            }

            if !categories.isEmpty {
                Section("Categories") {
                    Button {
                        onSelectCategory(nil)
                    } label: {
                        if selectedCategoryID == nil {
                            Label("All Categories", systemImage: "checkmark")
                        } else {
                            Text("All Categories")
                        }
                    }

                    ForEach(categories) { category in
                        Button {
                            onSelectCategory(selectedCategoryID == category.id ? nil : category.id)
                        } label: {
                            if selectedCategoryID == category.id {
                                Label(category.title, systemImage: "checkmark")
                            } else {
                                Text(category.title)
                            }
                        }
                    }
                }
            }
        } label: {
            Image(systemName: "line.3.horizontal.decrease")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(hasActiveFilters ? AppTheme.accentBlue : .primary)
                .frame(width: 46, height: 46)
                .contentShape(Rectangle())
                .modifier(PlaceStandaloneControlStyle(isStandalone: !useCombinedStyle))
        }
        .buttonStyle(.plain)
    }
}

private struct PlaceLeadingControls: View {
    @Binding var selection: PlaceKindFilter
    let categories: [PlaceCategoryFilter]
    let selectedCategoryID: String?
    let onSelectCategory: (String?) -> Void
    let onSearch: () -> Void
    @Binding var locationSelection: PlaceLocationFilter
    let locations: [PlaceLocationFilter]
    let hasActiveLocationSelection: Bool

    var body: some View {
        HStack(spacing: 0) {
            PlaceKindFilterMenu(
                selection: $selection,
                categories: categories,
                selectedCategoryID: selectedCategoryID,
                onSelectCategory: onSelectCategory,
                useCombinedStyle: true
            )

            Button(action: onSearch) {
                Image(systemName: "magnifyingglass")
                    .font(.system(size: 18, weight: .semibold))
                    .foregroundStyle(.primary)
                    .frame(width: 46, height: 46)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)

            PlaceCityFilterMenu(
                selection: $locationSelection,
                locations: locations,
                hasActiveSelection: hasActiveLocationSelection
            )
        }
        .frame(height: 46)
        .clipShape(Capsule())
        .placeLiquidGlass(in: Capsule())
        .shadow(color: .black.opacity(0.12), radius: 14, x: 0, y: 8)
    }
}

private struct PlaceCityFilterMenu: View {
    @Binding var selection: PlaceLocationFilter
    let locations: [PlaceLocationFilter]
    let hasActiveSelection: Bool

    var body: some View {
        Menu {
            ForEach(locations) { location in
                Button {
                    selection = location
                } label: {
                    if location == selection {
                        Label(location.title, systemImage: "checkmark")
                    } else {
                        Text(location.title)
                    }
                }
            }
        } label: {
            Image(systemName: "map")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(hasActiveSelection ? AppTheme.accentBlue : .primary)
                .frame(width: 46, height: 46)
                .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}

private struct PlaceCategoryFilter: Identifiable {
    let id: String
    let title: String
}

private struct PlaceStandaloneControlStyle: ViewModifier {
    let isStandalone: Bool

    @ViewBuilder
    func body(content: Content) -> some View {
        if isStandalone {
            content.placeLiquidGlass(in: Circle())
        } else {
            content
        }
    }
}

private struct PlaceMenuPillLabel: View {
    let title: String

    var body: some View {
        HStack(spacing: 10) {
            Text(title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.primary)
                .lineLimit(1)
                .minimumScaleFactor(0.78)

            Image(systemName: "chevron.down")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.primary.opacity(0.58))
        }
        .padding(.horizontal, 15)
        .frame(height: 46)
        .fixedSize(horizontal: true, vertical: false)
        .contentShape(Capsule())
        .placeLiquidGlass(in: Capsule())
    }
}

private extension View {
    @ViewBuilder
    func placeLiquidGlass<S: InsettableShape>(in shape: S) -> some View {
        if #available(iOS 26.1, *) {
            glassEffect(.regular.interactive(), in: shape)
        } else if #available(iOS 26.0, *) {
            glassEffect(.regular, in: shape)
        } else {
            background(.black.opacity(0.20), in: shape)
                .background(.ultraThinMaterial, in: shape)
                .overlay(
                    shape.strokeBorder(.white.opacity(0.18), lineWidth: 1)
                )
                .shadow(color: .black.opacity(0.22), radius: 16, x: 0, y: 8)
        }
    }
}

struct PlaceRowView: View {
    let place: PlaceListItem

    private let cardCornerRadius: CGFloat = 18
    private let logoSide: CGFloat = 84
    private let fallbackTint = Color(red: 0.11, green: 0.11, blue: 0.13)

    @State private var loadedLogo: UIImage?
    @State private var blurredLogo: UIImage?
    @State private var tint: Color?

    private var tintColor: Color { tint ?? fallbackTint }

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            HStack(alignment: .center, spacing: 12) {
                placeLogo

                VStack(alignment: .leading, spacing: 3) {
                    Text(place.name)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white)
                        .lineLimit(2)
                        .minimumScaleFactor(0.88)

                    if !place.locationText.isEmpty {
                        Text(place.locationText)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(Color(red: 0.55, green: 0.8, blue: 1.0))
                            .lineLimit(1)
                    }

                    if let eventCountText = place.eventCountText {
                        Text(eventCountText)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(.white.opacity(0.7))
                            .lineLimit(1)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .padding(9)
            .frame(height: 102, alignment: .topLeading)

            Text(place.type.displayName)
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(.white.opacity(0.5))
                .padding(.trailing, 9)
                .padding(.bottom, 9)
        }
        .frame(height: 102)
        .background { backdrop }
        .clipShape(RoundedRectangle(cornerRadius: cardCornerRadius, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: cardCornerRadius, style: .continuous)
                .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
        }
        .contentShape(RoundedRectangle(cornerRadius: cardCornerRadius, style: .continuous))
        .task(id: place.listRowID) {
            await loadLogo()
        }
    }

    // Dark tint sampled from the logo, with a heavily blurred, darkened copy of the
    // logo bloomed across the whole card — the same idea as the event detail hero's
    // artwork-derived backdrop, so the card glows with the place's own color.
    private var backdrop: some View {
        ZStack {
            tintColor

            if let blurredLogo {
                Image(uiImage: blurredLogo)
                    .resizable()
                    .scaledToFill()
                    .overlay(Color.black.opacity(0.30))
                    .overlay(tintColor.opacity(0.32))
            }
        }
    }

    private var placeLogo: some View {
        Group {
            if let loadedLogo {
                Image(uiImage: loadedLogo)
                    .resizable()
                    .scaledToFill()
            } else if place.displayLogoURL != nil {
                Rectangle().fill(.white.opacity(0.06))
            } else {
                logoPlaceholder
            }
        }
        .frame(width: logoSide, height: logoSide)
        .clipShape(RoundedRectangle(cornerRadius: 15, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 15, style: .continuous)
                .strokeBorder(Color.white.opacity(0.14), lineWidth: 1)
        )
        .shadow(color: .black.opacity(0.28), radius: 8, x: 0, y: 4)
    }

    private var logoPlaceholder: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.16, green: 0.18, blue: 0.24),
                    Color(red: 0.30, green: 0.22, blue: 0.32),
                    Color(red: 0.08, green: 0.08, blue: 0.09),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            Image(systemName: place.type == .venue ? "building.2" : "sparkles")
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(.white.opacity(0.72))
        }
    }

    private func loadLogo() async {
        guard let logoURL = place.displayLogoURL else {
            loadedLogo = nil
            blurredLogo = nil
            tint = nil
            return
        }

        if let cached = PlaceLogoCache.shared.entry(for: logoURL) {
            loadedLogo = cached.image
            blurredLogo = cached.blurred
            tint = cached.tint
            return
        }

        guard let image = await RemoteImagePipeline.shared.image(for: logoURL) else {
            return
        }

        // Sample the tint and build the blurred backdrop on a background task so the
        // first appearance of a row while scrolling doesn't hitch the main thread.
        let fallback = fallbackTint
        let entry = await Task.detached(priority: .userInitiated) { () -> PlaceLogoCache.Entry in
            let sampledTint = image.placeCardTintColor.map(Color.init(uiColor:)) ?? fallback
            let blurred = image.placeCardBlurredBackdrop()
            return PlaceLogoCache.Entry(image: image, blurred: blurred, tint: sampledTint)
        }.value

        PlaceLogoCache.shared.store(image: entry.image, blurred: entry.blurred, tint: entry.tint, for: logoURL)

        loadedLogo = entry.image
        blurredLogo = entry.blurred
        tint = entry.tint
    }
}

// Decoded logo + blurred backdrop + tint cached per URL so rows recycled during
// scrolling skip the CoreImage color sampling and blur.
private final class PlaceLogoCache {
    static let shared = PlaceLogoCache()

    struct Entry {
        let image: UIImage
        let blurred: UIImage?
        let tint: Color
    }

    private let cache: NSCache<NSURL, CacheBox> = {
        let cache = NSCache<NSURL, CacheBox>()
        cache.countLimit = 200
        return cache
    }()

    final class CacheBox {
        let entry: Entry
        init(_ entry: Entry) { self.entry = entry }
    }

    func entry(for url: URL) -> Entry? {
        cache.object(forKey: url as NSURL)?.entry
    }

    func store(image: UIImage, blurred: UIImage?, tint: Color, for url: URL) {
        cache.setObject(CacheBox(Entry(image: image, blurred: blurred, tint: tint)), forKey: url as NSURL)
    }
}

enum PlaceCardImageProcessing {
    static let context = CIContext(options: [.workingColorSpace: NSNull()])
}

extension UIImage {
    // Average color of the whole logo, adjusted into a dark, readable tint that
    // still reads as the logo's dominant color.
    var placeCardTintColor: UIColor? {
        guard let cgImage else { return nil }

        let ciImage = CIImage(cgImage: cgImage)
        let extent = ciImage.extent
        guard extent.width > 0, extent.height > 0 else { return nil }

        let filter = CIFilter.areaAverage()
        filter.inputImage = ciImage
        filter.extent = extent

        guard let outputImage = filter.outputImage else { return nil }

        var bitmap = [UInt8](repeating: 0, count: 4)
        PlaceCardImageProcessing.context.render(
            outputImage,
            toBitmap: &bitmap,
            rowBytes: 4,
            bounds: CGRect(x: 0, y: 0, width: 1, height: 1),
            format: .RGBA8,
            colorSpace: nil
        )

        return UIColor(
            red: CGFloat(bitmap[0]) / 255,
            green: CGFloat(bitmap[1]) / 255,
            blue: CGFloat(bitmap[2]) / 255,
            alpha: 1
        ).placeCardAdjusted()
    }

    // Small, heavily blurred copy of the logo used as the card's colored backdrop.
    func placeCardBlurredBackdrop() -> UIImage? {
        guard let cgImage else { return nil }

        let maxDimension: CGFloat = 120
        let scale = min(maxDimension / max(size.width, size.height), 1)
        let targetSize = CGSize(width: size.width * scale, height: size.height * scale)
        let renderer = UIGraphicsImageRenderer(size: targetSize)
        let thumbnail = renderer.image { _ in
            draw(in: CGRect(origin: .zero, size: targetSize))
        }

        guard let thumbnailCGImage = thumbnail.cgImage else { return nil }

        let inputImage = CIImage(cgImage: thumbnailCGImage)
        let clampedImage = inputImage.clampedToExtent()
        let filter = CIFilter.gaussianBlur()
        filter.inputImage = clampedImage
        filter.radius = 30

        guard let outputImage = filter.outputImage else { return thumbnail }

        guard let blurredCGImage = PlaceCardImageProcessing.context.createCGImage(
            outputImage,
            from: inputImage.extent
        ) else {
            return thumbnail
        }

        return UIImage(cgImage: blurredCGImage, scale: thumbnail.scale, orientation: thumbnail.imageOrientation)
    }
}

extension UIColor {
    // Keep the sampled hue but cap brightness so white text stays readable and dark
    // logos still fade into a color that matches their background.
    func placeCardAdjusted() -> UIColor {
        var hue: CGFloat = 0
        var saturation: CGFloat = 0
        var brightness: CGFloat = 0
        var alpha: CGFloat = 0

        guard getHue(&hue, saturation: &saturation, brightness: &brightness, alpha: &alpha) else {
            return self
        }

        return UIColor(
            hue: hue,
            saturation: min(max(saturation * 0.9, 0), 0.9),
            brightness: min(max(brightness, 0), 0.34),
            alpha: 1
        )
    }
}

#Preview {
    VenuesView()
}
