import SwiftUI

struct EventDetailView: View {
    let event: EventFeedItem

    @Environment(\.dismiss) private var dismiss

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEE, MMM d 'at' h:mm a"
        return formatter
    }()

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                hero
                details
                rsvpControls
                about
            }
            .padding(.horizontal, 16)
            .padding(.top, 14)
            .padding(.bottom, 36)
        }
        .background(Color(red: 0.07, green: 0.07, blue: 0.08).ignoresSafeArea())
        .navigationBarBackButtonHidden()
        .toolbar(.hidden, for: .navigationBar)
    }

    private var hero: some View {
        GeometryReader { proxy in
            let side = proxy.size.width

            ZStack(alignment: .topLeading) {
                eventArtwork
                    .frame(width: side, height: side)
                    .clipShape(RoundedRectangle(cornerRadius: 24, style: .continuous))

                HStack {
                    LiquidGlassIconButton(systemImage: "chevron.left") {
                        dismiss()
                    }

                    Spacer()

                    LiquidGlassIconButton(systemImage: "square.and.pencil") {}
                    LiquidGlassIconButton(systemImage: "link") {
                        openExternalEvent()
                    }
                }
                .padding(14)
            }
        }
        .aspectRatio(1, contentMode: .fit)
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
        VStack(alignment: .leading, spacing: 12) {
            Text(event.title)
                .font(.system(size: 34, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .lineSpacing(1)

            Text(Self.dateFormatter.string(from: event.startAt))
                .font(.system(size: 21, weight: .bold, design: .rounded))
                .foregroundStyle(Color(red: 0.48, green: 0.77, blue: 1.0))

            HStack(spacing: 10) {
                Text(event.primaryLocation)
                    .font(.system(size: 21, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                    .lineLimit(1)

                if let category = event.primaryCategoryLabel {
                    Text(category)
                        .font(.system(size: 14, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.78))
                        .padding(.horizontal, 12)
                        .padding(.vertical, 7)
                        .background(Color.white.opacity(0.10), in: Capsule())
                }
            }

            if let sourceName = event.externalSourceName {
                Button {
                    openExternalEvent()
                } label: {
                    Label("View on \(sourceName)", systemImage: "arrow.up.right.square")
                        .font(.system(size: 18, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.62))
                        .labelStyle(.titleAndIcon)
                }
                .buttonStyle(.plain)
            }
        }
    }

    private var rsvpControls: some View {
        VStack(spacing: 10) {
            HStack(spacing: 10) {
                RSVPButton(title: "Interested", isProminent: true)
                RSVPButton(title: "Going", isProminent: true)
            }

            RSVPButton(title: "Can't Go", isProminent: false)
        }
    }

    private var about: some View {
        VStack(alignment: .leading, spacing: 18) {
            Text("About")
                .font(.system(size: 27, weight: .bold, design: .rounded))
                .foregroundStyle(.white)

            if let description = event.description?.trimmingCharacters(in: .whitespacesAndNewlines),
               !description.isEmpty
            {
                Text(description)
                    .font(.system(size: 17, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.64))
                    .lineSpacing(5)
            }

            ForEach(event.formattedAddressLines, id: \.self) { line in
                Text(line)
                    .font(.system(size: 17, weight: .medium, design: .rounded))
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
}

private struct LiquidGlassIconButton: View {
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 46, height: 46)
                .background(.black.opacity(0.22), in: Circle())
                .liquidGlassCircle()
        }
        .buttonStyle(.plain)
    }
}

private extension View {
    func liquidGlassCircle() -> some View {
        self
            .background(.ultraThinMaterial, in: Circle())
            .overlay(
                Circle()
                    .strokeBorder(.white.opacity(0.20), lineWidth: 1)
            )
            .shadow(color: .black.opacity(0.24), radius: 18, x: 0, y: 10)
    }
}

private struct RSVPButton: View {
    let title: String
    let isProminent: Bool

    var body: some View {
        Button {} label: {
            Text(title)
                .font(.system(size: 18, weight: .bold, design: .rounded))
                .foregroundStyle(.white)
                .frame(maxWidth: .infinity)
                .frame(height: 58)
                .background(
                    RoundedRectangle(cornerRadius: 17, style: .continuous)
                        .fill(Color.clear)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 17, style: .continuous)
                        .strokeBorder(
                            isProminent
                                ? Color(red: 0.48, green: 0.77, blue: 1.0)
                                : .white.opacity(0.10),
                            lineWidth: isProminent ? 1.4 : 1
                        )
                )
        }
        .buttonStyle(.plain)
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
            venueName: "The Sinclair",
            organizerName: nil,
            venueLogoImageURL: nil,
            organizerLogoImageURL: nil,
            categories: ["concerts"],
            categoryLabels: ["concerts": "Concerts"],
            updatedAt: nil
        )
    )
}
