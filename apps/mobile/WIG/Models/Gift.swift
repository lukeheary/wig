import Foundation

struct Gift: Codable, Identifiable, Hashable, Sendable {
    let id: UUID
    let title: String
    let notes: String?
    let recipientID: UUID?
    let listID: UUID?
    let createdAt: Date?
    let updatedAt: Date?
}
