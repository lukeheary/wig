import CoreImage
import CoreImage.CIFilterBuiltins
import SwiftUI
import UIKit

// Hero used at the top of the event detail page. Rather than bleeding the artwork
// full-screen to the top, it presents the poster as a large square card near the
// top with the nav/action controls floating over the image corners, and the event
// header (date/title/location) sitting directly below it. The background is derived
// from the artwork itself — a dark dominant color fill plus a heavily blurred
// duplicate of the image — and it extends down behind the header before fading
// smoothly into the app background.
//
// Layer order (back to front):
//   1. dominant image color / blurred image, from the top through the header area
//   2. smooth vertical gradient fading into the app background lower down
//   3. square foreground image with rounded corners
//   4. nav / action buttons over the image corners
//   5. header text directly below the image
struct EventDetailHero<
    Header: View,
    TopLeadingControls: View,
    TopTrailingControls: View,
    LeadingAccessory: View,
    TrailingAccessory: View
>: View {
    let imageURL: URL?
    let containerWidth: CGFloat
    let topInset: CGFloat
    let onImageTap: () -> Void

    private let header: Header
    private let topLeadingControls: TopLeadingControls
    private let topTrailingControls: TopTrailingControls
    private let leadingAccessory: LeadingAccessory
    private let trailingAccessory: TrailingAccessory

    @State private var loadedArtwork: UIImage?
    @State private var blurredArtwork: UIImage?
    @State private var palette: EventHeroPalette = .fallback

    private let horizontalPadding: CGFloat = 16
    private let imageCornerRadius: CGFloat = 22
    private let cornerControlInset: CGFloat = 12
    private let accessoryInset: CGFloat = 12
    private let topGap: CGFloat = 10
    // Minimum space above the artwork so it clears the Dynamic Island even when the
    // reported safe-area inset is unavailable (the tint still fills to the top).
    private let dynamicIslandClearance: CGFloat = 56
    private let headerSpacing: CGFloat = 18
    private let bottomTail: CGFloat = 8
    private let solidTail: CGFloat = 0
    private let fadeHeight: CGFloat = 240
    // Extends the tinted background above the hero so pulling / overscrolling at the
    // top reveals more of the fade instead of a hard cutoff line.
    private let overscrollExtension: CGFloat = 500
    // Extends the tinted background below the hero's bottom edge so the fade gradient
    // has room to finish reaching transparent before it would otherwise be clipped at
    // the hero bounds — without this the fade cuts off mid-transition as a hard line
    // just under the RSVP button.
    private let bottomExtension: CGFloat = 320

    init(
        imageURL: URL?,
        containerWidth: CGFloat,
        topInset: CGFloat,
        onImageTap: @escaping () -> Void,
        @ViewBuilder header: () -> Header,
        @ViewBuilder topLeadingControls: () -> TopLeadingControls = { EmptyView() },
        @ViewBuilder topTrailingControls: () -> TopTrailingControls = { EmptyView() },
        @ViewBuilder leadingAccessory: () -> LeadingAccessory = { EmptyView() },
        @ViewBuilder trailingAccessory: () -> TrailingAccessory = { EmptyView() }
    ) {
        self.imageURL = imageURL
        self.containerWidth = containerWidth
        self.topInset = topInset
        self.onImageTap = onImageTap
        self.header = header()
        self.topLeadingControls = topLeadingControls()
        self.topTrailingControls = topTrailingControls()
        self.leadingAccessory = leadingAccessory()
        self.trailingAccessory = trailingAccessory()
    }

    private var imageSide: CGFloat {
        max(containerWidth - horizontalPadding * 2, 0)
    }

    private var imageTopOffset: CGFloat {
        // The event page keeps its scroll content within the top safe area (so iOS
        // doesn't draw a status-bar scrim), which means the safe area already provides
        // the space above the artwork. We only need a small gap below it here — adding
        // the safe-area inset again would push the artwork too far down.
        topGap
    }

    var body: some View {
        VStack(spacing: 0) {
            Color.clear
                .frame(height: imageTopOffset)

            squareImage

            header
                .padding(.top, headerSpacing)
                .padding(.horizontal, horizontalPadding)
                .frame(maxWidth: .infinity, alignment: .leading)

            Color.clear
                .frame(height: bottomTail)
        }
        .frame(width: containerWidth)
        .background { backdrop }
        .task(id: imageURL) {
            await loadArtwork()
        }
    }

    // Layers 1–2: an artwork-tinted background — dominant color plus a blurred
    // duplicate — that fills from above the top of the screen (so overscroll keeps
    // showing the fade rather than a hard edge), down through the artwork and
    // slightly behind the header, then dissolves gradually into the app background
    // before the About section. The artwork itself is padded down so it clears the
    // Dynamic Island.
    private var backdrop: some View {
        ZStack {
            AppTheme.background

            tint
        }
        // Grow the whole background upward beyond the hero's top edge so the tint
        // continues smoothly offscreen above the status bar during overscroll, and
        // downward past the bottom edge so the fade gradient can finish into the app
        // background instead of being clipped mid-transition (the hard line under the
        // RSVP button).
        // (No drawingGroup here — it would rasterize to the hero bounds and clip the
        // overflow, which is exactly the region we need above and below.)
        .padding(.top, -overscrollExtension)
        .padding(.bottom, -bottomExtension)
    }

    private var tint: some View {
        ZStack {
            palette.baseColor

            if let blurredArtwork {
                VStack(spacing: 0) {
                    Image(uiImage: blurredArtwork)
                        .resizable()
                        .scaledToFill()
                        .frame(
                            width: containerWidth,
                            height: overscrollExtension + imageTopOffset + imageSide + 24
                        )
                        .clipped()
                        .overlay(palette.baseColor.opacity(0.14))
                        .mask(
                            LinearGradient(
                                stops: [
                                    .init(color: .white, location: 0.0),
                                    .init(color: .white.opacity(0.8), location: 0.82),
                                    .init(color: .clear, location: 1.0),
                                ],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )

                    Spacer(minLength: 0)
                }
            }
        }
        // Solid tint from above the top, through the artwork and slightly behind the
        // header, then a long, gradual fade that finishes before the About section.
        .mask(
            VStack(spacing: 0) {
                Color.white
                    .frame(height: overscrollExtension + imageTopOffset + imageSide + solidTail)

                LinearGradient(
                    stops: [
                        .init(color: .white, location: 0.0),
                        .init(color: .white.opacity(0.88), location: 0.15),
                        .init(color: .white.opacity(0.72), location: 0.30),
                        .init(color: .white.opacity(0.56), location: 0.45),
                        .init(color: .white.opacity(0.40), location: 0.60),
                        .init(color: .white.opacity(0.26), location: 0.74),
                        .init(color: .white.opacity(0.14), location: 0.86),
                        .init(color: .white.opacity(0.06), location: 0.94),
                        .init(color: .clear, location: 1.0),
                    ],
                    startPoint: .top,
                    endPoint: .bottom
                )
                .frame(height: fadeHeight)

                Color.clear
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        )
    }

    // Layers 3–4: the square foreground image plus the controls over its corners and
    // the accessories along its bottom edge, all supplied by the caller.
    private var squareImage: some View {
        artwork
            .frame(width: imageSide, height: imageSide)
            .clipShape(RoundedRectangle(cornerRadius: imageCornerRadius, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: imageCornerRadius, style: .continuous)
                    .strokeBorder(Color.white.opacity(0.08), lineWidth: 1)
            }
            .shadow(color: .black.opacity(0.3), radius: 18, x: 0, y: 10)
            .contentShape(RoundedRectangle(cornerRadius: imageCornerRadius, style: .continuous))
            .onTapGesture {
                onImageTap()
            }
            .overlay(alignment: .topLeading) {
                topLeadingControls
                    .padding(cornerControlInset)
            }
            .overlay(alignment: .topTrailing) {
                topTrailingControls
                    .padding(cornerControlInset)
            }
            .overlay(alignment: .bottomLeading) {
                leadingAccessory
                    .padding(accessoryInset)
            }
            .overlay(alignment: .bottomTrailing) {
                trailingAccessory
                    .padding(accessoryInset)
            }
            .frame(maxWidth: .infinity)
    }

    @ViewBuilder
    private var artwork: some View {
        if let loadedArtwork {
            Image(uiImage: loadedArtwork)
                .resizable()
                .scaledToFill()
        } else if imageURL != nil {
            // Loading: hold the derived (or fallback) dominant color so the card
            // does not flash a placeholder icon before the artwork resolves.
            Rectangle()
                .fill(palette.baseColor)
        } else {
            artworkPlaceholder
        }
    }

    private var artworkPlaceholder: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.20, green: 0.18, blue: 0.17),
                    Color(red: 0.30, green: 0.20, blue: 0.20),
                    Color(red: 0.11, green: 0.10, blue: 0.10),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            Image(systemName: "music.mic")
                .font(.system(size: 72, weight: .regular))
                .foregroundStyle(.white.opacity(0.75))
        }
    }

    private func loadArtwork() async {
        await MainActor.run {
            loadedArtwork = nil
            blurredArtwork = nil
            palette = .fallback
        }

        guard let imageURL else {
            return
        }

        guard let image = await RemoteImagePipeline.shared.image(for: imageURL) else {
            return
        }

        let newPalette = EventHeroPalette.from(image: image)
        let blurred = image.blurredHeroBackdrop()

        await MainActor.run {
            loadedArtwork = image
            blurredArtwork = blurred
            palette = newPalette
        }
    }
}

// Dark, muted colors derived from the artwork used to tint the hero background.
private struct EventHeroPalette {
    // Dominant dark color used behind the image and across the top of the hero.
    let baseColor: Color
    // Deeper variant used for the middle of the fade before it reaches black.
    let deepColor: Color

    // Muted gray/brown used when color extraction fails (never pure black).
    static let fallback = EventHeroPalette(
        baseColor: Color(red: 0.17, green: 0.15, blue: 0.14),
        deepColor: Color(red: 0.11, green: 0.10, blue: 0.10)
    )

    static func from(image: UIImage) -> EventHeroPalette {
        guard let sampled = image.averageArtworkColor else {
            return .fallback
        }

        let base = sampled.darkHeroDominant()
        let deep = base.heroAdjusted(saturation: 0.95, brightness: 0.6)

        return EventHeroPalette(
            baseColor: Color(uiColor: base),
            deepColor: Color(uiColor: deep)
        )
    }
}

private enum EventHeroImageProcessing {
    static let context = CIContext(options: [.workingColorSpace: NSNull()])
}

private extension UIImage {
    // Average color across the whole artwork — used as the dominant hero tint.
    var averageArtworkColor: UIColor? {
        guard let cgImage else { return nil }

        let ciImage = CIImage(cgImage: cgImage)
        let extent = ciImage.extent
        guard extent.width > 0, extent.height > 0 else { return nil }

        let filter = CIFilter.areaAverage()
        filter.inputImage = ciImage
        filter.extent = extent

        guard let outputImage = filter.outputImage else { return nil }

        var bitmap = [UInt8](repeating: 0, count: 4)
        EventHeroImageProcessing.context.render(
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

    // Small, heavily blurred duplicate of the artwork used as the hero backdrop.
    func blurredHeroBackdrop() -> UIImage? {
        guard cgImage != nil else { return nil }

        let maxDimension: CGFloat = 200
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
        filter.radius = 42

        guard let outputImage = filter.outputImage else { return thumbnail }

        guard let blurredCGImage = EventHeroImageProcessing.context.createCGImage(
            outputImage,
            from: inputImage.extent
        ) else {
            return thumbnail
        }

        return UIImage(
            cgImage: blurredCGImage,
            scale: thumbnail.scale,
            orientation: thumbnail.imageOrientation
        )
    }
}

private extension UIColor {
    func heroAdjusted(saturation: CGFloat, brightness: CGFloat) -> UIColor {
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

    // Muted, dark version of the color that reads as a tint of the artwork rather
    // than generic black/gray, while staying dark enough for white controls.
    func darkHeroDominant() -> UIColor {
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

        let mutedSaturation = min(max(saturation * 0.85, 0), 0.62)
        let readableBrightness = min(max(brightness * 0.7, 0.20), 0.42)

        return UIColor(
            hue: hue,
            saturation: mutedSaturation,
            brightness: readableBrightness,
            alpha: 1
        )
    }
}
