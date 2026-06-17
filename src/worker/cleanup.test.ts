import { describe, it, expect, vi } from "vitest";
import type { PrismaClient } from "@prisma/client";
import { pruneByAge, pruneByCount, runCleanup } from "./cleanup";

const DAY_MS = 24 * 60 * 60 * 1000;

describe("pruneByAge", () => {
  it("deletes snapshots older than the cutoff", async () => {
    const deleteMany = vi.fn(async (_arg: any) => ({ count: 7 }));
    const prisma = { priceSnapshot: { deleteMany } } as unknown as PrismaClient;

    const now = new Date("2026-06-17T12:00:00Z");
    const deleted = await pruneByAge(prisma, 30, now);

    expect(deleted).toBe(7);
    const arg = deleteMany.mock.calls[0]![0]!;
    const cutoff = arg.where.observedAt.lt as Date;
    expect(cutoff.toISOString()).toBe(
      new Date(now.getTime() - 30 * DAY_MS).toISOString(),
    );
  });
});

describe("pruneByCount", () => {
  it("keeps the newest N per watch and deletes older rows", async () => {
    const findMany = vi.fn(async () => [{ id: "w1" }, { id: "w2" }]);
    // w1 has an Nth-newest row (cutoff exists); w2 has fewer than N rows (null).
    const findFirst = vi
      .fn(async (_arg: any) => null as { observedAt: Date } | null)
      .mockResolvedValueOnce({ observedAt: new Date("2026-06-01T00:00:00Z") })
      .mockResolvedValueOnce(null);
    const deleteMany = vi.fn(async (_arg: any) => ({ count: 3 }));
    const prisma = {
      watch: { findMany },
      priceSnapshot: { findFirst, deleteMany },
    } as unknown as PrismaClient;

    const deleted = await pruneByCount(prisma, 100);

    // Only w1 triggered a delete (3 rows); w2 was under the cap.
    expect(deleted).toBe(3);
    expect(findFirst).toHaveBeenCalledTimes(2);
    expect(deleteMany).toHaveBeenCalledTimes(1);
    const arg = deleteMany.mock.calls[0]![0]!;
    expect(arg.where.watchId).toBe("w1");
    expect((arg.where.observedAt.lt as Date).toISOString()).toBe(
      "2026-06-01T00:00:00.000Z",
    );
    // Offset = keep newest N => skip N-1, take 1.
    expect(findFirst.mock.calls[0]![0]!.skip).toBe(99);
  });
});

describe("runCleanup", () => {
  it("no-ops both branches when limits are null", async () => {
    const deleteMany = vi.fn();
    const findMany = vi.fn();
    const prisma = {
      priceSnapshot: { deleteMany },
      watch: { findMany },
    } as unknown as PrismaClient;

    const result = await runCleanup(prisma, {
      retentionDays: null,
      maxSnapshotsPerWatch: null,
    });

    expect(result).toEqual({ byAge: 0, byCount: 0 });
    expect(deleteMany).not.toHaveBeenCalled();
    expect(findMany).not.toHaveBeenCalled();
  });

  it("runs only the age branch when only retentionDays is set", async () => {
    const deleteMany = vi.fn(async () => ({ count: 4 }));
    const findMany = vi.fn(async () => []);
    const prisma = {
      priceSnapshot: { deleteMany, findFirst: vi.fn() },
      watch: { findMany },
    } as unknown as PrismaClient;

    const result = await runCleanup(prisma, {
      retentionDays: 90,
      maxSnapshotsPerWatch: null,
    });

    expect(result.byAge).toBe(4);
    expect(result.byCount).toBe(0);
    expect(findMany).not.toHaveBeenCalled();
  });
});
