import SwiftUI
import UIKit

struct ActivityView: View {
    @Environment(\.apiClient) private var apiClient
    @StateObject private var viewModel = ActivityViewModel()
    @State private var selectedFilter: ActivityFeedFilter = .upcoming

    private let background = Color(red: 0.07, green: 0.07, blue: 0.08)

    var body: some View {
        NavigationStack {
            content
                .background(background.ignoresSafeArea())
                .toolbar(.hidden, for: .navigationBar)
                .overlay(alignment: .topLeading) {
                    ActivityFilterDropdown(selection: $selectedFilter)
                        .padding(.leading, 16)
                        .padding(.top, 14)
                }
                .task {
                    if case .idle = viewModel.state {
                        await viewModel.load(using: apiClient)
                    }
                }
                .refreshable {
                    await viewModel.load(using: apiClient, forceRefresh: true)
                }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            ProgressView("Loading activity...")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .tint(.white)
                .foregroundStyle(.white)
                .background(background)

        case .failed(let message):
            ContentUnavailableView {
                Label("Couldn't Load Activity", systemImage: "wifi.exclamationmark")
            } description: {
                Text(message)
            } actions: {
                Button("Try Again") {
                    Task {
                        await viewModel.load(using: apiClient)
                    }
                }
            }
                .background(background)

        case .loaded(let response):
            let activities = selectedFilter.filtered(response.activities)

            if response.activities.isEmpty {
                ContentUnavailableView {
                    Label("No Recent Activity", systemImage: "bolt")
                } description: {
                    Text("Recent friend activity will show up here.")
                }
                .background(background)
            } else if activities.isEmpty {
                ContentUnavailableView {
                    Label(selectedFilter.emptyTitle, systemImage: "bolt")
                } description: {
                    Text(selectedFilter.emptyMessage)
                }
                .foregroundStyle(.white)
                .padding(.top, 60)
                .background(background)
            } else {
                ScrollView {
                    LazyVStack(alignment: .leading, spacing: 22) {
                        ForEach(groupedActivities(activities)) { section in
                            ActivitySectionView(section: section)
                        }
                    }
                    .padding(.top, 82)
                    .padding(.bottom, 48)
                }
                .scrollIndicators(.hidden)
                .background(background)
            }
        }
    }

    private func groupedActivities(_ activities: [ActivityFeedItem]) -> [ActivitySection] {
        var sections: [ActivitySection] = []

        for activity in activities.sorted(by: { $0.timestamp > $1.timestamp }) {
            let label = recencyLabel(for: activity.timestamp)

            if let index = sections.firstIndex(where: { $0.title == label }) {
                sections[index].activities.append(activity)
            } else {
                sections.append(ActivitySection(title: label, activities: [activity]))
            }
        }

        return sections
    }

    private func recencyLabel(for date: Date) -> String {
        let calendar = Calendar.current
        let startOfToday = calendar.startOfDay(for: .now)
        let startOfDate = calendar.startOfDay(for: date)
        let daysAgo = max(calendar.dateComponents([.day], from: startOfDate, to: startOfToday).day ?? 0, 0)

        if daysAgo == 0 {
            return "Today"
        }

        if daysAgo == 1 {
            return "Yesterday"
        }

        if daysAgo < 7 {
            return "This Week"
        }

        let weeksAgo = max(daysAgo / 7, 1)
        return weeksAgo == 1 ? "1 Week ago" : "\(weeksAgo) Weeks ago"
    }
}

private struct ActivityFilterDropdown: View {
    @Binding var selection: ActivityFeedFilter

    var body: some View {
        Menu {
            ForEach(ActivityFeedFilter.allCases) { filter in
                Button {
                    selection = filter
                } label: {
                    if filter == selection {
                        Label(filter.title, systemImage: "checkmark")
                    } else {
                        Text(filter.title)
                    }
                }
            }
        } label: {
            ActivityFilterPill(title: selection.title)
        }
        .buttonStyle(.plain)
    }
}

private struct ActivityFilterPill: View {
    let title: String

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: "line.3.horizontal.decrease")
                .font(.system(size: 13, weight: .bold))

            Text(title)
                .font(.system(size: 15, weight: .semibold))
                .lineLimit(1)
                .minimumScaleFactor(0.78)

            Image(systemName: "chevron.down")
                .font(.system(size: 12, weight: .semibold))
                .opacity(0.62)
        }
        .foregroundStyle(.primary)
        .padding(.horizontal, 15)
        .frame(height: 44)
        .fixedSize(horizontal: true, vertical: false)
        .contentShape(Capsule())
        .activityLiquidGlass(in: Capsule())
    }
}

private enum ActivityFeedFilter: String, CaseIterable, Identifiable {
    case upcoming
    case past
    case all

    var id: String { rawValue }

    var title: String {
        switch self {
        case .upcoming:
            return "Upcoming"
        case .past:
            return "Past"
        case .all:
            return "All"
        }
    }

    var emptyTitle: String {
        switch self {
        case .upcoming:
            return "No Upcoming Activity"
        case .past:
            return "No Past Activity"
        case .all:
            return "No Activity"
        }
    }

    var emptyMessage: String {
        switch self {
        case .upcoming:
            return "Upcoming friend activity will show up here."
        case .past:
            return "Past friend activity will show up here."
        case .all:
            return "Friend activity will show up here."
        }
    }

    func filtered(_ activities: [ActivityFeedItem]) -> [ActivityFeedItem] {
        switch self {
        case .upcoming:
            return activities.filter { $0.event.startAt >= .now }
        case .past:
            return activities.filter { $0.event.startAt < .now }
        case .all:
            return activities
        }
    }
}

private struct ActivitySummaryRow: View {
    let friendCount: Int
    let requestCount: Int

    var body: some View {
        HStack(spacing: 12) {
            ActivitySummaryPill(count: friendCount, label: "Friends")
            ActivitySummaryPill(count: requestCount, label: "Requests")
        }
    }
}

private struct ActivitySummaryPill: View {
    let count: Int
    let label: String

    var body: some View {
        HStack {
            (
                Text("\(count)")
                    .foregroundColor(.white)
                    .fontWeight(.medium)
                +
                Text(" \(label)")
                    .foregroundColor(.white.opacity(0.64))
            )
            .font(.system(size: 15, weight: .regular))

            Spacer(minLength: 8)

            Image(systemName: "chevron.right")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white.opacity(0.58))
        }
        .padding(.horizontal, 17)
        .frame(height: 52)
        .background(
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .fill(Color.white.opacity(0.09))
        )
    }
}

private struct ActivitySectionView: View {
    let section: ActivitySection

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            Text(section.title)
                .font(.system(size: 20, weight: .bold))
                .foregroundStyle(.white)
                .padding(.horizontal, 16)

            VStack(alignment: .leading, spacing: 16) {
                ForEach(section.activities) { activity in
                    ActivityRowView(activity: activity)
                }
            }
            .padding(.horizontal, 16)
        }
    }
}

private struct ActivityRowView: View {
    let activity: ActivityFeedItem
    @State private var selectedEvent: EventFeedItem?
    @State private var selectedVenue: PlaceListItem?

    private static let relativeFormatter: RelativeDateTimeFormatter = {
        let formatter = RelativeDateTimeFormatter()
        formatter.unitsStyle = .full
        return formatter
    }()

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            ActivityAvatarView(activity: activity)

            VStack(alignment: .leading, spacing: 4) {
                InlineLinkedActivityText(
                    activity: activity,
                    onTapEvent: {
                        selectedEvent = activity.event.eventFeedItem
                    },
                    onTapVenue: { venue in
                        selectedVenue = venue
                    }
                )
                    .frame(maxWidth: .infinity, alignment: .leading)

                Text(Self.relativeFormatter.localizedString(for: activity.timestamp, relativeTo: .now))
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(.white.opacity(0.42))
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .navigationDestination(item: $selectedEvent) { event in
            EventDetailView(event: event)
        }
        .navigationDestination(item: $selectedVenue) { venue in
            PlaceDetailView(place: venue)
        }
    }

}

struct InlineLinkedActivityText: UIViewRepresentable {
    let activity: ActivityFeedItem
    let onTapEvent: () -> Void
    let onTapVenue: (PlaceListItem) -> Void

    func makeCoordinator() -> Coordinator {
        Coordinator(parent: self)
    }

    func makeUIView(context: Context) -> UITextView {
        let textView = UITextView()
        textView.backgroundColor = .clear
        textView.isEditable = false
        textView.isScrollEnabled = false
        textView.textContainerInset = .zero
        textView.textContainer.lineFragmentPadding = 0
        textView.delegate = context.coordinator
        textView.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        textView.linkTextAttributes = [
            .foregroundColor: UIColor.white,
            .underlineStyle: 0,
        ]
        return textView
    }

    func updateUIView(_ textView: UITextView, context: Context) {
        context.coordinator.parent = self
        textView.attributedText = attributedText(image: context.coordinator.cachedImage)

        guard context.coordinator.imageURL != activity.event.coverImageURL else {
            return
        }

        context.coordinator.imageURL = activity.event.coverImageURL
        context.coordinator.cachedImage = nil
        context.coordinator.task?.cancel()
        textView.attributedText = attributedText(image: nil)

        guard let url = activity.event.coverImageURL else {
            return
        }

        context.coordinator.task = URLSession.shared.dataTask(with: url) { data, _, _ in
            guard let data, let image = UIImage(data: data) else {
                return
            }

            DispatchQueue.main.async {
                guard context.coordinator.imageURL == url else {
                    return
                }

                context.coordinator.cachedImage = image
                textView.attributedText = attributedText(image: image)
            }
        }
        context.coordinator.task?.resume()
    }

    func sizeThatFits(_ proposal: ProposedViewSize, uiView: UITextView, context: Context) -> CGSize? {
        let width = proposal.width ?? UIScreen.main.bounds.width - 100
        let size = uiView.sizeThatFits(CGSize(width: width, height: .greatestFiniteMagnitude))
        return CGSize(width: width, height: size.height)
    }

    private func attributedText(image: UIImage?) -> NSAttributedString {
        let font = UIFont.systemFont(ofSize: 14, weight: .regular)
        let mediumFont = UIFont.systemFont(ofSize: 14, weight: .medium)
        let mutedColor = UIColor.white.withAlphaComponent(0.62)
        let text = NSMutableAttributedString()

        text.append(
            NSAttributedString(
                string: activity.actorName,
                attributes: [.font: mediumFont, .foregroundColor: UIColor.white]
            )
        )
        text.append(
            NSAttributedString(
                string: " \(actionPhrase) \u{2009}",
                attributes: [.font: font, .foregroundColor: mutedColor]
            )
        )
        text.append(thumbnailAttachment(image: image))
        text.append(
            NSAttributedString(
                string: "\u{2009}\u{00a0}\(activity.event.title)",
                attributes: [
                    .font: mediumFont,
                    .foregroundColor: UIColor.white,
                    .link: URL(string: "wig-event://\(activity.event.id.uuidString)")!,
                ]
            )
        )

        if let venue = activity.event.venue {
            text.append(
                NSAttributedString(
                    string: " at ",
                    attributes: [.font: font, .foregroundColor: mutedColor]
                )
            )
            text.append(
                NSAttributedString(
                    string: venue.name,
                    attributes: [
                        .font: mediumFont,
                        .foregroundColor: UIColor.white,
                        .link: URL(string: "wig-venue://\(venue.slug)")!,
                    ]
                )
            )
        } else {
            text.append(
                NSAttributedString(
                    string: " at \(activity.event.primaryLocation)",
                    attributes: [.font: font, .foregroundColor: mutedColor]
                )
            )
        }

        text.append(
            NSAttributedString(
                string: " on \(activity.event.eventFeedItem.formattedStart(format: "MMM d"))",
                attributes: [.font: font, .foregroundColor: mutedColor]
            )
        )

        if activity.type == .rsvpNotGoing,
           let reasonPhrase = activity.notGoingReason?.activityPhrase
        {
            text.append(
                NSAttributedString(
                    string: " because \(activity.actorGender.contractedBe) \(reasonPhrase)",
                    attributes: [.font: font, .foregroundColor: mutedColor]
                )
            )
        }

        let paragraphStyle = NSMutableParagraphStyle()
        paragraphStyle.lineSpacing = 3
        paragraphStyle.lineBreakMode = .byWordWrapping
        text.addAttribute(.paragraphStyle, value: paragraphStyle, range: NSRange(location: 0, length: text.length))
        return text
    }

    private func thumbnailAttachment(image: UIImage?) -> NSAttributedString {
        let attachment = NSTextAttachment()
        attachment.bounds = CGRect(x: 0, y: -4, width: 20, height: 20)
        attachment.image = image.map { Self.squareThumbnail(from: $0) } ?? Self.placeholderImage
        return NSAttributedString(attachment: attachment)
    }

    private static var placeholderImage: UIImage {
        UIGraphicsImageRenderer(size: CGSize(width: 20, height: 20)).image { context in
            UIColor.white.withAlphaComponent(0.12).setFill()
            UIBezierPath(roundedRect: CGRect(x: 0, y: 0, width: 20, height: 20), cornerRadius: 5).fill()
            context.cgContext.setStrokeColor(UIColor.white.withAlphaComponent(0.08).cgColor)
            context.cgContext.stroke(CGRect(x: 0.5, y: 0.5, width: 19, height: 19))
        }
    }

    private static func squareThumbnail(from image: UIImage) -> UIImage {
        UIGraphicsImageRenderer(size: CGSize(width: 22, height: 22)).image { _ in
            let side = min(image.size.width, image.size.height)
            let cropRect = CGRect(
                x: (image.size.width - side) / 2,
                y: (image.size.height - side) / 2,
                width: side,
                height: side
            )

            guard let cgImage = image.cgImage?.cropping(to: cropRect) else {
                image.draw(in: CGRect(x: 0, y: 0, width: 22, height: 22))
                return
            }

            UIBezierPath(roundedRect: CGRect(x: 0, y: 0, width: 22, height: 22), cornerRadius: 5).addClip()
            UIImage(cgImage: cgImage).draw(in: CGRect(x: 0, y: 0, width: 22, height: 22))
        }
    }

    private var actionPhrase: String {
        switch activity.type {
        case .rsvpGoing:
            return activity.event.startAt < .now ? "went to" : "is going to"
        case .rsvpInterested:
            return activity.event.startAt < .now ? "was interested in" : "is interested in"
        case .rsvpNotGoing:
            return activity.event.startAt < .now ? "couldn't go to" : "can't go to"
        }
    }

    final class Coordinator: NSObject, UITextViewDelegate {
        var parent: InlineLinkedActivityText
        var imageURL: URL?
        var cachedImage: UIImage?
        var task: URLSessionDataTask?

        init(parent: InlineLinkedActivityText) {
            self.parent = parent
        }

        @available(iOS 17.0, *)
        func textView(
            _ textView: UITextView,
            primaryActionFor textItem: UITextItem,
            defaultAction: UIAction
        ) -> UIAction? {
            switch textItem.content {
            case .link(let url):
                switch url.scheme {
                case "wig-event":
                    return UIAction { [weak self] _ in
                        self?.parent.onTapEvent()
                    }
                case "wig-venue":
                    return UIAction { [weak self] _ in
                        guard let venue = self?.parent.activity.event.venue else {
                            return
                        }

                        self?.parent.onTapVenue(venue)
                    }
                default:
                    return defaultAction
                }
            default:
                return defaultAction
            }
        }

        deinit {
            task?.cancel()
        }
    }
}

struct ActivityAvatarView: View {
    let activity: ActivityFeedItem

    var body: some View {
        ZStack(alignment: .bottomTrailing) {
            avatar
                .frame(width: 44, height: 44)
                .clipShape(Circle())

            statusBadge
                .offset(x: 4, y: 4)
        }
    }

    @ViewBuilder
    private var avatar: some View {
        if let url = activity.actorAvatarImageURL {
            AsyncImage(url: url) { phase in
                switch phase {
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFill()
                default:
                    fallbackAvatar
                }
            }
        } else {
            fallbackAvatar
        }
    }

    private var fallbackAvatar: some View {
        Circle()
            .fill(Color(red: 0.88, green: 0.68, blue: 0.46))
            .overlay {
                Text("}")
                    .font(.system(size: 22, weight: .bold))
                    .rotationEffect(.degrees(90))
                    .foregroundStyle(.black.opacity(0.84))
            }
    }

    private var statusBadge: some View {
        ZStack {
            Circle()
                .fill(Color(red: 0.05, green: 0.06, blue: 0.08))
                .frame(width: 24, height: 24)

            Image(systemName: badgeSystemImage)
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(badgeColor)
        }
    }

    private var badgeSystemImage: String {
        switch activity.type {
        case .rsvpGoing:
            return "checkmark"
        case .rsvpInterested:
            return "star.fill"
        case .rsvpNotGoing:
            return "xmark"
        }
    }

    private var badgeColor: Color {
        switch activity.type {
        case .rsvpGoing:
            return Color(red: 0.45, green: 0.76, blue: 1)
        case .rsvpInterested:
            return Color.yellow
        case .rsvpNotGoing:
            return Color.red
        }
    }
}

private extension EventRSVPDeclineReason {
    var activityPhrase: String {
        switch self {
        case .busy:
            return "busy"
        case .outOfTown:
            return "out of town"
        case .working:
            return "working"
        case .layingLow:
            return "laying low"
        }
    }
}

private extension Optional where Wrapped == UserGender {
    var contractedBe: String {
        switch self {
        case .some(.male):
            return "he's"
        case .some(.female):
            return "she's"
        case .some(.other), .none:
            return "they're"
        }
    }
}

private struct ActivityEventThumbnail: View {
    let url: URL?

    var body: some View {
        Group {
            if let url {
                AsyncImage(url: url) { phase in
                    switch phase {
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                    default:
                        placeholder
                    }
                }
            } else {
                placeholder
            }
        }
        .frame(width: 24, height: 24)
        .clipShape(RoundedRectangle(cornerRadius: 5, style: .continuous))
    }

    private var placeholder: some View {
        RoundedRectangle(cornerRadius: 6, style: .continuous)
            .fill(Color.white.opacity(0.12))
    }
}

private struct ActivitySection: Identifiable {
    let id = UUID()
    let title: String
    var activities: [ActivityFeedItem]
}

#Preview {
    ActivityView()
}

private extension View {
    @ViewBuilder
    func activityLiquidGlass<S: InsettableShape>(in shape: S) -> some View {
        if #available(iOS 26.1, *) {
            glassEffect(.regular.interactive(), in: shape)
        } else if #available(iOS 26.0, *) {
            glassEffect(.regular, in: shape)
        } else {
            background(.black.opacity(0.20), in: shape)
                .background(.ultraThinMaterial, in: shape)
                .overlay(
                    shape.strokeBorder(.white.opacity(0.18), lineWidth: 1)
                )
                .shadow(color: .black.opacity(0.22), radius: 16, x: 0, y: 8)
        }
    }
}
