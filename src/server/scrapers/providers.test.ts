import assert from "node:assert/strict";
import { test } from "node:test";
import { scrapeTicketmaster } from "@/server/scrapers/providers/ticketmaster";
import { scrapeEventbrite } from "@/server/scrapers/providers/eventbrite";
import { scrapeDice } from "@/server/scrapers/providers/dice";
import { scrapePosh } from "@/server/scrapers/providers/posh";
import { withScrapeRuntime } from "./runtime";

const runtime = () => ({
  signal: AbortSignal.timeout(5_000),
  warnings: [],
  cooldownUntil: null,
  incomplete: false,
});

test("batch Ticketmaster follows all pages while legacy stays on its original page", async (t) => {
  const previous = process.env.TICKETMASTER_API_KEY;
  process.env.TICKETMASTER_API_KEY = "test";
  t.after(() => {
    if (previous === undefined) delete process.env.TICKETMASTER_API_KEY;
    else process.env.TICKETMASTER_API_KEY = previous;
  });
  const pages: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL) => {
    const url = new URL(input);
    if (url.pathname.endsWith("venues.json"))
      return Response.json({
        _embedded: {
          venues: [
            {
              id: "venue",
              name: "Example",
              city: { name: "Chicago" },
              state: { stateCode: "IL" },
            },
          ],
        },
      });
    pages.push(url.searchParams.get("page") ?? "0");
    return Response.json({
      page: { totalPages: 3 },
      _embedded: { events: [] },
    });
  });
  await withScrapeRuntime(runtime(), () =>
    scrapeTicketmaster({ venueName: "Example", stateCode: "IL" })
  );
  assert.deepEqual(pages, ["0", "1", "2"]);
  pages.length = 0;
  await scrapeTicketmaster({ venueName: "Example", stateCode: "IL" });
  assert.deepEqual(pages, ["0"]);
});

test("Eventbrite reports truncation rather than complete success at its page cap", async (t) => {
  const previous = process.env.EVENTBRITE_PRIVATE_TOKEN;
  process.env.EVENTBRITE_PRIVATE_TOKEN = "test";
  t.after(() => {
    if (previous === undefined) delete process.env.EVENTBRITE_PRIVATE_TOKEN;
    else process.env.EVENTBRITE_PRIVATE_TOKEN = previous;
  });
  let pages = 0;
  t.mock.method(globalThis, "fetch", async () => {
    pages++;
    return Response.json({ pagination: { has_more_items: true }, events: [] });
  });
  const result = await withScrapeRuntime(runtime(), () =>
    scrapeEventbrite("https://www.eventbrite.com/o/example-123456")
  );
  assert.equal(pages, 20);
  assert.equal(result.complete, false);
});

test("DICE detail failures make a batch incomplete without failing legacy parsing", async (t) => {
  const listing = `<script type="application/ld+json">${JSON.stringify({ "@type": "Place", name: "Example", address: "1 Main St, Chicago, IL 60601, USA", event: [{ name: "Show", url: "https://dice.fm/event/012345678901234567890123", startDate: "2027-01-01T20:00:00Z" }] })}</script>`;
  t.mock.method(globalThis, "fetch", async (input: string | URL) =>
    new URL(input).pathname.startsWith("/venue/")
      ? new Response(listing)
      : new Response("error", { status: 503 })
  );
  const context = runtime();
  const result = await withScrapeRuntime(context, () =>
    scrapeDice("https://dice.fm/venue/example")
  );
  assert.equal(result.events.length, 1);
  assert.equal(context.incomplete, true);
});

test("Posh never invents Boston/MA when a listing has no location", async (t) => {
  const jsonLd = {
    "@type": "Event",
    name: "Example",
    startDate: "2027-01-01T20:00:00Z",
  };
  t.mock.method(
    globalThis,
    "fetch",
    async () =>
      new Response(
        `<script id="event-page-google-script" type="application/ld+json">${JSON.stringify(jsonLd)}</script>`
      )
  );
  const result = await scrapePosh(["https://posh.vip/e/example"]);
  assert.equal(result.events.length, 1);
  assert.equal(result.events[0].city, "");
  assert.equal(result.events[0].state, "");
});
