import CoreImage
import CoreImage.CIFilterBuiltins
import SafariServices
import SwiftUI
import UIKit

struct PlaceDetailView: View {
    let place: PlaceListItem
    var onDismiss: (() -> Void)? = nil

    @Environment(\.apiClient) private var apiClient
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel = PlaceDetailViewModel()
    @State private var selectedTab: PlaceEventsTab = .upcoming
    @State private var presentedAction: PlaceDetailAction?
    @State private var isUnfollowConfirmationPresented = false
    @State private var blurredLogo: UIImage?
    @State private var logoTint: Color?

    private let topWashHeight: CGFloat = 460

    // Grows the tinted wash this far above the top edge (matching the event hero) so
    // overscrolling past the top keeps showing a continuous fade, never a hard cutoff.
    private let overscrollExtension: CGFloat = 500

    private let eventCardWidth: CGFloat = 220

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 22) {
                    switch viewModel.state {
                    case .idle, .loading:
                        let seededDetail = seededDetailState

                        PlaceDetailHeader(
                            name: seededDetail.name,
                            type: seededDetail.type,
                            logoURL: seededDetail.displayLogoURL,
                            cityStateText: seededDetail.cityStateText,
                            mapsQueryText: seededDetail.locationText,
                            categoryLabel: seededDetail.primaryCategoryLabel,
                            websiteURL: seededDetail.website,
                            instagramHandle: seededDetail.instagram
                        )

                        PlaceDetailEventSkeletonSection(cardWidth: eventCardWidth)

                    case .failed(let message):
                        let seededDetail = seededDetailState

                        PlaceDetailHeader(
                            name: seededDetail.name,
                            type: seededDetail.type,
                            logoURL: seededDetail.displayLogoURL,
                            cityStateText: seededDetail.cityStateText,
                            mapsQueryText: seededDetail.locationText,
                            categoryLabel: seededDetail.primaryCategoryLabel,
                            websiteURL: seededDetail.website,
                            instagramHandle: seededDetail.instagram
                        )

                        ContentUnavailableView {
                            Label("Couldn’t Load Place", systemImage: "wifi.exclamationmark")
                        } description: {
                            Text(message)
                        } actions: {
                            Button("Try Again") {
                                Task {
                                    await viewModel.load(slug: place.slug, using: apiClient)
                                }
                            }
                        }
                        .foregroundStyle(.white)

                    case .loaded(let detail):
                        PlaceDetailHeader(
                            name: detail.name,
                            type: detail.type,
                            logoURL: detail.displayLogoURL,
                            cityStateText: detail.cityStateText,
                            mapsQueryText: detail.locationText,
                            categoryLabel: detail.primaryCategoryLabel,
                            websiteURL: detail.website,
                            instagramHandle: detail.instagram
                        )

                        eventGroups(for: detail)
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 18)
                .padding(.bottom, 48)
                .frame(maxWidth: .infinity, alignment: .topLeading)
                .background(alignment: .top) {
                    topColorWash(safeAreaTop: proxy.safeAreaInsets.top)
                }
            }
            .background(AppTheme.background.ignoresSafeArea())
        }
        .background {
            // When embedded over an event, UIKit's native pop gesture targets the
            // event presentation underneath this page. The host supplies a local
            // edge swipe instead.
            if onDismiss == nil {
                SwipeBackEnabler()
            }
        }
        .navigationBarBackButtonHidden()
        .toolbar(.hidden, for: .navigationBar)
        .overlay(alignment: .topLeading) {
            leadingTopControls
        }
        .overlay(alignment: .topTrailing) {
            HStack(spacing: 10) {
                if case .loaded(let detail) = viewModel.state, detail.canManage {
                    FloatingGlassIconButton(systemImage: "square.and.pencil") {
                        presentedAction = .edit
                    }
                }

                if case .loaded(let detail) = viewModel.state, detail.canManage {
                    PlaceCreationMenuButton { action in
                        presentedAction = action
                    }
                }

                if case .loaded(let detail) = viewModel.state {
                    followButton(
                        isFollowed: detail.isFollowed,
                        isDisabled: viewModel.isUpdatingFollow
                    ) {
                        UIImpactFeedbackGenerator(style: .light).impactOccurred()

                        if detail.isFollowed {
                            isUnfollowConfirmationPresented = true
                        } else {
                            Task {
                                await viewModel.setFollowed(
                                    true,
                                    slug: detail.slug,
                                    using: apiClient
                                )
                            }
                        }
                    }
                }
            }
            .padding(.trailing, 16)
            .padding(.top, 0)
        }
        .alert(unfollowAlertTitle, isPresented: $isUnfollowConfirmationPresented) {
            if case .loaded(let detail) = viewModel.state {
                Button("Unfollow", role: .destructive) {
                    Task {
                        await viewModel.setFollowed(
                            false,
                            slug: detail.slug,
                            using: apiClient
                        )
                    }
                }
            }

            Button("Cancel", role: .cancel) {}
        } message: {
            Text("Are you sure you want to unfollow?")
        }
        .sheet(item: $presentedAction) { action in
            if case .loaded(let detail) = viewModel.state {
                switch action {
                case .edit:
                    MobilePlaceCreationView(
                        mode: .edit(detail),
                        onCompleted: {
                            Task {
                                PlaceDetailViewModel.invalidateCache(for: detail.slug)
                                await viewModel.load(slug: detail.slug, using: apiClient, forceRefresh: true)
                            }
                        },
                        onDeleted: {
                            dismiss()
                        }
                    )
                case .createEvent:
                    MobileEventCreationView(mode: .create, preselectedPlace: detail) { _ in
                        Task {
                            PlaceDetailViewModel.invalidateCache(for: detail.slug)
                            await viewModel.load(slug: detail.slug, using: apiClient, forceRefresh: true)
                        }
                    }
                case .createEventSeries:
                    MobileEventCreationView(
                        mode: .create,
                        creationKind: .eventSeries,
                        preselectedPlace: detail,
                        onSeriesCompleted: {
                            Task {
                                PlaceDetailViewModel.invalidateCache(for: detail.slug)
                                await viewModel.load(slug: detail.slug, using: apiClient, forceRefresh: true)
                            }
                        }
                    )
                }
            }
        }
        .task {
            if case .idle = viewModel.state {
                await viewModel.load(slug: place.slug, using: apiClient)
            }
        }
        .task(id: currentLogoURL) {
            await loadLogoArtwork()
        }
        .task(id: placeEventPrefetchKey) {
            guard case .loaded(let detail) = viewModel.state else {
                return
            }

            await EventArtworkPrefetcher.prefetch(
                events: detail.events + detail.pastEvents
            )
        }
        .onReceive(NotificationCenter.default.publisher(for: .mobileEventDidChange)) { _ in
            Task {
                PlaceDetailViewModel.invalidateCache(for: place.slug)
                await viewModel.load(slug: place.slug, using: apiClient, forceRefresh: true)
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .appDataDidChange)) { _ in
            Task {
                PlaceDetailViewModel.invalidateCache(for: place.slug)
                await viewModel.load(slug: place.slug, using: apiClient, forceRefresh: true)
            }
        }
    }

    private var leadingTopControls: some View {
        HStack(spacing: 10) {
            FloatingGlassIconButton(systemImage: "chevron.left") {
                closePlaceDetail()
            }

            if canShowEventFilter {
                PlaceEventFilterDropdown(selection: $selectedTab)
            }
        }
        .padding(.leading, 16)
        .padding(.top, 0)
    }

    private func closePlaceDetail() {
        if let onDismiss {
            onDismiss()
        } else {
            dismiss()
        }
    }

    private var seededDetailState: PlaceDetail {
        PlaceDetailViewModel.cachedDetail(for: place.slug) ?? PlaceDetail(listItem: place)
    }

    private struct PlaceCreationMenuButton: View {
        let onSelect: (PlaceDetailAction) -> Void

        var body: some View {
            Menu {
                Button {
                    onSelect(.createEvent)
                } label: {
                    Label("Create Event", systemImage: "calendar.badge.plus")
                }

                Button {
                    onSelect(.createEventSeries)
                } label: {
                    Label("Create Event Series", systemImage: "calendar.badge.clock")
                }
            } label: {
                Image(systemName: "plus")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.primary)
                    .frame(width: 46, height: 46)
                    .contentShape(Circle())
                    .placeDetailLiquidGlass(in: Circle())
            }
            .buttonStyle(.plain)
        }
    }

    private enum PlaceDetailAction: String, Identifiable {
        case edit
        case createEvent
        case createEventSeries

        var id: String { rawValue }
    }

    private var canShowEventFilter: Bool {
        guard case .loaded(let detail) = viewModel.state else {
            return false
        }

        return !detail.pastEvents.isEmpty
    }

    private var placeEventPrefetchKey: String {
        guard case .loaded(let detail) = viewModel.state else {
            return "idle"
        }

        return (detail.events + detail.pastEvents)
            .map(\.id.uuidString)
            .joined(separator: ",")
    }

    private var unfollowAlertTitle: String {
        if case .loaded(let detail) = viewModel.state {
            return "Unfollow \(detail.name)?"
        }

        return "Unfollow \(place.name)?"
    }

    private func followButton(
        isFollowed: Bool,
        isDisabled: Bool,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            Text(isFollowed ? "Following" : "Follow")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(isFollowed ? .white : .black)
                .padding(.horizontal, 20)
                .frame(height: 46)
                .contentShape(Capsule())
                .background {
                    if !isFollowed {
                        Capsule()
                            .fill(.white)
                    }
                }
                .placeDetailLiquidGlass(in: Capsule())
        }
        .buttonStyle(.plain)
        .disabled(isDisabled)
        .opacity(isDisabled ? 0.72 : 1)
    }

    private struct PlaceEventFilterDropdown: View {
        @Binding var selection: PlaceEventsTab

        var body: some View {
            Menu {
                ForEach(PlaceEventsTab.allCases) { tab in
                    Button {
                        withAnimation(.snappy(duration: 0.22)) {
                            selection = tab
                        }
                    } label: {
                        if tab == selection {
                            Label(tab.title, systemImage: "checkmark")
                        } else {
                            Text(tab.title)
                        }
                    }
                }
            } label: {
                PlaceEventFilterIcon(isActive: selection != .upcoming)
            }
            .buttonStyle(.plain)
        }
    }

    private struct PlaceEventFilterIcon: View {
        let isActive: Bool

        var body: some View {
            Image(systemName: "line.3.horizontal.decrease")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(isActive ? AppTheme.accentBlue : .primary)
                .frame(width: 46, height: 46)
                .contentShape(Circle())
                .placeDetailLiquidGlass(in: Circle())
        }
    }

    @ViewBuilder
    private func eventGroups(for detail: PlaceDetail) -> some View {
        let events = selectedTab == .upcoming ? detail.events : detail.pastEvents
        let groups = PlaceEventGrouper.groups(for: events, mode: selectedTab)

        if groups.isEmpty {
            ProfileEmptyEventsPlaceholder(
                message: "There aren’t any \(selectedTab.emptyStateName) events for this place yet."
            )
            .frame(maxWidth: .infinity, minHeight: 220)
        } else {
            VStack(alignment: .leading, spacing: 18) {
                ForEach(groups) { group in
                    EventCardCarousel(
                        events: group.events,
                        cardWidth: eventCardWidth,
                        verticalSpacing: 14
                    ) {
                        Text(group.label)
                            .font(.system(size: 20, weight: .bold))
                            .foregroundStyle(.white)
                    } card: { event in
                        EventDetailNavigationLink(event: event) {
                            EventCardView(event: event)
                        }
                    }
                    .padding(.horizontal, -16)
                }
            }
        }
    }

    // A blurred bloom of the logo tinted with its dominant color, filling the top of
    // the page and dissolving into the black app background — the same artwork-derived
    // treatment as the place cards, giving the page a little color up top.
    //
    // Like the event hero, the whole wash is grown upward beyond the top edge (a solid
    // color region above the visible fade) so overscrolling past the top keeps showing
    // a continuous fade instead of a hard cutoff at the card edge.
    private func topColorWash(safeAreaTop: CGFloat) -> some View {
        let tint = logoTint ?? .clear
        // Solid region from `overscrollExtension` above the device top down to the top
        // edge; then the visible fade over the same region it always occupied.
        let solidHeight = overscrollExtension
        let visibleFadeHeight = topWashHeight + safeAreaTop

        return ZStack {
            tint

            if let blurredLogo {
                VStack(spacing: 0) {
                    Image(uiImage: blurredLogo)
                        .resizable()
                        .scaledToFill()
                        .frame(maxWidth: .infinity)
                        .frame(height: solidHeight + visibleFadeHeight)
                        .clipped()
                        .overlay(Color.black.opacity(0.32))
                        .overlay(tint.opacity(0.34))

                    Spacer(minLength: 0)
                }
            }
        }
        .frame(maxWidth: .infinity)
        .mask(
            VStack(spacing: 0) {
                // Solid through the overscroll region so pulling past the top stays filled.
                Color.white
                    .frame(height: solidHeight)

                LinearGradient(
                    stops: [
                        .init(color: .white, location: 0.0),
                        .init(color: .white.opacity(0.7), location: 0.45),
                        .init(color: .white.opacity(0.25), location: 0.75),
                        .init(color: .clear, location: 1.0),
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: visibleFadeHeight)

                Color.clear
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        )
        .padding(.top, -(overscrollExtension + safeAreaTop))
    }

    private var currentLogoURL: URL? {
        if case .loaded(let detail) = viewModel.state {
            return detail.displayLogoURL
        }

        return place.displayLogoURL
    }

    private func loadLogoArtwork() async {
        guard let url = currentLogoURL else {
            blurredLogo = nil
            logoTint = nil
            return
        }

        guard let image = await RemoteImagePipeline.shared.image(for: url) else {
            return
        }

        // CoreImage sampling + blur off the main thread.
        let processed = await Task.detached(priority: .userInitiated) { () -> (UIImage?, Color?) in
            let tint = image.placeDetailTintColor.map(Color.init(uiColor:))
            let blurred = image.placeDetailBlurredBackdrop()
            return (blurred, tint)
        }.value

        blurredLogo = processed.0
        logoTint = processed.1
    }
}

private enum PlaceDetailImageProcessing {
    static let context = CIContext(options: [.workingColorSpace: NSNull()])
}

private extension UIImage {
    // Average color of the logo, adjusted into a dark, tasteful tint for the top wash.
    var placeDetailTintColor: UIColor? {
        guard let cgImage else { return nil }

        let ciImage = CIImage(cgImage: cgImage)
        let extent = ciImage.extent
        guard extent.width > 0, extent.height > 0 else { return nil }

        let filter = CIFilter.areaAverage()
        filter.inputImage = ciImage
        filter.extent = extent

        guard let outputImage = filter.outputImage else { return nil }

        var bitmap = [UInt8](repeating: 0, count: 4)
        PlaceDetailImageProcessing.context.render(
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
        ).placeDetailAdjusted()
    }

    // Small, heavily blurred copy of the logo used as the top backdrop bloom.
    func placeDetailBlurredBackdrop() -> UIImage? {
        guard let cgImage else { return nil }

        let maxDimension: CGFloat = 160
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
        filter.radius = 40

        guard let outputImage = filter.outputImage else { return thumbnail }

        guard let blurredCGImage = PlaceDetailImageProcessing.context.createCGImage(
            outputImage,
            from: inputImage.extent
        ) else {
            return thumbnail
        }

        return UIImage(cgImage: blurredCGImage, scale: thumbnail.scale, orientation: thumbnail.imageOrientation)
    }
}

private extension UIColor {
    // Keep the sampled hue but darken so the top wash reads as a subtle tint that
    // keeps the white header text readable before it fades to black.
    func placeDetailAdjusted() -> UIColor {
        var hue: CGFloat = 0
        var saturation: CGFloat = 0
        var brightness: CGFloat = 0
        var alpha: CGFloat = 0

        guard getHue(&hue, saturation: &saturation, brightness: &brightness, alpha: &alpha) else {
            return self
        }

        return UIColor(
            hue: hue,
            saturation: min(max(saturation * 0.9, 0), 0.85),
            brightness: min(max(brightness, 0), 0.36),
            alpha: 1
        )
    }
}

private struct PlaceDetailEventSkeletonSection: View {
    let cardWidth: CGFloat

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(Color.white.opacity(0.10))
                .frame(width: 148, height: 26)

            ScrollView(.horizontal) {
                HStack(alignment: .top, spacing: 12) {
                    ForEach(0 ..< 3, id: \.self) { index in
                        PlaceDetailEventSkeletonCard(seed: index)
                            .frame(width: cardWidth)
                    }
                }
                .scrollTargetLayout()
            }
            .scrollIndicators(.hidden)
            .contentMargins(.horizontal, 16, for: .scrollContent)
            .scrollTargetBehavior(.viewAligned)
            .allowsHitTesting(false)
            .padding(.horizontal, -16)
        }
    }
}

private struct PlaceDetailEventSkeletonCard: View {
    let seed: Int
    @State private var isHighlighted = false
    private let cardHeight: CGFloat = 286
    private let cardCornerRadius: CGFloat = 18

    var body: some View {
        RoundedRectangle(cornerRadius: cardCornerRadius, style: .continuous)
            .fill(Color.white.opacity(0.04))
            .overlay {
                RoundedRectangle(cornerRadius: cardCornerRadius, style: .continuous)
                    .fill(shimmerFill)
            }
            .frame(maxWidth: .infinity, minHeight: cardHeight, maxHeight: cardHeight, alignment: .topLeading)
        .onAppear {
            withAnimation(
                .easeInOut(duration: 1.15)
                .repeatForever(autoreverses: true)
                .delay(Double(seed) * 0.08)
            ) {
                isHighlighted = true
            }
        }
    }

    private var shimmerFill: LinearGradient {
        LinearGradient(
            colors: [
                Color.white.opacity(isHighlighted ? 0.10 : 0.05),
                Color.white.opacity(isHighlighted ? 0.18 : 0.09),
                Color.white.opacity(isHighlighted ? 0.10 : 0.05),
            ],
            startPoint: .topLeading,
            endPoint: .bottomTrailing
        )
    }
}

private struct PlaceDetailHeader: View {
    let name: String
    let type: PlaceListItem.PlaceType
    let logoURL: URL?
    let cityStateText: String?
    let mapsQueryText: String?
    let categoryLabel: String?
    let websiteURL: URL?
    let instagramHandle: String?
    @State private var isMapsDialogPresented = false
    @State private var safariRoute: SafariRoute?
    @State private var isImageViewerPresented = false

    var body: some View {
        VStack(spacing: 12) {
            logo
            .padding(.top, 64)

            VStack(spacing: 3) {
                Text(name)
                    .font(.system(size: 22, weight: .bold))
                    .foregroundStyle(.white)
                    .lineLimit(3)
                    .minimumScaleFactor(0.76)
                    .fixedSize(horizontal: false, vertical: true)
                    .multilineTextAlignment(.center)

                HStack(alignment: .center, spacing: 12) {
                    Group {
                        if let cityStateText {
                            Text(cityStateText)
                        } else if let categoryLabel {
                            Text(categoryLabel)
                        }
                    }
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.white.opacity(0.56))
                    .lineLimit(2)
                    .minimumScaleFactor(0.78)
                    .fixedSize(horizontal: false, vertical: true)
                }
            }
            .frame(maxWidth: .infinity)

            HStack(alignment: .center, spacing: 12) {
                if mapsQueryText != nil {
                    PlaceDetailActionCircleButton {
                    Image(systemName: "location")
                        .font(.system(size: 18, weight: .semibold))
                        .foregroundStyle(.white)
                    } action: {
                        isMapsDialogPresented = true
                    }
                    .confirmationDialog("Open Location", isPresented: $isMapsDialogPresented) {
                        if let mapsQueryText {
                            Button("Open in Maps") {
                                openInMaps(address: mapsQueryText)
                            }
                        }

                        Button("Cancel", role: .cancel) {}
                    } message: {
                        if let mapsQueryText {
                            Text(mapsQueryText)
                        }
                    }
                }

                if let websiteURL {
                    PlaceDetailActionCircleButton {
                        Image(systemName: "globe")
                            .font(.system(size: 18, weight: .semibold))
                            .foregroundStyle(.white)
                    } action: {
                        safariRoute = SafariRoute(url: websiteURL)
                    }
                }

                if let instagramURL {
                    PlaceDetailActionCircleButton {
                        InstagramGlyph()
                    } action: {
                        openInstagram(url: instagramURL)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity)
        .sheet(item: $safariRoute) { route in
            SafariView(url: route.url)
                .ignoresSafeArea()
        }
        .fullScreenCover(isPresented: $isImageViewerPresented) {
            if let logoURL {
                EventArtworkViewer(imageURL: logoURL)
            }
        }
    }

    @ViewBuilder
    private var logo: some View {
        if let logoURL {
            Button {
                isImageViewerPresented = true
            } label: {
                RemoteImageView(url: logoURL) { image in
                    image
                        .resizable()
                        .scaledToFill()
                } placeholder: {
                    logoPlaceholder
                }
                .frame(width: 104, height: 104)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(.white.opacity(0.08), lineWidth: 1)
                )
            }
            .buttonStyle(.plain)
        } else {
            logoPlaceholder
                .frame(width: 104, height: 104)
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(.white.opacity(0.08), lineWidth: 1)
                )
        }
    }

    private var logoPlaceholder: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color(red: 0.14, green: 0.14, blue: 0.16))

            Image(systemName: type == .venue ? "building.2" : "sparkles")
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(.white.opacity(0.70))
        }
    }

    private func openInMaps(address: String) {
        guard let encodedAddress = address.addingPercentEncoding(withAllowedCharacters: .urlQueryAllowed),
              let url = URL(string: "http://maps.apple.com/?q=\(encodedAddress)")
        else {
            return
        }

        UIApplication.shared.open(url)
    }

    private var instagramURL: URL? {
        guard let handle = cleanedInstagramHandle else {
            return nil
        }

        return URL(string: "instagram://user?username=\(handle)")
            ?? URL(string: "https://www.instagram.com/\(handle)")
    }

    private var cleanedInstagramHandle: String? {
        guard let instagramHandle else {
            return nil
        }

        let trimmed = instagramHandle
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: "@", with: "")
        return trimmed.isEmpty ? nil : trimmed
    }

    private func openInstagram(url: URL) {
        if UIApplication.shared.canOpenURL(url) {
            UIApplication.shared.open(url)
            return
        }

        if let handle = cleanedInstagramHandle,
           let webURL = URL(string: "https://www.instagram.com/\(handle)") {
            UIApplication.shared.open(webURL)
        }
    }
}

private struct PlaceDetailActionCircleButton<Content: View>: View {
    let content: Content
    let action: () -> Void

    init(
        @ViewBuilder content: () -> Content,
        action: @escaping () -> Void
    ) {
        self.content = content()
        self.action = action
    }

    var body: some View {
        Button(action: action) {
            content
                .frame(width: 46, height: 46)
                .contentShape(Circle())
                .placeDetailLiquidGlass(in: Circle())
        }
        .buttonStyle(.plain)
    }
}

private struct InstagramGlyph: View {
    private let side: CGFloat = 22

    var body: some View {
        let lineWidth = side * 0.09

        // Camera body
        RoundedRectangle(cornerRadius: side * 0.28, style: .continuous)
            .strokeBorder(.white, lineWidth: lineWidth)
            .frame(width: side, height: side)
            .overlay {
                // Lens
                Circle()
                    .strokeBorder(.white, lineWidth: lineWidth)
                    .frame(width: side * 0.42, height: side * 0.42)
            }
            .overlay(alignment: .topTrailing) {
                // Flash — spaced between the lens and the outer square, touching neither
                Circle()
                    .fill(.white)
                    .frame(width: side * 0.10, height: side * 0.10)
                    .padding(.top, side * 0.23)
                    .padding(.trailing, side * 0.23)
            }
    }
}

private struct SafariRoute: Identifiable {
    let id = UUID()
    let url: URL
}

private struct SafariView: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        SFSafariViewController(url: url)
    }

    func updateUIViewController(_ uiViewController: SFSafariViewController, context: Context) {}
}

private enum PlaceEventsTab: CaseIterable, Identifiable {
    case upcoming
    case past

    var id: Self { self }

    var title: String {
        switch self {
        case .upcoming:
            return "Upcoming Events"
        case .past:
            return "Past Events"
        }
    }

    var emptyStateName: String {
        switch self {
        case .upcoming:
            return "upcoming"
        case .past:
            return "past"
        }
    }
}

private struct PlaceEventGroup: Identifiable {
    let label: String
    var events: [EventFeedItem]

    var id: String { label }
}

private enum PlaceEventGrouper {
    static func groups(for events: [EventFeedItem], mode: PlaceEventsTab) -> [PlaceEventGroup] {
        let sortedEvents = events.sorted {
            mode == .past ? $0.startAt > $1.startAt : $0.startAt < $1.startAt
        }

        return sortedEvents.reduce(into: [PlaceEventGroup]()) { groups, event in
            let label = label(for: event, mode: mode)

            if let lastIndex = groups.indices.last, groups[lastIndex].label == label {
                groups[lastIndex].events.append(event)
            } else {
                groups.append(PlaceEventGroup(label: label, events: [event]))
            }
        }
    }

    private static func label(for event: EventFeedItem, mode: PlaceEventsTab) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = event.displayTimeZone
        calendar.firstWeekday = 2
        let now = Date()
        let currentWeekStart = calendar.dateInterval(of: .weekOfYear, for: now)?.start ?? now
        let eventWeekStart = calendar.dateInterval(of: .weekOfYear, for: event.startAt)?.start ?? event.startAt
        let currentMonthStart = calendar.dateInterval(of: .month, for: now)?.start ?? now
        let eventMonthStart = calendar.dateInterval(of: .month, for: event.startAt)?.start ?? event.startAt

        let weekDifference = calendar.dateComponents(
            [.weekOfYear],
            from: currentWeekStart,
            to: eventWeekStart
        ).weekOfYear ?? 0
        let monthDifference = calendar.dateComponents(
            [.month],
            from: currentMonthStart,
            to: eventMonthStart
        ).month ?? 0
        let weeksFromNow = abs(weekDifference)
        let monthsFromNow = abs(monthDifference)

        if weeksFromNow <= 3 {
            return mode == .past
                ? pastWeekLabel(weeksAgo: weeksFromNow)
                : weekLabel(weeksAway: weeksFromNow)
        }

        return mode == .past
            ? pastMonthLabel(monthsAgo: monthsFromNow)
            : monthLabel(monthsAway: monthsFromNow)
    }

    private static func weekLabel(weeksAway: Int) -> String {
        if weeksAway <= 0 { return "This Week" }
        if weeksAway == 1 { return "Next Week" }
        return "In \(weeksAway) Weeks"
    }

    private static func monthLabel(monthsAway: Int) -> String {
        if monthsAway <= 1 { return "Next Month" }
        return "In \(monthsAway) Months"
    }

    private static func pastWeekLabel(weeksAgo: Int) -> String {
        if weeksAgo <= 1 { return "Last Week" }
        return "\(weeksAgo) Weeks Ago"
    }

    private static func pastMonthLabel(monthsAgo: Int) -> String {
        if monthsAgo <= 1 { return "Last Month" }
        return "\(monthsAgo) Months Ago"
    }
}

#Preview {
    PlaceDetailView(
        place: PlaceListItem(
            id: UUID(),
            type: .venue,
            slug: "big-night-live",
            name: "Big Night Live",
            logoImageURL: nil,
            address: nil,
            city: "Boston",
            state: "MA",
            website: nil,
            instagram: nil,
            upcomingEventCount: 48,
            updatedAt: nil
        )
    )
}

extension View {
    @ViewBuilder
    func placeDetailLiquidGlass<S: InsettableShape>(in shape: S) -> some View {
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
