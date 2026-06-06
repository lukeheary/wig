import Foundation

struct AppConfig {
    static let shared = AppConfig()

    let clerkPublishableKey: String
    let clerkFrontendAPI: String
    let apiBaseURL: URL
    let clerkJWTTemplate: String?
    let oauthCallbackScheme: String

    private init(bundle: Bundle = .main) {
        let environment = ProcessInfo.processInfo.environment

        clerkPublishableKey = bundle.requiredString(
            for: "CLERK_PUBLISHABLE_KEY",
            environment: environment
        )
        clerkFrontendAPI = bundle.requiredString(
            for: "CLERK_FRONTEND_API",
            environment: environment
        )
        apiBaseURL = bundle.requiredURL(
            for: "API_BASE_URL",
            environment: environment
        )
        clerkJWTTemplate = bundle.optionalString(
            for: "CLERK_JWT_TEMPLATE",
            environment: environment
        )
        oauthCallbackScheme = bundle.optionalString(
            for: "OAUTH_CALLBACK_SCHEME",
            environment: environment
        )
            ?? bundle.bundleIdentifier
            ?? "com.whoisgoing.app"
    }
}

private extension Bundle {
    func requiredString(
        for key: String,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> String {
        guard let value = optionalString(for: key, environment: environment) else {
            assertionFailure("Missing required Info.plist value for \(key).")
            return "MISSING_\(key)"
        }

        return value
    }

    func optionalString(
        for key: String,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> String? {
        if let value = environment[key]?.trimmingCharacters(in: .whitespacesAndNewlines),
           !value.isEmpty
        {
            return value
        }

        guard let value = object(forInfoDictionaryKey: key) as? String, !value.isEmpty else {
            return nil
        }

        return value
    }

    func requiredURL(
        for key: String,
        environment: [String: String] = ProcessInfo.processInfo.environment
    ) -> URL {
        let value = requiredString(for: key, environment: environment)
            .replacingOccurrences(of: ":/$()/", with: "://")

        guard let url = URL(string: value), url.scheme != nil, url.host != nil else {
            assertionFailure("Invalid URL value for \(key).")
            return URL(string: "https://invalid.local")!
        }

        return url
    }
}
