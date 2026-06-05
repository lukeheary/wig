import Foundation

struct GiftList: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let title: String
    let description: String?
    let ownerID: UUID?
    let createdAt: Date?
    let updatedAt: Date?
}
