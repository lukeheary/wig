import Foundation

extension String {
    func capitalizingRelativeAgo() -> String {
        guard hasSuffix(" ago") else {
            return self
        }

        return String(dropLast(4)) + " Ago"
    }
}

// Keep these rules aligned with formatNotificationEventDatePhrase on the server.
enum ActivityEventDateFormatting {
    static func phrase(startAt: Date, timeZone: TimeZone, now: Date = .now) -> String {
        var calendar = Calendar(identifier: .gregorian)
        calendar.timeZone = timeZone
        let today = calendar.startOfDay(for: now)
        let eventDay = calendar.startOfDay(for: startAt)
        let daysAway = calendar.dateComponents([.day], from: today, to: eventDay).day ?? 0
        let isEvening = calendar.component(.hour, from: startAt) >= 17
        switch daysAway {
        case 0:
            return isEvening ? "tonight" : "today"
        case 1:
            return isEvening ? "tomorrow night" : "tomorrow"
        default:
            let formatter = DateFormatter()
            formatter.locale = Locale(identifier: "en_US_POSIX")
            formatter.calendar = calendar
            formatter.timeZone = timeZone
            if (2...6).contains(daysAway) {
                formatter.dateFormat = "EEEE"
                return "this \(formatter.string(from: startAt))"
            }
            formatter.dateFormat = "MMM d"
            return "on \(formatter.string(from: startAt))"
        }
    }
}
