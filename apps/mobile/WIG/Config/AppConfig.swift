import Foundation

struct AppConfig {
    static let shared = AppConfig()

    let clerkPublishableKey: String
    let clerkFrontendAPI: String
    let apiBaseURL: URL
    let clerkJWTTemplate: String?
    let oauthCallbackScheme: String

    private init(bundle: Bundle = .main) {
        clerkPublishableKey = bundle.requiredString(for: "CLERK_PUBLISHABLE_KEY")
        clerkFrontendAPI = bundle.requiredString(for: "CLERK_FRONTEND_API")
        apiBaseURL = bundle.requiredURL(for: "API_BASE_URL")
        clerkJWTTemplate = bundle.optionalString(for: "CLERK_JWT_TEMPLATE")
        oauthCallbackScheme = bundle.optionalString(for: "OAUTH_CALLBACK_SCHEME")
            ?? bundle.bundleIdentifier
            ?? "com.wig.app"
    }
}

private extension Bundle {
    func requiredString(for key: String) -> String {
        guard let value = object(forInfoDictionaryKey: key) as? String, !value.isEmpty else {
            assertionFailure("Missing required Info.plist value for \(key).")
            return "MISSING_\(key)"
        }

        return value
    }

    func optionalString(for key: String) -> String? {
        guard let value = object(forInfoDictionaryKey: key) as? String, !value.isEmpty else {
            return nil
        }

        return value
    }

    func requiredURL(for key: String) -> URL {
        guard let url = URL(string: requiredString(for: key)) else {
            assertionFailure("Invalid URL value for \(key).")
            return URL(string: "https://invalid.local")!
        }

        return url
    }
}
