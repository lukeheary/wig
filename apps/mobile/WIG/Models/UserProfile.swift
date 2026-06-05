import Foundation

struct UserProfile: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let clerkUserID: String
    let displayName: String?
    let emailAddress: String?
    let avatarURL: URL?
    let createdAt: Date?
    let updatedAt: Date?
}
