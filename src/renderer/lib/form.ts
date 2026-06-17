import type { WatchInput } from "../../lib/validation/watch";
import type { WatchDTO } from "../../desktop/shared";

/** Editable form state: airport lists are free text until submit. */
export interface WatchFormState {
  label: string;
  origins: string; // comma/space separated, e.g. "FRA, MUC"
  destinations: string;
  tripType: "ONE_WAY" | "RETURN";
  departFrom: string;
  departTo: string;
  returnFrom: string;
  returnTo: string;
  minStayDays: string; // numbers as strings for inputs; "" = unset
  maxStops: string;
  directOnly: boolean;
  passengers: string;
  threshold: string;
  currency: string;
  active: boolean;
}

const addDays = (d: Date, n: number): Date => {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
};
const ymd = (d: Date): string => d.toISOString().slice(0, 10);
const parseYmd = (s: string): Date | null => {
  const t = s.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(t)) return null;
  const d = new Date(`${t}T00:00:00Z`);
  return Number.isNaN(d.getTime()) ? null : d;
};
const daysBetween = (from: Date, to: Date): number =>
  Math.round((to.getTime() - from.getTime()) / (24 * 60 * 60 * 1000));

/** Blank form prefilled with a sensible ~3-month return-trip window. */
export function emptyForm(): WatchFormState {
  const today = new Date();
  return {
    label: "",
    origins: "",
    destinations: "",
    tripType: "RETURN",
    departFrom: ymd(today),
    departTo: ymd(addDays(today, 90)),
    returnFrom: ymd(addDays(today, 7)),
    returnTo: ymd(addDays(today, 104)),
    minStayDays: "7",
    maxStops: "1",
    directOnly: false,
    passengers: "1",
    threshold: "",
    currency: "EUR",
    active: true,
  };
}

export function formFromDTO(w: WatchDTO): WatchFormState {
  return {
    label: w.label ?? "",
    origins: w.origins.join(", "),
    destinations: w.destinations.join(", "),
    tripType: w.tripType,
    departFrom: w.departFrom,
    departTo: w.departTo,
    returnFrom: w.returnFrom ?? "",
    returnTo: w.returnTo ?? "",
    minStayDays: w.minStayDays?.toString() ?? "",
    maxStops: w.maxStops.toString(),
    directOnly: w.directOnly,
    passengers: w.passengers.toString(),
    threshold: w.threshold?.toString() ?? "",
    currency: w.currency,
    active: w.active,
  };
}

/**
 * Update the outbound departure date and, for RETURN trips, derive the return
 * window from it: returnFrom = departFrom + minStayDays, with returnTo shifted
 * to preserve the existing window width. ONE_WAY leaves return fields alone.
 * A blank min stay counts as 0; blank/invalid return dates give a 0-day window.
 */
export function shiftReturnWindow(
  form: WatchFormState,
  newDepartFrom: string,
): WatchFormState {
  const next = { ...form, departFrom: newDepartFrom };
  if (form.tripType !== "RETURN") return next;

  const base = parseYmd(newDepartFrom);
  if (!base) return next; // incomplete date entry — don't clobber return fields.

  const minStay = numOrNull(form.minStayDays) ?? 0;
  const oldFrom = parseYmd(form.returnFrom);
  const oldTo = parseYmd(form.returnTo);
  const width = oldFrom && oldTo ? Math.max(0, daysBetween(oldFrom, oldTo)) : 0;

  const returnFrom = addDays(base, minStay);
  return {
    ...next,
    returnFrom: ymd(returnFrom),
    returnTo: ymd(addDays(returnFrom, width)),
  };
}

const splitCodes = (s: string): string[] =>
  s
    .split(/[\s,]+/)
    .map((c) => c.trim())
    .filter(Boolean);

const numOrNull = (s: string): number | null => {
  const t = s.trim();
  if (t === "") return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
};

/** Convert form state into the WatchInput shape the schema/IPC expects. */
export function formToInput(f: WatchFormState): WatchInput {
  const isReturn = f.tripType === "RETURN";
  return {
    label: f.label.trim(),
    origins: splitCodes(f.origins),
    destinations: splitCodes(f.destinations),
    tripType: f.tripType,
    departFrom: f.departFrom,
    departTo: f.departTo,
    returnFrom: isReturn ? f.returnFrom || null : null,
    returnTo: isReturn ? f.returnTo || null : null,
    minStayDays: numOrNull(f.minStayDays),
    maxStops: numOrNull(f.maxStops) ?? 0,
    directOnly: f.directOnly,
    passengers: numOrNull(f.passengers) ?? 1,
    threshold: numOrNull(f.threshold),
    currency: f.currency.trim(),
    snoozeUntil: null,
    active: f.active,
  } as WatchInput;
}
