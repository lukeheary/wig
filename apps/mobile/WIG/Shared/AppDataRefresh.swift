import Foundation

struct PlaceFollowChange: Sendable {
    let slug: String
    let isFollowed: Bool
}

extension Notification.Name {
    static let appDataDidChange = Notification.Name("appDataDidChange")
    static let placeFollowDidChange = Notification.Name("placeFollowDidChange")
}
