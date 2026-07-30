import ClerkKit
import SwiftUI

private enum OnboardingInputField: Hashable {
    case firstName
    case lastName
    case username
}

enum MobileProfileFormMode {
    case onboarding
    case editing

    var title: String {
        switch self {
        case .onboarding: "Complete your profile"
        case .editing: "Edit Profile"
        }
    }

    var subtitle: String? {
        switch self {
        case .onboarding: "Tell us a little about yourself to finish setting up your account."
        case .editing: nil
        }
    }
}

struct AuthGate: View {
    let onReady: () -> Void

    @Environment(Clerk.self) private var clerk
    @Environment(\.apiClient) private var apiClient
    @EnvironmentObject private var appSession: AppSession
    @StateObject private var viewModel = MobileAuthGateViewModel()
    @State private var isHomePreloadReady = false

    var body: some View {
        Group {
            if !requiresOnboardingGate {
                MainTabView()
            } else {
                switch viewModel.state {
                case .idle, .loading:
                    MobileOnboardingLoadingView()

                case .failed(let message):
                    MobileOnboardingGateErrorView(message: message) {
                        Task {
                            await viewModel.load(using: apiClient)
                        }
                    }

                case .loaded(let onboardingState):
                    if onboardingState.isOnboarding {
                        MobileOnboardingView(initialState: onboardingState) {
                            ProfileViewModel.invalidateCache()
                            UserProfileViewModel.invalidateAllCaches()
                            viewModel.markCompleted()
                        }
                    } else if !isHomePreloadReady {
                        MobileOnboardingLoadingView()
                    } else {
                        MainTabView()
                    }
                }
            }
        }
        .task(id: gateTaskID) {
            isHomePreloadReady = false
            async let homePreload: Void = EventFeedViewModel.preload(
                using: apiClient,
                cacheIdentity: eventFeedCacheIdentity
            )
            async let recentActivityPreload: Void = preloadRecentActivity()

            if requiresOnboardingGate {
                await viewModel.load(using: apiClient)
            }

            _ = await (homePreload, recentActivityPreload)
            isHomePreloadReady = true
            await Task.yield()
            onReady()
        }
        .onChange(of: requiresOnboardingGate) { _, requiresOnboardingGate in
            if !requiresOnboardingGate {
                viewModel.reset()
            }
        }
        .onChange(of: clerk.user?.id) { previousUserID, userID in
            guard previousUserID != userID else {
                return
            }

            ProfileViewModel.invalidateCache()
            UserProfileViewModel.invalidateAllCaches()
        }
    }

    private var requiresOnboardingGate: Bool {
        !appSession.isAuthBypassed && clerk.user != nil
    }

    private var gateTaskID: String {
        "\(clerk.user?.id ?? "guest")-\(appSession.isAuthBypassed)"
    }

    private var eventFeedCacheIdentity: String {
        appSession.isAuthBypassed ? "bypass" : clerk.user?.id ?? "guest"
    }

    private func preloadRecentActivity() async {
        guard clerk.user != nil || appSession.isAuthBypassed else {
            return
        }

        await HomeRecentActivityViewModel.preload(
            using: apiClient,
            cacheIdentity: eventFeedCacheIdentity
        )
    }
}

private struct MobileOnboardingLoadingView: View {
    var body: some View {
        LaunchLoadingView()
            .background(AppTheme.background.ignoresSafeArea())
    }
}

@MainActor
private final class MobileAuthGateViewModel: ObservableObject {
    enum State {
        case idle
        case loading
        case loaded(MobileOnboardingState)
        case failed(String)
    }

    @Published private(set) var state: State = .idle

    func load(using apiClient: APIClient) async {
        if case .loading = state {
            return
        }

        state = .loading

        do {
            let response = try await apiClient.send(APIClient.mobileOnboardingState())
            state = .loaded(response)
        } catch {
            state = .failed(error.localizedDescription)
        }
    }

    func markCompleted() {
        state = .loaded(
            MobileOnboardingState(
                isOnboarding: false,
                firstName: "",
                lastName: "",
                username: "",
                city: "",
                state: "",
                gender: nil,
                dateOfBirth: nil,
                avatarImageURL: nil,
                debug: nil
            )
        )
    }

    func reset() {
        state = .idle
    }
}

private struct MobileOnboardingGateErrorView: View {
    let message: String
    let onRetry: () -> Void

    var body: some View {
        VStack(spacing: 16) {
            Text("Couldn't Load Account")
                .font(.system(size: 24, weight: .bold))
                .foregroundStyle(.white)

            Text(message)
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(.white.opacity(0.64))
                .multilineTextAlignment(.center)

            Button(action: onRetry) {
                Text("Try Again")
                    .font(.system(size: 16, weight: .bold))
                    .foregroundStyle(.black)
                    .frame(width: 140, height: 50)
                    .background(Color.white, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
            }
            .buttonStyle(.plain)
        }
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(AppTheme.background)
    }
}

struct MobileOnboardingView: View {
    let initialState: MobileOnboardingState
    let mode: MobileProfileFormMode
    let onComplete: () -> Void

    @Environment(\.apiClient) private var apiClient
    @Environment(Clerk.self) private var clerk
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel: MobileOnboardingViewModel
    @State private var firstName: String
    @State private var lastName: String
    @State private var username: String
    @State private var city: String
    @State private var state: String
    @State private var gender: UserGender?
    @State private var dateOfBirth: Date?
    @State private var birthdayPickerDate: Date
    @State private var didSelectBirthday: Bool
    @State private var errorMessage: String?
    @State private var isCitySearchPresented = false
    @State private var isBirthdayPickerPresented = false
    @FocusState private var focusedInput: OnboardingInputField?

    private var normalizedUsername: String {
        username.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }

    private var canSubmit: Bool {
        !firstName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            !lastName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty &&
            Self.isValidUsername(normalizedUsername) &&
            !city.isEmpty &&
            state.count == 2 &&
            gender != nil &&
            dateOfBirth != nil &&
            !viewModel.isSubmitting
    }

    init(
        initialState: MobileOnboardingState,
        mode: MobileProfileFormMode = .onboarding,
        onComplete: @escaping () -> Void
    ) {
        self.initialState = initialState
        self.mode = mode
        self.onComplete = onComplete

        let initialDate = Self.date(from: initialState.dateOfBirth)
        _viewModel = StateObject(wrappedValue: MobileOnboardingViewModel())
        _firstName = State(initialValue: initialState.firstName)
        _lastName = State(initialValue: initialState.lastName)
        _username = State(initialValue: initialState.username)
        _city = State(initialValue: initialState.city)
        _state = State(initialValue: initialState.state)
        _gender = State(initialValue: initialState.gender)
        _dateOfBirth = State(initialValue: initialDate)
        _birthdayPickerDate = State(initialValue: initialDate ?? Self.defaultDateOfBirth)
        _didSelectBirthday = State(initialValue: initialDate != nil)
    }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 24) {
                header
                nameSection
                usernameSection
                citySection
                genderSection
                birthdaySection

                if mode == .onboarding {
                    submitButton
                }

                if let errorMessage {
                    Text(errorMessage)
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.red.opacity(0.92))
                }

                if mode == .onboarding {
                    signOutButton
                }
            }
            .padding(.horizontal, mode == .editing ? 16 : 18)
            .padding(.top, mode == .editing ? 74 : 20)
            .padding(.bottom, 20)
        }
        .scrollIndicators(.hidden)
        .background(onboardingBackground)
        .toolbar(.hidden, for: .navigationBar)
        .overlay(alignment: .top) {
            if mode == .editing {
                editNavigationBar
            }
        }
        .sheet(isPresented: $isCitySearchPresented) {
            GooglePlaceSearchSheet(
                title: "Search Cities",
                placeholder: "Search for your city",
                emptyPrompt: "Search for the city where you live.",
                iconSystemName: "mappin.and.ellipse",
                searchType: .cities
            ) { detail in
                let resolvedCity = detail.city.trimmingCharacters(in: .whitespacesAndNewlines)
                city = resolvedCity.isEmpty ? detail.name : resolvedCity
                state = detail.state.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()
            }
        }
        .sheet(isPresented: $isBirthdayPickerPresented) {
            birthdayPickerSheet
        }
    }

    private var onboardingBackground: some View {
        LinearGradient(
            colors: [
                AppTheme.background,
                Color(red: 0.055, green: 0.055, blue: 0.065),
            ],
            startPoint: .top,
            endPoint: .bottom
        )
        .ignoresSafeArea()
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 7) {
            Text(mode.title)
                .font(
                    mode == .editing
                        ? .system(size: 20, weight: .bold)
                        : .system(size: 28, weight: .semibold)
                )
                .foregroundStyle(.white)

            if let subtitle = mode.subtitle {
                Text(subtitle)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.white.opacity(0.56))
                    .lineSpacing(2)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(.bottom, 4)
    }

    private var editNavigationBar: some View {
        HStack {
            Button {
                dismiss()
            } label: {
                Image(systemName: "chevron.left")
                    .font(.system(size: 17, weight: .bold))
                    .foregroundStyle(.white)
                    .frame(width: 46, height: 46)
                    .contentShape(Circle())
                    .profileFormLiquidGlass(in: Circle())
            }
            .buttonStyle(.plain)

            Spacer()

            Button {
                focusedInput = nil
                submit()
            } label: {
                HStack(spacing: 8) {
                    if viewModel.isSubmitting {
                        ProgressView()
                            .tint(.black)
                    }

                    Text("Save")
                        .font(.system(size: 15, weight: .bold))
                }
                .foregroundStyle(.black)
                .padding(.horizontal, 18)
                .frame(height: 46)
                .background(
                    Capsule()
                        .fill(.white)
                )
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .disabled(!canSubmit)
            .opacity(canSubmit ? 1 : 0.36)
        }
        .padding(.horizontal, 16)
        .padding(.top, 0)
    }

    private var nameSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Name")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white.opacity(0.78))

            HStack(spacing: 8) {
                OnboardingTextInput(
                    "First name",
                    text: $firstName,
                    field: .firstName,
                    focusedInput: $focusedInput,
                    contentType: .givenName,
                    capitalization: .words
                )
                OnboardingTextInput(
                    "Last name",
                    text: $lastName,
                    field: .lastName,
                    focusedInput: $focusedInput,
                    contentType: .familyName,
                    capitalization: .words
                )
            }
        }
    }

    private var genderSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Gender")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white.opacity(0.78))

            HStack(spacing: 4) {
                ForEach(UserGender.allCases, id: \.self) { option in
                    Button {
                        focusedInput = nil
                        withAnimation(.easeOut(duration: 0.16)) {
                            gender = option
                        }
                    } label: {
                        Text(option.onboardingLabel)
                            .font(.system(size: 15, weight: gender == option ? .semibold : .medium))
                            .foregroundStyle(.white.opacity(gender == option ? 1 : 0.72))
                            .frame(maxWidth: .infinity)
                            .frame(height: 40)
                            .background(
                                RoundedRectangle(cornerRadius: 13, style: .continuous)
                                    .fill(gender == option ? Color.white.opacity(0.18) : .clear)
                            )
                            .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }
            }
            .padding(4)
            .frame(height: 48)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color.white.opacity(0.08))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .strokeBorder(.white.opacity(0.07), lineWidth: 1)
            )
        }
    }

    private var citySection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("City")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white.opacity(0.78))

            Button {
                focusedInput = nil
                isCitySearchPresented = true
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "mappin.and.ellipse")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.62))

                    Text(city.isEmpty ? "Search for your city" : "\(city), \(state)")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(city.isEmpty ? .white.opacity(0.46) : .white)

                    Spacer()

                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.34))
                }
                .padding(.horizontal, 16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .frame(height: 48)
                .background(fieldBackground)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
        }
    }

    private var usernameSection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Username")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white.opacity(0.78))

            OnboardingTextInput(
                "johndoe",
                text: $username,
                field: .username,
                focusedInput: $focusedInput,
                capitalization: .never,
                keyboardType: .asciiCapable,
                lowercasesInput: true
            )

            Text("3-20 characters · letters, numbers, and underscores")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(.white.opacity(0.42))
        }
    }

    private var birthdaySection: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Birthday")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white.opacity(0.78))

            Button {
                focusedInput = nil
                birthdayPickerDate = dateOfBirth ?? Self.defaultDateOfBirth
                didSelectBirthday = dateOfBirth != nil
                isBirthdayPickerPresented = true
            } label: {
                HStack(spacing: 12) {
                    Image(systemName: "calendar")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.62))

                    Text(
                        dateOfBirth?.formatted(.dateTime.month(.abbreviated).day().year())
                            ?? "Select your birthday"
                    )
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(dateOfBirth == nil ? .white.opacity(0.46) : .white)

                    Spacer()

                    Image(systemName: "chevron.right")
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.34))
                }
                .padding(.horizontal, 16)
                .frame(maxWidth: .infinity, alignment: .leading)
                .frame(height: 48)
                .background(fieldBackground)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .frame(maxWidth: .infinity)
            .contentShape(Rectangle())
        }
    }

    private var birthdayPickerSheet: some View {
        VStack(spacing: 0) {
            ZStack {
                Text("Birthday")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(.white)

                HStack {
                    Spacer()

                    Button("Done") {
                        dateOfBirth = birthdayPickerDate
                        isBirthdayPickerPresented = false
                    }
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 16)
                    .frame(height: 38)
                    .background(
                        Capsule()
                            .fill(.ultraThinMaterial)
                    )
                    .disabled(!didSelectBirthday)
                    .opacity(didSelectBirthday ? 1 : 0.42)
                }
            }
            .padding(.horizontal, 24)

            Spacer(minLength: 10)

            DatePicker(
                "Date of birth",
                selection: $birthdayPickerDate,
                in: Self.minimumDateOfBirth...Self.maximumDateOfBirth,
                displayedComponents: .date
            )
            .datePickerStyle(.wheel)
            .labelsHidden()
            .frame(maxWidth: .infinity, alignment: .center)
            .padding(.horizontal, 28)
            .onChange(of: birthdayPickerDate) { _, _ in
                guard isBirthdayPickerPresented else {
                    return
                }

                didSelectBirthday = true
            }

            Spacer(minLength: 14)
        }
        .padding(.top, 16)
        .padding(.bottom, 10)
        .presentationDetents([.height(330)])
        .presentationDragIndicator(.visible)
        .presentationBackground(.clear)
        .preferredColorScheme(.dark)
    }

    private var fieldBackground: some View {
        RoundedRectangle(cornerRadius: 14, style: .continuous)
            .fill(Color.white.opacity(0.065))
            .overlay(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .strokeBorder(.white.opacity(0.09), lineWidth: 1)
            )
    }

    private var submitButton: some View {
        Button {
            submit()
        } label: {
            HStack(spacing: 10) {
                if viewModel.isSubmitting {
                    ProgressView()
                        .tint(.black)
                }

                Text("Continue")
                    .font(.system(size: 16, weight: .semibold))
            }
            .foregroundStyle(canSubmit ? .black : .white.opacity(0.36))
            .frame(maxWidth: .infinity)
            .frame(height: 48)
            .background(
                RoundedRectangle(cornerRadius: 15, style: .continuous)
                    .fill(canSubmit ? AppTheme.accentBlue : Color.white.opacity(0.10))
            )
        }
        .buttonStyle(.plain)
        .disabled(!canSubmit)
        .padding(.top, 2)
    }

    private var signOutButton: some View {
        Button {
            Task {
                try? await clerk.auth.signOut(sessionId: clerk.session?.id)
            }
        } label: {
            Text("Sign out")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white.opacity(0.50))
                .frame(maxWidth: .infinity)
                .frame(height: 38)
        }
        .buttonStyle(.plain)
    }

    private func submit() {
        let normalizedFirstName = firstName.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedLastName = lastName.trimmingCharacters(in: .whitespacesAndNewlines)

        guard !normalizedFirstName.isEmpty, !normalizedLastName.isEmpty else {
            errorMessage = "Please enter your first and last name."
            return
        }

        guard Self.isValidUsername(normalizedUsername) else {
            errorMessage = "Username must be 3-20 characters and use only letters, numbers, or underscores."
            return
        }

        guard let gender else {
            errorMessage = "Please select your gender."
            return
        }

        let normalizedCity = city.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedState = state.trimmingCharacters(in: .whitespacesAndNewlines).uppercased()

        guard !normalizedCity.isEmpty, normalizedState.count == 2 else {
            errorMessage = "Please select your city."
            return
        }

        guard let dateOfBirth else {
            errorMessage = "Please select your birthday."
            return
        }

        let formattedDateOfBirth = Self.serverDateFormatter.string(from: dateOfBirth)
        errorMessage = nil

        Task {
            do {
                _ = try await viewModel.complete(
                    firstName: normalizedFirstName,
                    lastName: normalizedLastName,
                    username: normalizedUsername,
                    city: normalizedCity,
                    state: normalizedState,
                    gender: gender,
                    dateOfBirth: formattedDateOfBirth,
                    using: apiClient
                )
                onComplete()
            } catch {
                errorMessage = error.localizedDescription
            }
        }
    }

    private static func isValidUsername(_ value: String) -> Bool {
        value.range(of: #"^[a-zA-Z0-9_]{3,20}$"#, options: .regularExpression) != nil
    }

    private static func date(from value: String?) -> Date? {
        guard let value else {
            return nil
        }

        return serverDateFormatter.date(from: value)
    }

    private static let serverDateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        // A birthday is a calendar date, not a UTC instant. Parsing at UTC midnight
        // displays the previous day in time zones west of Greenwich.
        formatter.timeZone = .autoupdatingCurrent
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter
    }()

    private static let defaultDateOfBirth: Date = {
        Calendar(identifier: .gregorian).date(byAdding: .year, value: -24, to: .now) ?? .now
    }()

    private static let maximumDateOfBirth: Date = .now

    private static let minimumDateOfBirth: Date = {
        Calendar(identifier: .gregorian).date(from: DateComponents(year: 1900, month: 1, day: 1)) ?? .distantPast
    }()
}

@MainActor
private final class MobileOnboardingViewModel: ObservableObject {
    @Published private(set) var isSubmitting = false

    func complete(
        firstName: String,
        lastName: String,
        username: String,
        city: String,
        state: String,
        gender: UserGender,
        dateOfBirth: String,
        using apiClient: APIClient
    ) async throws -> MobileOnboardingState {
        guard !isSubmitting else {
            throw APIClient.APIError.invalidResponse
        }

        isSubmitting = true
        defer { isSubmitting = false }

        let endpoint = try APIClient.completeMobileOnboarding(
            firstName: firstName,
            lastName: lastName,
            username: username,
            city: city,
            state: state,
            gender: gender,
            dateOfBirth: dateOfBirth
        )
        return try await apiClient.send(endpoint)
    }
}

private extension UserGender {
    var onboardingLabel: String {
        switch self {
        case .male:
            return "Male"
        case .female:
            return "Female"
        case .other:
            return "Other"
        }
    }
}

private struct OnboardingTextInput: View {
    let placeholder: String
    @Binding var text: String
    let field: OnboardingInputField
    let focusedInput: FocusState<OnboardingInputField?>.Binding
    let contentType: UITextContentType?
    let capitalization: TextInputAutocapitalization?
    let keyboardType: UIKeyboardType
    let lowercasesInput: Bool

    init(
        _ placeholder: String,
        text: Binding<String>,
        field: OnboardingInputField,
        focusedInput: FocusState<OnboardingInputField?>.Binding,
        contentType: UITextContentType? = nil,
        capitalization: TextInputAutocapitalization? = .sentences,
        keyboardType: UIKeyboardType = .default,
        lowercasesInput: Bool = false
    ) {
        self.placeholder = placeholder
        _text = text
        self.field = field
        self.focusedInput = focusedInput
        self.contentType = contentType
        self.capitalization = capitalization
        self.keyboardType = keyboardType
        self.lowercasesInput = lowercasesInput
    }

    var body: some View {
        TextField(placeholder, text: $text)
            .textContentType(contentType)
            .textInputAutocapitalization(capitalization)
            .autocorrectionDisabled()
            .keyboardType(keyboardType)
            .submitLabel(.done)
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(.white)
            .tint(AppTheme.accentBlue)
            .padding(.horizontal, 14)
            .frame(maxWidth: .infinity)
            .frame(height: 48)
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Color.white.opacity(0.065))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .strokeBorder(.white.opacity(0.09), lineWidth: 1)
                    )
            )
            .contentShape(Rectangle())
            .focused(focusedInput, equals: field)
            .simultaneousGesture(
                TapGesture().onEnded {
                    focusedInput.wrappedValue = field
                }
            )
            .onChange(of: text) { _, value in
                guard lowercasesInput else {
                    return
                }

                let lowered = value.lowercased()
                if lowered != value {
                    text = lowered
                }
            }
    }
}

private extension View {
    @ViewBuilder
    func profileFormLiquidGlass<S: InsettableShape>(in shape: S) -> some View {
        if #available(iOS 26.1, *) {
            glassEffect(.regular.interactive(), in: shape)
        } else if #available(iOS 26.0, *) {
            glassEffect(.regular, in: shape)
        } else {
            background(.white.opacity(0.08), in: shape)
                .background(.ultraThinMaterial, in: shape)
        }
    }
}
