import SwiftUI

struct MainTabView: View {
    var body: some View {
        TabView {
            HomeView()
                .tabItem {
                    Label("Home", systemImage: "house")
                }

            VenuesView()
                .tabItem {
                    Label("Venues", systemImage: "building.2")
                }

            ActivityView()
                .tabItem {
                    Label("Activity", systemImage: "bolt")
                }

            ProfileView()
                .tabItem {
                    Label("Profile", systemImage: "person.crop.circle")
                }
        }
    }
}

#Preview {
    MainTabView()
}
