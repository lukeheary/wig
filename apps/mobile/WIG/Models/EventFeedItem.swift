import Foundation

struct EventFeedItem: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let title: String
    let description: String?
    let coverImageURL: URL?
    let eventURL: URL?
    let startAt: Date
    let endAt: Date?
    let address: String?
    let city: String
    let state: String
    let venueName: String?
    let organizerName: String?
    let venueLogoImageURL: URL?
    let organizerLogoImageURL: URL?
    let categories: [String]
    let categoryLabels: [String: String]
    let updatedAt: Date?

    enum CodingKeys: String, CodingKey {
        case id
        case title
        case description
        case coverImageURL = "coverImageUrl"
        case eventURL = "eventUrl"
        case startAt
        case endAt
        case address
        case city
        case state
        case venueName
        case organizerName
        case venueLogoImageURL = "venueLogoImageUrl"
        case organizerLogoImageURL = "organizerLogoImageUrl"
        case categories
        case categoryLabels
        case updatedAt
    }

    var primaryLocation: String {
        if let venueName, !venueName.isEmpty {
            return venueName
        }

        return "\(city), \(state)"
    }

    var formattedAddressLines: [String] {
        [address, "\(city), \(state)"]
            .compactMap { value in
                guard let value else { return nil }
                let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
                return trimmed.isEmpty ? nil : trimmed
            }
    }

    var primaryCategoryLabel: String? {
        guard let category = categories.first else {
            return nil
        }

        return categoryLabels[category] ?? category.capitalized
    }

    var externalSourceName: String? {
        guard let host = eventURL?.host() else {
            return nil
        }

        if host.contains("ticketmaster") {
            return "Ticketmaster"
        }

        return host
            .replacingOccurrences(of: "www.", with: "")
            .split(separator: ".")
            .first
            .map { String($0).capitalized }
    }

    var posterImageURL: URL? {
        versionedImageURL(for: coverImageURL)
    }

    var brandingImageURL: URL? {
        versionedImageURL(for: venueLogoImageURL ?? organizerLogoImageURL)
    }

    var displayImageURL: URL? {
        posterImageURL ?? brandingImageURL
    }

    var hasPosterArtwork: Bool {
        posterImageURL != nil
    }

    private func versionedImageURL(for url: URL?) -> URL? {
        guard let url else { return nil }
        guard let updatedAt else { return url }

        let version = String(Int(updatedAt.timeIntervalSince1970))
        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return url
        }

        var queryItems = components.queryItems ?? []
        queryItems.append(URLQueryItem(name: "v", value: version))
        components.queryItems = queryItems
        return components.url ?? url
    }
}

extension EventFeedItem {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        id = try container.decode(UUID.self, forKey: .id)
        title = try container.decode(String.self, forKey: .title)
        description = try container.decodeIfPresent(String.self, forKey: .description)
        coverImageURL = try container.decodeOptionalURL(forKey: .coverImageURL)
        eventURL = try container.decodeOptionalURL(forKey: .eventURL)
        startAt = try container.decode(Date.self, forKey: .startAt)
        endAt = try container.decodeIfPresent(Date.self, forKey: .endAt)
        address = try container.decodeIfPresent(String.self, forKey: .address)
        city = try container.decode(String.self, forKey: .city)
        state = try container.decode(String.self, forKey: .state)
        venueName = try container.decodeIfPresent(String.self, forKey: .venueName)
        organizerName = try container.decodeIfPresent(String.self, forKey: .organizerName)
        venueLogoImageURL = try container.decodeOptionalURL(forKey: .venueLogoImageURL)
        organizerLogoImageURL = try container.decodeOptionalURL(forKey: .organizerLogoImageURL)
        categories = try container.decodeIfPresent([String].self, forKey: .categories) ?? []
        categoryLabels = try container.decodeIfPresent([String: String].self, forKey: .categoryLabels) ?? [:]
        updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt)
    }
}

private extension KeyedDecodingContainer where Key == EventFeedItem.CodingKeys {
    func decodeOptionalURL(forKey key: Key) throws -> URL? {
        guard let rawValue = try decodeIfPresent(String.self, forKey: key) else {
            return nil
        }

        let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else {
            return nil
        }

        guard let url = URL(string: value) else {
            throw DecodingError.dataCorruptedError(
                forKey: key,
                in: self,
                debugDescription: "Invalid URL string: \(rawValue)"
            )
        }

        return url
    }
}
