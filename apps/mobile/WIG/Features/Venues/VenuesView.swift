import SwiftUI

struct VenuesView: View {
    @Environment(\.apiClient) private var apiClient
    @StateObject private var viewModel = VenuesViewModel()

    var body: some View {
        NavigationStack {
            content
                .background(venuesBackground)
                .toolbar(.hidden, for: .navigationBar)
                .task {
                    if case .idle = viewModel.state {
                        await viewModel.load(using: apiClient)
                    }
                }
                .refreshable {
                    await viewModel.load(using: apiClient)
                }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            ProgressView("Loading venues...")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .tint(.white)
                .foregroundStyle(.white)
                .background(venuesBackground)

        case .failed(let message):
            ContentUnavailableView {
                Label("Couldn’t Load Venues", systemImage: "wifi.exclamationmark")
            } description: {
                Text(message)
            } actions: {
                Button("Try Again") {
                    Task {
                        await viewModel.load(using: apiClient)
                    }
                }
            }
            .foregroundStyle(.white)
            .background(venuesBackground)

        case .loaded(let places):
            if places.isEmpty {
                ContentUnavailableView {
                    Label("No Venues Yet", systemImage: "building.2")
                } description: {
                    Text("The mobile places feed is connected, but no venues or organizers are available yet.")
                }
                .foregroundStyle(.white)
                .background(venuesBackground)
            } else {
                ScrollView {
                    LazyVStack(spacing: 14) {
                        ForEach(places) { place in
                            PlaceRowView(place: place)
                        }
                    }
                    .padding(.horizontal, 16)
                    .padding(.top, 18)
                    .padding(.bottom, 96)
                }
                .scrollIndicators(.hidden)
                .background(venuesBackground)
            }
        }
    }

    private var venuesBackground: some View {
        Color(red: 0.07, green: 0.07, blue: 0.08)
            .ignoresSafeArea()
    }
}

private struct PlaceRowView: View {
    let place: PlaceListItem

    var body: some View {
        HStack(alignment: .top, spacing: 14) {
            placeLogo

            VStack(alignment: .leading, spacing: 8) {
                Text(place.name)
                    .font(.system(size: 19, weight: .bold, design: .rounded))
                    .foregroundStyle(.white)
                    .lineLimit(2)
                    .minimumScaleFactor(0.88)

                if !place.locationText.isEmpty {
                    Text(place.locationText)
                        .font(.system(size: 17, weight: .bold, design: .rounded))
                        .foregroundStyle(Color(red: 0.48, green: 0.77, blue: 1.0))
                        .lineLimit(1)
                }

                if let eventCountText = place.eventCountText {
                    Text(eventCountText)
                        .font(.system(size: 17, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.62))
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 8)

            Text(place.type.displayName)
                .font(.system(size: 14, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.36))
                .padding(.top, 76)
        }
        .padding(10)
        .frame(minHeight: 118, alignment: .top)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color(red: 0.11, green: 0.11, blue: 0.13))
        )
    }

    @ViewBuilder
    private var placeLogo: some View {
        if let logoURL = place.displayLogoURL {
            AsyncImage(url: logoURL) { phase in
                switch phase {
                case .empty:
                    logoPlaceholder
                case .success(let image):
                    image
                        .resizable()
                        .scaledToFill()
                case .failure:
                    logoPlaceholder
                @unknown default:
                    logoPlaceholder
                }
            }
            .frame(width: 96, height: 96)
            .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        } else {
            logoPlaceholder
                .frame(width: 96, height: 96)
        }
    }

    private var logoPlaceholder: some View {
        ZStack {
            LinearGradient(
                colors: [
                    Color(red: 0.16, green: 0.18, blue: 0.24),
                    Color(red: 0.30, green: 0.22, blue: 0.32),
                    Color(red: 0.08, green: 0.08, blue: 0.09),
                ],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            Image(systemName: place.type == .venue ? "building.2" : "sparkles")
                .font(.system(size: 34, weight: .semibold))
                .foregroundStyle(.white.opacity(0.72))
        }
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

#Preview {
    VenuesView()
}
