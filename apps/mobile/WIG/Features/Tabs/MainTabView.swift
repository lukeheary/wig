import ClerkKit
import SwiftUI
import UserNotifications

struct MainTabView: View {
    @Environment(Clerk.self) private var clerk
    @Environment(\.apiClient) private var apiClient
    @EnvironmentObject private var appSession: AppSession
    @StateObject private var activityRequestStore = ActivityRequestStore()
    @State private var selectedTab: AppTab = .home
    @State private var previousNonSearchTab: AppTab = .home
    @State private var isAuthSheetPresented = false
    @State private var homeResetTrigger = 0
    @State private var venuesResetTrigger = 0
    @State private var activityResetTrigger = 0
    @State private var profileResetTrigger = 0
    @State private var profileAddPhotoTrigger = 0
    @State private var pendingFriendRequestCount = 0
    @State private var isEventCreationSheetPresented = false
    @State private var presentedPlaceCreationType: PlaceListItem.PlaceType?
    @Namespace private var eventDetailTransitionNamespace

    private let floatingCreationButtonSize: CGFloat = 52
    private let floatingCreationButtonBottomPadding: CGFloat = 60

    var body: some View {
        Group {
            if #available(iOS 26.0, *) {
                liquidGlassTabView
            } else {
                legacyTabView
            }
        }
        .environmentObject(activityRequestStore)
        .environment(\.eventDetailTransitionNamespace, eventDetailTransitionNamespace)
        .fullScreenCover(item: $appSession.presentedEventDetail) { presentation in
            eventDetailOverlay(for: presentation)
        }
    }

    @ViewBuilder
    private func eventDetailOverlay(for presentation: EventDetailPresentation) -> some View {
        Group {
            if #available(iOS 18.0, *), let sourceID = presentation.transitionSourceID {
                EventDetailView(event: presentation.event)
                    .navigationTransition(
                        .zoom(sourceID: sourceID, in: eventDetailTransitionNamespace)
                    )
            } else {
                EventDetailView(event: presentation.event)
            }
        }
        // The event content itself is opaque at full size. Keeping only the
        // presentation host clear lets Home and its live tab bar show around the
        // shrinking event page on the very first reverse-transition frame.
        .presentationBackground(.clear)
    }

    @available(iOS 26.0, *)
    private var liquidGlassTabView: some View {
        ZStack {
            AppTheme.background
                .ignoresSafeArea()

            TabView(selection: tabSelection) {
                Tab("", systemImage: "house", value: AppTab.home) {
                    HomeView(
                        resetToCurrentWeekTrigger: homeResetTrigger,
                        onShowActivity: {
                            showActivityOrAuth()
                        },
                        onFindFriends: { selectedTab = .search },
                        onExplorePlaces: { selectedTab = .venues },
                        onAddProfilePhoto: {
                            profileAddPhotoTrigger += 1
                            selectedTab = .profile
                        }
                    )
                }

                Tab("", systemImage: "building.2", value: AppTab.venues) {
                    VenuesView(resetFiltersTrigger: venuesResetTrigger)
                }

                if isAuthenticated {
                    Tab("", systemImage: "bolt", value: AppTab.activity) {
                        ActivityView(resetFiltersTrigger: activityResetTrigger)
                    }

                    Tab("", systemImage: "magnifyingglass", value: AppTab.search) {
                        searchHomeView
                    }

                    Tab("", systemImage: "person.crop.circle", value: AppTab.profile) {
                        ProfileView(
                            resetFiltersTrigger: profileResetTrigger,
                            addPhotoTrigger: profileAddPhotoTrigger
                        )
                    }
                    .badge(friendRequestTabBadge)
                } else {
                    Tab("", systemImage: "magnifyingglass", value: AppTab.search) {
                        searchHomeView
                    }
                }
            }
            .tabBarMinimizeBehavior(.never)

            creationMenuButton
            guestAuthButton
        }
        .background(AppTheme.background.ignoresSafeArea())
        .toolbarColorScheme(.dark, for: .tabBar)
        .toolbarBackground(AppTheme.background, for: .tabBar)
        .tint(AppTheme.accentBlue)
        .onChange(of: selectedTab) { oldValue, newValue in
            resetFilters(for: oldValue, whenSwitchingTo: newValue)

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
                pendingFriendRequestCount = 0
                syncAppIconBadge()
            }

            guard !isAuthenticated, selectedTab.requiresAuthentication else {
                return
            }

            selectedTab = .home
            previousNonSearchTab = .home
        }
        .task(id: preloadTaskID) {
            guard isAuthenticated else {
                pendingFriendRequestCount = 0
                syncAppIconBadge()
                return
            }

            await preloadAuthenticatedTabs()
        }
        .onReceive(NotificationCenter.default.publisher(for: .friendRequestDidChange)) { _ in
            Task {
                await refreshFriendRequestBadge()
            }
        }
        .onReceive(NotificationCenter.default.publisher(for: .appDataDidChange)) { _ in
            Task {
                await refreshFriendRequestBadge()
            }
        }
        .sheet(isPresented: $isAuthSheetPresented) {
            WIGAuthSheetView(isDismissable: true)
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
                    },
                    onFindFriends: { selectedTab = .search },
                    onExplorePlaces: { selectedTab = .venues },
                    onAddProfilePhoto: {
                        profileAddPhotoTrigger += 1
                        selectedTab = .profile
                    }
                )
                    .tabItem {
                        Image(systemName: "house")
                    }
                    .tag(AppTab.home)

                VenuesView(resetFiltersTrigger: venuesResetTrigger)
                    .tabItem {
                        Image(systemName: "building.2")
                    }
                    .tag(AppTab.venues)

                if isAuthenticated {
                    ActivityView(resetFiltersTrigger: activityResetTrigger)
                        .tabItem {
                            Image(systemName: "bolt")
                        }
                        .tag(AppTab.activity)

                    searchHomeView
                        .tabItem {
                            Image(systemName: "magnifyingglass")
                        }
                        .tag(AppTab.search)

                    ProfileView(
                        resetFiltersTrigger: profileResetTrigger,
                        addPhotoTrigger: profileAddPhotoTrigger
                    )
                        .tabItem {
                            Image(systemName: "person.crop.circle")
                        }
                        .tag(AppTab.profile)
                        .badge(friendRequestLegacyBadge)
                        .badgeProminence(.decreased)
                } else {
                    searchHomeView
                        .tabItem {
                            Image(systemName: "magnifyingglass")
                        }
                        .tag(AppTab.search)
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
            resetFilters(for: oldValue, whenSwitchingTo: newValue)

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
                pendingFriendRequestCount = 0
                syncAppIconBadge()
            }

            guard !isAuthenticated, selectedTab.requiresAuthentication else {
                return
            }

            selectedTab = .home
            previousNonSearchTab = .home
        }
        .task(id: preloadTaskID) {
            guard isAuthenticated else {
                pendingFriendRequestCount = 0
                syncAppIconBadge()
                return
            }

            await preloadAuthenticatedTabs()
        }
        .onReceive(NotificationCenter.default.publisher(for: .friendRequestDidChange)) { _ in
            Task {
                await refreshFriendRequestBadge()
            }
        }
        .sheet(isPresented: $isAuthSheetPresented) {
            WIGAuthSheetView(isDismissable: true)
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

    private func resetFilters(for oldValue: AppTab, whenSwitchingTo newValue: AppTab) {
        guard oldValue != newValue else {
            return
        }

        switch oldValue {
        case .home:
            homeResetTrigger += 1
        case .venues:
            venuesResetTrigger += 1
        case .activity:
            activityResetTrigger += 1
        case .profile:
            profileResetTrigger += 1
        case .search:
            break
        }
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
        async let search: Void = HomeSearchDirectoryViewModel.preload(using: apiClient)
        async let categories: Void = MobileCategoryStore.preload(using: apiClient)

        _ = await (adminStatus, venues, activity, profile, search, categories)
        pendingFriendRequestCount = ProfileViewModel.pendingFriendRequestCount
        syncAppIconBadge()
    }

    private var friendRequestTabBadge: Text? {
        pendingFriendRequestCount > 0 ? Text("\(pendingFriendRequestCount)") : nil
    }

    private var friendRequestLegacyBadge: String? {
        pendingFriendRequestCount > 0 ? "\(pendingFriendRequestCount)" : nil
    }

    private func refreshFriendRequestBadge() async {
        do {
            let response = try await apiClient.send(APIClient.mobileFriends())
            pendingFriendRequestCount = response.requestCount
            syncAppIconBadge()
        } catch {
            // Keep the last known badge state if a refresh fails.
        }
    }

    private func syncAppIconBadge() {
        let count = pendingFriendRequestCount

        Task {
            try? await UNUserNotificationCenter.current().setBadgeCount(count)
        }
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
                            presentedPlaceCreationType = .organizer
                        } label: {
                            Label("Add Organizer", systemImage: "person.badge.plus")
                        }

                        Button {
                            presentedPlaceCreationType = .venue
                        } label: {
                            Label("Add Venue", systemImage: "building.2")
                        }

                        Button {
                            isEventCreationSheetPresented = true
                        } label: {
                            Label("Add Event", systemImage: "calendar.badge.plus")
                        }
                    } label: {
                        Image(systemName: "plus")
                            .font(.system(size: 17, weight: .bold))
                            .foregroundStyle(.white)
                            .frame(width: floatingCreationButtonSize, height: floatingCreationButtonSize)
                            .contentShape(Circle())
                            .mainTabLiquidGlass(in: Circle())
                    }
                    .buttonStyle(.plain)
                    .tint(.white)
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
