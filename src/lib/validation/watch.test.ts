import { describe, it, expect } from "vitest";
import { toPersistData, watchInputSchema, settingsInputSchema } from "./watch";

const base = {
  label: "Germany→Jordan",
  origins: ["fra", "muc"],
  destinations: ["amm"],
  tripType: "RETURN" as const,
  departFrom: "2026-06-16",
  departTo: "2026-09-16",
  returnFrom: "2026-06-23",
  returnTo: "2026-09-30",
  minStayDays: 7,
  maxStops: 0,
  directOnly: true,
  passengers: 1,
  threshold: 350,
  currency: "eur",
  active: true,
};

describe("watchInputSchema", () => {
  it("uppercases and dedupes IATA codes and currency", () => {
    const parsed = watchInputSchema.parse({ ...base, origins: ["fra", "FRA", "muc"] });
    expect(parsed.origins).toEqual(["FRA", "MUC"]);
    expect(parsed.destinations).toEqual(["AMM"]);
    expect(parsed.currency).toBe("EUR");
  });

  it("rejects a malformed IATA code", () => {
    const r = watchInputSchema.safeParse({ ...base, origins: ["FRAA"] });
    expect(r.success).toBe(false);
  });

  it("rejects an out-of-order depart window", () => {
    const r = watchInputSchema.safeParse({
      ...base,
      departFrom: "2026-09-16",
      departTo: "2026-06-16",
    });
    expect(r.success).toBe(false);
  });

  it("requires a return window for RETURN trips", () => {
    const r = watchInputSchema.safeParse({
      ...base,
      returnFrom: null,
      returnTo: null,
    });
    expect(r.success).toBe(false);
  });

  it("rejects a return window before the depart window", () => {
    const r = watchInputSchema.safeParse({
      ...base,
      returnFrom: "2026-06-01",
      returnTo: "2026-09-30",
    });
    expect(r.success).toBe(false);
  });

  it("accepts a one-way trip without return dates", () => {
    const r = watchInputSchema.safeParse({
      ...base,
      tripType: "ONE_WAY",
      returnFrom: null,
      returnTo: null,
    });
    expect(r.success).toBe(true);
  });
});

describe("toPersistData", () => {
  it("converts date strings to Date and normalizes empties", () => {
    const data = toPersistData({ ...base, label: "" });
    expect(data.label).toBeNull();
    expect(data.departFrom).toBeInstanceOf(Date);
    expect(data.departFrom.toISOString()).toBe("2026-06-16T00:00:00.000Z");
    expect(data.returnFrom?.toISOString()).toBe("2026-06-23T00:00:00.000Z");
  });

  it("forces return fields to null for ONE_WAY even if dates were supplied", () => {
    const data = toPersistData({ ...base, tripType: "ONE_WAY" });
    expect(data.returnFrom).toBeNull();
    expect(data.returnTo).toBeNull();
    expect(data.minStayDays).toBeNull();
  });
});

describe("settingsInputSchema", () => {
  it("accepts a positive cap and valid timezone", () => {
    const r = settingsInputSchema.safeParse({ dailyMessageCap: 5, timezone: "Europe/Berlin" });
    expect(r.success).toBe(true);
  });

  it("accepts a null cap (unlimited)", () => {
    const r = settingsInputSchema.safeParse({ dailyMessageCap: null, timezone: "UTC" });
    expect(r.success).toBe(true);
  });

  it("rejects an unknown timezone", () => {
    const r = settingsInputSchema.safeParse({ dailyMessageCap: 5, timezone: "Mars/Olympus" });
    expect(r.success).toBe(false);
  });

  it("rejects a non-positive cap", () => {
    const r = settingsInputSchema.safeParse({ dailyMessageCap: 0, timezone: "UTC" });
    expect(r.success).toBe(false);
  });
});
