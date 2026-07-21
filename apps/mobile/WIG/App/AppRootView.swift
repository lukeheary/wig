import SwiftUI
import UIKit

enum AppTheme {
    static let background = Color.black
    static let accentBlue = Color(red: 0.5607843137, green: 0.8235294118, blue: 1.0)
    static let uiBackground = UIColor.black
}

struct AppRootView: View {
    @State private var isShowingLaunchScreen = true

    var body: some View {
        ZStack {
            AppTheme.background
                .ignoresSafeArea()

            AuthGate()

            if isShowingLaunchScreen {
                LaunchLoadingView()
                    .transition(.opacity)
                    .zIndex(1)
            }
        }
        .task {
            try? await Task.sleep(for: .milliseconds(700))

            withAnimation(.easeOut(duration: 0.24)) {
                isShowingLaunchScreen = false
            }
        }
    }
}

// A soft black gradient behind the iOS status bar so the time / signal / battery stay
// legible over light content. This is applied per-screen (on each tab's root content,
// inside its NavigationStack) rather than globally, so detail views that paint their
// own artwork background to the very top do not get an unwanted black fade over their
// hero. See `topStatusBarScrim()`.
struct StatusBarScrim: View {
    @EnvironmentObject private var appSession: AppSession

    var body: some View {
        if appSession.isEventDetailPresented {
            EmptyView()
        } else {
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
            .allowsHitTesting(false)
        }
    }
}

extension View {
    // Overlays the status-bar scrim at the top of this view. Apply to a tab's root
    // content INSIDE its NavigationStack so pushed or presented detail views cover it
    // and are never darkened at the top.
    func topStatusBarScrim() -> some View {
        overlay(alignment: .top) {
            StatusBarScrim()
        }
    }
}

struct LaunchLoadingView: View {
    var body: some View {
        Image("LaunchIcon")
            .resizable()
            .scaledToFit()
            .frame(width: 136, height: 136)
            .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
            .shadow(color: .black.opacity(0.24), radius: 24, x: 0, y: 12)
            .frame(maxWidth: .infinity, maxHeight: .infinity)
    }
}
