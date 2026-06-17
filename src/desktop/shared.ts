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
  };
  settings: {
    get: () => Promise<Result<SettingsDTO>>;
    update: (input: SettingsInput) => Promise<Result<SettingsDTO>>;
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
  settingsGet: "settings:get",
  settingsUpdate: "settings:update",
} as const;
