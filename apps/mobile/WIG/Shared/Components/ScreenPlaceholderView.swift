import SwiftUI

struct ScreenPlaceholderView: View {
    let title: String
    let systemImage: String
    let message: String

    var body: some View {
        ContentUnavailableView {
            Label(title, systemImage: systemImage)
        } description: {
            Text(message)
        }
        .foregroundStyle(.white)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AppTheme.background.ignoresSafeArea())
        .navigationTitle(title)
        .toolbarBackground(AppTheme.background, for: .navigationBar)
    }
}

struct NativeLoadingView: View {
    var fillsAvailableSpace = true

    var body: some View {
        VStack(spacing: 12) {
            ProgressView()
                .controlSize(.regular)

            Text("Loading…")
                .font(.system(size: 15, weight: .medium))
        }
        .tint(.primary)
        .foregroundStyle(.secondary)
            .frame(
                maxWidth: .infinity,
                maxHeight: fillsAvailableSpace ? .infinity : nil
            )
            .accessibilityAddTraits(.updatesFrequently)
    }
}

#Preview {
    NavigationStack {
        ScreenPlaceholderView(
            title: "Preview",
            systemImage: "square.and.pencil",
            message: "Reusable placeholder content appears here."
        )
    }
}
