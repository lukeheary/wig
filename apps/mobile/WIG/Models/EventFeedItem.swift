import Foundation

struct MobileEventsResponse: Codable, Hashable, Sendable {
    let events: [EventFeedItem]
    let availableCities: [EventCity]
    let currentUserLocation: EventCity?
}

struct EventCity: Codable, Hashable, Identifiable, Sendable {
    let city: String
    let state: String

    var id: String {
        "\(city)|\(state)"
    }

    var title: String {
        "\(city), \(state)"
    }
}

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
    var timeZone: String? = nil
    var metroAreaCity: String? = nil
    var metroAreaState: String? = nil
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
    let status: EventStatus
    let updatedAt: Date?
    var canEdit = false
    var isFollowed = false
    var isCreatedByCurrentUser = false
    var userRsvpStatus: EventRSVPStatus? = nil
    var userRsvpNotGoingReason: EventRSVPDeclineReason? = nil
    var friendsGoing: [EventSocialRSVP] = []
    var friendsInterested: [EventSocialRSVP] = []

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
        case timeZone
        case metroAreaCity
        case metroAreaState
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
        case status
        case updatedAt
        case canEdit
        case isFollowed
        case isCreatedByCurrentUser
        case userRsvpStatus
        case userRsvpNotGoingReason
        case friendsGoing
        case friendsInterested
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

    var displayTimeZone: TimeZone {
        if let timeZone,
           let explicitTimeZone = TimeZone(identifier: timeZone)
        {
            return explicitTimeZone
        }

        return TimeZone.usStateFallback(for: state) ?? .current
    }

    func formattedStart(format: String) -> String {
        EventFeedItem.formatter(format: format, timeZone: displayTimeZone)
            .string(from: startAt)
    }

    func formattedEnd(format: String) -> String? {
        guard let endAt else { return nil }
        return EventFeedItem.formatter(format: format, timeZone: displayTimeZone)
            .string(from: endAt)
    }

    func localStartOfDay() -> Date {
        EventFeedItem.calendar(timeZone: displayTimeZone).startOfDay(for: startAt)
    }

    var relativeStartDayText: String {
        let calendar = EventFeedItem.calendar(timeZone: displayTimeZone)
        let startOfToday = calendar.startOfDay(for: Date())
        let startOfEventDay = calendar.startOfDay(for: startAt)
        let dayOffset = calendar.dateComponents([.day], from: startOfToday, to: startOfEventDay).day ?? 0

        switch dayOffset {
        case ..<0:
            return ""
        case 0:
            return " (today)"
        case 1:
            return " (tomorrow)"
        default:
            return " (in \(dayOffset) days)"
        }
    }

    func isInLocalWeek(startingAt weekStart: Date) -> Bool {
        guard let nextWeekStart = Self.weekCalendar.date(byAdding: .day, value: 7, to: weekStart) else {
            return true
        }

        let localDay = localStartOfDay()
        return localDay >= weekStart && localDay < nextWeekStart
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

    var socialAttendees: [EventSocialAttendee] {
        (friendsGoing + friendsInterested).map { rsvp in
            EventSocialAttendee(
                id: rsvp.user.id,
                firstName: rsvp.user.firstName,
                lastName: rsvp.user.lastName,
                avatarImageURL: rsvp.user.avatarImageURL,
                status: rsvp.status
            )
        }
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

    private static let weekCalendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.firstWeekday = 2
        return calendar
    }()

    private static func calendar(timeZone: TimeZone) -> Calendar {
        var calendar = weekCalendar
        calendar.timeZone = timeZone
        return calendar
    }

    private static func formatter(format: String, timeZone: TimeZone) -> DateFormatter {
        let formatter = DateFormatter()
        formatter.dateFormat = format
        formatter.timeZone = timeZone
        return formatter
    }
}

private extension TimeZone {
    static func usStateFallback(for state: String) -> TimeZone? {
        let identifier: String?

        switch state.uppercased() {
        case "CT", "DC", "DE", "FL", "GA", "IN", "KY", "MA", "MD", "ME", "MI",
             "NC", "NH", "NJ", "NY", "OH", "PA", "RI", "SC", "TN", "VA", "VT",
             "WV":
            identifier = "America/New_York"
        case "AL", "AR", "IA", "IL", "KS", "LA", "MN", "MO", "MS", "ND", "NE",
             "OK", "SD", "TX", "WI":
            identifier = "America/Chicago"
        case "AZ", "CO", "ID", "MT", "NM", "UT", "WY":
            identifier = "America/Denver"
        case "CA", "NV", "OR", "WA":
            identifier = "America/Los_Angeles"
        case "AK":
            identifier = "America/Anchorage"
        case "HI":
            identifier = "Pacific/Honolulu"
        default:
            identifier = nil
        }

        return identifier.flatMap(TimeZone.init(identifier:))
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
        timeZone = try container.decodeIfPresent(String.self, forKey: .timeZone)
        metroAreaCity = try container.decodeIfPresent(String.self, forKey: .metroAreaCity)
        metroAreaState = try container.decodeIfPresent(String.self, forKey: .metroAreaState)
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
        status = try container.decodeIfPresent(EventStatus.self, forKey: .status) ?? .active
        updatedAt = try container.decodeIfPresent(Date.self, forKey: .updatedAt)
        canEdit = try container.decodeIfPresent(Bool.self, forKey: .canEdit) ?? false
        isFollowed = try container.decodeIfPresent(Bool.self, forKey: .isFollowed) ?? false
        isCreatedByCurrentUser = try container.decodeIfPresent(Bool.self, forKey: .isCreatedByCurrentUser) ?? false
        userRsvpStatus = try container.decodeIfPresent(EventRSVPStatus.self, forKey: .userRsvpStatus)
        userRsvpNotGoingReason = try container.decodeIfPresent(
            EventRSVPDeclineReason.self,
            forKey: .userRsvpNotGoingReason
        )
        friendsGoing = try container.decodeIfPresent([EventSocialRSVP].self, forKey: .friendsGoing) ?? []
        friendsInterested = try container.decodeIfPresent([EventSocialRSVP].self, forKey: .friendsInterested) ?? []
    }
}

struct EventSocialRSVP: Codable, Hashable, Sendable {
    let status: EventRSVPStatus
    let user: EventSocialUser
}

struct EventSocialUser: Codable, Identifiable, Hashable, Sendable {
    let id: String
    let firstName: String?
    let lastName: String?
    let avatarImageURL: URL?
    var isCurrentUser = false
    var isFriend = false

    enum CodingKeys: String, CodingKey {
        case id
        case firstName
        case lastName
        case avatarImageURL = "avatarImageUrl"
        case isCurrentUser
        case isFriend
    }
}

extension EventSocialUser {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        id = try container.decode(String.self, forKey: .id)
        firstName = try container.decodeIfPresent(String.self, forKey: .firstName)
        lastName = try container.decodeIfPresent(String.self, forKey: .lastName)
        avatarImageURL = try container.decodeOptionalURL(forKey: .avatarImageURL)
        isCurrentUser = try container.decodeIfPresent(Bool.self, forKey: .isCurrentUser) ?? false
        isFriend = try container.decodeIfPresent(Bool.self, forKey: .isFriend) ?? false
    }
}

struct EventSocialAttendee: Identifiable, Hashable, Sendable {
    let id: String
    let firstName: String?
    let lastName: String?
    let avatarImageURL: URL?
    let status: EventRSVPStatus
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
