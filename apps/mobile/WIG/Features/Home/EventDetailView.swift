import ClerkKit
import EventKit
import EventKitUI
import SwiftUI
import UIKit

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

    init(event: EventFeedItem) {
        self.event = event
        _rsvpViewModel = StateObject(
            wrappedValue: EventRSVPViewModel(
                status: event.userRsvpStatus,
                notGoingReason: event.userRsvpNotGoingReason
            )
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
                                    inlineRSVPSection
                                        .padding(.top, 20)
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
                                dismiss()
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
        .background(SwipeBackEnabler())
        .navigationBarBackButtonHidden()
        .toolbar(.hidden, for: .navigationBar)
        .toolbar(.hidden, for: .tabBar)
        .overlay {
            if isAuthenticated {
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
                .animation(.spring(response: 0.32, dampingFraction: 0.82), value: isRSVPMenuExpanded)
            }
        }
        .task(id: "\(currentEvent.id.uuidString)-\(isAuthenticated)") {
            guard isAuthenticated else {
                return
            }

            async let rsvpLoad: Void = rsvpViewModel.load(eventID: currentEvent.id, using: apiClient)
            async let partnerLoad: Void = loadPartner(using: apiClient)
            async let currentUserLoad: Void = loadCurrentUserSocialUser()
            _ = await (rsvpLoad, partnerLoad, currentUserLoad)

            if partnerRelationship?.isAccepted == true, rsvpViewModel.status == nil {
                rsvpViewModel.setIncludePartner(true)
            }
        }
        .onChange(of: isAuthenticated) { _, isAuthenticated in
            guard !isAuthenticated else {
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

            dismiss()
        }
        .onAppear {
            appSession.beginEventDetailPresentation()

            let appearance = UINavigationBarAppearance()
            appearance.configureWithTransparentBackground()
            UINavigationBar.appearance().standardAppearance = appearance
            UINavigationBar.appearance().scrollEdgeAppearance = appearance
        }
        .onDisappear {
            appSession.endEventDetailPresentation()

            let appearance = UINavigationBarAppearance()
            appearance.configureWithDefaultBackground()
            UINavigationBar.appearance().standardAppearance = appearance
            UINavigationBar.appearance().scrollEdgeAppearance = appearance
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
        .sheet(isPresented: $isEditEventPresented) {
            MobileEventCreationView(mode: .edit(currentEvent)) { updatedEvent in
                editedEvent = mergeUpdatedEvent(updatedEvent)
            }
        }
        .sheet(item: $editingSeriesRoute) { route in
            EventSeriesEditSheet(seriesID: route.id)
        }
        .fullScreenCover(isPresented: $isImageViewerPresented) {
            if let posterImageURL = currentEvent.posterImageURL {
                EventArtworkViewer(imageURL: posterImageURL)
            }
        }
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
            UIImpactFeedbackGenerator(style: .light).impactOccurred()
            isAuthSheetPresented = true
        } label: {
            Text("RSVP")
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(.white)
                .lineLimit(1)
                .padding(.horizontal, 22)
                .frame(maxWidth: .infinity)
                .frame(height: 56)
                .contentShape(Capsule())
                .eventDetailLiquidGlass(in: Capsule())
        }
        .buttonStyle(.plain)
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

            venueLabel
                .padding(.top, 7)

            if let organizerPlace {
                organizerLabel(place: organizerPlace)
                    .padding(.top, 6)
            }

            if !currentEvent.eventDetailCategoryLabels.isEmpty {
                ScrollView(.horizontal, showsIndicators: false) {
                    categoryPills
                }
                .padding(.top, 8)
            }
        }
    }

    @ViewBuilder
    private var venueLabel: some View {
        if let linkedPlace {
            NavigationLink {
                PlaceDetailView(place: linkedPlace)
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

            NavigationLink {
                PlaceDetailView(place: place)
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
            guard !rsvpViewModel.isSaving else {
                return
            }

            UIImpactFeedbackGenerator(style: .light).impactOccurred()

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

                Image(systemName: isRSVPMenuExpanded ? "chevron.down" : "chevron.up")
                    .font(.system(size: 12, weight: .bold))
                    .opacity(0.72)
            }
            .foregroundStyle(rsvpButtonColor)
            .padding(.horizontal, 22)
            .frame(maxWidth: .infinity)
            .frame(height: 56)
            .contentShape(Capsule())
            .eventDetailLiquidGlass(in: Capsule())
        }
        .buttonStyle(.plain)
        .disabled(rsvpViewModel.isSaving)
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
                ForEach(RSVPMenuOption.allCases) { option in
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

                NavigationLink {
                    EventRSVPListView(
                        goingAttendees: friendGoingAttendees,
                        interestedAttendees: friendInterestedAttendees,
                        notGoingAttendees: []
                    )
                } label: {
                    EventRSVPFriendsRow(
                        attendees: rsvpSummaryAttendees
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

        if status == .notGoing {
            withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
                rsvpMenuMode = .declineReason
                isRSVPMenuExpanded = true
            }
            return
        }

        closeRSVPMenu()

        Task {
            if await rsvpViewModel.toggle(
                status,
                eventID: currentEvent.id,
                using: apiClient,
                includePartner: partnerRelationship?.isAccepted == true && rsvpViewModel.includePartner,
                notifyFriends: rsvpViewModel.notifyFriends
            ) {
                handleSuccessfulRSVPChange()
            }
        }
    }

    private func saveNotGoing(reason: EventRSVPDeclineReason?) {
        if reason != nil {
            UISelectionFeedbackGenerator().selectionChanged()
        }

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
                handleSuccessfulRSVPChange()
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
            partnerRelationship = response.relationship

            if response.relationship?.isAccepted == true, rsvpViewModel.status == nil {
                rsvpViewModel.setIncludePartner(true)
            } else if response.relationship?.isAccepted != true {
                rsvpViewModel.setIncludePartner(false)
            }
        } catch {
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

    private func handleSuccessfulRSVPChange() {
        ProfileViewModel.invalidateCache()
        UserProfileViewModel.invalidateAllCaches()
        NotificationCenter.default.post(name: .eventRSVPDidChange, object: currentEvent.id)
    }

    private var rsvpButtonTitle: String {
        switch rsvpViewModel.status {
        case .going:
            return "Going"
        case .interested:
            return "Interested"
        case .notGoing:
            if let reason = rsvpViewModel.notGoingReason {
                return "Can't Go (\(reason.title))"
            }

            return "Can't Go"
        case nil:
            return "RSVP"
        }
    }

    private var rsvpButtonSystemImage: String? {
        switch rsvpViewModel.status {
        case .going:
            return "checkmark"
        case .interested:
            return "star.fill"
        case .notGoing:
            return "xmark"
        case nil:
            return nil
        }
    }

    private var rsvpButtonColor: Color {
        rsvpViewModel.status?.rsvpTintColor ?? .white
    }

    private var isAuthenticated: Bool {
        appSession.isAuthBypassed || clerk.user != nil
    }

    private var currentEvent: EventFeedItem {
        editedEvent ?? event
    }

    private var displayedEvent: EventFeedItem {
        currentEvent.updatingCurrentUserRSVP(
            status: rsvpViewModel.status,
            notGoingReason: rsvpViewModel.notGoingReason,
            currentUser: currentUserSocialUser
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

    private var friendGoingAttendees: [EventSocialRSVP] {
        displayedEvent.friendsGoing.filter { !$0.user.isCurrentUser }
    }

    private var friendInterestedAttendees: [EventSocialRSVP] {
        displayedEvent.friendsInterested.filter { !$0.user.isCurrentUser }
    }

    private var hasFriendRSVPs: Bool {
        !friendGoingAttendees.isEmpty || !friendInterestedAttendees.isEmpty
    }

    private var rsvpSummaryAttendees: [EventSocialAttendee] {
        (friendGoingAttendees + friendInterestedAttendees).map { rsvp in
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

        if goingCount > 0, interestedCount > 0 {
            return "\(goingCount) Going • \(interestedCount) Interested"
        }

        if goingCount > 0 {
            return "\(goingCount) Going"
        }

        if interestedCount > 0 {
            return "\(interestedCount) Interested"
        }

        return ""
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
            friendsInterested: currentEvent.friendsInterested
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

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(.white)

            VStack(spacing: 0) {
                ForEach(Array(attendees.enumerated()), id: \.element.user.id) { index, attendee in
                    NavigationLink {
                        if attendee.user.isCurrentUser {
                            UserProfileView(userID: attendee.user.id, showsFriendAction: false)
                        } else {
                            UserProfileView(userID: attendee.user.id)
                        }
                    } label: {
                        EventAttendeeRow(attendee: attendee)
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)

                    if index != attendees.count - 1 {
                        Divider()
                            .overlay(.white.opacity(0.08))
                            .padding(.leading, 62)
                    }
                }
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .fill(Color.white.opacity(0.06))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(.white.opacity(0.08), lineWidth: 1)
            )
        }
    }
}

private struct EventRSVPFriendsRow: View {
    let attendees: [EventSocialAttendee]

    var body: some View {
        HStack(alignment: .center, spacing: 14) {
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(alignment: .top, spacing: 6) {
                    ForEach(attendees) { attendee in
                        EventFriendAvatarTile(attendee: attendee)
                    }
                }
            }
            .scrollDisabled(true)

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
            ZStack {
                Circle()
                    .fill(strokeColor)

                UserAvatarView(
                    imageURL: attendee.avatarImageURL,
                    name: displayName,
                    size: 50,
                    identityKey: attendee.id
                )
            }
            .frame(width: 54, height: 54)

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

    private var strokeColor: Color {
        attendee.status.rsvpTintColor
    }
}

private struct EventRSVPListView: View {
    let goingAttendees: [EventSocialRSVP]
    let interestedAttendees: [EventSocialRSVP]
    let notGoingAttendees: [EventSocialRSVP]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                if !goingAttendees.isEmpty {
                    EventAttendeeSection(
                        title: "Going",
                        attendees: goingAttendees
                    )
                }

                if !interestedAttendees.isEmpty {
                    EventAttendeeSection(
                        title: "Interested",
                        attendees: interestedAttendees
                    )
                }

                if !notGoingAttendees.isEmpty {
                    EventAttendeeSection(
                        title: "Can't Go",
                        attendees: notGoingAttendees
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
        .navigationTitle("RSVP'd")
        .navigationBarTitleDisplayMode(.inline)
        .toolbar(.visible, for: .navigationBar)
    }
}

private struct EventAttendeeRow: View {
    let attendee: EventSocialRSVP

    var body: some View {
        UserListRowView(
            imageURL: attendee.user.avatarImageURL,
            name: displayName,
            avatarName: actualName,
            identityKey: attendee.user.id,
            ringWidth: 0
        )
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
    let imageURL: URL

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

    var body: some View {
        ZStack(alignment: .topTrailing) {
            Color.black
                .opacity(backgroundOpacity)
                .ignoresSafeArea()

            AsyncImage(url: imageURL) { phase in
                switch phase {
                case .empty:
                    ProgressView()
                        .tint(.white)
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                case .success(let image):
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
                case .failure:
                    Image(systemName: "photo")
                        .font(.system(size: 52, weight: .regular))
                        .foregroundStyle(.white.opacity(0.72))
                        .frame(maxWidth: .infinity, maxHeight: .infinity)
                @unknown default:
                    EmptyView()
                }
            }

            FloatingGlassIconButton(systemImage: "xmark") {
                dismiss()
            }
            .padding(.top, 0)
            .padding(.trailing, 26)
        }
        .statusBarHidden()
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

private enum RSVPMenuNavigationDirection {
    case back
    case forward
}

private extension EventRSVPStatus {
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
                ProgressView("Loading series...")
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

    func load(eventID: UUID, using apiClient: APIClient) async {
        guard loadedEventID != eventID else {
            return
        }

        loadedEventID = eventID
        errorMessage = nil

        do {
            let state = try await apiClient.send(APIClient.mobileEventRSVP(eventID: eventID))
            status = state.status
            notGoingReason = state.notGoingReason
            includePartner = state.includePartner
        } catch {
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
                    notifyFriends: nextNotifyFriends
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
