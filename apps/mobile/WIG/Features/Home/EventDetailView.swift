import ClerkKit
import EventKit
import EventKitUI
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
    @State private var isImageViewerPresented = false
    @State private var isEditEventPresented = false
    @State private var editingSeriesRoute: EventSeriesEditRoute?
    @State private var isCalendarComposerPresented = false
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
    @State private var currentUserReview: MobileEventReview?
    @State private var attendeeReviewRatings = [String: EventReviewRating]()
    @State private var hasLoadedCurrentUserReview = false
    @State private var isReviewSheetPresented = false
    @StateObject private var presentationLifecycle = EventDetailPresentationLifecycle()
    @State private var presentedPlace: PlaceListItem?
    @State private var presentedRoute: EventDetailRoute?

    private let placeNavigationAnimation = Animation.easeInOut(duration: 0.30)
    private let routeNavigationAnimation = Animation.easeInOut(duration: 0.24)

    init(event: EventFeedItem) {
        self.event = event

        let cachedReview = EventReviewCache.review(for: event.id)

        _rsvpViewModel = StateObject(
            wrappedValue: EventRSVPViewModel(
                status: event.userRsvpStatus,
                notGoingReason: event.userRsvpNotGoingReason
            )
        )
        _currentUserReview = State(initialValue: cachedReview ?? event.currentUserReview)
        _hasLoadedCurrentUserReview = State(
            initialValue: !event.hasEnded || cachedReview != nil || event.hasLoadedCurrentUserReview
        )
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
                        header: {
                            VStack(alignment: .leading, spacing: 0) {
                                details

                                if isAuthenticated {
                                    if !shouldHideCompletedRSVP {
                                        inlineRSVPSection
                                            .padding(.top, 20)
                                    }
                                } else {
                                    guestRSVPButton
                                        .padding(.top, 20)
                                }
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
                        }
                    )

                    VStack(alignment: .leading, spacing: 20) {
                        eventReviewSection
                        rsvpdSection
                        about
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 10)
                    .padding(.bottom, 36)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
            .scrollIndicators(.hidden)
            // Fill the whole screen (including behind the status bar) with the app
            // background, but keep the SCROLL CONTENT within the top safe area. If the
            // scroll content underlaps the status bar while the nav bar is hidden, iOS
            // injects an automatic status-bar scrim (the "black fade" at the top).
            .background(AppTheme.background.ignoresSafeArea())
        .navigationBarBackButtonHidden()
        .toolbar(.hidden, for: .navigationBar)
        .overlay {
            if isAuthenticated {
                ZStack {
                    ZStack(alignment: .bottom) {
                        if isRSVPMenuExpanded {
                            Color.clear
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
            _ = await (rsvpLoad, partnerLoad, currentUserLoad, reviewLoad, attendeeReviewLoad)

            if !Task.isCancelled,
               !presentationLifecycle.isClosing,
               partnerRelationship?.isAccepted == true,
               rsvpViewModel.status == nil
            {
                rsvpViewModel.setIncludePartner(true)
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
            WIGAuthSheetView(isDismissable: true)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
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
        .sheet(item: $editingSeriesRoute) { route in
            EventSeriesEditSheet(seriesID: route.id)
        }
        .fullScreenCover(isPresented: $isImageViewerPresented) {
            if let posterImageURL = currentEvent.posterImageURL {
                EventArtworkViewer(imageURL: posterImageURL)
            }
        }
        .overlay {
            ZStack {
                if let presentedPlace {
                    EventPlaceDetailRouteView(
                        place: presentedPlace,
                        onDismiss: dismissPresentedPlace
                    )
                    .transition(.move(edge: .trailing))
                    .zIndex(1)
                }

                if presentedRoute != nil {
                    EventRSVPListRouteView(
                        goingAttendees: friendGoingAttendees,
                        interestedAttendees: friendInterestedAttendees,
                        notGoingAttendees: friendNotGoingAttendees,
                        isPastEvent: currentEvent.hasEnded,
                        eventID: currentEvent.id,
                        attendeeReviewRatings: attendeeReviewRatings,
                        onDismiss: dismissPresentedRoute
                    )
                    .transition(.move(edge: .trailing))
                    .zIndex(2)
                }
            }
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
        withAnimation(placeNavigationAnimation) {
            presentedPlace = place
        }
    }

    private func dismissPresentedPlace() {
        withAnimation(placeNavigationAnimation) {
            presentedPlace = nil
        }
    }

    private func presentRSVPList() {
        withAnimation(routeNavigationAnimation) {
            presentedRoute = .rsvpList
        }
    }

    private func dismissPresentedRoute() {
        withAnimation(routeNavigationAnimation) {
            presentedRoute = nil
        }
    }

    private var reviewSheetEvent: MobileEventReviewPrompt {
        MobileEventReviewPrompt(
            id: currentEvent.id,
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
            do {
                let endpoint = try APIClient.updateMobileEventRSVP(
                    eventID: currentEvent.id,
                    status: .notGoing,
                    notifyFriends: false
                )
                _ = try await apiClient.send(endpoint)
                await rsvpViewModel.load(eventID: currentEvent.id, using: apiClient)
                isReviewSheetPresented = false
                NotificationCenter.default.post(name: .eventRSVPDidChange, object: nil)
            } catch {
                return false
            }
            return true
        }

        guard let rating = response.rating else { return false }

        do {
            let endpoint = try APIClient.createMobileEventReview(
                eventID: currentEvent.id,
                rating: rating,
                comment: comment
            )
            let review = try await apiClient.send(endpoint)
            EventReviewCache.store(review)
            currentUserReview = review
            await loadAttendeeReviewRatings(using: apiClient)
            isReviewSheetPresented = false
            return true
        } catch {
            return false
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
        HStack(spacing: 12) {
            if currentEvent.eventURL != nil {
                FloatingGlassIconButton(
                    systemImage: "arrow.up.right",
                    size: heroControlButtonSize
                ) {
                    openExternalEvent()
                }
            }

            FloatingGlassIconButton(
                systemImage: "square.and.arrow.up",
                size: heroControlButtonSize
            ) {
                isShareSheetPresented = true
            }

            if appSession.isAdmin {
                editButton
            }
        }
        .sheet(isPresented: $isCalendarComposerPresented) {
            AppleCalendarComposerView(
                title: currentEvent.title,
                startDate: currentEvent.startAt,
                endDate: currentEvent.endAt ?? currentEvent.startAt.addingTimeInterval(2 * 60 * 60),
                timeZone: currentEvent.displayTimeZone,
                location: currentEvent.primaryLocation,
                notes: currentEvent.description,
                url: currentEvent.eventURL
            )
        }
    }

    @ViewBuilder
    private var editButton: some View {
        if let seriesID = currentEvent.seriesID {
            Menu {
                Button {
                    closeRSVPMenu()
                    isEditEventPresented = true
                } label: {
                    Label("Edit Event", systemImage: "calendar")
                }

                Button {
                    closeRSVPMenu()
                    editingSeriesRoute = EventSeriesEditRoute(id: seriesID)
                } label: {
                    Label("Edit Event Series", systemImage: "calendar.badge.clock")
                }
            } label: {
                Image(systemName: "square.and.pencil")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.white)
                    .frame(width: heroControlButtonSize, height: heroControlButtonSize)
                    .contentShape(Circle())
                    .eventDetailLiquidGlass(in: Circle())
            }
            .buttonStyle(.plain)
        } else {
            FloatingGlassIconButton(
                systemImage: "square.and.pencil",
                size: heroControlButtonSize
            ) {
                isEditEventPresented = true
            }
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

                if !relativeStartDayText.isEmpty {
                    Text(relativeStartDayText)
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.66))
                }
            }
            .padding(.top, 6)

            ViewThatFits(in: .horizontal) {
                HStack(alignment: .center, spacing: 8) {
                    venueLabel

                    if !currentEvent.eventDetailCategoryLabels.isEmpty {
                        categoryPills
                    }
                }

                VStack(alignment: .leading, spacing: 8) {
                    venueLabel

                    if !currentEvent.eventDetailCategoryLabels.isEmpty {
                        ScrollView(.horizontal, showsIndicators: false) {
                            categoryPills
                        }
                    }
                }
            }
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
                updatedAt: currentEvent.updatedAt,
                isFollowed: currentEvent.isFollowed
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
                updatedAt: currentEvent.updatedAt,
                isFollowed: currentEvent.isFollowed
            )
        }

        return nil
    }

    private var compactEventDateTimeText: String {
        let prefix = currentEvent.formattedStart(format: "EEE, MMM d")

        guard let endAt = currentEvent.endAt else {
            return "\(prefix) at \(compactTimeString(for: currentEvent.startAt, includeMeridiem: true))"
        }

        let startMeridiem = meridiemString(for: currentEvent.startAt)
        let endMeridiem = meridiemString(for: endAt)
        let includeStartMeridiem = startMeridiem != endMeridiem
        let startText = compactTimeString(for: currentEvent.startAt, includeMeridiem: includeStartMeridiem)
        let endText = compactTimeString(for: endAt, includeMeridiem: true)

        return "\(prefix) at \(startText) - \(endText)"
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

    private func meridiemString(for date: Date) -> String {
        let formatter = DateFormatter()
        formatter.dateFormat = "a"
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
            updatedAt: currentEvent.updatedAt,
            isFollowed: currentEvent.isFollowed
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

                if shouldOfferReview || !currentEvent.hasEnded {
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
        .opacity(currentEvent.hasEnded && !shouldOfferReview ? 0.62 : 1)
    }

    private var expandedRSVPMenu: some View {
        VStack(alignment: .leading, spacing: 0) {
            switch rsvpMenuMode {
            case .rsvp:
                primaryRSVPMenuContent
            case .declineReason:
                declineReasonMenuContent
            case .more:
                rsvpMoreMenuContent
            }
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 12)
    }

    private var primaryRSVPMenuContent: some View {
        VStack(alignment: .leading, spacing: 0) {
            VStack(spacing: 2) {
                ForEach(RSVPMenuOption.allCases.filter { option in
                    option != .notGoing || hasFriendGoingOrInterested
                }) { option in
                    RSVPMenuOptionButton(
                        option: option,
                        isSelected: rsvpViewModel.status == option.status,
                        hasSelection: rsvpViewModel.status != nil,
                        isLoading: rsvpViewModel.isSaving
                    ) {
                        selectRSVP(option.status)
                    }
                }
            }

            Divider()
                .overlay(.white.opacity(0.08))
                .padding(.horizontal, 14)
                .padding(.vertical, 6)

            RSVPMenuNavigationButton(
                title: "More",
                direction: .forward,
                isLoading: rsvpViewModel.isSaving
            ) {
                withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
                    rsvpMenuMode = .more
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
    private var about: some View {
        if let description = currentEvent.description?.trimmingCharacters(in: .whitespacesAndNewlines),
           !description.isEmpty
        {
            VStack(alignment: .leading, spacing: 14) {
                Text("About")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(.white)

                Text(description)
                    .font(.system(size: 14, weight: .medium))
                    .foregroundStyle(.white.opacity(0.64))
                    .lineSpacing(4)
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

                Rectangle()
                    .fill(Color.white.opacity(0.08))
                    .frame(maxWidth: .infinity)
                    .frame(height: 1)
                    .padding(.top, 6)
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

        let shouldDelayFriendNotification = rsvpViewModel.notifyFriends

        Task {
            if await rsvpViewModel.toggle(
                status,
                eventID: currentEvent.id,
                using: apiClient,
                includePartner: partnerRelationship?.isAccepted == true && rsvpViewModel.includePartner,
                notifyFriends: rsvpViewModel.notifyFriends,
                sendFriendNotifications: !shouldDelayFriendNotification
            ) {
                handleSuccessfulRSVPChange(showConfirmation: true, allowsUndo: shouldDelayFriendNotification)
                if shouldDelayFriendNotification {
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
            }
        }
    }

    private func handleSuccessfulRSVPChange(
        showConfirmation: Bool = false,
        allowsUndo: Bool = false
    ) {
        ProfileViewModel.invalidateCache()
        UserProfileViewModel.invalidateAllCaches()
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
                  rsvpViewModel.status == status else {
                return
            }

            _ = try? await apiClient.send(
                APIClient.sendMobileEventRSVPNotification(
                    eventID: currentEvent.id,
                    status: status
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

        switch rsvpViewModel.status {
        case .going:
            return currentEvent.hasEnded ? "Went" : "Going"
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
            return "bubble.left"
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
        if shouldOfferReview {
            return AppTheme.accentBlue
        }

        return rsvpViewModel.status?.rsvpTintColor ?? .white
    }

    private var isRSVPInteractionDisabled: Bool {
        rsvpViewModel.isSaving || (currentEvent.hasEnded && !shouldOfferReview)
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

    private var hasFriendGoingOrInterested: Bool {
        !friendGoingAttendees.isEmpty || !friendInterestedAttendees.isEmpty
    }

    private var hasFriendRSVPs: Bool {
        !friendGoingAttendees.isEmpty || !friendInterestedAttendees.isEmpty || !friendNotGoingAttendees.isEmpty
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

    private var goingRSVPLabel: String {
        currentEvent.hasEnded ? "Went" : "Going"
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
        URL(string: "https://www.whoisgoing.com/event/\(currentEvent.id.uuidString)")!
    }

    private var relativeStartDayText: String {
        currentEvent.relativeStartDayText.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private func mergeUpdatedEvent(_ updatedEvent: EventFeedItem) -> EventFeedItem {
        EventFeedItem(
            id: updatedEvent.id,
            title: updatedEvent.title,
            description: updatedEvent.description,
            coverImageURL: updatedEvent.coverImageURL,
            eventURL: updatedEvent.eventURL,
            seriesID: updatedEvent.seriesID ?? currentEvent.seriesID,
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
            friendsNotGoing: currentEvent.friendsNotGoing
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
    let title: String
    let attendees: [EventSocialRSVP]
    let attendeeReviewRatings: [String: EventReviewRating]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(.white)

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

private enum EventDetailRoute: Identifiable {
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
    let onDismiss: () -> Void

    @Environment(\.eventDetailTransitionNamespace) private var transitionNamespace
    @State private var presentedEventDetail: EventDetailPresentation?

    var body: some View {
        NavigationStack {
            PlaceDetailView(place: place, onDismiss: onDismiss)
                .environment(\.eventDetailTransitionNamespace, transitionNamespace)
                .environment(\.eventDetailPresentationAction) { event, transitionSourceID in
                    presentedEventDetail = EventDetailPresentation(
                        event: event,
                        transitionSourceID: transitionSourceID
                    )
                }
                .navigationDestination(item: $presentedEventDetail, destination: { presentation in
                    NestedEventDetailPresentationView(
                        presentation: presentation,
                        transitionNamespace: transitionNamespace
                    )
                })
            }
            .simultaneousGesture(
                DragGesture(minimumDistance: 12)
                    .onEnded { value in
                        let isLeadingEdgeSwipe = value.startLocation.x < 32
                        let isPrimarilyHorizontal = abs(value.predictedEndTranslation.width)
                            > abs(value.predictedEndTranslation.height)

                        guard isLeadingEdgeSwipe,
                              isPrimarilyHorizontal,
                              value.predictedEndTranslation.width > 110
                        else {
                            return
                        }

                        onDismiss()
                    }
            )
    }
}

private struct NestedEventDetailPresentationView: View {
    let presentation: EventDetailPresentation
    let transitionNamespace: Namespace.ID?

    var body: some View {
        Group {
            if #available(iOS 18.0, *),
               let transitionNamespace,
               let sourceID = presentation.transitionSourceID
            {
                EventDetailView(event: presentation.event)
                    .navigationTransition(
                        .zoom(sourceID: sourceID, in: transitionNamespace)
                    )
            } else {
                EventDetailView(event: presentation.event)
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
    let onDismiss: () -> Void
    @State private var navigationPath = NavigationPath()

    var body: some View {
        NavigationStack(path: $navigationPath) {
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
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button(action: onDismiss) {
                        Image(systemName: "chevron.left")
                    }
                }
            }
        }
        .background(AppTheme.background.ignoresSafeArea())
        .simultaneousGesture(
            DragGesture(minimumDistance: 12)
            .onEnded { value in
                let isLeadingEdgeSwipe = value.startLocation.x < 32
                let isPrimarilyHorizontal = abs(value.predictedEndTranslation.width)
                    > abs(value.predictedEndTranslation.height)

                guard navigationPath.isEmpty,
                      isLeadingEdgeSwipe,
                      isPrimarilyHorizontal,
                      value.predictedEndTranslation.width > 110
                else {
                    return
                }

                onDismiss()
            }
        )
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

    private var reviewRatings: [String: EventReviewRating] {
        attendeeReviewRatings.merging(loadedAttendeeReviewRatings) { _, loaded in loaded }
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if !goingAttendees.isEmpty {
                    EventAttendeeSection(
                        title: isPastEvent ? "Went" : "Going",
                        attendees: goingAttendees,
                        attendeeReviewRatings: reviewRatings
                    )
                }

                if !interestedAttendees.isEmpty {
                    EventAttendeeSection(
                        title: "Interested",
                        attendees: interestedAttendees,
                        attendeeReviewRatings: reviewRatings
                    )
                }

                if !notGoingAttendees.isEmpty {
                    EventAttendeeSection(
                        title: "Can't Go",
                        attendees: notGoingAttendees,
                        attendeeReviewRatings: reviewRatings
                    )
                }

                if goingAttendees.isEmpty && interestedAttendees.isEmpty && notGoingAttendees.isEmpty {
                    Text("No RSVPs yet")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(.white.opacity(0.58))
                        .frame(maxWidth: .infinity, alignment: .center)
                        .padding(.top, 24)
                }
            }
            .padding(.horizontal, 16)
            .padding(.top, 18)
            .padding(.bottom, 36)
        }
        .background(AppTheme.background.ignoresSafeArea())
        .navigationTitle("Friends")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
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

private struct RSVPMenuOptionButton: View {
    let option: RSVPMenuOption
    let isSelected: Bool
    let hasSelection: Bool
    let isLoading: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: option.systemImage)
                    .font(.system(size: 15, weight: .bold))
                    .frame(width: 22)
                    .foregroundStyle(iconColor)

                Text(option.title)
                    .font(.system(size: 15, weight: .bold))
                    .lineLimit(1)
                    .foregroundStyle(isSelected ? option.status.rsvpTintColor : .white)

                Spacer(minLength: 8)

                HStack(spacing: 8) {
                    Image(systemName: "checkmark.circle.fill")
                        .font(.system(size: 16, weight: .semibold))
                        .opacity(isSelected ? 1 : 0)
                        .foregroundStyle(option.status.rsvpTintColor)

                    if option.status == .notGoing {
                        Image(systemName: "chevron.right")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(.white.opacity(0.72))
                    }
                }
            }
            .padding(.horizontal, 14)
            .frame(height: 58)
            .background(isSelected ? Color.white.opacity(0.10) : Color.clear, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .contentShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
        }
        .buttonStyle(.plain)
        .disabled(isLoading)
        .animation(.snappy(duration: 0.18), value: isSelected)
    }

    private var iconColor: Color {
        if isSelected || !hasSelection {
            return option.status.rsvpTintColor
        }

        return .white.opacity(0.34)
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
            .frame(height: 48)
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
                } else {
                    Color.clear
                        .frame(width: 22, height: 14)
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

private struct EventSeriesEditRoute: Identifiable {
    let id: UUID
}

private struct EventSeriesEditSheet: View {
    let seriesID: UUID

    @Environment(\.apiClient) private var apiClient
    @State private var state: LoadState = .loading

    var body: some View {
        Group {
            switch state {
            case .loading:
                NativeLoadingView()
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                    .tint(.white)
                    .foregroundStyle(.white)
                    .background(AppTheme.background)

            case .loaded(let series):
                MobileEventCreationView(
                    mode: .editSeries(series),
                    onSeriesCompleted: {
                        NotificationCenter.default.post(name: .mobileEventDidChange, object: seriesID)
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
                APIClient.mobileEventSeriesDetail(seriesID: seriesID)
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
