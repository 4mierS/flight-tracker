import { describe, it, expect } from "vitest";
import type { PrismaClient } from "@prisma/client";
import {
  canSendNow,
  isUnderDailyCap,
  loadDailyCapState,
  startOfDayInTz,
} from "./daily-cap";

/** Minimal Prisma stub exposing only what the cap code touches. */
function mockPrisma(opts: {
  settings?: { dailyMessageCap: number | null; timezone: string } | null;
  sentToday?: number;
}): PrismaClient {
  return {
    settings: {
      findUnique: async () => opts.settings ?? null,
    },
    alertSent: {
      count: async () => opts.sentToday ?? 0,
    },
  } as unknown as PrismaClient;
}

describe("isUnderDailyCap", () => {
  it("allows unlimited when cap is null", () => {
    expect(isUnderDailyCap(0, null)).toBe(true);
    expect(isUnderDailyCap(9999, null)).toBe(true);
  });

  it("allows sending while below the cap", () => {
    expect(isUnderDailyCap(0, 5)).toBe(true);
    expect(isUnderDailyCap(4, 5)).toBe(true);
  });

  it("blocks once the count reaches the cap", () => {
    expect(isUnderDailyCap(5, 5)).toBe(false);
    expect(isUnderDailyCap(6, 5)).toBe(false);
  });

  it("a cap of zero blocks everything", () => {
    expect(isUnderDailyCap(0, 0)).toBe(false);
  });
});

describe("startOfDayInTz", () => {
  it("computes local midnight as a UTC instant for a positive-offset zone", () => {
    // 2026-06-16 10:00 UTC; Berlin is UTC+2 (CEST) => local time 12:00,
    // so local midnight is 2026-06-15 22:00 UTC.
    const now = new Date("2026-06-16T10:00:00Z");
    const start = startOfDayInTz(now, "Europe/Berlin");
    expect(start.toISOString()).toBe("2026-06-15T22:00:00.000Z");
  });

  it("handles just-after-local-midnight correctly", () => {
    // 2026-06-16 00:30 Berlin (UTC+2) == 2026-06-15 22:30 UTC.
    // Local day is the 16th, so start = 2026-06-15T22:00Z.
    const now = new Date("2026-06-15T22:30:00Z");
    const start = startOfDayInTz(now, "Europe/Berlin");
    expect(start.toISOString()).toBe("2026-06-15T22:00:00.000Z");
  });

  it("handles a negative-offset zone", () => {
    // 2026-06-16 03:00 UTC; New York is UTC-4 (EDT) => local 2026-06-15 23:00,
    // so local midnight is 2026-06-15 04:00 UTC.
    const now = new Date("2026-06-16T03:00:00Z");
    const start = startOfDayInTz(now, "America/New_York");
    expect(start.toISOString()).toBe("2026-06-15T04:00:00.000Z");
  });
});

describe("loadDailyCapState", () => {
  it("defaults to unlimited + Berlin when no settings row exists", async () => {
    const state = await loadDailyCapState(mockPrisma({ settings: null }));
    expect(state.cap).toBeNull();
    expect(state.dayStart).toBeInstanceOf(Date);
  });

  it("reads the configured cap", async () => {
    const state = await loadDailyCapState(
      mockPrisma({ settings: { dailyMessageCap: 3, timezone: "UTC" } }),
    );
    expect(state.cap).toBe(3);
  });
});

describe("canSendNow", () => {
  it("always allows when cap is null, without counting", async () => {
    const ok = await canSendNow(mockPrisma({ sentToday: 999 }), {
      cap: null,
      dayStart: new Date(),
    });
    expect(ok).toBe(true);
  });

  it("allows while today's count is below the cap", async () => {
    const ok = await canSendNow(mockPrisma({ sentToday: 2 }), {
      cap: 3,
      dayStart: new Date(),
    });
    expect(ok).toBe(true);
  });

  it("blocks once today's count has reached the cap", async () => {
    const ok = await canSendNow(mockPrisma({ sentToday: 3 }), {
      cap: 3,
      dayStart: new Date(),
    });
    expect(ok).toBe(false);
  });
});
