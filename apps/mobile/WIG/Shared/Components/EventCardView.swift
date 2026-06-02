import SwiftUI

struct EventCardView: View {
    let event: EventFeedItem
    private let cardHeight: CGFloat = 306
    private let imageCornerRadius: CGFloat = 18
    private static let cardDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "MMM d 'at' h:mm a"
        return formatter
    }()

    var body: some View {
        VStack(alignment: .leading, spacing: 11) {
            poster

            VStack(alignment: .leading, spacing: 5) {
                Text(event.title)
                    .font(.system(size: 15, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.leading)
                    .lineLimit(2)
                    .lineSpacing(1)
                    .frame(maxWidth: .infinity, alignment: .leading)

                Text(Self.cardDateFormatter.string(from: event.startAt))
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .foregroundStyle(Color(red: 0.46, green: 0.76, blue: 1.0))
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)

                Text(event.primaryLocation)
                    .font(.system(size: 14, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.68))
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)
            }

            Spacer(minLength: 0)
        }
        .padding(10)
        .frame(maxWidth: .infinity, minHeight: cardHeight, maxHeight: cardHeight, alignment: .topLeading)
        .clipped()
        .background(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .fill(Color(red: 0.11, green: 0.11, blue: 0.13))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 22, style: .continuous)
                .strokeBorder(.white.opacity(0.03), lineWidth: 1)
        )
    }

    private var poster: some View {
        GeometryReader { proxy in
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
                    .frame(width: proxy.size.width, height: proxy.size.height)
                    .clipped()
                } else if let imageURL = event.brandingImageURL {
                    posterBranding(url: imageURL)
                } else {
                    posterPlaceholder
                }

            }
            .clipShape(RoundedRectangle(cornerRadius: imageCornerRadius, style: .continuous))
        }
        .aspectRatio(1, contentMode: .fit)
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
        .aspectRatio(1, contentMode: .fit)
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
        .aspectRatio(1, contentMode: .fit)
        .clipShape(RoundedRectangle(cornerRadius: imageCornerRadius, style: .continuous))
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
            venueName: "Spirit Hall",
            organizerName: nil,
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
