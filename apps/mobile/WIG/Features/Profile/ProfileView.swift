import ClerkKit
import ClerkKitUI
import SwiftUI

struct ProfileView: View {
    @Environment(Clerk.self) private var clerk
    @Environment(\.apiClient) private var apiClient
    @EnvironmentObject private var appSession: AppSession
    @StateObject private var viewModel = ProfileViewModel()

    var body: some View {
        NavigationStack {
            content
                .background(ProfileTheme.background.ignoresSafeArea())
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
            ProgressView("Loading profile...")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .tint(.white)
                .foregroundStyle(.white)
                .background(ProfileTheme.background)

        case .failed(let message):
            ContentUnavailableView {
                Label("Couldn't Load Profile", systemImage: "wifi.exclamationmark")
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
            .background(ProfileTheme.background)

        case .loaded(let response):
            ScrollView {
                VStack(spacing: 22) {
                    ProfileHeader(profile: response.profile)

                    RelationshipSummaryRow(response: response)

                    accountCard

                    if appSession.isAuthBypassed {
                        localDevelopmentCard
                    }
                }
                .padding(.horizontal, 16)
                .padding(.top, 24)
                .padding(.bottom, 104)
            }
            .scrollIndicators(.hidden)
            .background(ProfileTheme.background)
        }
    }

    private var accountCard: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Account")
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(.white)

                    Text("Manage your Clerk profile and session.")
                        .font(.system(size: 14, weight: .medium))
                        .foregroundStyle(.white.opacity(0.62))
                }

                Spacer()

                if clerk.user != nil {
                    UserButton()
                }
            }

            Text(AppConfig.shared.apiBaseURL.absoluteString)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.white.opacity(0.38))
                .lineLimit(1)
                .truncationMode(.middle)
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ProfileTheme.cardBackground, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }

    private var localDevelopmentCard: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text("Local Development")
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(.white)

            Text("Auth is currently bypassed on this device.")
                .font(.system(size: 14, weight: .medium))
                .foregroundStyle(.white.opacity(0.62))

            Button("Return to Sign In") {
                appSession.reset()
            }
            .font(.system(size: 15, weight: .bold))
            .foregroundStyle(Color(red: 0.27, green: 0.72, blue: 0.48))
        }
        .padding(16)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(ProfileTheme.cardBackground, in: RoundedRectangle(cornerRadius: 18, style: .continuous))
    }
}

private struct ProfileHeader: View {
    let profile: FriendUserSummary?

    var body: some View {
        VStack(spacing: 12) {
            FriendAvatarView(user: profile, size: 104, seed: 0)

            if let profile {
                VStack(spacing: 3) {
                    Text(profile.name)
                        .font(.system(size: 22, weight: .bold))
                        .foregroundStyle(.white)

                    Text(profile.usernameText)
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(.white.opacity(0.56))
                }
            }
        }
        .frame(maxWidth: .infinity)
    }
}

private struct RelationshipSummaryRow: View {
    let response: FriendsFeedResponse

    var body: some View {
        HStack(spacing: 12) {
            NavigationLink {
                FriendsListView(friends: response.friends)
            } label: {
                RelationshipSummaryPill(count: response.friendCount, label: "Friends")
            }
            .buttonStyle(.plain)

            NavigationLink {
                FriendRequestsView(
                    receivedRequests: response.receivedRequests,
                    sentRequests: response.sentRequests
                )
            } label: {
                RelationshipSummaryPill(count: response.requestCount, label: "Requests")
            }
            .buttonStyle(.plain)
        }
    }
}

private struct RelationshipSummaryPill: View {
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

private struct FriendsListView: View {
    let friends: [FriendUserSummary]

    var body: some View {
        RelationshipListScreen(title: "My Friends") {
            if friends.isEmpty {
                EmptyRelationshipCard(
                    systemImage: "person.2",
                    message: "No friends yet"
                )
            } else {
                RelationshipCard {
                    ForEach(Array(friends.enumerated()), id: \.element.id) { index, friend in
                        FriendRowView(user: friend, seed: index)

                        if friend.id != friends.last?.id {
                            Divider()
                                .overlay(.white.opacity(0.08))
                                .padding(.leading, 62)
                        }
                    }
                }
            }
        }
    }
}

private struct FriendRequestsView: View {
    let receivedRequests: [FriendUserSummary]
    let sentRequests: [FriendUserSummary]

    var body: some View {
        RelationshipListScreen(title: "Received Requests") {
            VStack(alignment: .leading, spacing: 22) {
                if receivedRequests.isEmpty {
                    EmptyRelationshipCard(
                        systemImage: "envelope",
                        message: "No pending friend requests"
                    )
                } else {
                    RelationshipCard {
                        ForEach(Array(receivedRequests.enumerated()), id: \.element.id) { index, request in
                            FriendRowView(user: request, seed: index)

                            if request.id != receivedRequests.last?.id {
                                Divider()
                                    .overlay(.white.opacity(0.08))
                                    .padding(.leading, 62)
                            }
                        }
                    }
                }

                VStack(alignment: .leading, spacing: 12) {
                    Text("Sent Requests")
                        .font(.system(size: 23, weight: .bold))
                        .foregroundStyle(.white)

                    if sentRequests.isEmpty {
                        EmptyRelationshipCard(
                            systemImage: "paperplane",
                            message: "No sent requests"
                        )
                    } else {
                        RelationshipCard {
                            ForEach(Array(sentRequests.enumerated()), id: \.element.id) { index, request in
                                FriendRowView(user: request, seed: index, badge: "Pending")

                                if request.id != sentRequests.last?.id {
                                    Divider()
                                        .overlay(.white.opacity(0.08))
                                        .padding(.leading, 62)
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}

private struct RelationshipListScreen<Content: View>: View {
    let title: String
    let content: Content

    init(title: String, @ViewBuilder content: () -> Content) {
        self.title = title
        self.content = content()
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 18) {
                Text(title)
                    .font(.system(size: 26, weight: .bold))
                    .foregroundStyle(.white)

                content
            }
            .padding(.horizontal, 16)
            .padding(.top, 18)
            .padding(.bottom, 104)
        }
        .background(ProfileTheme.background.ignoresSafeArea())
        .background(SwipeBackEnabler())
        .navigationBarTitleDisplayMode(.inline)
    }
}

private struct RelationshipCard<Content: View>: View {
    let content: Content

    init(@ViewBuilder content: () -> Content) {
        self.content = content()
    }

    var body: some View {
        VStack(spacing: 0) {
            content
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(ProfileTheme.cardBackground)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(.white.opacity(0.08), lineWidth: 1)
        )
    }
}

private struct EmptyRelationshipCard: View {
    let systemImage: String
    let message: String

    var body: some View {
        VStack(spacing: 18) {
            Image(systemName: systemImage)
                .font(.system(size: 42, weight: .medium))
                .foregroundStyle(.white.opacity(0.56))

            Text(message)
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(.white.opacity(0.58))
        }
        .frame(maxWidth: .infinity, minHeight: 172)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(ProfileTheme.cardBackground)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(.white.opacity(0.08), lineWidth: 1)
        )
    }
}

private struct FriendRowView: View {
    let user: FriendUserSummary
    let seed: Int
    var badge: String?

    var body: some View {
        HStack(spacing: 14) {
            FriendAvatarView(user: user, size: 48, seed: seed)

            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 10) {
                    Text(user.name)
                        .font(.system(size: 17, weight: .medium))
                        .foregroundStyle(.white)
                        .lineLimit(1)

                    if let badge {
                        Text(badge)
                            .font(.system(size: 13, weight: .bold))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 14)
                            .padding(.vertical, 8)
                            .background(
                                Capsule()
                                    .strokeBorder(.white.opacity(0.10), lineWidth: 1)
                            )
                    }
                }

                Text(user.usernameText)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.white.opacity(0.58))
                    .lineLimit(1)
            }

            Spacer(minLength: 0)
        }
        .padding(.vertical, 12)
    }
}

private struct FriendAvatarView: View {
    let user: FriendUserSummary?
    let size: CGFloat
    let seed: Int

    private let fallbackColors = [
        Color(red: 0.88, green: 0.48, blue: 0.36),
        Color(red: 0.88, green: 0.68, blue: 0.46),
        Color(red: 0.57, green: 0.35, blue: 0.70),
        Color(red: 0.43, green: 0.70, blue: 0.62),
        Color(red: 0.15, green: 0.63, blue: 0.58),
    ]

    var body: some View {
        Group {
            if let url = user?.avatarImageURL {
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
        .frame(width: size, height: size)
        .clipShape(Circle())
    }

    private var fallbackAvatar: some View {
        Circle()
            .fill(fallbackColors[abs(seed) % fallbackColors.count])
            .overlay {
                Text(faceGlyph)
                    .font(.system(size: size * 0.34, weight: .bold))
                    .foregroundStyle(.black.opacity(0.86))
            }
    }

    private var faceGlyph: String {
        guard let user else { return "J" }
        return String(user.name.prefix(1)).uppercased()
    }
}

private enum ProfileTheme {
    static let background = Color(red: 0.07, green: 0.07, blue: 0.08)
    static let cardBackground = Color(red: 0.11, green: 0.11, blue: 0.13)
}

#Preview {
    ProfileView()
}
