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

    static func mobileEventsPreview(
        startDate: Date? = nil,
        endDate: Date? = nil,
        limit: Int = 20
    ) -> Endpoint<MobileEventsResponse> {
        var queryItems = [URLQueryItem(name: "limit", value: String(limit))]

        if let startDate {
            queryItems.append(URLQueryItem(name: "startDate", value: ISO8601DateFormatter.wigStandard.string(from: startDate)))
        }

        if let endDate {
            queryItems.append(URLQueryItem(name: "endDate", value: ISO8601DateFormatter.wigStandard.string(from: endDate)))
        }

        return Endpoint<MobileEventsResponse>(
            path: "/api/mobile/events",
            queryItems: queryItems,
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobileEventReviewPrompt() -> Endpoint<MobileEventReviewPromptResponse> {
        Endpoint(
            path: "/api/mobile/event-review-prompt",
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

    static func mobileCategories() -> Endpoint<MobileCategoriesResponse> {
        Endpoint(
            path: "/api/mobile/categories",
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobileEventTitleSuggestions(
        venueID: UUID,
        query: String,
        limit: Int = 8
    ) -> Endpoint<MobileEventTitleSuggestionsResponse> {
        Endpoint(
            path: "/api/mobile/event-title-suggestions",
            queryItems: [
                URLQueryItem(name: "venueId", value: venueID.uuidString),
                URLQueryItem(name: "query", value: query),
                URLQueryItem(name: "limit", value: String(limit)),
            ],
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

    static func mobileGooglePlaceSearch(
        query: String,
        searchType: MobileGooglePlaceSearchType = .establishments
    ) -> Endpoint<MobileGooglePlaceSearchResponse> {
        Endpoint(
            path: "/api/mobile/google-places",
            queryItems: [
                URLQueryItem(name: "query", value: query),
                URLQueryItem(name: "searchType", value: searchType.rawValue),
            ],
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobileGooglePlaceDetail(
        placeID: String,
        searchType: MobileGooglePlaceSearchType = .establishments
    ) -> Endpoint<MobileGooglePlaceDetail> {
        Endpoint(
            path: "/api/mobile/google-places/\(placeID)",
            queryItems: [URLQueryItem(name: "searchType", value: searchType.rawValue)],
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobilePlaceScrapers(slug: String) -> Endpoint<MobilePlaceScrapersResponse> {
        Endpoint(
            path: "/api/mobile/places/\(slug)/scrapers",
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func replaceMobilePlaceScrapers(
        slug: String,
        scrapers: [MobilePlaceScraperConfig]
    ) throws -> Endpoint<MobilePlaceScrapersResponse> {
        Endpoint(
            path: "/api/mobile/places/\(slug)/scrapers",
            method: .put,
            body: try JSONEncoder().encode(
                MobilePlaceScrapersUpdateRequest(scrapers: scrapers)
            ),
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

    static func mobileAdminStatus() -> Endpoint<MobileAdminStatusResponse> {
        Endpoint(
            path: "/api/mobile/admin-status",
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobileAdminScrapers(search: String? = nil) -> Endpoint<MobileAdminScrapersResponse> {
        var queryItems: [URLQueryItem] = []
        if let search, !search.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            queryItems.append(URLQueryItem(name: "search", value: search))
        }

        return Endpoint(
            path: "/api/mobile/admin/scrapers",
            queryItems: queryItems,
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobileRunAdminScraper(scraperID: UUID) throws -> Endpoint<MobileAdminScraperRunResponse> {
        Endpoint(
            path: "/api/mobile/admin/scrapers",
            method: .post,
            body: try JSONEncoder().encode(
                MobileAdminScraperRunRequest(scraperId: scraperID.uuidString)
            ),
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobileImportAdminScraperEvents(
        scraperID: UUID,
        overrideExisting: Bool = false,
        events: [MobileAdminScrapedEventImport]
    ) throws -> Endpoint<MobileAdminScraperImportResponse> {
        Endpoint(
            path: "/api/mobile/admin/scrapers",
            method: .patch,
            body: try JSONEncoder().encode(
                MobileAdminScraperImportRequest(
                    scraperId: scraperID.uuidString,
                    overrideExisting: overrideExisting,
                    events: events
                )
            ),
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobileUserProfile(userID: String) -> Endpoint<UserProfileResponse> {
        Endpoint(
            path: "/api/mobile/users/\(userID)",
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

    static func acceptMobileFriendRequest(friendRequestID: String) -> Endpoint<EmptyResponse> {
        Endpoint(
            path: "/api/mobile/friends/\(friendRequestID)/accept",
            method: .post,
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func declineMobileFriendRequest(friendRequestID: String) -> Endpoint<EmptyResponse> {
        Endpoint(
            path: "/api/mobile/friends/\(friendRequestID)",
            method: .delete,
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

    static func mobileSearch(query: String, limit: Int = 20) -> Endpoint<MobileSearchResponse> {
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

    static func mobileUploadImage(
        imageData: Data,
        folder: String,
        fileName: String = "cover-image.jpg"
    ) -> Endpoint<MobileUploadResponse> {
        let boundary = "wig-mobile-upload-\(UUID().uuidString)"

        return Endpoint(
            path: "/api/mobile/upload",
            method: .post,
            headers: ["Content-Type": "multipart/form-data; boundary=\(boundary)"],
            body: multipartImageBody(
                imageData: imageData,
                boundary: boundary,
                fieldName: "file",
                fileName: fileName,
                mimeType: "image/jpeg",
                additionalFields: [
                    ("folder", folder),
                    ("filename", fileName),
                ]
            ),
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobileCreateEvent(
        venueID: UUID? = nil,
        organizerID: UUID? = nil,
        title: String,
        description: String? = nil,
        coverImageURL: URL? = nil,
        eventURL: URL? = nil,
        startAt: Date,
        endAt: Date? = nil,
        address: String? = nil,
        city: String,
        state: String,
        categories: [String] = [],
        status: EventStatus = .active
    ) throws -> Endpoint<MobileEventCreateResponse> {
        let request = MobileEventCreateRequest(
            venueId: venueID?.uuidString,
            organizerId: organizerID?.uuidString,
            title: title,
            description: description,
            coverImageUrl: coverImageURL?.absoluteString,
            eventUrl: eventURL?.absoluteString,
            startAt: ISO8601DateFormatter.wigFractional.string(from: startAt),
            endAt: endAt.map { ISO8601DateFormatter.wigFractional.string(from: $0) },
            address: address,
            city: city,
            state: state,
            categories: categories,
            status: status
        )

        return Endpoint(
            path: "/api/mobile/events",
            method: .post,
            body: try JSONEncoder().encode(request),
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobileCreateEventSeries(
        venueID: UUID? = nil,
        organizerID: UUID? = nil,
        title: String,
        description: String? = nil,
        coverImageURL: URL? = nil,
        eventURL: URL? = nil,
        startAt: Date,
        endAt: Date? = nil,
        address: String? = nil,
        city: String,
        state: String,
        categories: [String] = [],
        status: EventStatus = .active,
        recurrence: MobileEventSeriesRecurrenceRequest
    ) throws -> Endpoint<MobileEventSeriesCreateResponse> {
        let request = MobileEventSeriesCreateRequest(
            venueId: venueID?.uuidString,
            organizerId: organizerID?.uuidString,
            title: title,
            description: description,
            coverImageUrl: coverImageURL?.absoluteString,
            eventUrl: eventURL?.absoluteString,
            startAt: ISO8601DateFormatter.wigFractional.string(from: startAt),
            endAt: endAt.map { ISO8601DateFormatter.wigFractional.string(from: $0) },
            address: address,
            city: city,
            state: state,
            categories: categories,
            status: status,
            recurrence: recurrence
        )

        return Endpoint(
            path: "/api/mobile/event-series",
            method: .post,
            body: try JSONEncoder().encode(request),
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobileEventSeriesDetail(seriesID: UUID) -> Endpoint<MobileEventSeriesDetail> {
        Endpoint(
            path: "/api/mobile/event-series/\(seriesID.uuidString)",
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobileUpdateEventSeries(
        seriesID: UUID,
        venueID: UUID? = nil,
        organizerID: UUID? = nil,
        title: String,
        description: String? = nil,
        coverImageURL: URL? = nil,
        removeCoverImage: Bool = false,
        eventURL: URL? = nil,
        startAt: Date,
        endAt: Date? = nil,
        address: String? = nil,
        city: String,
        state: String,
        categories: [String] = [],
        status: EventStatus = .active,
        recurrence: MobileEventSeriesRecurrenceRequest
    ) throws -> Endpoint<MobileEventSeriesCreateResponse> {
        let request = MobileEventSeriesUpdateRequest(
            venueId: venueID?.uuidString,
            organizerId: organizerID?.uuidString,
            title: title,
            description: description,
            coverImageUrl: coverImageURL?.absoluteString,
            removeCoverImage: removeCoverImage,
            eventUrl: eventURL?.absoluteString,
            startAt: ISO8601DateFormatter.wigFractional.string(from: startAt),
            endAt: endAt.map { ISO8601DateFormatter.wigFractional.string(from: $0) },
            address: address,
            city: city,
            state: state,
            categories: categories,
            status: status,
            recurrence: recurrence
        )

        return Endpoint(
            path: "/api/mobile/event-series/\(seriesID.uuidString)",
            method: .patch,
            body: try JSONEncoder().encode(request),
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func deleteMobileEventSeries(seriesID: UUID) -> Endpoint<DeleteSuccessResponse> {
        Endpoint(
            path: "/api/mobile/event-series/\(seriesID.uuidString)",
            method: .delete,
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobileCreatePlace(
        type: PlaceListItem.PlaceType,
        name: String,
        description: String? = nil,
        logoImageURL: URL? = nil,
        address: String? = nil,
        city: String? = nil,
        state: String? = nil,
        website: URL? = nil,
        instagram: String? = nil,
        hours: VenueHours? = nil,
        categories: [String] = []
    ) throws -> Endpoint<MobilePlaceCreateResponse> {
        let request = MobilePlaceCreateRequest(
            type: type.rawValue,
            name: name,
            description: description,
            logoImageUrl: logoImageURL?.absoluteString,
            address: address,
            city: city,
            state: state,
            website: website?.absoluteString,
            instagram: instagram,
            hours: hours,
            categories: categories
        )

        return Endpoint(
            path: "/api/mobile/places",
            method: .post,
            body: try JSONEncoder().encode(request),
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobileCreateMetroArea(
        name: String,
        state: String,
        latitude: Double,
        longitude: Double,
        radiusMiles: Double
    ) throws -> Endpoint<MobileMetroAreaCreateResponse> {
        Endpoint(
            path: "/api/mobile/admin/metro-areas",
            method: .post,
            body: try JSONEncoder().encode(
                MobileMetroAreaCreateRequest(
                    name: name,
                    state: state,
                    latitude: latitude,
                    longitude: longitude,
                    radiusMiles: radiusMiles
                )
            ),
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobileUpdatePlace(
        slug: String,
        type: PlaceListItem.PlaceType,
        name: String,
        description: String? = nil,
        logoImageURL: URL? = nil,
        keepExistingLogo: Bool = true,
        address: String? = nil,
        city: String? = nil,
        state: String? = nil,
        website: URL? = nil,
        instagram: String? = nil,
        hours: VenueHours? = nil,
        categories: [String] = [],
        isEnabled: Bool? = nil
    ) throws -> Endpoint<MobilePlaceCreateResponse> {
        let request = MobilePlaceUpdateRequest(
            type: type.rawValue,
            name: name,
            description: description,
            logoImageUrl: logoImageURL?.absoluteString,
            keepExistingLogo: keepExistingLogo,
            address: address,
            city: city,
            state: state,
            website: website?.absoluteString,
            instagram: instagram,
            hours: hours,
            categories: categories,
            isEnabled: isEnabled
        )

        return Endpoint(
            path: "/api/mobile/places/\(slug)",
            method: .patch,
            body: try JSONEncoder().encode(request),
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobileDeletePlace(slug: String) -> Endpoint<DeleteSuccessResponse> {
        Endpoint(
            path: "/api/mobile/places/\(slug)/delete",
            method: .post,
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobileUpdateEvent(
        eventID: UUID,
        venueID: UUID? = nil,
        organizerID: UUID? = nil,
        title: String,
        description: String? = nil,
        coverImageURL: URL? = nil,
        removeCoverImage: Bool = false,
        eventURL: URL? = nil,
        startAt: Date,
        endAt: Date? = nil,
        address: String? = nil,
        city: String,
        state: String,
        categories: [String] = [],
        status: EventStatus = .active
    ) throws -> Endpoint<EventFeedItem> {
        let request = MobileEventUpdateRequest(
            title: title,
            description: description,
            coverImageUrl: removeCoverImage ? "" : coverImageURL?.absoluteString,
            eventUrl: eventURL?.absoluteString,
            startAt: ISO8601DateFormatter.wigFractional.string(from: startAt),
            endAt: endAt.map { ISO8601DateFormatter.wigFractional.string(from: $0) },
            address: address,
            city: city,
            state: state,
            categories: categories,
            status: status,
            venueId: venueID?.uuidString,
            organizerId: organizerID?.uuidString
        )

        return Endpoint(
            path: "/api/mobile/events/\(eventID.uuidString)",
            method: .patch,
            body: try JSONEncoder().encode(request),
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func deleteMobileEvent(eventID: UUID) -> Endpoint<EmptyResponse> {
        Endpoint(
            path: "/api/mobile/events/\(eventID.uuidString)",
            method: .delete,
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobileSetEventCoverImage(
        eventID: UUID,
        coverImageURL: URL
    ) throws -> Endpoint<EmptyResponse> {
        let request = MobileEventCoverImageRequest(
            eventId: eventID.uuidString,
            coverImageUrl: coverImageURL.absoluteString
        )

        return Endpoint(
            path: "/api/mobile/events/\(eventID.uuidString)/cover-image",
            method: .post,
            body: try JSONEncoder().encode(request),
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
        notGoingReason: EventRSVPDeclineReason? = nil,
        includePartner: Bool = false,
        notifyFriends: Bool = true
    ) throws -> Endpoint<EventRSVPState> {
        Endpoint(
            path: "/api/mobile/events/\(eventID.uuidString)/rsvp",
            method: .post,
            body: try JSONEncoder().encode(
                EventRSVPUpdateRequest(
                    status: status,
                    notGoingReason: notGoingReason,
                    includePartner: includePartner,
                    notifyFriends: notifyFriends
                )
            ),
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func sendMobileEventRSVPNotification(
        eventID: UUID,
        status: EventRSVPStatus
    ) throws -> Endpoint<EmptyResponse> {
        Endpoint(
            path: "/api/mobile/events/\(eventID.uuidString)/rsvp",
            method: .post,
            body: try JSONEncoder().encode(
                EventRSVPNotificationRequest(status: status)
            ),
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func createMobileEventReview(
        eventID: UUID,
        rating: EventReviewRating,
        comment: String?
    ) throws -> Endpoint<MobileEventReview> {
        Endpoint(
            path: "/api/mobile/events/\(eventID.uuidString)/reviews",
            method: .post,
            body: try JSONEncoder().encode(
                MobileEventReviewRequest(rating: rating, comment: comment)
            ),
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobileEventReview(eventID: UUID) -> Endpoint<MobileEventReviewResponse> {
        Endpoint(
            path: "/api/mobile/events/\(eventID.uuidString)/reviews",
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobileEventAttendeeReviews(
        eventID: UUID
    ) -> Endpoint<MobileEventAttendeeReviewsResponse> {
        Endpoint(
            path: "/api/mobile/events/\(eventID.uuidString)/reviews/attendees",
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func skipMobileEventReview(eventID: UUID) -> Endpoint<EmptyResponse> {
        Endpoint(
            path: "/api/mobile/events/\(eventID.uuidString)/reviews/skip",
            method: .post,
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobileMyPartner() -> Endpoint<MobilePartnerResponse> {
        Endpoint(
            path: "/api/mobile/partners/me",
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func sendMobilePartnerRequest(recipientID: String) throws -> Endpoint<EmptyResponse> {
        Endpoint(
            path: "/api/mobile/partners/request",
            method: .post,
            body: try JSONEncoder().encode(
                MobilePartnerRequestRequest(recipientID: recipientID)
            ),
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func acceptMobilePartnerRequest(partnerID: String) -> Endpoint<EmptyResponse> {
        Endpoint(
            path: "/api/mobile/partners/\(partnerID)/accept",
            method: .post,
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func declineMobilePartnerRequest(partnerID: String) -> Endpoint<EmptyResponse> {
        Endpoint(
            path: "/api/mobile/partners/\(partnerID)",
            method: .delete,
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func removeMobilePartner() -> Endpoint<EmptyResponse> {
        Endpoint(
            path: "/api/mobile/partners/me",
            method: .delete,
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

        let decodedResponse = try decoder.decode(Response.self, from: data)
        notifyDataChange(after: endpoint)
        return decodedResponse
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

        notifyDataChange(after: endpoint)
    }

    private func notifyDataChange<Response>(after endpoint: Endpoint<Response>) {
        guard endpoint.method != .get else {
            return
        }

        NotificationCenter.default.post(name: .appDataDidChange, object: nil)
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
    struct DebugInfo: Decodable, Hashable, Sendable {
        let reason: String
        let userID: String
        let matchedUserID: String?
        let matchedByEmail: Bool

        enum CodingKeys: String, CodingKey {
            case reason
            case userID = "userId"
            case matchedUserID = "matchedUserId"
            case matchedByEmail
        }
    }

    let isOnboarding: Bool
    let username: String
    let dateOfBirth: String?
    let avatarImageURL: URL?
    let debug: DebugInfo?

    enum CodingKeys: String, CodingKey {
        case isOnboarding
        case username
        case dateOfBirth
        case avatarImageURL = "avatarImageUrl"
        case debug
    }
}

struct MobileSearchResponse: Decodable, Hashable, Sendable {
    let events: [EventFeedItem]
    let upcomingEvents: [EventFeedItem]
    let users: [FriendUserSummary]
    let recentUsers: [FriendUserSummary]
    let suggestedPlaces: [PlaceListItem]
    let places: [PlaceListItem]
}

struct MobileFriendRequestResponse: Decodable, Hashable, Sendable {
    let success: Bool
    let friendStatus: FriendUserSummary.FriendStatus
}

struct MobileAdminStatusResponse: Decodable, Hashable, Sendable {
    let isAdmin: Bool
}

struct MobileEventTitleSuggestionsResponse: Decodable, Hashable, Sendable {
    let suggestions: [MobileEventTitleSuggestion]
}

struct MobileEventTitleSuggestion: Decodable, Hashable, Identifiable, Sendable {
    let title: String
    let startAt: Date
    let endAt: Date?

    var id: String {
        "\(title)|\(startAt.timeIntervalSince1970)"
    }
}

struct MobileAdminScrapersResponse: Decodable, Hashable, Sendable {
    let scrapers: [MobileAdminScraperRow]
}

struct MobileAdminScraperRow: Decodable, Hashable, Identifiable, Sendable {
    let id: UUID
    let placeId: UUID
    let scraper: MobileScraperType
    let searchString: String
    let classificationName: String?
    let createdAt: Date
    let updatedAt: Date
    let place: MobileAdminScraperPlace
}

struct MobileAdminScraperPlace: Decodable, Hashable, Sendable {
    let id: UUID
    let type: PlaceListItem.PlaceType
    let slug: String
    let name: String
    let city: String?
    let state: String?
    let website: URL?
}

struct MobileAdminScraperRunResponse: Decodable, Hashable, Sendable {
    let scraperRow: MobileAdminScraperRow
    let venue: MobileAdminScraperVenueSummary?
    let organizer: MobileAdminScraperOrganizerSummary?
    let totalEvents: Int
    let errors: [MobileAdminScraperError]
    let events: [MobileAdminScrapedEvent]
}

struct MobileAdminScraperVenueSummary: Decodable, Hashable, Sendable {
    let id: UUID?
    let name: String
    let address: String
    let city: String
    let state: String
}

struct MobileAdminScraperOrganizerSummary: Decodable, Hashable, Sendable {
    let name: String
    let url: URL?
}

struct MobileAdminScraperError: Decodable, Hashable, Sendable, Identifiable {
    let url: String
    let error: String

    var id: String { "\(url)|\(error)" }
}

struct MobileAdminMatchedVenue: Decodable, Hashable, Sendable {
    let id: UUID
    let name: String
    let city: String?
    let state: String?
    let website: URL?
}

struct MobileAdminScrapedEvent: Decodable, Hashable, Identifiable, Sendable {
    let title: String
    let description: String?
    let coverImageURL: URL?
    let eventURL: URL?
    let externalID: String?
    let startAt: Date
    let endAt: Date?
    let venueName: String
    let address: String?
    let city: String
    let state: String
    let categories: [String]
    let visibility: String
    let source: String?
    let eventStatus: String?
    let venueMatch: MobileAdminMatchedVenue?

    enum CodingKeys: String, CodingKey {
        case title, description, venueName, address, city, state, categories, visibility, source, eventStatus, venueMatch
        case coverImageURL = "coverImageUrl"
        case eventURL = "eventUrl"
        case externalID = "externalId"
        case startAt, endAt
    }

    var id: String {
        "\(source ?? "event")|\(externalID ?? title)|\(startAt.timeIntervalSince1970)"
    }
}

struct MobileAdminScraperImportResponse: Decodable, Hashable, Sendable {
    let created: Int
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
    let includePartner: Bool
    let updatedAt: Date?
}

enum EventReviewRating: String, Codable, Hashable, Sendable {
    case lovedIt = "loved_it"
    case likedIt = "liked_it"
    case okay
    case didNotLikeIt = "did_not_like_it"
}

struct MobileEventReview: Codable, Hashable, Sendable {
    let id: UUID
    let eventId: UUID
    let rating: EventReviewRating
    let comment: String?
    let createdAt: Date
    let updatedAt: Date
}

struct MobileEventReviewResponse: Decodable, Hashable, Sendable {
    let review: MobileEventReview?
}

struct MobileEventAttendeeReview: Decodable, Hashable, Sendable {
    let userID: String
    let rating: EventReviewRating

    enum CodingKeys: String, CodingKey {
        case userID = "userId"
        case rating
    }
}

struct MobileEventAttendeeReviewsResponse: Decodable, Hashable, Sendable {
    let reviews: [MobileEventAttendeeReview]
}

private struct EventRSVPUpdateRequest: Encodable {
    let status: EventRSVPStatus
    let notGoingReason: EventRSVPDeclineReason?
    let includePartner: Bool
    let notifyFriends: Bool
}

private struct MobileEventReviewRequest: Encodable {
    let rating: EventReviewRating
    let comment: String?
}

private struct EventRSVPNotificationRequest: Encodable {
    let status: EventRSVPStatus
    let notificationOnly = true
}

struct MobilePartnerResponse: Decodable, Hashable, Sendable {
    let relationship: MobilePartnerRelationship?
}

struct MobilePartnerRelationship: Decodable, Hashable, Sendable {
    let id: String
    let status: String
    let isRequester: Bool
    let partner: MobilePartnerUser

    var isAccepted: Bool {
        status == "accepted"
    }
}

struct MobilePartnerUser: Decodable, Hashable, Sendable {
    let id: String
    let firstName: String?
    let lastName: String?
    let username: String
    let avatarImageURL: URL?

    enum CodingKeys: String, CodingKey {
        case id
        case firstName
        case lastName
        case username
        case avatarImageURL = "avatarImageUrl"
    }
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

private struct MobilePartnerRequestRequest: Encodable {
    let recipientID: String

    enum CodingKeys: String, CodingKey {
        case recipientID = "recipientId"
    }
}

private struct MobilePushTokenRequest: Encodable {
    let token: String
    let platform: String
}

private struct MobileAdminScraperRunRequest: Encodable {
    let scraperId: String
}

private struct MobileAdminScraperImportRequest: Encodable {
    let scraperId: String
    let overrideExisting: Bool
    let events: [MobileAdminScrapedEventImport]
}

struct MobileAdminScrapedEventImport: Encodable, Hashable, Sendable {
    let title: String
    let description: String?
    let coverImageUrl: String?
    let eventUrl: String?
    let externalId: String?
    let source: String?
    let startAt: String
    let endAt: String?
    let venueName: String
    let address: String?
    let city: String
    let state: String
    let categories: [String]
    let visibility: String
    let status: String
    let timeZone: String?
    let venueId: String?
}

private struct MobileEventCreateRequest: Encodable {
    let venueId: String?
    let organizerId: String?
    let title: String
    let description: String?
    let coverImageUrl: String?
    let eventUrl: String?
    let startAt: String
    let endAt: String?
    let address: String?
    let city: String
    let state: String
    let categories: [String]
    let status: EventStatus
}

private struct MobileEventSeriesCreateRequest: Encodable {
    let venueId: String?
    let organizerId: String?
    let title: String
    let description: String?
    let coverImageUrl: String?
    let eventUrl: String?
    let startAt: String
    let endAt: String?
    let address: String?
    let city: String
    let state: String
    let categories: [String]
    let status: EventStatus
    let recurrence: MobileEventSeriesRecurrenceRequest
}

private struct MobileEventSeriesUpdateRequest: Encodable {
    let venueId: String?
    let organizerId: String?
    let title: String
    let description: String?
    let coverImageUrl: String?
    let removeCoverImage: Bool
    let eventUrl: String?
    let startAt: String
    let endAt: String?
    let address: String?
    let city: String
    let state: String
    let categories: [String]
    let status: EventStatus
    let recurrence: MobileEventSeriesRecurrenceRequest
}

struct MobileEventSeriesRecurrenceRequest: Encodable, Hashable, Sendable {
    let frequency: MobileEventSeriesFrequency
    let interval: Int
    let daysOfWeek: [Int]?
    let untilDate: String?
}

private struct MobilePlaceCreateRequest: Encodable {
    let type: String
    let name: String
    let description: String?
    let logoImageUrl: String?
    let address: String?
    let city: String?
    let state: String?
    let website: String?
    let instagram: String?
    let hours: VenueHours?
    let categories: [String]
}

private struct MobilePlaceUpdateRequest: Encodable {
    let type: String
    let name: String
    let description: String?
    let logoImageUrl: String?
    let keepExistingLogo: Bool
    let address: String?
    let city: String?
    let state: String?
    let website: String?
    let instagram: String?
    let hours: VenueHours?
    let categories: [String]
    let isEnabled: Bool?
}

private struct MobileEventUpdateRequest: Encodable {
    let title: String
    let description: String?
    let coverImageUrl: String?
    let eventUrl: String?
    let startAt: String
    let endAt: String?
    let address: String?
    let city: String
    let state: String
    let categories: [String]
    let status: EventStatus
    let venueId: String?
    let organizerId: String?
}

private struct MobileEventCoverImageRequest: Encodable {
    let eventId: String
    let coverImageUrl: String

    enum CodingKeys: String, CodingKey {
        case eventId
        case coverImageUrl
    }
}

private struct MobilePlaceScrapersUpdateRequest: Encodable {
    let scrapers: [MobilePlaceScraperConfig]
}

private struct MobileMetroAreaCreateRequest: Encodable {
    let name: String
    let state: String
    let latitude: Double
    let longitude: Double
    let radiusMiles: Double
}

struct MobileUploadResponse: Decodable, Hashable, Sendable {
    let url: URL
}

struct MobileCategoriesResponse: Decodable, Hashable, Sendable {
    let categories: [MobileCategoryOption]
}

struct MobileCategoryOption: Decodable, Hashable, Sendable {
    let id: String
    let key: String
    let label: String
    let sortOrder: Int
    let isActive: Bool
}

struct MobileEventCreateResponse: Decodable, Hashable, Sendable {
    let id: UUID
}

struct MobileEventSeriesCreateResponse: Decodable, Hashable, Sendable {
    let seriesId: UUID
    let createdEvents: Int
    let firstEventId: UUID?
}

enum MobileEventSeriesFrequency: String, Codable, CaseIterable, Hashable, Sendable {
    case daily
    case weekly
    case monthly

    var title: String {
        switch self {
        case .daily:
            return "Daily"
        case .weekly:
            return "Weekly"
        case .monthly:
            return "Monthly"
        }
    }
}

struct MobilePlaceCreateResponse: Decodable, Hashable, Sendable {
    let id: UUID
    let slug: String
}

struct MobileMetroAreaCreateResponse: Decodable, Hashable, Sendable {
    let id: UUID
    let name: String
    let state: String
    let latitude: Double
    let longitude: Double
    let radiusMiles: Double
}

struct DeleteSuccessResponse: Decodable, Hashable, Sendable {
    let success: Bool
}

enum MobileScraperType: String, Codable, CaseIterable, Hashable, Sendable {
    case dice
    case posh
    case ticketmaster

    var title: String {
        switch self {
        case .dice:
            return "Dice.fm"
        case .posh:
            return "Posh"
        case .ticketmaster:
            return "Ticketmaster"
        }
    }
}

struct MobilePlaceScraperConfig: Codable, Hashable, Identifiable, Sendable {
    let id: UUID?
    let scraper: MobileScraperType
    let searchString: String
    let classificationName: String?
}

struct MobilePlaceScrapersResponse: Decodable, Hashable, Sendable {
    let scrapers: [MobilePlaceScraperConfig]
}

struct MobileGooglePlaceSearchResponse: Decodable, Hashable, Sendable {
    let predictions: [MobileGooglePlacePrediction]
}

struct MobileGooglePlacePrediction: Decodable, Hashable, Identifiable, Sendable {
    let placeID: String
    let primaryText: String
    let secondaryText: String?

    var id: String { placeID }

    enum CodingKeys: String, CodingKey {
        case placeID = "placeId"
        case primaryText
        case secondaryText
    }
}

struct MobileGooglePlaceDetail: Decodable, Hashable, Sendable {
    let placeID: String
    let name: String
    let address: String
    let city: String
    let state: String
    let formattedAddress: String
    let website: URL?
    let hours: VenueHours?
    let latitude: Double?
    let longitude: Double?

    enum CodingKeys: String, CodingKey {
        case placeID = "placeId"
        case name
        case address
        case city
        case state
        case formattedAddress
        case website
        case hours
        case latitude
        case longitude
    }
}

enum MobileGooglePlaceSearchType: String, Codable, Hashable, Sendable {
    case establishments
    case cities
}

enum EventStatus: String, Codable, CaseIterable, Hashable, Sendable {
    case active
    case cancelled
    case postponed
    case draft

    var title: String {
        switch self {
        case .active:
            return "Active"
        case .cancelled:
            return "Cancelled"
        case .postponed:
            return "Postponed"
        case .draft:
            return "Draft"
        }
    }
}

private func multipartImageBody(
    imageData: Data,
    boundary: String,
    fieldName: String,
    fileName: String,
    mimeType: String,
    additionalFields: [(String, String)] = []
) -> Data {
    var body = Data()

    for (name, value) in additionalFields {
        body.appendUTF8("--\(boundary)\r\n")
        body.appendUTF8("Content-Disposition: form-data; name=\"\(name)\"\r\n\r\n")
        body.appendUTF8("\(value)\r\n")
    }

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

extension ISO8601DateFormatter {
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
