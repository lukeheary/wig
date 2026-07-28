import SwiftUI
import UIKit

enum AppTheme {
    static let background = Color.black
    static let accentBlue = Color(red: 0.5607843137, green: 0.8235294118, blue: 1.0)
    static let uiBackground = UIColor.black
    static let contentHeaderFont = Font.system(size: 19, weight: .bold)
}

@MainActor
enum ConfirmationHaptic {
    private static let pulseInterval: TimeInterval = 0.09

    static func play() {
        let firstPulse = UIImpactFeedbackGenerator(style: .medium)
        let secondPulse = UIImpactFeedbackGenerator(style: .medium)
        firstPulse.prepare()
        secondPulse.prepare()
        firstPulse.impactOccurred()

        DispatchQueue.main.asyncAfter(deadline: .now() + pulseInterval) {
            secondPulse.impactOccurred()
        }
    }
}

struct AppRootView: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var isShowingLaunchScreen = true
    @State private var launchOpacity = 1.0
    @State private var isContentReady = false

    var body: some View {
        ZStack {
            AppTheme.background
                .ignoresSafeArea()

            AuthGate {
                isContentReady = true
            }

            if isShowingLaunchScreen {
                ZStack {
                    AppTheme.background
                        .ignoresSafeArea()

                    LaunchLoadingView()
                }
                    .compositingGroup()
                    .opacity(launchOpacity)
                    .zIndex(1)
            }
        }
        .task(id: isContentReady) {
            guard isContentReady else { return }

            // Let the destination render behind the splash before fading it away.
            try? await Task.sleep(for: .milliseconds(50))
            guard !Task.isCancelled else { return }

            let fadeDuration = reduceMotion ? 0.2 : 0.34
            withAnimation(.easeInOut(duration: fadeDuration)) {
                launchOpacity = 0
            }

            try? await Task.sleep(for: .seconds(fadeDuration))
            isShowingLaunchScreen = false
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
