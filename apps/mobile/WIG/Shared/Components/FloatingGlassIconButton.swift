import SwiftUI
import UIKit
import Observation

struct ScrollableHeaderMinYPreferenceKey: PreferenceKey {
    static var defaultValue: CGFloat = 60

    static func reduce(value: inout CGFloat, nextValue: () -> CGFloat) {
        value = nextValue()
    }
}

func scrollableHeaderOpacity(for minY: CGFloat) -> CGFloat {
    min(max((minY - 16) / 36, 0), 1)
}

extension View {
    func scrollingPillFade() -> some View {
        visualEffect { content, geometry in
            content.opacity(
                scrollableHeaderOpacity(
                    for: geometry.frame(in: .scrollView).minY
                )
            )
        }
    }
}

private func scrollableHeaderOpacity(forScrollOffset offset: CGFloat) -> CGFloat {
    min(max(1 - max(offset, 0) / 36, 0), 1)
}

struct ScrollableHeaderFadeTrackingModifier: ViewModifier {
    @Binding var opacity: CGFloat

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.onScrollGeometryChange(for: CGFloat.self) { geometry in
                geometry.contentOffset.y + geometry.contentInsets.top
            } action: { _, offset in
                opacity = scrollableHeaderOpacity(forScrollOffset: offset)
            }
        } else {
            content
        }
    }
}

@Observable
final class ScrollableHeaderVisibility {
    var isVisible = true
}

struct ScrollableHeaderVisibilityTrackingModifier: ViewModifier {
    let visibility: ScrollableHeaderVisibility

    @ViewBuilder
    func body(content: Content) -> some View {
        if #available(iOS 18.0, *) {
            content.onScrollGeometryChange(for: Bool.self) { geometry in
                let offset = geometry.contentOffset.y + geometry.contentInsets.top
                return offset < 18
            } action: { _, newValue in
                guard visibility.isVisible != newValue else { return }
                withAnimation(.easeOut(duration: 0.18)) {
                    visibility.isVisible = newValue
                }
            }
        } else {
            content
        }
    }
}

struct ScopePillBar<Content: View>: View {
    @ViewBuilder let content: () -> Content

    var body: some View {
        ScrollView(.horizontal) {
            HStack(spacing: 8) {
                content()
            }
            .padding(.horizontal, 16)
        }
        // Keep the resting content aligned to the app's standard inset while
        // extending the scroll viewport to the screen edges. Once scrolled,
        // pills can move cleanly past either edge of the display.
        .padding(.horizontal, -16)
        .scrollIndicators(.hidden)
    }
}

struct ScopePill: View {
    let title: String
    let isSelected: Bool
    var canDeselect = false
    let action: () -> Void

    var body: some View {
        Button {
            guard !isSelected || canDeselect else { return }
            UISelectionFeedbackGenerator().selectionChanged()
            action()
        } label: {
            Text(title)
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(isSelected ? .black : .white)
                .padding(.horizontal, 15)
                .frame(height: 34)
                .background(
                    isSelected ? AppTheme.accentBlue : Color.white.opacity(0.09),
                    in: Capsule()
                )
        }
        .buttonStyle(.plain)
    }
}

enum UserAvatarFallbackPalette {
    static let colors = [
        Color(red: 0.88, green: 0.48, blue: 0.36),
        Color(red: 0.88, green: 0.68, blue: 0.46),
        Color(red: 0.57, green: 0.35, blue: 0.70),
        Color(red: 0.43, green: 0.70, blue: 0.62),
        Color(red: 0.15, green: 0.63, blue: 0.58),
    ]

    static func color(identityKey: String?, name: String) -> Color {
        let key = (identityKey?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false)
            ? identityKey!
            : name

        var hash = 0
        for scalar in key.unicodeScalars {
            hash = (hash &* 31) &+ Int(scalar.value)
        }

        return colors[abs(hash) % colors.count]
    }
}

struct FloatingGlassIconButton: View {
    let systemImage: String
    var foregroundColor: Color = .primary
    var size: CGFloat = 46
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 17, weight: .semibold))
                .foregroundStyle(foregroundColor)
                .frame(width: size, height: size)
                .contentShape(Circle())
                .floatingGlassCircle()
        }
        .buttonStyle(.plain)
    }
}

struct UserAvatarView: View {
    let imageURL: URL?
    let name: String
    let size: CGFloat
    var identityKey: String?

    var body: some View {
        Group {
            if let imageURL {
                AsyncImage(url: imageURL) { phase in
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
            .fill(UserAvatarFallbackPalette.color(identityKey: identityKey, name: name))
            .overlay {
                Text(String(name.prefix(1)).uppercased().ifEmpty("J"))
                    .font(.system(size: size * 0.34, weight: .bold))
                    .foregroundStyle(.black.opacity(0.86))
            }
    }

}

struct UserListRowView<Trailing: View>: View {
    let imageURL: URL?
    let name: String
    let subtitle: String?
    let avatarName: String
    let identityKey: String?
    var ringColor: Color = .clear
    var ringWidth: CGFloat = 0
    var avatarSize: CGFloat = 42
    var verticalPadding: CGFloat = 10
    var nameFontSize: CGFloat = 15
    var subtitleFontSize: CGFloat = 11
    @ViewBuilder let trailing: () -> Trailing

    init(
        imageURL: URL?,
        name: String,
        subtitle: String? = nil,
        avatarName: String? = nil,
        identityKey: String?,
        ringColor: Color = .clear,
        ringWidth: CGFloat = 0,
        avatarSize: CGFloat = 42,
        verticalPadding: CGFloat = 10,
        nameFontSize: CGFloat = 15,
        subtitleFontSize: CGFloat = 11,
        @ViewBuilder trailing: @escaping () -> Trailing = { EmptyView() }
    ) {
        self.imageURL = imageURL
        self.name = name
        self.subtitle = subtitle
        self.avatarName = avatarName ?? name
        self.identityKey = identityKey
        self.ringColor = ringColor
        self.ringWidth = ringWidth
        self.avatarSize = avatarSize
        self.verticalPadding = verticalPadding
        self.nameFontSize = nameFontSize
        self.subtitleFontSize = subtitleFontSize
        self.trailing = trailing
    }

    var body: some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(ringColor)

                UserAvatarView(
                    imageURL: imageURL,
                    name: avatarName,
                    size: avatarSize - ringWidth,
                    identityKey: identityKey
                )
            }
            .frame(width: avatarSize, height: avatarSize)

            VStack(alignment: .leading, spacing: 3) {
                Text(name)
                    .font(.system(size: nameFontSize, weight: .medium))
                    .foregroundStyle(.white)
                    .lineLimit(1)

                if let subtitle, !subtitle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Text(subtitle)
                        .font(.system(size: subtitleFontSize, weight: .medium))
                        .foregroundStyle(.white.opacity(0.58))
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 10)

            trailing()
        }
        .padding(.vertical, verticalPadding)
    }
}

struct CompactUserListRowView: View {
    let imageURL: URL?
    let name: String
    let subtitle: String?
    let identityKey: String?

    var body: some View {
        UserListRowView(
            imageURL: imageURL,
            name: name,
            subtitle: subtitle,
            identityKey: identityKey,
            avatarSize: 42,
            verticalPadding: 5,
            nameFontSize: 14,
            subtitleFontSize: 10
        ) {
            EmptyView()
        }
    }
}

private extension View {
    @ViewBuilder
    func floatingGlassCircle() -> some View {
        if #available(iOS 26.1, *) {
            glassEffect(.regular.interactive(), in: Circle())
        } else if #available(iOS 26.0, *) {
            glassEffect(.regular, in: Circle())
        } else {
            background(.black.opacity(0.20), in: Circle())
                .background(.ultraThinMaterial, in: Circle())
                .overlay(
                    Circle()
                        .strokeBorder(.white.opacity(0.18), lineWidth: 1)
                )
                .shadow(color: .black.opacity(0.22), radius: 16, x: 0, y: 8)
        }
    }
}

private extension String {
    func ifEmpty(_ fallback: String) -> String {
        trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? fallback : self
    }
}
