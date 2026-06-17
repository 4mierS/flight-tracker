import { describe, it, expect } from "vitest";
import type { PriceSnapshot } from "@prisma/client";
import { toSnapshotDTO } from "./snapshot-dto";

function row(overrides: Partial<PriceSnapshot> = {}): PriceSnapshot {
  return {
    id: "s1",
    watchId: "w1",
    origin: "DUS",
    destination: "BKK",
    departDate: new Date("2026-03-12T00:00:00Z"),
    returnDate: new Date("2026-03-26T00:00:00Z"),
    stops: 1,
    price: 612,
    currency: "EUR",
    airline: "TG",
    link: "https://example.com/x",
    observedAt: new Date("2026-06-17T10:14:00Z"),
    foundAt: new Date("2026-06-17T09:00:00Z"),
    ...overrides,
  } as PriceSnapshot;
}

describe("toSnapshotDTO", () => {
  it("formats dates and passes through fields", () => {
    const dto = toSnapshotDTO(row());
    expect(dto.departDate).toBe("2026-03-12");
    expect(dto.returnDate).toBe("2026-03-26");
    expect(dto.observedAt).toBe("2026-06-17T10:14:00.000Z");
    expect(dto.foundAt).toBe("2026-06-17T09:00:00.000Z");
    expect(dto.price).toBe(612);
    expect(dto.stops).toBe(1);
    expect(dto.airline).toBe("TG");
    expect(dto.link).toBe("https://example.com/x");
  });

  it("nulls optional fields for a one-way snapshot with no extras", () => {
    const dto = toSnapshotDTO(row({ returnDate: null, airline: null, link: null, foundAt: null }));
    expect(dto.returnDate).toBeNull();
    expect(dto.airline).toBeNull();
    expect(dto.link).toBeNull();
    expect(dto.foundAt).toBeNull();
  });
});
