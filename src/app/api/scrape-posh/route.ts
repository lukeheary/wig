import { NextRequest, NextResponse } from "next/server";
import * as cheerio from "cheerio";
import { inferCategoriesFromText } from "@/server/utils/inferCategories";

export const maxDuration = 60;

const POSH_EVENT_URL_REGEX = /https?:\/\/posh\.vip\/e\/[A-Za-z0-9_-]+/g;
const POSH_EVENT_PATH_REGEX = /["'](\/e\/[A-Za-z0-9_-]+)(?:[?#][^"']*)?["']/g;
const POSH_GROUP_API_BASE = "https://posh.vip/api/web/v2/util/group_url/";
const POSH_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";
const timeZoneFormatterCache = new Map<string, Intl.DateTimeFormat>();

interface PoshFetchResult {
  response: Response;
  body: string;
  transport: "direct" | "scrape.do-datacenter" | "scrape.do-residential";
}

function isBotChallenge(response: Response, body: string): boolean {
  return (
    response.headers.get("cf-mitigated") === "challenge" ||
    /cf-chl-|challenge-platform|captcha|access denied/i.test(body)
  );
}

function describePoshResponse(result: PoshFetchResult): string {
  const { response, body, transport } = result;
  const details = [
    `HTTP ${response.status}${response.statusText ? ` ${response.statusText}` : ""}`,
    `content-type ${response.headers.get("content-type") || "unknown"}`,
    transport === "scrape.do-datacenter"
      ? "via Scrape.do datacenter"
      : transport === "scrape.do-residential"
        ? "via Scrape.do residential"
        : "direct from Posh",
  ];
  const botCategory = response.headers.get("x-amzn-waf-waf-bot-category");

  if (botCategory) details.push(`WAF bot category ${botCategory}`);
  if (isBotChallenge(response, body)) details.push("bot challenge detected");
  details.push(`${Buffer.byteLength(body)} response bytes`);

  return details.join("; ");
}

function shouldEscalateScrapeDoResult(
  result: PoshFetchResult,
  accept: string
): boolean {
  if (
    result.response.status === 403 ||
    result.response.status === 429 ||
    result.response.status >= 500 ||
    isBotChallenge(result.response, result.body)
  ) {
    return true;
  }

  if (result.response.ok && accept.includes("application/json")) {
    try {
      JSON.parse(result.body);
    } catch {
      return true;
    }
  }

  return false;
}

async function fetchViaScrapeDo(
  url: string,
  accept: string,
  token: string,
  residential: boolean
): Promise<PoshFetchResult> {
  const scrapeDoUrl = new URL("https://api.scrape.do/");
  scrapeDoUrl.searchParams.set("token", token);
  scrapeDoUrl.searchParams.set("url", url);
  scrapeDoUrl.searchParams.set("super", residential ? "true" : "false");
  scrapeDoUrl.searchParams.set("geoCode", "us");
  scrapeDoUrl.searchParams.set("render", "false");
  scrapeDoUrl.searchParams.set("output", "raw");
  scrapeDoUrl.searchParams.set("timeout", residential ? "25000" : "8000");
  scrapeDoUrl.searchParams.set("retryTimeout", "5000");
  if (!residential) {
    scrapeDoUrl.searchParams.set("disableRetry", "true");
  }

  const response = await fetch(scrapeDoUrl, {
    headers: { Accept: accept },
    signal: AbortSignal.timeout(residential ? 30000 : 12000),
  });
  return {
    response,
    body: await response.text(),
    transport: residential ? "scrape.do-residential" : "scrape.do-datacenter",
  };
}

async function fetchPoshResource(
  url: string,
  accept: string
): Promise<PoshFetchResult> {
  let directResult: PoshFetchResult | null = null;

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": POSH_USER_AGENT,
        Accept: accept,
      },
      signal: AbortSignal.timeout(5000),
    });
    directResult = {
      response,
      body: await response.text(),
      transport: "direct",
    };

    const shouldRetryWithProxy =
      response.status === 403 ||
      response.status === 429 ||
      isBotChallenge(response, directResult.body);
    if (!shouldRetryWithProxy) return directResult;
  } catch {
    // A configured Scrape.do fallback can also recover network-level errors.
  }

  const scrapeDoToken = process.env.SCRAPE_DO_TOKEN?.trim();
  if (!scrapeDoToken) {
    if (directResult) return directResult;
    throw new Error(
      "Direct Posh request failed and SCRAPE_DO_TOKEN is not configured"
    );
  }

  try {
    const datacenterResult = await fetchViaScrapeDo(
      url,
      accept,
      scrapeDoToken,
      false
    );
    if (!shouldEscalateScrapeDoResult(datacenterResult, accept)) {
      return datacenterResult;
    }
  } catch {
    // Escalate network and timeout failures to the residential pool.
  }

  try {
    return await fetchViaScrapeDo(url, accept, scrapeDoToken, true);
  } catch {
    throw new Error(
      "Scrape.do datacenter and residential requests failed before receiving a response"
    );
  }
}

interface PoshJsonLd {
  "@type": string;
  name?: string;
  startDate?: string;
  endDate?: string;
  eventStatus?: string;
  url?: string;
  description?: string;
  image?: string | string[];
  organizer?: {
    "@type": string;
    name?: string;
    url?: string;
  };
  location?: {
    "@type": string;
    name?: string;
    address?: {
      "@type": string;
      streetAddress?: string;
    };
    geo?: {
      latitude?: number;
      longitude?: number;
    };
  };
}

function findEventJsonLd(
  value: unknown,
  visited = new WeakSet<object>()
): PoshJsonLd | null {
  if (!value || typeof value !== "object") return null;
  if (visited.has(value)) return null;
  visited.add(value);

  if (Array.isArray(value)) {
    for (const item of value) {
      const event = findEventJsonLd(item, visited);
      if (event) return event;
    }
    return null;
  }

  const obj = value as Record<string, unknown>;
  const type = obj["@type"];
  if (
    type === "Event" ||
    (Array.isArray(type) && type.some((item) => item === "Event"))
  ) {
    return obj as unknown as PoshJsonLd;
  }

  for (const child of Object.values(obj)) {
    const event = findEventJsonLd(child, visited);
    if (event) return event;
  }

  return null;
}

function parseEventJsonLd(raw: string | null | undefined): PoshJsonLd | null {
  if (!raw) return null;
  try {
    return findEventJsonLd(JSON.parse(raw));
  } catch {
    return null;
  }
}

function findJsonObjectEnd(text: string, start: number): number | null {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = start; index < text.length; index += 1) {
    const character = text[index];

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === '"') {
        inString = false;
      }
      continue;
    }

    if (character === '"') {
      inString = true;
    } else if (character === "{") {
      depth += 1;
    } else if (character === "}") {
      depth -= 1;
      if (depth === 0) return index + 1;
    }
  }

  return null;
}

function extractEventJsonLdFromText(text: string): PoshJsonLd | null {
  const eventTypePattern = /"@type"\s*:\s*"Event"/g;

  for (const match of text.matchAll(eventTypePattern)) {
    if (match.index === undefined) continue;

    // @type is normally one of the first fields, so the nearest opening brace
    // is the JSON-LD event object rather than a surrounding Flight record.
    let objectStart = text.lastIndexOf("{", match.index);
    while (objectStart !== -1) {
      const objectEnd = findJsonObjectEnd(text, objectStart);
      if (objectEnd !== null) {
        const event = parseEventJsonLd(text.slice(objectStart, objectEnd));
        if (event) return event;
      }
      objectStart = text.lastIndexOf("{", objectStart - 1);
    }
  }

  return null;
}

function extractEventJsonLdFromReactFlight(
  $: cheerio.CheerioAPI
): PoshJsonLd | null {
  let event: PoshJsonLd | null = null;

  $("script").each((_, element) => {
    if (event) return false;

    const content = $(element).html()?.trim();
    const prefix = "self.__next_f.push(";
    if (!content?.startsWith(prefix) || !content.endsWith(")")) return;

    try {
      const flightEntry = JSON.parse(
        content.slice(prefix.length, content.length - 1)
      ) as unknown;
      if (
        Array.isArray(flightEntry) &&
        flightEntry[0] === 1 &&
        typeof flightEntry[1] === "string"
      ) {
        event = extractEventJsonLdFromText(flightEntry[1]);
      }
    } catch {
      // Ignore unrelated or malformed React Flight records.
    }
  });

  return event;
}

function normalizePoshEventUrl(
  rawUrl: string | null | undefined
): string | null {
  if (!rawUrl) return null;
  let url = rawUrl.trim();
  if (!url) return null;

  if (url.startsWith("//")) {
    url = `https:${url}`;
  }

  if (url.startsWith("/e/")) {
    url = `https://posh.vip${url}`;
  } else if (url.startsWith("posh.vip/")) {
    url = `https://${url}`;
  }

  if (!url.includes("posh.vip/e/")) return null;

  // Strip query/hash
  url = url.split("#")[0].split("?")[0];

  return url;
}

function buildPoshEventUrlFromSlug(
  slug: string | null | undefined
): string | null {
  if (!slug) return null;
  const cleaned = slug.trim().replace(/^\/e\//, "");
  if (!cleaned) return null;
  const lastSegment = cleaned.split("/").filter(Boolean).pop();
  if (!lastSegment) return null;
  return normalizePoshEventUrl(`https://posh.vip/e/${lastSegment}`);
}

function extractSlugFromUrl(url: string, marker: string): string | null {
  try {
    const cleaned = url.split("#")[0].split("?")[0];
    const parts = cleaned.split("/").filter(Boolean);
    const index = parts.findIndex((part) => part === marker);
    if (index !== -1 && parts[index + 1]) {
      return parts[index + 1];
    }
  } catch {
    // ignore parse errors
  }
  return null;
}

function cleanPoshImageUrl(imageUrl: string | null): string | null {
  if (!imageUrl) return null;
  let url = imageUrl;
  if (url.startsWith("//")) {
    url = `https:${url}`;
  }
  if (url.includes("/cdn-cgi/image/")) {
    const s3Match = url.match(/(https:\/\/posh-images[^"'\s]+)/);
    if (s3Match) {
      url = s3Match[1];
    }
  }
  return url;
}

function looksLikeEventObject(obj: Record<string, unknown>): boolean {
  const keys = Object.keys(obj).map((key) => key.toLowerCase());
  const hasName = keys.includes("name") || keys.includes("title");
  const hasDate = keys.some(
    (key) =>
      key.includes("start") || key.includes("date") || key.includes("time")
  );
  const hasLocation = keys.some(
    (key) => key.includes("venue") || key.includes("location")
  );
  const typeValue =
    (typeof obj.type === "string" ? obj.type : null) ||
    (typeof obj.__typename === "string" ? obj.__typename : null) ||
    (typeof obj["@type"] === "string" ? obj["@type"] : null);
  const isEventType = !!typeValue && typeValue.toLowerCase().includes("event");

  return (hasName && (hasDate || hasLocation)) || isEventType;
}

function collectEventObjects(
  value: unknown,
  results: Record<string, unknown>[],
  visited: WeakSet<object>,
  depth: number
) {
  if (depth > 6 || value === null || value === undefined) return;

  if (Array.isArray(value)) {
    for (const item of value) {
      collectEventObjects(item, results, visited, depth + 1);
    }
    return;
  }

  if (typeof value === "object") {
    if (visited.has(value)) return;
    visited.add(value);
    const obj = value as Record<string, unknown>;

    if (looksLikeEventObject(obj)) {
      results.push(obj);
    }

    for (const val of Object.values(obj)) {
      collectEventObjects(val, results, visited, depth + 1);
    }
  }
}

function collectEventUrlsFromObject(
  value: unknown,
  urls: Set<string>,
  visited: WeakSet<object>,
  depth: number
) {
  if (depth > 6 || value === null || value === undefined) return;

  if (typeof value === "string") {
    const normalized = normalizePoshEventUrl(value);
    if (normalized) urls.add(normalized);
    return;
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      collectEventUrlsFromObject(item, urls, visited, depth + 1);
    }
    return;
  }

  if (typeof value === "object") {
    if (visited.has(value)) return;
    visited.add(value);
    const obj = value as Record<string, unknown>;

    const slugValue = typeof obj.slug === "string" ? obj.slug : null;
    if (slugValue && looksLikeEventObject(obj)) {
      const url = buildPoshEventUrlFromSlug(slugValue);
      if (url) urls.add(url);
    }

    const eventSlugValue =
      typeof obj.eventSlug === "string" ? obj.eventSlug : null;
    if (eventSlugValue) {
      const url = buildPoshEventUrlFromSlug(eventSlugValue);
      if (url) urls.add(url);
    }

    for (const [key, val] of Object.entries(obj)) {
      if (typeof val === "string" && key.toLowerCase().includes("url")) {
        const normalized = normalizePoshEventUrl(val);
        if (normalized) urls.add(normalized);
      }
    }

    for (const val of Object.values(obj)) {
      collectEventUrlsFromObject(val, urls, visited, depth + 1);
    }
  }
}

function extractEventUrlsFromHtml(
  html: string,
  $: cheerio.CheerioAPI
): string[] {
  const urls = new Set<string>();

  const addUrl = (raw: string | null | undefined) => {
    const normalized = normalizePoshEventUrl(raw);
    if (normalized) urls.add(normalized);
  };

  const addSlug = (raw: string | null | undefined) => {
    const url = buildPoshEventUrlFromSlug(raw);
    if (url) urls.add(url);
  };

  $('a[href*="/e/"]').each((_, el) => {
    addUrl($(el).attr("href"));
  });

  $(".EventCard").each((_, el) => {
    const $el = $(el);
    addUrl($el.attr("data-event-url"));
    addSlug($el.attr("data-event-slug"));
    addUrl($el.attr("data-href"));
    addUrl($el.find('a[href*="/e/"]').attr("href"));
  });

  $("[data-event-url]").each((_, el) => addUrl($(el).attr("data-event-url")));
  $("[data-event-slug]").each((_, el) =>
    addSlug($(el).attr("data-event-slug"))
  );
  $("[data-event]").each((_, el) => {
    const raw = $(el).attr("data-event");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      collectEventUrlsFromObject(parsed, urls, new WeakSet<object>(), 0);
    } catch {
      // Ignore invalid JSON in attributes
    }
  });

  const nextData = $("#__NEXT_DATA__").html();
  if (nextData) {
    try {
      const parsed = JSON.parse(nextData);
      collectEventUrlsFromObject(parsed, urls, new WeakSet<object>(), 0);
    } catch {
      // Ignore invalid JSON
    }
  }

  for (const match of html.matchAll(POSH_EVENT_URL_REGEX)) {
    addUrl(match[0]);
  }

  for (const match of html.matchAll(POSH_EVENT_PATH_REGEX)) {
    addUrl(match[1]);
  }

  return Array.from(urls);
}

function getPathValue(
  obj: Record<string, unknown> | null | undefined,
  path: string[]
): unknown {
  if (!obj) return undefined;
  let current: unknown = obj;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function pickStringFromPaths(
  obj: Record<string, unknown> | null | undefined,
  paths: Array<string | string[]>
): string | null {
  if (!obj) return null;
  for (const path of paths) {
    const value =
      typeof path === "string" ? obj[path] : getPathValue(obj, path);
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

function hasTimeZoneDesignator(value: string): boolean {
  return /[zZ]|[+-]\d{2}:?\d{2}$/.test(value);
}

function parseDateParts(value: string): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} | null {
  const match = value
    .trim()
    .match(
      /^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2})(?::(\d{2}))?(?::(\d{2}))?)?/
    );
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4] ?? 0);
  const minute = Number(match[5] ?? 0);
  const second = Number(match[6] ?? 0);
  if (
    Number.isNaN(year) ||
    Number.isNaN(month) ||
    Number.isNaN(day) ||
    Number.isNaN(hour) ||
    Number.isNaN(minute) ||
    Number.isNaN(second)
  ) {
    return null;
  }
  return { year, month, day, hour, minute, second };
}

function toUtcIsoFromZonedParts(
  parts: {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
  },
  timeZone: string
): string | null {
  try {
    const naiveUtcMs = Date.UTC(
      parts.year,
      parts.month - 1,
      parts.day,
      parts.hour,
      parts.minute,
      parts.second
    );
    if (Number.isNaN(naiveUtcMs)) return null;

    let candidateUtcMs = naiveUtcMs;
    for (let i = 0; i < 4; i += 1) {
      const offsetMs = getTimeZoneOffsetMs(new Date(candidateUtcMs), timeZone);
      if (offsetMs == null) break;

      const nextCandidateUtcMs = naiveUtcMs - offsetMs;
      if (nextCandidateUtcMs === candidateUtcMs) break;
      candidateUtcMs = nextCandidateUtcMs;
    }

    const resolved = new Date(candidateUtcMs);
    return Number.isNaN(resolved.getTime()) ? null : resolved.toISOString();
  } catch {
    return null;
  }
}

function getTimeZoneDateTimeParts(
  date: Date,
  timeZone: string
): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} | null {
  try {
    let formatter = timeZoneFormatterCache.get(timeZone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour12: false,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });
      timeZoneFormatterCache.set(timeZone, formatter);
    }

    const parts = formatter.formatToParts(date);
    const values = Object.fromEntries(
      parts
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value])
    );

    const year = Number(values.year);
    const month = Number(values.month);
    const day = Number(values.day);
    const hour = Number(values.hour);
    const minute = Number(values.minute);
    const second = Number(values.second);

    if (
      Number.isNaN(year) ||
      Number.isNaN(month) ||
      Number.isNaN(day) ||
      Number.isNaN(hour) ||
      Number.isNaN(minute) ||
      Number.isNaN(second)
    ) {
      return null;
    }

    return { year, month, day, hour, minute, second };
  } catch {
    return null;
  }
}

function getTimeZoneOffsetMs(date: Date, timeZone: string): number | null {
  const parts = getTimeZoneDateTimeParts(date, timeZone);
  if (!parts) return null;

  const asUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second
  );

  return asUtc - date.getTime();
}

function normalizeTimeZone(raw: string): string {
  const trimmed = raw.trim();
  const upper = trimmed.toUpperCase();
  const map: Record<string, string> = {
    EST: "America/New_York",
    EDT: "America/New_York",
    CST: "America/Chicago",
    CDT: "America/Chicago",
    MST: "America/Denver",
    MDT: "America/Denver",
    PST: "America/Los_Angeles",
    PDT: "America/Los_Angeles",
    AKST: "America/Anchorage",
    AKDT: "America/Anchorage",
    HST: "Pacific/Honolulu",
  };
  return map[upper] ?? trimmed;
}

function timeZoneFromState(state: string | null | undefined): string | null {
  if (!state) return null;
  const upper = state.trim().toUpperCase();
  const eastern = new Set([
    "CT",
    "DE",
    "FL",
    "GA",
    "IN",
    "KY",
    "ME",
    "MD",
    "MA",
    "MI",
    "NH",
    "NJ",
    "NY",
    "NC",
    "OH",
    "PA",
    "RI",
    "SC",
    "TN",
    "VT",
    "VA",
    "WV",
    "DC",
  ]);
  const central = new Set([
    "AL",
    "AR",
    "IA",
    "IL",
    "KS",
    "LA",
    "MN",
    "MO",
    "MS",
    "ND",
    "NE",
    "OK",
    "SD",
    "TX",
    "WI",
  ]);
  const mountain = new Set(["AZ", "CO", "ID", "MT", "NM", "UT", "WY"]);
  const pacific = new Set(["CA", "NV", "OR", "WA"]);
  if (eastern.has(upper)) return "America/New_York";
  if (central.has(upper)) return "America/Chicago";
  if (mountain.has(upper)) return "America/Denver";
  if (pacific.has(upper)) return "America/Los_Angeles";
  if (upper === "AK") return "America/Anchorage";
  if (upper === "HI") return "Pacific/Honolulu";
  return null;
}

function parseDateValueWithTimeZone(
  value: unknown,
  timeZone: string | null,
  assumeLocal: boolean
): string | null {
  if (value instanceof Date) {
    return Number.isNaN(value.getTime()) ? null : value.toISOString();
  }

  const normalizedTimeZone = timeZone ? normalizeTimeZone(timeZone) : null;
  const offsetMatch =
    normalizedTimeZone?.match(/^([+-]\d{2}):?(\d{2})$/) ?? null;

  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) return null;

    if (hasTimeZoneDesignator(trimmed)) {
      if (normalizedTimeZone && assumeLocal) {
        const withoutTz = trimmed.replace(/[zZ]|[+-]\d{2}:?\d{2}$/, "");
        const parts = parseDateParts(withoutTz);
        if (parts) {
          const converted = toUtcIsoFromZonedParts(parts, normalizedTimeZone);
          if (converted) return converted;
        }
      }
      const parsed = new Date(trimmed);
      return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }

    if (offsetMatch) {
      const offset = `${offsetMatch[1]}:${offsetMatch[2]}`;
      const withOffset = `${trimmed}${offset}`;
      const parsed = new Date(withOffset);
      return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
    }

    if (normalizedTimeZone && assumeLocal) {
      const parts = parseDateParts(trimmed);
      if (!parts) return null;
      const converted = toUtcIsoFromZonedParts(parts, normalizedTimeZone);
      return converted ?? trimmed;
    }

    return trimmed;
  }

  if (typeof value === "number") {
    const ms = value < 1_000_000_000_000 ? value * 1000 : value;
    const date = new Date(ms);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
  }

  return null;
}

function extractImageUrl(value: unknown): string | null {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const item of value) {
      const extracted = extractImageUrl(item);
      if (extracted) return extracted;
    }
    return null;
  }
  if (value && typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const direct = pickStringFromPaths(obj, [
      "url",
      "src",
      "secure_url",
      "original",
      "large",
      "medium",
    ]);
    if (direct) return direct;
  }
  return null;
}

function extractAddressFromValue(value: unknown): {
  address: string;
  city: string;
  state: string;
} | null {
  if (!value) return null;
  if (typeof value === "string") {
    return parseAddress(value);
  }
  if (typeof value === "object") {
    const obj = value as Record<string, unknown>;
    const addressLine =
      pickStringFromPaths(obj, [
        "streetAddress",
        "address1",
        "line1",
        "street",
        "address",
      ]) || "";
    const city = pickStringFromPaths(obj, ["city", "town"]) || "";
    const state =
      pickStringFromPaths(obj, ["state", "region", "state_code"]) || "";
    const combined = [addressLine, city, state].filter(Boolean).join(", ");
    if (combined) {
      const parsed = parseAddress(combined);
      return {
        address: parsed.address || addressLine,
        city: city || parsed.city,
        state: state || parsed.state,
      };
    }
  }
  return null;
}

function extractLocationFields(raw: Record<string, unknown>): {
  venueName: string;
  address: string;
  city: string;
  state: string;
} {
  const venueName =
    pickStringFromPaths(raw, [
      ["venue", "name"],
      ["venue", "title"],
      ["location", "name"],
      "venue_name",
      "venueName",
      "location_name",
    ]) || "";

  const addressValue =
    getPathValue(raw, ["venue", "address"]) ??
    getPathValue(raw, ["location", "address"]) ??
    raw.address;

  const city =
    pickStringFromPaths(raw, [
      "city",
      ["venue", "city"],
      ["location", "city"],
      ["address", "city"],
    ]) || "";

  const state =
    pickStringFromPaths(raw, [
      "state",
      ["venue", "state"],
      ["location", "state"],
      ["address", "state"],
    ]) || "";

  const addressParsed = extractAddressFromValue(addressValue);
  const address =
    addressParsed?.address ||
    (typeof addressValue === "string" ? addressValue : "") ||
    "";

  return {
    venueName,
    address,
    city: city || addressParsed?.city || "Boston",
    state: state || addressParsed?.state || "MA",
  };
}

function extractTimeZone(raw: Record<string, unknown>): string | null {
  const timeZone =
    pickStringFromPaths(raw, [
      "timezone",
      "time_zone",
      "timeZone",
      "tz",
      ["venue", "timezone"],
      ["venue", "time_zone"],
      ["location", "timezone"],
      ["location", "time_zone"],
    ]) || null;
  return timeZone ? normalizeTimeZone(timeZone) : null;
}

function pickDateValue(
  raw: Record<string, unknown>,
  candidates: Array<{ path: string | string[]; assumeLocal: boolean }>
): { value: unknown; assumeLocal: boolean } | null {
  for (const candidate of candidates) {
    const value =
      typeof candidate.path === "string"
        ? raw[candidate.path]
        : getPathValue(raw, candidate.path);
    if (value !== undefined && value !== null && value !== "") {
      return { value, assumeLocal: candidate.assumeLocal };
    }
  }
  return null;
}

function mapPoshApiEvent(
  raw: Record<string, unknown>,
  group?: { name?: string; url?: string } | null
) {
  const title =
    pickStringFromPaths(raw, ["name", "title", "event_name", "eventName"]) ||
    "Untitled Event";

  const description = pickStringFromPaths(raw, [
    "description",
    "event_description",
    "summary",
    "details",
  ]);

  const imageCandidate =
    pickStringFromPaths(raw, [
      "image",
      "image_url",
      "cover_image_url",
      "coverImageUrl",
      "cover_image",
      "flyer",
      "flyer_url",
      "poster",
      "poster_url",
      "og_image",
    ]) ||
    extractImageUrl(raw.images) ||
    extractImageUrl(raw.image) ||
    null;
  const coverImageUrl = cleanPoshImageUrl(imageCandidate);

  const eventUrlFromObject = new Set<string>();
  collectEventUrlsFromObject(raw, eventUrlFromObject, new WeakSet<object>(), 0);
  const discoveredEventUrl = Array.from(eventUrlFromObject)[0] ?? null;

  const eventUrl =
    normalizePoshEventUrl(
      pickStringFromPaths(raw, [
        "url",
        "event_url",
        "eventUrl",
        "canonical_url",
        "canonicalUrl",
        "share_url",
        "shareUrl",
        "ticket_url",
        "ticketUrl",
        "link",
        "href",
        ["event", "url"],
        ["event", "event_url"],
        ["links", "canonical"],
        ["links", "self"],
      ])
    ) ||
    normalizePoshEventUrl(discoveredEventUrl) ||
    null;

  const slug =
    pickStringFromPaths(raw, [
      "slug",
      "event_slug",
      "eventSlug",
      "url_slug",
      "urlSlug",
      "url",
      ["event", "slug"],
      ["event", "eventSlug"],
    ]) ||
    (eventUrl ? extractSlugFromUrl(eventUrl, "e") : null) ||
    null;

  const externalIdRaw =
    pickStringFromPaths(raw, ["id", "event_id", "uuid"]) ||
    (typeof raw.id === "number" ? String(raw.id) : null) ||
    slug ||
    null;
  const externalId = externalIdRaw ? `posh-${externalIdRaw}` : null;

  const { venueName, address, city, state } = extractLocationFields(raw);
  const timeZone = extractTimeZone(raw) || timeZoneFromState(state);

  const startCandidate = pickDateValue(raw, [
    { path: "start_local", assumeLocal: true },
    { path: "start_time_local", assumeLocal: true },
    { path: "start_datetime_local", assumeLocal: true },
    { path: "start_at_local", assumeLocal: true },
    { path: ["start", "local"], assumeLocal: true },
    { path: ["start_at", "local"], assumeLocal: true },
    { path: ["start_time", "local"], assumeLocal: true },
    { path: "start", assumeLocal: Boolean(timeZone) },
    { path: "start_at", assumeLocal: Boolean(timeZone) },
    { path: "startAt", assumeLocal: Boolean(timeZone) },
    { path: "start_date", assumeLocal: Boolean(timeZone) },
    { path: "startDate", assumeLocal: Boolean(timeZone) },
    { path: "start_time", assumeLocal: Boolean(timeZone) },
    { path: "startTime", assumeLocal: Boolean(timeZone) },
    { path: "start_datetime", assumeLocal: Boolean(timeZone) },
  ]);

  const endCandidate = pickDateValue(raw, [
    { path: "end_local", assumeLocal: true },
    { path: "end_time_local", assumeLocal: true },
    { path: "end_datetime_local", assumeLocal: true },
    { path: "end_at_local", assumeLocal: true },
    { path: ["end", "local"], assumeLocal: true },
    { path: ["end_at", "local"], assumeLocal: true },
    { path: ["end_time", "local"], assumeLocal: true },
    { path: "end", assumeLocal: Boolean(timeZone) },
    { path: "end_at", assumeLocal: Boolean(timeZone) },
    { path: "endAt", assumeLocal: Boolean(timeZone) },
    { path: "end_date", assumeLocal: Boolean(timeZone) },
    { path: "endDate", assumeLocal: Boolean(timeZone) },
    { path: "end_time", assumeLocal: Boolean(timeZone) },
    { path: "endTime", assumeLocal: Boolean(timeZone) },
    { path: "end_datetime", assumeLocal: Boolean(timeZone) },
  ]);

  const startAt =
    (startCandidate
      ? parseDateValueWithTimeZone(
          startCandidate.value,
          timeZone,
          startCandidate.assumeLocal
        )
      : null) || null;

  const endAt =
    (endCandidate
      ? parseDateValueWithTimeZone(
          endCandidate.value,
          timeZone,
          endCandidate.assumeLocal
        )
      : null) || null;

  const organizerName =
    pickStringFromPaths(raw, [
      ["organizer", "name"],
      ["group", "name"],
      ["host", "name"],
      ["organization", "name"],
      "organizer_name",
    ]) ||
    group?.name ||
    null;

  const organizerUrl =
    pickStringFromPaths(raw, [
      ["organizer", "url"],
      ["group", "url"],
      ["host", "url"],
      ["organization", "url"],
      "organizer_url",
    ]) ||
    group?.url ||
    null;

  const eventStatus =
    pickStringFromPaths(raw, ["eventStatus", "event_status", "status"]) ||
    "EventScheduled";

  return {
    title,
    description: description || null,
    coverImageUrl,
    eventUrl: eventUrl || buildPoshEventUrlFromSlug(slug),
    externalId,
    startAt,
    endAt,
    venueName,
    address,
    city,
    state,
    categories: inferCategoriesFromText(title, description || null),
    visibility: "public" as const,
    source: "posh" as const,
    eventStatus,
    organizerName,
    organizerUrl,
  };
}

function extractEventCandidatesFromApi(
  data: unknown
): Record<string, unknown>[] {
  const paths: string[][] = [
    ["events"],
    ["data", "events"],
    ["group", "events"],
    ["data", "group", "events"],
    ["group", "upcoming_events"],
    ["data", "group", "upcoming_events"],
    ["result", "events"],
  ];

  for (const path of paths) {
    const value = getPathValue(data as Record<string, unknown>, path);
    if (Array.isArray(value)) {
      return value.filter(
        (item): item is Record<string, unknown> =>
          !!item && typeof item === "object"
      );
    }
    if (value && typeof value === "object") {
      const edges = (value as Record<string, unknown>).edges;
      if (Array.isArray(edges)) {
        return edges
          .map((edge) =>
            edge && typeof edge === "object"
              ? (edge as Record<string, unknown>).node
              : null
          )
          .filter(
            (item): item is Record<string, unknown> =>
              !!item && typeof item === "object"
          );
      }
      const nodes = (value as Record<string, unknown>).nodes;
      if (Array.isArray(nodes)) {
        return nodes.filter(
          (item): item is Record<string, unknown> =>
            !!item && typeof item === "object"
        );
      }
    }
  }

  const collected: Record<string, unknown>[] = [];
  collectEventObjects(data, collected, new WeakSet<object>(), 0);
  return collected;
}

function extractGroupInfoFromApi(
  data: unknown,
  fallbackEvents: Record<string, unknown>[]
): { name: string; url?: string } | null {
  const groupPaths: string[][] = [
    ["group"],
    ["data", "group"],
    ["result", "group"],
  ];

  for (const path of groupPaths) {
    const value = getPathValue(data as Record<string, unknown>, path);
    if (value && typeof value === "object") {
      const groupObj = value as Record<string, unknown>;
      const name = pickStringFromPaths(groupObj, ["name", "title"]) || "";
      if (name) {
        const url =
          pickStringFromPaths(groupObj, ["url"]) ||
          (pickStringFromPaths(groupObj, ["slug"])
            ? `https://posh.vip/g/${pickStringFromPaths(groupObj, ["slug"])}`
            : undefined);
        return { name, url: url || undefined };
      }
    }
  }

  if (fallbackEvents.length > 0) {
    const groupObj =
      (fallbackEvents[0].group as Record<string, unknown>) || null;
    if (groupObj) {
      const name = pickStringFromPaths(groupObj, ["name", "title"]) || "";
      if (name) {
        const url =
          pickStringFromPaths(groupObj, ["url"]) ||
          (pickStringFromPaths(groupObj, ["slug"])
            ? `https://posh.vip/g/${pickStringFromPaths(groupObj, ["slug"])}`
            : undefined);
        return { name, url: url || undefined };
      }
    }
  }

  return null;
}

async function fetchGroupEventsFromApi(groupUrl: string) {
  const groupSlug = extractSlugFromUrl(groupUrl, "g");
  if (!groupSlug) {
    return { events: [], organizer: null };
  }

  const apiUrl = `${POSH_GROUP_API_BASE}${groupSlug}`;
  const fetchResult = await fetchPoshResource(apiUrl, "application/json");
  const { response, body } = fetchResult;

  if (!response.ok) {
    throw new Error(
      `Failed to fetch Posh group API: ${describePoshResponse(fetchResult)}`
    );
  }

  let data: unknown;
  try {
    data = JSON.parse(body) as unknown;
  } catch {
    throw new Error(
      `Posh group API returned invalid JSON: ${describePoshResponse(fetchResult)}`
    );
  }
  const rawEvents = extractEventCandidatesFromApi(data);
  const organizer = extractGroupInfoFromApi(data, rawEvents);
  const now = new Date();
  const events = rawEvents
    .map((raw) => mapPoshApiEvent(raw, organizer))
    .filter((event) => event.startAt)
    .filter((event) => {
      const start = new Date(event.startAt!);
      return !Number.isNaN(start.getTime()) && start >= now;
    });

  return { events, organizer };
}

function parseAddress(fullAddress: string): {
  address: string;
  city: string;
  state: string;
} {
  // "1 E Pier Dr, East Boston, MA 02128, USA"
  // "60 State St, Boston, MA 02109"
  const parts = fullAddress.split(",").map((s) => s.trim());

  if (parts.length >= 3) {
    // Try to find state from parts like "MA 02128" or "MA"
    for (let i = parts.length - 1; i >= 1; i--) {
      const stateMatch = parts[i].match(/^([A-Z]{2})(?:\s+\d{5})?$/);
      if (stateMatch) {
        const state = stateMatch[1];
        const city = parts[i - 1]?.trim() || "";
        const streetParts = parts.slice(0, i - 1);
        return {
          address: streetParts.join(", ").trim() || fullAddress,
          city: city || "Boston",
          state,
        };
      }
    }
  }

  // Fallback: try regex for "City, ST ZIP"
  const match = fullAddress.match(/,\s*([^,]+),\s*([A-Z]{2})\s*\d{0,5}/);
  if (match) {
    return {
      address: fullAddress.split(",")[0]?.trim() || fullAddress,
      city: match[1].trim(),
      state: match[2],
    };
  }

  return { address: fullAddress, city: "Boston", state: "MA" };
}

function extractEventFromJsonLd(jsonLd: PoshJsonLd, eventUrl: string) {
  const imageUrl = Array.isArray(jsonLd.image)
    ? jsonLd.image[0]
    : jsonLd.image || null;

  // Clean up posh CDN image URL - extract the original S3 URL or use as-is
  const coverImageUrl = cleanPoshImageUrl(imageUrl);

  const fullAddress = jsonLd.location?.address?.streetAddress || "";
  const { address, city, state } = parseAddress(fullAddress);
  const timeZone = timeZoneFromState(state);

  // Extract external ID from the event URL slug
  const urlSlug = eventUrl.replace(/\/$/, "").split("/").pop();

  const title = jsonLd.name || "Untitled Event";
  const description = jsonLd.description || null;

  return {
    title,
    description,
    coverImageUrl,
    eventUrl,
    externalId: urlSlug ? `posh-${urlSlug}` : null,
    startAt: parseDateValueWithTimeZone(jsonLd.startDate, timeZone, true),
    endAt: parseDateValueWithTimeZone(jsonLd.endDate, timeZone, true),
    venueName: jsonLd.location?.name || "",
    address,
    city,
    state,
    categories: inferCategoriesFromText(title, description),
    visibility: "public" as const,
    source: "posh" as const,
    eventStatus: "EventScheduled",
    organizerName: jsonLd.organizer?.name || null,
    organizerUrl: jsonLd.organizer?.url || null,
  };
}

function extractEventFromStructuredData(data: unknown, eventUrl: string) {
  const candidates: Record<string, unknown>[] = [];
  collectEventObjects(data, candidates, new WeakSet<object>(), 0);
  if (candidates.length === 0) return null;

  const targetSlug = extractSlugFromUrl(eventUrl, "e");
  const best =
    candidates.find((candidate) => {
      const slug =
        pickStringFromPaths(candidate, ["slug", "event_slug", "eventSlug"]) ||
        null;
      if (slug && targetSlug && slug === targetSlug) return true;
      const url =
        normalizePoshEventUrl(
          pickStringFromPaths(candidate, ["url", "event_url", "eventUrl"])
        ) || null;
      return url ? url.includes(`/e/${targetSlug}`) : false;
    }) || candidates[0];

  return mapPoshApiEvent(best, null);
}

async function scrapeEventPage(url: string) {
  const fetchResult = await fetchPoshResource(
    url,
    "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8"
  );
  const { response, body: html } = fetchResult;

  if (!response.ok) {
    throw new Error(
      `Failed to fetch Posh event page: ${describePoshResponse(fetchResult)}`
    );
  }

  const $ = cheerio.load(html);

  // Older Posh pages render JSON-LD as a normal script element.
  let jsonLd = parseEventJsonLd($("#event-page-google-script").html());

  if (!jsonLd) {
    $('script[type="application/ld+json"]').each((_, el) => {
      jsonLd = parseEventJsonLd($(el).html());
      if (jsonLd) return false;
    });
  }

  // Current Posh pages stream the JSON-LD inside a Next.js React Flight record
  // instead of rendering the script element represented by that record.
  if (!jsonLd) {
    jsonLd = extractEventJsonLdFromReactFlight($);
  }

  if (!jsonLd) {
    const nextData = $("#__NEXT_DATA__").html();
    if (!nextData) {
      throw new Error(
        `Posh returned no recognizable event data (${describePoshResponse(fetchResult)})`
      );
    }
    try {
      const parsed = JSON.parse(nextData);
      const structuredEvent = extractEventFromStructuredData(parsed, url);
      if (structuredEvent) {
        return structuredEvent;
      }
    } catch {
      // fall through to error below
    }

    throw new Error(`No event data found in JSON-LD or Next.js data on ${url}`);
  }

  return extractEventFromJsonLd(jsonLd, url);
}

async function discoverEventUrls(groupUrl: string): Promise<string[]> {
  const fetchResult = await fetchPoshResource(groupUrl, "text/html");
  const { response, body: html } = fetchResult;

  if (!response.ok) {
    throw new Error(
      `Failed to fetch Posh group page: ${describePoshResponse(fetchResult)}`
    );
  }

  const $ = cheerio.load(html);

  return extractEventUrlsFromHtml(html, $);
}

export async function scrapePosh(urls: string[]) {
  // Separate group URLs from event URLs
  const eventUrls: string[] = [];
  const groupUrls: string[] = [];

  for (const url of urls) {
    const cleaned = url.trim();
    if (!cleaned) continue;
    if (!cleaned.includes("posh.vip")) {
      throw new Error(`Invalid URL: ${cleaned}. Must be a posh.vip URL.`);
    }
    if (cleaned.includes("/g/")) {
      groupUrls.push(cleaned);
    } else if (cleaned.includes("/e/")) {
      eventUrls.push(cleaned);
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const events: any[] = [];
  const errors: { url: string; error: string }[] = [];
  let organizerFromGroup: { name: string; url?: string } | null = null;

  // Try the group API first (best chance of full data)
  for (const groupUrl of groupUrls) {
    let groupEvents: any[] = [];
    let groupOrganizer: { name: string; url?: string } | null = null;
    let groupApiError: string | null = null;

    try {
      const result = await fetchGroupEventsFromApi(groupUrl);
      groupEvents = result.events;
      groupOrganizer = result.organizer;
    } catch (error) {
      groupApiError =
        error instanceof Error ? error.message : "Failed to scrape group API";
    }

    if (groupEvents.length > 0) {
      events.push(...groupEvents);
      if (!organizerFromGroup && groupOrganizer) {
        organizerFromGroup = groupOrganizer;
      }
      continue;
    }

    // Fallback: try to discover event URLs from group page HTML
    try {
      const discovered = await discoverEventUrls(groupUrl);
      eventUrls.push(...discovered);
      if (discovered.length === 0 && groupApiError) {
        errors.push({
          url: groupUrl,
          error: `${groupApiError}; group page contained no event URLs`,
        });
      }
    } catch (error) {
      const groupPageError =
        error instanceof Error ? error.message : "Failed to scrape group page";
      errors.push({
        url: groupUrl,
        error: groupApiError
          ? `${groupApiError}; ${groupPageError}`
          : groupPageError,
      });
    }
  }

  // Deduplicate URLs and skip any already sourced via group API
  const existingEventUrls = new Set(
    events
      .map((event) => event.eventUrl)
      .filter((url): url is string => typeof url === "string")
  );
  const uniqueUrls = [...new Set(eventUrls)].filter(
    (url) => !existingEventUrls.has(url)
  );

  // Process in batches of 5 to avoid overwhelming the server
  const batchSize = 5;
  if (uniqueUrls.length > 0) {
    for (let i = 0; i < uniqueUrls.length; i += batchSize) {
      const batch = uniqueUrls.slice(i, i + batchSize);
      const results = await Promise.allSettled(
        batch.map((url) => scrapeEventPage(url))
      );

      for (let j = 0; j < results.length; j++) {
        const result = results[j];
        if (result.status === "fulfilled") {
          events.push(result.value);
        } else {
          errors.push({
            url: batch[j],
            error: result.reason?.message || "Unknown error",
          });
        }
      }
    }
  }

  // Deduplicate by externalId or URL
  const seen = new Set<string>();
  const uniqueEvents = events.filter((event) => {
    const key =
      event.externalId || event.eventUrl || `${event.title}-${event.startAt}`;
    if (!key) return true;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Extract organizer info from group (preferred) or first event
  const organizer =
    organizerFromGroup ||
    (uniqueEvents[0]?.organizerName
      ? {
          name: uniqueEvents[0].organizerName,
          url: uniqueEvents[0].organizerUrl,
        }
      : null);

  return {
    organizer,
    events: uniqueEvents,
    totalEvents: uniqueEvents.length,
    errors: errors.length > 0 ? errors : undefined,
  };
}

export async function POST(request: NextRequest) {
  try {
    const { urls } = (await request.json()) as { urls: string[] };

    if (!urls || !Array.isArray(urls) || urls.length === 0) {
      return NextResponse.json(
        { error: "Please provide an array of Posh event URLs" },
        { status: 400 }
      );
    }

    const result = await scrapePosh(urls);

    if (result.events.length === 0) {
      console.error("[posh-scraper] Failed to scrape any events", {
        urls,
        details: result.errors,
      });
      return NextResponse.json(
        { error: "Failed to scrape any events", details: result.errors },
        { status: 502 }
      );
    }

    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: `Scraping failed: ${error instanceof Error ? error.message : "Unknown error"}`,
      },
      { status: 500 }
    );
  }
}
