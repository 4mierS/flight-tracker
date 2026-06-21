import { getProvider } from "../lib/providers";
import type { FlightOffer } from "../lib/providers/types";
import type { Watch } from "@prisma/client";

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (dateStr: string, days: number): string => {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

const daysBetween = (a: string, b: string): number => {
  return Math.round(
    (new Date(b + "T00:00:00Z").getTime() - new Date(a + "T00:00:00Z").getTime()) /
      86_400_000,
  );
};

export interface DailyDealResult {
  stops: number; // 0 = nonstop, 1 = one-stop
  stopsLabel: string;
  deals: FlightOffer[]; // up to 2 cheapest per category
}

/**
 * Per-day API queries: enumerate every departure day, query each day,
 * and return the 2 cheapest for nonstop (stops=0) and 1-stop (stops=1).
 */
export async function collectDealsPerDay(watch: Watch): Promise<DailyDealResult[]> {
  const provider = getProvider();
  const oneWay = watch.tripType === "ONE_WAY";

  const departFromStr = ymd(watch.departFrom);
  const departToStr = ymd(watch.departTo);
  const minStay = watch.minStayDays ?? 0;
  const maxStay = watch.maxStayDays ?? 0;

  console.log(`[collectDealsPerDay] Watch: ${watch.label ?? watch.id}`);
  console.log(
    `[collectDealsPerDay] Daily queries: ${departFromStr} to ${departToStr}`,
  );
  console.log(
    `[collectDealsPerDay] Stay: ${minStay}-${maxStay} days, Routes: ${watch.origins.join(",")} → ${watch.destinations.join(",")}`,
  );

  // Group offers by stops category
  const offersNonstop: FlightOffer[] = [];
  const offersOneStop: FlightOffer[] = [];

  // Iterate each departure day
  let curDepart = new Date(departFromStr + "T00:00:00Z");
  const departToDate = new Date(departToStr + "T00:00:00Z");

  while (curDepart <= departToDate) {
    const departDateStr = curDepart.toISOString().slice(0, 10);

    for (const origin of watch.origins) {
      for (const destination of watch.destinations) {
        if (oneWay) {
          // One-way: single query per day
          try {
            console.log(
              `[collectDealsPerDay] Fetching one-way: ${origin}->${destination} on ${departDateStr}`,
            );
            const offers = await provider.pricesForDates?.({
              origin,
              destination,
              departureAt: departDateStr,
              oneWay: true,
              direct: watch.directOnly,
              currency: watch.currency,
              sorting: "price",
              limit: 100,
            }) || [];

            // Filter by stops
            for (const offer of offers) {
              if (watch.directOnly || offer.stops === 0) {
                offersNonstop.push(offer);
              } else if (offer.stops === 1) {
                offersOneStop.push(offer);
              }
            }
          } catch (err) {
            console.error(
              `[${watch.label ?? watch.id}] ${origin}->${destination} ${departDateStr}:`,
              err instanceof Error ? err.message : err,
            );
          }
        } else {
          // Round trip: query for each stay duration
          for (let stayDays = minStay; stayDays <= maxStay; stayDays++) {
            const returnDateStr = addDays(departDateStr, stayDays);

            try {
              console.log(
                `[collectDealsPerDay] Fetching round-trip: ${origin}->${destination} ${departDateStr} + ${stayDays} days`,
              );
              const offers = await provider.pricesForDates?.({
                origin,
                destination,
                departureAt: departDateStr,
                returnAt: returnDateStr,
                oneWay: false,
                direct: watch.directOnly,
                currency: watch.currency,
                sorting: "price",
                limit: 100,
              }) || [];

              // Validate return date is in window
              if (
                watch.returnFrom &&
                (returnDateStr < ymd(watch.returnFrom) || returnDateStr > ymd(watch.returnTo!))
              ) {
                continue;
              }

              // Filter by stops
              for (const offer of offers) {
                if (watch.directOnly || offer.stops === 0) {
                  offersNonstop.push(offer);
                } else if (offer.stops === 1) {
                  offersOneStop.push(offer);
                }
              }
            } catch (err) {
              console.error(
                `[${watch.label ?? watch.id}] ${origin}->${destination} ${departDateStr}+${stayDays}:`,
                err instanceof Error ? err.message : err,
              );
            }
          }
        }
      }
    }

    curDepart.setUTCDate(curDepart.getUTCDate() + 1);
  }

  // Sort and take top 2 for each category
  const nonstopTop2 = offersNonstop
    .sort((a, b) => a.price - b.price)
    .slice(0, 2);

  const oneStopTop2 = offersOneStop
    .sort((a, b) => a.price - b.price)
    .slice(0, 2);

  const results: DailyDealResult[] = [];

  if (nonstopTop2.length > 0) {
    results.push({
      stops: 0,
      stopsLabel: "Nonstop",
      deals: nonstopTop2,
    });
  }

  if (oneStopTop2.length > 0) {
    results.push({
      stops: 1,
      stopsLabel: "One-stop",
      deals: oneStopTop2,
    });
  }

  // Log results
  console.log(`[collectDealsPerDay] Found ${offersNonstop.length} nonstop offers, top 2:`);
  for (const offer of nonstopTop2) {
    console.log(
      `  ${offer.origin}->${offer.destination} ${offer.departDate} → ${offer.returnDate ?? "one-way"} : ${offer.price} ${offer.currency}`,
    );
  }

  console.log(`[collectDealsPerDay] Found ${offersOneStop.length} one-stop offers, top 2:`);
  for (const offer of oneStopTop2) {
    console.log(
      `  ${offer.origin}->${offer.destination} ${offer.departDate} → ${offer.returnDate ?? "one-way"} : ${offer.price} ${offer.currency}`,
    );
  }

  return results;
}
