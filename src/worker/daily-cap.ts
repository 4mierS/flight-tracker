import type { PrismaClient } from "@prisma/client";

/**
 * Global daily cap on Telegram alerts. The `AlertSent` table doubles as the
 * counter: one row per alert we committed to sending today. No separate state.
 */

/** Pure predicate: may we still send given today's count and the cap? */
export function isUnderDailyCap(sentToday: number, cap: number | null): boolean {
  if (cap === null) return true; // unlimited
  return sentToday < cap;
}

/**
 * UTC instant of local midnight (start of "today") for an IANA time zone.
 * Used as the lower bound when counting today's alerts so the cap resets at
 * local midnight, not UTC midnight.
 */
export function startOfDayInTz(now: Date, tz: string): Date {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: tz,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23", // avoid the "24" midnight quirk
  }).formatToParts(now);

  const get = (type: string): number =>
    Number(parts.find((p) => p.type === type)?.value ?? "0");

  // Same wall-clock reinterpreted as UTC, minus `now`, gives the zone offset.
  const wallAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  const offsetMs = wallAsUtc - now.getTime();

  // Local midnight as a UTC wall-clock, shifted back by the offset.
  const midnightWallAsUtc = Date.UTC(get("year"), get("month") - 1, get("day"));
  return new Date(midnightWallAsUtc - offsetMs);
}

export interface DailyCapState {
  cap: number | null;
  dayStart: Date;
}

/** Load the cap and compute today's boundary once per run. */
export async function loadDailyCapState(
  prisma: PrismaClient,
  now: Date = new Date(),
): Promise<DailyCapState> {
  const settings = await prisma.settings.findUnique({ where: { id: "singleton" } });
  const tz = settings?.timezone ?? "Europe/Berlin";
  return {
    cap: settings?.dailyMessageCap ?? null,
    dayStart: startOfDayInTz(now, tz),
  };
}

/**
 * Live check: re-counts today's alerts so sends within a single run are
 * counted against the cap. Note: counts every AlertSent row written today,
 * including ones whose Telegram send later failed (dedupe-first insert) — a
 * failed send still consumes budget. Acceptable for v1.
 */
export async function canSendNow(
  prisma: PrismaClient,
  state: DailyCapState,
): Promise<boolean> {
  if (state.cap === null) return true;
  const sentToday = await prisma.alertSent.count({
    where: { sentAt: { gte: state.dayStart } },
  });
  return isUnderDailyCap(sentToday, state.cap);
}
