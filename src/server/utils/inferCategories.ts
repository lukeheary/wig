/**
 * Categories: clubs, bars, concerts, social, lgbtq, comedy
 *
 * For Ticketmaster, pass the structured classification data.
 * For Dice and Posh, pass title + description for keyword matching.
 */

export type Category =
  | "clubs"
  | "bars"
  | "concerts"
  | "social"
  | "lgbtq"
  | "comedy";

const LGBTQ_KEYWORDS = [
  "pride",
  "queer",
  "lgbtq",
  "lgbt",
  "gay",
  "lesbian",
  "bisexual",
  "trans",
  "transgender",
  "drag",
  "nonbinary",
  "non-binary",
];

const COMEDY_KEYWORDS = [
  "comedy",
  "comedian",
  "stand-up",
  "standup",
  "improv",
  "open mic",
  "roast",
  "sketch comedy",
];

const CLUB_KEYWORDS = [
  "dj",
  "rave",
  "techno",
  "house music",
  "edm",
  "electronic",
  "dance party",
  "club night",
  "after party",
  "afterparty",
  "nightclub",
  "night club",
  "disco",
];

const CONCERT_KEYWORDS = [
  "live music",
  "live band",
  "concert",
  "gig",
  "tour",
  "orchestra",
  "symphony",
  "jazz",
  "blues",
  "opera",
  "ballet",
];

const BAR_KEYWORDS = [
  "bar crawl",
  "pub crawl",
  "happy hour",
  "trivia night",
  "karaoke",
  "open bar",
  "cocktail",
  "wine tasting",
  "beer",
  "brewery",
  "tavern",
  "saloon",
];

const SOCIAL_KEYWORDS = [
  "networking",
  "meetup",
  "mixer",
  "speed dating",
  "game night",
  "board game",
  "paint and sip",
  "paint & sip",
  "workshop",
  "pop-up",
  "popup",
  "market",
  "festival",
  "fundraiser",
  "gala",
  "charity",
];

function matchesKeywords(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some((kw) => lower.includes(kw));
}

/**
 * Infer categories from free-text title + description.
 * Used for Dice and Posh scrapers.
 */
export function inferCategoriesFromText(
  title: string,
  description: string | null
): Category[] {
  const text = `${title} ${description ?? ""}`;
  const result = new Set<Category>();

  if (matchesKeywords(text, LGBTQ_KEYWORDS)) result.add("lgbtq");
  if (matchesKeywords(text, COMEDY_KEYWORDS)) result.add("comedy");
  if (matchesKeywords(text, CLUB_KEYWORDS)) result.add("clubs");
  if (matchesKeywords(text, CONCERT_KEYWORDS)) result.add("concerts");
  if (matchesKeywords(text, BAR_KEYWORDS)) result.add("bars");
  if (matchesKeywords(text, SOCIAL_KEYWORDS)) result.add("social");

  // Default to clubs if nothing matched (Dice/Posh are nightlife-focused platforms)
  if (result.size === 0) result.add("clubs");

  return Array.from(result);
}

/**
 * Infer categories from Ticketmaster's structured classification data.
 * Uses TM's segment/genre as the primary signal, supplements with keyword
 * matching only for categories that are orthogonal (lgbtq, bars, social).
 */
export function inferCategoriesFromTicketmaster(
  classifications: Array<{
    segment?: { name?: string };
    genre?: { name?: string };
    subGenre?: { name?: string };
  }>,
  title: string,
  description: string | null
): Category[] {
  const result = new Set<Category>();

  for (const classification of classifications) {
    const segment = classification.segment?.name?.toLowerCase() ?? "";
    const genre = classification.genre?.name?.toLowerCase() ?? "";
    const subGenre = classification.subGenre?.name?.toLowerCase() ?? "";

    if (segment === "music") {
      // Electronic/dance genres → clubs; everything else → concerts
      if (
        genre === "electronic" ||
        genre === "edm" ||
        genre === "dance" ||
        subGenre === "edm" ||
        subGenre === "electronic" ||
        subGenre === "house" ||
        subGenre === "techno"
      ) {
        result.add("clubs");
      } else {
        result.add("concerts");
      }
    }

    if (segment === "comedy" || genre === "comedy" || subGenre === "comedy") {
      result.add("comedy");
    }

    if (segment === "nightlife" || subGenre === "club") {
      result.add("clubs");
    }

    if (
      segment === "arts & theatre" ||
      segment === "arts" ||
      genre === "theatre" ||
      genre === "theater" ||
      genre === "ballet" ||
      genre === "opera" ||
      genre === "classical"
    ) {
      result.add("concerts");
    }
  }

  // Comedy from TM classification overrides a concurrent concerts tag
  // (e.g. a comedy show where TM also tagged segment=Music)
  if (result.has("comedy")) result.delete("concerts");

  const tmResolved = result.size > 0;

  // Supplement with keyword matching for orthogonal categories —
  // these are safe to add regardless of what TM already resolved.
  const text = `${title} ${description ?? ""}`;
  if (matchesKeywords(text, LGBTQ_KEYWORDS)) result.add("lgbtq");
  if (matchesKeywords(text, BAR_KEYWORDS)) result.add("bars");
  if (matchesKeywords(text, SOCIAL_KEYWORDS)) result.add("social");

  // Only use keyword fallbacks for primary categories if TM gave us nothing
  if (!tmResolved && matchesKeywords(text, COMEDY_KEYWORDS)) result.add("comedy");
  if (!tmResolved && matchesKeywords(text, CLUB_KEYWORDS)) result.add("clubs");
  if (!tmResolved && matchesKeywords(text, CONCERT_KEYWORDS)) result.add("concerts");

  // Default
  if (result.size === 0) result.add("concerts");

  return Array.from(result);
}
