import ClerkKit
import SwiftUI
import UserNotifications

struct MainTabView: View {
    @Environment(Clerk.self) private var clerk
    @Environment(\.apiClient) private var apiClient
    @EnvironmentObject private var appSession: AppSession
    @StateObject private var activityRequestStore = ActivityRequestStore()
    @StateObject private var guestGoogleAuthController = GuestGoogleAuthController()
    @AppStorage("wig.auth.last-sign-in-method") private var lastSignInMethod = ""
    @State private var pendingSignInMethod: SignInMethod?
    @State private var selectedTab: AppTab = .home
    @State private var previousNonSearchTab: AppTab = .home
    @State private var isAuthPagePresented = false
    @State private var isGuestWelcomePresented = true
    @State private var hasLoadedHomeContent = false
    @State private var homeResetTrigger = 0
    @State private var venuesResetTrigger = 0
    @State private var activityResetTrigger = 0
    @State private var activityBackDestination: AppTab?
    @State private var profileResetTrigger = 0
    @State private var profileAddPhotoTrigger = 0
    @State private var pendingFriendRequestCount = 0
    @State private var isEventCreationSheetPresented = false
    @State private var presentedPlaceCreationType: PlaceListItem.PlaceType?
    @State private var searchFilter: GlobalSearchFilter = .all
    @State private var searchFilterTrigger = 0
    @State private var searchSourceTab: AppTab?
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
        .blur(radius: !isAuthenticated && isGuestWelcomePresented ? 1.25 : 0)
        .animation(.easeInOut(duration: 0.16), value: isAuthenticated)
        .overlay {
            guestWelcomeOverlay
        }
        .fullScreenCover(isPresented: $isAuthPagePresented, onDismiss: {
            if !isAuthenticated {
                pendingSignInMethod = nil
            }
        }) {
            WIGAuthSheetView(isDismissible: true)
                .background(AppTheme.background.ignoresSafeArea())
        }
        .onChange(of: isAuthenticated) { _, isAuthenticated in
            guard isAuthenticated, let pendingSignInMethod else { return }
            lastSignInMethod = pendingSignInMethod.rawValue
            self.pendingSignInMethod = nil
        }
        .fullScreenCover(item: $appSession.presentedEventDetail) { presentation in
            eventDetailOverlay(for: presentation)
        }
    }

    @ViewBuilder
    private func eventDetailOverlay(for presentation: EventDetailPresentation) -> some View {
        let preloadedRSVPState = clerk.user.flatMap { user in
            EventRSVPPrefetchCache.state(eventID: presentation.event.id, userID: user.id)
        }

        Group {
            if #available(iOS 18.0, *), let sourceID = presentation.transitionSourceID {
                EventDetailView(event: presentation.event, preloadedRSVPState: preloadedRSVPState)
                    .navigationTransition(
                        .zoom(sourceID: sourceID, in: eventDetailTransitionNamespace)
                    )
            } else {
                EventDetailView(event: presentation.event, preloadedRSVPState: preloadedRSVPState)
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
                        onFindFriends: { openSearch(filter: .people, from: .home) },
                        onExplorePlaces: { selectedTab = .venues },
                        onAddProfilePhoto: {
                            profileAddPhotoTrigger += 1
                            selectedTab = .profile
                        },
                        onSearchEvents: { openSearch(filter: .events, from: .home) },
                        onInitialContentReady: markHomeContentReady
                    )
                }

                Tab("", systemImage: "building.2", value: AppTab.venues) {
                    VenuesView(
                        resetFiltersTrigger: venuesResetTrigger,
                        onSearch: { openSearch(filter: .places, from: .venues) }
                    )
                }

                if isAuthenticated {
                    Tab("", systemImage: "bolt", value: AppTab.activity) {
                        activityView
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

            // Temporarily hidden: keep the admin creation control available for a
            // future restore without showing a fixed bottom-right button on every tab.
            // creationMenuButton
            guestAuthButton
        }
        .background(AppTheme.background.ignoresSafeArea())
        .toolbarColorScheme(.dark, for: .tabBar)
        .toolbarBackground(AppTheme.background, for: .tabBar)
        .onChange(of: selectedTab) { oldValue, newValue in
            resetFilters(for: oldValue, whenSwitchingTo: newValue)

            if newValue != .activity {
                activityBackDestination = nil
            }

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

            guard hasLoadedHomeContent else { return }
            await preloadAuthenticatedTabs()
        }
        .onReceive(NotificationCenter.default.publisher(for: .friendRequestDidChange)) { notification in
            handleFriendRequestChange(notification)
        }
        .onReceive(NotificationCenter.default.publisher(for: .appDataDidChange)) { _ in
            Task {
                await refreshFriendRequestBadge()
            }
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
                    onFindFriends: { openSearch(filter: .people, from: .home) },
                    onExplorePlaces: { selectedTab = .venues },
                    onAddProfilePhoto: {
                        profileAddPhotoTrigger += 1
                        selectedTab = .profile
                    },
                    onSearchEvents: { openSearch(filter: .events, from: .home) },
                    onInitialContentReady: markHomeContentReady
                )
                    .tabItem {
                        Image(systemName: "house")
                    }
                    .tag(AppTab.home)

                VenuesView(
                    resetFiltersTrigger: venuesResetTrigger,
                    onSearch: { openSearch(filter: .places, from: .venues) }
                )
                    .tabItem {
                        Image(systemName: "building.2")
                    }
                    .tag(AppTab.venues)

                if isAuthenticated {
                    activityView
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

            // Temporarily hidden: keep the admin creation control available for a
            // future restore without showing a fixed bottom-right button on every tab.
            // creationMenuButton
            guestAuthButton
        }
        .background(AppTheme.background.ignoresSafeArea())
        .toolbarColorScheme(.dark, for: .tabBar)
        .toolbarBackground(AppTheme.background, for: .tabBar)
        .onChange(of: selectedTab) { oldValue, newValue in
            resetFilters(for: oldValue, whenSwitchingTo: newValue)

            if newValue != .activity {
                activityBackDestination = nil
            }

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

            guard hasLoadedHomeContent else { return }
            await preloadAuthenticatedTabs()
        }
        .onReceive(NotificationCenter.default.publisher(for: .friendRequestDidChange)) { notification in
            handleFriendRequestChange(notification)
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
                searchSourceTab = nil
                selectedTab = previousNonSearchTab.requiresAuthentication && !isAuthenticated
                    ? .home
                    : previousNonSearchTab
            },
            initialSearchFilter: searchFilter,
            searchFilterTrigger: searchFilterTrigger,
            showsSearchBackButton: searchSourceTab == .home || searchSourceTab == .venues,
            onSearchBack: returnFromContextualSearch,
            shouldAutoFocusSearch: searchSourceTab == .home || searchSourceTab == .venues
        )
    }

    private var activityView: some View {
        ActivityView(
            resetFiltersTrigger: activityResetTrigger,
            showsBackButton: activityBackDestination != nil,
            onBack: returnFromContextualActivity
        )
    }

    private var isAuthenticated: Bool {
        appSession.isAuthBypassed || clerk.user != nil
    }

    private var preloadTaskID: String {
        "\(clerk.user?.id ?? "guest")-\(appSession.isAuthBypassed)-\(hasLoadedHomeContent)"
    }

    private var tabSelection: Binding<AppTab> {
        Binding(
            get: { selectedTab },
            set: { newValue in
                if selectedTab == .home && newValue == .home {
                    homeResetTrigger += 1
                }

                if newValue == .search && selectedTab != .search {
                    searchFilter = .all
                    searchSourceTab = nil
                    searchFilterTrigger += 1
                }

                selectedTab = newValue
            }
        )
    }

    private func openSearch(filter: GlobalSearchFilter, from sourceTab: AppTab) {
        searchFilter = filter
        searchSourceTab = sourceTab
        searchFilterTrigger += 1
        selectedTab = .search
    }

    private func returnFromContextualSearch() {
        guard let searchSourceTab else { return }
        self.searchSourceTab = nil
        selectedTab = searchSourceTab
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
        if !isAuthenticated && !isGuestWelcomePresented {
            VStack {
                Spacer()

                Button {
                    isAuthPagePresented = true
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

    @ViewBuilder
    private var guestWelcomeOverlay: some View {
        if !isAuthenticated && isGuestWelcomePresented {
            GuestWelcomeView(
                googleAuthController: guestGoogleAuthController,
                lastSignInMethod: SignInMethod(rawValue: lastSignInMethod),
                onContinueWithGoogle: continueWithGoogle,
                onContinueWithApple: continueWithApple,
                onUseEmail: presentAuthenticationFromGuestWelcome
            )
            .transition(.opacity)
            .zIndex(10)
        }
    }

    private func markHomeContentReady() {
        hasLoadedHomeContent = true
    }

    private func presentAuthenticationFromGuestWelcome() {
        guard !isAuthenticated else { return }
        pendingSignInMethod = .email
        isAuthPagePresented = true
    }

    private func continueWithGoogle() {
        pendingSignInMethod = .google
        Task {
            let outcome = await guestGoogleAuthController.signIn(using: clerk)
            if outcome == .cancelled || outcome == .failed {
                pendingSignInMethod = nil
            }
            guard outcome == .needsContinuation, !isAuthenticated else { return }
            isAuthPagePresented = true
        }
    }

    private func continueWithApple() {
        pendingSignInMethod = .apple
        Task {
            let outcome = await guestGoogleAuthController.signInWithApple(using: clerk)
            if outcome == .cancelled || outcome == .failed {
                pendingSignInMethod = nil
            }
            guard outcome == .needsContinuation, !isAuthenticated else { return }
            isAuthPagePresented = true
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

    private func handleFriendRequestChange(_ notification: Notification) {
        pendingFriendRequestCount = ProfileViewModel.pendingFriendRequestCount
        syncAppIconBadge()

        guard !(notification.object is FriendUserSummary) else {
            return
        }

        Task {
            await refreshFriendRequestBadge()
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
            activityBackDestination = .home
            selectedTab = .activity
        } else {
            isAuthPagePresented = true
        }
    }

    private func returnFromContextualActivity() {
        guard let activityBackDestination else { return }
        self.activityBackDestination = nil
        selectedTab = activityBackDestination
    }
}

private struct GuestWelcomeView: View {
    @ObservedObject var googleAuthController: GuestGoogleAuthController
    let lastSignInMethod: SignInMethod?
    let onContinueWithGoogle: () -> Void
    let onContinueWithApple: () -> Void
    let onUseEmail: () -> Void

    @Environment(Clerk.self) private var clerk

    var body: some View {
        ZStack {
            previewWindowBackground

            Color.clear
                .contentShape(Rectangle())
                .gesture(
                    DragGesture(minimumDistance: 0)
                        .onChanged { _ in }
                )
                .accessibilityHidden(true)

            VStack(spacing: 0) {
                Image("LaunchIcon")
                    .resizable()
                    .scaledToFit()
                    .frame(width: 92, height: 92)
                    .clipShape(RoundedRectangle(cornerRadius: 20, style: .continuous))
                    .shadow(color: .black.opacity(0.30), radius: 18, y: 8)

                Spacer()

                Text("See who is going,\ndecide where to go.")
                    .font(.system(size: 36, weight: .heavy))
                    .foregroundStyle(.white)
                    .multilineTextAlignment(.center)
                    .tracking(-0.8)
                    .frame(maxWidth: .infinity)
                    .padding(.bottom, 20)

                VStack(spacing: 10) {
                    Button(action: onContinueWithApple) {
                        ZStack(alignment: .leading) {
                            Text("Continue with Apple")
                                .font(.system(size: 16, weight: .semibold))
                                .frame(maxWidth: .infinity)

                            Image(systemName: "apple.logo")
                                .font(.system(size: 20, weight: .medium))
                                .frame(width: 21, height: 21)
                                .padding(.leading, 20)
                        }
                        .foregroundStyle(.black.opacity(0.88))
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .background(.white, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay {
                            if googleAuthController.isAppleLoading {
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .fill(.white.opacity(0.90))

                                ProgressView()
                                    .tint(.black)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(googleAuthController.isLoading || googleAuthController.isAppleLoading)
                    .overlay(alignment: .topTrailing) {
                        lastUsedBadge(for: .apple)
                    }

                    Button(action: onContinueWithGoogle) {
                        ZStack(alignment: .leading) {
                            Text("Continue with Google")
                                .font(.system(size: 16, weight: .semibold))
                                .frame(maxWidth: .infinity)

                            googleProviderIcon
                                .padding(.leading, 20)
                        }
                        .foregroundStyle(.black.opacity(0.88))
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .background(.white, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay {
                            if googleAuthController.isLoading {
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .fill(.white.opacity(0.90))

                                ProgressView()
                                    .tint(.black)
                            }
                        }
                    }
                    .buttonStyle(.plain)
                    .disabled(googleAuthController.isLoading || googleAuthController.isAppleLoading)
                    .overlay(alignment: .topTrailing) {
                        lastUsedBadge(for: .google)
                    }

                    Button(action: onUseEmail) {
                        ZStack(alignment: .leading) {
                            Text("Continue with email")
                                .font(.system(size: 16, weight: .semibold))
                                .frame(maxWidth: .infinity)

                            Image(systemName: "envelope.fill")
                                .font(.system(size: 18, weight: .semibold))
                                .frame(width: 21, height: 21)
                                .padding(.leading, 20)
                        }
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity, minHeight: 52)
                        .background(.black, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
                        .overlay {
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .strokeBorder(.white.opacity(0.18), lineWidth: 1)
                        }
                    }
                    .buttonStyle(.plain)
                    .overlay(alignment: .topTrailing) {
                        lastUsedBadge(for: .email)
                    }

                }
            }
            .padding(.horizontal, 24)
            .padding(.bottom, 48)
            .ignoresSafeArea(.container, edges: .bottom)
        }
        .accessibilityElement(children: .contain)
        .alert(
            "Couldn't Continue",
            isPresented: Binding(
                get: { googleAuthController.errorMessage != nil },
                set: { isPresented in
                    if !isPresented {
                        googleAuthController.errorMessage = nil
                    }
                }
            )
        ) {
            Button("OK", role: .cancel) {}
        } message: {
            Text(googleAuthController.errorMessage ?? "Please try again.")
        }
    }

    @ViewBuilder
    private func lastUsedBadge(for method: SignInMethod) -> some View {
        if lastSignInMethod == method {
            Text("Last used")
                .font(.system(size: 10, weight: .bold))
                .foregroundStyle(.black)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(AppTheme.accentBlue, in: RoundedRectangle(cornerRadius: 6, style: .continuous))
                .offset(x: 4, y: -10)
                .accessibilityLabel("Last used sign-in method")
        }
    }

    @ViewBuilder
    private var googleProviderIcon: some View {
        if let logoURL = googleLogoURL {
            AsyncImage(url: logoURL) { image in
                image
                    .resizable()
                    .scaledToFit()
            } placeholder: {
                Text("G")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(.blue)
            }
            .frame(width: 21, height: 21)
        } else {
            Text("G")
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(.blue)
                .frame(width: 21, height: 21)
        }
    }

    private var googleLogoURL: URL? {
        guard let logoURLString = clerk.environment?.userSettings.social["oauth_google"]?.logoUrl else {
            return nil
        }

        return URL(string: logoURLString)
    }

    private var previewWindowBackground: some View {
        LinearGradient(
            stops: [
                .init(color: .black, location: 0.00),
                .init(color: .black, location: 0.11),
                .init(color: .black.opacity(0.45), location: 0.19),
                .init(color: .black.opacity(0.38), location: 0.43),
                .init(color: .black.opacity(0.66), location: 0.60),
                .init(color: .black, location: 0.69),
                .init(color: .black, location: 1.00),
            ],
            startPoint: .top,
            endPoint: .bottom
        )
        .ignoresSafeArea()
        .allowsHitTesting(false)
    }
}

private enum SignInMethod: String {
    case apple
    case google
    case email
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
