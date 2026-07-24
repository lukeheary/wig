import SwiftUI

struct ManagePlaceView: View {
    let placeSlug: String
    let placeName: String
    let placeDetail: PlaceDetail
    var onPlaceDeleted: (() -> Void)? = nil

    @Environment(\.apiClient) private var apiClient
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel = ManagePlaceViewModel()
    @State private var isEditPlaceActive = false
    @State private var isAddMemberSheetPresented = false
    @State private var editingMember: PlaceMemberListItem?
    @State private var editingSeries: PlaceEventSeriesSummary?
    @State private var creationDestination: CreationDestination?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 28) {
                placeEditHeaderRow
                membersSection
                eventSeriesSection
            }
            .padding(.horizontal, 20)
            .padding(.top, 84)
            .padding(.bottom, 44)
        }
        .background(AppTheme.background.ignoresSafeArea())
        .navigationBarBackButtonHidden()
        .toolbar(.hidden, for: .navigationBar)
        .overlay(alignment: .topLeading) {
            topNav
        }
        .navigationDestination(isPresented: $isEditPlaceActive) {
            MobilePlaceCreationView(
                mode: .edit(placeDetail),
                onCompleted: {
                    isEditPlaceActive = false
                },
                onDeleted: {
                    isEditPlaceActive = false
                    dismiss()
                    onPlaceDeleted?()
                }
            )
        }
        .task { await viewModel.load(slug: placeSlug, using: apiClient) }
        .refreshable { await viewModel.load(slug: placeSlug, using: apiClient, forceRefresh: true) }
        .sheet(isPresented: $isAddMemberSheetPresented) {
            AddUserToPlaceView(placeSlug: placeSlug) {
                Task { await viewModel.load(slug: placeSlug, using: apiClient, forceRefresh: true) }
            }
        }
        .sheet(item: $editingMember) { member in
            EditMemberRoleView(placeSlug: placeSlug, member: member) {
                Task { await viewModel.load(slug: placeSlug, using: apiClient, forceRefresh: true) }
            }
            .presentationDetents([.medium])
        }
        .sheet(item: $editingSeries) { series in
            EventSeriesEditSheet(seriesID: series.id) {
                Task { await viewModel.load(slug: placeSlug, using: apiClient, forceRefresh: true) }
            }
        }
        .sheet(item: $creationDestination) { destination in
            switch destination {
            case .event:
                MobileEventCreationView(
                    mode: .create,
                    preselectedPlace: placeDetail,
                    onCompleted: { _ in
                        Task { await viewModel.load(slug: placeSlug, using: apiClient, forceRefresh: true) }
                    }
                )
            case .series:
                MobileEventCreationView(
                    mode: .create,
                    creationKind: .eventSeries,
                    preselectedPlace: placeDetail,
                    onSeriesCompleted: {
                        Task { await viewModel.load(slug: placeSlug, using: apiClient, forceRefresh: true) }
                    }
                )
            }
        }
    }

    // MARK: - Top nav

    private var topNav: some View {
        ZStack {
            HStack {
                FloatingGlassIconButton(systemImage: "chevron.left") { dismiss() }

                Spacer()

                creationMenu
            }
            .frame(maxWidth: .infinity)

            Text("Manage Place")
                .font(.system(size: 17, weight: .bold))
                .foregroundStyle(.white)
                .lineLimit(1)
                .minimumScaleFactor(0.72)
                .allowsHitTesting(false)
                .accessibilityAddTraits(.isHeader)
        }
        .padding(.horizontal, 16)
    }

    private var creationMenu: some View {
        Menu {
            Button {
                creationDestination = .event
            } label: {
                Label {
                    Text("Add Event")
                } icon: {
                    Image(systemName: "calendar.badge.plus")
                        .symbolRenderingMode(.monochrome)
                        .foregroundStyle(.white)
                }
            }

            Button {
                creationDestination = .series
            } label: {
                Label {
                    Text("Add Event Series")
                } icon: {
                    Image(systemName: "calendar.badge.clock")
                        .symbolRenderingMode(.monochrome)
                        .foregroundStyle(.white)
                }
            }
        } label: {
            Image(systemName: "plus")
                .font(.system(size: 19, weight: .semibold))
                .foregroundStyle(.white)
                .frame(width: 46, height: 46)
                .background(.white.opacity(0.10), in: Circle())
                .overlay(Circle().strokeBorder(.white.opacity(0.12), lineWidth: 1))
        }
        .buttonStyle(.plain)
        .tint(.white)
        .accessibilityLabel("Add event")
    }

    // MARK: - Place edit header

    private var placeEditHeaderRow: some View {
        Button { isEditPlaceActive = true } label: {
            HStack(spacing: 12) {
                placeImageWithBadge
                    .frame(width: 64, height: 64)

                VStack(alignment: .leading, spacing: 5) {
                    Text(placeName)
                        .font(.system(size: 17, weight: .bold))
                        .foregroundStyle(.white)
                        .lineLimit(2)
                        .multilineTextAlignment(.leading)

                    Text("Edit place profile")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(.white.opacity(0.45))
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.25))
            }
            .padding(12)
            .background(.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 18, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .strokeBorder(.white.opacity(0.07), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private var placeImageWithBadge: some View {
        ZStack(alignment: .bottomTrailing) {
            if let url = placeDetail.displayLogoURL {
                RemoteImageView(url: url) { image in
                    image.resizable().scaledToFill()
                } placeholder: {
                    logoPlaceholder
                }
                .frame(width: 64, height: 64)
                .clipShape(RoundedRectangle(cornerRadius: 18, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .strokeBorder(.white.opacity(0.08), lineWidth: 1)
                )
            } else {
                logoPlaceholder
                    .frame(width: 64, height: 64)
                    .overlay(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .strokeBorder(.white.opacity(0.08), lineWidth: 1)
                    )
            }

            // Camera badge
            ZStack {
                Circle()
                    .fill(Color(red: 0.10, green: 0.10, blue: 0.12))
                    .frame(width: 24, height: 24)

                Circle()
                    .fill(.white.opacity(0.12))
                    .frame(width: 22, height: 22)

                Image(systemName: "camera.fill")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.85))
            }
            .offset(x: 4, y: 4)
        }
    }

    private var logoPlaceholder: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color(red: 0.14, green: 0.14, blue: 0.16))

            Image(systemName: placeDetail.type == .venue ? "building.2" : "sparkles")
                .font(.system(size: 30, weight: .semibold))
                .foregroundStyle(.white.opacity(0.70))
        }
    }

    // MARK: - Members

    private var membersSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionLabel("Members")

            switch viewModel.membersState {
            case .loading:
                loadingCard
            case .failed:
                errorCard("Couldn't load members")
            case .loaded(let members):
                VStack(spacing: 2) {
                    if members.isEmpty {
                        emptyRow("No members yet")
                    } else {
                        ForEach(members) { member in
                            memberRow(member)
                        }
                    }
                }

                addMemberButton
            }
        }
    }

    private func memberRow(_ member: PlaceMemberListItem) -> some View {
        Button { editingMember = member } label: {
            UserListRowView(
                imageURL: member.avatarImageURL,
                name: member.name,
                subtitle: member.usernameText,
                identityKey: member.id,
                avatarSize: 42,
                verticalPadding: 5,
                nameFontSize: 14,
                subtitleFontSize: 10
            ) {
                HStack(spacing: 6) {
                    Text(member.role.displayName)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(.white.opacity(0.65))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(.white.opacity(0.1), in: Capsule())

                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.2))
                }
            }
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    private var addMemberButton: some View {
        Button { isAddMemberSheetPresented = true } label: {
            Text("Add Member")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(.black)
                .frame(maxWidth: .infinity)
                .frame(height: 40)
                .background(AppTheme.accentBlue, in: RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
    }

    // MARK: - Event Series

    private var eventSeriesSection: some View {
        VStack(alignment: .leading, spacing: 12) {
            sectionLabel("Recurring Events")

            switch viewModel.seriesState {
            case .loading:
                loadingCard
            case .failed:
                errorCard("Couldn't load recurring events")
            case .loaded(let series):
                if series.isEmpty {
                    emptyStateCard("No recurring events yet")
                } else {
                    VStack(spacing: 2) {
                        ForEach(series) { item in
                            seriesRow(item)
                        }
                    }
                }
            }
        }
    }

    private func seriesRow(_ item: PlaceEventSeriesSummary) -> some View {
        Button { editingSeries = item } label: {
            HStack(spacing: 14) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .fill(Color.white.opacity(0.07))
                        .frame(width: 40, height: 40)
                    Image(systemName: "repeat")
                        .font(.system(size: 15, weight: .medium))
                        .foregroundStyle(.white.opacity(0.65))
                }

                VStack(alignment: .leading, spacing: 3) {
                    Text(item.title)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.white)
                    Text(item.recurrenceLabel)
                        .font(.system(size: 13))
                        .foregroundStyle(.white.opacity(0.45))
                }

                Spacer()

                Image(systemName: "chevron.right")
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(.white.opacity(0.2))
            }
            .padding(.vertical, 6)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: - Shared components

    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 20, weight: .bold))
            .foregroundStyle(.white)
    }

    @ViewBuilder
    private func groupContainer<Content: View>(@ViewBuilder content: () -> Content) -> some View {
        VStack(spacing: 0) {
            content()
        }
        .clipShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .strokeBorder(.white.opacity(0.07), lineWidth: 1)
        )
    }

    private enum CreationDestination: String, Identifiable {
        case event
        case series

        var id: String { rawValue }
    }

    private var rowDivider: some View {
        Rectangle()
            .fill(Color.white.opacity(0.05))
            .frame(height: 1)
            .padding(.leading, 72)
    }

    private func emptyRow(_ text: String) -> some View {
        HStack {
            Text(text)
                .font(.system(size: 14))
                .foregroundStyle(.white.opacity(0.35))
            Spacer()
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 14)
        .background(Color.white.opacity(0.04))
    }

    private var loadingCard: some View {
        HStack {
            Spacer()
            ProgressView()
            Spacer()
        }
        .padding(32)
        .background(.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func errorCard(_ message: String) -> some View {
        Text(message)
            .font(.system(size: 14))
            .foregroundStyle(.white.opacity(0.35))
            .frame(maxWidth: .infinity)
            .padding(24)
            .background(.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func emptyStateCard(_ message: String) -> some View {
        Text(message)
            .font(.system(size: 14))
            .foregroundStyle(.white.opacity(0.35))
            .frame(maxWidth: .infinity)
            .padding(24)
            .background(.white.opacity(0.04), in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }
}

// MARK: - Edit Member Role Sheet

struct EditMemberRoleView: View {
    let placeSlug: String
    let member: PlaceMemberListItem
    var onSaved: (() -> Void)? = nil

    @Environment(\.apiClient) private var apiClient
    @Environment(\.dismiss) private var dismiss
    @State private var selectedRole: PlaceMemberRole
    @State private var isSubmitting = false
    @State private var showError = false
    @State private var isRemoveConfirmationPresented = false
    @State private var isRemoving = false
    @State private var showRemoveError = false

    init(placeSlug: String, member: PlaceMemberListItem, onSaved: (() -> Void)? = nil) {
        self.placeSlug = placeSlug
        self.member = member
        self.onSaved = onSaved
        _selectedRole = State(initialValue: member.role)
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                HStack(spacing: 14) {
                    RemoteImageView(url: member.avatarImageURL) { image in
                        image.resizable().scaledToFill()
                    } placeholder: {
                        Circle().fill(Color.white.opacity(0.1))
                    }
                    .frame(width: 48, height: 48)
                    .clipShape(Circle())

                    VStack(alignment: .leading, spacing: 2) {
                        Text(member.name)
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(.white)
                        Text(member.usernameText)
                            .font(.system(size: 14))
                            .foregroundStyle(.white.opacity(0.5))
                    }
                    Spacer()
                }
                .padding(.horizontal, 20)
                .padding(.top, 24)
                .padding(.bottom, 28)

                Divider().overlay(Color.white.opacity(0.08))

                VStack(alignment: .leading, spacing: 14) {
                    Text("ROLE")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.45))
                        .tracking(1.2)
                        .padding(.horizontal, 20)
                        .padding(.top, 20)

                    Picker("Role", selection: $selectedRole) {
                        ForEach(PlaceMemberRole.allCases, id: \.self) { role in
                            Text(role.displayName).tag(role)
                        }
                    }
                    .pickerStyle(.segmented)
                    .padding(.horizontal, 20)
                }

                Spacer()

                Divider().overlay(Color.white.opacity(0.08))

                Button(role: .destructive) {
                    isRemoveConfirmationPresented = true
                } label: {
                    Text("Remove Member")
                        .font(.system(size: 15, weight: .semibold))
                        .frame(maxWidth: .infinity)
                        .frame(height: 48)
                }
                .disabled(isSubmitting || isRemoving)
            }
            .background(AppTheme.background.ignoresSafeArea())
            .navigationTitle("Edit Role")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") { dismiss() }
                        .foregroundStyle(.white.opacity(0.7))
                }
                ToolbarItem(placement: .confirmationAction) {
                    if isSubmitting {
                        ProgressView()
                    } else {
                        Button("Save") { Task { await save() } }
                            .fontWeight(.semibold)
                            .disabled(selectedRole == member.role || isRemoving)
                    }
                }
            }
            .alert("Couldn't Update Role", isPresented: $showError) {
                Button("OK") {}
            }
            .alert("Remove \(member.name)?", isPresented: $isRemoveConfirmationPresented) {
                Button("Remove", role: .destructive) {
                    Task { await remove() }
                }
                Button("Cancel", role: .cancel) {}
            } message: {
                Text("This person will no longer be able to manage this place.")
            }
            .alert("Couldn't Remove Member", isPresented: $showRemoveError) {
                Button("OK") {}
            }
        }
    }

    private func save() async {
        isSubmitting = true
        defer { isSubmitting = false }
        do {
            let endpoint = try APIClient.mobileAddUserToPlace(
                slug: placeSlug,
                userId: member.id,
                role: selectedRole
            )
            _ = try await apiClient.send(endpoint)
            onSaved?()
            dismiss()
        } catch {
            showError = true
        }
    }

    private func remove() async {
        isRemoving = true
        defer { isRemoving = false }

        do {
            let endpoint = APIClient.mobileRemoveUserFromPlace(
                slug: placeSlug,
                userId: member.id
            )
            _ = try await apiClient.send(endpoint)
            onSaved?()
            dismiss()
        } catch {
            showRemoveError = true
        }
    }
}

// MARK: - View Model

@MainActor
final class ManagePlaceViewModel: ObservableObject {
    enum LoadState<T> {
        case loading, loaded(T), failed
    }

    @Published var membersState: LoadState<[PlaceMemberListItem]> = .loading
    @Published var seriesState: LoadState<[PlaceEventSeriesSummary]> = .loading

    func load(slug: String, using apiClient: APIClient, forceRefresh: Bool = false) async {
        if !forceRefresh {
            membersState = .loading
            seriesState = .loading
        }

        await withTaskGroup(of: Void.self) { group in
            group.addTask { await self.loadMembers(slug: slug, using: apiClient) }
            group.addTask { await self.loadSeries(slug: slug, using: apiClient) }
        }
    }

    private func loadMembers(slug: String, using apiClient: APIClient) async {
        do {
            let response = try await apiClient.send(APIClient.mobilePlaceMembers(slug: slug))
            membersState = .loaded(response.members)
        } catch {
            membersState = .failed
        }
    }

    private func loadSeries(slug: String, using apiClient: APIClient) async {
        do {
            let response = try await apiClient.send(APIClient.mobilePlaceEventSeries(slug: slug))
            seriesState = .loaded(response.series)
        } catch {
            seriesState = .failed
        }
    }
}
