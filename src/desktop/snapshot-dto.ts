import type { PriceSnapshot } from "@prisma/client";
import type { SnapshotDTO } from "./shared";

const ymd = (d: Date): string => d.toISOString().slice(0, 10);

/** Map a stored price snapshot row to the UI-facing DTO. */
export function toSnapshotDTO(s: PriceSnapshot): SnapshotDTO {
  return {
    id: s.id,
    origin: s.origin,
    destination: s.destination,
    departDate: ymd(s.departDate),
    returnDate: s.returnDate ? ymd(s.returnDate) : null,
    stops: s.stops,
    price: s.price,
    currency: s.currency,
    airline: s.airline ?? null,
    link: s.link ?? null,
    observedAt: s.observedAt.toISOString(),
    foundAt: s.foundAt ? s.foundAt.toISOString() : null,
  };
}
