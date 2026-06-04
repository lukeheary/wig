import Foundation

struct FriendsFeedResponse: Decodable, Sendable {
    let profile: FriendUserSummary?
    let friendCount: Int
    let requestCount: Int
    let friends: [FriendUserSummary]
    let receivedRequests: [FriendUserSummary]
    let sentRequests: [FriendUserSummary]
}

struct FriendUserSummary: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let username: String
    let avatarImageURL: URL?

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case username
        case avatarImageURL = "avatarImageUrl"
    }

    var usernameText: String {
        "@\(username)"
    }
}

extension FriendUserSummary {
    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        id = try container.decode(String.self, forKey: .id)
        name = try container.decode(String.self, forKey: .name)
        username = try container.decode(String.self, forKey: .username)
        avatarImageURL = try container.decodeOptionalURL(forKey: .avatarImageURL)
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
