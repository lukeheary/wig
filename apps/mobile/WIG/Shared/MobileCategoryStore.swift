import Foundation

@MainActor
enum MobileCategoryStore {
    private static var cachedCategories: [MobileCategoryOption]?
    private static var inFlightLoad: Task<[MobileCategoryOption], Error>?

    static func load(using apiClient: APIClient) async throws -> [MobileCategoryOption] {
        if let cachedCategories {
            return cachedCategories
        }

        if let inFlightLoad {
            return try await inFlightLoad.value
        }

        let loadTask = Task<[MobileCategoryOption], Error> {
            let response = try await apiClient.send(APIClient.mobileCategories())
            return response.categories.filter(\.isActive)
        }
        inFlightLoad = loadTask

        do {
            let categories = try await loadTask.value
            cachedCategories = categories
            inFlightLoad = nil
            return categories
        } catch {
            inFlightLoad = nil
            throw error
        }
    }

    static func preload(using apiClient: APIClient) async {
        _ = try? await load(using: apiClient)
    }
}
