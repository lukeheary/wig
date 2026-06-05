import Foundation

struct PlaceDetail: Decodable, Identifiable, Hashable, Sendable {
    let id: UUID
    let type: PlaceListItem.PlaceType
    let slug: String
    let name: String
    let description: String?
    let logoImageURL: URL?
    let coverImageURL: URL?
    let address: String?
    let city: String?
    let state: String?
    let website: URL?
    let instagram: String?
    let categories: [String]
    let categoryLabels: [String: String]
    let updatedAt: Date?
    var isFollowed = false
    let events: [EventFeedItem]
    let pastEvents: [EventFeedItem]

    enum CodingKeys: String, CodingKey {
        case id
        case type
        case slug
        case name
        case description
        case logoImageURL = "logoImageUrl"
        case coverImageURL = "coverImageUrl"
        case address
        case city
        case state
        case website
        case instagram
        case categories
        case categoryLabels
        case updatedAt
        case isFollowed
        case events
        case pastEvents
    }

    var locationText: String? {
        if let address = cleaned(address) {
            return address
        }

        let location = [city, state]
            .compactMap(cleaned)
            .joined(separator: ", ")

        return location.isEmpty ? nil : location
    }

    var websiteDisplayText: String? {
        guard let host = website?.host() else {
            return nil
        }

        return host.replacingOccurrences(of: "www.", with: "")
    }

    var primaryCategoryLabel: String? {
        guard let category = categories.first else {
            return nil
        }

        return categoryLabels[category] ?? category.capitalized
    }

    var displayLogoURL: URL? {
        versionedImageURL(for: logoImageURL)
    }

    private func versionedImageURL(for url: URL?) -> URL? {
        guard let url else { return nil }
        guard let updatedAt else { return url }

        guard var components = URLComponents(url: url, resolvingAgainstBaseURL: false) else {
            return url
        }

        var queryItems = components.queryItems ?? []
        queryItems.append(URLQueryItem(name: "v", value: String(Int(updatedAt.timeIntervalSince1970))))
        components.queryItems = queryItems
        return components.url ?? url
    }

    private func cleaned(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        return trimmed.isEmpty ? nil : trimmed
    }
}

extension PlaceDetail {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        id = try container.decode(UUID.self, forKey: .id)
        type = try container.decode(PlaceListItem.PlaceType.self, forKey: .type)
        slug = try container.decode(String.self, forKey: .slug)
        name = try container.decode(String.self, forKey: .name)
        description = try container.decodeIfPresent(String.self, forKey: .description)
        logoImageURL = try container.decodeOptionalURL(forKey: .logoImageURL)
        coverImageURL = try container.decodeOptionalURL(forKey: .coverImageURL)
        address = try container.decodeIfPresent(String.self, forKey: .address)
        city = try container.decodeIfPresent(String.self, forKey: .city)
        state = try container.decodeIfPresent(String.self, forKey: .state)
        website = try container.decodeOptionalURL(forKey: .website)
        instagram = try container.decodeIfPresent(String.self, forKey: .instagram)
        categories = try container.decodeIfPresent([String].self, forKey: .categories) ?? []
        categoryLabels = try container.decodeIfPresent([String: String].self, forKey: .categoryLabels) ?? [:]
        updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt)
        isFollowed = try container.decodeIfPresent(Bool.self, forKey: .isFollowed) ?? false
        events = try container.decodeIfPresent([EventFeedItem].self, forKey: .events) ?? []
        pastEvents = try container.decodeIfPresent([EventFeedItem].self, forKey: .pastEvents) ?? []
    }
}

private extension KeyedDecodingContainer where Key == PlaceDetail.CodingKeys {
    func decodeOptionalURL(forKey key: Key) throws -> URL? {
        guard let rawValue = try decodeIfPresent(String.self, forKey: key) else {
            return nil
        }

        let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !value.isEmpty else {
            return nil
        }

        return URL(string: value)
    }
}
