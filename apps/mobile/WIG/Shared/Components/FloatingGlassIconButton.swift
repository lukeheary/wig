import SwiftUI

struct FloatingGlassIconButton: View {
    let systemImage: String
    var foregroundColor: Color = .primary
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(foregroundColor)
                .frame(width: 44, height: 44)
                .contentShape(Circle())
                .floatingGlassCircle()
        }
        .buttonStyle(.plain)
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
