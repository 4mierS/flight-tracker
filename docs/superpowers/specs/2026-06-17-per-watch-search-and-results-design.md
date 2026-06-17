# Per-Watch Search & Inline Results

**Date:** 2026-06-17
**Status:** Approved
**Builds on:** [GUI worker control](./2026-06-17-gui-worker-control-design.md)

## Goal

Two additions to the desktop GUI, on each watch card:

1. **Search now / Stop** — run a single search for *that one watch* immediately
   (fetch → store snapshots → evaluate alerts), and cancel it while in progress.
2. **Recent results** — an inline, expandable list of the latest price snapshots
   recorded for that watch.

The global Worker card (Run now / Start-Stop loop) stays. Per-watch search runs
even when the watch is **paused** (manual override); snooze still suppresses
alerts as in the normal path.

## Feature A — Per-watch search

### Worker entry — `src/worker/index.ts`

Add a `--watch <id>` mode that runs a single watch once and exits. It reuses the
existing pipeline via a new helper in `run-watch.ts`:

```ts
// run-watch.ts
export async function processWatchById(id: string): Promise<void> {
  const capState = await loadDailyCapState(prisma);
  const watch = await prisma.watch.findUnique({ where: { id } });
  if (!watch) throw new Error(`Watch not found: ${id}`);
  await processWatch(watch, capState); // ignores active flag; honors snooze for alerts
}
```

`main()` dispatch order: `--watch <id>` (single watch) → `--once` (all watches
once) → otherwise the cron loop.

### Runner — `src/desktop/worker-runner.ts` (refactor to a job map)

Generalize the single-child runner into a `Map<string, Job>` keyed by job id:

- `"global"` — the existing card's once/loop. Public `runOnce/start/stop/
  getStatus` are preserved and delegate to this job.
- `"watch:<id>"` — a per-watch one-shot search.

```ts
interface Job {
  id: string;
  mode: "once" | "loop";
  state: "idle" | "running-once" | "looping"; // global
  // per-watch jobs use "searching" via the watch status mapping below
  child: ChildProcess | null;
  stderrTail: string;
  lastRun: WorkerLastRun | null;
}
```

`buildSpawnCommand(opts, runMode, watchId?)` — when `watchId` is set, append
`--watch <id>` (instead of `--once`). Per-watch and global jobs may run
concurrently; each watch allows only one search at a time (a second request while
`searching` is ignored, not an error).

New public methods:

- `searchWatch(id): WatchRunStatus`
- `stopWatchSearch(id): WatchRunStatus`
- `getWatchStatus(id): WatchRunStatus`
- `getAllWatchStatuses(): WatchRunStatus[]`
- `onWatchChange(cb: (s: WatchRunStatus) => void): () => void`
- `stopAll(): void` — kill every job (global + per-watch) on quit.

New type (`shared.ts`):

```ts
interface WatchRunStatus {
  watchId: string;
  state: "idle" | "searching";
  lastRun: WorkerLastRun | null; // reuses the existing WorkerLastRun shape
}
```

### IPC — `shared.ts` / `handlers.ts` / `main.ts` / `preload.ts`

Channels:

- `watch:search` (id) → `Result<WatchRunStatus>`
- `watch:searchStop` (id) → `Result<WatchRunStatus>`
- `watch:runStatuses` → `Result<WatchRunStatus[]>`
- `watch:runStatusChanged` — **main → renderer push** carrying `WatchRunStatus`

`main.ts` subscribes `runner.onWatchChange` and broadcasts
`watch:runStatusChanged`; `before-quit` calls `runner.stopAll()`.

`DesktopApi.worker` gains: `searchWatch(id)`, `stopWatchSearch(id)`,
`watchStatuses()`, `onWatchStatusChanged(cb)`.

## Feature B — Inline recent results

### IPC — `watches:snapshots`

`watches:snapshots(id, limit?)` →

```ts
prisma.priceSnapshot.findMany({
  where: { watchId: id },
  orderBy: { observedAt: "desc" },
  take: limit ?? 8,
})
```

mapped to `SnapshotDTO`:

```ts
interface SnapshotDTO {
  id: string;
  origin: string;
  destination: string;
  departDate: string;        // YYYY-MM-DD
  returnDate: string | null; // YYYY-MM-DD
  stops: number;
  price: number;
  currency: string;
  airline: string | null;
  link: string | null;
  observedAt: string;        // ISO datetime
  foundAt: string | null;    // ISO datetime
}
```

`DesktopApi.watches` gains `snapshots(id, limit?)`.

## UI — extract `WatchCard.tsx`

`WatchList.tsx` currently inlines the whole card; with two new features it would
grow past a comfortable size. Extract a `WatchCard.tsx`:

- `WatchList` owns the watch array, one `watch:runStatusChanged` subscription, and
  a `Map<watchId, WatchRunStatus>`; it passes each card its `runStatus` plus
  action callbacks, and refreshes the list when a search completes
  (`searching → idle`) so best-price updates.
- `WatchCard` (presentational + local UI state) renders the existing controls
  plus:
  - **Search now / Stop** button driven by `runStatus.state`; **Stop** shown while
    `searching`. On failure, surface `lastRun.errorTail`.
  - **▾ Recent results** toggle: lazily calls `watches.snapshots(id)` on first
    expand, renders the latest rows (`price currency · ORIG→DEST · stops · time`,
    with the deep link when present), and re-fetches after a search completes.

## Error handling

- `--watch` with an unknown id → worker exits non-zero → card shows `errorTail`.
- Overlapping per-watch search requests ignored by the runner.
- Spawn failure captured as `ok:false` with `errorTail`.
- `stopAll()` on quit prevents orphaned children (global or per-watch).

## Testing

`worker-runner.test.ts` (extend, `child_process` mocked):

- `buildSpawnCommand` with `watchId` appends `--watch <id>` and omits `--once`.
- Per-watch: `searchWatch` → `searching`; child exit 0 → `idle` with `ok`;
  `stopWatchSearch` kills and returns to `idle`; second `searchWatch` while
  searching is a no-op.
- Independence: a running `global` job does not block `searchWatch`, and vice
  versa.
- Existing global tests still pass after the job-map refactor.

DTO mapping for `watches:snapshots` covered by a focused unit test of the mapping
helper.

## Out of scope (YAGNI)

Per-watch repeating loop, results pagination/filtering/sorting, price charts or
trend lines, exporting results.
