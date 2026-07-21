import Foundation

struct FriendsFeedResponse: Decodable, Sendable {
    let profile: FriendUserSummary?
    let friendCount: Int
    let requestCount: Int
    let followingCount: Int
    let followedPlaces: [PlaceListItem]
    let friends: [FriendUserSummary]
    let receivedRequests: [FriendUserSummary]
    let sentRequests: [FriendUserSummary]
    let upcomingEvents: [EventFeedItem]
    let pastEvents: [EventFeedItem]

    init(
        profile: FriendUserSummary?,
        friendCount: Int,
        requestCount: Int,
        followingCount: Int = 0,
        followedPlaces: [PlaceListItem] = [],
        friends: [FriendUserSummary],
        receivedRequests: [FriendUserSummary],
        sentRequests: [FriendUserSummary],
        upcomingEvents: [EventFeedItem] = [],
        pastEvents: [EventFeedItem] = []
    ) {
        self.profile = profile
        self.friendCount = friendCount
        self.requestCount = requestCount
        self.followingCount = followingCount
        self.followedPlaces = followedPlaces
        self.friends = friends
        self.receivedRequests = receivedRequests
        self.sentRequests = sentRequests
        self.upcomingEvents = upcomingEvents
        self.pastEvents = pastEvents
    }
}

struct UserProfileResponse: Decodable, Sendable {
    let profile: FriendUserSummary?
    let friendCount: Int
    let followingCount: Int?
    let followedPlaces: [PlaceListItem]?
    let friends: [FriendUserSummary]
    let upcomingEvents: [EventFeedItem]
    let pastEvents: [EventFeedItem]

    init(
        profile: FriendUserSummary?,
        friendCount: Int,
        followingCount: Int? = nil,
        followedPlaces: [PlaceListItem]? = nil,
        friends: [FriendUserSummary],
        upcomingEvents: [EventFeedItem],
        pastEvents: [EventFeedItem]
    ) {
        self.profile = profile
        self.friendCount = friendCount
        self.followingCount = followingCount
        self.followedPlaces = followedPlaces
        self.friends = friends
        self.upcomingEvents = upcomingEvents
        self.pastEvents = pastEvents
    }
}

struct FriendUserSummary: Decodable, Identifiable, Hashable, Sendable {
    enum FriendStatus: String, Decodable, Hashable, Sendable {
        case none
        case accepted
        case pendingSent = "pending_sent"
        case pendingReceived = "pending_received"
    }

    let id: String
    let friendshipID: String?
    let name: String
    let username: String
    let avatarImageURL: URL?
    let city: String?
    let state: String?
    let friendStatus: FriendStatus?

    enum CodingKeys: String, CodingKey {
        case id
        case friendshipID = "friendshipId"
        case name
        case username
        case avatarImageURL = "avatarImageUrl"
        case city
        case state
        case friendStatus
    }

    init(
        id: String,
        friendshipID: String? = nil,
        name: String,
        username: String,
        avatarImageURL: URL?,
        city: String? = nil,
        state: String? = nil,
        friendStatus: FriendStatus? = nil
    ) {
        self.id = id
        self.friendshipID = friendshipID
        self.name = name
        self.username = username
        self.avatarImageURL = avatarImageURL
        self.city = city
        self.state = state
        self.friendStatus = friendStatus
    }

    var usernameText: String {
        "@\(username)"
    }

    var locationText: String? {
        let parts = [city, state]
            .compactMap { value -> String? in
                guard let rawValue = value else {
                    return nil
                }
                let trimmed = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !trimmed.isEmpty else {
                    return nil
                }
                return trimmed
            }
        guard !parts.isEmpty else {
            return nil
        }
        return parts.joined(separator: ", ")
    }
}

extension FriendsFeedResponse {
    func updatingProfileAvatarImageURL(_ avatarImageURL: URL?) -> FriendsFeedResponse {
        FriendsFeedResponse(
            profile: profile?.updatingAvatarImageURL(avatarImageURL),
            friendCount: friendCount,
            requestCount: requestCount,
            followingCount: followingCount,
            followedPlaces: followedPlaces,
            friends: friends,
            receivedRequests: receivedRequests,
            sentRequests: sentRequests,
            upcomingEvents: upcomingEvents,
            pastEvents: pastEvents
        )
    }
}

extension FriendUserSummary {
    func updatingAvatarImageURL(_ avatarImageURL: URL?) -> FriendUserSummary {
        FriendUserSummary(
            id: id,
            friendshipID: friendshipID,
            name: name,
            username: username,
            avatarImageURL: avatarImageURL,
            city: city,
            state: state,
            friendStatus: friendStatus
        )
    }
}

extension FriendUserSummary {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        id = try container.decode(String.self, forKey: .id)
        friendshipID = try container.decodeIfPresent(String.self, forKey: .friendshipID)
        name = try container.decode(String.self, forKey: .name)
        username = try container.decode(String.self, forKey: .username)
        avatarImageURL = try container.decodeOptionalURL(forKey: .avatarImageURL)
        city = try container.decodeIfPresent(String.self, forKey: .city)
        state = try container.decodeIfPresent(String.self, forKey: .state)
        friendStatus = try container.decodeIfPresent(FriendStatus.self, forKey: .friendStatus)
    }
}

private extension KeyedDecodingContainer where Key == FriendUserSummary.CodingKeys {
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
