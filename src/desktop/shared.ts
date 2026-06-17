/**
 * IPC contract shared between the Electron main process, the preload bridge,
 * and the React renderer. The renderer NEVER imports Prisma or touches the DB
 * directly — it only calls these typed methods over `window.api`.
 */
import type { WatchInput, SettingsInput } from "../lib/validation/watch";

/** Uniform result envelope so the renderer can render errors instead of crashing. */
export type Result<T> = { ok: true; data: T } | { ok: false; error: string };

/** Watch as seen by the UI. Dates are ISO strings; date-only fields are YYYY-MM-DD. */
export interface WatchDTO {
  id: string;
  label: string | null;
  origins: string[];
  destinations: string[];
  tripType: "ONE_WAY" | "RETURN";
  departFrom: string; // YYYY-MM-DD
  departTo: string;
  returnFrom: string | null;
  returnTo: string | null;
  minStayDays: number | null;
  maxStayDays: number | null;
  maxStops: number;
  directOnly: boolean;
  passengers: number;
  threshold: number | null;
  currency: string;
  snoozeUntil: string | null; // ISO datetime
  active: boolean;
  createdAt: string;
  updatedAt: string;
  /** Cheapest price ever recorded for this watch, for the list view. null if none yet. */
  bestPrice: number | null;
}

export interface SettingsDTO {
  dailyMessageCap: number | null;
  retentionDays: number | null;
  maxSnapshotsPerWatch: number | null;
  timezone: string;
}

/** Outcome of the most recent worker run (or in-progress run). */
export interface WorkerLastRun {
  mode: "once" | "loop";
  startedAt: string; // ISO datetime
  finishedAt: string | null; // null while still running
  ok: boolean | null; // null while running; true/false once finished
  exitCode: number | null;
  errorTail: string | null; // tail of stderr when ok === false
}

/** Live state of the spawned worker child process, surfaced to the GUI. */
export interface WorkerStatus {
  state: "idle" | "running-once" | "looping";
  lastRun: WorkerLastRun | null;
}

/** Per-watch on-demand search status ("Search now" button). */
export interface WatchRunStatus {
  watchId: string;
  state: "idle" | "searching";
  lastRun: WorkerLastRun | null;
}

/** One recorded price observation, for the inline "Recent results" list. */
export interface SnapshotDTO {
  id: string;
  origin: string;
  destination: string;
  departDate: string; // YYYY-MM-DD
  returnDate: string | null; // YYYY-MM-DD
  stops: number;
  price: number;
  currency: string;
  airline: string | null;
  link: string | null;
  observedAt: string; // ISO datetime
  foundAt: string | null; // ISO datetime
}

/** The surface exposed on `window.api` by the preload script. */
export interface DesktopApi {
  watches: {
    list: () => Promise<Result<WatchDTO[]>>;
    get: (id: string) => Promise<Result<WatchDTO | null>>;
    create: (input: WatchInput) => Promise<Result<WatchDTO>>;
    update: (id: string, input: WatchInput) => Promise<Result<WatchDTO>>;
    remove: (id: string) => Promise<Result<null>>;
    setActive: (id: string, active: boolean) => Promise<Result<null>>;
    snooze: (id: string, untilIso: string | null) => Promise<Result<null>>;
    /** Latest recorded price snapshots for a watch, newest first. */
    snapshots: (id: string, limit?: number) => Promise<Result<SnapshotDTO[]>>;
  };
  settings: {
    get: () => Promise<Result<SettingsDTO>>;
    update: (input: SettingsInput) => Promise<Result<SettingsDTO>>;
  };
  worker: {
    /** Run a single check cycle of all active watches, then stop. */
    runOnce: () => Promise<Result<WorkerStatus>>;
    /** Start the continuous cron loop. */
    start: () => Promise<Result<WorkerStatus>>;
    /** Stop the running worker (one-off or loop). */
    stop: () => Promise<Result<WorkerStatus>>;
    /** Current worker status. */
    status: () => Promise<Result<WorkerStatus>>;
    /** Subscribe to status changes pushed from the main process. Returns an unsubscribe fn. */
    onStatusChanged: (cb: (status: WorkerStatus) => void) => () => void;
    /** Run a one-off search for a single watch (ignores the active flag). */
    searchWatch: (id: string) => Promise<Result<WatchRunStatus>>;
    /** Cancel an in-progress per-watch search. */
    stopWatchSearch: (id: string) => Promise<Result<WatchRunStatus>>;
    /** Current per-watch search statuses. */
    watchStatuses: () => Promise<Result<WatchRunStatus[]>>;
    /** Subscribe to per-watch search status changes. Returns an unsubscribe fn. */
    onWatchStatusChanged: (cb: (status: WatchRunStatus) => void) => () => void;
  };
}

/** IPC channel names — single source of truth for main + preload. */
export const CHANNELS = {
  watchesList: "watches:list",
  watchesGet: "watches:get",
  watchesCreate: "watches:create",
  watchesUpdate: "watches:update",
  watchesRemove: "watches:remove",
  watchesSetActive: "watches:setActive",
  watchesSnooze: "watches:snooze",
  watchesSnapshots: "watches:snapshots",
  settingsGet: "settings:get",
  settingsUpdate: "settings:update",
  workerRunOnce: "worker:runOnce",
  workerStart: "worker:start",
  workerStop: "worker:stop",
  workerStatus: "worker:status",
  /** main → renderer push event */
  workerStatusChanged: "worker:statusChanged",
  watchSearch: "watch:search",
  watchSearchStop: "watch:searchStop",
  watchRunStatuses: "watch:runStatuses",
  /** main → renderer push event */
  watchRunStatusChanged: "watch:runStatusChanged",
} as const;
