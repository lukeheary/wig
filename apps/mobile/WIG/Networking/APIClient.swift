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

        init(
            path: String,
            method: HTTPMethod = .get,
            headers: [String: String] = [:],
            queryItems: [URLQueryItem] = [],
            body: Data? = nil,
            requiresAuthentication: Bool = true
        ) {
            self.path = path
            self.method = method
            self.headers = headers
            self.queryItems = queryItems
            self.body = body
            self.requiresAuthentication = requiresAuthentication
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
        case invalidURL
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

    static func mobileEventsPreview(limit: Int = 20) -> Endpoint<[EventFeedItem]> {
        Endpoint(
            path: "/api/mobile/events",
            queryItems: [URLQueryItem(name: "limit", value: String(limit))],
            requiresAuthentication: false
        )
    }

    static func mobilePlaces(limit: Int = 100) -> Endpoint<[PlaceListItem]> {
        Endpoint(
            path: "/api/mobile/places",
            queryItems: [URLQueryItem(name: "limit", value: String(limit))],
            requiresAuthentication: false
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
        guard var components = URLComponents(
            url: baseURL.appending(path: endpoint.path),
            resolvingAgainstBaseURL: false
        ) else {
            throw APIError.invalidURL
        }

        if !endpoint.queryItems.isEmpty {
            components.queryItems = endpoint.queryItems
        }

        guard let url = components.url else {
            throw APIError.invalidURL
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

        if endpoint.requiresAuthentication {
            guard let token = try await tokenProvider.authToken() else {
                throw APIError.missingAuthenticationToken
            }

            request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
        }

        return request
    }
}

struct EmptyResponse: Decodable, Sendable {}

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
