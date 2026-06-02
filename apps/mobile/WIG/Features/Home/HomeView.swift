import SwiftUI

struct HomeView: View {
    @Environment(\.apiClient) private var apiClient
    @StateObject private var viewModel = EventFeedViewModel()
    @State private var selectedWeekStart = Self.startOfWeek(for: .now)

    private static let sectionTitleFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateFormat = "EEE, MMM d"
        return formatter
    }()
    private static var weekCalendar: Calendar = {
        var calendar = Calendar(identifier: .gregorian)
        calendar.firstWeekday = 2
        return calendar
    }()

    private let eventCardWidth: CGFloat = 192

    var body: some View {
        NavigationStack {
            content
                .background(feedBackground)
                .toolbar(.hidden, for: .navigationBar)
                .task {
                    if case .idle = viewModel.state {
                        await viewModel.load(using: apiClient)
                    }
                }
                .refreshable {
                    await viewModel.load(using: apiClient)
                }
        }
    }

    @ViewBuilder
    private var content: some View {
        switch viewModel.state {
        case .idle, .loading:
            ProgressView("Loading events...")
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .tint(.white)
                .foregroundStyle(.white)
                .background(feedBackground)

        case .failed(let message):
            ContentUnavailableView {
                Label("Couldn’t Load Events", systemImage: "wifi.exclamationmark")
            } description: {
                Text(message)
            } actions: {
                Button("Try Again") {
                    Task {
                        await viewModel.load(using: apiClient)
                    }
                }
            }
            .background(feedBackground)

        case .loaded(let events):
            if events.isEmpty {
                ContentUnavailableView {
                    Label("No Upcoming Events", systemImage: "calendar")
                } description: {
                    Text("The mobile feed is connected, but there are no public upcoming events right now.")
                }
                .background(feedBackground)
            } else {
                ZStack(alignment: .topTrailing) {
                    if groupedEvents.isEmpty {
                        ContentUnavailableView {
                            Label("No Events This Week", systemImage: "calendar")
                        } description: {
                            Text("Use the arrow to browse upcoming weeks.")
                        }
                        .foregroundStyle(.white)
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                    } else {
                        ScrollView {
                            LazyVStack(alignment: .leading, spacing: 24) {
                                ForEach(groupedEvents, id: \.day) { section in
                                    VStack(alignment: .leading, spacing: 14) {
                                        Text(section.title)
                                            .font(.system(size: 22, weight: .bold, design: .rounded))
                                            .foregroundStyle(.white)
                                            .padding(.horizontal, 16)

                                        ScrollView(.horizontal) {
                                            LazyHStack(alignment: .top, spacing: 12) {
                                                ForEach(section.events) { event in
                                                    NavigationLink {
                                                        EventDetailView(event: event)
                                                    } label: {
                                                        EventCardView(event: event)
                                                            .frame(width: eventCardWidth)
                                                    }
                                                    .buttonStyle(.plain)
                                                }
                                            }
                                            .padding(.horizontal, 16)
                                        }
                                        .scrollIndicators(.hidden)
                                    }
                                }
                            }
                            .padding(.top, 18)
                            .padding(.bottom, 96)
                        }
                        .scrollIndicators(.hidden)
                    }

                    weekControls
                }
                .background(feedBackground)
            }
        }
    }

    private var weekControls: some View {
        HStack(spacing: 10) {
            Spacer()

            if isViewingFutureWeek {
                WeekArrowButton(systemImage: "chevron.left") {
                    moveWeek(by: -1)
                }
            }

            WeekArrowButton(systemImage: "chevron.right") {
                moveWeek(by: 1)
            }
        }
        .padding(.horizontal, 16)
        .padding(.top, 14)
    }

    private var groupedEvents: [EventSection] {
        let grouped = Dictionary(grouping: eventsForSelectedWeek) { event in
            Self.weekCalendar.startOfDay(for: event.startAt)
        }

        return grouped
            .map { day, events in
                EventSection(
                    day: day,
                    title: Self.sectionTitleFormatter.string(from: day),
                    events: events.sorted(by: { $0.startAt < $1.startAt })
                )
            }
            .sorted(by: { $0.day < $1.day })
    }

    private var eventsForSelectedWeek: [EventFeedItem] {
        guard let nextWeekStart = Self.weekCalendar.date(byAdding: .day, value: 7, to: selectedWeekStart) else {
            return currentEvents
        }

        return currentEvents.filter { event in
            event.startAt >= selectedWeekStart && event.startAt < nextWeekStart
        }
    }

    private var currentEvents: [EventFeedItem] {
        guard case .loaded(let events) = viewModel.state else {
            return []
        }

        return events
    }

    private var isViewingFutureWeek: Bool {
        selectedWeekStart > Self.startOfWeek(for: .now)
    }

    private func moveWeek(by offset: Int) {
        guard let weekStart = Self.weekCalendar.date(byAdding: .day, value: offset * 7, to: selectedWeekStart) else {
            return
        }

        withAnimation(.snappy(duration: 0.24)) {
            selectedWeekStart = max(weekStart, Self.startOfWeek(for: .now))
        }
    }

    private static func startOfWeek(for date: Date) -> Date {
        let startOfDay = weekCalendar.startOfDay(for: date)
        let weekday = weekCalendar.component(.weekday, from: startOfDay)
        let daysFromMonday = (weekday - weekCalendar.firstWeekday + 7) % 7

        return weekCalendar.date(byAdding: .day, value: -daysFromMonday, to: startOfDay) ?? startOfDay
    }

    private var feedBackground: some View {
        Color(red: 0.07, green: 0.07, blue: 0.08)
            .ignoresSafeArea()
    }
}

private struct WeekArrowButton: View {
    let systemImage: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: systemImage)
                .font(.system(size: 16, weight: .bold))
                .foregroundStyle(.white)
                .frame(width: 46, height: 46)
                .background(.black.opacity(0.20), in: Circle())
                .background(.ultraThinMaterial, in: Circle())
                .overlay(
                    Circle()
                        .strokeBorder(.white.opacity(0.18), lineWidth: 1)
                )
                .shadow(color: .black.opacity(0.22), radius: 16, x: 0, y: 8)
        }
        .buttonStyle(.plain)
    }
}

private struct EventSection: Identifiable {
    let day: Date
    let title: String
    let events: [EventFeedItem]

    var id: Date { day }
}

#Preview {
    HomeView()
}
