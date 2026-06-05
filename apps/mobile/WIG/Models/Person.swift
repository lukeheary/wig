import Foundation

struct Person: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let displayName: String
    let emailAddress: String?
    let birthday: Date?
    let createdAt: Date?
    let updatedAt: Date?
}
