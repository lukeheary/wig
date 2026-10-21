import Foundation

/// Local history is scoped to the authenticated account. Signed-out sessions
/// neither read nor write account history. Unowned legacy history is not migrated.
enum AccountSearchHistory {
    static func history(accountID: String?, storedHistories: String) -> String {
        guard let accountID, !accountID.isEmpty else { return "[]" }
        return decode(storedHistories)[accountID] ?? "[]"
    }

    static func updating(accountID: String?, history: String, storedHistories: String) -> String {
        guard let accountID, !accountID.isEmpty else { return storedHistories }
        var histories = decode(storedHistories)
        histories[accountID] = history
        guard let data = try? JSONEncoder().encode(histories),
              let encoded = String(data: data, encoding: .utf8) else {
            return storedHistories
        }
        return encoded
    }

    private static func decode(_ storedHistories: String) -> [String: String] {
        (try? JSONDecoder().decode([String: String].self, from: Data(storedHistories.utf8))) ?? [:]
    }
}
