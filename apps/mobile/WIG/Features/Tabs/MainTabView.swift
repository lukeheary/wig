import SwiftUI

struct MainTabView: View {
    @State private var selectedTab: AppTab = .home

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
                    HomeView {
                        selectedTab = .activity
                    }
                }

                Tab("Venues", systemImage: "building.2", value: AppTab.venues) {
                    VenuesView()
                }

                Tab("Activity", systemImage: "bolt", value: AppTab.activity) {
                    ActivityView()
                }

                Tab("Profile", systemImage: "person.crop.circle", value: AppTab.profile) {
                    ProfileView()
                }

                Tab("Search", systemImage: "magnifyingglass", value: AppTab.search, role: .search) {
                    HomeView(showsNativeSearch: true, isSearchPresentedOnAppear: true) {
                        selectedTab = .activity
                    }
                }
            }
        }
        .background(AppTheme.background.ignoresSafeArea())
        .toolbarColorScheme(.dark, for: .tabBar)
        .toolbarBackground(AppTheme.background, for: .tabBar)
        .tint(AppTheme.accentBlue)
    }

    private var legacyTabView: some View {
        ZStack {
            AppTheme.background
                .ignoresSafeArea()

            TabView(selection: $selectedTab) {
                HomeView {
                    selectedTab = .activity
                }
                    .tabItem {
                        Label("Home", systemImage: "house")
                    }
                    .tag(AppTab.home)

                VenuesView()
                    .tabItem {
                        Label("Venues", systemImage: "building.2")
                    }
                    .tag(AppTab.venues)

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

                HomeView(showsNativeSearch: true, isSearchPresentedOnAppear: true) {
                    selectedTab = .activity
                }
                    .tabItem {
                        Label("Search", systemImage: "magnifyingglass")
                    }
                    .tag(AppTab.search)
            }
        }
        .background(AppTheme.background.ignoresSafeArea())
        .toolbarColorScheme(.dark, for: .tabBar)
        .toolbarBackground(AppTheme.background, for: .tabBar)
        .tint(AppTheme.accentBlue)
    }
}

private enum AppTab: Hashable {
    case home
    case venues
    case activity
    case profile
    case search
}

#Preview {
    MainTabView()
}
