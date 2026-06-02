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

private enum AppTheme {
    static let background = Color(red: 0.07, green: 0.07, blue: 0.08)
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
