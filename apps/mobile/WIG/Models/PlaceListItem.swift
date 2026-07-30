import Foundation

struct MobilePlacesResponse: Decodable, Hashable, Sendable {
    let places: [PlaceListItem]
    let availableCities: [EventCity]
    let currentUserLocation: EventCity?
}

struct PlaceListItem: Decodable, Identifiable, Hashable, Sendable {
    enum PlaceType: String, Decodable, Hashable, Identifiable, Sendable {
        case venue
        case organizer

        var id: String { rawValue }

        var displayName: String {
            switch self {
            case .venue:
                return "Venue"
            case .organizer:
                return "Organizer"
            }
        }
    }

    let id: UUID
    let type: PlaceType
    let slug: String
    let name: String
    let logoImageURL: URL?
    let address: String?
    let city: String?
    let state: String?
    let website: URL?
    let instagram: String?
    var metroAreaCity: String? = nil
    var metroAreaState: String? = nil
    let upcomingEventCount: Int
    var followerCount = 0
    var memberCount = 0
    let updatedAt: Date?
    var isFollowed = false
    var isMember = false
    var categories: [String] = []
    var categoryLabels: [String: String] = [:]

    enum CodingKeys: String, CodingKey {
        case id
        case type
        case slug
        case name
        case logoImageURL = "logoImageUrl"
        case address
        case city
        case state
        case website
        case instagram
        case metroAreaCity
        case metroAreaState
        case upcomingEventCount
        case eventCount
        case followerCount
        case memberCount
        case updatedAt
        case isFollowed
        case isMember
        case categories
        case categoryLabels
    }

    // Stable, collision-proof identity for list rendering. A venue and an organizer
    // can share the same underlying `id`, so `id` alone is not unique across the feed;
    // combining it with the type guarantees each row has a distinct identity (avoids
    // SwiftUI reusing a row's view — and its captured navigation value — for the
    // wrong place).
    var listRowID: String {
        "\(type.rawValue):\(id.uuidString)"
    }

    var locationText: String {
        [city, state]
            .compactMap { value in
                guard let value else { return nil }
                let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
                return trimmed.isEmpty ? nil : trimmed
            }
            .joined(separator: ", ")
    }

    var eventCountText: String? {
        guard upcomingEventCount > 0 else {
            return nil
        }

        return "\(upcomingEventCount) upcoming event\(upcomingEventCount == 1 ? "" : "s")"
    }

    var displayLogoURL: URL? {
        guard let logoImageURL else {
            return nil
        }

        guard let updatedAt else {
            return logoImageURL
        }

        guard var components = URLComponents(url: logoImageURL, resolvingAgainstBaseURL: false) else {
            return logoImageURL
        }

        var queryItems = components.queryItems ?? []
        queryItems.append(URLQueryItem(name: "v", value: String(Int(updatedAt.timeIntervalSince1970))))
        components.queryItems = queryItems
        return components.url ?? logoImageURL
    }

    var primaryCategoryLabel: String? {
        guard let category = categories.first else {
            return nil
        }

        return categoryLabels[category] ?? category.capitalized
    }
}

extension PlaceListItem {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        id = try container.decode(UUID.self, forKey: .id)
        type = try container.decode(PlaceType.self, forKey: .type)
        slug = try container.decode(String.self, forKey: .slug)
        name = try container.decode(String.self, forKey: .name)
        logoImageURL = try container.decodeOptionalURL(forKey: .logoImageURL)
        address = try container.decodeIfPresent(String.self, forKey: .address)
        city = try container.decodeIfPresent(String.self, forKey: .city)
        state = try container.decodeIfPresent(String.self, forKey: .state)
        website = try container.decodeOptionalURL(forKey: .website)
        instagram = try container.decodeIfPresent(String.self, forKey: .instagram)
        metroAreaCity = try container.decodeIfPresent(String.self, forKey: .metroAreaCity)
        metroAreaState = try container.decodeIfPresent(String.self, forKey: .metroAreaState)

        let decodedUpcomingEventCount = try container.decodeFlexibleIntIfPresent(
            forKey: .upcomingEventCount
        )
        let decodedEventCount = try container.decodeFlexibleIntIfPresent(forKey: .eventCount)
        upcomingEventCount = decodedUpcomingEventCount ?? decodedEventCount ?? 0
        followerCount = try container.decodeFlexibleIntIfPresent(forKey: .followerCount) ?? 0
        memberCount = try container.decodeFlexibleIntIfPresent(forKey: .memberCount) ?? 0

        updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt)
        isFollowed = try container.decodeIfPresent(Bool.self, forKey: .isFollowed) ?? false
        isMember = try container.decodeIfPresent(Bool.self, forKey: .isMember) ?? false
        categories = try container.decodeIfPresent([String].self, forKey: .categories) ?? []
        categoryLabels = try container.decodeIfPresent([String: String].self, forKey: .categoryLabels) ?? [:]
    }
}

private extension KeyedDecodingContainer where Key == PlaceListItem.CodingKeys {
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

    func decodeFlexibleIntIfPresent(forKey key: Key) throws -> Int? {
        if let value = try decodeIfPresent(Int.self, forKey: key) {
            return value
        }

        if let value = try decodeIfPresent(String.self, forKey: key) {
            return Int(value)
        }

        return nil
    }
}
