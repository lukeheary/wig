import SwiftUI
import UIKit

struct EventDetailView: View {
    let event: EventFeedItem

    @Environment(\.apiClient) private var apiClient
    @Environment(\.dismiss) private var dismiss
    @StateObject private var rsvpViewModel = EventRSVPViewModel()
    @State private var isShareSheetPresented = false
    @State private var isRSVPMenuExpanded = false
    @State private var rsvpMenuMode: RSVPMenuMode = .rsvp

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEE, MMM d 'at' h:mm a"
        return formatter
    }()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 22) {
                hero
                details
                rsvpErrorMessage
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
            floatingRSVPMenu
        }
        .task(id: event.id) {
            await rsvpViewModel.load(eventID: event.id, using: apiClient)
        }
        .sheet(isPresented: $isShareSheetPresented) {
            ShareSheet(activityItems: [shareURL])
                .presentationDetents([.medium, .large])
        }
    }

    private var hero: some View {
        GeometryReader { proxy in
            let side = proxy.size.width

            eventArtwork
                .frame(width: side, height: side)
                .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                .overlay {
                    EventSocialOverlayView(attendees: event.socialAttendees, size: .detail)
                        .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))
                }
        }
        .aspectRatio(1, contentMode: .fit)
    }

    private var topControls: some View {
        HStack {
            FloatingGlassIconButton(systemImage: "chevron.left") {
                dismiss()
            }

            Spacer()

            FloatingGlassIconButton(systemImage: "square.and.pencil") {}
            FloatingGlassIconButton(systemImage: "square.and.arrow.up") {
                isShareSheetPresented = true
            }
        }
        .padding(.horizontal, 26)
        .padding(.top, 12)
    }

    @ViewBuilder
    private var eventArtwork: some View {
        if let imageURL = event.posterImageURL {
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
            Text(event.title)
                .font(.system(size: 29, weight: .bold))
                .foregroundStyle(.white)
                .lineSpacing(1)

            Text(Self.dateFormatter.string(from: event.startAt))
                .font(.system(size: 18, weight: .bold))
                .foregroundStyle(Color(red: 0.48, green: 0.77, blue: 1.0))

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
                    Text(event.primaryLocation)
                        .font(.system(size: 18, weight: .bold))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                }

                if let category = event.primaryCategoryLabel {
                    Text(category)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.78))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                        .background(Color.white.opacity(0.10), in: Capsule())
                }
            }

            if let sourceName = event.externalSourceName {
                Button {
                    openExternalEvent()
                } label: {
                    Label("View on \(sourceName)", systemImage: "arrow.up.right.square")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.62))
                        .labelStyle(.titleAndIcon)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var linkedPlace: PlaceListItem? {
        if let id = event.venueID,
           let slug = event.venueSlug,
           let name = event.venueName,
           !slug.isEmpty,
           !name.isEmpty
        {
            return PlaceListItem(
                id: id,
                type: .venue,
                slug: slug,
                name: name,
                logoImageURL: event.venueLogoImageURL,
                city: event.city,
                state: event.state,
                upcomingEventCount: 0,
                updatedAt: event.updatedAt,
                isFollowed: event.isFollowed
            )
        }

        let hasVenueName =
            event.venueName?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
        guard !hasVenueName else {
            return nil
        }

        if let id = event.organizerID,
           let slug = event.organizerSlug,
           let name = event.organizerName,
           !slug.isEmpty,
           !name.isEmpty
        {
            return PlaceListItem(
                id: id,
                type: .organizer,
                slug: slug,
                name: name,
                logoImageURL: event.organizerLogoImageURL,
                city: event.city,
                state: event.state,
                upcomingEventCount: 0,
                updatedAt: event.updatedAt,
                isFollowed: event.isFollowed
            )
        }

        return nil
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
                    switch rsvpMenuMode {
                    case .rsvp:
                        ForEach(RSVPMenuOption.allCases) { option in
                            RSVPMenuOptionButton(
                                option: option,
                                isSelected: rsvpViewModel.status == option.status,
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
                    } else if rsvpViewModel.status != nil {
                        Image(systemName: "checkmark")
                            .font(.system(size: 14, weight: .bold))
                    }

                    Text(rsvpButtonTitle)
                        .font(.system(size: 17, weight: .bold))
                        .lineLimit(1)

                    Image(systemName: isRSVPMenuExpanded ? "chevron.down" : "chevron.up")
                        .font(.system(size: 12, weight: .bold))
                        .opacity(0.72)
                }
                .foregroundStyle(.white)
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

            if let description = event.description?.trimmingCharacters(in: .whitespacesAndNewlines),
               !description.isEmpty
            {
                Text(description)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.white.opacity(0.64))
                    .lineSpacing(5)
            }

            ForEach(event.formattedAddressLines, id: \.self) { line in
                Text(line)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.white.opacity(0.64))
            }
        }
    }

    private func openExternalEvent() {
        guard let eventURL = event.eventURL else {
            return
        }

        UIApplication.shared.open(eventURL)
    }

    private func selectRSVP(_ status: EventRSVPStatus) {
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
            if await rsvpViewModel.toggle(status, eventID: event.id, using: apiClient) {
                NotificationCenter.default.post(name: .eventRSVPDidChange, object: event.id)
            }
        }
    }

    private func saveNotGoing(reason: EventRSVPDeclineReason?) {
        withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
            isRSVPMenuExpanded = false
        }

        Task {
            if await rsvpViewModel.toggle(
                .notGoing,
                eventID: event.id,
                using: apiClient,
                notGoingReason: reason
            ) {
                NotificationCenter.default.post(name: .eventRSVPDidChange, object: event.id)
            }
        }
    }

    private func closeRSVPMenu() {
        withAnimation(.spring(response: 0.28, dampingFraction: 0.86)) {
            isRSVPMenuExpanded = false
        }
    }

    private var rsvpButtonTitle: String {
        switch rsvpViewModel.status {
        case .going:
            return "Going"
        case .interested:
            return "Interested"
        case .notGoing:
            return "Can't Go"
        case nil:
            return "RSVP"
        }
    }

    private var shareURL: URL {
        URL(string: "https://www.whoisgoing.com/event/\(event.id.uuidString)")!
    }
}

private struct ShareSheet: UIViewControllerRepresentable {
    let activityItems: [Any]

    func makeUIViewController(context: Context) -> UIActivityViewController {
        UIActivityViewController(activityItems: activityItems, applicationActivities: nil)
    }

    func updateUIViewController(_ uiViewController: UIActivityViewController, context: Context) {}
}

private struct RSVPMenuOptionButton: View {
    let option: RSVPMenuOption
    let isSelected: Bool
    let isLoading: Bool
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            HStack(spacing: 12) {
                Image(systemName: option.systemImage)
                    .font(.system(size: 15, weight: .bold))
                    .frame(width: 22)

                Text(option.title)
                    .font(.system(size: 15, weight: .bold))
                    .lineLimit(1)

                Spacer(minLength: 8)

                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 16, weight: .semibold))
                    .opacity(isSelected ? 1 : 0)
            }
            .foregroundStyle(isSelected ? AppTheme.accentBlue : .white)
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
            .foregroundStyle(isSelected ? AppTheme.accentBlue : .white)
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
            return "star"
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
    @Published private(set) var isSaving = false
    @Published private(set) var errorMessage: String?

    private var loadedEventID: UUID?

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
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func toggle(
        _ nextStatus: EventRSVPStatus,
        eventID: UUID,
        using apiClient: APIClient,
        notGoingReason nextNotGoingReason: EventRSVPDeclineReason? = nil
    ) async -> Bool {
        guard !isSaving else {
            return false
        }

        let previousStatus = status
        let previousNotGoingReason = notGoingReason
        let shouldDelete = previousStatus == nextStatus && nextStatus != .notGoing

        status = shouldDelete ? nil : nextStatus
        notGoingReason = shouldDelete ? nil : nextNotGoingReason
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
                    notGoingReason: nextStatus == .notGoing ? nextNotGoingReason : nil
                )
                state = try await apiClient.send(endpoint)
            }

            status = state.status
            notGoingReason = state.notGoingReason
        } catch {
            status = previousStatus
            notGoingReason = previousNotGoingReason
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
            updatedAt: nil
        )
    )
}
