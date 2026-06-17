import { z } from "zod";

/**
 * Shared validation for watch create/edit. Used by both the desktop renderer
 * (form) and the Electron main IPC handler (before hitting Prisma), so the
 * rules live in exactly one place.
 *
 * Dates are kept as "YYYY-MM-DD" strings here (form-friendly); the IPC handler
 * converts them to Date objects at the Prisma boundary via `toCreateData`.
 */

const IATA = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{3}$/, "IATA code must be 3 letters (e.g. FRA)");

const iataList = z
  .array(IATA)
  .min(1, "At least one airport is required")
  // Drop duplicates while preserving order.
  .transform((codes) => Array.from(new Set(codes)));

const dateOnly = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD")
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)), "Invalid date");

export const tripTypeSchema = z.enum(["ONE_WAY", "RETURN"]);

export const watchInputSchema = z
  .object({
    label: z.string().trim().max(80).optional().or(z.literal("")),
    origins: iataList,
    destinations: iataList,
    tripType: tripTypeSchema,

    departFrom: dateOnly,
    departTo: dateOnly,
    returnFrom: dateOnly.nullish(),
    returnTo: dateOnly.nullish(),

    minStayDays: z.number().int().min(0).max(365).nullish(),
    maxStops: z.number().int().min(0).max(3),
    directOnly: z.boolean(),
    passengers: z.number().int().min(1).max(9),

    threshold: z.number().int().positive().nullish(),
    currency: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^[A-Z]{3}$/, "Currency must be a 3-letter code (e.g. EUR)"),

    snoozeUntil: z.string().datetime().nullish(),
    active: z.boolean(),
  })
  .superRefine((v, ctx) => {
    // Outbound window must be ordered.
    if (v.departTo < v.departFrom) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["departTo"],
        message: "Depart-to must be on or after depart-from",
      });
    }

    if (v.tripType === "RETURN") {
      if (!v.returnFrom || !v.returnTo) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["returnFrom"],
          message: "Return trips need a return date window",
        });
        return;
      }
      if (v.returnTo < v.returnFrom) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["returnTo"],
          message: "Return-to must be on or after return-from",
        });
      }
      if (v.returnFrom < v.departFrom) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ["returnFrom"],
          message: "Return window cannot start before the depart window",
        });
      }
    }
  });

export type WatchInput = z.infer<typeof watchInputSchema>;

/** Shape Prisma expects for create/update (dates as Date, empties normalized). */
export interface WatchPersistData {
  label: string | null;
  origins: string[];
  destinations: string[];
  tripType: "ONE_WAY" | "RETURN";
  departFrom: Date;
  departTo: Date;
  returnFrom: Date | null;
  returnTo: Date | null;
  minStayDays: number | null;
  maxStops: number;
  directOnly: boolean;
  passengers: number;
  threshold: number | null;
  currency: string;
  snoozeUntil: Date | null;
  active: boolean;
}

const toDate = (s: string): Date => new Date(`${s}T00:00:00Z`);

/**
 * Validate raw input and convert to the Prisma-ready shape. Return fields are
 * forced to null for ONE_WAY so a trip-type switch can't leave stale dates.
 */
export function toPersistData(raw: unknown): WatchPersistData {
  const v = watchInputSchema.parse(raw);
  const isReturn = v.tripType === "RETURN";
  return {
    label: v.label && v.label.length > 0 ? v.label : null,
    origins: v.origins,
    destinations: v.destinations,
    tripType: v.tripType,
    departFrom: toDate(v.departFrom),
    departTo: toDate(v.departTo),
    returnFrom: isReturn && v.returnFrom ? toDate(v.returnFrom) : null,
    returnTo: isReturn && v.returnTo ? toDate(v.returnTo) : null,
    minStayDays: isReturn ? v.minStayDays ?? null : null,
    maxStops: v.maxStops,
    directOnly: v.directOnly,
    passengers: v.passengers,
    threshold: v.threshold ?? null,
    currency: v.currency,
    snoozeUntil: v.snoozeUntil ? new Date(v.snoozeUntil) : null,
    active: v.active,
  };
}

/** Settings form: blank cap field means "unlimited" (null). */
export const settingsInputSchema = z.object({
  dailyMessageCap: z.number().int().positive().nullish(),
  // Snapshot retention. Blank/null => that limit is disabled.
  retentionDays: z.number().int().positive().nullish(),
  maxSnapshotsPerWatch: z.number().int().positive().nullish(),
  timezone: z
    .string()
    .trim()
    .min(1)
    .refine((tz) => {
      try {
        // Throws RangeError for an invalid IANA zone.
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Unknown time zone"),
});

export type SettingsInput = z.infer<typeof settingsInputSchema>;
