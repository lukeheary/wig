import Foundation

extension String {
    func capitalizingRelativeAgo() -> String {
        guard hasSuffix(" ago") else {
            return self
        }

        return String(dropLast(4)) + " Ago"
    }
}
