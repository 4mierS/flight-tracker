import { prisma } from "../lib/db";
import { env } from "../lib/env";
import { getProvider } from "../lib/providers";
import type { FlightOffer } from "../lib/providers/types";
import { sendDealAlert } from "../lib/notify/telegram";
import { canSendNow, loadDailyCapState, type DailyCapState } from "./daily-cap";
import { collectDealsPerDay } from "./collect-by-day";
import { enumerateTrips } from "./enumerate-trips";
import type { Watch } from "@prisma/client";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ymd = (d: Date) => d.toISOString().slice(0, 10);

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) /
      86_400_000,
  );
}

/** Does an offer satisfy this watch's hard criteria? */
function matchesWatch(watch: Watch, o: FlightOffer): boolean {
  const departYmd = ymd(watch.departFrom);
  const departToYmd = ymd(watch.departTo);

  if (o.departDate < departYmd || o.departDate > departToYmd) {
    console.log(`[matchesWatch] REJECT depart date: offer=${o.departDate}, range=${departYmd}..${departToYmd}`);
    return false;
  }

  if (o.stops > watch.maxStops) {
    console.log(`[matchesWatch] REJECT stops: offer=${o.stops}, max=${watch.maxStops}`);
    return false;
  }

  if (watch.directOnly && o.stops !== 0) {
    console.log(`[matchesWatch] REJECT directOnly: offer stops=${o.stops}`);
    return false;
  }

  if (watch.tripType === "RETURN") {
    if (!o.returnDate) return false;
    if (watch.minStayDays && daysBetween(o.departDate, o.returnDate) < watch.minStayDays)
      return false;
    }

    const stay = daysBetween(o.departDate, o.returnDate);
    if (watch.minStayDays && stay < watch.minStayDays) {
      console.log(`[matchesWatch] REJECT min stay: offer stay=${stay} days, min=${watch.minStayDays}`);
      return false;
    }

    if (watch.maxStayDays && stay > watch.maxStayDays) {
      console.log(`[matchesWatch] REJECT max stay: offer stay=${stay} days, max=${watch.maxStayDays}`);
      return false;
    }
  }

  console.log(`[matchesWatch] ACCEPT ${o.origin}->${o.destination} ${o.departDate}/${o.returnDate}`);
  return true;
}

/** Fetch every matching offer for a watch by enumerating all valid trips first. */
async function collectOffers(watch: Watch): Promise<FlightOffer[]> {
  const provider = getProvider();
  const oneWay = watch.tripType === "ONE_WAY";

  // Enumerate all valid trips based on watch constraints
  const validTrips = enumerateTrips(watch);

  console.log(`[collectOffers] Watch: ${watch.label ?? watch.id}`);
  console.log(`[collectOffers] Valid trips enumerated: ${validTrips.length}`);
  console.log(`[collectOffers] Min stay: ${watch.minStayDays} days, Max stay: ${watch.maxStayDays} days`);
  console.log(`[collectOffers] Origins: ${watch.origins.join(", ")}, Destinations: ${watch.destinations.join(", ")}`);

  // Cache: monthMatrix results by (origin, destination, month)
  const cache = new Map<string, FlightOffer[]>();
  const cacheKey = (o: string, d: string, m: string) => `${o}:${d}:${m}`;

  const all: FlightOffer[] = [];

  // Query each valid trip
  for (const trip of validTrips) {
    const routeLabel = `${trip.origin}->${trip.destination}`;

    try {
      if (oneWay) {
        console.log(`[collectOffers] Fetching one-way: ${routeLabel} on ${trip.departDate}`);
        const offers = await provider.pricesForDates?.({
          origin: trip.origin,
          destination: trip.destination,
          departureAt: trip.departDate,
          oneWay: true,
          direct: watch.directOnly,
          currency: watch.currency,
          sorting: "price",
          limit: 100,
        }) || [];
        all.push(...offers.filter((o) => matchesWatch(watch, o)));
      } else {
        const returnDate = trip.returnDate!;
        console.log(
          `[collectOffers] Fetching round-trip: ${routeLabel} ${trip.departDate} → ${returnDate}`,
        );
        const offers = await provider.pricesForDates?.({
          origin: trip.origin,
          destination: trip.destination,
          departureAt: trip.departDate,
          returnAt: returnDate,
          oneWay: false,
          direct: watch.directOnly,
          currency: watch.currency,
          sorting: "price",
          limit: 100,
        }) || [];
        all.push(...offers.filter((o) => matchesWatch(watch, o)));
      }
    } catch (err) {
      console.error(
        `[${watch.label ?? watch.id}] ${routeLabel} ${trip.departDate}${trip.returnDate ? ` → ${trip.returnDate}` : ""}:`,
        err instanceof Error ? err.message : err,
      );
    }
    await sleep(env.PROVIDER_REQUEST_DELAY_MS);
  }

  return all;
}

function dedupeKey(
  watchId: string,
  kind: "THRESHOLD" | "NEW_LOW",
  o: FlightOffer,
): string {
  return [
    watchId,
    kind,
    `${o.origin}-${o.destination}`,
    o.departDate,
    o.returnDate ?? "OW",
    o.price,
  ].join(":");
}

/** Record the alert (dedupe via unique key) and send Telegram only if we won the insert. */
async function fireAlert(
  watch: Watch,
  kind: "THRESHOLD" | "NEW_LOW",
  offer: FlightOffer,
  previousBest: number | null,
  capState: DailyCapState,
): Promise<void> {
  const key = dedupeKey(watch.id, kind, offer);

  // Global daily cap: if we're already at the limit, skip BOTH the send and the
  // dedupe insert. Not writing the dedupe row is deliberate — the deal stays
  // eligible and can alert tomorrow once the cap resets.
  if (!(await canSendNow(prisma, capState))) {
    console.log(
      `[${watch.label ?? watch.id}] daily cap (${capState.cap}) reached — skipping ${kind} ${offer.origin}->${offer.destination} ${offer.price}`,
    );
    return;
  }

  // ON CONFLICT DO NOTHING: skipDuplicates means a unique-key collision yields
  // count: 0 instead of throwing, so we don't log a scary error or swallow real
  // DB failures (those still throw and propagate). count: 1 => we won the insert.
  const { count } = await prisma.alertSent.createMany({
    skipDuplicates: true,
    data: [
      {
        watchId: watch.id,
        kind,
        origin: offer.origin,
        destination: offer.destination,
        departDate: new Date(offer.departDate),
        returnDate: offer.returnDate ? new Date(offer.returnDate) : null,
        price: offer.price,
        dedupeKey: key,
      },
    ],
  });

  // Already alerted for this exact deal => stay quiet.
  if (count === 0) return;

  await sendDealAlert({
    kind,
    watchLabel: watch.label ?? `${offer.origin}->${offer.destination}`,
    offer,
    previousBest,
  });
}

/** Process one watch end-to-end: fetch, store, evaluate, alert. */
export async function processWatch(
  watch: Watch,
  capState: DailyCapState,
): Promise<void> {
  const tag = watch.label ?? watch.id;

  // 1) Historical best BEFORE inserting this run's data.
  const prior = await prisma.priceSnapshot.aggregate({
    where: { watchId: watch.id },
    _min: { price: true },
  });
  const previousBest = prior._min.price ?? null;

  // 2) Fetch + filter offers.
  const offers = await collectOffers(watch);
  if (offers.length === 0) {
    console.log(`[${tag}] no matching offers this run`);
    return;
  }

  // 3) Append-only snapshot write — store every matching observation.
  await prisma.priceSnapshot.createMany({
    data: offers.map((o) => ({
      watchId: watch.id,
      origin: o.origin,
      destination: o.destination,
      departDate: new Date(o.departDate),
      returnDate: o.returnDate ? new Date(o.returnDate) : null,
      stops: o.stops,
      price: o.price,
      currency: o.currency,
      airline: o.airline,
      link: o.link,
      foundAt: o.foundAt,
    })),
  });

  // 4) Current best offer this run.
  const best = offers.reduce((a, b) => (b.price < a.price ? b : a));
  console.log(
    `[${tag}] best ${best.origin}->${best.destination} ${best.price} ${best.currency} (prev best ${previousBest ?? "—"})`,
  );

  // 5) Alerts (skipped while snoozed; snapshots above are still recorded).
  const snoozed = watch.snoozeUntil && watch.snoozeUntil > new Date();
  if (snoozed) {
    console.log(`[${tag}] snoozed until ${watch.snoozeUntil?.toISOString()}`);
    return;
  }

  if (previousBest === null || best.price < previousBest) {
    await fireAlert(watch, "NEW_LOW", best, previousBest, capState);
  }
  if (watch.threshold !== null && best.price <= watch.threshold) {
    await fireAlert(watch, "THRESHOLD", best, previousBest, capState);
  }
}

/**
 * Process a single watch by id, on demand (the GUI "Search now" button). Runs
 * regardless of the `active` flag — the user asked for it explicitly — but
 * snapshots/alerts behave exactly as in the scheduled path (snooze still
 * suppresses alerts).
 */
export async function processWatchById(id: string): Promise<void> {
  const capState = await loadDailyCapState(prisma);
  const watch = await prisma.watch.findUnique({ where: { id } });
  if (!watch) throw new Error(`Watch not found: ${id}`);
  console.log(`Manual search: ${watch.label ?? watch.id}`);
  await processWatch(watch, capState);
  console.log("Manual search complete");
}

/**
 * Process a watch using per-day queries: fetch top 2 deals for nonstop
 * and 1-stop flights, then store and alert.
 */
export async function processWatchPerDay(
  watch: Watch,
  capState: DailyCapState,
): Promise<void> {
  const tag = watch.label ?? watch.id;

  // 1) Historical best BEFORE this run
  const prior = await prisma.priceSnapshot.aggregate({
    where: { watchId: watch.id },
    _min: { price: true },
  });
  const previousBest = prior._min.price ?? null;

  // 2) Collect top deals per day
  const dailyDeals = await collectDealsPerDay(watch);
  if (dailyDeals.length === 0) {
    console.log(`[${tag}] no matching offers this run`);
    return;
  }

  // 3) Flatten all offers and store snapshots
  const allOffers: FlightOffer[] = [];
  for (const category of dailyDeals) {
    allOffers.push(...category.deals);
  }

  await prisma.priceSnapshot.createMany({
    data: allOffers.map((o) => ({
      watchId: watch.id,
      origin: o.origin,
      destination: o.destination,
      departDate: new Date(o.departDate),
      returnDate: o.returnDate ? new Date(o.returnDate) : null,
      stops: o.stops,
      price: o.price,
      currency: o.currency,
      airline: o.airline,
      link: o.link,
      foundAt: o.foundAt,
    })),
  });

  // 4) Find best overall
  const best = allOffers.reduce((a, b) => (b.price < a.price ? b : a));
  console.log(
    `[${tag}] best ${best.origin}->${best.destination} ${best.price} ${best.currency} (${best.stops === 0 ? "nonstop" : best.stops + " stops"}) (prev best ${previousBest ?? "—"})`,
  );

  // 5) Alerts (check snooze first)
  const snoozed = watch.snoozeUntil && watch.snoozeUntil > new Date();
  if (snoozed) {
    console.log(`[${tag}] snoozed until ${watch.snoozeUntil?.toISOString()}`);
    return;
  }

  if (previousBest === null || best.price < previousBest) {
    await fireAlert(watch, "NEW_LOW", best, previousBest, capState);
  }
  if (watch.threshold !== null && best.price <= watch.threshold) {
    await fireAlert(watch, "THRESHOLD", best, previousBest, capState);
  }
}

/** Process all active watches sequentially (keeps us under rate limits). */
export async function processAllWatches(): Promise<void> {
  // Load the cap + today's boundary once; canSendNow re-counts live per alert.
  const capState = await loadDailyCapState(prisma);
  const watches = await prisma.watch.findMany({ where: { active: true } });
  console.log(
    `Run start: ${watches.length} active watch(es)` +
      (capState.cap !== null ? `, daily cap ${capState.cap}` : ""),
  );
  for (const watch of watches) {
    await processWatch(watch, capState).catch((err) =>
      console.error(`[${watch.label ?? watch.id}] fatal:`, err),
    );
  }
  console.log("Run complete");
}
