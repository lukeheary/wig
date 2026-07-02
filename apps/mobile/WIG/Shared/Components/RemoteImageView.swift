import SwiftUI
import UIKit

actor RemoteImagePipeline {
    static let shared = RemoteImagePipeline()

    private let session: URLSession
    private let memoryCache = NSCache<NSURL, UIImage>()

    init() {
        let configuration = URLSessionConfiguration.default
        configuration.requestCachePolicy = .returnCacheDataElseLoad
        configuration.urlCache = URLCache.shared
        configuration.timeoutIntervalForRequest = 60
        configuration.timeoutIntervalForResource = 120
        configuration.httpMaximumConnectionsPerHost = 8

        session = URLSession(configuration: configuration)
        memoryCache.countLimit = 300
        memoryCache.totalCostLimit = 96 * 1024 * 1024
    }

    func image(for url: URL) async -> UIImage? {
        let cacheKey = url as NSURL

        if let cachedImage = memoryCache.object(forKey: cacheKey) {
            return cachedImage
        }

        var request = URLRequest(url: url)
        request.cachePolicy = .returnCacheDataElseLoad

        do {
            let (data, response) = try await session.data(for: request)

            if let httpResponse = response as? HTTPURLResponse,
               !(200 ..< 300).contains(httpResponse.statusCode) {
                return nil
            }

            guard let image = UIImage(data: data) else {
                return nil
            }

            // Decode the pixel data now, on this background actor. UIImage(data:)
            // defers decoding until the image is first drawn — which would otherwise
            // happen on the main thread mid-scroll, causing a one-time hitch the first
            // time each image scrolls into view. Decoding up front makes the first
            // appearance as smooth as subsequent ones.
            let decodedImage = image.preparingForDisplay() ?? image

            memoryCache.setObject(decodedImage, forKey: cacheKey, cost: data.count)
            return decodedImage
        } catch {
            return nil
        }
    }

    func prefetch(urls: [URL]) async {
        let uniqueURLs = Array(Set(urls))

        await withTaskGroup(of: Void.self) { group in
            for url in uniqueURLs {
                group.addTask {
                    _ = await self.image(for: url)
                }
            }
        }
    }
}

enum EventArtworkPrefetcher {
    static func prefetch(events: [EventFeedItem]) async {
        let urls = events.compactMap(\.displayImageURL)
        await RemoteImagePipeline.shared.prefetch(urls: urls)
    }
}

struct RemoteImageView<Content: View, Placeholder: View>: View {
    let url: URL?
    @ViewBuilder let content: (Image) -> Content
    @ViewBuilder let placeholder: () -> Placeholder

    @State private var loadedImage: UIImage?

    var body: some View {
        Group {
            if let loadedImage {
                content(Image(uiImage: loadedImage))
            } else {
                placeholder()
            }
        }
        .task(id: url) {
            guard let url else {
                loadedImage = nil
                return
            }

            loadedImage = await RemoteImagePipeline.shared.image(for: url)
        }
    }
}
