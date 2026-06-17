import { ipcMain } from "electron";
import type { PrismaClient, Watch } from "@prisma/client";
import { toPersistData, settingsInputSchema } from "../lib/validation/watch";
import {
  CHANNELS,
  type Result,
  type WatchDTO,
  type SettingsDTO,
  type WorkerStatus,
  type WatchRunStatus,
  type SnapshotDTO,
} from "./shared";
import type { WorkerRunner } from "./worker-runner";
import { toSnapshotDTO } from "./snapshot-dto";

/** How many recent snapshots the inline "Recent results" list shows by default. */
const DEFAULT_SNAPSHOT_LIMIT = 8;
const MAX_SNAPSHOT_LIMIT = 100;

const ymd = (d: Date | null): string | null =>
  d ? d.toISOString().slice(0, 10) : null;

function toWatchDTO(w: Watch, bestPrice: number | null): WatchDTO {
  return {
    id: w.id,
    label: w.label,
    origins: w.origins,
    destinations: w.destinations,
    tripType: w.tripType,
    departFrom: ymd(w.departFrom)!,
    departTo: ymd(w.departTo)!,
    returnFrom: ymd(w.returnFrom),
    returnTo: ymd(w.returnTo),
    minStayDays: w.minStayDays,
    maxStayDays: w.maxStayDays,
    maxStops: w.maxStops,
    directOnly: w.directOnly,
    passengers: w.passengers,
    threshold: w.threshold,
    currency: w.currency,
    snoozeUntil: w.snoozeUntil ? w.snoozeUntil.toISOString() : null,
    active: w.active,
    createdAt: w.createdAt.toISOString(),
    updatedAt: w.updatedAt.toISOString(),
    bestPrice,
  };
}

/** Turn any thrown error into a user-facing string; Zod errors get flattened. */
function errorMessage(err: unknown): string {
  if (err && typeof err === "object" && "issues" in err) {
    const issues = (err as { issues: Array<{ path: unknown[]; message: string }> }).issues;
    return issues
      .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
      .join("; ");
  }
  if (err instanceof Error) return err.message;
  return "Unexpected error";
}

/** Wrap a handler so all results share the { ok, data } / { ok, error } envelope. */
function handle<T>(
  channel: string,
  fn: (...args: unknown[]) => Promise<T>,
): void {
  ipcMain.handle(channel, async (_event, ...args): Promise<Result<T>> => {
    try {
      return { ok: true, data: await fn(...args) };
    } catch (err) {
      console.error(`[ipc:${channel}]`, err);
      return { ok: false, error: errorMessage(err) };
    }
  });
}

/** Best (min) price per watch in one query, returned as a Map. */
async function bestPriceByWatch(prisma: PrismaClient): Promise<Map<string, number>> {
  const rows = await prisma.priceSnapshot.groupBy({
    by: ["watchId"],
    _min: { price: true },
  });
  return new Map(rows.map((r) => [r.watchId, r._min.price ?? 0]));
}

export function registerIpcHandlers(prisma: PrismaClient, worker: WorkerRunner): void {
  handle(CHANNELS.watchesList, async () => {
    const [watches, best] = await Promise.all([
      prisma.watch.findMany({ orderBy: { createdAt: "desc" } }),
      bestPriceByWatch(prisma),
    ]);
    return watches.map((w) => toWatchDTO(w, best.get(w.id) ?? null));
  });

  handle(CHANNELS.watchesGet, async (id) => {
    const w = await prisma.watch.findUnique({ where: { id: id as string } });
    if (!w) return null;
    const agg = await prisma.priceSnapshot.aggregate({
      where: { watchId: w.id },
      _min: { price: true },
    });
    return toWatchDTO(w, agg._min.price ?? null);
  });

  handle(CHANNELS.watchesCreate, async (input) => {
    const data = toPersistData(input);
    const w = await prisma.watch.create({ data });
    return toWatchDTO(w, null);
  });

  handle(CHANNELS.watchesUpdate, async (id, input) => {
    const data = toPersistData(input);
    const w = await prisma.watch.update({ where: { id: id as string }, data });
    const agg = await prisma.priceSnapshot.aggregate({
      where: { watchId: w.id },
      _min: { price: true },
    });
    return toWatchDTO(w, agg._min.price ?? null);
  });

  handle(CHANNELS.watchesRemove, async (id) => {
    await prisma.watch.delete({ where: { id: id as string } });
    return null;
  });

  handle(CHANNELS.watchesSetActive, async (id, active) => {
    await prisma.watch.update({
      where: { id: id as string },
      data: { active: active as boolean },
    });
    return null;
  });

  handle(CHANNELS.watchesSnooze, async (id, untilIso) => {
    await prisma.watch.update({
      where: { id: id as string },
      data: { snoozeUntil: untilIso ? new Date(untilIso as string) : null },
    });
    return null;
  });

  handle<SnapshotDTO[]>(CHANNELS.watchesSnapshots, async (id, limit) => {
    const take = Math.min(
      typeof limit === "number" && limit > 0 ? limit : DEFAULT_SNAPSHOT_LIMIT,
      MAX_SNAPSHOT_LIMIT,
    );
    const rows = await prisma.priceSnapshot.findMany({
      where: { watchId: id as string },
      orderBy: { observedAt: "desc" },
      take,
    });
    return rows.map(toSnapshotDTO);
  });

  handle<SettingsDTO>(CHANNELS.settingsGet, async () => {
    const s = await prisma.settings.findUnique({ where: { id: "singleton" } });
    return {
      dailyMessageCap: s?.dailyMessageCap ?? null,
      retentionDays: s?.retentionDays ?? null,
      maxSnapshotsPerWatch: s?.maxSnapshotsPerWatch ?? null,
      timezone: s?.timezone ?? "Europe/Berlin",
    };
  });

  handle<SettingsDTO>(CHANNELS.settingsUpdate, async (input) => {
    const parsed = settingsInputSchema.parse(input);
    const cap = parsed.dailyMessageCap ?? null;
    const retentionDays = parsed.retentionDays ?? null;
    const maxSnapshotsPerWatch = parsed.maxSnapshotsPerWatch ?? null;
    const s = await prisma.settings.upsert({
      where: { id: "singleton" },
      create: {
        id: "singleton",
        dailyMessageCap: cap,
        retentionDays,
        maxSnapshotsPerWatch,
        timezone: parsed.timezone,
      },
      update: { dailyMessageCap: cap, retentionDays, maxSnapshotsPerWatch, timezone: parsed.timezone },
    });
    return {
      dailyMessageCap: s.dailyMessageCap,
      retentionDays: s.retentionDays,
      maxSnapshotsPerWatch: s.maxSnapshotsPerWatch,
      timezone: s.timezone,
    };
  });

  handle<WorkerStatus>(CHANNELS.workerRunOnce, async () => worker.runOnce());
  handle<WorkerStatus>(CHANNELS.workerStart, async () => worker.start());
  handle<WorkerStatus>(CHANNELS.workerStop, async () => worker.stop());
  handle<WorkerStatus>(CHANNELS.workerStatus, async () => worker.getStatus());

  handle<WatchRunStatus>(CHANNELS.watchSearch, async (id) =>
    worker.searchWatch(id as string),
  );
  handle<WatchRunStatus>(CHANNELS.watchSearchStop, async (id) =>
    worker.stopWatchSearch(id as string),
  );
  handle<WatchRunStatus[]>(CHANNELS.watchRunStatuses, async () =>
    worker.getAllWatchStatuses(),
  );
}
