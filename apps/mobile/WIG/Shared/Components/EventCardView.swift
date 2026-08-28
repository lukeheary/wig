import ClerkKit
import CoreImage
import CoreImage.CIFilterBuiltins
import SwiftUI
import UIKit

private struct EventDetailTransitionNamespaceKey: EnvironmentKey {
    static let defaultValue: Namespace.ID? = nil
}

private struct EventDetailPresentationActionKey: EnvironmentKey {
    static let defaultValue: ((EventFeedItem, UUID?) -> Void)? = nil
}

extension EnvironmentValues {
    var eventDetailTransitionNamespace: Namespace.ID? {
        get { self[EventDetailTransitionNamespaceKey.self] }
        set { self[EventDetailTransitionNamespaceKey.self] = newValue }
    }

    var eventDetailPresentationAction: ((EventFeedItem, UUID?) -> Void)? {
        get { self[EventDetailPresentationActionKey.self] }
        set { self[EventDetailPresentationActionKey.self] = newValue }
    }
}

// Event details are presented by MainTabView above the entire tab hierarchy. The
// card remains mounted below that overlay, so the native tab bar is already present
// when the reverse zoom begins instead of being rebuilt after a navigation pop.
struct EventDetailNavigationLink<Label: View>: View {
    let event: EventFeedItem
    let preloadsRSVP: Bool
    let onOpen: (EventFeedItem) -> Void
    private let label: Label

    @Environment(Clerk.self) private var clerk
    @Environment(\.apiClient) private var apiClient
    @Environment(\.eventDetailTransitionNamespace) private var transitionNamespace
    @Environment(\.eventDetailPresentationAction) private var presentationAction
    @EnvironmentObject private var appSession: AppSession
    @State private var transitionSourceID = UUID()

    init(
        event: EventFeedItem,
        preloadsRSVP: Bool = false,
        onOpen: @escaping (EventFeedItem) -> Void = { _ in },
        @ViewBuilder label: () -> Label
    ) {
        self.event = event
        self.preloadsRSVP = preloadsRSVP
        self.onOpen = onOpen
        self.label = label()
    }

    var body: some View {
        Button {
            if preloadsRSVP, let userID = clerk.user?.id {
                Task {
                    await EventRSVPPrefetchCache.preload(
                        eventID: event.id,
                        userID: userID,
                        using: apiClient
                    )
                    openEvent()
                }
            } else {
                openEvent()
            }
        } label: {
            source
        }
        .buttonStyle(.plain)
    }

    private func openEvent() {
        AppAnalytics.log(.selectContent, [
            "content_type": "event",
            "source": "event_card",
        ])
        onOpen(event)
        let sourceID = transitionNamespace == nil ? nil : transitionSourceID

        if let presentationAction {
            presentationAction(event, sourceID)
        } else {
            appSession.presentEventDetail(event, transitionSourceID: sourceID)
        }
    }

    @ViewBuilder
    private var source: some View {
        if #available(iOS 18.0, *), let transitionNamespace {
            label.matchedTransitionSource(id: transitionSourceID, in: transitionNamespace)
        } else {
            label
        }
    }
}

struct EventCardCarousel<Header: View, Card: View>: View {
    let events: [EventFeedItem]
    let cardWidth: CGFloat
    let verticalSpacing: CGFloat
    let snapsToCards: Bool
    let showsCounter: Bool
    private let header: Header
    private let headerTrailing: AnyView?
    private let card: (EventFeedItem) -> Card

    @State private var currentEventID: UUID?
    @State private var isCountVisible = false
    @State private var isNativeScrollActive = false
    @State private var isLastEventVisible = false
    @State private var hideCountTask: Task<Void, Never>?

    init(
        events: [EventFeedItem],
        cardWidth: CGFloat,
        verticalSpacing: CGFloat = 12,
        snapsToCards: Bool = true,
        showsCounter: Bool = true,
        headerTrailing: AnyView? = nil,
        @ViewBuilder header: () -> Header,
        @ViewBuilder card: @escaping (EventFeedItem) -> Card
    ) {
        self.events = events
        self.cardWidth = cardWidth
        self.verticalSpacing = verticalSpacing
        self.snapsToCards = snapsToCards
        self.showsCounter = showsCounter
        self.header = header()
        self.headerTrailing = headerTrailing
        self.card = card
        _currentEventID = State(initialValue: events.first?.id)
    }

    var body: some View {
        VStack(alignment: .leading, spacing: verticalSpacing) {
            HStack(alignment: .center, spacing: 12) {
                Button(action: scrollToStart) {
                    header
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityHint("Scrolls this event row to the first event")

                Spacer(minLength: 8)

                if showsCounter {
                    Text("\(currentEventNumber) / \(events.count)")
                        .font(.system(size: 13, weight: .medium))
                        .monospacedDigit()
                        .foregroundStyle(.white.opacity(0.52))
                        .opacity(isCountVisible && events.count > 1 ? 1 : 0)
                        .accessibilityHidden(!isCountVisible || events.count <= 1)
                }

                if let headerTrailing {
                    headerTrailing
                }
            }
            .padding(.horizontal, 16)

            eventScrollView
        }
        .onChange(of: events.map(\.id)) { _, eventIDs in
            if let currentEventID, eventIDs.contains(currentEventID) {
                return
            }

            self.currentEventID = eventIDs.first
        }
        .onDisappear {
            hideCountTask?.cancel()
        }
    }

    @ViewBuilder
    private var eventScrollView: some View {
        if #available(iOS 18.0, *) {
            scrollView
                .onScrollTargetVisibilityChange(
                    idType: UUID.self,
                    threshold: 0.8
                ) { visibleEventIDs in
                    guard let lastEventID = events.last?.id else {
                        isLastEventVisible = false
                        return
                    }

                    isLastEventVisible = visibleEventIDs.contains(lastEventID)
                }
                .onScrollPhaseChange { _, phase in
                    if phase == .idle {
                        isNativeScrollActive = false
                        scheduleCountFadeOut()
                    } else {
                        isNativeScrollActive = true
                        showCount()
                    }
                }
        } else {
            scrollView
                .simultaneousGesture(
                    DragGesture(minimumDistance: 3)
                        .onChanged { _ in
                            showCount()
                        }
                        .onEnded { _ in
                            scheduleCountFadeOut()
                        }
                )
        }
    }

    @ViewBuilder
    private var scrollView: some View {
        if snapsToCards {
            positionedScrollView
                .scrollTargetBehavior(.viewAligned)
        } else {
            positionedScrollView
        }
    }

    private var positionedScrollView: some View {
        ScrollView(.horizontal) {
            LazyHStack(alignment: .top, spacing: 12) {
                ForEach(events) { event in
                    card(event)
                        .frame(width: cardWidth)
                        .contentShape(Rectangle())
                        .id(event.id)
                }
            }
            .scrollTargetLayout()
        }
        .scrollIndicators(.hidden)
        .contentMargins(.horizontal, 16, for: .scrollContent)
        .scrollPosition(id: $currentEventID, anchor: .leading)
        .onChange(of: currentEventID) { _, _ in
            guard isCountVisible, !isNativeScrollActive else {
                return
            }

            scheduleCountFadeOut()
        }
    }

    private var currentEventNumber: Int {
        if isLastEventVisible {
            return events.count
        }

        guard let currentEventID,
              let index = events.firstIndex(where: { $0.id == currentEventID })
        else {
            return events.isEmpty ? 0 : 1
        }

        return index + 1
    }

    private func scrollToStart() {
        guard let firstEventID = events.first?.id,
              currentEventID != firstEventID
        else {
            return
        }

        showCount()

        withAnimation(.easeInOut(duration: 0.34)) {
            currentEventID = firstEventID
        }
    }

    private func showCount() {
        guard events.count > 1 else {
            return
        }

        hideCountTask?.cancel()

        withAnimation(.easeOut(duration: 0.12)) {
            isCountVisible = true
        }
    }

    private func scheduleCountFadeOut() {
        hideCountTask?.cancel()
        hideCountTask = Task { @MainActor in
            try? await Task.sleep(for: .milliseconds(450))

            guard !Task.isCancelled else {
                return
            }

            withAnimation(.easeOut(duration: 0.22)) {
                isCountVisible = false
            }
        }
    }
}

struct EventCardView: View {
    let event: EventFeedItem
    var obscuresDetails = false
    var cardHeight: CGFloat = 284
    @Environment(Clerk.self) private var clerk
    @EnvironmentObject private var appSession: AppSession
    private let cardCornerRadius: CGFloat = 18
    @State private var artworkPalette = EventCardPalette.fallback
    @State private var loadedArtwork: UIImage?
    @State private var blurredArtwork: UIImage?

    var body: some View {
        GeometryReader { proxy in
            let cardWidth = proxy.size.width

            ZStack(alignment: .topLeading) {
                if obscuresDetails {
                    EventCardPrivacyOverlay()
                } else {
                    EventCardContent(
                        event: event,
                        image: loadedArtwork,
                        blurredImage: blurredArtwork,
                        palette: artworkPalette,
                        cardWidth: cardWidth,
                        cardHeight: cardHeight,
                        isAuthenticated: isAuthenticated
                    )
                }
            }
            .frame(width: cardWidth, height: cardHeight, alignment: .topLeading)
        }
        .frame(height: cardHeight)
        .compositingGroup()
        .clipShape(cardShape, style: FillStyle(antialiased: true))
        .background {
            cardShape
                .fill(artworkPalette.bottomColor)
                .padding(-0.75)
        }
        .overlay {
            RoundedRectangle(cornerRadius: cardCornerRadius, style: .continuous)
                .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
        }
        .contentShape(cardShape)
        .task(id: imageURL) {
            guard !obscuresDetails else {
                loadedArtwork = nil
                blurredArtwork = nil
                artworkPalette = .fallback
                return
            }

            guard let imageURL else {
                loadedArtwork = nil
                blurredArtwork = nil
                artworkPalette = .fallback
                return
            }

            await loadArtwork(from: imageURL)
        }
    }

    private var isAuthenticated: Bool {
        clerk.user != nil
    }

    private var imageURL: URL? {
        event.posterImageURL ?? event.brandingImageURL
    }

    private var cardShape: some Shape {
        RoundedRectangle(cornerRadius: cardCornerRadius, style: .continuous)
    }

    private func loadArtwork(from url: URL) async {
        // Reappearing cards (recycled by the enclosing LazyHStack) hit this cache and
        // skip both the reset-to-fallback flash and the CoreImage palette/blur work,
        // which is the main source of scroll jank when re-entering earlier cards.
        if let cached = EventCardArtworkCache.shared.artwork(for: url) {
            await MainActor.run {
                loadedArtwork = cached.image
                blurredArtwork = cached.blurred
                artworkPalette = cached.palette
            }
            return
        }

        await MainActor.run {
            loadedArtwork = nil
            blurredArtwork = nil
            artworkPalette = .fallback
        }

        guard let image = await RemoteImagePipeline.shared.image(for: url) else {
            return
        }

        // Run the CoreImage palette sampling + gaussian blur on a background task so
        // the first appearance of a card during scrolling doesn't hitch the main
        // thread. Results are cached, so revisiting a card skips this entirely.
        let processed = await Task.detached(priority: .userInitiated) {
            let palette = EventCardPalette.from(image: image)
            let blurred = image.blurredCardBackdrop()
            return EventCardArtwork(image: image, blurred: blurred, palette: palette)
        }.value

        EventCardArtworkCache.shared.store(processed, for: url)

        await MainActor.run {
            loadedArtwork = processed.image
            blurredArtwork = processed.blurred
            artworkPalette = processed.palette
        }
    }
}

private struct EventCardContent: View {
    let event: EventFeedItem
    let image: UIImage?
    let blurredImage: UIImage?
    let palette: EventCardPalette
    let cardWidth: CGFloat
    let cardHeight: CGFloat
    let isAuthenticated: Bool

    var body: some View {
        ZStack(alignment: .topLeading) {
            EventCardBackground(
                image: image,
                blurredImage: blurredImage,
                palette: palette,
                cardWidth: cardWidth,
                cardHeight: cardHeight
            )

            VStack(alignment: .leading, spacing: 0) {
                Spacer(minLength: 0)

                VStack(alignment: .leading, spacing: 3) {
                    if let promo = event.promo, !promo.isEmpty {
                        Text(promo)
                            .font(.system(size: 11, weight: .bold))
                            .foregroundStyle(.black)
                            .lineLimit(1)
                            .padding(.horizontal, 8)
                            .frame(height: 22)
                            .background(AppTheme.accentBlue, in: Capsule())
                            .padding(.bottom, 2)
                    }

                    if isAuthenticated {
                        EventSocialOverlayView(attendees: goingAttendees, size: .card)
                            .padding(.bottom, 4)
                    }

                    Text(event.title)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.leading)
                        .lineLimit(1)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    Text(event.formattedCardStart)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(AppTheme.accentBlue)
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)

                    HStack(spacing: 8) {
                        Text(event.primaryLocation)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(.white.opacity(0.76))
                            .lineLimit(1)
                            .minimumScaleFactor(0.82)

                        Spacer(minLength: 4)

                        if isAuthenticated && interestedCount > 0 {
                            HStack(spacing: 3) {
                                Image(systemName: "star.fill")
                                Text("\(interestedCount)")
                            }
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(.yellow)
                            .fixedSize()
                            .accessibilityLabel(
                                "\(interestedCount) \(interestedCount == 1 ? "person" : "people") interested"
                            )
                        }
                    }
                }
                .padding(.horizontal, 14)
                .padding(.bottom, 14)
            }
            .frame(width: cardWidth, height: cardHeight, alignment: .topLeading)
        }
    }

    private var goingAttendees: [EventSocialAttendee] {
        event.friendsGoing
            .filter { $0.user.isCurrentUser || $0.user.isFriend }
            .sorted { lhs, rhs in
                lhs.user.isCurrentUser && !rhs.user.isCurrentUser
            }
            .map { rsvp in
                EventSocialAttendee(
                    id: rsvp.user.id,
                    firstName: rsvp.user.firstName,
                    lastName: rsvp.user.lastName,
                    avatarImageURL: rsvp.user.avatarImageURL,
                    status: .going
                )
            }
    }

    private var interestedCount: Int {
        event.friendsInterested.filter { $0.user.isCurrentUser || $0.user.isFriend }.count
    }

}

private struct EventCardPrivacyOverlay: View {
    var body: some View {
        Image(systemName: "lock.fill")
            .font(.system(size: 20, weight: .semibold))
            .foregroundStyle(.white.opacity(0.82))
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Color(red: 0.14, green: 0.14, blue: 0.16))
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Private event")
    }
}

private struct EventCardBackground: View {
    let image: UIImage?
    let blurredImage: UIImage?
    let palette: EventCardPalette
    let cardWidth: CGFloat
    let cardHeight: CGFloat

    var body: some View {
        ZStack(alignment: .top) {
            palette.bottomColor
            fullCardImage
            blurredBackdrop
            dominantColorFade
            bottomSolid
        }
        .frame(width: cardWidth, height: cardHeight)
        // Do not rasterize this into a Metal-backed drawingGroup. iOS can discard
        // those textures while the app is suspended, which makes the source card
        // re-rasterize on the first reverse-zoom frame after unlocking the phone.
        // EventCardView's outer compositingGroup still keeps clipping predictable.
    }

    @ViewBuilder
    private var fullCardImage: some View {
        if let image {
            Image(uiImage: image)
                .resizable()
                .scaledToFill()
                .frame(width: cardWidth, height: cardHeight)
        }
    }

    // Blurred duplicate of the artwork covering the lower ~55% of the card so the
    // image dissolves into a soft version of itself before the solid tint takes
    // over. Tinted toward the dominant color instead of a harsh black overlay.
    @ViewBuilder
    private var blurredBackdrop: some View {
        if let blurredImage {
            Image(uiImage: blurredImage)
                .resizable()
                .scaledToFill()
                .frame(width: cardWidth, height: cardHeight)
                .overlay(palette.textAreaColor.opacity(0.22))
                .mask(
                    LinearGradient(
                        stops: [
                            .init(color: .clear, location: 0),
                            .init(color: .clear, location: 0.40),
                            .init(color: .white.opacity(0.55), location: 0.58),
                            .init(color: .white, location: 0.80),
                        ],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
        }
    }

    // Long, multi-stop fade from transparent to the derived dark dominant color.
    // Starts easing ~45% down and is effectively solid by ~82% down, so the text
    // area sits over a seamless tint with no visible line where the image ends.
    private var dominantColorFade: some View {
        LinearGradient(
            stops: [
                .init(color: palette.textAreaColor.opacity(0.00), location: 0.00),
                .init(color: palette.textAreaColor.opacity(0.10), location: 0.25),
                .init(color: palette.textAreaColor.opacity(0.35), location: 0.45),
                .init(color: palette.textAreaColor.opacity(0.75), location: 0.70),
                .init(color: palette.textAreaColor.opacity(1.00), location: 0.82),
                .init(color: palette.textAreaColor, location: 1.00),
            ],
            startPoint: .top,
            endPoint: .bottom
        )
        .frame(width: cardWidth, height: cardHeight)
    }

    // Very bottom is a touch darker than the sampled color for readability, eased
    // in so there is no seam against the gradient above it. A gradient fill (rather
    // than a masked rectangle) avoids an extra offscreen render pass.
    private var bottomSolid: some View {
        LinearGradient(
            stops: [
                .init(color: palette.bottomColor.opacity(0), location: 0.66),
                .init(color: palette.bottomColor, location: 0.90),
            ],
            startPoint: .top,
            endPoint: .bottom
        )
        .frame(width: cardWidth, height: cardHeight)
    }
}

struct EventCardArtworkPlaceholder: View {
    let width: CGFloat
    let height: CGFloat

    var body: some View {
        EventCardBackground(
            image: nil,
            blurredImage: nil,
            palette: .fallback,
            cardWidth: width,
            cardHeight: height
        )
    }
}

// Processed artwork (decoded image + blurred backdrop + derived palette) cached per
// URL so a card recycled back into view renders instantly without re-running the
// CoreImage work.
private final class EventCardArtwork {
    let image: UIImage
    let blurred: UIImage?
    let palette: EventCardPalette

    init(image: UIImage, blurred: UIImage?, palette: EventCardPalette) {
        self.image = image
        self.blurred = blurred
        self.palette = palette
    }
}

private final class EventCardArtworkCache {
    static let shared = EventCardArtworkCache()

    private let cache: NSCache<NSURL, EventCardArtwork> = {
        let cache = NSCache<NSURL, EventCardArtwork>()
        cache.countLimit = 150
        return cache
    }()

    func artwork(for url: URL) -> EventCardArtwork? {
        cache.object(forKey: url as NSURL)
    }

    func store(_ artwork: EventCardArtwork, for url: URL) {
        cache.setObject(artwork, forKey: url as NSURL)
    }
}

private struct EventCardPalette {
    // Dark dominant color used behind the text and as the fade target.
    let textAreaColor: Color
    // Slightly darker variant for the very bottom edge and the card backing.
    let bottomColor: Color

    static let fallback = EventCardPalette(
        textAreaColor: Color(red: 0.13, green: 0.13, blue: 0.16),
        bottomColor: Color(red: 0.10, green: 0.10, blue: 0.13)
    )

    static func from(image: UIImage) -> EventCardPalette {
        guard let sampled = image.dominantLowerColor else {
            return .fallback
        }

        let textArea = sampled.darkDominant()
        let bottom = textArea.adjusted(saturation: 1.04, brightness: 0.84)

        return EventCardPalette(
            textAreaColor: Color(uiColor: textArea),
            bottomColor: Color(uiColor: bottom)
        )
    }
}

private enum EventCardImageProcessing {
    static let context = CIContext(options: [.workingColorSpace: NSNull()])
}

private extension UIImage {
    // Average color of the lower/middle band of the artwork. CIImage uses a
    // bottom-left origin, so low y corresponds to the visual bottom of the image —
    // the region the text ends up sitting over.
    var dominantLowerColor: UIColor? {
        guard let cgImage else { return nil }

        let ciImage = CIImage(cgImage: cgImage)
        let extent = ciImage.extent
        guard extent.width > 0, extent.height > 0 else { return nil }

        let sampleRect = CGRect(
            x: extent.origin.x,
            y: extent.origin.y,
            width: extent.width,
            height: extent.height * 0.55
        )

        let filter = CIFilter.areaAverage()
        filter.inputImage = ciImage
        filter.extent = sampleRect

        guard let outputImage = filter.outputImage else { return nil }

        var bitmap = [UInt8](repeating: 0, count: 4)
        EventCardImageProcessing.context.render(
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
        )
    }

    func blurredCardBackdrop() -> UIImage? {
        guard cgImage != nil else { return nil }

        let maxDimension: CGFloat = 180
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
        filter.radius = 26

        guard let outputImage = filter.outputImage else { return thumbnail }

        guard let blurredCGImage = EventCardImageProcessing.context.createCGImage(outputImage, from: inputImage.extent) else {
            return thumbnail
        }

        return UIImage(cgImage: blurredCGImage, scale: thumbnail.scale, orientation: thumbnail.imageOrientation)
    }
}

private extension UIColor {
    func adjusted(saturation: CGFloat, brightness: CGFloat) -> UIColor {
        var hue: CGFloat = 0
        var currentSaturation: CGFloat = 0
        var currentBrightness: CGFloat = 0
        var alpha: CGFloat = 0

        guard getHue(
            &hue,
            saturation: &currentSaturation,
            brightness: &currentBrightness,
            alpha: &alpha
        ) else {
            return self
        }

        return UIColor(
            hue: hue,
            saturation: min(max(currentSaturation * saturation, 0), 1),
            brightness: min(max(currentBrightness * brightness, 0), 1),
            alpha: alpha
        )
    }

    // Rich, dark version of the color that keeps white text readable while still
    // reading as a tint of the original artwork rather than generic black/gray.
    func darkDominant() -> UIColor {
        var hue: CGFloat = 0
        var saturation: CGFloat = 0
        var brightness: CGFloat = 0
        var alpha: CGFloat = 0

        guard getHue(
            &hue,
            saturation: &saturation,
            brightness: &brightness,
            alpha: &alpha
        ) else {
            return self
        }

        let vibrantSaturation = min(max(saturation * 1.08, 0), 0.78)
        let readableBrightness = min(max(brightness * 0.55, 0.14), 0.30)

        return UIColor(
            hue: hue,
            saturation: vibrantSaturation,
            brightness: readableBrightness,
            alpha: 1
        )
    }
}

struct EventSocialOverlayView: View {
    let attendees: [EventSocialAttendee]
    let size: Size
    var maximumVisibleAttendees: Int? = nil
    var totalAttendeeCount: Int? = nil

    private var displayLimit: Int {
        maximumVisibleAttendees ?? size.maxDisplay
    }

    private var visibleAttendees: [EventSocialAttendee] {
        Array(
            attendees
                .sorted { lhs, rhs in
                    statusPriority(lhs.status) < statusPriority(rhs.status)
                }
                .prefix(displayLimit)
        )
    }

    private var displayedAttendees: [EventSocialAttendee] {
        switch size {
        case .card:
            return Array(visibleAttendees.reversed())
        default:
            return visibleAttendees
        }
    }

    private var remainingCount: Int {
        max(0, (totalAttendeeCount ?? attendees.count) - visibleAttendees.count)
    }

    var body: some View {
        if !attendees.isEmpty || remainingCount > 0 {
            HStack(spacing: size.avatarSpacing) {
                ForEach(displayedAttendees) { attendee in
                    EventSocialAvatarView(
                        attendee: attendee,
                        size: size.avatarSize,
                        showsStatusRing: size.showsStatusRing
                    )
                }

                if remainingCount > 0 {
                    Text("+\(remainingCount)")
                        .font(.system(size: size.overflowFontSize, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: size.avatarSize, height: size.avatarSize)
                        .background {
                            Circle()
                                .fill(.ultraThinMaterial)
                                .overlay(Circle().fill(.black.opacity(0.48)))
                        }
                }
            }
            .padding(.trailing, size.trailingPadding)
            .padding(.bottom, size.bottomPadding)
            .shadow(color: size.shadowColor, radius: size.shadowRadius, x: 0, y: size.shadowYOffset)
            .allowsHitTesting(false)
        }
    }

    private func statusPriority(_ status: EventRSVPStatus) -> Int {
        status == .going ? 1 : 0
    }

    enum Size {
        case card
        case detail
        case searchRow
        case recentSearchRow
        case summaryRow

        var avatarSize: CGFloat {
            switch self {
            case .card:
                return 28
            case .detail:
                return 54
            case .searchRow:
                return 24
            case .recentSearchRow:
                return 14
            case .summaryRow:
                return 52
            }
        }

        var avatarSpacing: CGFloat {
            switch self {
            case .card:
                return -7
            case .detail:
                return -14
            case .searchRow:
                return -8
            case .recentSearchRow:
                return -5
            case .summaryRow:
                return -16
            }
        }

        var showsStatusRing: Bool {
            switch self {
            case .card, .recentSearchRow:
                return false
            case .detail, .searchRow, .summaryRow:
                return true
            }
        }

        var maxDisplay: Int {
            switch self {
            case .card:
                return 4
            case .searchRow:
                return 2
            case .recentSearchRow:
                return 2
            case .summaryRow:
                return 3
            case .detail:
                return 3
            }
        }

        var showsScrim: Bool {
            switch self {
            case .card:
                return false
            case .detail:
                return false
            case .searchRow, .recentSearchRow:
                return false
            case .summaryRow:
                return false
            }
        }

        var trailingPadding: CGFloat {
            switch self {
            case .card:
                return 0
            case .detail:
                return 0
            case .searchRow, .recentSearchRow:
                return 0
            case .summaryRow:
                return 0
            }
        }

        var bottomPadding: CGFloat {
            switch self {
            case .card:
                return 0
            case .detail:
                return 0
            case .searchRow, .recentSearchRow:
                return 0
            case .summaryRow:
                return 0
            }
        }

        var overflowFontSize: CGFloat {
            switch self {
            case .card:
                return 10
            case .detail:
                return 15
            case .searchRow:
                return 10
            case .recentSearchRow:
                return 7
            case .summaryRow:
                return 16
            }
        }

        var shadowColor: Color {
            switch self {
            case .card:
                return .clear
            case .detail:
                return .black.opacity(0.42)
            case .searchRow, .recentSearchRow:
                return .black.opacity(0.42)
            case .summaryRow:
                return .clear
            }
        }

        var shadowRadius: CGFloat {
            switch self {
            case .card:
                return 0
            case .detail:
                return 12
            case .searchRow:
                return 6
            case .recentSearchRow:
                return 2
            case .summaryRow:
                return 0
            }
        }

        var shadowYOffset: CGFloat {
            switch self {
            case .card:
                return 0
            case .detail:
                return 6
            case .searchRow:
                return 3
            case .recentSearchRow:
                return 1
            case .summaryRow:
                return 0
            }
        }
    }
}

private struct EventSocialAvatarView: View {
    let attendee: EventSocialAttendee
    let size: CGFloat
    let showsStatusRing: Bool

    @ViewBuilder
    var body: some View {
        if showsStatusRing {
            ZStack {
                Circle()
                    .fill(ringColor)

                UserAvatarView(
                    imageURL: attendee.avatarImageURL,
                    name: displayName,
                    size: size - 4,
                    identityKey: attendee.id
                )
            }
            .frame(width: size, height: size)
        } else {
            UserAvatarView(
                imageURL: attendee.avatarImageURL,
                name: displayName,
                size: size,
                identityKey: attendee.id
            )
            .shadow(color: .black.opacity(0.7), radius: 3, x: 0, y: 1)
        }
    }

    private var displayName: String {
        let name = [attendee.firstName, attendee.lastName]
            .compactMap { value in
                let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                return trimmed.isEmpty ? nil : trimmed
            }
            .joined(separator: " ")

        return name.isEmpty ? "?" : name
    }

    private var ringColor: Color {
        switch attendee.status {
        case .going:
            return Color(red: 0.23, green: 0.93, blue: 0.86)
        case .interested:
            return Color(red: 0.98, green: 0.78, blue: 0.23)
        case .notGoing:
            return .white.opacity(0.24)
        }
    }
}

#Preview {
    EventCardView(
        event: EventFeedItem(
            id: UUID(),
            title: "Indie Night at Spirit Hall",
            description: "A stacked lineup of local bands with late-night DJs.",
            coverImageURL: nil,
            eventURL: nil,
            seriesID: nil,
            startAt: .now,
            endAt: nil,
            address: "242 51st Street",
            city: "Pittsburgh",
            state: "PA",
            venueID: nil,
            venueName: "Spirit Hall",
            venueSlug: nil,
            organizerID: nil,
            organizerName: nil,
            organizerSlug: nil,
            venueLogoImageURL: nil,
            organizerLogoImageURL: nil,
            categories: ["music"],
            categoryLabels: ["music": "Music"],
            status: .active,
            updatedAt: nil
        )
    )
    .padding()
    .background(.black)
}
