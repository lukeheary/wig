import ClerkKit
import SwiftUI
import UIKit

struct EventDetailView: View {
    let event: EventFeedItem
    private let heroTopOffset: CGFloat = -10

    @Environment(Clerk.self) private var clerk
    @Environment(\.apiClient) private var apiClient
    @Environment(\.dismiss) private var dismiss
    @EnvironmentObject private var appSession: AppSession
    @StateObject private var rsvpViewModel = EventRSVPViewModel()
    @State private var isShareSheetPresented = false
    @State private var isImageViewerPresented = false
    @State private var isEditEventPresented = false
    @State private var isRSVPMenuExpanded = false
    @State private var rsvpMenuMode: RSVPMenuMode = .rsvp
    @State private var partnerRelationship: MobilePartnerRelationship?
    @State private var editedEvent: EventFeedItem?

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
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                hero
                details
                attendeeSections
                if isAuthenticated {
                    rsvpErrorMessage
                }
                about
            }
            .padding(.horizontal, 16)
            .padding(.top, 0)
            .padding(.bottom, 36)
        }
        .background(Color(red: 0.07, green: 0.07, blue: 0.08).ignoresSafeArea())
        .background(SwipeBackEnabler())
        .navigationBarBackButtonHidden()
        .toolbar(.hidden, for: .navigationBar)
        .overlay(alignment: .top) {
            topControls
        }
        .overlay {
            rsvpMenuDismissOverlay
        }
        .safeAreaInset(edge: .bottom, spacing: 0) {
            if isAuthenticated {
                floatingRSVPMenu
            }
        }
        .task(id: "\(currentEvent.id.uuidString)-\(isAuthenticated)") {
            guard isAuthenticated else {
                return
            }

            async let rsvpLoad: Void = rsvpViewModel.load(eventID: currentEvent.id, using: apiClient)
            async let partnerLoad: Void = loadPartner(using: apiClient)
            _ = await (rsvpLoad, partnerLoad)

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
        }
        .onDisappear {
            appSession.endEventDetailPresentation()
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
        .fullScreenCover(isPresented: $isImageViewerPresented) {
            if let posterImageURL = currentEvent.posterImageURL {
                EventArtworkViewer(imageURL: posterImageURL)
            }
        }
    }

    private var hero: some View {
        GeometryReader { proxy in
            let side = proxy.size.width

            eventArtwork
                .frame(width: side, height: side)
                .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                .overlay {
                    if isAuthenticated {
                        EventSocialOverlayView(attendees: currentEvent.socialAttendees, size: .detail)
                            .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                    }
                }
                .overlay(alignment: .bottomLeading) {
                    if currentEvent.posterImageURL != nil {
                        FloatingGlassIconButton(
                            systemImage: "arrow.up.left.and.arrow.down.right",
                            foregroundColor: .white,
                            size: 46
                        ) {
                            isImageViewerPresented = true
                        }
                        .padding(.leading, 12)
                        .padding(.bottom, 12)
                    }
                }
                .offset(y: heroTopOffset)
        }
        .aspectRatio(1, contentMode: .fit)
        .padding(.bottom, heroTopOffset)
    }

    private var topControls: some View {
        HStack {
            FloatingGlassIconButton(systemImage: "chevron.left") {
                dismiss()
            }

            Spacer()

            if currentEvent.canEdit {
                FloatingGlassIconButton(systemImage: "square.and.pencil") {
                    isEditEventPresented = true
                }
            }

            if currentEvent.eventURL != nil {
                externalEventMenu
            }

            FloatingGlassIconButton(systemImage: "square.and.arrow.up") {
                isShareSheetPresented = true
            }
        }
        .padding(.horizontal, 26)
        .padding(.top, 0)
    }

    @ViewBuilder
    private var eventArtwork: some View {
        if let imageURL = currentEvent.posterImageURL {
            AsyncImage(url: imageURL) { phase in
                switch phase {
                case .empty:
                    artworkPlaceholder
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFill()
                        .clipped()
                case .failure:
                    artworkPlaceholder
                @unknown default:
                    artworkPlaceholder
                }
            }
        } else {
            artworkPlaceholder
        }
    }

    private var artworkPlaceholder: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.18, green: 0.20, blue: 0.26),
                    Color(red: 0.42, green: 0.18, blue: 0.22),
                    Color(red: 0.09, green: 0.09, blue: 0.10),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            Image(systemName: "music.mic")
                .font(.system(size: 72, weight: .regular))
                .foregroundStyle(.white.opacity(0.75))
        }
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: 9) {
            Text(currentEvent.title)
                .font(.system(size: 29, weight: .bold))
                .foregroundStyle(.white)
                .lineSpacing(1)

            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text(currentEvent.formattedStart(format: "EEE, MMM d 'at' h:mm a"))
                    .font(.system(size: 18, weight: .bold))
                    .foregroundStyle(Color(red: 0.48, green: 0.77, blue: 1.0))

                Text(currentEvent.relativeStartDayText)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.58))
            }

            HStack(spacing: 10) {
                if let linkedPlace {
                    NavigationLink {
                        PlaceDetailView(place: linkedPlace)
                    } label: {
                        Text(linkedPlace.name)
                            .font(.system(size: 18, weight: .bold))
                            .foregroundStyle(.white)
                            .lineLimit(1)
                    }
                    .buttonStyle(.plain)
                } else {
                    Text(currentEvent.primaryLocation)
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                }

                if let category = currentEvent.primaryCategoryLabel {
                    Text(category)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.78))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Color.white.opacity(0.10), in: Capsule())
                }
            }

            if let organizerPlace {
                HStack(spacing: 4) {
                    Text("Organized by")
                        .foregroundStyle(.white.opacity(0.62))

                    NavigationLink {
                        PlaceDetailView(place: organizerPlace)
                    } label: {
                        Text(organizerPlace.name)
                            .foregroundStyle(.white)
                    }
                    .buttonStyle(.plain)
                }
                .font(.system(size: 16, weight: .semibold))
            }
        }
    }

    private var externalEventMenu: some View {
        Menu {
            Button {
                openExternalEvent()
            } label: {
                Label(
                    "View on \(currentEvent.externalSourceName ?? "Event Site")",
                    systemImage: "arrow.up.right.square"
                )
            }
        } label: {
            Image(systemName: "arrow.up.right")
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(.primary)
                .frame(width: 46, height: 46)
                .contentShape(Circle())
                .placeDetailLiquidGlass(in: Circle())
        }
        .buttonStyle(.plain)
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
                city: currentEvent.city,
                state: currentEvent.state,
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
                city: currentEvent.city,
                state: currentEvent.state,
                upcomingEventCount: 0,
                updatedAt: currentEvent.updatedAt,
                isFollowed: currentEvent.isFollowed
            )
        }

        return nil
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
            city: currentEvent.city,
            state: currentEvent.state,
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

    private var floatingRSVPMenu: some View {
        VStack(spacing: 10) {
            if isRSVPMenuExpanded {
                VStack(spacing: 2) {
                    if let partnerRelationship, partnerRelationship.isAccepted {
                        RSVPPartnerToggleRow(
                            partnerFirstName: partnerRelationship.partner.firstName ?? partnerRelationship.partner.username,
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
                            .padding(.horizontal, 14)
                            .padding(.vertical, 6)
                    }

                    switch rsvpMenuMode {
                    case .rsvp:
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
                    case .declineReason:
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
                .padding(8)
                .frame(maxWidth: .infinity)
                .eventDetailLiquidGlass(in: RoundedRectangle(cornerRadius: 30, style: .continuous))
                .transition(.move(edge: .bottom).combined(with: .opacity))
            }

            Button {
                guard !rsvpViewModel.isSaving else {
                    return
                }

                withAnimation(.spring(response: 0.32, dampingFraction: 0.82)) {
                    if isRSVPMenuExpanded {
                        isRSVPMenuExpanded = false
                    } else {
                        rsvpMenuMode = .rsvp
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
        .padding(.horizontal, 16)
        .padding(.bottom, 8)
        .frame(maxWidth: .infinity)
        .animation(.spring(response: 0.32, dampingFraction: 0.82), value: isRSVPMenuExpanded)
        .animation(.snappy(duration: 0.18), value: rsvpViewModel.status)
    }

    @ViewBuilder
    private var rsvpMenuDismissOverlay: some View {
        if isRSVPMenuExpanded {
            Color.clear
                .contentShape(Rectangle())
                .ignoresSafeArea()
                .onTapGesture {
                    closeRSVPMenu()
                }
        }
    }

    private var about: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("About")
                .font(.system(size: 23, weight: .bold))
                .foregroundStyle(.white)

            if let description = currentEvent.description?.trimmingCharacters(in: .whitespacesAndNewlines),
               !description.isEmpty
            {
                Text(description)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.white.opacity(0.64))
                    .lineSpacing(5)
            }

            ForEach(currentEvent.formattedAddressLines, id: \.self) { line in
                Text(line)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.white.opacity(0.64))
            }
        }
    }

    @ViewBuilder
    private var attendeeSections: some View {
        if !currentEvent.friendsGoing.isEmpty || !currentEvent.friendsInterested.isEmpty {
            VStack(alignment: .leading, spacing: 18) {
                if !currentEvent.friendsGoing.isEmpty {
                    EventAttendeeSection(
                        title: "Going",
                        attendees: currentEvent.friendsGoing
                    )
                }

                if !currentEvent.friendsInterested.isEmpty {
                    EventAttendeeSection(
                        title: "Interested",
                        attendees: currentEvent.friendsInterested
                    )
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

        if status == .notGoing {
            withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
                rsvpMenuMode = .declineReason
                isRSVPMenuExpanded = true
            }
            return
        }

        withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
            isRSVPMenuExpanded = false
        }

        Task {
            if await rsvpViewModel.toggle(
                status,
                eventID: currentEvent.id,
                using: apiClient,
                includePartner: partnerRelationship?.isAccepted == true && rsvpViewModel.includePartner
            ) {
                NotificationCenter.default.post(name: .eventRSVPDidChange, object: currentEvent.id)
            }
        }
    }

    private func saveNotGoing(reason: EventRSVPDeclineReason?) {
        if reason != nil {
            UISelectionFeedbackGenerator().selectionChanged()
        }

        withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
            isRSVPMenuExpanded = false
        }

        Task {
            if await rsvpViewModel.toggle(
                .notGoing,
                eventID: currentEvent.id,
                using: apiClient,
                includePartner: partnerRelationship?.isAccepted == true && rsvpViewModel.includePartner,
                notGoingReason: reason
            ) {
                NotificationCenter.default.post(name: .eventRSVPDidChange, object: currentEvent.id)
            }
        }
    }

    private func closeRSVPMenu() {
        withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
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
                forceUpdate: true,
                notGoingReason: currentStatus == .notGoing ? rsvpViewModel.notGoingReason : nil
            )

            if didUpdate {
                NotificationCenter.default.post(name: .eventRSVPDidChange, object: currentEvent.id)
            }
        }
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

    private var shareURL: URL {
        URL(string: "https://www.whoisgoing.com/event/\(currentEvent.id.uuidString)")!
    }

    private func mergeUpdatedEvent(_ updatedEvent: EventFeedItem) -> EventFeedItem {
        EventFeedItem(
            id: updatedEvent.id,
            title: updatedEvent.title,
            description: updatedEvent.description,
            coverImageURL: updatedEvent.coverImageURL,
            eventURL: updatedEvent.eventURL,
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

private struct EventAttendeeSection: View {
    let title: String
    let attendees: [EventSocialRSVP]

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.system(size: 23, weight: .bold))
                .foregroundStyle(.white)

            VStack(spacing: 0) {
                ForEach(Array(attendees.enumerated()), id: \.element.user.id) { index, attendee in
                    NavigationLink {
                        UserProfileView(userID: attendee.user.id)
                    } label: {
                        EventAttendeeRow(attendee: attendee)
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

private struct EventAttendeeRow: View {
    let attendee: EventSocialRSVP

    var body: some View {
        UserListRowView(
            imageURL: attendee.user.avatarImageURL,
            name: displayName,
            avatarName: actualName,
            identityKey: attendee.user.id,
            ringColor: ringColor,
            ringWidth: 4
        )
    }

    private var ringColor: Color {
        switch attendee.status {
        case .going:
            return Color(red: 0.23, green: 0.93, blue: 0.86)
        case .interested:
            return Color(red: 0.98, green: 0.78, blue: 0.23)
        case .notGoing:
            return .red
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

private struct RSVPPartnerToggleRow: View {
    let partnerFirstName: String
    @Binding var isOn: Bool
    let isLoading: Bool

    var body: some View {
        HStack(spacing: 12) {
            Text("RSVP with \(partnerFirstName)")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(.white)

            Spacer(minLength: 12)

            Toggle("", isOn: $isOn)
                .labelsHidden()
                .tint(AppTheme.accentBlue)
                .disabled(isLoading)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
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

                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .opacity(isSelected ? 1 : 0)
                    .foregroundStyle(option.status.rsvpTintColor)
            }
            .padding(.horizontal, 14)
            .frame(height: 48)
            .background(isSelected ? Color.white.opacity(0.10) : Color.clear, in: Capsule())
            .contentShape(Capsule())
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
                Image(systemName: "arrow.uturn.forward")
                    .font(.system(size: 15, weight: .bold))
                    .frame(width: 22)

                Text("Skip")
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

private enum RSVPMenuMode {
    case rsvp
    case declineReason
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

@MainActor
private final class EventRSVPViewModel: ObservableObject {
    @Published private(set) var status: EventRSVPStatus?
    @Published private(set) var notGoingReason: EventRSVPDeclineReason?
    @Published private(set) var includePartner = false
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

    func toggle(
        _ nextStatus: EventRSVPStatus,
        eventID: UUID,
        using apiClient: APIClient,
        includePartner nextIncludePartner: Bool = false,
        forceUpdate: Bool = false,
        notGoingReason nextNotGoingReason: EventRSVPDeclineReason? = nil
    ) async -> Bool {
        guard !isSaving else {
            return false
        }

        let previousStatus = status
        let previousNotGoingReason = notGoingReason
        let previousIncludePartner = includePartner
        let shouldDelete = !forceUpdate && previousStatus == nextStatus && nextStatus != .notGoing

        status = shouldDelete ? nil : nextStatus
        notGoingReason = shouldDelete ? nil : nextNotGoingReason
        includePartner = shouldDelete ? false : nextIncludePartner
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
                    includePartner: nextIncludePartner
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
