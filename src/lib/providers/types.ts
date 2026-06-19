/**
 * The data-source boundary.
 *
 * Everything downstream (worker, alerts, dashboard) speaks ONLY in the
 * normalized `FlightOffer` shape below. Swapping Travelpayouts for another
 * provider later means writing one new file that implements this interface —
 * nothing else changes.
 *
 * Why this matters concretely: Travelpayouts itself is inconsistent across its
 * own endpoints (`prices_for_dates` returns `price`+`transfers`;
 * `month-matrix`/`get_latest_prices` return `value`+`number_of_changes`). The
 * provider absorbs that mess so the rest of the app never sees it.
 */

/** A single normalized fare. `price` is whole currency units. */
export interface FlightOffer {
  origin: string;
  destination: string;
  originAirport?: string;
  destinationAirport?: string;
  /** YYYY-MM-DD */
  departDate: string;
  /** YYYY-MM-DD, or null for one-way */
  returnDate: string | null;
  stops: number;
  price: number;
  currency: string;
  airline?: string;
  /** Absolute, clickable booking/search URL. */
  link?: string;
  /** When the fare was found, per the provider's cache. */
  foundAt?: Date;
}

/** v1: cheapest offers for one route over a departure month/date. */
export interface OfferQuery {
  origin: string;
  destination: string;
  /** YYYY-MM (whole month) or YYYY-MM-DD (specific day). */
  departureAt: string;
  /** YYYY-MM or YYYY-MM-DD. Omit for one-way. */
  returnAt?: string;
  oneWay: boolean;
  directOnly: boolean;
  currency: string;
  /** Max rows to pull back (provider caps apply). */
  limit?: number;
}

/** v2 extension point: cheapest price per day across a whole month. */
export interface MonthMatrixQuery {
  origin: string;
  destination: string;
  /** YYYY-MM-DD, first day of the month. */
  month: string;
  oneWay: boolean;
  directOnly?: boolean;
  currency: string;
}

/** v2 extension point: nearby-airport auto-expansion. */
export interface NearbyQuery {
  origin: string;
  destination: string;
  /** km radius around origin/destination. */
  distanceKm: number;
  currency: string;
  limit?: number;
}

export interface FlightDataProvider {
  /** Stable identifier stored alongside data, e.g. "travelpayouts". */
  readonly name: string;

  /** v1 — required. */
  searchOffers(query: OfferQuery): Promise<FlightOffer[]>;

  /** v2 — optional; implement when you build the sweep / nearby features. */
  monthMatrix?(query: MonthMatrixQuery): Promise<FlightOffer[]>;
  nearbyMatrix?(query: NearbyQuery): Promise<FlightOffer[]>;
}
