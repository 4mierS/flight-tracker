import type { PrismaClient } from "@prisma/client";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Retention limits read off the Settings singleton. null => that limit is off. */
export interface RetentionSettings {
  retentionDays: number | null;
  maxSnapshotsPerWatch: number | null;
}

/**
 * Delete snapshots older than `retentionDays` (global). Returns deleted count.
 * `now` is injectable for deterministic tests.
 */
export async function pruneByAge(
  prisma: PrismaClient,
  retentionDays: number,
  now: Date = new Date(),
): Promise<number> {
  const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
  const { count } = await prisma.priceSnapshot.deleteMany({
    where: { observedAt: { lt: cutoff } },
  });
  return count;
}

/**
 * For each watch, keep only the newest `maxPerWatch` snapshots and delete the
 * rest. Finds the observedAt of the Nth-newest row and deletes anything older.
 * Ties on identical observedAt may leave a few extra rows — acceptable for a
 * housekeeping cap. Returns total deleted count.
 */
export async function pruneByCount(
  prisma: PrismaClient,
  maxPerWatch: number,
): Promise<number> {
  const watches = await prisma.watch.findMany({ select: { id: true } });
  let deleted = 0;

  for (const { id } of watches) {
    // The boundary row: newest N are kept, so skip N-1 to land on the Nth.
    const boundary = await prisma.priceSnapshot.findFirst({
      where: { watchId: id },
      orderBy: { observedAt: "desc" },
      skip: maxPerWatch - 1,
      take: 1,
      select: { observedAt: true },
    });
    if (!boundary) continue; // fewer than N rows — nothing to prune.

    const { count } = await prisma.priceSnapshot.deleteMany({
      where: { watchId: id, observedAt: { lt: boundary.observedAt } },
    });
    deleted += count;
  }

  return deleted;
}

/**
 * Run both retention passes, skipping any whose limit is null. Best-effort
 * housekeeping — the caller is expected to catch/log failures.
 */
export async function runCleanup(
  prisma: PrismaClient,
  settings: RetentionSettings,
  now: Date = new Date(),
): Promise<{ byAge: number; byCount: number }> {
  const byAge =
    settings.retentionDays != null
      ? await pruneByAge(prisma, settings.retentionDays, now)
      : 0;
  const byCount =
    settings.maxSnapshotsPerWatch != null
      ? await pruneByCount(prisma, settings.maxSnapshotsPerWatch)
      : 0;
  return { byAge, byCount };
}
