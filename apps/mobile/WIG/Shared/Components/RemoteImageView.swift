import SwiftUI
import UIKit

actor RemoteImagePipeline {
    static let shared = RemoteImagePipeline()

    private let session: URLSession
    private var inFlightImages: [URL: Task<UIImage?, Never>] = [:]
    // NSCache is thread-safe; synchronous reads let SwiftUI draw a prefetched
    // image on its first frame instead of waiting for an asynchronous task.
    nonisolated(unsafe) private let memoryCache = NSCache<NSURL, UIImage>()

    nonisolated func cachedImage(for url: URL) -> UIImage? {
        memoryCache.object(forKey: url as NSURL)
    }

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

        if let task = inFlightImages[url] {
            return await task.value
        }

        let task = Task { await downloadImage(for: url) }
        inFlightImages[url] = task
        defer { inFlightImages[url] = nil }
        return await task.value
    }

    private func downloadImage(for url: URL) async -> UIImage? {
        let cacheKey = url as NSURL

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
    @State private var loadedURL: URL?

    var body: some View {
        Group {
            if let image = url.flatMap({ RemoteImagePipeline.shared.cachedImage(for: $0) })
                ?? (loadedURL == url ? loadedImage : nil) {
                content(Image(uiImage: image))
            } else {
                placeholder()
            }
        }
        .task(id: url) {
            guard let url else {
                loadedImage = nil
                loadedURL = nil
                return
            }

            let image = await RemoteImagePipeline.shared.image(for: url)
            guard !Task.isCancelled else { return }
            loadedURL = url
            loadedImage = image
        }
    }
}
