import { env } from "../env";
import { TravelpayoutsProvider } from "./travelpayouts";
import type { FlightDataProvider } from "./types";

/**
 * Single place that decides which provider the worker uses. When you add a
 * second source, switch on an env var or per-watch column here — callers never
 * import a concrete provider directly.
 */
let cached: FlightDataProvider | null = null;

export function getProvider(): FlightDataProvider {
  if (cached) return cached;
  cached = new TravelpayoutsProvider({
    token: env.TRAVELPAYOUTS_TOKEN,
    market: env.TRAVELPAYOUTS_MARKET,
  });
  return cached;
}

export type { FlightDataProvider, FlightOffer } from "./types";
