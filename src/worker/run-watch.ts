import { prisma } from "../lib/db";
import { env } from "../lib/env";
import { getProvider } from "../lib/providers";
import type { FlightOffer } from "../lib/providers/types";
import { sendDealAlert } from "../lib/notify/telegram";
import { canSendNow, loadDailyCapState, type DailyCapState } from "./daily-cap";
import type { Watch } from "@prisma/client";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const ym = (d: Date) => d.toISOString().slice(0, 7);

/** Distinct year-months ("YYYY-MM") spanned by [from, to] inclusive. */
function monthsBetween(from: Date, to: Date): string[] {
  const out: string[] = [];
  const cur = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1));
  const end = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  while (cur <= end) {
    out.push(ym(cur));
    cur.setUTCMonth(cur.getUTCMonth() + 1);
  }
  return out;
}

function daysBetween(a: string, b: string): number {
  return Math.round(
    (new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) /
      86_400_000,
  );
}

/** Does an offer satisfy this watch's hard criteria? */
function matchesWatch(watch: Watch, o: FlightOffer): boolean {
  if (o.departDate < ymd(watch.departFrom) || o.departDate > ymd(watch.departTo))
    return false;
  if (o.stops > watch.maxStops) return false;
  if (watch.directOnly && o.stops !== 0) return false;

  if (watch.tripType === "RETURN") {
    if (!o.returnDate) return false;
    if (
      watch.returnFrom &&
      (o.returnDate < ymd(watch.returnFrom) || o.returnDate > ymd(watch.returnTo!))
    )
      return false;
    if (watch.minStayDays && daysBetween(o.departDate, o.returnDate) < watch.minStayDays)
      return false;
    if (watch.maxStayDays && daysBetween(o.departDate, o.returnDate) > watch.maxStayDays)
      return false;
  }
  return true;
}

/**
 * Calculate which return months are valid for a given departure month.
 * A return month is valid if:
 *   minStayDays <= (returnMonth_end - departMonth_start) AND
 *   maxStayDays >= (returnMonth_start - departMonth_end)
 */
function getValidReturnMonths(
  departMonth: string,
  minStayDays: number | null,
  maxStayDays: number | null,
  availableReturnMonths: string[],
): string[] {
  if (!minStayDays && !maxStayDays) return availableReturnMonths;

  const [depYear, depM] = departMonth.split("-").map(Number);
  const departStart = new Date(Date.UTC(depYear, depM - 1, 1));
  const departEnd = new Date(Date.UTC(depYear, depM, 0)); // Last day of month

  return availableReturnMonths.filter((retMonth) => {
    const [retYear, retM] = retMonth.split("-").map(Number);
    const returnStart = new Date(Date.UTC(retYear, retM - 1, 1));
    const returnEnd = new Date(Date.UTC(retYear, retM, 0)); // Last day of month

    // Earliest possible return date (depart start + min stay)
    const earliestReturn = minStayDays
      ? new Date(departStart.getTime() + minStayDays * 86_400_000)
      : departStart;

    // Latest possible return date (depart end + max stay)
    const latestReturn = maxStayDays
      ? new Date(departEnd.getTime() + maxStayDays * 86_400_000)
      : new Date(8640000000000000); // Far future

    // Return month overlaps with [earliestReturn, latestReturn]
    return returnEnd >= earliestReturn && returnStart <= latestReturn;
  });
}

/** Fetch every matching offer for a watch using month-based searches (cached, minimal API calls). */
async function collectOffers(watch: Watch): Promise<FlightOffer[]> {
  const provider = getProvider();
  const oneWay = watch.tripType === "ONE_WAY";

  // Extract months from date ranges
  const departMonths = monthsBetween(watch.departFrom, watch.departTo);
  const allReturnMonths = oneWay || !watch.returnFrom ? [] : monthsBetween(watch.returnFrom, watch.returnTo!);

  console.log(`[collectOffers] Watch: ${watch.label ?? watch.id}`);
  console.log(`[collectOffers] Departure months: ${departMonths.join(", ")}`);
  console.log(`[collectOffers] Min stay: ${watch.minStayDays} days, Max stay: ${watch.maxStayDays} days`);
  console.log(`[collectOffers] Origins: ${watch.origins.join(", ")}, Destinations: ${watch.destinations.join(", ")}`);

  // Cache: monthMatrix results by (origin, destination, month)
  const cache = new Map<string, FlightOffer[]>();
  const cacheKey = (o: string, d: string, m: string) => `${o}:${d}:${m}`;

  const all: FlightOffer[] = [];

  for (const origin of watch.origins) {
    for (const destination of watch.destinations) {
      for (const departMonth of departMonths) {
        // Calculate valid return months for this departure month
        const validReturnMonths = oneWay
          ? [undefined]
          : getValidReturnMonths(departMonth, watch.minStayDays, watch.maxStayDays, allReturnMonths);

        if (!oneWay && validReturnMonths.length === 0) {
          console.log(
            `[collectOffers] Skipping ${origin}->${destination} ${departMonth}: no valid return months`,
          );
          continue;
        }

        // Fetch departure month (use cache if already fetched)
        const key = cacheKey(origin, destination, departMonth);
        let departOffers = cache.get(key);

        if (!departOffers) {
          try {
            console.log(`[collectOffers] Fetching ${origin}->${destination} month ${departMonth}`);
            departOffers = await provider.monthMatrix?.({
              origin,
              destination,
              month: departMonth,
              oneWay,
              currency: watch.currency,
            }) || [];
            cache.set(key, departOffers);
          } catch (err) {
            console.error(
              `[${watch.label ?? watch.id}] ${origin}->${destination} ${departMonth}:`,
              err instanceof Error ? err.message : err,
            );
            departOffers = [];
          }
          await sleep(env.PROVIDER_REQUEST_DELAY_MS);
        } else {
          console.log(`[collectOffers] Using cached ${origin}->${destination} month ${departMonth}`);
        }

        // Filter offers to match watch criteria
        for (const offer of departOffers) {
          // Check if return date falls in any valid return month (if round-trip)
          if (!oneWay) {
            if (!offer.returnDate) continue;
            const retMonth = ym(new Date(offer.returnDate + "T00:00:00Z"));
            if (!validReturnMonths.includes(retMonth)) continue;
          }

          // Check all other watch criteria
          if (matchesWatch(watch, offer)) {
            all.push(offer);
          }
        }
      }
    }
  }

  console.log(
    `[collectOffers] Done: ${all.length} matching offers from ${cache.size} API calls`,
  );
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
