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
        var timeoutInterval: TimeInterval?
        var notifiesDataChange = true

        init(
            path: String,
            method: HTTPMethod = .get,
            headers: [String: String] = [:],
            queryItems: [URLQueryItem] = [],
            body: Data? = nil,
            requiresAuthentication: Bool = true,
            includesAuthenticationIfAvailable: Bool = false,
            timeoutInterval: TimeInterval? = nil,
            notifiesDataChange: Bool = true
        ) {
            self.path = path
            self.method = method
            self.headers = headers
            self.queryItems = queryItems
            self.body = body
            self.requiresAuthentication = requiresAuthentication
            self.includesAuthenticationIfAvailable = includesAuthenticationIfAvailable
            self.timeoutInterval = timeoutInterval
            self.notifiesDataChange = notifiesDataChange
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

    static func mobileActivationState() -> Endpoint<MobileActivationState> {
        Endpoint(path: "/api/mobile/activation")
    }

    static func submitMobileSupportTicket(
        type: MobileSupportTicketType,
        severity: MobileSupportTicketSeverity,
        subject: String,
        message: String,
        reportedEntityType: MobileSupportReportedEntityType? = nil,
        reportedEntityID: String? = nil
    ) throws -> Endpoint<MobileSupportTicketSubmissionResponse> {
        Endpoint(
            path: "/api/mobile/support",
            method: .post,
            body: try JSONEncoder().encode(
                MobileSupportTicketSubmissionRequest(
                    type: type,
                    severity: severity,
                    subject: subject,
                    message: message,
                    reportedEntityType: reportedEntityType,
                    reportedEntityID: reportedEntityID
                )
            ),
            notifiesDataChange: false
        )
    }

    static func mobileSupportTickets() -> Endpoint<MobileSupportTicketsResponse> {
        Endpoint(path: "/api/mobile/support")
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

    static func mobilePlaceDetail(
        slug: String,
        pastEventsCursor: PlaceEventsCursor? = nil
    ) -> Endpoint<PlaceDetail> {
        var queryItems: [URLQueryItem] = []
        if let pastEventsCursor {
            queryItems = [
                URLQueryItem(
                    name: "pastStartAt",
                    value: ISO8601DateFormatter.wigStandard.string(from: pastEventsCursor.startAt)
                ),
                URLQueryItem(name: "pastId", value: pastEventsCursor.id.uuidString),
            ]
        }

        return Endpoint(
            path: "/api/mobile/places/\(slug)",
            queryItems: queryItems,
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
            includesAuthenticationIfAvailable: true,
            notifiesDataChange: false
        )
    }

    static func unfollowMobilePlace(slug: String) -> Endpoint<PlaceFollowState> {
        Endpoint(
            path: "/api/mobile/places/\(slug)/follow",
            method: .delete,
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true,
            notifiesDataChange: false
        )
    }

    static func hideMobilePlaceFromHome(slug: String) -> Endpoint<PlaceHomeVisibilityState> {
        Endpoint(
            path: "/api/mobile/places/\(slug)/home-hide",
            method: .post,
            timeoutInterval: 20,
            notifiesDataChange: false
        )
    }

    static func showMobilePlaceOnHome(slug: String) -> Endpoint<PlaceHomeVisibilityState> {
        Endpoint(
            path: "/api/mobile/places/\(slug)/home-hide",
            method: .delete,
            timeoutInterval: 20,
            notifiesDataChange: false
        )
    }

    static func mobilePlaceEventSeries(slug: String) -> Endpoint<MobilePlaceEventSeriesResponse> {
        Endpoint(
            path: "/api/mobile/places/\(slug)/event-series",
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobilePlaceFollowers(slug: String) -> Endpoint<MobilePlaceFollowersResponse> {
        Endpoint(
            path: "/api/mobile/places/\(slug)/followers",
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobilePlaceMembers(slug: String) -> Endpoint<MobilePlaceMembersResponse> {
        Endpoint(
            path: "/api/mobile/places/\(slug)/members",
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobileAddUserToPlace(
        slug: String,
        userId: String,
        role: PlaceMemberRole
    ) throws -> Endpoint<MobileAddUserToPlaceResponse> {
        Endpoint(
            path: "/api/mobile/places/\(slug)/members",
            method: .post,
            body: try JSONEncoder().encode(MobileAddUserToPlaceRequest(userId: userId, role: role))
        )
    }

    static func mobileRemoveUserFromPlace(
        slug: String,
        userId: String
    ) -> Endpoint<DeleteSuccessResponse> {
        Endpoint(
            path: "/api/mobile/places/\(slug)/members",
            method: .delete,
            queryItems: [URLQueryItem(name: "userId", value: userId)]
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

    static func mobileHomeActivity(
        limit: Int = 3,
        metroCity: String? = nil,
        metroState: String? = nil,
        includesAllMetros: Bool = false
    ) -> Endpoint<ActivityFeedResponse> {
        var queryItems = [URLQueryItem(name: "limit", value: String(limit))]
        if includesAllMetros {
            queryItems.append(URLQueryItem(name: "metroScope", value: "all"))
        } else if let metroCity, let metroState {
            queryItems.append(URLQueryItem(name: "metroCity", value: metroCity))
            queryItems.append(URLQueryItem(name: "metroState", value: metroState))
        }

        return Endpoint(
            path: "/api/mobile/home-activity",
            queryItems: queryItems,
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

    static func mobilePromotableEvents() -> Endpoint<PromotableEventsResponse> {
        Endpoint(path: "/api/mobile/profile/promoting")
    }

    static func setMobileEventPromoted(
        eventID: UUID,
        promoted: Bool,
        promo: String? = nil
    ) throws -> Endpoint<PromotedEventUpdateResponse> {
        Endpoint(
            path: "/api/mobile/profile/promoting",
            method: .patch,
            body: try JSONEncoder().encode(
                PromotedEventUpdateRequest(eventId: eventID, promoted: promoted, promo: promo)
            )
        )
    }

    static func mobileAdminStatus() -> Endpoint<MobileAdminStatusResponse> {
        Endpoint(
            path: "/api/mobile/admin-status",
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobileAdminSupportTickets() -> Endpoint<MobileAdminSupportTicketsResponse> {
        Endpoint(path: "/api/mobile/admin/support-tickets")
    }

    static func updateMobileAdminSupportTicket(
        id: UUID,
        status: MobileSupportTicketStatus
    ) throws -> Endpoint<MobileAdminSupportTicketUpdateResponse> {
        Endpoint(
            path: "/api/mobile/admin/support-tickets",
            method: .patch,
            body: try JSONEncoder().encode(
                MobileAdminSupportTicketUpdateRequest(
                    ticketId: id.uuidString,
                    status: status
                )
            )
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

    static func mobileBlockedUsers() -> Endpoint<MobileBlockedUsersResponse> {
        Endpoint(path: "/api/mobile/blocks")
    }

    static func blockMobileUser(userID: String) -> Endpoint<DeleteSuccessResponse> {
        Endpoint(
            path: "/api/mobile/users/\(userID)/block",
            method: .post,
            notifiesDataChange: false
        )
    }

    static func unblockMobileUser(userID: String) -> Endpoint<DeleteSuccessResponse> {
        Endpoint(
            path: "/api/mobile/users/\(userID)/block",
            method: .delete,
            notifiesDataChange: false
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
            includesAuthenticationIfAvailable: true,
            notifiesDataChange: false
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

    static func setMobileFriendNotificationsMuted(
        friendUserID: String,
        muted: Bool
    ) -> Endpoint<MobileFriendNotificationMuteResponse> {
        Endpoint(
            path: "/api/mobile/friends/\(friendUserID)/notifications",
            method: muted ? .post : .delete,
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true,
            notifiesDataChange: false
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
            includesAuthenticationIfAvailable: true,
            notifiesDataChange: false
        )
    }

    static func mobileSearch(
        query: String,
        limit: Int = 20,
        includeCurrentUser: Bool = false
    ) -> Endpoint<MobileSearchResponse> {
        Endpoint(
            path: "/api/mobile/search",
            queryItems: [
                URLQueryItem(name: "query", value: query),
                URLQueryItem(name: "limit", value: String(limit)),
                URLQueryItem(
                    name: "includeCurrentUser",
                    value: includeCurrentUser ? "true" : "false"
                ),
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
            includesAuthenticationIfAvailable: true,
            notifiesDataChange: false
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

    static func mobileEventSeriesDetail(seriesPublicID: String) -> Endpoint<MobileEventSeriesDetail> {
        Endpoint(
            path: "/api/mobile/event-series/\(seriesPublicID)",
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
        aliases: [String] = [],
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
            aliases: aliases,
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

    static func mobileAdminMetroAreas() -> Endpoint<MobileAdminMetroAreasResponse> {
        Endpoint(
            path: "/api/mobile/admin/metro-areas",
            method: .get,
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobileDeleteMetroArea(id: UUID) -> Endpoint<DeleteSuccessResponse> {
        Endpoint(
            path: "/api/mobile/admin/metro-areas/\(id.uuidString)",
            method: .delete,
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobileUpdatePlace(
        slug: String,
        updatedSlug: String,
        type: PlaceListItem.PlaceType,
        name: String,
        aliases: [String] = [],
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
            slug: updatedSlug,
            type: type.rawValue,
            name: name,
            aliases: aliases,
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

    static func mobileSetPlaceLogoImage(
        slug: String,
        logoImageURL: URL
    ) throws -> Endpoint<EmptyResponse> {
        let request = MobilePlaceLogoImageRequest(
            logoImageUrl: logoImageURL.absoluteString
        )

        return Endpoint(
            path: "/api/mobile/places/\(slug)/logo-image",
            method: .post,
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

    static func mobileSetEventSeriesCoverImage(
        seriesID: UUID,
        coverImageURL: URL
    ) throws -> Endpoint<EmptyResponse> {
        let request = MobileEventSeriesCoverImageRequest(
            seriesId: seriesID.uuidString,
            coverImageUrl: coverImageURL.absoluteString
        )

        return Endpoint(
            path: "/api/mobile/event-series/\(seriesID.uuidString)/cover-image",
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
        firstName: String,
        lastName: String,
        username: String,
        city: String,
        state: String,
        gender: UserGender,
        dateOfBirth: String
    ) throws -> Endpoint<MobileOnboardingState> {
        Endpoint(
            path: "/api/mobile/onboarding",
            method: .post,
            body: try JSONEncoder().encode(
                MobileOnboardingUpdateRequest(
                    firstName: firstName,
                    lastName: lastName,
                    username: username,
                    city: city,
                    state: state,
                    gender: gender,
                    dateOfBirth: dateOfBirth
                )
            ),
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func updateMobileProfile(
        firstName: String,
        lastName: String,
        username: String,
        city: String,
        state: String,
        gender: UserGender,
        dateOfBirth: String
    ) throws -> Endpoint<MobileOnboardingState> {
        Endpoint(
            path: "/api/mobile/onboarding",
            method: .patch,
            body: try JSONEncoder().encode(
                MobileOnboardingUpdateRequest(
                    firstName: firstName,
                    lastName: lastName,
                    username: username,
                    city: city,
                    state: state,
                    gender: gender,
                    dateOfBirth: dateOfBirth
                )
            ),
            requiresAuthentication: false,
            includesAuthenticationIfAvailable: true
        )
    }

    static func mobileDeleteAccount() -> Endpoint<DeleteSuccessResponse> {
        Endpoint(
            path: "/api/mobile/account",
            method: .delete
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

    static func mobileEventDetail(eventPublicID: String) -> Endpoint<EventFeedItem> {
        Endpoint(
            path: "/api/mobile/events/\(eventPublicID)",
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
        let (data, response) = try await session.data(for: request)

        guard let httpResponse = response as? HTTPURLResponse else {
            throw APIError.invalidResponse
        }

        guard 200 ..< 300 ~= httpResponse.statusCode else {
            throw APIError.requestFailed(statusCode: httpResponse.statusCode, payload: data)
        }

        notifyDataChange(after: endpoint)
    }

    private func notifyDataChange<Response>(after endpoint: Endpoint<Response>) {
        guard endpoint.method != .get, endpoint.notifiesDataChange else {
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
        if let timeoutInterval = endpoint.timeoutInterval {
            request.timeoutInterval = timeoutInterval
        }
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
            if let object = try? JSONSerialization.jsonObject(with: payload),
               let dictionary = object as? [String: Any],
               let serverMessage = dictionary["error"] as? String,
               !serverMessage.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                return serverMessage
            }

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

enum MobileSupportTicketType: String, Codable, CaseIterable, Identifiable, Sendable {
    case help
    case bug
    case feedback
    case incorrectData = "incorrect-data"
    case featureRequest = "feature-request"
    case eventRequest = "event-request"
    case placeRequest = "place-request"

    var id: String { rawValue }

    var title: String {
        switch self {
        case .help: "Get Help"
        case .bug: "Report a Bug"
        case .feedback: "Share Feedback"
        case .incorrectData: "Incorrect Data"
        case .featureRequest: "Request a Feature"
        case .eventRequest: "Request Event"
        case .placeRequest: "Request Place"
        }
    }
}

enum MobileSupportTicketSeverity: String, Codable, CaseIterable, Identifiable, Sendable {
    case low
    case medium
    case high

    var id: String { rawValue }
    var title: String { rawValue.capitalized }
}

enum MobileSupportTicketStatus: String, Codable, CaseIterable, Identifiable, Sendable {
    case open
    case inReview = "in-review"
    case planned
    case resolved
    case closed

    var id: String { rawValue }

    static let adminSelectableCases: [MobileSupportTicketStatus] = [
        .open,
        .inReview,
        .resolved,
        .closed,
    ]

    static let userSelectableCases: [MobileSupportTicketStatus] = [
        .open,
        .inReview,
        .resolved,
    ]

    var title: String {
        switch self {
        case .open: "Open"
        case .inReview: "In Review"
        case .planned: "Planned"
        case .resolved: "Resolved"
        case .closed: "Closed"
        }
    }
}

enum MobileSupportReportedEntityType: String, Codable, Sendable {
    case user
    case place
    case event
}

struct MobileSupportReportContext: Hashable, Identifiable, Sendable {
    let subject: String
    let entityType: MobileSupportReportedEntityType
    let entityID: String
    let entityName: String
    let imageURL: URL?

    var id: String { "\(entityType.rawValue)-\(entityID)" }
}

private struct MobileSupportTicketSubmissionRequest: Encodable, Sendable {
    let type: MobileSupportTicketType
    let severity: MobileSupportTicketSeverity
    let subject: String
    let message: String
    let reportedEntityType: MobileSupportReportedEntityType?
    let reportedEntityID: String?

    enum CodingKeys: String, CodingKey {
        case type
        case severity
        case subject
        case message
        case reportedEntityType
        case reportedEntityID = "reportedEntityId"
    }
}

private struct MobileAdminSupportTicketUpdateRequest: Encodable, Sendable {
    let ticketId: String
    let status: MobileSupportTicketStatus
}

struct MobileSupportTicketSubmissionResponse: Decodable, Sendable {
    let success: Bool
    let ticketId: UUID
}

struct MobileSupportTicketsResponse: Decodable, Sendable {
    let tickets: [MobileSupportTicket]
}

struct MobileSupportTicket: Decodable, Identifiable, Hashable, Sendable {
    let id: UUID
    let type: MobileSupportTicketType
    let severity: MobileSupportTicketSeverity
    let status: MobileSupportTicketStatus
    let subject: String
    let message: String
    let createdAt: Date
    let updatedAt: Date
}

struct MobileAdminSupportTicketsResponse: Decodable, Sendable {
    let tickets: [MobileAdminSupportTicket]
}

struct MobileAdminSupportTicketUpdateResponse: Decodable, Sendable {
    let ticket: MobileAdminSupportTicketUpdate
}

struct MobileAdminSupportTicketUpdate: Decodable, Sendable {
    let id: UUID
    let status: MobileSupportTicketStatus
    let updatedAt: Date
}

struct MobileAdminSupportTicket: Decodable, Identifiable, Hashable, Sendable {
    let id: UUID
    let userId: String
    let type: MobileSupportTicketType
    let severity: MobileSupportTicketSeverity
    let status: MobileSupportTicketStatus
    let subject: String
    let message: String
    let reportedEntityType: MobileSupportReportedEntityType?
    let reportedEntityId: String?
    let reportedEntityName: String?
    let reportedEntityImageUrl: URL?
    let reportedEntityDisplayType: String?
    let createdAt: Date
    let updatedAt: Date
    let userEmail: String?
    let username: String?
    let firstName: String?
    let lastName: String?
    let avatarImageUrl: URL?

    var userName: String {
        let fullName = [firstName, lastName]
            .compactMap { $0 }
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return fullName.isEmpty ? (username ?? userEmail ?? "Unknown user") : fullName
    }

    var reportContext: MobileSupportReportContext? {
        guard let entityType = reportedEntityType,
              let entityID = reportedEntityId,
              let entityName = reportedEntityName else {
            return nil
        }

        return MobileSupportReportContext(
            subject: reportedEntityDisplayType ?? entityType.rawValue.capitalized,
            entityType: entityType,
            entityID: entityID,
            entityName: entityName,
            imageURL: reportedEntityImageUrl
        )
    }

    func updating(status: MobileSupportTicketStatus, updatedAt: Date = .now) -> Self {
        Self(
            id: id,
            userId: userId,
            type: type,
            severity: severity,
            status: status,
            subject: subject,
            message: message,
            reportedEntityType: reportedEntityType,
            reportedEntityId: reportedEntityId,
            reportedEntityName: reportedEntityName,
            reportedEntityImageUrl: reportedEntityImageUrl,
            reportedEntityDisplayType: reportedEntityDisplayType,
            createdAt: createdAt,
            updatedAt: updatedAt,
            userEmail: userEmail,
            username: username,
            firstName: firstName,
            lastName: lastName,
            avatarImageUrl: avatarImageUrl
        )
    }
}

struct PlaceFollowState: Decodable, Hashable, Sendable {
    let isFollowed: Bool
}

struct PlaceHomeVisibilityState: Decodable, Hashable, Sendable {
    let isHiddenFromHome: Bool
}

struct MobileActivationState: Decodable, Hashable, Sendable {
    let tasks: [MobileActivationTask]
    let isComplete: Bool
}

struct MobileActivationTask: Decodable, Hashable, Identifiable, Sendable {
    enum Key: String, Decodable, Hashable, Sendable {
        case addFriends = "add_friends"
        case followPlaces = "follow_places"
        case addProfilePhoto = "add_profile_photo"
    }

    let key: Key
    let progress: Int
    let target: Int
    let isComplete: Bool

    var id: Key { key }
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
    let firstName: String
    let lastName: String
    let username: String
    let city: String
    let state: String
    let gender: UserGender?
    let dateOfBirth: String?
    let avatarImageURL: URL?
    let debug: DebugInfo?

    enum CodingKeys: String, CodingKey {
        case isOnboarding
        case firstName
        case lastName
        case username
        case city
        case state
        case gender
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

struct MobileFriendNotificationMuteResponse: Decodable, Hashable, Sendable {
    let notificationsMuted: Bool
}

struct MobileBlockedUsersResponse: Decodable, Sendable {
    let users: [MobileBlockedUser]
}

struct MobileBlockedUser: Decodable, Identifiable, Hashable, Sendable {
    let id: String
    let name: String
    let username: String
    let avatarImageURL: URL?
    let city: String?
    let state: String?
    let blockedAt: Date

    enum CodingKeys: String, CodingKey {
        case id
        case name
        case username
        case avatarImageURL = "avatarImageUrl"
        case city
        case state
        case blockedAt
    }
}

struct MobileAdminStatusResponse: Decodable, Hashable, Sendable {
    let isAdmin: Bool
}

enum PlaceMemberRole: String, Codable, CaseIterable, Hashable, Sendable {
    case owner
    case manager
    case promoter
    case staff

    var displayName: String {
        switch self {
        case .owner: return "Owner"
        case .manager: return "Manager"
        case .promoter: return "Promoter"
        case .staff: return "Staff"
        }
    }
}

struct MobileAddUserToPlaceRequest: Encodable, Sendable {
    let userId: String
    let role: PlaceMemberRole
}

struct MobileAddUserToPlaceResponse: Decodable, Sendable {
    let success: Bool
}

struct MobilePlaceFollowersResponse: Decodable, Sendable {
    let followers: [FriendUserSummary]
}

struct PlaceMemberListItem: Decodable, Identifiable, Sendable {
    let id: String
    let name: String
    let username: String
    let avatarImageURL: URL?
    let role: PlaceMemberRole

    var usernameText: String { "@\(username)" }

    enum CodingKeys: String, CodingKey {
        case id, name, username, role
        case avatarImageURL = "avatarImageUrl"
    }
}

struct MobilePlaceMembersResponse: Decodable, Sendable {
    let members: [PlaceMemberListItem]
}

struct PlaceEventSeriesSummary: Decodable, Identifiable, Sendable {
    let id: UUID
    let publicID: String
    let title: String
    let frequency: MobileEventSeriesFrequency
    let interval: Int
    let daysOfWeek: [Int]?
    let startAt: Date

    enum CodingKeys: String, CodingKey {
        case id, title, frequency, interval, daysOfWeek, startAt
        case publicID = "publicId"
    }

    var recurrenceLabel: String {
        switch frequency {
        case .daily:
            return interval == 1 ? "Daily" : "Every \(interval) days"
        case .weekly:
            let dayNames = (daysOfWeek ?? []).compactMap { Self.shortDayName($0) }
            let days = dayNames.isEmpty ? "" : " on \(dayNames.joined(separator: ", "))"
            return interval == 1 ? "Weekly\(days)" : "Every \(interval) weeks\(days)"
        case .monthly:
            return interval == 1 ? "Monthly" : "Every \(interval) months"
        }
    }

    private static func shortDayName(_ day: Int) -> String? {
        switch day {
        case 0: return "Sun"
        case 1: return "Mon"
        case 2: return "Tue"
        case 3: return "Wed"
        case 4: return "Thu"
        case 5: return "Fri"
        case 6: return "Sat"
        default: return nil
        }
    }

}

struct MobilePlaceEventSeriesResponse: Decodable, Sendable {
    let series: [PlaceEventSeriesSummary]
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
    let logoImageURL: URL?
    let city: String?
    let state: String?
    let website: URL?

    enum CodingKeys: String, CodingKey {
        case id, type, slug, name, city, state, website
        case logoImageURL = "logoImageUrl"
    }
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
    let name: String?
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
    let firstName: String
    let lastName: String
    let username: String
    let city: String
    let state: String
    let gender: UserGender
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
    let aliases: [String]
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
    let slug: String
    let type: String
    let name: String
    let aliases: [String]
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

private struct MobileEventSeriesCoverImageRequest: Encodable {
    let seriesId: String
    let coverImageUrl: String
}

private struct MobilePlaceLogoImageRequest: Encodable {
    let logoImageUrl: String
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

struct MobileAdminMetroAreasResponse: Decodable, Hashable, Sendable {
    let metroAreas: [MobileAdminMetroArea]
}

struct MobileAdminMetroArea: Decodable, Hashable, Identifiable, Sendable {
    let id: UUID
    let name: String
    let state: String
    let latitude: Double
    let longitude: Double
    let radiusMiles: Double
    let placeCount: Int
    let createdAt: Date
    let updatedAt: Date
}

struct DeleteSuccessResponse: Decodable, Hashable, Sendable {
    let success: Bool
}

enum MobileScraperType: String, Codable, CaseIterable, Hashable, Sendable {
    case dice
    case posh
    case ticketmaster
    case eventbrite

    var title: String {
        switch self {
        case .dice:
            return "Dice.fm"
        case .posh:
            return "Posh"
        case .ticketmaster:
            return "Ticketmaster"
        case .eventbrite:
            return "Eventbrite"
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
                ?? DateFormatter.wigLocalDateTime.date(from: value)
                ?? DateFormatter.wigLocalDateTimeWithoutSeconds.date(from: value)
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

extension DateFormatter {
    static let wigLocalDateTime: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .iso8601)
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm:ss"
        return formatter
    }()

    static let wigLocalDateTimeWithoutSeconds: DateFormatter = {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.calendar = Calendar(identifier: .iso8601)
        formatter.timeZone = TimeZone(secondsFromGMT: 0)
        formatter.dateFormat = "yyyy-MM-dd'T'HH:mm"
        return formatter
    }()
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
