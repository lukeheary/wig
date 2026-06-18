import SwiftUI

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

    private let fallbackColors = [
        Color(red: 0.88, green: 0.48, blue: 0.36),
        Color(red: 0.88, green: 0.68, blue: 0.46),
        Color(red: 0.57, green: 0.35, blue: 0.70),
        Color(red: 0.43, green: 0.70, blue: 0.62),
        Color(red: 0.15, green: 0.63, blue: 0.58),
    ]

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
            .fill(fallbackColors[fallbackIndex])
            .overlay {
                Text(String(name.prefix(1)).uppercased().ifEmpty("J"))
                    .font(.system(size: size * 0.34, weight: .bold))
                    .foregroundStyle(.black.opacity(0.86))
            }
    }

    private var fallbackIndex: Int {
        let key = (identityKey?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false)
            ? identityKey!
            : name

        var hash = 0
        for scalar in key.unicodeScalars {
            hash = (hash &* 31) &+ Int(scalar.value)
        }

        return abs(hash) % fallbackColors.count
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
