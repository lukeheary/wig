import SwiftUI
import UIKit

enum AppTheme {
    static let background = Color(red: 0.07, green: 0.07, blue: 0.08)
    static let accentBlue = Color(red: 0.46, green: 0.76, blue: 1.0)
    static let uiBackground = UIColor(red: 0.07, green: 0.07, blue: 0.08, alpha: 1)
}

struct AppRootView: View {
    @State private var isShowingLaunchScreen = true

    var body: some View {
        ZStack {
            AppTheme.background
                .ignoresSafeArea()

            if isShowingLaunchScreen {
                LaunchLoadingView()
                    .transition(.opacity)
            } else {
                AuthGate()
                    .transition(.opacity)
            }

            StatusBarScrim()
                .allowsHitTesting(false)
        }
        .task {
            try? await Task.sleep(for: .milliseconds(700))

            withAnimation(.easeOut(duration: 0.24)) {
                isShowingLaunchScreen = false
            }
        }
    }
}

private struct StatusBarScrim: View {
    var body: some View {
        VStack {
            LinearGradient(
                colors: [
                    .black.opacity(0.46),
                    .black.opacity(0.24),
                    .clear,
                ],
                startPoint: .top,
                endPoint: .bottom
            )
            .frame(height: 116)

            Spacer()
        }
        .ignoresSafeArea()
    }
}

private struct LaunchLoadingView: View {
    var body: some View {
        Text("Who Is Going?")
            .font(.system(size: 34, weight: .black))
            .foregroundStyle(.white)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
