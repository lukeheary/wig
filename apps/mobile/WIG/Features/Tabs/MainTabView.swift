import ClerkKit
import ClerkKitUI
import SwiftUI

struct MainTabView: View {
    @Environment(Clerk.self) private var clerk
    @EnvironmentObject private var appSession: AppSession
    @State private var selectedTab: AppTab = .home
    @State private var previousNonSearchTab: AppTab = .home
    @State private var isAuthSheetPresented = false

    var body: some View {
        if #available(iOS 26.0, *) {
            liquidGlassTabView
        } else {
            legacyTabView
        }
    }

    @available(iOS 26.0, *)
    private var liquidGlassTabView: some View {
        ZStack {
            AppTheme.background
                .ignoresSafeArea()

            TabView(selection: $selectedTab) {
                Tab("Home", systemImage: "house", value: AppTab.home) {
                    HomeView(onShowActivity: {
                        showActivityOrAuth()
                    })
                }

                Tab("Venues", systemImage: "building.2", value: AppTab.venues) {
                    VenuesView()
                }

                if isAuthenticated {
                    Tab("Activity", systemImage: "bolt", value: AppTab.activity) {
                        ActivityView()
                    }

                    Tab("Profile", systemImage: "person.crop.circle", value: AppTab.profile) {
                        ProfileView()
                    }
                }

                Tab("Search", systemImage: "magnifyingglass", value: AppTab.search, role: .search) {
                    searchHomeView
                }
            }

            guestAuthButton
        }
        .background(AppTheme.background.ignoresSafeArea())
        .toolbarColorScheme(.dark, for: .tabBar)
        .toolbarBackground(AppTheme.background, for: .tabBar)
        .tint(AppTheme.accentBlue)
        .onChange(of: selectedTab) { oldValue, newValue in
            if oldValue != .search {
                previousNonSearchTab = oldValue
            }

            if newValue != .search {
                previousNonSearchTab = newValue
            }
        }
        .onChange(of: isAuthenticated) { _, isAuthenticated in
            guard !isAuthenticated, selectedTab.requiresAuthentication else {
                return
            }

            selectedTab = .home
            previousNonSearchTab = .home
        }
        .sheet(isPresented: $isAuthSheetPresented) {
            AuthView(isDismissable: true)
                .environment(Clerk.shared)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
    }

    private var legacyTabView: some View {
        ZStack {
            AppTheme.background
                .ignoresSafeArea()

            TabView(selection: $selectedTab) {
                HomeView(onShowActivity: {
                    showActivityOrAuth()
                })
                    .tabItem {
                        Label("Home", systemImage: "house")
                    }
                    .tag(AppTab.home)

                VenuesView()
                    .tabItem {
                        Label("Venues", systemImage: "building.2")
                    }
                    .tag(AppTab.venues)

                if isAuthenticated {
                    ActivityView()
                        .tabItem {
                            Label("Activity", systemImage: "bolt")
                        }
                        .tag(AppTab.activity)

                    ProfileView()
                        .tabItem {
                            Label("Profile", systemImage: "person.crop.circle")
                        }
                        .tag(AppTab.profile)
                }

                searchHomeView
                    .tabItem {
                        Label("Search", systemImage: "magnifyingglass")
                    }
                    .tag(AppTab.search)
            }

            guestAuthButton
        }
        .background(AppTheme.background.ignoresSafeArea())
        .toolbarColorScheme(.dark, for: .tabBar)
        .toolbarBackground(AppTheme.background, for: .tabBar)
        .tint(AppTheme.accentBlue)
        .onChange(of: selectedTab) { oldValue, newValue in
            if oldValue != .search {
                previousNonSearchTab = oldValue
            }

            if newValue != .search {
                previousNonSearchTab = newValue
            }
        }
        .onChange(of: isAuthenticated) { _, isAuthenticated in
            guard !isAuthenticated, selectedTab.requiresAuthentication else {
                return
            }

            selectedTab = .home
            previousNonSearchTab = .home
        }
        .sheet(isPresented: $isAuthSheetPresented) {
            AuthView(isDismissable: true)
                .environment(Clerk.shared)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
    }

    private var searchHomeView: some View {
        HomeView(
            showsNativeSearch: true,
            isSearchPresentedOnAppear: true,
            onShowActivity: {
                showActivityOrAuth()
            },
            onSearchDismiss: {
                selectedTab = previousNonSearchTab.requiresAuthentication && !isAuthenticated
                    ? .home
                    : previousNonSearchTab
            }
        )
    }

    private var isAuthenticated: Bool {
        appSession.isAuthBypassed || clerk.user != nil
    }

    @ViewBuilder
    private var guestAuthButton: some View {
        if !isAuthenticated {
            VStack {
                Spacer()

                Button {
                    isAuthSheetPresented = true
                } label: {
                    Text("Log in / Sign up")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(.white)
                        .lineLimit(1)
                        .padding(.horizontal, 18)
                        .frame(height: 48)
                        .contentShape(Capsule())
                        .mainTabLiquidGlass(in: Capsule())
                }
                .buttonStyle(.plain)
                .padding(.bottom, 62)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .allowsHitTesting(true)
            .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }

    private func showActivityOrAuth() {
        if isAuthenticated {
            selectedTab = .activity
        } else {
            isAuthSheetPresented = true
        }
    }
}

private enum AppTab: Hashable {
    case home
    case venues
    case activity
    case profile
    case search

    var requiresAuthentication: Bool {
        switch self {
        case .activity, .profile:
            return true
        case .home, .venues, .search:
            return false
        }
    }
}

#Preview {
    MainTabView()
        .environment(Clerk.preview())
}

private extension View {
    @ViewBuilder
    func mainTabLiquidGlass<S: InsettableShape>(in shape: S) -> some View {
        if #available(iOS 26.1, *) {
            glassEffect(.regular.interactive(), in: shape)
        } else if #available(iOS 26.0, *) {
            glassEffect(.regular, in: shape)
        } else {
            background(.black.opacity(0.24), in: shape)
                .background(.ultraThinMaterial, in: shape)
                .overlay(
                    shape.strokeBorder(.white.opacity(0.18), lineWidth: 1)
                )
                .shadow(color: .black.opacity(0.28), radius: 18, x: 0, y: 10)
        }
    }
}
