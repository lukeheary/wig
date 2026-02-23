import { relations } from "drizzle-orm";
import {
  pgTable,
  text,
  timestamp,
  date,
  uuid,
  varchar,
  index,
  uniqueIndex,
  pgEnum,
  jsonb,
  doublePrecision,
  boolean,
  integer,
} from "drizzle-orm/pg-core";

// ============================================================================
// ENUMS
// ============================================================================

// Place categories are normalized via categories + place_categories tables.
// Event categories remain jsonb string arrays for now.

export const eventVisibilityEnum = pgEnum("event_visibility", [
  "public",
  "private",
]);

export const eventStatusEnum = pgEnum("event_status", [
  "active",
  "cancelled",
  "postponed",
  "draft",
]);

export const rsvpStatusEnum = pgEnum("rsvp_status", [
  "going",
  "interested",
  "not_going",
]);

export const friendStatusEnum = pgEnum("friend_status", [
  "pending",
  "accepted",
]);

export const userRoleEnum = pgEnum("user_role", ["user", "admin"]);

export const genderEnum = pgEnum("gender", ["male", "female", "other"]);

export const activityTypeEnum = pgEnum("activity_type", [
  "rsvp_going",
  "rsvp_interested",
  "rsvp_not_going",
  "follow_place",
  "created_event",
  "checked_in",
]);

export const activityEntityTypeEnum = pgEnum("activity_entity_type", [
  "event",
  "place",
  "user",
]);

export const eventActivityTypeEnum = pgEnum("event_activity_type", [
  "created",
  "updated",
  "cancelled",
  "postponed",
  "rescheduled",
  "restored",
]);

export const placeTypeEnum = pgEnum("place_type", ["venue", "organizer"]);
export const placeMemberRoleEnum = pgEnum("place_member_role", [
  "owner",
  "manager",
  "promoter",
  "staff",
]);

export const recurrenceFrequencyEnum = pgEnum("recurrence_frequency", [
  "daily",
  "weekly",
  "monthly",
]);

export const partnerStatusEnum = pgEnum("partner_status", [
  "pending",
  "accepted",
]);

export const scraperTypeEnum = pgEnum("scraper_type", [
  "dice",
  "posh",
  "clubcafe",
  "ticketmaster",
]);

// ============================================================================
// USERS TABLE
// ============================================================================
// Synced from Clerk via webhooks
export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey(), // Clerk user ID
    email: varchar("email", { length: 255 }).notNull(),
    username: varchar("username", { length: 50 }).notNull().unique(),
    firstName: varchar("first_name", { length: 100 }),
    lastName: varchar("last_name", { length: 100 }),
    avatarImageUrl: text("avatar_image_url"),
    city: varchar("city", { length: 100 }),
    state: varchar("state", { length: 2 }),
    gender: genderEnum("gender"),
    dateOfBirth: date("date_of_birth"),
    role: userRoleEnum("role").notNull().default("user"),
    isOnboarding: boolean("is_onboarding").notNull().default(true),
    eventUpdatesLastSeenAt: timestamp("event_updates_last_seen_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    emailIdx: index("users_email_idx").on(table.email),
    usernameIdx: uniqueIndex("users_username_idx").on(table.username),
  })
);

export const usersRelations = relations(users, ({ many }) => ({
  placeMembers: many(placeMembers),
  placeFollows: many(placeFollows),
  rsvps: many(eventRsvps),
  eventSeries: many(eventSeries),
  sentFriendRequests: many(userFriends, { relationName: "sentRequests" }),
  receivedFriendRequests: many(userFriends, { relationName: "receivedRequests" }),
  sentPartnerRequests: many(userPartners, { relationName: "partnerRequests" }),
  receivedPartnerRequests: many(userPartners, {
    relationName: "partnerReceipts",
  }),
  activities: many(userActivity),
  eventActivities: many(eventActivity),
}));

// ============================================================================
// CITIES TABLE
// ============================================================================
export const cities = pgTable(
  "cities",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 100 }).notNull(),
    state: varchar("state", { length: 2 }).notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    nameStateIdx: uniqueIndex("cities_name_state_idx").on(
      table.name,
      table.state
    ),
    stateIdx: index("cities_state_idx").on(table.state),
  })
);

// ============================================================================
// METRO AREAS TABLE
// ============================================================================
export const metroAreas = pgTable(
  "metro_areas",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    name: varchar("name", { length: 100 }).notNull(), // Display name (e.g. "Boston")
    state: varchar("state", { length: 2 }).notNull(),
    latitude: doublePrecision("latitude").notNull(),
    longitude: doublePrecision("longitude").notNull(),
    radiusMiles: doublePrecision("radius_miles").notNull().default(20),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    nameStateIdx: uniqueIndex("metro_areas_name_state_idx").on(
      table.name,
      table.state
    ),
  })
);

// ============================================================================
// CATEGORIES TABLE
// ============================================================================
export const categories = pgTable(
  "categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    key: varchar("key", { length: 64 }).notNull().unique(),
    label: varchar("label", { length: 100 }).notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    keyIdx: uniqueIndex("categories_key_idx").on(table.key),
    activeSortIdx: index("categories_active_sort_idx").on(
      table.isActive,
      table.sortOrder
    ),
  })
);

export const categoriesRelations = relations(categories, ({ many }) => ({
  placeCategories: many(placeCategories),
  eventCategories: many(eventCategories),
}));

// ============================================================================
// PLACES TABLE (unified venues + organizers)
// ============================================================================
export const places = pgTable(
  "places",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    type: placeTypeEnum("type").notNull(), // 'venue' or 'organizer'
    slug: varchar("slug", { length: 100 }).notNull().unique(),
    name: varchar("name", { length: 255 }).notNull(),
    description: text("description"),
    logoImageUrl: text("logo_image_url"),
    coverImageUrl: text("banner_image_url"), // Optional banner image for place profile
    address: text("address"), // primarily for venues
    city: varchar("city", { length: 100 }),
    state: varchar("state", { length: 2 }),
    latitude: doublePrecision("latitude"),
    longitude: doublePrecision("longitude"),
    website: text("website"),
    instagram: varchar("instagram", { length: 100 }),
    hours: jsonb("hours"), // Store hours as: { monday: { open: "09:00", close: "17:00", closed: false }, ... }
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    slugIdx: uniqueIndex("places_slug_idx").on(table.slug),
    typeIdx: index("places_type_idx").on(table.type),
    locationIdx: index("places_location_idx").on(table.city, table.state),
  })
);

export const placesRelations = relations(places, ({ many }) => ({
  members: many(placeMembers),
  venueEvents: many(events, { relationName: "venueEvents" }),
  organizerEvents: many(events, { relationName: "organizerEvents" }),
  venueEventSeries: many(eventSeries, { relationName: "venueEventSeries" }),
  organizerEventSeries: many(eventSeries, {
    relationName: "organizerEventSeries",
  }),
  follows: many(placeFollows),
  categoryLinks: many(placeCategories),
  scraperConfigs: many(scrapers),
}));

// ============================================================================
// SCRAPERS TABLE
// ============================================================================
export const scrapers = pgTable(
  "scrapers",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    placeId: uuid("place_id")
      .notNull()
      .references(() => places.id, { onDelete: "cascade" }),
    scraper: scraperTypeEnum("scraper").notNull(),
    searchString: text("search_string").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    placeIdx: uniqueIndex("scrapers_place_idx").on(table.placeId),
    scraperIdx: index("scrapers_scraper_idx").on(table.scraper),
  })
);

export const scrapersRelations = relations(scrapers, ({ one }) => ({
  place: one(places, {
    fields: [scrapers.placeId],
    references: [places.id],
  }),
}));

// ============================================================================
// PLACE CATEGORIES TABLE (many-to-many between places and categories)
// ============================================================================
export const placeCategories = pgTable(
  "place_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    placeId: uuid("place_id")
      .notNull()
      .references(() => places.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    placeCategoryIdx: uniqueIndex("place_categories_place_category_idx").on(
      table.placeId,
      table.categoryId
    ),
    placeIdx: index("place_categories_place_idx").on(table.placeId),
    categoryIdx: index("place_categories_category_idx").on(table.categoryId),
  })
);

export const placeCategoriesRelations = relations(
  placeCategories,
  ({ one }) => ({
    place: one(places, {
      fields: [placeCategories.placeId],
      references: [places.id],
    }),
    category: one(categories, {
      fields: [placeCategories.categoryId],
      references: [categories.id],
    }),
  })
);

// ============================================================================
// PLACE MEMBERS TABLE
// ============================================================================
export const placeMembers = pgTable(
  "place_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    placeId: uuid("place_id")
      .notNull()
      .references(() => places.id, { onDelete: "cascade" }),
    role: placeMemberRoleEnum("role").default("staff").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    userPlaceIdx: uniqueIndex("place_members_user_place_idx").on(
      table.userId,
      table.placeId
    ),
    userIdx: index("place_members_user_idx").on(table.userId),
    placeIdx: index("place_members_place_idx").on(table.placeId),
  })
);

export const placeMembersRelations = relations(placeMembers, ({ one }) => ({
  user: one(users, {
    fields: [placeMembers.userId],
    references: [users.id],
  }),
  place: one(places, {
    fields: [placeMembers.placeId],
    references: [places.id],
  }),
}));

// ============================================================================
// PLACE FOLLOWS TABLE
// ============================================================================
export const placeFollows = pgTable(
  "place_follows",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    placeId: uuid("place_id")
      .notNull()
      .references(() => places.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    userPlaceIdx: uniqueIndex("place_follows_user_place_idx").on(
      table.userId,
      table.placeId
    ),
    userIdx: index("place_follows_user_idx").on(table.userId),
    placeIdx: index("place_follows_place_idx").on(table.placeId),
  })
);

export const placeFollowsRelations = relations(placeFollows, ({ one }) => ({
  user: one(users, {
    fields: [placeFollows.userId],
    references: [users.id],
  }),
  place: one(places, {
    fields: [placeFollows.placeId],
    references: [places.id],
  }),
}));

// ============================================================================
// EVENT SERIES TABLE
// ============================================================================
export const eventSeries = pgTable(
  "event_series",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    venueId: uuid("venue_id").references(() => places.id, {
      onDelete: "set null",
    }),
    organizerId: uuid("organizer_id").references(() => places.id, {
      onDelete: "set null",
    }),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    coverImageUrl: text("cover_image_url"),
    eventUrl: text("event_url"),
    source: varchar("source", { length: 50 }),
    externalId: text("external_id"),
    startAt: timestamp("start_at").notNull(),
    durationMinutes: integer("duration_minutes"),
    address: text("address"),
    city: varchar("city", { length: 100 }).notNull(),
    state: varchar("state", { length: 2 }).notNull(),
    categories: jsonb("categories").$type<string[]>().notNull().default([]),
    visibility: eventVisibilityEnum("visibility").notNull().default("public"),
    status: eventStatusEnum("status").notNull().default("active"),
    frequency: recurrenceFrequencyEnum("frequency").notNull(),
    interval: integer("interval").notNull().default(1),
    daysOfWeek: jsonb("days_of_week").$type<number[]>(),
    untilDate: timestamp("until_date"),
    isActive: boolean("is_active").notNull().default(true),
    lastGeneratedAt: timestamp("last_generated_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    venueIdx: index("event_series_venue_idx").on(table.venueId),
    organizerIdx: index("event_series_organizer_idx").on(table.organizerId),
    startAtIdx: index("event_series_start_at_idx").on(table.startAt),
    activeIdx: index("event_series_active_idx").on(table.isActive),
    locationIdx: index("event_series_location_idx").on(table.city, table.state),
  })
);

export const eventSeriesRelations = relations(eventSeries, ({ one, many }) => ({
  venue: one(places, {
    fields: [eventSeries.venueId],
    references: [places.id],
    relationName: "venueEventSeries",
  }),
  organizer: one(places, {
    fields: [eventSeries.organizerId],
    references: [places.id],
    relationName: "organizerEventSeries",
  }),
  createdBy: one(users, {
    fields: [eventSeries.createdByUserId],
    references: [users.id],
  }),
  events: many(events),
}));

// ============================================================================
// EVENTS TABLE
// ============================================================================
export const events = pgTable(
  "events",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    venueId: uuid("venue_id").references(() => places.id, {
      onDelete: "set null",
    }),
    organizerId: uuid("organizer_id").references(() => places.id, {
      onDelete: "set null",
    }),
    createdByUserId: text("created_by_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    title: varchar("title", { length: 255 }).notNull(),
    description: text("description"),
    coverImageUrl: text("cover_image_url"),
    eventUrl: text("event_url"),
    source: varchar("source", { length: 50 }),
    externalId: text("external_id"),
    seriesId: uuid("series_id").references(() => eventSeries.id, {
      onDelete: "set null",
    }),
    startAt: timestamp("start_at").notNull(),
    endAt: timestamp("end_at"),
    address: text("address"),
    city: varchar("city", { length: 100 }).notNull(),
    state: varchar("state", { length: 2 }).notNull(),
    visibility: eventVisibilityEnum("visibility").notNull().default("public"),
    status: eventStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    venueIdx: index("events_venue_idx").on(table.venueId),
    organizerIdx: index("events_organizer_idx").on(table.organizerId),
    seriesIdx: index("events_series_idx").on(table.seriesId),
    seriesStartAtUniqueIdx: uniqueIndex("events_series_start_at_unique_idx").on(
      table.seriesId,
      table.startAt
    ),
    startAtIdx: index("events_start_at_idx").on(table.startAt),
    locationIdx: index("events_location_idx").on(table.city, table.state),
    visibilityIdx: index("events_visibility_idx").on(table.visibility),
    statusIdx: index("events_status_idx").on(table.status),
    // Composite index for common query pattern
    startVisibilityIdx: index("events_start_visibility_idx").on(
      table.startAt,
      table.visibility
    ),
    sourceExternalIdIdx: uniqueIndex("events_source_external_id_idx").on(
      table.source,
      table.externalId
    ),
  })
);

export const eventsRelations = relations(events, ({ one, many }) => ({
  venue: one(places, {
    fields: [events.venueId],
    references: [places.id],
    relationName: "venueEvents",
  }),
  organizer: one(places, {
    fields: [events.organizerId],
    references: [places.id],
    relationName: "organizerEvents",
  }),
  createdBy: one(users, {
    fields: [events.createdByUserId],
    references: [users.id],
  }),
  series: one(eventSeries, {
    fields: [events.seriesId],
    references: [eventSeries.id],
  }),
  rsvps: many(eventRsvps),
  categoryLinks: many(eventCategories),
  activities: many(eventActivity),
}));

// ============================================================================
// EVENT CATEGORIES TABLE (many-to-many between events and categories)
// ============================================================================
export const eventCategories = pgTable(
  "event_categories",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    categoryId: uuid("category_id")
      .notNull()
      .references(() => categories.id, { onDelete: "cascade" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    eventCategoryIdx: uniqueIndex("event_categories_event_category_idx").on(
      table.eventId,
      table.categoryId
    ),
    eventIdx: index("event_categories_event_idx").on(table.eventId),
    categoryIdx: index("event_categories_category_idx").on(table.categoryId),
  })
);

export const eventCategoriesRelations = relations(
  eventCategories,
  ({ one }) => ({
    event: one(events, {
      fields: [eventCategories.eventId],
      references: [events.id],
    }),
    category: one(categories, {
      fields: [eventCategories.categoryId],
      references: [categories.id],
    }),
  })
);

// ============================================================================
// EVENT RSVPS TABLE
// ============================================================================
export const eventRsvps = pgTable(
  "event_rsvps",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    partnerRsvpByUserId: text("partner_rsvp_by_user_id").references(
      () => users.id,
      { onDelete: "set null" }
    ),
    status: rsvpStatusEnum("status").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userEventIdx: uniqueIndex("rsvps_user_event_idx").on(
      table.userId,
      table.eventId
    ),
    eventStatusIdx: index("rsvps_event_status_idx").on(
      table.eventId,
      table.status
    ),
    userIdx: index("rsvps_user_idx").on(table.userId),
    partnerRsvpByUserIdx: index("rsvps_partner_rsvp_by_user_idx").on(
      table.partnerRsvpByUserId
    ),
  })
);

export const eventRsvpsRelations = relations(eventRsvps, ({ one }) => ({
  user: one(users, {
    fields: [eventRsvps.userId],
    references: [users.id],
  }),
  event: one(events, {
    fields: [eventRsvps.eventId],
    references: [events.id],
  }),
}));

// ============================================================================
// USER FRIENDS TABLE
// ============================================================================
export const userFriends = pgTable(
  "user_friends",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    friendUserId: text("friend_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: friendStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    userFriendIdx: uniqueIndex("friends_user_friend_idx").on(
      table.userId,
      table.friendUserId
    ),
    // Ensure no reverse duplicates (A->B and B->A)
    friendUserIdx: uniqueIndex("friends_friend_user_idx").on(
      table.friendUserId,
      table.userId
    ),
    userStatusIdx: index("friends_user_status_idx").on(
      table.userId,
      table.status
    ),
    friendUserStatusIdx: index("friends_friend_user_status_idx").on(
      table.friendUserId,
      table.status
    ),
  })
);

export const userFriendsRelations = relations(userFriends, ({ one }) => ({
  user: one(users, {
    fields: [userFriends.userId],
    references: [users.id],
    relationName: "sentRequests",
  }),
  friend: one(users, {
    fields: [userFriends.friendUserId],
    references: [users.id],
    relationName: "receivedRequests",
  }),
}));

// ============================================================================
// ACTIVITY TABLE (Append-only)
// ============================================================================
export const userActivity = pgTable(
  "user_activity",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: activityTypeEnum("type").notNull(),
    entityType: activityEntityTypeEnum("entity_type").notNull(),
    entityId: uuid("entity_id").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    actorCreatedAtIdx: index("activity_actor_created_at_idx").on(
      table.actorUserId,
      table.createdAt
    ),
  })
);

export const userActivityRelations = relations(userActivity, ({ one }) => ({
  actor: one(users, {
    fields: [userActivity.actorUserId],
    references: [users.id],
  }),
  event: one(events, {
    fields: [userActivity.entityId],
    references: [events.id],
  }),
  place: one(places, {
    fields: [userActivity.entityId],
    references: [places.id],
  }),
}));

// ============================================================================
// EVENT ACTIVITY TABLE (Append-only)
// ============================================================================
export const eventActivity = pgTable(
  "event_activity",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    actorUserId: text("actor_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => events.id, { onDelete: "cascade" }),
    type: eventActivityTypeEnum("type").notNull(),
    metadata: jsonb("metadata"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    actorCreatedAtIdx: index("event_activity_actor_created_at_idx").on(
      table.actorUserId,
      table.createdAt
    ),
    eventCreatedAtIdx: index("event_activity_event_created_at_idx").on(
      table.eventId,
      table.createdAt
    ),
  })
);

export const eventActivityRelations = relations(eventActivity, ({ one }) => ({
  actor: one(users, {
    fields: [eventActivity.actorUserId],
    references: [users.id],
  }),
  event: one(events, {
    fields: [eventActivity.eventId],
    references: [events.id],
  }),
}));

// ============================================================================
// USER PARTNERS TABLE
// ============================================================================
export const userPartners = pgTable(
  "user_partners",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    requesterId: text("requester_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    recipientId: text("recipient_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: partnerStatusEnum("status").notNull().default("pending"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (table) => ({
    // Each user can only be a requester once (one partner at a time)
    requesterIdx: uniqueIndex("user_partners_requester_idx").on(
      table.requesterId
    ),
    // Each user can only be a recipient once (one partner at a time)
    recipientIdx: uniqueIndex("user_partners_recipient_idx").on(
      table.recipientId
    ),
  })
);

export const userPartnersRelations = relations(userPartners, ({ one }) => ({
  requester: one(users, {
    fields: [userPartners.requesterId],
    references: [users.id],
    relationName: "partnerRequests",
  }),
  recipient: one(users, {
    fields: [userPartners.recipientId],
    references: [users.id],
    relationName: "partnerReceipts",
  }),
}));
