import ClerkKit
import ClerkKitUI
import SwiftUI

struct MainTabView: View {
    @Environment(Clerk.self) private var clerk
    @Environment(\.apiClient) private var apiClient
    @EnvironmentObject private var appSession: AppSession
    @StateObject private var activityRequestStore = ActivityRequestStore()
    @State private var selectedTab: AppTab = .home
    @State private var previousNonSearchTab: AppTab = .home
    @State private var isAuthSheetPresented = false
    @State private var homeResetTrigger = 0
    @State private var isEventCreationSheetPresented = false
    @State private var presentedPlaceCreationType: PlaceListItem.PlaceType?

    private let floatingCreationButtonSize: CGFloat = 52
    private let floatingCreationButtonBottomPadding: CGFloat = 60

    var body: some View {
        if #available(iOS 26.0, *) {
            liquidGlassTabView
                .environmentObject(activityRequestStore)
        } else {
            legacyTabView
                .environmentObject(activityRequestStore)
        }
    }

    @available(iOS 26.0, *)
    private var liquidGlassTabView: some View {
        ZStack {
            AppTheme.background
                .ignoresSafeArea()

            TabView(selection: tabSelection) {
                Tab("Home", systemImage: "house", value: AppTab.home) {
                    HomeView(
                        resetToCurrentWeekTrigger: homeResetTrigger,
                        onShowActivity: {
                            showActivityOrAuth()
                        }
                    )
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

            creationMenuButton
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
            if !isAuthenticated {
                appSession.updateAdminStatus(false)
            }

            guard !isAuthenticated, selectedTab.requiresAuthentication else {
                return
            }

            selectedTab = .home
            previousNonSearchTab = .home
        }
        .task(id: preloadTaskID) {
            guard isAuthenticated else {
                return
            }

            await preloadAuthenticatedTabs()
        }
        .sheet(isPresented: $isAuthSheetPresented) {
            AuthView(isDismissable: true)
                .environment(Clerk.shared)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $isEventCreationSheetPresented) {
            MobileEventCreationView()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
        .sheet(item: $presentedPlaceCreationType) { type in
            MobilePlaceCreationView(type: type)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
    }

    private var legacyTabView: some View {
        ZStack {
            AppTheme.background
                .ignoresSafeArea()

            TabView(selection: tabSelection) {
                HomeView(
                    resetToCurrentWeekTrigger: homeResetTrigger,
                    onShowActivity: {
                        showActivityOrAuth()
                    }
                )
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

            creationMenuButton
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
            if !isAuthenticated {
                appSession.updateAdminStatus(false)
            }

            guard !isAuthenticated, selectedTab.requiresAuthentication else {
                return
            }

            selectedTab = .home
            previousNonSearchTab = .home
        }
        .task(id: preloadTaskID) {
            guard isAuthenticated else {
                return
            }

            await preloadAuthenticatedTabs()
        }
        .sheet(isPresented: $isAuthSheetPresented) {
            AuthView(isDismissable: true)
                .environment(Clerk.shared)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
        .sheet(isPresented: $isEventCreationSheetPresented) {
            MobileEventCreationView()
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
        .sheet(item: $presentedPlaceCreationType) { type in
            MobilePlaceCreationView(type: type)
                .presentationDetents([.large])
                .presentationDragIndicator(.visible)
        }
    }

    private var searchHomeView: some View {
        HomeView(
            showsNativeSearch: true,
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

    private var preloadTaskID: String {
        "\(clerk.user?.id ?? "guest")-\(appSession.isAuthBypassed)"
    }

    private var tabSelection: Binding<AppTab> {
        Binding(
            get: { selectedTab },
            set: { newValue in
                if selectedTab == .home && newValue == .home {
                    homeResetTrigger += 1
                }

                selectedTab = newValue
            }
        )
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

    private func preloadAuthenticatedTabs() async {
        async let adminStatus = loadAdminStatus()
        async let venues: Void = VenuesViewModel.preload(using: apiClient)
        async let activity: Void = ActivityViewModel.preload(using: apiClient)
        async let profile: Void = ProfileViewModel.preload(using: apiClient)

        _ = await (adminStatus, venues, activity, profile)
    }

    private func loadAdminStatus() async {
        do {
            let response = try await apiClient.send(APIClient.mobileAdminStatus())
            appSession.updateAdminStatus(response.isAdmin)
        } catch {
            appSession.updateAdminStatus(false)
        }
    }

    @ViewBuilder
    private var creationMenuButton: some View {
        if isAuthenticated && appSession.shouldShowFloatingCreationButton && selectedTab != .search {
            VStack {
                Spacer()

                HStack {
                    Spacer()

                    Menu {
                        Button {
                            isEventCreationSheetPresented = true
                        } label: {
                            Label("Add Event", systemImage: "calendar.badge.plus")
                        }

                        Button {
                            presentedPlaceCreationType = .venue
                        } label: {
                            Label("Add Venue", systemImage: "building.2.badge.plus")
                        }

                        Button {
                            presentedPlaceCreationType = .organizer
                        } label: {
                            Label("Add Organizer", systemImage: "person.badge.plus")
                        }
                    } label: {
                        Image(systemName: "plus")
                            .font(.system(size: 17, weight: .bold))
                            .foregroundStyle(.primary)
                            .frame(width: floatingCreationButtonSize, height: floatingCreationButtonSize)
                            .contentShape(Circle())
                            .mainTabLiquidGlass(in: Circle())
                    }
                    .buttonStyle(.plain)
                    .padding(.trailing, 16)
                    .padding(.bottom, floatingCreationButtonBottomPadding)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .allowsHitTesting(true)
            .transition(.move(edge: .trailing).combined(with: .opacity))
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
