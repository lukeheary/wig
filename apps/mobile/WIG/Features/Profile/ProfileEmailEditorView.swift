import ClerkKit
import SwiftUI

struct ProfileEmailEditorView: View {
    @Environment(Clerk.self) private var clerk
    @Environment(\.dismiss) private var dismiss
    @StateObject private var viewModel = ProfileEmailEditorViewModel()
    @FocusState private var focusedField: Field?
    @State private var emailPendingRemoval: EmailAddress?

    private enum Field { case email, code }

    var body: some View {
        NavigationStack {
            Group {
                switch viewModel.step {
                case .manage: emailList
                case .add: addEmail
                case .verify(let emailAddress): codeVerification(for: emailAddress)
                }
            }
            .background(AppTheme.background.ignoresSafeArea())
            .navigationTitle(viewModel.step.title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(viewModel.step == .manage ? "Done" : "Back") {
                        viewModel.step == .manage ? dismiss() : viewModel.showEmailList()
                    }
                    .foregroundStyle(.white)
                }
            }
            .onChange(of: viewModel.step) { _, step in
                focusedField = switch step {
                case .add: .email
                case .verify: .code
                case .manage: nil
                }
            }
            .confirmationDialog(
                "Remove \(emailPendingRemoval?.emailAddress ?? "this email address")?",
                isPresented: Binding(
                    get: { emailPendingRemoval != nil },
                    set: { if !$0 { emailPendingRemoval = nil } }
                ),
                titleVisibility: .visible
            ) {
                Button("Remove email", role: .destructive) {
                    guard let emailAddress = emailPendingRemoval else { return }
                    emailPendingRemoval = nil
                    Task { await viewModel.remove(emailAddress, using: clerk) }
                }
                Button("Cancel", role: .cancel) { emailPendingRemoval = nil }
            } message: {
                Text("You will no longer be able to sign in with this address.")
            }
        }
        .preferredColorScheme(.dark)
        .presentationBackground(AppTheme.background)
    }

    private var emailList: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 20) {
                VStack(alignment: .leading, spacing: 8) {
                    Text("Email addresses")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.78))

                    VStack(spacing: 0) {
                        ForEach(sortedEmails) { emailAddress in
                            emailRow(emailAddress)
                            if emailAddress.id != sortedEmails.last?.id {
                                Divider().overlay(.white.opacity(0.08)).padding(.leading, 48)
                            }
                        }
                    }
                    .background(RoundedRectangle(cornerRadius: 16).fill(Color.white.opacity(0.065)))
                    .overlay(RoundedRectangle(cornerRadius: 16).strokeBorder(.white.opacity(0.09)))
                }

                Button { viewModel.showAddEmail() } label: {
                    Label("Add email address", systemImage: "plus")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(.white)
                        .frame(maxWidth: .infinity)
                        .frame(height: 48)
                        .background(Color.white.opacity(0.10), in: RoundedRectangle(cornerRadius: 15))
                }
                .buttonStyle(.plain)
                .disabled(viewModel.isWorking)

                statusMessage
            }
            .padding(24)
        }
        .scrollIndicators(.hidden)
    }

    private func emailRow(_ emailAddress: EmailAddress) -> some View {
        let isPrimary = clerk.user?.primaryEmailAddressId == emailAddress.id
        let isVerified = emailAddress.verification?.status == .verified

        return HStack(spacing: 12) {
            Image(systemName: isPrimary ? "checkmark.circle.fill" : "envelope")
                .font(.system(size: 18, weight: .semibold))
                .foregroundStyle(isPrimary ? AppTheme.accentBlue : .white.opacity(0.48))
                .frame(width: 24)

            VStack(alignment: .leading, spacing: 3) {
                Text(emailAddress.emailAddress)
                    .font(.system(size: 15, weight: .medium))
                    .foregroundStyle(.white)
                    .lineLimit(1)
                Text(emailStatus(isPrimary: isPrimary, isVerified: isVerified, isLinked: emailAddress.linkedTo?.isEmpty == false))
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(isVerified ? .white.opacity(0.46) : .orange.opacity(0.90))
            }

            Spacer(minLength: 8)

            if viewModel.isWorking, viewModel.workingEmailID == emailAddress.id {
                ProgressView().tint(.white)
            } else if !isPrimary || !isVerified {
                Menu {
                    if !isPrimary, isVerified {
                        Button { Task { await viewModel.makePrimary(emailAddress, using: clerk) } } label: {
                            Label("Make primary", systemImage: "checkmark.circle")
                        }
                    }
                    if !isVerified {
                        Button { Task { await viewModel.verify(emailAddress) } } label: {
                            Label("Verify email", systemImage: "envelope.badge")
                        }
                    }
                    if !isPrimary {
                        Button(role: .destructive) { emailPendingRemoval = emailAddress } label: {
                            Label {
                                Text("Remove email")
                            } icon: {
                                Image(systemName: "trash")
                                    .foregroundStyle(.red)
                            }
                        }
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.62))
                        .frame(width: 36, height: 36)
                        .contentShape(Rectangle())
                }
            }
        }
        .padding(.horizontal, 14)
        .frame(minHeight: 64)
    }

    private var addEmail: some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("We’ll send a verification code before adding this address to your account.")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(.white.opacity(0.66))
                .fixedSize(horizontal: false, vertical: true)
            TextField("you@example.com", text: $viewModel.email)
                .textContentType(.emailAddress)
                .textInputAutocapitalization(.never)
                .autocorrectionDisabled()
                .keyboardType(.emailAddress)
                .submitLabel(.continue)
                .focused($focusedField, equals: .email)
                .onSubmit(startEmailChange)
                .profileEmailFieldStyle()
            statusMessage
            primaryButton("Continue", disabled: !viewModel.canSubmitEmail, action: startEmailChange)
            Spacer()
        }
        .padding(24)
        .task { focusedField = .email }
    }

    private func codeVerification(for emailAddress: EmailAddress) -> some View {
        VStack(alignment: .leading, spacing: 20) {
            Text("Enter the verification code sent to \(emailAddress.emailAddress). After verification, you can make it your primary email.")
                .font(.system(size: 15, weight: .medium))
                .foregroundStyle(.white.opacity(0.66))
                .fixedSize(horizontal: false, vertical: true)
            TextField("Verification code", text: $viewModel.code)
                .textContentType(.oneTimeCode)
                .keyboardType(.numberPad)
                .focused($focusedField, equals: .code)
                .profileEmailFieldStyle()
            statusMessage
            primaryButton("Verify email", disabled: !viewModel.canSubmitCode) {
                Task { await viewModel.verifyCode(using: clerk) }
            }
            Button("Resend code") { Task { await viewModel.resendCode() } }
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(.white.opacity(0.72))
                .frame(maxWidth: .infinity)
                .disabled(viewModel.isWorking)
            Spacer()
        }
        .padding(24)
    }

    @ViewBuilder private var statusMessage: some View {
        if let message = viewModel.errorMessage {
            Text(message)
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(.red.opacity(0.92))
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func primaryButton(_ title: String, disabled: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                if viewModel.isWorking { ProgressView().tint(.black) }
                Text(title).font(.system(size: 16, weight: .semibold))
            }
            .foregroundStyle(.black)
            .frame(maxWidth: .infinity)
            .frame(height: 48)
            .background(Color.white, in: RoundedRectangle(cornerRadius: 15))
        }
        .buttonStyle(.plain)
        .disabled(disabled || viewModel.isWorking)
        .opacity(disabled || viewModel.isWorking ? 0.42 : 1)
    }

    private var sortedEmails: [EmailAddress] {
        (clerk.user?.emailAddresses ?? []).sorted { lhs, rhs in
            if lhs.id == clerk.user?.primaryEmailAddressId { return true }
            if rhs.id == clerk.user?.primaryEmailAddressId { return false }
            return lhs.createdAt < rhs.createdAt
        }
    }

    private func emailStatus(isPrimary: Bool, isVerified: Bool, isLinked: Bool) -> String {
        var labels = [String]()
        if isPrimary { labels.append("Primary") }
        labels.append(isVerified ? "Verified" : "Unverified")
        if isLinked { labels.append("Linked") }
        return labels.joined(separator: " · ")
    }

    private func startEmailChange() {
        focusedField = nil
        Task { await viewModel.startEmailChange(using: clerk) }
    }
}

@MainActor
private final class ProfileEmailEditorViewModel: ObservableObject {
    enum Step: Equatable {
        case manage, add, verify(EmailAddress)

        var title: String {
            switch self {
            case .manage: "Manage Emails"
            case .add: "Add Email"
            case .verify: "Verify Email"
            }
        }
    }

    @Published var email = ""
    @Published var code = ""
    @Published private(set) var step: Step = .manage
    @Published private(set) var isWorking = false
    @Published private(set) var workingEmailID: String?
    @Published private(set) var errorMessage: String?

    var canSubmitEmail: Bool {
        let candidate = normalizedEmail
        return candidate.contains("@") && candidate.contains(".")
    }
    var canSubmitCode: Bool { !code.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

    func showEmailList() {
        step = .manage
        email = ""
        code = ""
        errorMessage = nil
    }

    func showAddEmail() {
        step = .add
        errorMessage = nil
    }

    func startEmailChange(using clerk: Clerk) async {
        guard !isWorking, canSubmitEmail, let user = clerk.user else { return }

        if let existingEmail = user.emailAddresses.first(where: {
            $0.emailAddress.caseInsensitiveCompare(normalizedEmail) == .orderedSame
        }) {
            if existingEmail.verification?.status == .verified {
                await makePrimary(existingEmail, using: clerk)
                if errorMessage == nil { showEmailList() }
            } else {
                await verify(existingEmail)
            }
            return
        }

        isWorking = true
        errorMessage = nil
        defer { isWorking = false }
        do {
            let emailAddress = try await user.createEmailAddress(normalizedEmail)
            _ = try await emailAddress.sendCode()
            code = ""
            step = .verify(emailAddress)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func verify(_ emailAddress: EmailAddress) async {
        beginWork(for: emailAddress.id)
        defer { endWork() }
        do {
            _ = try await emailAddress.sendCode()
            code = ""
            step = .verify(emailAddress)
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func verifyCode(using clerk: Clerk) async {
        guard !isWorking, case .verify(let emailAddress) = step else { return }
        beginWork(for: emailAddress.id)
        defer { endWork() }
        do {
            _ = try await emailAddress.verifyCode(code.trimmingCharacters(in: .whitespacesAndNewlines))
            _ = try await clerk.refreshClient()
            showEmailList()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func resendCode() async {
        guard !isWorking, case .verify(let emailAddress) = step else { return }
        await verify(emailAddress)
    }

    func makePrimary(_ emailAddress: EmailAddress, using clerk: Clerk) async {
        guard !isWorking, let user = clerk.user else { return }
        beginWork(for: emailAddress.id)
        defer { endWork() }
        do {
            _ = try await user.update(.init(primaryEmailAddressId: emailAddress.id))
            _ = try await clerk.refreshClient()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func remove(_ emailAddress: EmailAddress, using clerk: Clerk) async {
        guard !isWorking, emailAddress.id != clerk.user?.primaryEmailAddressId else { return }
        beginWork(for: emailAddress.id)
        defer { endWork() }
        do {
            _ = try await emailAddress.destroy()
            _ = try await clerk.refreshClient()
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    private func beginWork(for emailID: String) {
        isWorking = true
        workingEmailID = emailID
        errorMessage = nil
    }

    private func endWork() {
        isWorking = false
        workingEmailID = nil
    }

    private var normalizedEmail: String {
        email.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
    }
}

private extension View {
    func profileEmailFieldStyle() -> some View {
        self
            .font(.system(size: 15, weight: .medium))
            .foregroundStyle(.white)
            .padding(.horizontal, 16)
            .frame(height: 48)
            .background(
                RoundedRectangle(cornerRadius: 14)
                    .fill(Color.white.opacity(0.065))
                    .overlay(RoundedRectangle(cornerRadius: 14).strokeBorder(.white.opacity(0.09)))
            )
    }
}
