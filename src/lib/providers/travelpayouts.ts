import type {
  FlightDataProvider,
  FlightOffer,
  MonthMatrixQuery,
  NearbyQuery,
  OfferQuery,
} from "./types";

const BASE = "https://api.travelpayouts.com";
const AVIASALES_WEB = "https://www.aviasales.com";

/** Standard Travelpayouts envelope: { success, data, error }. */
interface Envelope<T> {
  success: boolean;
  data: T;
  error: string | null;
}

/** Raw row from /aviasales/v3/prices_for_dates (price + transfers). */
interface PricesForDatesRow {
  origin: string;
  destination: string;
  origin_airport?: string;
  destination_airport?: string;
  price: number;
  airline?: string;
  flight_number?: number | string;
  departure_at: string; // ISO
  return_at?: string; // ISO
  transfers: number;
  return_transfers?: number;
  link?: string;
}

/** Raw row from /v2/prices/month-matrix & /aviasales/v3/get_latest_prices
 *  (value + number_of_changes). */
interface ValueRow {
  origin: string;
  destination: string;
  depart_date: string; // YYYY-MM-DD
  return_date?: string; // YYYY-MM-DD or ""
  number_of_changes: number;
  value: number;
  found_at?: string;
}

interface TravelpayoutsOptions {
  token: string;
  /** Cache market, e.g. "us" | "uk" | "ru". Optional. */
  market?: string;
  /** ms to wait between calls (rate-limit politeness); applied by caller. */
}

function toDateOnly(iso?: string | null): string | null {
  if (!iso) return null;
  // Accept both "2026-07-28T07:00:00+02:00" and "2026-07-28".
  return iso.slice(0, 10);
}

export class TravelpayoutsProvider implements FlightDataProvider {
  readonly name = "travelpayouts";
  private token: string;
  private market?: string;

  constructor(opts: TravelpayoutsOptions) {
    this.token = opts.token;
    this.market = opts.market;
  }

  private async get<T>(
    path: string,
    params: Record<string, string | number | boolean | undefined>,
  ): Promise<T> {
    const url = new URL(`${BASE}${path}`);
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
    }
    if (this.market) url.searchParams.set("market", this.market);

    console.log(`[Travelpayouts API] GET ${path}`);
    console.log(`[Travelpayouts API] URL: ${url.toString()}`);
    console.log(`[Travelpayouts API] Params:`, params);

    const res = await fetch(url, {
      headers: {
        "X-Access-Token": this.token,
        "Accept-Encoding": "gzip, deflate",
      },
    });

    console.log(`[Travelpayouts API] Response status: ${res.status} ${res.statusText}`);

    if (!res.ok) {
      const text = await res.text();
      console.log(`[Travelpayouts API] Error body:`, text);
      throw new Error(
        `Travelpayouts ${path} -> HTTP ${res.status} ${res.statusText}`,
      );
    }

    const body = (await res.json()) as Envelope<T>;
    if (!body.success) {
      console.log(`[Travelpayouts API] API error:`, body.error);
      throw new Error(`Travelpayouts ${path} -> ${body.error ?? "unknown error"}`);
    }
    console.log(`[Travelpayouts API] Success, returned ${(body.data as any[])?.length ?? 0} items`);
    return body.data;
  }

  /** v1 workhorse: cheapest offers for one route over a departure window. */
  async searchOffers(q: OfferQuery): Promise<FlightOffer[]> {
    // Dates are already passed as YYYY-MM-DD from collectOffers
    const departureAt = q.departureAt;
    const returnAt = q.returnAt;

    console.log(`[searchOffers] Query: ${q.origin} -> ${q.destination}`);
    console.log(`[searchOffers] Departure: ${departureAt}, Return: ${returnAt}, OneWay: ${q.oneWay}`);

    const rows = await this.get<PricesForDatesRow[]>(
      "/aviasales/v3/prices_for_dates",
      {
        origin: q.origin,
        destination: q.destination,
        departure_at: departureAt,
        return_at: returnAt,
        // For round trips we must send one_way=false to get multiple offers;
        // one_way=true collapses results to a single ticket due to grouping.
        one_way: q.oneWay,
        direct: q.directOnly,
        currency: q.currency.toLowerCase(),
        sorting: "price",
        limit: q.limit ?? 100,
        page: 1,
      },
    );

    return (rows ?? []).map((r) => ({
      origin: r.origin,
      destination: r.destination,
      originAirport: r.origin_airport,
      destinationAirport: r.destination_airport,
      departDate: toDateOnly(r.departure_at)!,
      returnDate: q.oneWay ? null : toDateOnly(r.return_at),
      stops: r.transfers ?? 0,
      price: r.price,
      currency: q.currency,
      airline: r.airline,
      link: r.link ? `${AVIASALES_WEB}${r.link}` : undefined,
    }));
  }

  /** v2: cheapest price per day across a month (number_of_changes + value). */
  async monthMatrix(q: MonthMatrixQuery): Promise<FlightOffer[]> {
    const rows = await this.get<ValueRow[]>("/v2/prices/month-matrix", {
      origin: q.origin,
      destination: q.destination,
      month: q.month,
      one_way: q.oneWay,
      currency: q.currency.toLowerCase(),
      show_to_affiliates: true,
      limit: 31,
    });

    return (rows ?? []).map((r) => ({
      origin: r.origin,
      destination: r.destination,
      departDate: toDateOnly(r.depart_date)!,
      returnDate: q.oneWay ? null : toDateOnly(r.return_date) || null,
      stops: r.number_of_changes ?? 0,
      price: r.value,
      currency: q.currency,
      foundAt: r.found_at ? new Date(r.found_at) : undefined,
    }));
  }

  /** v2: nearby-airport expansion (note: this endpoint nests under `prices`). */
  async nearbyMatrix(q: NearbyQuery): Promise<FlightOffer[]> {
    // nearest-places-matrix returns { prices: [...] }, not the standard
    // envelope — so we fetch raw here rather than via this.get().
    const url = new URL(`${BASE}/v2/prices/nearest-places-matrix`);
    url.searchParams.set("origin", q.origin);
    url.searchParams.set("destination", q.destination);
    url.searchParams.set("currency", q.currency.toLowerCase());
    url.searchParams.set("distance", String(q.distanceKm));
    url.searchParams.set("limit", String(q.limit ?? 10));
    url.searchParams.set("show_to_affiliates", "true");
    if (this.market) url.searchParams.set("market", this.market);

    const res = await fetch(url, {
      headers: { "X-Access-Token": this.token },
    });
    if (!res.ok) throw new Error(`Travelpayouts nearby -> HTTP ${res.status}`);
    const body = (await res.json()) as { prices?: ValueRow[] };

    return (body.prices ?? []).map((r) => ({
      origin: r.origin,
      destination: r.destination,
      departDate: toDateOnly(r.depart_date)!,
      returnDate: toDateOnly(r.return_date) || null,
      stops: r.number_of_changes ?? 0,
      price: r.value,
      currency: q.currency,
      foundAt: r.found_at ? new Date(r.found_at) : undefined,
    }));
  }
}
