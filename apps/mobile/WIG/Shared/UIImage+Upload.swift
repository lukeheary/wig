import Foundation
import ImageIO
import UIKit

extension UIImage {
    func avatarUploadJPEGData(maxBytes: Int) -> Data? {
        compressedUploadJPEGData(maxBytes: maxBytes, maxDimension: 1024)
    }

    func placeLogoUploadJPEGData(maxBytes: Int) -> Data? {
        compressedUploadJPEGData(maxBytes: maxBytes, maxDimension: 1200)
    }

    func eventCoverUploadJPEGData(maxBytes: Int) -> Data? {
        compressedUploadJPEGData(maxBytes: maxBytes, maxDimension: 1600)
    }

    private func compressedUploadJPEGData(maxBytes: Int, maxDimension: CGFloat) -> Data? {
        let image = resizedForUpload(maxDimension: maxDimension)

        for quality in [0.86, 0.72, 0.58, 0.44, 0.32] {
            guard let data = image.jpegData(compressionQuality: quality) else {
                continue
            }

            if data.count <= maxBytes {
                return data
            }
        }

        return nil
    }

    private func resizedForUpload(maxDimension: CGFloat) -> UIImage {
        let longestSide = max(size.width, size.height)

        guard longestSide > maxDimension else {
            return self
        }

        let scale = maxDimension / longestSide
        let targetSize = CGSize(
            width: size.width * scale,
            height: size.height * scale
        )

        let format = UIGraphicsImageRendererFormat.default()
        format.scale = 1
        format.opaque = true

        return UIGraphicsImageRenderer(size: targetSize, format: format).image { _ in
            draw(in: CGRect(origin: .zero, size: targetSize))
        }
    }
}

struct PreparedEventCoverImage {
    let image: UIImage
    let jpegData: Data
}

// Photo-library images can be tens of megapixels. Decode only a bounded thumbnail
// and prepare upload bytes on this actor, never on the UI thread.
actor EventCoverImageProcessor {
    static let shared = EventCoverImageProcessor()

    func prepare(data: Data) -> PreparedEventCoverImage? {
        guard !Task.isCancelled else { return nil }
        return autoreleasepool {
            guard let source = CGImageSourceCreateWithData(data as CFData, [
                kCGImageSourceShouldCache: false,
            ] as CFDictionary) else { return nil }
            guard let thumbnail = CGImageSourceCreateThumbnailAtIndex(source, 0, [
                kCGImageSourceCreateThumbnailFromImageAlways: true,
                kCGImageSourceCreateThumbnailWithTransform: true,
                kCGImageSourceThumbnailMaxPixelSize: 1600,
                kCGImageSourceShouldCacheImmediately: true,
            ] as CFDictionary), !Task.isCancelled else { return nil }
            let image = UIImage(cgImage: thumbnail)
            guard let jpegData = image.eventCoverUploadJPEGData(maxBytes: 4 * 1024 * 1024),
                  !Task.isCancelled else { return nil }
            return PreparedEventCoverImage(image: image, jpegData: jpegData)
        }
    }
}
