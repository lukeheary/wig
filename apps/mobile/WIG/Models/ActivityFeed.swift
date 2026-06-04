import Foundation

struct ActivityFeedResponse: Decodable, Sendable {
    let friendCount: Int
    let requestCount: Int
    let activities: [ActivityFeedItem]
}

struct ActivityFeedItem: Decodable, Identifiable, Hashable, Sendable {
    let id: UUID
    let type: ActivityType
    let actorName: String
    let actorAvatarImageURL: URL?
    let createdAt: Date
    let updatedAt: Date?
    let event: ActivityEventSummary

    enum CodingKeys: String, CodingKey {
        case id
        case type
        case actorName
        case actorAvatarImageURL = "actorAvatarImageUrl"
        case createdAt
        case updatedAt
        case event
    }

    var timestamp: Date {
        updatedAt ?? createdAt
    }
}

enum ActivityType: String, Decodable, Hashable, Sendable {
    case rsvpGoing = "rsvp_going"
    case rsvpInterested = "rsvp_interested"
    case rsvpNotGoing = "rsvp_not_going"
}

struct ActivityEventSummary: Decodable, Identifiable, Hashable, Sendable {
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
    let venueID: UUID?
    let venueName: String?
    let venueSlug: String?
    let organizerID: UUID?
    let organizerName: String?
    let organizerSlug: String?
    let venueLogoImageURL: URL?
    let organizerLogoImageURL: URL?
    let categories: [String]
    let categoryLabels: [String: String]
    let updatedAt: Date?
    let venue: PlaceListItem?

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
        case venueID = "venueId"
        case venueName
        case venueSlug
        case organizerID = "organizerId"
        case organizerName
        case organizerSlug
        case venueLogoImageURL = "venueLogoImageUrl"
        case organizerLogoImageURL = "organizerLogoImageUrl"
        case categories
        case categoryLabels
        case updatedAt
        case venue
    }

    var primaryLocation: String {
        if let venueName, !venueName.isEmpty {
            return venueName
        }

        return "\(city), \(state)"
    }

    var eventFeedItem: EventFeedItem {
        EventFeedItem(
            id: id,
            title: title,
            description: description,
            coverImageURL: coverImageURL,
            eventURL: eventURL,
            startAt: startAt,
            endAt: endAt,
            address: address,
            city: city,
            state: state,
            venueID: venueID,
            venueName: venueName,
            venueSlug: venueSlug,
            organizerID: organizerID,
            organizerName: organizerName,
            organizerSlug: organizerSlug,
            venueLogoImageURL: venueLogoImageURL,
            organizerLogoImageURL: organizerLogoImageURL,
            categories: categories,
            categoryLabels: categoryLabels,
            updatedAt: updatedAt
        )
    }
}

extension ActivityFeedItem {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        id = try container.decode(UUID.self, forKey: .id)
        type = try container.decode(ActivityType.self, forKey: .type)
        actorName = try container.decode(String.self, forKey: .actorName)
        actorAvatarImageURL = try container.decodeOptionalURL(forKey: .actorAvatarImageURL)
        createdAt = try container.decode(Date.self, forKey: .createdAt)
        updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt)
        event = try container.decode(ActivityEventSummary.self, forKey: .event)
    }
}

extension ActivityEventSummary {
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
        venueID = try container.decodeIfPresent(UUID.self, forKey: .venueID)
        venueName = try container.decodeIfPresent(String.self, forKey: .venueName)
        venueSlug = try container.decodeIfPresent(String.self, forKey: .venueSlug)
        organizerID = try container.decodeIfPresent(UUID.self, forKey: .organizerID)
        organizerName = try container.decodeIfPresent(String.self, forKey: .organizerName)
        organizerSlug = try container.decodeIfPresent(String.self, forKey: .organizerSlug)
        venueLogoImageURL = try container.decodeOptionalURL(forKey: .venueLogoImageURL)
        organizerLogoImageURL = try container.decodeOptionalURL(forKey: .organizerLogoImageURL)
        categories = try container.decodeIfPresent([String].self, forKey: .categories) ?? []
        categoryLabels = try container.decodeIfPresent([String: String].self, forKey: .categoryLabels) ?? [:]
        updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt)
        venue = try container.decodeIfPresent(PlaceListItem.self, forKey: .venue)
    }
}

private extension KeyedDecodingContainer {
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
