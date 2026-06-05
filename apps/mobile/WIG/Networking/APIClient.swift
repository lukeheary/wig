import ClerkKit
import Foundation
import SwiftUI

protocol AuthTokenProviding: Sendable {
    func authToken() async throws -> String?
}

struct ClerkSessionTokenProvider: AuthTokenProviding {
    let clerk: Clerk
    let jwtTemplate: String?

    func authToken() async throws -> String? {
        if let jwtTemplate, !jwtTemplate.isEmpty {
            return try await clerk.session?.getToken(.init(template: jwtTemplate))
        }

        return try await clerk.session?.getToken()
    }
}

struct APIClient: Sendable {
    struct Endpoint<Response: Decodable>: Sendable {
        let path: String
        var method: HTTPMethod = .get
        var headers: [String: String] = [:]
        var queryItems: [URLQueryItem] = []
        var body: Data?
        var requiresAuthentication = true
        var includesAuthenticationIfAvailable = false

        init(
            path: String,
            method: HTTPMethod = .get,
            headers: [String: String] = [:],
            queryItems: [URLQueryItem] = [],
            body: Data? = nil,
            requiresAuthentication: Bool = true,
            includesAuthenticationIfAvailable: Bool = false
        ) {
            self.path = path
            self.method = method
            self.headers = headers
            self.queryItems = queryItems
            self.body = body
            self.requiresAuthentication = requiresAuthentication
            self.includesAuthenticationIfAvailable = includesAuthenticationIfAvailable
        }
    }

    enum HTTPMethod: String, Sendable {
        case get = "GET"
        case post = "POST"
        case put = "PUT"
        case patch = "PATCH"
        case delete = "DELETE"
    }

    enum APIError: Error {
        case invalidURL(String)
        case missingAuthenticationToken
        case invalidResponse
        case requestFailed(statusCode: Int, payload: Data)
    }

    private let baseURL: URL
    private let session: URLSession
    private let decoder: JSONDecoder
    private let tokenProvider: AuthTokenProviding

    init(
        baseURL: URL,
        session: URLSession = .shared,
        decoder: JSONDecoder = .wigDefault,
        tokenProvider: AuthTokenProviding
    ) {
        self.baseURL = baseURL
        self.session = session
        self.decoder = decoder
        self.tokenProvider = tokenProvider
    }

    static func live(baseURL: URL, tokenProvider: AuthTokenProviding) -> APIClient {
        APIClient(baseURL: baseURL, tokenProvider: tokenProvider)
    }

    static func mobileEventsPreview(limit: Int = 20) -> Endpoint<MobileEventsResponse> {
        Endpoint(
            path: "/api/mobile/events",
            queryItems: [URLQueryItem(name: "limit", value: String(limit))],
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobilePlaces(limit: Int = 100) -> Endpoint<MobilePlacesResponse> {
        Endpoint(
            path: "/api/mobile/places",
            queryItems: [URLQueryItem(name: "limit", value: String(limit))],
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobilePlaceDetail(slug: String) -> Endpoint<PlaceDetail> {
        Endpoint(
            path: "/api/mobile/places/\(slug)",
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func followMobilePlace(slug: String) -> Endpoint<PlaceFollowState> {
        Endpoint(
            path: "/api/mobile/places/\(slug)/follow",
            method: .post,
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func unfollowMobilePlace(slug: String) -> Endpoint<PlaceFollowState> {
        Endpoint(
            path: "/api/mobile/places/\(slug)/follow",
            method: .delete,
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobileActivity(limit: Int = 40) -> Endpoint<ActivityFeedResponse> {
        Endpoint(
            path: "/api/mobile/activity",
            queryItems: [URLQueryItem(name: "limit", value: String(limit))],
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobileHomeActivity(limit: Int = 3) -> Endpoint<ActivityFeedResponse> {
        Endpoint(
            path: "/api/mobile/home-activity",
            queryItems: [URLQueryItem(name: "limit", value: String(limit))],
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobileFriends() -> Endpoint<FriendsFeedResponse> {
        Endpoint(
            path: "/api/mobile/friends",
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func sendMobileFriendRequest(friendUserID: String) throws -> Endpoint<MobileFriendRequestResponse> {
        Endpoint(
            path: "/api/mobile/friends/request",
            method: .post,
            body: try JSONEncoder().encode(
                MobileFriendRequestRequest(friendUserID: friendUserID)
            ),
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func registerMobilePushToken(token: String, platform: String) throws -> Endpoint<EmptyResponse> {
        Endpoint(
            path: "/api/mobile/push-token",
            method: .post,
            body: try JSONEncoder().encode(
                MobilePushTokenRequest(token: token, platform: platform)
            ),
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobileSearch(query: String, limit: Int = 12) -> Endpoint<MobileSearchResponse> {
        Endpoint(
            path: "/api/mobile/search",
            queryItems: [
                URLQueryItem(name: "query", value: query),
                URLQueryItem(name: "limit", value: String(limit)),
            ],
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func updateMobileProfileAvatar(imageData: Data) -> Endpoint<ProfileAvatarUpdateResponse> {
        let boundary = "wig-avatar-\(UUID().uuidString)"

        return Endpoint(
            path: "/api/mobile/profile/avatar",
            method: .post,
            headers: ["Content-Type": "multipart/form-data; boundary=\(boundary)"],
            body: multipartImageBody(
                imageData: imageData,
                boundary: boundary,
                fieldName: "file",
                fileName: "avatar-image.jpg",
                mimeType: "image/jpeg"
            ),
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobileOnboardingState() -> Endpoint<MobileOnboardingState> {
        Endpoint(
            path: "/api/mobile/onboarding",
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func completeMobileOnboarding(
        username: String,
        dateOfBirth: String
    ) throws -> Endpoint<MobileOnboardingState> {
        Endpoint(
            path: "/api/mobile/onboarding",
            method: .post,
            body: try JSONEncoder().encode(
                MobileOnboardingUpdateRequest(
                    username: username,
                    dateOfBirth: dateOfBirth
                )
            ),
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobileEventRSVP(eventID: UUID) -> Endpoint<EventRSVPState> {
        Endpoint(
            path: "/api/mobile/events/\(eventID.uuidString)/rsvp",
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func updateMobileEventRSVP(
        eventID: UUID,
        status: EventRSVPStatus,
        notGoingReason: EventRSVPDeclineReason? = nil
    ) throws -> Endpoint<EventRSVPState> {
        Endpoint(
            path: "/api/mobile/events/\(eventID.uuidString)/rsvp",
            method: .post,
            body: try JSONEncoder().encode(
                EventRSVPUpdateRequest(status: status, notGoingReason: notGoingReason)
            ),
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func deleteMobileEventRSVP(eventID: UUID) -> Endpoint<EventRSVPState> {
        Endpoint(
            path: "/api/mobile/events/\(eventID.uuidString)/rsvp",
            method: .delete,
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    func send<Response: Decodable>(_ endpoint: Endpoint<Response>) async throws -> Response {
        let request = try await makeRequest(for: endpoint)
        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        guard 200 ..< 300 ~= httpResponse.statusCode else {
            throw APIError.requestFailed(statusCode: httpResponse.statusCode, payload: data)
        }

        return try decoder.decode(Response.self, from: data)
    }

    func send(_ endpoint: Endpoint<EmptyResponse>) async throws {
        let request = try await makeRequest(for: endpoint)
        let (_, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        guard 200 ..< 300 ~= httpResponse.statusCode else {
            throw APIError.requestFailed(statusCode: httpResponse.statusCode, payload: Data())
        }
    }

    private func makeRequest<Response>(for endpoint: Endpoint<Response>) async throws -> URLRequest {
        guard var components = URLComponents(url: baseURL, resolvingAgainstBaseURL: false) else {
            throw APIError.invalidURL(baseURL.absoluteString)
        }

        let basePath = components.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        let endpointPath = endpoint.path.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
        components.path = [basePath, endpointPath]
            .filter { !$0.isEmpty }
            .joined(separator: "/")
            .appendingSlashPrefix()

        if !endpoint.queryItems.isEmpty {
            components.queryItems = endpoint.queryItems
        }

        guard let url = components.url else {
            throw APIError.invalidURL("\(baseURL.absoluteString) + \(endpoint.path)")
        }

        var request = URLRequest(url: url)
        request.httpMethod = endpoint.method.rawValue
        request.httpBody = endpoint.body
        request.setValue("application/json", forHTTPHeaderField: "Accept")

        if endpoint.body != nil {
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        }

        for (header, value) in endpoint.headers {
            request.setValue(value, forHTTPHeaderField: header)
        }

        if endpoint.requiresAuthentication || endpoint.includesAuthenticationIfAvailable {
            let token = try await tokenProvider.authToken()

            if endpoint.requiresAuthentication, token == nil {
                throw APIError.missingAuthenticationToken
            }

            if let token {
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
            }
        }

        return request
    }
}

extension APIClient.APIError: LocalizedError {
    var errorDescription: String? {
        switch self {
        case .invalidURL(let value):
            return "Invalid API URL: \(value)"
        case .missingAuthenticationToken:
            return "Missing authentication token."
        case .invalidResponse:
            return "The server returned an invalid response."
        case .requestFailed(let statusCode, let payload):
            let body = String(data: payload, encoding: .utf8)?
                .replacingOccurrences(of: "\n", with: " ")
                .trimmingCharacters(in: .whitespacesAndNewlines)
            let summary = body.map { String($0.prefix(180)) }
            return "Request failed with HTTP \(statusCode)\(summary.map { ": \($0)" } ?? ".")"
        }
    }
}

private extension String {
    func appendingSlashPrefix() -> String {
        hasPrefix("/") ? self : "/\(self)"
    }
}

struct EmptyResponse: Decodable, Sendable {}

struct PlaceFollowState: Decodable, Hashable, Sendable {
    let isFollowed: Bool
}

struct ProfileAvatarUpdateResponse: Decodable, Hashable, Sendable {
    let avatarImageURL: URL?

    enum CodingKeys: String, CodingKey {
        case avatarImageURL = "avatarImageUrl"
    }
}

struct MobileOnboardingState: Decodable, Hashable, Sendable {
    let isOnboarding: Bool
    let username: String
    let dateOfBirth: String?
    let avatarImageURL: URL?

    enum CodingKeys: String, CodingKey {
        case isOnboarding
        case username
        case dateOfBirth
        case avatarImageURL = "avatarImageUrl"
    }
}

struct MobileSearchResponse: Decodable, Hashable, Sendable {
    let users: [FriendUserSummary]
    let places: [PlaceListItem]
}

struct MobileFriendRequestResponse: Decodable, Hashable, Sendable {
    let success: Bool
    let friendStatus: FriendUserSummary.FriendStatus
}

enum EventRSVPStatus: String, Codable, Hashable, Sendable {
    case going
    case interested
    case notGoing = "not_going"
}

enum EventRSVPDeclineReason: String, Codable, CaseIterable, Hashable, Sendable {
    case busy
    case outOfTown = "out_of_town"
    case working
    case layingLow = "laying_low"

    var title: String {
        switch self {
        case .busy:
            return "Busy"
        case .outOfTown:
            return "Out of town"
        case .working:
            return "Working"
        case .layingLow:
            return "Laying low"
        }
    }
}

struct EventRSVPState: Decodable, Hashable, Sendable {
    let status: EventRSVPStatus?
    let notGoingReason: EventRSVPDeclineReason?
    let updatedAt: Date?
}

private struct EventRSVPUpdateRequest: Encodable {
    let status: EventRSVPStatus
    let notGoingReason: EventRSVPDeclineReason?
}

private struct MobileOnboardingUpdateRequest: Encodable {
    let username: String
    let dateOfBirth: String
}

private struct MobileFriendRequestRequest: Encodable {
    let friendUserID: String

    enum CodingKeys: String, CodingKey {
        case friendUserID = "friendUserId"
    }
}

private struct MobilePushTokenRequest: Encodable {
    let token: String
    let platform: String
}

private func multipartImageBody(
    imageData: Data,
    boundary: String,
    fieldName: String,
    fileName: String,
    mimeType: String
) -> Data {
    var body = Data()
    body.appendUTF8("--\(boundary)\r\n")
    body.appendUTF8("Content-Disposition: form-data; name=\"\(fieldName)\"; filename=\"\(fileName)\"\r\n")
    body.appendUTF8("Content-Type: \(mimeType)\r\n\r\n")
    body.append(imageData)
    body.appendUTF8("\r\n--\(boundary)--\r\n")
    return body
}

private extension Data {
    mutating func appendUTF8(_ string: String) {
        append(Data(string.utf8))
    }
}

extension JSONDecoder {
    static var wigDefault: JSONDecoder {
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)

            if let date = ISO8601DateFormatter.wigFractional.date(from: value)
                ?? ISO8601DateFormatter.wigStandard.date(from: value)
            {
                return date
            }

            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Invalid ISO8601 date string: \(value)"
            )
        }
        decoder.keyDecodingStrategy = .convertFromSnakeCase
        return decoder
    }
}

private extension ISO8601DateFormatter {
    static let wigStandard: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        return formatter
    }()

    static let wigFractional: ISO8601DateFormatter = {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter
    }()
}

private struct APIClientEnvironmentKey: EnvironmentKey {
    static let defaultValue = APIClient.live(
        baseURL: URL(string: "https://invalid.local")!,
        tokenProvider: NoopTokenProvider()
    )
}

extension EnvironmentValues {
    var apiClient: APIClient {
        get { self[APIClientEnvironmentKey.self] }
        set { self[APIClientEnvironmentKey.self] = newValue }
    }
}

private struct NoopTokenProvider: AuthTokenProviding {
    func authToken() async throws -> String? {
        nil
    }
}
