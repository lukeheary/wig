import ClerkKit
import CoreImage
import CoreImage.CIFilterBuiltins
import SwiftUI
import UIKit

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
                        artworkOverlayHeight: artworkOverlayHeight,
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
        appSession.isAuthBypassed || clerk.user != nil
    }

    private var imageURL: URL? {
        event.posterImageURL ?? event.brandingImageURL
    }

    private var cardShape: some Shape {
        RoundedRectangle(cornerRadius: cardCornerRadius, style: .continuous)
    }

    private var artworkOverlayHeight: CGFloat {
        cardHeight * 0.68
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
    let artworkOverlayHeight: CGFloat
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
                ZStack(alignment: .topTrailing) {
                    if isAuthenticated {
                        EventSocialOverlayView(attendees: event.socialAttendees, size: .card)
                            .padding(.trailing, 10)
                            .padding(.top, 10)
                    }
                }
                .frame(width: cardWidth, height: artworkOverlayHeight, alignment: .topTrailing)

                Spacer(minLength: 0)

                VStack(alignment: .leading, spacing: 3) {
                    Text(event.title)
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white)
                        .multilineTextAlignment(.leading)
                        .lineLimit(2)
                        .lineSpacing(1)
                        .frame(maxWidth: .infinity, alignment: .leading)

                    Text(event.formattedStart(format: "EEE, MMM d 'at' h:mm a"))
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(AppTheme.accentBlue)
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)

                    Text(event.primaryLocation)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.white.opacity(0.76))
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)
                }
                .padding(.horizontal, 14)
                .padding(.bottom, 14)
            }
            .frame(width: cardWidth, height: cardHeight, alignment: .topLeading)
        }
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
        // The composed background never animates once the artwork/palette load, so
        // flatten the image + blur + gradients into a single cached texture. This
        // avoids re-compositing several offscreen layers (and re-sampling the
        // full-resolution poster) on every frame while the card scrolls.
        .drawingGroup()
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
    // Dark, muted dominant color used behind the text and as the fade target.
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
        let bottom = textArea.adjusted(saturation: 1.0, brightness: 0.84)

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
        guard let cgImage else { return nil }

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

    // Muted, dark version of the color that keeps white text readable while still
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

        let mutedSaturation = min(max(saturation * 0.82, 0), 0.60)
        let readableBrightness = min(max(brightness * 0.55, 0.14), 0.30)

        return UIColor(
            hue: hue,
            saturation: mutedSaturation,
            brightness: readableBrightness,
            alpha: 1
        )
    }
}

struct EventSocialOverlayView: View {
    let attendees: [EventSocialAttendee]
    let size: Size

    private var visibleAttendees: [EventSocialAttendee] {
        Array(
            attendees
                .sorted { lhs, rhs in
                    statusPriority(lhs.status) < statusPriority(rhs.status)
                }
                .prefix(size.maxDisplay)
        )
    }

    private var remainingCount: Int {
        max(0, attendees.count - size.maxDisplay)
    }

    var body: some View {
        if !attendees.isEmpty {
            HStack(spacing: size.stackSpacing) {
                HStack(spacing: size.avatarSpacing) {
                    ForEach(visibleAttendees) { attendee in
                        EventSocialAvatarView(attendee: attendee, size: size.avatarSize)
                    }
                }

                if remainingCount > 0 {
                    Text("+\(remainingCount)")
                        .font(.system(size: size.overflowFontSize, weight: .bold))
                        .foregroundStyle(.white)
                        .frame(width: size.avatarSize, height: size.avatarSize)
                        .background(Color.black.opacity(0.58), in: Circle())
                        .overlay(Circle().strokeBorder(.white.opacity(0.72), lineWidth: 1))
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
        case summaryRow

        var avatarSize: CGFloat {
            switch self {
            case .card:
                return 40
            case .detail:
                return 54
            case .searchRow:
                return 24
            case .summaryRow:
                return 52
            }
        }

        var avatarSpacing: CGFloat {
            switch self {
            case .card:
                return -10
            case .detail:
                return -14
            case .searchRow:
                return -8
            case .summaryRow:
                return -16
            }
        }

        var stackSpacing: CGFloat {
            switch self {
            case .searchRow:
                return 3
            case .summaryRow:
                return 4
            default:
                return 5
            }
        }

        var maxDisplay: Int {
            switch self {
            case .searchRow:
                return 2
            case .summaryRow:
                return 3
            default:
                return 3
            }
        }

        var showsScrim: Bool {
            switch self {
            case .card:
                return false
            case .detail:
                return false
            case .searchRow:
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
            case .searchRow:
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
            case .searchRow:
                return 0
            case .summaryRow:
                return 0
            }
        }

        var overflowFontSize: CGFloat {
            switch self {
            case .card:
                return 13
            case .detail:
                return 15
            case .searchRow:
                return 10
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
            case .searchRow:
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
            case .summaryRow:
                return 0
            }
        }
    }
}

private struct EventSocialAvatarView: View {
    let attendee: EventSocialAttendee
    let size: CGFloat

    var body: some View {
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
