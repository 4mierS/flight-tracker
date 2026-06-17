# Design: Snapshot Retention + Return-Window Auto-Fill

Date: 2026-06-17

Two independent features for the flight tracker:

1. **Auto-delete (retention)** — bound the append-only `PriceSnapshot` table by age and per-watch row count.
2. **Return-window auto-fill** — when the user picks the Outbound *From* date, derive the Return window from it plus the configured minimum stay.

The two features share no code and can be built and reviewed independently.

---

## Feature 1 — Snapshot Retention

### Problem

`PriceSnapshot` is append-only by design (every observation is a new row — the basis for trend/new-low scoring). Nothing ever deletes rows, so the table grows without bound.

### Configuration

Two nullable limits on the existing `Settings` singleton. `null` = that limit is disabled.

| Field | Meaning | Scope |
|-------|---------|-------|
| `retentionDays` | Delete snapshots whose `observedAt` is older than `now - retentionDays`. | Global (all watches) |
| `maxSnapshotsPerWatch` | For each watch, keep only the newest N snapshots by `observedAt`; delete older ones. | Per watch |

Rationale for mixed scope: age is a uniform house-keeping rule, while a row-count cap is most meaningful per watch (one busy watch should not evict another's history). "Whichever limit hits first" is the net effect — both run each cycle.

### Schema (`prisma/schema.prisma`, `Settings` model)

```prisma
retentionDays         Int?  // delete snapshots older than N days; null = off
maxSnapshotsPerWatch  Int?  // keep newest N snapshots per watch; null = off
```

A Prisma migration adds both columns (nullable, no default → existing singleton row is unaffected, both features start disabled).

### Logic — new `src/worker/cleanup.ts`

Pure-ish functions taking a `PrismaClient` so they can be unit-tested with the same minimal-stub pattern as `daily-cap.test.ts`.

- `pruneByAge(prisma, retentionDays: number, now = new Date()): Promise<number>`
  - Computes `cutoff = now - retentionDays` days.
  - `prisma.priceSnapshot.deleteMany({ where: { observedAt: { lt: cutoff } } })`.
  - Returns deleted count.

- `pruneByCount(prisma, maxPerWatch: number): Promise<number>`
  - For each watch id (`prisma.watch.findMany({ select: { id: true } })`):
    - Find the `observedAt` of the Nth-newest snapshot (skip = `maxPerWatch - 1`, take = 1, order by `observedAt desc`).
    - If a row exists at that offset, `deleteMany` where `watchId` matches and `observedAt < thatTimestamp`.
  - Returns total deleted count. Ties on identical `observedAt` are acceptable (may keep a few extra rows); exactness is not required for a housekeeping cap.

- `runCleanup(prisma, settings: { retentionDays: number | null; maxSnapshotsPerWatch: number | null }): Promise<{ byAge: number; byCount: number }>`
  - No-ops each branch when its limit is `null`.
  - Reads settings via the caller (worker passes the singleton).

### Worker integration (`src/worker/index.ts`)

Inside `tick()`, after `processAllWatches()` succeeds, load the `Settings` singleton and call `runCleanup`. Log the deleted counts. Cleanup failure is caught and logged but must not crash the cycle (housekeeping is best-effort). No new scheduler — it piggybacks on the existing cron tick.

### Desktop / UI plumbing

Thread the two new fields through the existing settings pipeline (the same path `dailyMessageCap` already takes):

1. `settingsInputSchema` (`src/lib/validation/watch.ts`): add `retentionDays` and `maxSnapshotsPerWatch`, each `z.number().int().positive().nullish()`.
2. `SettingsDTO` (`src/desktop/shared.ts`): add both fields (`number | null`).
3. `handlers.ts` `settingsGet` / `settingsUpdate`: read and upsert both fields alongside the cap.
4. `SettingsPanel.tsx`: two new numeric inputs — "Keep history for (days)" and "Max snapshots per watch" — blank = unlimited, mirroring the cap field's blank-is-null handling and help text.

---

## Feature 2 — Return-Window Auto-Fill

### Problem

When creating a return-trip watch, the user sets the Outbound *From* date and then manually computes the Return dates. The minimum stay is already known (the `Min stay (days)` field), so the Return window can be derived.

### Behaviour

When the Outbound *From* date changes **and** `tripType === "RETURN"`:

- `returnFrom = departFrom + minStayDays`
- `returnTo   = returnFrom + (oldReturnTo - oldReturnFrom)` — preserve the existing window width.

Edge cases:
- `minStayDays` blank/unparseable → treat as `0`.
- Existing `returnFrom`/`returnTo` blank or unparseable → window width defaults to `0`, so `returnTo = returnFrom`.
- `tripType === "ONE_WAY"` → return fields are untouched (they are nulled on submit anyway).

Scope: only the Outbound *From* change triggers the shift (matches the request). Changing `minStayDays` afterward does **not** retroactively shift — keep it simple; the user can re-pick the From date if needed.

### Logic — `src/renderer/lib/form.ts`

New pure helper, reusing the existing `addDays` / `ymd` utilities:

```ts
export function shiftReturnWindow(
  form: WatchFormState,
  newDepartFrom: string,
): WatchFormState
```

Returns a new `WatchFormState` (immutable update) with `departFrom` set to `newDepartFrom` and, for RETURN trips, recomputed `returnFrom` / `returnTo`. For ONE_WAY it only updates `departFrom`.

### UI (`src/renderer/components/WatchEditor.tsx`)

The Outbound *From* input's `onChange` calls `setForm((f) => shiftReturnWindow(f, e.target.value))` instead of the plain `set("departFrom", ...)`.

---

## Testing

- `src/renderer/lib/form.test.ts`: `shiftReturnWindow` — RETURN with various min stays, window-width preservation, blank min stay, blank existing return dates, ONE_WAY leaves return fields alone.
- `src/worker/cleanup.test.ts`: `pruneByAge` cutoff math; `pruneByCount` per-watch keep/delete; `runCleanup` no-ops on nulls. Use the minimal `PrismaClient` stub pattern from `daily-cap.test.ts`.
- Manual: settings round-trip in the desktop app (save/reload), and the form auto-fill in the editor.

## Out of Scope

- No retroactive shift on `minStayDays` change.
- No bulk "delete all history" button.
- No per-watch retention overrides (global + per-watch-count only).
