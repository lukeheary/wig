import ClerkKit
import EventKit
import EventKitUI
import SafariServices
import SwiftUI
import UIKit

// Dismissal state is deliberately non-published. Changing SwiftUI @State on this
// large view as the reverse zoom starts forces a full body update on the animation's
// first frame. This token lets async work stop publishing without invalidating UI.
private final class EventDetailPresentationLifecycle: ObservableObject {
    private(set) var isClosing = false

    @discardableResult
    func beginClosing() -> Bool {
        guard !isClosing else {
            return false
        }

        isClosing = true
        return true
    }
}

struct EventDetailView: View {
    let event: EventFeedItem

    private let heroControlButtonSize: CGFloat = 42

    @Environment(Clerk.self) private var clerk
    @Environment(\.apiClient) private var apiClient
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var appSession: AppSession
    @StateObject private var rsvpViewModel = EventRSVPViewModel()
    @State private var isShareSheetPresented = false
    @State private var presentedPromoLink: EventPromoLinkDestination?
    @State private var eventPromotionOption: PromotableEvent?
    @State private var friendPromotions: [EventFriendPromotion] = []
    @State private var isEventPromotionEditorPresented = false
    @State private var isImageViewerPresented = false
    @State private var isEditEventPresented = false
    @State private var reportContext: MobileSupportReportContext?
    @State private var isRSVPMenuExpanded = false
    @State private var isRSVPMenuHitTestingEnabled = false
    @State private var rsvpMenuMode: RSVPMenuMode = .rsvp
    @State private var partnerRelationship: MobilePartnerRelationship?
    @State private var editedEvent: EventFeedItem?
    @State private var currentUserSocialUser: EventSocialUser?
    @State private var isAuthSheetPresented = false
    @State private var rsvpConfirmation: RSVPConfirmation?
    @State private var rsvpConfirmationToken = UUID()
    @State private var isRSVPConfirmationVisible = false
    @State private var pendingRSVPNotificationToken = UUID()
    @State private var locallyExcludedPartnerRSVPUserID: String?
    @State private var currentUserReview: MobileEventReview?
    @State private var attendeeReviewRatings = [String: EventReviewRating]()
    @State private var hasLoadedCurrentUserReview = false
    @State private var isReviewSheetPresented = false
    @StateObject private var presentationLifecycle = EventDetailPresentationLifecycle()
    @State private var presentedPlace: PlaceListItem?
    @State private var presentedRoute: EventDetailRoute?
    @State private var eventPageBackgroundColor = Color(red: 0.11, green: 0.10, blue: 0.10)

    init(
        event: EventFeedItem,
        preloadedRSVPState: EventRSVPState? = nil,
        preloadedPromotions: [EventFriendPromotion] = []
    ) {
        self.event = event

        let cachedReview = EventReviewCache.review(for: event.id)
        let initialRSVPStatus = preloadedRSVPState?.status ?? event.userRsvpStatus
        let initialRSVPNotGoingReason = preloadedRSVPState?.notGoingReason ?? event.userRsvpNotGoingReason

        _rsvpViewModel = StateObject(
            wrappedValue: EventRSVPViewModel(
                status: initialRSVPStatus,
                notGoingReason: initialRSVPNotGoingReason
            )
        )
        _currentUserReview = State(initialValue: cachedReview ?? event.currentUserReview)
        _hasLoadedCurrentUserReview = State(
            initialValue: !event.hasEnded || cachedReview != nil || event.hasLoadedCurrentUserReview
        )
        _friendPromotions = State(initialValue: preloadedPromotions)
    }

    var body: some View {
        GeometryReader { proxy in
            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    EventDetailHero(
                        imageURL: currentEvent.displayImageURL,
                        containerWidth: proxy.size.width,
                        topInset: proxy.safeAreaInsets.top,
                        // Tapping the image itself does nothing; expanding is only via
                        // the expand button (leadingAccessory) below.
                        onImageTap: {},
                        onBackgroundColorChange: { color in
                            eventPageBackgroundColor = color
                        },
                        header: {
                            VStack(alignment: .leading, spacing: 0) {
                                details
                                eventActionButtons
                                    .padding(.top, 20)
                            }
                        },
                        topLeadingControls: {
                            FloatingGlassIconButton(
                                systemImage: "chevron.left",
                                size: heroControlButtonSize
                            ) {
                                closeEventDetail()
                            }
                        },
                        topTrailingControls: {
                            topTrailingControls
                        },
                        leadingAccessory: {
                            if currentEvent.posterImageURL != nil {
                                FloatingGlassIconButton(
                                    systemImage: "arrow.up.left.and.arrow.down.right",
                                    foregroundColor: .white,
                                    size: heroControlButtonSize
                                ) {
                                    isImageViewerPresented = true
                                }
                            }
                        },
                        trailingAccessory: { EmptyView() }
                    )

                    VStack(alignment: .leading, spacing: 20) {
                        eventReviewSection
                        rsvpdSection
                        promotionsSection
                        about
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 10)
                    .padding(.bottom, 6)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollIndicators(.hidden)
            // Fill the whole screen (including behind the status bar) with the
            // artwork-derived background, but keep the SCROLL CONTENT within the top safe area. If the
            // scroll content underlaps the status bar while the nav bar is hidden, iOS
            // injects an automatic status-bar scrim (the "black fade" at the top).
            .background(eventPageBackgroundColor.ignoresSafeArea())
        // Reconcile the pop gesture when returning from Place/Friends: a root
        // event dismisses its zoom presentation, while a nested event pops.
        .background(SwipeBackEnabler())
        .navigationBarBackButtonHidden()
        .toolbar(.hidden, for: .navigationBar)
        .overlay {
            if isAuthenticated {
                ZStack {
                    ZStack(alignment: .bottom) {
                        if isRSVPMenuExpanded {
                            Color.black.opacity(0.22)
                                .contentShape(Rectangle())
                                .ignoresSafeArea()
                                .onTapGesture {
                                    closeRSVPMenu()
                                }
                                .transition(.opacity)
                        }

                        expandedRSVPMenu
                            .frame(maxWidth: .infinity)
                            .eventDetailLiquidGlass(in: RoundedRectangle(cornerRadius: 30, style: .continuous))
                            .padding(.horizontal, 16)
                            .padding(.bottom, 12)
                            .opacity(isRSVPMenuExpanded ? 1 : 0)
                            .offset(y: isRSVPMenuExpanded ? 0 : 360)
                            .allowsHitTesting(isRSVPMenuHitTestingEnabled)
                    }
                    .allowsHitTesting(isRSVPMenuHitTestingEnabled)

                    if let rsvpConfirmation {
                        VStack {
                            HStack {
                                Spacer(minLength: 0)

                                RSVPConfirmationToast(
                                    confirmation: rsvpConfirmation,
                                    onUndo: rsvpConfirmation.allowsUndo ? undoPendingRSVP : nil
                                )
                                    .fixedSize(horizontal: true, vertical: false)

                                Spacer(minLength: 0)
                            }
                            .padding(.top, 10)

                            Spacer(minLength: 0)
                        }
                        .offset(y: isRSVPConfirmationVisible ? 0 : -110)
                        .opacity(isRSVPConfirmationVisible ? 1 : 0)
                        .scaleEffect(isRSVPConfirmationVisible ? 1 : 0.94)
                    }
                }
                .animation(.spring(response: 0.32, dampingFraction: 0.82), value: isRSVPMenuExpanded)
                .animation(.spring(response: 0.35, dampingFraction: 0.60), value: rsvpConfirmation)
            }
        }
        .task(id: "\(currentEvent.id.uuidString)-\(isAuthenticated)") {
            AppAnalytics.log(.viewItem, [
                "content_type": "event",
                "days_until_event": AppAnalytics.daysUntilBucket(currentEvent.startAt),
                "city": currentEvent.city,
            ])
            guard isAuthenticated else {
                return
            }

            async let rsvpLoad: Void = rsvpViewModel.load(
                eventID: currentEvent.id,
                using: apiClient,
                shouldApply: { !presentationLifecycle.isClosing }
            )
            async let partnerLoad: Void = loadPartner(using: apiClient)
            async let currentUserLoad: Void = loadCurrentUserSocialUser()
            async let reviewLoad: Void = loadCurrentUserReview(using: apiClient)
            async let attendeeReviewLoad: Void = loadAttendeeReviewRatings(using: apiClient)
            async let promotionLoad: Void = loadEventPromotionOption(using: apiClient)
            async let friendPromotionsLoad: Void = loadFriendPromotions(using: apiClient)
            _ = await (rsvpLoad, partnerLoad, currentUserLoad, reviewLoad, attendeeReviewLoad, promotionLoad, friendPromotionsLoad)

            if !Task.isCancelled,
               !presentationLifecycle.isClosing,
               partnerRelationship?.isAccepted == true,
               rsvpViewModel.status == nil
            {
                rsvpViewModel.setIncludePartner(true)
            }
        }
        .task(id: [linkedPlace?.slug, organizerPlace?.slug]) {
            let places = [linkedPlace, organizerPlace].compactMap { $0 }
            var seenSlugs = Set<String>()
            await withTaskGroup(of: Void.self) { group in
                for place in places where seenSlugs.insert(place.slug).inserted {
                    group.addTask {
                        await PlaceDetailViewModel.prefetch(place: place, using: apiClient)
                    }
                }
            }
        }
        .onChange(of: isAuthenticated) { _, isAuthenticated in
            guard !isAuthenticated else {
                if currentEvent.hasEnded, currentUserReview == nil {
                    hasLoadedCurrentUserReview = false
                }
                return
            }

            partnerRelationship = nil
            closeRSVPMenu()
        }
        .onReceive(NotificationCenter.default.publisher(for: .mobileEventDidDelete)) { notification in
            guard let deletedEventID = notification.object as? UUID,
                  deletedEventID == currentEvent.id
            else {
                return
            }

            closeEventDetail()
        }
        .onChange(of: appSession.presentedEventDetail?.id) { _, presentationID in
            if presentationID == nil {
                presentationLifecycle.beginClosing()
            }
        }
        .sheet(isPresented: $isAuthSheetPresented) {
            WIGAuthSheetView(isDismissible: true)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
        .sheet(item: $presentedPromoLink) { destination in
            EventPromoBrowser(url: destination.url)
                .ignoresSafeArea()
        }
        .sheet(isPresented: $isEventPromotionEditorPresented) {
            if let eventPromotionOption {
                EventPromotionEditorSheet(event: eventPromotionOption) { updated in
                    self.eventPromotionOption = updated
                    var updatedEvent = currentEvent
                    updatedEvent.promo = updated.isPromoted ? updated.promo : nil
                    updatedEvent.promoUrl = updated.isPromoted ? updated.promoUrl : nil
                    editedEvent = updatedEvent
                }
            }
        }
        .sheet(isPresented: $isShareSheetPresented) {
            ShareSheet(activityItems: [shareURL])
                .presentationDetents([.medium, .large])
        }
        .sheet(isPresented: $isReviewSheetPresented) {
            PostEventFeedbackSheet(
                event: reviewSheetEvent,
                initialResponse: currentUserReview.flatMap { PostEventFeedbackResponse(reviewRating: $0.rating) },
                initialComment: currentUserReview?.comment
            ) { response, comment in
                await submitReviewFeedback(response, comment: comment)
            }
            .presentationDetents([.medium, .large])
            .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $isEditEventPresented) {
            MobileEventCreationView(
                mode: .edit(currentEvent),
                onCompleted: { updatedEvent in
                    editedEvent = mergeUpdatedEvent(updatedEvent)
                }
            )
        }
        .sheet(item: $reportContext) { context in
            NavigationStack {
                MobileNewSupportRequestView(reportContext: context)
            }
        }
        .fullScreenCover(isPresented: $isImageViewerPresented) {
            if let posterImageURL = currentEvent.posterImageURL {
                EventArtworkViewer(imageURL: posterImageURL)
            }
        }
        .navigationDestination(item: $presentedPlace) { place in
            EventPlaceDetailRouteView(place: place)
        }
        .navigationDestination(item: $presentedRoute) { _ in
            EventRSVPListRouteView(
                goingAttendees: friendGoingAttendees,
                interestedAttendees: friendInterestedAttendees,
                notGoingAttendees: friendNotGoingAttendees,
                isPastEvent: currentEvent.hasEnded,
                eventID: currentEvent.id,
                attendeeReviewRatings: attendeeReviewRatings
            )
        }
        }
    }

    private func closeEventDetail() {
        guard presentationLifecycle.beginClosing() else {
            return
        }

        dismiss()
    }

    private func presentPlace(_ place: PlaceListItem) {
        // Explicitly animate the programmatic push, including when the place
        // is already cached and its content is available immediately.
        withAnimation(.default) {
            presentedPlace = place
        }
    }

    private func presentRSVPList() {
        presentedRoute = .rsvpList
    }

    private var reviewSheetEvent: MobileEventReviewPrompt {
        MobileEventReviewPrompt(
            id: currentEvent.id,
            publicID: currentEvent.publicID,
            title: currentEvent.title,
            coverImageURL: currentEvent.coverImageURL,
            startAt: currentEvent.startAt,
            endAt: currentEvent.endAt,
            venueName: currentEvent.venueName,
            city: currentEvent.city,
            state: currentEvent.state
        )
    }

    private func loadCurrentUserReview(using apiClient: APIClient) async {
        guard !hasLoadedCurrentUserReview else {
            return
        }

        guard currentEvent.hasEnded else {
            currentUserReview = nil
            hasLoadedCurrentUserReview = true
            return
        }

        do {
            let review = try await apiClient.send(
                APIClient.mobileEventReview(eventID: currentEvent.id)
            ).review

            guard !Task.isCancelled, !presentationLifecycle.isClosing else {
                return
            }

            currentUserReview = review
            if let review {
                EventReviewCache.store(review)
            }
        } catch {
            guard !Task.isCancelled, !presentationLifecycle.isClosing else {
                return
            }

            currentUserReview = nil
        }

        guard !Task.isCancelled, !presentationLifecycle.isClosing else {
            return
        }

        hasLoadedCurrentUserReview = true
    }

    private func submitReviewFeedback(
        _ response: PostEventFeedbackResponse,
        comment: String?
    ) async -> Bool {
        if response == .didNotAttend {
            if await rsvpViewModel.toggle(
                .notGoing,
                eventID: currentEvent.id,
                using: apiClient,
                includePartner: false,
                notifyFriends: false,
                sendFriendNotifications: false,
                forceUpdate: true
            ) {
                isReviewSheetPresented = false
                handleSuccessfulRSVPChange()
                return true
            }

            return false
        }

        guard let rating = response.rating else { return false }

        do {
            let endpoint = try APIClient.createMobileEventReview(
                eventID: currentEvent.id,
                rating: rating,
                comment: comment
            )
            let review = try await apiClient.send(endpoint)
            AppAnalytics.log(.eventReviewSubmitted, [
                "rating_bucket": rating.rawValue,
                "had_comment": !(comment?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true),
            ])
            EventReviewCache.store(review)
            currentUserReview = review
            await loadAttendeeReviewRatings(using: apiClient)
            isReviewSheetPresented = false
            return true
        } catch {
            return false
        }
    }

    private func loadEventPromotionOption(using apiClient: APIClient) async {
        guard isAuthenticated else {
            eventPromotionOption = nil
            return
        }
        let response = try? await apiClient.send(
            APIClient.mobilePromotableEvents(eventID: currentEvent.id)
        )
        guard !Task.isCancelled, !presentationLifecycle.isClosing else { return }
        eventPromotionOption = response?.events.first
    }

    private func loadFriendPromotions(using apiClient: APIClient) async {
        guard isAuthenticated else {
            friendPromotions = []
            return
        }

        do {
            let response = try await apiClient.send(
                APIClient.mobileEventFriendPromotions(eventID: currentEvent.id)
            )
            guard !Task.isCancelled, !presentationLifecycle.isClosing else { return }
            friendPromotions = response.promotions
            if let userID = clerk.user?.id {
                EventPromotionPrefetchCache.store(
                    response.promotions,
                    eventID: currentEvent.id,
                    userID: userID
                )
            }
        } catch {
            guard !Task.isCancelled, !presentationLifecycle.isClosing else { return }
            friendPromotions = []
        }
    }

    private func loadAttendeeReviewRatings(using apiClient: APIClient) async {
        guard currentEvent.hasEnded else {
            attendeeReviewRatings = [:]
            return
        }

        do {
            let response = try await apiClient.send(
                APIClient.mobileEventAttendeeReviews(eventID: currentEvent.id)
            )

            guard !Task.isCancelled, !presentationLifecycle.isClosing else {
                return
            }

            attendeeReviewRatings = Dictionary(
                uniqueKeysWithValues: response.reviews.map { ($0.userID, $0.rating) }
            )
        } catch {
            guard !Task.isCancelled, !presentationLifecycle.isClosing else {
                return
            }

            attendeeReviewRatings = [:]
        }
    }

    private var topTrailingControls: some View {
        HStack(spacing: 10) {
            Button {
                AppAnalytics.log(.share, ["content_type": "event", "method": "system_share_sheet"])
                isShareSheetPresented = true
            } label: {
                Image(systemName: "square.and.arrow.up")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: heroControlButtonSize, height: heroControlButtonSize)
                    .contentShape(Circle())
                    .eventDetailLiquidGlass(in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel("Share event")

            Menu {
            if let eventPromotionOption {
                Button {
                    isEventPromotionEditorPresented = true
                } label: {
                    Label("Manage Promoting", systemImage: "megaphone")
                }
            }

            if currentEvent.canEdit || appSession.isAdmin {
                Button {
                    closeRSVPMenu()
                    isEditEventPresented = true
                } label: {
                    Label("Edit Event", systemImage: "calendar")
                }
            }

            Divider()

            Button {
                if isAuthenticated {
                    reportContext = MobileSupportReportContext(
                        subject: "Report Event",
                        entityType: .event,
                        entityID: currentEvent.id.uuidString,
                        entityName: currentEvent.title,
                        imageURL: currentEvent.posterImageURL
                    )
                } else {
                    isAuthSheetPresented = true
                }
            } label: {
                Label("Report a Concern", systemImage: "exclamationmark.bubble")
                    .foregroundStyle(.white)
            }
            .tint(.white)
            } label: {
            Image(systemName: "ellipsis")
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: heroControlButtonSize, height: heroControlButtonSize)
                .contentShape(Circle())
                .eventDetailLiquidGlass(in: Circle())
        }
            .buttonStyle(.plain)
            .accessibilityLabel("More event actions")
        }
    }

    private var guestRSVPButton: some View {
        Button {
            guard !currentEvent.hasEnded else {
                return
            }

            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            isAuthSheetPresented = true
        } label: {
            HStack(spacing: 10) {
                if currentEvent.hasEnded {
                    Image(systemName: "clock")
                        .font(.system(size: 14, weight: .bold))
                }

                Text(currentEvent.hasEnded ? "Event Passed" : "RSVP")
                    .font(.system(size: 17, weight: .bold))
                    .lineLimit(1)
            }
            .foregroundStyle(.white)
            .padding(.horizontal, 22)
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .contentShape(Capsule())
            .eventDetailLiquidGlass(in: Capsule())
        }
        .buttonStyle(.plain)
        .disabled(currentEvent.hasEnded)
        .opacity(currentEvent.hasEnded ? 0.62 : 1)
    }

    @ViewBuilder
    private var eventActionButtons: some View {
        if currentEvent.eventURL != nil,
           currentEvent.externalSourceName != nil
        {
            VStack(spacing: 8) {
                if isAuthenticated, !shouldHideCompletedRSVP {
                    rsvpErrorMessage
                }

                if isAuthenticated {
                    if !shouldHideCompletedRSVP {
                        rsvpTriggerButton
                    }
                } else {
                    guestRSVPButton
                }

                externalEventButton
            }
        } else if isAuthenticated {
            if !shouldHideCompletedRSVP {
                inlineRSVPSection
            }
        } else {
            guestRSVPButton
        }
    }

    @ViewBuilder
    private var externalEventButton: some View {
        if let sourceName = currentEvent.externalSourceName {
            Button {
                openExternalEvent()
            } label: {
                HStack(spacing: 8) {
                    Text("View tickets on \(sourceName)")
                        .font(.system(size: 14, weight: .medium))

                    Image(systemName: "arrow.up.right")
                        .font(.system(size: 12, weight: .semibold))
                }
                .foregroundStyle(.white.opacity(0.78))
                .padding(.horizontal, 22)
                .frame(maxWidth: .infinity)
                .frame(height: 44)
                .contentShape(Capsule())
                .overlay {
                    Capsule()
                        .strokeBorder(Color.white.opacity(0.18), lineWidth: 1)
                }
            }
            .buttonStyle(.plain)
            .accessibilityHint("Opens the event on \(sourceName)")
        }
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(currentEvent.title)
                .font(.system(size: 26, weight: .bold))
                .foregroundStyle(.white)
                .lineSpacing(0.5)
                .fixedSize(horizontal: false, vertical: true)

            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(compactEventDateTimeText)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(AppTheme.accentBlue)

                // Temporarily hidden; retain the relative-day label for a future restore.
                // if !relativeStartDayText.isEmpty {
                //     Text(relativeStartDayText)
                //         .font(.system(size: 11, weight: .semibold))
                //         .foregroundStyle(.white.opacity(0.66))
                // }
            }
            .padding(.top, 6)

            venueLabel
            // Temporarily hidden; retain the event category tags for a future restore.
            // if !currentEvent.eventDetailCategoryLabels.isEmpty {
            //     categoryPills
            // }
            .padding(.top, 7)

            if let organizerPlace {
                organizerLabel(place: organizerPlace)
                    .padding(.top, 6)
            }
        }
    }

    @ViewBuilder
    private var venueLabel: some View {
        if let linkedPlace {
            Button {
                presentPlace(linkedPlace)
            } label: {
                Text(linkedPlace.name)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.white.opacity(0.76))
                    .lineLimit(1)
            }
            .buttonStyle(.plain)
        } else {
            Text(currentEvent.primaryLocation)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(.white.opacity(0.76))
                .lineLimit(1)
        }
    }

    private var categoryPills: some View {
        HStack(spacing: 6) {
            ForEach(currentEvent.eventDetailCategoryLabels, id: \.self) { category in
                Text(category)
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.76))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Color.white.opacity(0.08), in: Capsule())
            }
        }
    }

    private func organizerLabel(place: PlaceListItem) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 4) {
            Text("Organized by")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(.white.opacity(0.56))

            Button {
                presentPlace(place)
            } label: {
                Text(place.name)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.white.opacity(0.76))
                    .lineLimit(1)
            }
            .buttonStyle(.plain)
        }
    }

    private var linkedPlace: PlaceListItem? {
        if let id = currentEvent.venueID,
           let slug = currentEvent.venueSlug,
           let name = currentEvent.venueName,
           !slug.isEmpty,
           !name.isEmpty
        {
            return PlaceListItem(
                id: id,
                type: .venue,
                slug: slug,
                name: name,
                logoImageURL: currentEvent.venueLogoImageURL,
                address: nil,
                city: currentEvent.city,
                state: currentEvent.state,
                website: nil,
                instagram: nil,
                upcomingEventCount: 0,
                followerCount: currentEvent.venueFollowerCount,
                memberCount: currentEvent.venueMemberCount,
                updatedAt: currentEvent.updatedAt,
                isFollowed: currentEvent.venueIsFollowed
            )
        }

        let hasVenueName =
            currentEvent.venueName?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
        guard !hasVenueName else {
            return nil
        }

        if let id = currentEvent.organizerID,
           let slug = currentEvent.organizerSlug,
           let name = currentEvent.organizerName,
           !slug.isEmpty,
           !name.isEmpty
        {
            return PlaceListItem(
                id: id,
                type: .organizer,
                slug: slug,
                name: name,
                logoImageURL: currentEvent.organizerLogoImageURL,
                address: nil,
                city: currentEvent.city,
                state: currentEvent.state,
                website: nil,
                instagram: nil,
                upcomingEventCount: 0,
                followerCount: currentEvent.organizerFollowerCount,
                memberCount: currentEvent.organizerMemberCount,
                updatedAt: currentEvent.updatedAt,
                isFollowed: currentEvent.organizerIsFollowed
            )
        }

        return nil
    }

    private var compactEventDateTimeText: String {
        let prefix = currentEvent.formattedStart(format: "EEE, MMM d")

        guard let endAt = currentEvent.endAt else {
            return "\(prefix) at \(compactTimeString(for: currentEvent.startAt, includeMeridiem: true))"
        }

        let startText = compactTimeString(for: currentEvent.startAt, includeMeridiem: true)
        let endText = compactTimeString(for: endAt, includeMeridiem: true)

        return "\(prefix) at \(startText) – \(endText)"
    }

    private func compactTimeString(for date: Date, includeMeridiem: Bool) -> String {
        let calendar = eventTimeCalendar
        let minute = calendar.component(.minute, from: date)
        let format: String

        switch (minute == 0, includeMeridiem) {
        case (true, true):
            format = "h a"
        case (true, false):
            format = "h"
        case (false, true):
            format = "h:mm a"
        case (false, false):
            format = "h:mm"
        }

        let formatter = DateFormatter()
        formatter.dateFormat = format
        formatter.timeZone = currentEvent.displayTimeZone
        return formatter.string(from: date)
    }

    private var eventTimeCalendar: Calendar {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = currentEvent.displayTimeZone
        return calendar
    }

    private var organizerPlace: PlaceListItem? {
        guard let id = currentEvent.organizerID,
              let slug = currentEvent.organizerSlug,
              let name = currentEvent.organizerName,
              !slug.isEmpty,
              !name.isEmpty
        else {
            return nil
        }

        return PlaceListItem(
            id: id,
            type: .organizer,
            slug: slug,
            name: name,
            logoImageURL: currentEvent.organizerLogoImageURL,
            address: nil,
            city: currentEvent.city,
            state: currentEvent.state,
            website: nil,
            instagram: nil,
            upcomingEventCount: 0,
            followerCount: currentEvent.organizerFollowerCount,
            memberCount: currentEvent.organizerMemberCount,
            updatedAt: currentEvent.updatedAt,
            isFollowed: currentEvent.organizerIsFollowed
        )
    }

    @ViewBuilder
    private var rsvpErrorMessage: some View {
        if let errorMessage = rsvpViewModel.errorMessage {
            Text(errorMessage)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.red.opacity(0.86))
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var inlineRSVPSection: some View {
        VStack(spacing: 10) {
            rsvpErrorMessage

            rsvpTriggerButton
        }
        .frame(maxWidth: .infinity)
        .animation(.spring(response: 0.32, dampingFraction: 0.82), value: isRSVPMenuExpanded)
        .animation(.snappy(duration: 0.18), value: rsvpViewModel.status)
    }

    private var rsvpTriggerButton: some View {
        Button {
            guard !isRSVPInteractionDisabled else {
                return
            }

            UIImpactFeedbackGenerator(style: .light).impactOccurred()

            if shouldOfferReview {
                withAnimation(.spring(response: 0.32, dampingFraction: 0.82)) {
                    isReviewSheetPresented = true
                }
                return
            }

            withAnimation(.spring(response: 0.32, dampingFraction: 0.82)) {
                if isRSVPMenuExpanded {
                    closeRSVPMenu()
                } else {
                    rsvpMenuMode = .rsvp
                    isRSVPMenuHitTestingEnabled = true
                    isRSVPMenuExpanded = true
                }
            }
        } label: {
            HStack(spacing: 10) {
                if rsvpViewModel.isSaving {
                    ProgressView()
                        .tint(.white)
                        .frame(width: 18, height: 18)
                } else if let rsvpButtonSystemImage {
                    Image(systemName: rsvpButtonSystemImage)
                        .font(.system(size: 14, weight: .bold))
                }

                Text(rsvpButtonTitle)
                    .font(.system(size: 17, weight: .bold))
                    .lineLimit(1)

                if shouldOfferReview || shouldOfferRetroactiveWent || !currentEvent.hasEnded {
                    Image(systemName: isRSVPChevronExpanded ? "chevron.down" : "chevron.up")
                        .font(.system(size: 12, weight: .bold))
                        .opacity(0.72)
                }
            }
            .foregroundStyle(rsvpButtonColor)
            .padding(.horizontal, 22)
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .contentShape(Capsule())
            .eventDetailLiquidGlass(in: Capsule())
        }
        .buttonStyle(.plain)
        .disabled(isRSVPInteractionDisabled)
        .opacity(isRSVPInteractionDisabled ? 0.62 : 1)
    }

    private var expandedRSVPMenu: some View {
        VStack(alignment: .leading, spacing: 0) {
            switch rsvpMenuMode {
            case .rsvp:
                if shouldOfferRetroactiveWent {
                    retroactiveWentMenuContent
                } else {
                    primaryRSVPMenuContent
                }
            case .declineReason:
                declineReasonMenuContent
            case .more:
                rsvpMoreMenuContent
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 12)
    }

    private var retroactiveWentMenuContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(alignment: .leading, spacing: 5) {
                Text("Did you go to this event?")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.white)

                Text("Add it to your past events and leave a rating whenever you’re ready. Your friends won’t be notified.")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.white.opacity(0.58))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 10)

            Divider()
                .overlay(.white.opacity(0.08))
                .padding(.horizontal, 14)
                .padding(.vertical, 6)

            Button {
                UISelectionFeedbackGenerator().selectionChanged()
                markPastEventAsWent()
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "checkmark")
                        .font(.system(size: 15, weight: .bold))
                        .frame(width: 22)
                        .foregroundStyle(AppTheme.accentBlue)

                    Text("Mark as Attended")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.white)

                    Spacer(minLength: 8)
                }
                .padding(.horizontal, 14)
                .frame(height: 58)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(rsvpViewModel.isSaving)
        }
    }

    private var primaryRSVPMenuContent: some View {
        VStack(spacing: 22) {
            VStack(spacing: 5) {
                Text("See you there?")
                    .font(.system(size: 25, weight: .bold))
                    .foregroundStyle(.white)

                Text("RSVP and let your friends know")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.white.opacity(0.56))
            }
            .frame(maxWidth: .infinity)
            .padding(.top, 4)

            HStack(alignment: .top, spacing: shouldShowNotGoingOption ? 10 : 18) {
                ForEach(visibleRSVPMenuOptions) { option in
                    RSVPCircleOptionButton(
                        option: option,
                        isSelected: rsvpViewModel.status == option.status,
                        isDimmed: rsvpViewModel.status != nil && rsvpViewModel.status != option.status,
                        isLoading: rsvpViewModel.isSaving,
                        diameter: shouldShowNotGoingOption ? 88 : 96
                    ) {
                        selectRSVP(option.status)
                    }
                    .frame(maxWidth: .infinity)
                }
            }

            if hasFriendRSVPs {
                Button {
                    closeRSVPMenu()
                    presentRSVPList()
                } label: {
                    HStack(spacing: 12) {
                        RSVPSheetAvatarStack(attendees: friendRSVPPreviewAttendees)

                        Text(rsvpSheetFriendSummaryText)
                            .font(.system(size: 14, weight: .semibold))
                            .foregroundStyle(.white)
                            .lineLimit(1)

                        Spacer(minLength: 8)

                        Image(systemName: "chevron.right")
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(.white.opacity(0.54))
                    }
                    .padding(.horizontal, 14)
                    .frame(height: 58)
                    .background(.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                    .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                }
                .buttonStyle(.plain)
            }

            VStack(spacing: 8) {
                Divider()
                    .overlay(.white.opacity(0.10))
                    .padding(.horizontal, 14)

                RSVPMenuNavigationButton(
                    title: "RSVP settings",
                    direction: .forward,
                    isLoading: rsvpViewModel.isSaving
                ) {
                    withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
                        rsvpMenuMode = .more
                    }
                }
            }
        }
    }

    private var declineReasonMenuContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            RSVPMenuNavigationButton(
                title: "Back",
                direction: .back,
                isLoading: rsvpViewModel.isSaving
            ) {
                withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
                    rsvpMenuMode = .rsvp
                }
            }

            Divider()
                .overlay(.white.opacity(0.08))
                .padding(.horizontal, 14)
                .padding(.vertical, 6)

            VStack(spacing: 2) {
                ForEach(EventRSVPDeclineReason.allCases, id: \.self) { reason in
                    RSVPDeclineReasonMenuButton(
                        reason: reason,
                        isSelected: rsvpViewModel.status == .notGoing
                            && rsvpViewModel.notGoingReason == reason,
                        isLoading: rsvpViewModel.isSaving
                    ) {
                        saveNotGoing(reason: reason)
                    }
                }

                RSVPDeclineSkipButton(isLoading: rsvpViewModel.isSaving) {
                    saveNotGoing(reason: nil)
                }
            }
        }
    }

    private var rsvpMoreMenuContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            RSVPMenuNavigationButton(
                title: "Back",
                direction: .back,
                isLoading: rsvpViewModel.isSaving
            ) {
                withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
                    rsvpMenuMode = .rsvp
                }
            }

            Divider()
                .overlay(.white.opacity(0.08))
                .padding(.horizontal, 14)
                .padding(.vertical, 6)

            if let partnerRelationship, partnerRelationship.isAccepted {
                RSVPPartnerRow(
                    partner: partnerRelationship.partner,
                    isOn: Binding(
                        get: { rsvpViewModel.includePartner },
                        set: { nextValue in
                            handlePartnerToggle(nextValue)
                        }
                    ),
                    isLoading: rsvpViewModel.isSaving
                )

                Divider()
                    .overlay(.white.opacity(0.08))
                    .padding(.leading, 14)
            }

            RSVPNotifyFriendsRow(
                isOn: Binding(
                    get: { rsvpViewModel.notifyFriends },
                    set: { nextValue in
                        rsvpViewModel.setNotifyFriends(nextValue)
                        if !nextValue {
                            cancelPendingRSVPNotification()
                        }
                    }
                ),
                isLoading: rsvpViewModel.isSaving
            )
        }
    }

    @ViewBuilder
    private var eventReviewSection: some View {
        if isAuthenticated,
           currentEvent.hasEnded,
           rsvpViewModel.status == .going,
           let review = currentUserReview
        {
            VStack(alignment: .leading, spacing: 10) {
                HStack(spacing: 10) {
                    Text(review.rating.reviewEmoji)
                        .font(.system(size: 32))

                    Text(review.rating.reviewTitle)
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(.white)

                    Spacer(minLength: 0)

                    Button("Edit") {
                        isReviewSheetPresented = true
                    }
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(AppTheme.accentBlue)
                    .buttonStyle(.plain)
                }

                if let comment = review.comment?.trimmingCharacters(in: .whitespacesAndNewlines),
                   !comment.isEmpty
                {
                    Text(comment)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.white.opacity(0.70))
                        .lineSpacing(3)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(.white.opacity(0.055), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay {
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(.white.opacity(0.10), lineWidth: 1)
            }
        }
    }

    @ViewBuilder
    private var promotionsSection: some View {
        if !friendPromotions.isEmpty {
            VStack(alignment: .leading, spacing: 14) {
                Text("Promotions")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(.white)

                VStack(spacing: 0) {
                    ForEach(Array(friendPromotions.enumerated()), id: \.element.id) { index, promotion in
                        EventFriendPromotionRow(promotion: promotion) { url in
                            presentedPromoLink = EventPromoLinkDestination(url: url)
                        }

                        if index < friendPromotions.count - 1 {
                            Divider().overlay(.white.opacity(0.08))
                        }
                    }
                }
                .padding(.horizontal, 14)
                .background(.white.opacity(0.055), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay {
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(.white.opacity(0.10), lineWidth: 1)
                }
            }
        }
    }

    @ViewBuilder
    private var about: some View {
        if let description = aboutDescription {
            VStack(alignment: .leading, spacing: 14) {
                Text("About")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(.white)

                Text(markdownDescription(description))
                    .font(.system(size: 14, weight: .regular))
                    .foregroundStyle(.white)
                    .tint(AppTheme.accentBlue)
                    .lineSpacing(4)
            }
        }
    }

    private var aboutDescription: String? {
        guard let description = currentEvent.description?.trimmingCharacters(in: .whitespacesAndNewlines),
              !description.isEmpty
        else {
            return nil
        }

        return description
    }

    private func markdownDescription(_ description: String) -> AttributedString {
        // Markdown treats a single newline as a soft wrap. Parse each authored
        // line independently, then append explicit newline characters so the
        // original event-copy layout cannot be collapsed by the parser.
        let normalizedDescription = description
            .replacingOccurrences(of: "\r\n", with: "\n")
            .replacingOccurrences(of: "\r", with: "\n")
            // Some imported Posh descriptions contain a literal backslash
            // immediately before a newline. It is an export artifact, not
            // copy meant for attendees to see.
            .replacingOccurrences(of: "\\\n", with: "\n")
            .replacingOccurrences(of: "\\n", with: "\n")

        let lines = normalizedDescription.components(separatedBy: "\n")

        return lines.enumerated().reduce(into: AttributedString()) { rendered, line in
            let markdownLine = (try? AttributedString(
                markdown: line.element,
                options: .init(interpretedSyntax: .full)
            )) ?? AttributedString(line.element)

            rendered += markdownLine

            if line.offset < lines.count - 1 {
                rendered += AttributedString("\n")
            }
        }
    }

    @ViewBuilder
    private var rsvpdSection: some View {
        if isAuthenticated, hasFriendRSVPs {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text("Friends")
                        .font(.system(size: 20, weight: .bold))
                        .foregroundStyle(.white)

                    Spacer(minLength: 12)

                    Text(friendSummaryText)
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.white.opacity(0.56))
                        .multilineTextAlignment(.trailing)
                }

                Button {
                    presentRSVPList()
                } label: {
                    EventRSVPFriendsRow(
                        attendees: friendRSVPPreviewAttendees
                    )
                }
                .buttonStyle(.plain)

                if aboutDescription != nil {
                    Rectangle()
                        .fill(Color.white.opacity(0.08))
                        .frame(maxWidth: .infinity)
                        .frame(height: 1)
                        .padding(.top, 6)
                }
            }
        }
    }

    private func openExternalEvent() {
        guard let eventURL = currentEvent.eventURL else {
            return
        }

        UIApplication.shared.open(eventURL)
    }

    private func selectRSVP(_ status: EventRSVPStatus) {
        UIImpactFeedbackGenerator(style: .light).impactOccurred()
        cancelPendingRSVPNotification()

        if status == .notGoing {
            withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
                rsvpMenuMode = .declineReason
                isRSVPMenuExpanded = true
            }
            return
        }

        closeRSVPMenu()

        let shouldNotifyFriends = rsvpViewModel.notifyFriends

        Task {
            if await rsvpViewModel.toggle(
                status,
                eventID: currentEvent.id,
                using: apiClient,
                includePartner: partnerRelationship?.isAccepted == true && rsvpViewModel.includePartner,
                notifyFriends: shouldNotifyFriends,
                // Going/interested notifications use the undo window below.
                // The initial RSVP save must never notify immediately, including
                // when the user has explicitly disabled notifications.
                sendFriendNotifications: false
            ) {
                handleSuccessfulRSVPChange(showConfirmation: true, allowsUndo: shouldNotifyFriends)
                if shouldNotifyFriends {
                    scheduleFriendNotification(for: status)
                }
            }
        }
    }

    private func saveNotGoing(reason: EventRSVPDeclineReason?) {
        if reason != nil {
            UISelectionFeedbackGenerator().selectionChanged()
        }

        cancelPendingRSVPNotification()
        closeRSVPMenu()

        Task {
            if await rsvpViewModel.toggle(
                .notGoing,
                eventID: currentEvent.id,
                using: apiClient,
                includePartner: partnerRelationship?.isAccepted == true && rsvpViewModel.includePartner,
                notifyFriends: rsvpViewModel.notifyFriends,
                notGoingReason: reason
            ) {
                handleSuccessfulRSVPChange(showConfirmation: true)
            }
        }
    }

    private func markPastEventAsWent() {
        cancelPendingRSVPNotification()
        closeRSVPMenu()

        Task {
            if await rsvpViewModel.toggle(
                .going,
                eventID: currentEvent.id,
                using: apiClient,
                includePartner: false,
                notifyFriends: false,
                sendFriendNotifications: false,
                forceUpdate: true
            ) {
                handleSuccessfulRSVPChange()
                withAnimation(.spring(response: 0.32, dampingFraction: 0.82)) {
                    isReviewSheetPresented = true
                }
            }
        }
    }

    private func closeRSVPMenu() {
        isRSVPMenuHitTestingEnabled = false

        withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
            rsvpMenuMode = .rsvp
            isRSVPMenuExpanded = false
        }
    }

    private func loadPartner(using apiClient: APIClient) async {
        do {
            let response = try await apiClient.send(APIClient.mobileMyPartner())

            guard !Task.isCancelled, !presentationLifecycle.isClosing else {
                return
            }

            partnerRelationship = response.relationship

            if response.relationship?.isAccepted == true, rsvpViewModel.status == nil {
                rsvpViewModel.setIncludePartner(true)
            } else if response.relationship?.isAccepted != true {
                rsvpViewModel.setIncludePartner(false)
            }
        } catch {
            guard !Task.isCancelled, !presentationLifecycle.isClosing else {
                return
            }

            partnerRelationship = nil
            rsvpViewModel.setIncludePartner(false)
        }
    }

    private func handlePartnerToggle(_ nextValue: Bool) {
        guard !rsvpViewModel.isSaving else {
            return
        }

        let previousExcludedPartnerRSVPUserID = locallyExcludedPartnerRSVPUserID
        locallyExcludedPartnerRSVPUserID = nextValue ? nil : partnerRelationship?.partner.id
        rsvpViewModel.setIncludePartner(nextValue)

        guard let currentStatus = rsvpViewModel.status else {
            return
        }

        Task {
            let didUpdate = await rsvpViewModel.toggle(
                currentStatus,
                eventID: currentEvent.id,
                using: apiClient,
                includePartner: nextValue,
                notifyFriends: rsvpViewModel.notifyFriends,
                forceUpdate: true,
                notGoingReason: currentStatus == .notGoing ? rsvpViewModel.notGoingReason : nil
            )

            if didUpdate {
                handleSuccessfulRSVPChange()
            } else {
                locallyExcludedPartnerRSVPUserID = previousExcludedPartnerRSVPUserID
            }
        }
    }

    private func handleSuccessfulRSVPChange(
        showConfirmation: Bool = false,
        allowsUndo: Bool = false
    ) {
        AppAnalytics.log(.rsvpUpdated, [
            "new_status": rsvpViewModel.status?.rawValue ?? "none",
            "include_partner": rsvpViewModel.includePartner,
            "notify_friends": rsvpViewModel.notifyFriends,
        ])
        ProfileViewModel.invalidateCache()
        UserProfileViewModel.invalidateAllCaches()
        if let userID = clerk.user?.id {
            EventRSVPPrefetchCache.store(
                EventRSVPState(
                    status: rsvpViewModel.status,
                    notGoingReason: rsvpViewModel.notGoingReason,
                    includePartner: rsvpViewModel.includePartner,
                    updatedAt: .now
                ),
                eventID: currentEvent.id,
                userID: userID
            )
        }
        NotificationCenter.default.post(name: .eventRSVPDidChange, object: currentEvent.id)

        if showConfirmation, let status = rsvpViewModel.status {
            showRSVPConfirmation(for: status, allowsUndo: allowsUndo)
        }
    }

    private func showRSVPConfirmation(
        for status: EventRSVPStatus,
        allowsUndo: Bool = false
    ) {
        let confirmation = RSVPConfirmation(status: status, allowsUndo: allowsUndo)
        rsvpConfirmationToken = confirmation.id
        isRSVPConfirmationVisible = false

        ConfirmationHaptic.play()

        rsvpConfirmation = confirmation

        Task { @MainActor in
            await Task.yield()
            guard rsvpConfirmationToken == confirmation.id else {
                return
            }

            withAnimation(.spring(response: 0.35, dampingFraction: 0.60)) {
                isRSVPConfirmationVisible = true
            }
        }

        Task { @MainActor in
            try? await Task.sleep(for: .seconds(allowsUndo ? 4 : 2))
            guard rsvpConfirmationToken == confirmation.id else {
                return
            }

            withAnimation(.spring(response: 0.28, dampingFraction: 0.82)) {
                isRSVPConfirmationVisible = false
            }

            try? await Task.sleep(for: .milliseconds(300))
            guard rsvpConfirmationToken == confirmation.id else {
                return
            }

            rsvpConfirmation = nil
        }
    }

    private func scheduleFriendNotification(for status: EventRSVPStatus) {
        let token = UUID()
        pendingRSVPNotificationToken = token

        Task { @MainActor in
            try? await Task.sleep(for: .seconds(4))
            guard pendingRSVPNotificationToken == token,
                  rsvpViewModel.status == status,
                  rsvpViewModel.notifyFriends else {
                return
            }

            _ = try? await apiClient.send(
                APIClient.sendMobileEventRSVPNotification(
                    eventID: currentEvent.id,
                    status: status,
                    notifyFriends: true
                )
            )
        }
    }

    private func cancelPendingRSVPNotification() {
        pendingRSVPNotificationToken = UUID()
    }

    private func undoPendingRSVP() {
        guard let status = rsvpViewModel.status else {
            return
        }

        cancelPendingRSVPNotification()
        rsvpConfirmation = nil
        isRSVPConfirmationVisible = false

        Task {
            if await rsvpViewModel.toggle(
                status,
                eventID: currentEvent.id,
                using: apiClient,
                includePartner: false,
                notifyFriends: rsvpViewModel.notifyFriends
            ) {
                handleSuccessfulRSVPChange()
            }
        }
    }

    private var rsvpButtonTitle: String {
        if shouldOfferReview {
            return "How was it?"
        }

        if shouldOfferRetroactiveWent {
            return "Event Ended"
        }

        switch rsvpViewModel.status {
        case .going:
            return currentEvent.hasEnded ? "Attended" : "Going"
        case .interested:
            return "Interested"
        case .notGoing:
            if let reason = rsvpViewModel.notGoingReason {
                return "Can't Go (\(reason.title))"
            }

            return "Can't Go"
        case nil:
            return currentEvent.hasEnded ? "Event Passed" : "RSVP"
        }
    }

    private var rsvpButtonSystemImage: String? {
        if shouldOfferReview {
            return nil
        }

        if shouldOfferRetroactiveWent {
            return nil
        }

        switch rsvpViewModel.status {
        case .going:
            return "checkmark"
        case .interested:
            return "star.fill"
        case .notGoing:
            return "xmark"
        case nil:
            return currentEvent.hasEnded ? "clock" : nil
        }
    }

    private var rsvpButtonColor: Color {
        if shouldOfferRetroactiveWent {
            return .white
        }

        if shouldOfferReview {
            return AppTheme.accentBlue
        }

        return rsvpViewModel.status?.rsvpTintColor ?? .white
    }

    private var isRSVPInteractionDisabled: Bool {
        rsvpViewModel.isSaving || (currentEvent.hasEnded && !shouldOfferReview && !shouldOfferRetroactiveWent)
    }

    private var shouldOfferRetroactiveWent: Bool {
        isAuthenticated && currentEvent.hasEnded && rsvpViewModel.status != .going
    }

    private var shouldOfferReview: Bool {
        isAuthenticated &&
            currentEvent.hasEnded &&
            rsvpViewModel.status == .going &&
            hasLoadedCurrentUserReview &&
            currentUserReview == nil
    }

    private var isRSVPChevronExpanded: Bool {
        shouldOfferReview ? isReviewSheetPresented : isRSVPMenuExpanded
    }

    private var shouldHideCompletedRSVP: Bool {
        currentEvent.hasEnded &&
            (!hasLoadedCurrentUserReview || currentUserReview != nil)
    }

    private var isAuthenticated: Bool {
        appSession.isAuthBypassed || clerk.user != nil
    }

    private var currentEvent: EventFeedItem {
        editedEvent ?? event
    }

    private var displayedEvent: EventFeedItem {
        var displayedEvent = currentEvent.updatingCurrentUserRSVP(
            status: rsvpViewModel.status,
            notGoingReason: rsvpViewModel.notGoingReason,
            currentUser: currentUserSocialUser
        )

        if rsvpViewModel.includePartner,
           let partnerSocialUser,
           let status = rsvpViewModel.status
        {
            displayedEvent = displayedEvent.updatingSocialRSVP(
                for: partnerSocialUser,
                status: status
            )
        } else if let partnerSocialUser,
                  locallyExcludedPartnerRSVPUserID == partnerSocialUser.id
        {
            displayedEvent = displayedEvent.updatingSocialRSVP(
                for: partnerSocialUser,
                status: nil
            )
        }

        return displayedEvent
    }

    private var partnerSocialUser: EventSocialUser? {
        guard let partnerRelationship, partnerRelationship.isAccepted else {
            return nil
        }

        let partner = partnerRelationship.partner
        return EventSocialUser(
            id: partner.id,
            firstName: partner.firstName,
            lastName: partner.lastName,
            avatarImageURL: partner.avatarImageURL,
            isCurrentUser: false,
            isFriend: true
        )
    }

    private var displayedNotGoingAttendees: [EventSocialRSVP] {
        guard rsvpViewModel.status == .notGoing,
              let currentUserSocialUser
        else {
            return []
        }

        return [
            EventSocialRSVP(
                status: .notGoing,
                user: currentUserSocialUser
            )
        ]
    }

    private var goingAttendees: [EventSocialRSVP] {
        displayedEvent.friendsGoing
    }

    private var interestedAttendees: [EventSocialRSVP] {
        displayedEvent.friendsInterested
    }

    private var notGoingAttendees: [EventSocialRSVP] {
        displayedEvent.friendsNotGoing + displayedNotGoingAttendees
    }

    private var friendGoingAttendees: [EventSocialRSVP] {
        displayedEvent.friendsGoing.filter { !$0.user.isCurrentUser }
    }

    private var friendInterestedAttendees: [EventSocialRSVP] {
        displayedEvent.friendsInterested.filter { !$0.user.isCurrentUser }
    }

    private var friendNotGoingAttendees: [EventSocialRSVP] {
        displayedEvent.friendsNotGoing.filter { !$0.user.isCurrentUser }
    }

    private var hasFriendRSVPs: Bool {
        !friendGoingAttendees.isEmpty || !friendInterestedAttendees.isEmpty || !friendNotGoingAttendees.isEmpty
    }

    private var shouldShowNotGoingOption: Bool {
        rsvpViewModel.status == .going || rsvpViewModel.status == .interested ||
            !friendGoingAttendees.isEmpty ||
            !friendInterestedAttendees.isEmpty
    }

    private var visibleRSVPMenuOptions: [RSVPMenuOption] {
        RSVPMenuOption.allCases.filter { option in
            option != .notGoing || shouldShowNotGoingOption
        }
    }

    private var friendRSVPPreviewAttendees: [EventSocialAttendee] {
        friendGoingAttendees.map { rsvp in
            EventSocialAttendee(
                id: rsvp.user.id,
                firstName: rsvp.user.firstName,
                lastName: rsvp.user.lastName,
                avatarImageURL: rsvp.user.avatarImageURL,
                status: rsvp.status
            )
        }
    }

    private var friendSummaryText: String {
        let goingCount = friendGoingAttendees.count
        let interestedCount = friendInterestedAttendees.count
        let notGoingCount = friendNotGoingAttendees.count

        let parts = [
            goingCount > 0 ? "\(goingCount) \(goingRSVPLabel)" : nil,
            interestedCount > 0 ? "\(interestedCount) Interested" : nil,
            notGoingCount > 0 ? "\(notGoingCount) Can't Go" : nil,
        ].compactMap { $0 }

        return parts.joined(separator: " • ")
    }

    private var rsvpSheetFriendSummaryText: String {
        let goingCount = friendGoingAttendees.count
        let interestedCount = friendInterestedAttendees.count

        if goingCount > 0, interestedCount > 0 {
            return "\(goingCount) going • \(interestedCount) interested"
        }

        if goingCount > 0 {
            return goingCount == 1 ? "1 friend is going" : "\(goingCount) friends are going"
        }

        return interestedCount == 1
            ? "1 friend is interested"
            : "\(interestedCount) friends are interested"
    }

    private var goingRSVPLabel: String {
        currentEvent.hasEnded ? "Attended" : "Going"
    }

    // Captures the signed-in user's identity (once, before any RSVP invalidates the
    // profile cache) so a first-time RSVP shows up immediately in the going /
    // interested lists and avatar stack without waiting for a fresh fetch.
    private func loadCurrentUserSocialUser() async {
        guard currentUserSocialUser == nil else {
            return
        }

        if ProfileViewModel.currentUserSummary == nil {
            await ProfileViewModel().load(using: apiClient)
        }

        guard !Task.isCancelled, !presentationLifecycle.isClosing else {
            return
        }

        guard let summary = ProfileViewModel.currentUserSummary else {
            return
        }

        let nameParts = summary.name
            .split(separator: " ", maxSplits: 1, omittingEmptySubsequences: true)
            .map(String.init)

        currentUserSocialUser = EventSocialUser(
            id: summary.id,
            firstName: nameParts.first,
            lastName: nameParts.count > 1 ? nameParts[1] : nil,
            avatarImageURL: summary.avatarImageURL,
            isCurrentUser: true
        )
    }

    private var shareURL: URL {
        URL(string: "https://www.whoisgoing.com/event/\(currentEvent.publicID)")!
    }

    private var relativeStartDayText: String {
        currentEvent.relativeStartDayText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func mergeUpdatedEvent(_ updatedEvent: EventFeedItem) -> EventFeedItem {
        EventFeedItem(
            id: updatedEvent.id,
            publicID: updatedEvent.publicID,
            title: updatedEvent.title,
            description: updatedEvent.description,
            coverImageURL: updatedEvent.coverImageURL,
            eventURL: updatedEvent.eventURL,
            seriesID: updatedEvent.seriesID ?? currentEvent.seriesID,
            seriesPublicID: updatedEvent.seriesPublicID ?? currentEvent.seriesPublicID,
            startAt: updatedEvent.startAt,
            endAt: updatedEvent.endAt,
            address: updatedEvent.address,
            city: updatedEvent.city,
            state: updatedEvent.state,
            timeZone: updatedEvent.timeZone,
            metroAreaCity: updatedEvent.metroAreaCity ?? currentEvent.metroAreaCity,
            metroAreaState: updatedEvent.metroAreaState ?? currentEvent.metroAreaState,
            venueID: updatedEvent.venueID,
            venueName: updatedEvent.venueName,
            venueSlug: updatedEvent.venueSlug,
            organizerID: updatedEvent.organizerID,
            organizerName: updatedEvent.organizerName,
            organizerSlug: updatedEvent.organizerSlug,
            venueLogoImageURL: updatedEvent.venueLogoImageURL,
            organizerLogoImageURL: updatedEvent.organizerLogoImageURL,
            categories: updatedEvent.categories,
            categoryLabels: updatedEvent.categoryLabels,
            status: updatedEvent.status,
            updatedAt: updatedEvent.updatedAt,
            canEdit: updatedEvent.canEdit,
            isFollowed: currentEvent.isFollowed,
            isCreatedByCurrentUser: currentEvent.isCreatedByCurrentUser,
            userRsvpStatus: currentEvent.userRsvpStatus,
            userRsvpNotGoingReason: currentEvent.userRsvpNotGoingReason,
            friendsGoing: currentEvent.friendsGoing,
            friendsInterested: currentEvent.friendsInterested,
            friendsNotGoing: currentEvent.friendsNotGoing,
            promo: currentEvent.promo
        )
    }
}

private struct AppleCalendarComposerView: UIViewControllerRepresentable {
    let title: String
    let startDate: Date
    let endDate: Date
    let timeZone: TimeZone
    let location: String
    let notes: String?
    let url: URL?

    @Environment(\.dismiss) private var dismiss

    func makeCoordinator() -> Coordinator {
        Coordinator(dismiss: dismiss)
    }

    func makeUIViewController(context: Context) -> EKEventEditViewController {
        let store = EKEventStore()
        let controller = EKEventEditViewController()
        let event = EKEvent(eventStore: store)
        event.title = title
        event.startDate = startDate
        event.endDate = endDate
        event.timeZone = timeZone
        event.location = location
        event.notes = notes
        event.url = url

        controller.eventStore = store
        controller.event = event
        controller.editViewDelegate = context.coordinator
        return controller
    }

    func updateUIViewController(_ uiViewController: EKEventEditViewController, context: Context) {}

    final class Coordinator: NSObject, EKEventEditViewDelegate {
        private let dismiss: DismissAction

        init(dismiss: DismissAction) {
            self.dismiss = dismiss
        }

        func eventEditViewController(
            _ controller: EKEventEditViewController,
            didCompleteWith action: EKEventEditViewAction
        ) {
            dismiss()
        }
    }
}

private struct EventAttendeeSection: View {
    let attendees: [EventSocialRSVP]
    let attendeeReviewRatings: [String: EventReviewRating]

    var body: some View {
        VStack(spacing: 2) {
            ForEach(attendees, id: \.user.id) { attendee in
                NavigationLink(
                    value: EventRSVPAttendeeRoute(
                        userID: attendee.user.id,
                        isCurrentUser: attendee.user.isCurrentUser
                    )
                ) {
                    EventAttendeeRow(
                        attendee: attendee,
                        reviewRating: attendeeReviewRatings[attendee.user.id]
                    )
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct EventRSVPFriendsRow: View {
    let attendees: [EventSocialAttendee]

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            if attendees.isEmpty {
                Text("View responses")
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.white.opacity(0.56))
            } else {
                ScrollView(.horizontal, showsIndicators: false) {
                    HStack(alignment: .top, spacing: 6) {
                        ForEach(attendees) { attendee in
                            EventFriendAvatarTile(attendee: attendee)
                        }
                    }
                }
                .scrollDisabled(true)
            }

            Spacer(minLength: 12)

            Image(systemName: "chevron.right")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(.white.opacity(0.7))
        }
        .padding(.vertical, 4)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
    }
}

private struct EventFriendAvatarTile: View {
    let attendee: EventSocialAttendee

    var body: some View {
        VStack(spacing: 8) {
            UserAvatarView(
                imageURL: attendee.avatarImageURL,
                name: displayName,
                size: 54,
                identityKey: attendee.id
            )

            Text(firstName)
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.white.opacity(0.64))
                .lineLimit(1)
                .frame(width: 60)
        }
    }

    private var firstName: String {
        if let firstName = attendee.firstName?.trimmingCharacters(in: .whitespacesAndNewlines),
           !firstName.isEmpty
        {
            return firstName
        }

        return displayName
            .split(separator: " ")
            .map(String.init)
            .first ?? displayName
    }

    private var displayName: String {
        let name = [attendee.firstName, attendee.lastName]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")

        return name.isEmpty ? "Friend" : name
    }
}

private enum EventDetailRoute: Identifiable, Hashable {
    case rsvpList

    var id: String {
        switch self {
        case .rsvpList:
            "rsvp-list"
        }
    }
}

// The place page owns event cards opened from its own list. A navigation push is
// the supported zoom destination inside an existing presentation; another
// full-screen cover falls back to the default upward modal transition.
private struct EventPlaceDetailRouteView: View {
    let place: PlaceListItem

    @Environment(\.eventDetailTransitionNamespace) private var transitionNamespace
    @State private var presentedEventDetail: EventDetailPresentation?

    var body: some View {
        // Share the event's navigation stack so UIKit can interactively pop back
        // to the event, and keep nested event pushes in the same history.
        PlaceDetailView(place: place)
            .environment(\.eventDetailTransitionNamespace, transitionNamespace)
            .environment(\.eventDetailPresentationAction) { event, transitionSourceID in
                presentedEventDetail = EventDetailPresentation(
                    event: event,
                    transitionSourceID: transitionSourceID
                )
            }
            .navigationDestination(item: $presentedEventDetail) { presentation in
                NestedEventDetailPresentationView(
                    presentation: presentation,
                    transitionNamespace: transitionNamespace
                )
            }
    }
}

private struct NestedEventDetailPresentationView: View {
    let presentation: EventDetailPresentation
    let transitionNamespace: Namespace.ID?
    @Environment(Clerk.self) private var clerk

    private var preloadedPromotions: [EventFriendPromotion] {
        guard let userID = clerk.user?.id else { return [] }
        return EventPromotionPrefetchCache.promotions(
            eventID: presentation.event.id,
            userID: userID
        )
    }

    var body: some View {
        Group {
            if #available(iOS 18.0, *),
               let transitionNamespace,
               let sourceID = presentation.transitionSourceID
            {
                EventDetailView(
                    event: presentation.event,
                    preloadedPromotions: preloadedPromotions
                )
                    .navigationTransition(
                        .zoom(sourceID: sourceID, in: transitionNamespace)
                    )
            } else {
                EventDetailView(
                    event: presentation.event,
                    preloadedPromotions: preloadedPromotions
                )
            }
        }
        .presentationBackground(.clear)
    }
}

private struct EventRSVPListRouteView: View {
    let goingAttendees: [EventSocialRSVP]
    let interestedAttendees: [EventSocialRSVP]
    let notGoingAttendees: [EventSocialRSVP]
    let isPastEvent: Bool
    let eventID: UUID
    let attendeeReviewRatings: [String: EventReviewRating]
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        EventRSVPListView(
            goingAttendees: goingAttendees,
            interestedAttendees: interestedAttendees,
            notGoingAttendees: notGoingAttendees,
            isPastEvent: isPastEvent,
            eventID: eventID,
            attendeeReviewRatings: attendeeReviewRatings
        )
        .navigationDestination(for: EventRSVPAttendeeRoute.self) { route in
            UserProfileView(
                userID: route.userID,
                showsFriendAction: !route.isCurrentUser
            )
        }
        .background(AppTheme.background.ignoresSafeArea())
        .background(SwipeBackEnabler())
        .navigationBarBackButtonHidden()
        .toolbar(.hidden, for: .navigationBar)
        .safeAreaInset(edge: .top, spacing: 0) {
            ZStack {
                Text("Friends")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.white)

                HStack {
                    FloatingGlassIconButton(systemImage: "chevron.left") { dismiss() }
                    Spacer()
                }
            }
            .padding(.horizontal, 16)
            .frame(height: 46)
            .background(AppTheme.background)
        }
    }
}

private struct EventRSVPAttendeeRoute: Hashable {
    let userID: String
    let isCurrentUser: Bool
}

private struct EventRSVPListView: View {
    let goingAttendees: [EventSocialRSVP]
    let interestedAttendees: [EventSocialRSVP]
    let notGoingAttendees: [EventSocialRSVP]
    let isPastEvent: Bool
    let eventID: UUID
    let attendeeReviewRatings: [String: EventReviewRating]
    @Environment(\.apiClient) private var apiClient
    @State private var loadedAttendeeReviewRatings = [String: EventReviewRating]()
    @State private var selectedSection: EventRSVPListSection = .going

    private var reviewRatings: [String: EventReviewRating] {
        attendeeReviewRatings.merging(loadedAttendeeReviewRatings) { _, loaded in loaded }
    }

    private var sections: [EventRSVPListSection] {
        var sections: [EventRSVPListSection] = [.going, .interested]
        if !notGoingAttendees.isEmpty {
            sections.append(.notGoing)
        }
        return sections
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                ScopePillBar {
                    ForEach(sections, id: \.self) { section in
                        ScopePill(
                            title: section.title(isPastEvent: isPastEvent),
                            count: attendees(for: section).count,
                            isSelected: selectedSection == section
                        ) {
                            selectedSection = section
                        }
                    }
                }

                let selectedAttendees = attendees(for: selectedSection)
                if selectedAttendees.isEmpty {
                    EventRSVPEmptyPlaceholder(
                        message: emptyMessage(for: selectedSection)
                    )
                } else {
                    EventAttendeeSection(
                        attendees: selectedAttendees,
                        attendeeReviewRatings: reviewRatings
                    )
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 6)
        }
        .background(AppTheme.background.ignoresSafeArea())
        .task(id: eventID) {
            guard isPastEvent else { return }

            do {
                let response = try await apiClient.send(
                    APIClient.mobileEventAttendeeReviews(eventID: eventID)
                )
                loadedAttendeeReviewRatings = Dictionary(
                    uniqueKeysWithValues: response.reviews.map { ($0.userID, $0.rating) }
                )
            } catch {
                loadedAttendeeReviewRatings = [:]
            }
        }
    }

    private func attendees(for section: EventRSVPListSection) -> [EventSocialRSVP] {
        switch section {
        case .going: goingAttendees
        case .interested: interestedAttendees
        case .notGoing: notGoingAttendees
        }
    }

    private func emptyMessage(for section: EventRSVPListSection) -> String {
        switch section {
        case .going: isPastEvent ? "No one attended" : "No one is going yet"
        case .interested: "No one is interested yet"
        case .notGoing: "No one has said they can't go"
        }
    }
}

private struct EventRSVPEmptyPlaceholder: View {
    let message: String

    var body: some View {
        RoundedRectangle(cornerRadius: 20, style: .continuous)
            .fill(Color.clear)
            .frame(maxWidth: .infinity)
            .frame(height: 140)
            .overlay {
                Text(message)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.white.opacity(0.58))
                    .multilineTextAlignment(.center)
                    .padding(.horizontal, 24)
            }
            .overlay {
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .strokeBorder(
                        style: StrokeStyle(
                            lineWidth: 1,
                            dash: [5, 5]
                        )
                    )
                    .foregroundStyle(.white.opacity(0.10))
            }
            .background(
                RoundedRectangle(cornerRadius: 20, style: .continuous)
                    .fill(Color.white.opacity(0.015))
            )
    }
}

private enum EventRSVPListSection: Hashable {
    case going
    case interested
    case notGoing

    func title(isPastEvent: Bool) -> String {
        switch self {
        case .going: isPastEvent ? "Attended" : "Going"
        case .interested: "Interested"
        case .notGoing: "Can't Go"
        }
    }
}

private struct EventAttendeeRow: View {
    let attendee: EventSocialRSVP
    let reviewRating: EventReviewRating?

    var body: some View {
        UserListRowView(
            imageURL: attendee.user.avatarImageURL,
            name: displayName,
            avatarName: actualName,
            identityKey: attendee.user.id,
            ringWidth: 0,
            avatarSize: 42,
            verticalPadding: 5,
            nameFontSize: 14,
            subtitleFontSize: 10
        ) {
            if let reviewRating {
                Text(reviewRating.reviewEmoji)
                    .font(.system(size: 24))
            }
        }
    }

    private var displayName: String {
        if attendee.user.isCurrentUser {
            return "You"
        }

        return actualName
    }

    private var actualName: String {
        let parts = [attendee.user.firstName, attendee.user.lastName]
            .compactMap { value in
                let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
                return trimmed.isEmpty ? nil : trimmed
            }

        return parts.isEmpty ? "Unknown" : parts.joined(separator: " ")
    }
}

private struct ShareSheet: UIViewControllerRepresentable {
    let activityItems: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: activityItems, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

struct EventArtworkViewer: View {
    private enum Source {
        case url(URL)
        case image(UIImage)
    }

    private let source: Source

    @Environment(\.dismiss) private var dismiss
    @State private var baseScale: CGFloat = 1
    @State private var pinchScale: CGFloat = 1
    @State private var imageOffset: CGSize = .zero
    @State private var dragTranslation: CGSize = .zero

    private var totalScale: CGFloat {
        min(max(baseScale * pinchScale, 1), 4)
    }

    private var verticalDismissOffset: CGFloat {
        guard totalScale <= 1.02 else {
            return 0
        }

        return max(dragTranslation.height, 0)
    }

    init(imageURL: URL) {
        source = .url(imageURL)
    }

    init(image: UIImage) {
        source = .image(image)
    }

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black
                .opacity(backgroundOpacity)
                .ignoresSafeArea()

            switch source {
            case .url(let imageURL):
                AsyncImage(url: imageURL) { phase in
                    switch phase {
                    case .empty:
                        ProgressView()
                            .tint(.white)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    case .success(let image):
                        zoomableArtwork(image)
                    case .failure:
                        artworkFailure
                    @unknown default:
                        EmptyView()
                    }
                }
            case .image(let uiImage):
                zoomableArtwork(Image(uiImage: uiImage))
            }

            FloatingGlassIconButton(systemImage: "xmark") {
                dismiss()
            }
            .padding(.top, 0)
            .padding(.trailing, 26)
        }
        .statusBarHidden()
    }

    private func zoomableArtwork(_ image: Image) -> some View {
        image
            .resizable()
            .scaledToFit()
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .scaleEffect(totalScale)
            .offset(
                x: imageOffset.width + horizontalDragOffset,
                y: imageOffset.height + verticalDragOffset
            )
            .padding(.horizontal, 12)
            .padding(.vertical, 28)
            .gesture(combinedArtworkGesture)
            .onTapGesture(count: 2) {
                withAnimation(.spring(response: 0.28, dampingFraction: 0.82)) {
                    if totalScale > 1.02 {
                        resetTransform()
                    } else {
                        baseScale = 2
                        pinchScale = 1
                    }
                }
            }
    }

    private var artworkFailure: some View {
        Image(systemName: "photo")
            .font(.system(size: 52, weight: .regular))
            .foregroundStyle(.white.opacity(0.72))
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var combinedArtworkGesture: some Gesture {
        SimultaneousGesture(dragGesture, magnificationGesture)
    }

    private var magnificationGesture: some Gesture {
        MagnifyGesture()
            .onChanged { value in
                pinchScale = value.magnification
            }
            .onEnded { value in
                withAnimation(.spring(response: 0.24, dampingFraction: 0.84)) {
                    baseScale = min(max(baseScale * value.magnification, 1), 4)
                    pinchScale = 1

                    if baseScale <= 1.02 {
                        resetTransform()
                    }
                }
            }
    }

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 0, coordinateSpace: .local)
            .onChanged { value in
                dragTranslation = value.translation
            }
            .onEnded { value in
                let predictedDismiss = max(
                    value.translation.height,
                    value.predictedEndTranslation.height
                )

                if totalScale <= 1.02 && predictedDismiss > 140 {
                    dismiss()
                    return
                }

                withAnimation(.spring(response: 0.28, dampingFraction: 0.84)) {
                    if totalScale > 1.02 {
                        imageOffset.width += value.translation.width
                        imageOffset.height += value.translation.height
                    }

                    dragTranslation = .zero

                    if totalScale <= 1.02 {
                        imageOffset = .zero
                    }
                }
            }
    }

    private var horizontalDragOffset: CGFloat {
        totalScale > 1.02 ? dragTranslation.width : 0
    }

    private var verticalDragOffset: CGFloat {
        totalScale > 1.02 ? dragTranslation.height : verticalDismissOffset
    }

    private func resetTransform() {
        baseScale = 1
        pinchScale = 1
        imageOffset = .zero
        dragTranslation = .zero
    }

    private var backgroundOpacity: Double {
        let progress = min(max(verticalDismissOffset / 220, 0), 1)
        return 1 - (progress * 0.35)
    }
}

private struct RSVPPartnerRow: View {
    let partner: MobilePartnerUser
    @Binding var isOn: Bool
    let isLoading: Bool

    var body: some View {
        HStack(spacing: 12) {
            Text("RSVP with \(partner.firstNameDisplay)")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(.white)
                .lineLimit(1)

            Spacer(minLength: 12)

            Toggle("", isOn: $isOn)
                .labelsHidden()
                .tint(AppTheme.accentBlue)
                .disabled(isLoading)
        }
        .padding(.horizontal, 14)
        .frame(height: 58)
    }
}

private struct RSVPNotifyFriendsRow: View {
    @Binding var isOn: Bool
    let isLoading: Bool

    var body: some View {
        HStack(spacing: 12) {
            Text("Notify Friends")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(.white)

            Spacer(minLength: 12)

            Toggle("", isOn: $isOn)
                .labelsHidden()
                .tint(AppTheme.accentBlue)
                .disabled(isLoading)
        }
        .padding(.horizontal, 14)
        .frame(height: 58)
    }
}

private struct RSVPCircleOptionButton: View {
    let option: RSVPMenuOption
    let isSelected: Bool
    let isDimmed: Bool
    let isLoading: Bool
    let diameter: CGFloat
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            VStack(spacing: 10) {
                ZStack {
                    Circle()
                        .fill(
                            LinearGradient(
                                colors: [
                                    option.status.rsvpTintColor.opacity(isSelected ? 0.94 : 0.38),
                                    option.status.rsvpTintColor.opacity(isSelected ? 0.62 : 0.12),
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                        )
                        .overlay {
                            Circle()
                                .strokeBorder(
                                    LinearGradient(
                                        colors: [
                                            .white.opacity(isSelected ? 0.46 : 0.28),
                                            option.status.rsvpTintColor.opacity(isSelected ? 0.90 : 0.48),
                                            .black.opacity(0.26),
                                        ],
                                        startPoint: .topLeading,
                                        endPoint: .bottomTrailing
                                    ),
                                    lineWidth: isSelected ? 2 : 1.5
                                )
                        }
                        .shadow(
                            color: option.status.rsvpTintColor.opacity(isSelected ? 0.40 : 0.18),
                            radius: isSelected ? 16 : 10,
                            x: 0,
                            y: 8
                        )
                        .shadow(
                            color: .black.opacity(0.42),
                            radius: 10,
                            x: 0,
                            y: 8
                        )

                    Circle()
                        .fill(
                            RadialGradient(
                                colors: [
                                    .white.opacity(isSelected ? 0.28 : 0.18),
                                    .clear,
                                ],
                                center: UnitPoint(x: 0.27, y: 0.20),
                                startRadius: 0,
                                endRadius: diameter * 0.70
                            )
                        )
                        .padding(2)

                    if isLoading && isSelected {
                        ProgressView().tint(iconColor)
                    } else {
                        Image(systemName: option.systemImage)
                            .font(.system(size: 28, weight: .bold))
                            .foregroundStyle(iconColor)
                            .symbolEffect(.bounce, value: isSelected)
                            .shadow(
                                color: isSelected ? .black.opacity(0.24) : option.status.rsvpTintColor.opacity(0.22),
                                radius: 3,
                                x: 0,
                                y: 2
                            )
                    }
                }
                .frame(width: diameter, height: diameter)

                Text(option.title)
                    .font(.system(size: 15, weight: .bold))
                    .lineLimit(1)
                    .foregroundStyle(.white)
            }
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
        }
        .buttonStyle(
            RSVPCircleOptionButtonStyle(
                isSelected: isSelected,
                isDimmed: isDimmed
            )
        )
        .disabled(isLoading)
    }

    private var iconColor: Color {
        if isSelected {
            return option.status == .interested ? .black.opacity(0.78) : .white
        }
        return option.status.rsvpTintColor
    }

}

private struct RSVPCircleOptionButtonStyle: ButtonStyle {
    let isSelected: Bool
    let isDimmed: Bool

    func makeBody(configuration: Configuration) -> some View {
        configuration.label
            .scaleEffect(configuration.isPressed ? 0.93 : (isSelected ? 1.02 : (isDimmed ? 0.96 : 1)))
            .saturation(isDimmed ? 0.28 : 1)
            .opacity(isDimmed ? 0.52 : 1)
            .brightness(configuration.isPressed ? -0.06 : 0)
            .animation(
                .spring(response: 0.26, dampingFraction: 0.64),
                value: configuration.isPressed
            )
            .animation(
                .spring(response: 0.30, dampingFraction: 0.72),
                value: isSelected
            )
            .animation(
                .easeOut(duration: 0.20),
                value: isDimmed
            )
    }
}

private struct RSVPSheetAvatarStack: View {
    let attendees: [EventSocialAttendee]

    private var visibleAttendees: [EventSocialAttendee] {
        Array(attendees.prefix(3))
    }

    var body: some View {
        ZStack(alignment: .leading) {
            ForEach(Array(visibleAttendees.enumerated()), id: \.element.id) { index, attendee in
                UserAvatarView(
                    imageURL: attendee.avatarImageURL,
                    name: displayName(for: attendee),
                    size: 32,
                    identityKey: attendee.id
                )
                .overlay(Circle().strokeBorder(Color.black.opacity(0.72), lineWidth: 2))
                .offset(x: CGFloat(index) * 22)
                .zIndex(Double(visibleAttendees.count - index))
            }
        }
        .frame(
            width: 32 + CGFloat(max(visibleAttendees.count - 1, 0)) * 22,
            height: 32,
            alignment: .leading
        )
    }

    private func displayName(for attendee: EventSocialAttendee) -> String {
        let name = [attendee.firstName, attendee.lastName]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")
        return name.isEmpty ? "Friend" : name
    }
}

private struct RSVPDeclineReasonMenuButton: View {
    let reason: EventRSVPDeclineReason
    let isSelected: Bool
    let isLoading: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: reason.systemImage)
                    .font(.system(size: 15, weight: .bold))
                    .frame(width: 22)

                Text(reason.title)
                    .font(.system(size: 15, weight: .bold))
                    .lineLimit(1)

                Spacer(minLength: 8)

                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .opacity(isSelected ? 1 : 0)
            }
            .foregroundStyle(isSelected ? EventRSVPStatus.notGoing.rsvpTintColor : .white)
            .padding(.horizontal, 14)
            .frame(height: 52)
            .background(isSelected ? Color.white.opacity(0.10) : Color.clear, in: Capsule())
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(isLoading)
        .animation(.snappy(duration: 0.18), value: isSelected)
    }
}

private struct RSVPDeclineSkipButton: View {
    let isLoading: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: "minus.circle")
                    .font(.system(size: 15, weight: .bold))
                    .frame(width: 22)

                Text("No reason")
                    .font(.system(size: 15, weight: .bold))
                    .lineLimit(1)

                Spacer(minLength: 8)
            }
            .foregroundStyle(.white.opacity(0.82))
            .padding(.horizontal, 14)
            .frame(height: 48)
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .disabled(isLoading)
    }
}

private struct RSVPMenuNavigationButton: View {
    let title: String
    let direction: RSVPMenuNavigationDirection
    let isLoading: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                if direction == .back {
                    Image(systemName: "chevron.left")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(.white.opacity(0.72))
                        .frame(width: 22)
                }

                Text(title)
                    .font(.system(size: 15, weight: .bold))
                    .foregroundStyle(.white)
                    .lineLimit(1)

                Spacer(minLength: 8)

                if direction == .forward {
                    Image(systemName: "chevron.right")
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(.white.opacity(0.72))
                }
            }
            .padding(.horizontal, 14)
            .frame(height: 48)
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(isLoading)
    }
}

@MainActor
enum EventRSVPPrefetchCache {
    private struct Key: Hashable {
        let eventID: UUID
        let userID: String
    }

    private static var states = [Key: EventRSVPState]()
    private static var inFlightLoads = [Key: Task<EventRSVPState, Error>]()

    static func state(eventID: UUID, userID: String) -> EventRSVPState? {
        states[Key(eventID: eventID, userID: userID)]
    }

    static func store(_ state: EventRSVPState, eventID: UUID, userID: String) {
        states[Key(eventID: eventID, userID: userID)] = state
    }

    static func preload(eventID: UUID, userID: String, using apiClient: APIClient) async {
        let key = Key(eventID: eventID, userID: userID)

        if states[key] != nil {
            return
        }

        if let inFlightLoad = inFlightLoads[key] {
            if let state = try? await inFlightLoad.value {
                states[key] = state
            }
            return
        }

        let loadTask = Task {
            try await apiClient.send(APIClient.mobileEventRSVP(eventID: eventID))
        }
        inFlightLoads[key] = loadTask

        if let state = try? await loadTask.value {
            states[key] = state
        }

        inFlightLoads[key] = nil
    }
}

@MainActor
enum EventPromotionPrefetchCache {
    private struct Key: Hashable {
        let eventID: UUID
        let userID: String
    }

    private static var values = [Key: [EventFriendPromotion]]()
    private static var inFlightLoads = [Key: Task<[EventFriendPromotion], Error>]()

    static func promotions(eventID: UUID, userID: String) -> [EventFriendPromotion] {
        values[Key(eventID: eventID, userID: userID)] ?? []
    }

    static func store(
        _ promotions: [EventFriendPromotion],
        eventID: UUID,
        userID: String
    ) {
        values[Key(eventID: eventID, userID: userID)] = promotions
    }

    static func preload(eventID: UUID, userID: String, using apiClient: APIClient) async {
        let key = Key(eventID: eventID, userID: userID)
        if values[key] != nil { return }

        if let inFlightLoad = inFlightLoads[key] {
            if let promotions = try? await inFlightLoad.value {
                values[key] = promotions
            }
            return
        }

        let loadTask = Task {
            try await apiClient
                .send(APIClient.mobileEventFriendPromotions(eventID: eventID))
                .promotions
        }
        inFlightLoads[key] = loadTask

        if let promotions = try? await loadTask.value {
            values[key] = promotions
        }
        inFlightLoads[key] = nil
    }
}

private enum RSVPMenuMode {
    case rsvp
    case declineReason
    case more
}

private struct RSVPConfirmation: Identifiable, Equatable {
    let id = UUID()
    let status: EventRSVPStatus
    let allowsUndo: Bool

    var title: String {
        "RSVP’d \(status.title)"
    }
}

private struct RSVPConfirmationToast: View {
    let confirmation: RSVPConfirmation
    let onUndo: (() -> Void)?

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: confirmation.status.systemImage)
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(confirmation.status.rsvpTintColor)
                .symbolEffect(.bounce, value: confirmation.id)

            Text(confirmation.title)
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.white)

            if let onUndo {
                Button("Undo", action: onUndo)
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(AppTheme.accentBlue)
                    .buttonStyle(.plain)
            }
        }
        .padding(.horizontal, 16)
        .frame(height: 52)
        .eventDetailLiquidGlass(in: Capsule())
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(confirmation.title)
    }
}

private enum RSVPMenuNavigationDirection {
    case back
    case forward
}

private extension EventRSVPStatus {
    var title: String {
        switch self {
        case .going:
            return "Going"
        case .interested:
            return "Interested"
        case .notGoing:
            return "Can't Go"
        }
    }

    var systemImage: String {
        switch self {
        case .going:
            return "checkmark.circle.fill"
        case .interested:
            return "star.fill"
        case .notGoing:
            return "xmark.circle.fill"
        }
    }

    var rsvpTintColor: Color {
        switch self {
        case .going:
            return AppTheme.accentBlue
        case .interested:
            return .yellow
        case .notGoing:
            return .red
        }
    }
}

private extension EventReviewRating {
    var reviewTitle: String {
        switch self {
        case .lovedIt:
            return "Loved it"
        case .likedIt:
            return "Liked it"
        case .okay:
            return "It was okay"
        case .didNotLikeIt:
            return "Didn't like it"
        }
    }

    var reviewEmoji: String {
        switch self {
        case .lovedIt:
            return "😍"
        case .likedIt:
            return "🙂"
        case .okay:
            return "😐"
        case .didNotLikeIt:
            return "😞"
        }
    }
}

private extension PostEventFeedbackResponse {
    init?(reviewRating: EventReviewRating) {
        switch reviewRating {
        case .lovedIt:
            self = .lovedIt
        case .likedIt:
            self = .likedIt
        case .okay:
            self = .okay
        case .didNotLikeIt:
            self = .didNotLikeIt
        }
    }
}

private extension EventRSVPDeclineReason {
    var systemImage: String {
        switch self {
        case .busy:
            return "calendar.badge.clock"
        case .outOfTown:
            return "airplane"
        case .working:
            return "briefcase"
        case .layingLow:
            return "moon"
        }
    }
}

private extension MobilePartnerUser {
    var firstNameDisplay: String {
        if let firstName = firstName?.trimmingCharacters(in: .whitespacesAndNewlines),
           !firstName.isEmpty
        {
            return firstName
        }

        let components = displayName
            .split(separator: " ")
            .map(String.init)

        return components.first ?? displayName
    }

    var displayName: String {
        let fullName = [firstName, lastName]
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: " ")

        return fullName.isEmpty ? username : fullName
    }
}

private enum RSVPMenuOption: CaseIterable, Identifiable {
    case going
    case interested
    case notGoing

    var id: EventRSVPStatus {
        status
    }

    var title: String {
        switch self {
        case .going:
            return "Going"
        case .interested:
            return "Interested"
        case .notGoing:
            return "Can't Go"
        }
    }

    var systemImage: String {
        switch self {
        case .going:
            return "checkmark"
        case .interested:
            return "star.fill"
        case .notGoing:
            return "xmark"
        }
    }

    var status: EventRSVPStatus {
        switch self {
        case .going:
            return .going
        case .interested:
            return .interested
        case .notGoing:
            return .notGoing
        }
    }
}

private extension View {
    @ViewBuilder
    func eventDetailLiquidGlass<S: InsettableShape>(in shape: S) -> some View {
        if #available(iOS 26.1, *) {
            glassEffect(.regular.interactive(), in: shape)
        } else if #available(iOS 26.0, *) {
            glassEffect(.regular, in: shape)
        } else {
            background(.black.opacity(0.26), in: shape)
                .background(.ultraThinMaterial, in: shape)
                .overlay(
                    shape.strokeBorder(.white.opacity(0.18), lineWidth: 1)
                )
                .shadow(color: .black.opacity(0.30), radius: 22, x: 0, y: 12)
        }
    }
}

struct EventSeriesEditSheet: View {
    let seriesID: UUID
    let seriesPublicID: String
    var onSeriesUpdated: (() -> Void)? = nil

    @Environment(\.apiClient) private var apiClient
    @State private var state: LoadState = .loading

    var body: some View {
        Group {
            switch state {
            case .loading:
                NativeLoadingView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .background(AppTheme.background)

            case .loaded(let series):
                MobileEventCreationView(
                    mode: .editSeries(series),
                    onSeriesCompleted: {
                        NotificationCenter.default.post(name: .mobileEventDidChange, object: seriesID)
                        onSeriesUpdated?()
                    }
                )

            case .failed(let message):
                ContentUnavailableView {
                    Label("Couldn't Load Series", systemImage: "wifi.exclamationmark")
                } description: {
                    Text(message)
                } actions: {
                    Button("Try Again") {
                        Task {
                            await load()
                        }
                    }
                }
                .foregroundStyle(.white)
                .background(AppTheme.background)
            }
        }
        .task {
            await load()
        }
    }

    private func load() async {
        state = .loading

        do {
            let series = try await apiClient.send(
                APIClient.mobileEventSeriesDetail(seriesPublicID: seriesPublicID)
            )
            state = .loaded(series)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    private enum LoadState {
        case loading
        case loaded(MobileEventSeriesDetail)
        case failed(String)
    }
}

@MainActor
private final class EventRSVPViewModel: ObservableObject {
    @Published private(set) var status: EventRSVPStatus?
    @Published private(set) var notGoingReason: EventRSVPDeclineReason?
    @Published private(set) var includePartner = false
    @Published private(set) var notifyFriends = true
    @Published private(set) var isSaving = false
    @Published private(set) var errorMessage: String?

    private var loadedEventID: UUID?

    init(status: EventRSVPStatus? = nil, notGoingReason: EventRSVPDeclineReason? = nil) {
        self.status = status
        self.notGoingReason = notGoingReason
    }

    func load(
        eventID: UUID,
        using apiClient: APIClient,
        shouldApply: @MainActor () -> Bool = { true }
    ) async {
        guard shouldApply(), loadedEventID != eventID else {
            return
        }

        loadedEventID = eventID
        errorMessage = nil

        do {
            let state = try await apiClient.send(APIClient.mobileEventRSVP(eventID: eventID))

            guard !Task.isCancelled, shouldApply() else {
                return
            }

            status = state.status
            notGoingReason = state.notGoingReason
            includePartner = state.includePartner
        } catch {
            guard !Task.isCancelled, shouldApply() else {
                return
            }

            errorMessage = error.localizedDescription
        }
    }

    func setIncludePartner(_ includePartner: Bool) {
        self.includePartner = includePartner
    }

    func setNotifyFriends(_ notifyFriends: Bool) {
        self.notifyFriends = notifyFriends
    }

    func toggle(
        _ nextStatus: EventRSVPStatus,
        eventID: UUID,
        using apiClient: APIClient,
        includePartner nextIncludePartner: Bool = false,
        notifyFriends nextNotifyFriends: Bool = true,
        sendFriendNotifications: Bool? = nil,
        forceUpdate: Bool = false,
        notGoingReason nextNotGoingReason: EventRSVPDeclineReason? = nil
    ) async -> Bool {
        guard !isSaving else {
            return false
        }

        let previousStatus = status
        let previousNotGoingReason = notGoingReason
        let previousIncludePartner = includePartner
        let previousNotifyFriends = notifyFriends
        let shouldDelete = !forceUpdate && previousStatus == nextStatus && nextStatus != .notGoing

        status = shouldDelete ? nil : nextStatus
        notGoingReason = shouldDelete ? nil : nextNotGoingReason
        includePartner = shouldDelete ? false : nextIncludePartner
        notifyFriends = nextNotifyFriends
        errorMessage = nil
        isSaving = true

        do {
            let state: EventRSVPState

            if shouldDelete {
                state = try await apiClient.send(APIClient.deleteMobileEventRSVP(eventID: eventID))
            } else {
                let endpoint = try APIClient.updateMobileEventRSVP(
                    eventID: eventID,
                    status: nextStatus,
                    notGoingReason: nextStatus == .notGoing ? nextNotGoingReason : nil,
                    includePartner: nextIncludePartner,
                    notifyFriends: sendFriendNotifications ?? nextNotifyFriends
                )
                state = try await apiClient.send(endpoint)
            }

            status = state.status
            notGoingReason = state.notGoingReason
            includePartner = state.includePartner
        } catch {
            status = previousStatus
            notGoingReason = previousNotGoingReason
            includePartner = previousIncludePartner
            notifyFriends = previousNotifyFriends
            errorMessage = error.localizedDescription
            isSaving = false
            return false
        }

        isSaving = false
        return true
    }
}

#Preview {
    EventDetailView(
        event: EventFeedItem(
            id: UUID(),
            title: "Haute and Freddy",
            description: "Haute and Freddy bring a bright, theatrical set to the room.",
            coverImageURL: nil,
            eventURL: URL(string: "https://ticketmaster.com"),
            seriesID: nil,
            startAt: .now,
            endAt: nil,
            address: "50 Church Street",
            city: "Cambridge",
            state: "MA",
            venueID: nil,
            venueName: "The Sinclair",
            venueSlug: nil,
            organizerID: nil,
            organizerName: nil,
            organizerSlug: nil,
            venueLogoImageURL: nil,
            organizerLogoImageURL: nil,
            categories: ["concerts"],
            categoryLabels: ["concerts": "Concerts"],
            status: .active,
            updatedAt: nil
        )
    )
}

private struct EventPromoLinkDestination: Identifiable {
    let url: URL
    var id: String { url.absoluteString }
}

private struct EventPromoBrowser: UIViewControllerRepresentable {
    let url: URL

    func makeUIViewController(context: Context) -> SFSafariViewController {
        SFSafariViewController(url: url)
    }

    func updateUIViewController(_ controller: SFSafariViewController, context: Context) {}
}

private struct EventFriendPromotionRow: View {
    let promotion: EventFriendPromotion
    let onOpenLink: (URL) -> Void

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            avatar

            VStack(alignment: .leading, spacing: 6) {
                Text(promotion.displayName)
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)

                if let promo = trimmedPromo {
                    Text(promo)
                        .font(.system(size: 14, weight: .regular))
                        .foregroundStyle(.white.opacity(0.82))
                        .multilineTextAlignment(.leading)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if let url = promotion.linkURL {
                    Button {
                        onOpenLink(url)
                    } label: {
                        HStack(spacing: 5) {
                            Text(promotion.promoUrl ?? url.absoluteString)
                                .lineLimit(1)
                                .truncationMode(.middle)
                            Image(systemName: "arrow.up.right")
                                .font(.system(size: 11, weight: .semibold))
                        }
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(AppTheme.accentBlue)
                    }
                    .buttonStyle(.plain)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.vertical, 14)
    }

    @ViewBuilder
    private var avatar: some View {
        if let avatarImageURL = promotion.avatarImageURL {
            RemoteImageView(url: avatarImageURL) { image in
                image.resizable().scaledToFill()
            } placeholder: {
                avatarPlaceholder
            }
            .frame(width: 42, height: 42)
            .clipShape(Circle())
        } else {
            avatarPlaceholder
                .frame(width: 42, height: 42)
        }
    }

    private var avatarPlaceholder: some View {
        Circle()
            .fill(.white.opacity(0.10))
            .overlay {
                Text(String(promotion.displayName.prefix(1)).uppercased())
                    .font(.system(size: 16, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.78))
            }
    }

    private var trimmedPromo: String? {
        guard let promo = promotion.promo?.trimmingCharacters(in: .whitespacesAndNewlines),
              !promo.isEmpty
        else { return nil }
        return promo
    }
}

private struct EventPromotionEditorSheet: View {
    let event: PromotableEvent
    let onSaved: (PromotableEvent) -> Void
    @Environment(\.apiClient) private var apiClient
    @Environment(\.dismiss) private var dismiss
    @State private var promo: String
    @State private var promoUrl: String
    @State private var isSaving = false
    @State private var errorMessage: String?

    init(event: PromotableEvent, onSaved: @escaping (PromotableEvent) -> Void) {
        self.event = event
        self.onSaved = onSaved
        _promo = State(initialValue: event.promo ?? "")
        _promoUrl = State(initialValue: event.promoUrl ?? "")
    }

    var body: some View {
        NavigationStack {
            VStack(alignment: .leading, spacing: 18) {
                Text(event.title).font(.headline).foregroundStyle(.white)
                clearableField(title: "Promo", text: $promo, limit: 70, isMultiline: true)
                clearableField(title: "Promo Link", text: $promoUrl, limit: 2048, isMultiline: false)
                Spacer()
                if event.isPromoted {
                    Button("Stop Promoting", role: .destructive) { Task { await stopPromoting() } }
                        .frame(maxWidth: .infinity, minHeight: 46)
                }
            }
            .padding(20)
            .background(AppTheme.background.ignoresSafeArea())
            .navigationTitle("Manage Promoting")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(isSaving ? "Saving…" : "Save") { Task { await save() } }.disabled(isSaving)
                }
            }
        }
        .alert("Unable to Update", isPresented: Binding(get: { errorMessage != nil }, set: { if !$0 { errorMessage = nil } })) {
            Button("OK", role: .cancel) {}
        } message: { Text(errorMessage ?? "Please try again.") }
    }

    private func clearableField(title: String, text: Binding<String>, limit: Int, isMultiline: Bool) -> some View {
        VStack(alignment: .trailing, spacing: 4) {
            HStack(alignment: .top, spacing: 8) {
                TextField(title, text: text, axis: isMultiline ? .vertical : .horizontal)
                    .lineLimit(isMultiline ? 1 ... 6 : 1 ... 1)
                    .textInputAutocapitalization(isMultiline ? .sentences : .never)
                    .autocorrectionDisabled(!isMultiline)
                    .onChange(of: text.wrappedValue) { _, value in
                        if value.count > limit { text.wrappedValue = String(value.prefix(limit)) }
                    }
                if !text.wrappedValue.isEmpty {
                    Button { text.wrappedValue = "" } label: {
                        Image(systemName: "xmark.circle.fill").foregroundStyle(.tertiary)
                    }.buttonStyle(.plain).accessibilityLabel("Clear \(title.lowercased())")
                }
            }
            if isMultiline { Text("\(text.wrappedValue.count)/\(limit)").font(.caption2).foregroundStyle(.secondary).monospacedDigit() }
        }
        .padding(12)
        .background(Color.white.opacity(0.07), in: RoundedRectangle(cornerRadius: 12))
    }

    private func save() async { await update(promoted: true) }
    private func stopPromoting() async { await update(promoted: false) }

    private func update(promoted: Bool) async {
        isSaving = true
        defer { isSaving = false }
        do {
            let response = try await apiClient.send(try APIClient.setMobileEventPromoted(
                eventID: event.id, promoted: promoted,
                promo: promo.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : promo,
                promoUrl: promoUrl
            ))
            var updated = event
            updated.isPromoted = response.promoted
            updated.promo = response.promo
            updated.promoUrl = response.promoUrl
            onSaved(updated)
            ProfileViewModel.invalidateCache()
            UserProfileViewModel.invalidateAllCaches()
            NotificationCenter.default.post(name: .appDataDidChange, object: nil)
            dismiss()
        } catch { errorMessage = error.localizedDescription }
    }
}
