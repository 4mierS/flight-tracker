import type { Watch } from "@prisma/client";

const ymd = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (dateStr: string, days: number): string => {
  const d = new Date(dateStr + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/**
 * Derive the return date window from depart window + stay range.
 * For RETURN trips only; ONE_WAY returns null.
 */
export function deriveReturnWindow(watch: Watch): {
  returnFrom: string;
  returnTo: string;
} | null {
  if (watch.tripType === "ONE_WAY") return null;

  const departFromStr = ymd(watch.departFrom);
  const departToStr = ymd(watch.departTo);
  const minStay = watch.minStayDays ?? 0;
  const maxStay = watch.maxStayDays ?? 365;

  const returnFrom = addDays(departFromStr, minStay);
  const returnTo = addDays(departToStr, maxStay);

  return { returnFrom, returnTo };
}

/** A single valid trip in a watch's enumeration. */
export interface Trip {
  origin: string;
  destination: string;
  departDate: string; // YYYY-MM-DD
  returnDate: string | null; // YYYY-MM-DD (or null for one-way)
}

/**
 * Enumerate all valid trips for a watch.
 * Returns Cartesian product: origins × destinations × departure dates × (return dates if applicable).
 *
 * For RETURN trips, stay length is fixed by each iteration through stayDays range.
 * For ONE_WAY trips, return dates are always null.
 */
export function enumerateTrips(watch: Watch): Trip[] {
  const trips: Trip[] = [];
  const departFromStr = ymd(watch.departFrom);
  const departToStr = ymd(watch.departTo);
  const minStay = watch.minStayDays ?? 0;
  const maxStay = watch.maxStayDays ?? 365;

  const isOneWay = watch.tripType === "ONE_WAY";

  for (const origin of watch.origins) {
    for (const destination of watch.destinations) {
      // Iterate outbound dates
      let curDepart = new Date(departFromStr + "T00:00:00Z");
      const departToDate = new Date(departToStr + "T00:00:00Z");

      while (curDepart <= departToDate) {
        const departDateStr = curDepart.toISOString().slice(0, 10);

        if (isOneWay) {
          trips.push({
            origin,
            destination,
            departDate: departDateStr,
            returnDate: null,
          });
        } else {
          // For each valid stay duration
          for (let stayDays = minStay; stayDays <= maxStay; stayDays++) {
            const returnDate = new Date(curDepart);
            returnDate.setUTCDate(returnDate.getUTCDate() + stayDays);
            const returnDateStr = returnDate.toISOString().slice(0, 10);

            trips.push({
              origin,
              destination,
              departDate: departDateStr,
              returnDate: returnDateStr,
            });
          }
        }

        curDepart.setUTCDate(curDepart.getUTCDate() + 1);
      }
    }
  }

  return trips;
}

/**
 * Count total combos for testing / logging.
 * For RETURN: origins × destinations × departDays × (maxStay - minStay + 1)
 * For ONE_WAY: origins × destinations × departDays
 */
export function countTrips(watch: Watch): number {
  const departFromStr = ymd(watch.departFrom);
  const departToStr = ymd(watch.departTo);

  const departDays =
    Math.round(
      (new Date(departToStr + "T00:00:00Z").getTime() -
        new Date(departFromStr + "T00:00:00Z").getTime()) /
        86_400_000,
    ) + 1;

  const originCount = watch.origins.length;
  const destCount = watch.destinations.length;

  if (watch.tripType === "ONE_WAY") {
    return originCount * destCount * departDays;
  }

  const minStay = watch.minStayDays ?? 0;
  const maxStay = watch.maxStayDays ?? 365;
  const stayRange = maxStay - minStay + 1;

  return originCount * destCount * departDays * stayRange;
}
