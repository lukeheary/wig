import SwiftUI

struct ActivityView: View {
    var body: some View {
        NavigationStack {
            ScreenPlaceholderView(
                title: "Activity",
                systemImage: "bolt",
                message: "Friend activity, event updates, and notifications will live here."
            )
        }
    }
}

#Preview {
    ActivityView()
}
