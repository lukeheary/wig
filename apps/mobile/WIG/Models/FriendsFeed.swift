import Foundation

struct FriendsFeedResponse: Decodable, Sendable {
    let profile: FriendUserSummary?
    let friendCount: Int
    let requestCount: Int
    let friends: [FriendUserSummary]
    let receivedRequests: [FriendUserSummary]
    let sentRequests: [FriendUserSummary]
    let upcomingEvents: [EventFeedItem]
    let pastEvents: [EventFeedItem]

    init(
        profile: FriendUserSummary?,
        friendCount: Int,
        requestCount: Int,
        friends: [FriendUserSummary],
        receivedRequests: [FriendUserSummary],
        sentRequests: [FriendUserSummary],
        upcomingEvents: [EventFeedItem] = [],
        pastEvents: [EventFeedItem] = []
    ) {
        self.profile = profile
        self.friendCount = friendCount
        self.requestCount = requestCount
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
    let friends: [FriendUserSummary]
    let upcomingEvents: [EventFeedItem]
    let pastEvents: [EventFeedItem]
}

struct FriendUserSummary: Decodable, Identifiable, Hashable, Sendable {
    enum FriendStatus: String, Decodable, Hashable, Sendable {
        case none
        case accepted
        case pendingSent = "pending_sent"
        case pendingReceived = "pending_received"
    }

    let id: String
    let name: String
    let username: String
    let avatarImageURL: URL?
    let friendStatus: FriendStatus?

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case username
        case avatarImageURL = "avatarImageUrl"
        case friendStatus
    }

    init(
        id: String,
        name: String,
        username: String,
        avatarImageURL: URL?,
        friendStatus: FriendStatus? = nil
    ) {
        self.id = id
        self.name = name
        self.username = username
        self.avatarImageURL = avatarImageURL
        self.friendStatus = friendStatus
    }

    var usernameText: String {
        "@\(username)"
    }
}

extension FriendsFeedResponse {
    func updatingProfileAvatarImageURL(_ avatarImageURL: URL?) -> FriendsFeedResponse {
        FriendsFeedResponse(
            profile: profile?.updatingAvatarImageURL(avatarImageURL),
            friendCount: friendCount,
            requestCount: requestCount,
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
            name: name,
            username: username,
            avatarImageURL: avatarImageURL,
            friendStatus: friendStatus
        )
    }
}

extension FriendUserSummary {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        id = try container.decode(String.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        username = try container.decode(String.self, forKey: .username)
        avatarImageURL = try container.decodeOptionalURL(forKey: .avatarImageURL)
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
