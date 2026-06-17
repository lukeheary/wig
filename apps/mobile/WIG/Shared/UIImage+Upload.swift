import Foundation
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
