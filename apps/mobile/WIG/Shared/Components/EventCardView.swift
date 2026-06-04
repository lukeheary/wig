import SwiftUI

struct EventCardView: View {
    let event: EventFeedItem
    private let cardHeight: CGFloat = 312
    private let posterSize: CGFloat = 200
    private let imageCornerRadius: CGFloat = 14
    private let cardCornerRadius: CGFloat = 18
    private static let cardDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d 'at' h:mm a"
        return formatter
    }()

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            poster

            VStack(alignment: .leading, spacing: 5) {
                Text(event.title)
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.leading)
                    .lineLimit(2)
                    .lineSpacing(1)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Text(Self.cardDateFormatter.string(from: event.startAt))
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Color(red: 0.46, green: 0.76, blue: 1.0))
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)

                Text(event.primaryLocation)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(.white.opacity(0.68))
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, minHeight: cardHeight, maxHeight: cardHeight, alignment: .topLeading)
        .clipped()
        .background(
            RoundedRectangle(cornerRadius: cardCornerRadius, style: .continuous)
                .fill(Color(red: 0.11, green: 0.11, blue: 0.13))
        )
        .overlay(
            RoundedRectangle(cornerRadius: cardCornerRadius, style: .continuous)
                .strokeBorder(.white.opacity(0.03), lineWidth: 1)
        )
    }

    private var poster: some View {
        ZStack(alignment: .topLeading) {
            RoundedRectangle(cornerRadius: imageCornerRadius, style: .continuous)
                .fill(Color(red: 0.18, green: 0.18, blue: 0.20))

            if let imageURL = event.posterImageURL {
                AsyncImage(url: imageURL) { phase in
                    switch phase {
                    case .empty:
                        posterPlaceholder
                    case .success(let image):
                        image
                            .resizable()
                            .scaledToFill()
                    case .failure:
                        posterPlaceholder
                    @unknown default:
                        posterPlaceholder
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else if let imageURL = event.brandingImageURL {
                posterBranding(url: imageURL)
            } else {
                posterPlaceholder
            }
        }
        .frame(width: posterSize, height: posterSize)
        .clipShape(RoundedRectangle(cornerRadius: imageCornerRadius, style: .continuous))
        .overlay {
            EventSocialOverlayView(attendees: event.socialAttendees, size: .card)
                .clipShape(RoundedRectangle(cornerRadius: imageCornerRadius, style: .continuous))
        }
    }

    private var posterPlaceholder: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.13, green: 0.22, blue: 0.38),
                    Color(red: 0.46, green: 0.14, blue: 0.43),
                    Color(red: 0.86, green: 0.36, blue: 0.22),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            Image(systemName: "music.mic")
                .font(.system(size: 42, weight: .regular))
                .foregroundStyle(.white.opacity(0.8))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: imageCornerRadius, style: .continuous))
    }

    private func posterBranding(url: URL) -> some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.12, green: 0.13, blue: 0.19),
                    Color(red: 0.19, green: 0.17, blue: 0.28),
                    Color(red: 0.10, green: 0.10, blue: 0.12),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            AsyncImage(url: url) { phase in
                switch phase {
                case .empty:
                    ProgressView()
                        .tint(.white.opacity(0.7))
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFit()
                        .padding(24)
                case .failure:
                    posterPlaceholder
                @unknown default:
                    posterPlaceholder
                }
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .clipShape(RoundedRectangle(cornerRadius: imageCornerRadius, style: .continuous))
    }
}

struct EventSocialOverlayView: View {
    let attendees: [EventSocialAttendee]
    let size: Size

    private var visibleAttendees: [EventSocialAttendee] {
        Array(
            attendees
                .sorted { lhs, rhs in
                    statusPriority(lhs.status) < statusPriority(rhs.status)
                }
                .prefix(size.maxDisplay)
        )
    }

    private var remainingCount: Int {
        max(0, attendees.count - size.maxDisplay)
    }

    var body: some View {
        if !attendees.isEmpty {
            GeometryReader { proxy in
                ZStack(alignment: .bottomTrailing) {
                    scrim(width: proxy.size.width, height: proxy.size.height)

                    HStack(spacing: size.stackSpacing) {
                        HStack(spacing: size.avatarSpacing) {
                            ForEach(visibleAttendees) { attendee in
                                EventSocialAvatarView(attendee: attendee, size: size.avatarSize)
                            }
                        }

                        if remainingCount > 0 {
                            Text("+\(remainingCount)")
                                .font(.system(size: size.overflowFontSize, weight: .bold))
                                .foregroundStyle(.white)
                                .frame(width: size.avatarSize, height: size.avatarSize)
                                .background(Color.black.opacity(0.58), in: Circle())
                                .overlay(Circle().strokeBorder(.white.opacity(0.72), lineWidth: 1))
                        }
                    }
                    .padding(.trailing, size.trailingPadding)
                    .padding(.bottom, size.bottomPadding)
                    .shadow(color: .black.opacity(0.42), radius: 12, x: 0, y: 6)
                }
            }
            .allowsHitTesting(false)
        }
    }

    private func statusPriority(_ status: EventRSVPStatus) -> Int {
        status == .going ? 1 : 0
    }

    private func scrim(width: CGFloat, height: CGFloat) -> some View {
        RadialGradient(
            colors: [
                .black.opacity(0.84),
                .black.opacity(0.54),
                .black.opacity(0.24),
                .clear,
            ],
            center: .bottomTrailing,
            startRadius: 0,
            endRadius: min(width, height) * 0.62
        )
        .frame(width: width, height: height)
    }

    enum Size {
        case card
        case detail

        var avatarSize: CGFloat {
            switch self {
            case .card:
                return 32
            case .detail:
                return 40
            }
        }

        var avatarSpacing: CGFloat {
            switch self {
            case .card:
                return -8
            case .detail:
                return -10
            }
        }

        var stackSpacing: CGFloat {
            5
        }

        var maxDisplay: Int {
            3
        }

        var trailingPadding: CGFloat {
            switch self {
            case .card:
                return 8
            case .detail:
                return 14
            }
        }

        var bottomPadding: CGFloat {
            switch self {
            case .card:
                return 8
            case .detail:
                return 14
            }
        }

        var overflowFontSize: CGFloat {
            switch self {
            case .card:
                return 11
            case .detail:
                return 13
            }
        }
    }
}

private struct EventSocialAvatarView: View {
    let attendee: EventSocialAttendee
    let size: CGFloat

    var body: some View {
        ZStack {
            Circle()
                .fill(ringColor)

            avatarContent
                .frame(width: size - 4, height: size - 4)
                .clipShape(Circle())
        }
        .frame(width: size, height: size)
    }

    @ViewBuilder
    private var avatarContent: some View {
        if let avatarImageURL = attendee.avatarImageURL {
            AsyncImage(url: avatarImageURL) { phase in
                switch phase {
                case .empty:
                    fallbackAvatar
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFill()
                case .failure:
                    fallbackAvatar
                @unknown default:
                    fallbackAvatar
                }
            }
        } else {
            fallbackAvatar
        }
    }

    private var fallbackAvatar: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.22, green: 0.37, blue: 0.62),
                    Color(red: 0.62, green: 0.20, blue: 0.36),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            Text(initials)
                .font(.system(size: max(10, size * 0.34), weight: .bold))
                .foregroundStyle(.white)
        }
    }

    private var initials: String {
        let first = attendee.firstName?.trimmingCharacters(in: .whitespacesAndNewlines).first
        let last = attendee.lastName?.trimmingCharacters(in: .whitespacesAndNewlines).first
        let value = [first, last].compactMap { $0 }.map(String.init).joined()
        return value.isEmpty ? "?" : value.uppercased()
    }

    private var ringColor: Color {
        switch attendee.status {
        case .going:
            return Color(red: 0.23, green: 0.93, blue: 0.86)
        case .interested:
            return Color(red: 0.98, green: 0.78, blue: 0.23)
        case .notGoing:
            return .white.opacity(0.24)
        }
    }
}

#Preview {
    EventCardView(
        event: EventFeedItem(
            id: UUID(),
            title: "Indie Night at Spirit Hall",
            description: "A stacked lineup of local bands with late-night DJs.",
            coverImageURL: nil,
            eventURL: nil,
            startAt: .now,
            endAt: nil,
            address: "242 51st Street",
            city: "Pittsburgh",
            state: "PA",
            venueID: nil,
            venueName: "Spirit Hall",
            venueSlug: nil,
            organizerID: nil,
            organizerName: nil,
            organizerSlug: nil,
            venueLogoImageURL: nil,
            organizerLogoImageURL: nil,
            categories: ["music"],
            categoryLabels: ["music": "Music"],
            updatedAt: nil
        )
    )
    .padding()
    .background(.black)
}
