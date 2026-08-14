import Foundation

struct ActivityFeedResponse: Decodable, Sendable {
    let friendCount: Int
    let requestCount: Int
    let currentUserLocation: EventCity?
    let activities: [ActivityFeedItem]
}

struct ActivityFeedItem: Decodable, Identifiable, Hashable, Sendable {
    let id: UUID
    let type: ActivityType
    let actorUserID: String
    let actorName: String
    let actorFirstName: String?
    let actorGender: UserGender?
    let actorAvatarImageURL: URL?
    let partnerFirstName: String?
    let partnerUserID: String?
    let notGoingReason: EventRSVPDeclineReason?
    let createdAt: Date
    let updatedAt: Date?
    let event: ActivityEventSummary?

    enum CodingKeys: String, CodingKey {
        case id
        case type
        case actorUserID = "actorUserId"
        case actorName
        case actorFirstName
        case actorGender
        case actorAvatarImageURL = "actorAvatarImageUrl"
        case partnerFirstName
        case partnerUserID = "partnerUserId"
        case notGoingReason
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
    case friendRequestReceived = "friend_request_received"
    case partnerRequestReceived = "partner_request_received"
    case friendRequestAccepted = "friend_request_accepted"
    case partnerRequestAccepted = "partner_request_accepted"

    var isRequest: Bool {
        switch self {
        case .friendRequestReceived,
             .partnerRequestReceived,
             .friendRequestAccepted,
             .partnerRequestAccepted:
            return true
        case .rsvpGoing, .rsvpInterested, .rsvpNotGoing:
            return false
        }
    }

    var isActionableRequest: Bool {
        switch self {
        case .friendRequestReceived, .partnerRequestReceived:
            return true
        case .friendRequestAccepted, .partnerRequestAccepted, .rsvpGoing, .rsvpInterested, .rsvpNotGoing:
            return false
        }
    }
}

enum UserGender: String, Codable, CaseIterable, Hashable, Sendable {
    case male
    case female
    case other
}

struct ActivityEventSummary: Decodable, Identifiable, Hashable, Sendable {
    let id: UUID
    let publicID: String
    let title: String
    let description: String?
    let coverImageURL: URL?
    let eventURL: URL?
    let startAt: Date
    let endAt: Date?
    let address: String?
    let city: String
    let state: String
    let timeZone: String?
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
    let canEdit: Bool
    let isFollowed: Bool
    let userRsvpStatus: EventRSVPStatus?
    let userRsvpNotGoingReason: EventRSVPDeclineReason?
    let friendsGoing: [EventSocialRSVP]
    let friendsInterested: [EventSocialRSVP]
    let friendsNotGoing: [EventSocialRSVP]
    let venue: PlaceListItem?

    enum CodingKeys: String, CodingKey {
        case id
        case publicID = "publicId"
        case title
        case description
        case coverImageURL = "coverImageUrl"
        case eventURL = "eventUrl"
        case startAt
        case endAt
        case address
        case city
        case state
        case timeZone
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
        case canEdit
        case isFollowed
        case userRsvpStatus
        case userRsvpNotGoingReason
        case friendsGoing
        case friendsInterested
        case friendsNotGoing
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
            publicID: publicID,
            title: title,
            description: description,
            coverImageURL: coverImageURL,
            eventURL: eventURL,
            seriesID: nil,
            startAt: startAt,
            endAt: endAt,
            address: address,
            city: city,
            state: state,
            timeZone: timeZone,
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
            status: .active,
            updatedAt: updatedAt,
            canEdit: canEdit,
            isFollowed: isFollowed,
            userRsvpStatus: userRsvpStatus,
            userRsvpNotGoingReason: userRsvpNotGoingReason,
            friendsGoing: friendsGoing,
            friendsInterested: friendsInterested,
            friendsNotGoing: friendsNotGoing
        )
    }
}

extension ActivityFeedItem {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        id = try container.decode(UUID.self, forKey: .id)
        type = try container.decode(ActivityType.self, forKey: .type)
        actorUserID = try container.decode(String.self, forKey: .actorUserID)
        actorName = try container.decode(String.self, forKey: .actorName)
        actorFirstName = try container.decodeIfPresent(String.self, forKey: .actorFirstName)
        actorGender = try container.decodeIfPresent(UserGender.self, forKey: .actorGender)
        actorAvatarImageURL = try container.decodeOptionalURL(forKey: .actorAvatarImageURL)
        partnerFirstName = try container.decodeIfPresent(String.self, forKey: .partnerFirstName)
        partnerUserID = try container.decodeIfPresent(String.self, forKey: .partnerUserID)
        notGoingReason = try container.decodeIfPresent(EventRSVPDeclineReason.self, forKey: .notGoingReason)
        createdAt = try container.decode(Date.self, forKey: .createdAt)
        updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt)
        event = try container.decodeIfPresent(ActivityEventSummary.self, forKey: .event)
    }
}

extension ActivityEventSummary {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        id = try container.decode(UUID.self, forKey: .id)
        publicID = try container.decode(String.self, forKey: .publicID)
        title = try container.decode(String.self, forKey: .title)
        description = try container.decodeIfPresent(String.self, forKey: .description)
        coverImageURL = try container.decodeOptionalURL(forKey: .coverImageURL)
        eventURL = try container.decodeOptionalURL(forKey: .eventURL)
        startAt = try container.decode(Date.self, forKey: .startAt)
        endAt = try container.decodeIfPresent(Date.self, forKey: .endAt)
        address = try container.decodeIfPresent(String.self, forKey: .address)
        city = try container.decode(String.self, forKey: .city)
        state = try container.decode(String.self, forKey: .state)
        timeZone = try container.decodeIfPresent(String.self, forKey: .timeZone)
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
        canEdit = try container.decodeIfPresent(Bool.self, forKey: .canEdit) ?? false
        isFollowed = try container.decodeIfPresent(Bool.self, forKey: .isFollowed) ?? false
        userRsvpStatus = try container.decodeIfPresent(EventRSVPStatus.self, forKey: .userRsvpStatus)
        userRsvpNotGoingReason = try container.decodeIfPresent(
            EventRSVPDeclineReason.self,
            forKey: .userRsvpNotGoingReason
        )
        friendsGoing = try container.decodeIfPresent([EventSocialRSVP].self, forKey: .friendsGoing) ?? []
        friendsInterested = try container.decodeIfPresent([EventSocialRSVP].self, forKey: .friendsInterested) ?? []
        friendsNotGoing = try container.decodeIfPresent([EventSocialRSVP].self, forKey: .friendsNotGoing) ?? []
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

@MainActor
final class ActivityRequestStore: ObservableObject {
    @Published private(set) var responses: [UUID: ActivityRequestResponse] = [:]

    func record(_ response: ActivityRequestResponse, for id: UUID) {
        responses[id] = response
    }

    func response(for id: UUID) -> ActivityRequestResponse? {
        responses[id]
    }
}
