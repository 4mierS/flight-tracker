# Manual Worker Control in the Desktop GUI

**Date:** 2026-06-17
**Status:** Approved

## Goal

Let the user trigger the price-tracking worker directly from the Electron desktop
GUI:

1. **Run now** — execute a single check cycle of all active watches, then stop
   (equivalent to `worker:once`).
2. **Start / Stop loop** — start and stop the long-running cron loop (equivalent
   to `worker`), with a status indicator.

The desktop process must keep provider/Telegram secrets out of itself, preserving
the existing separation in `src/desktop/main.ts` (the app loads only
`DATABASE_URL`).

## Approach: spawn the worker as a child process

The Electron main process spawns the **existing, unchanged** worker entry
(`src/worker/index.ts`) as a single child process. The child loads its own
secrets via `--env-file`, so the desktop process never imports `src/lib/env` or
sees `TRAVELPAYOUTS_TOKEN` / `TELEGRAM_*`.

- **Dev:** spawn `node_modules/.bin/tsx src/worker/index.ts [--once]`.
- **Packaged:** spawn Electron's bundled Node via `process.execPath` with
  `ELECTRON_RUN_AS_NODE=1`, running `dist/worker/index.mjs [--once]`.

Both Node 20+ and tsx support `--env-file`, so the child is given
`--env-file=<worker env path>` (default `.env`).

## Components

### 1. Worker build target — `vite.config.ts`

Switch from `vite-plugin-electron/simple` to the array form (same package, **no
new dependency**) and add a third build entry compiling the worker to
`dist/worker/index.mjs`, with `@prisma/client` and `.prisma/client` kept external
(identical to the main-process config).

**Packaging risk (follow-up, not solved here):** a fully packaged build also needs
Prisma's query engine binary `asarUnpack`'d and `DATABASE_URL` resolved relative
to a writable location. This is out of scope for this change. The runner keeps the
worker script path and env path configurable so this remains isolated.

### 2. `src/desktop/worker-runner.ts`

Owns a **single** worker child process and a small state machine.

State: `"idle" | "running-once" | "looping"`.

```
idle --runOnce--> running-once --(child exits)--> idle
idle --start----> looping       --stop/exit-----> idle
```

Public API:

- `runOnce(): void` — spawn with `--once`; rejected (no-op + log) if not idle.
- `start(): void` — spawn the cron loop; rejected if not idle.
- `stop(): void` — kill the child (SIGTERM); transitions to idle on exit.
- `getStatus(): WorkerStatus`
- `onChange(cb: (s: WorkerStatus) => void)` — notify on every transition.

It captures a rolling tail of the child's `stderr` (last ~2 KB) for error
reporting and records `lastRun`. Only one child at a time; a second request while
busy is ignored and surfaced via the status (no crash).

`WorkerStatus`:

```ts
interface WorkerLastRun {
  mode: "once" | "loop";
  startedAt: string;   // ISO
  finishedAt: string | null;
  ok: boolean | null;  // null while running
  exitCode: number | null;
  errorTail: string | null; // stderr tail when ok === false
}
interface WorkerStatus {
  state: "idle" | "running-once" | "looping";
  lastRun: WorkerLastRun | null;
}
```

Spawn target resolution: in dev (`VITE_DEV_SERVER_URL` set, or source present)
use tsx + TS entry; otherwise use `process.execPath` + `ELECTRON_RUN_AS_NODE=1` +
`dist/worker/index.mjs`. Command/arg construction is a pure helper
(`buildSpawnCommand`) so it is unit-testable without spawning.

### 3. IPC surface — `src/desktop/shared.ts`

New channels:

- `worker:runOnce`, `worker:start`, `worker:stop` — request/response `Result<WorkerStatus>`.
- `worker:status` — request/response `Result<WorkerStatus>`.
- `worker:statusChanged` — **main → renderer push event** carrying `WorkerStatus`.

`DesktopApi` gains:

```ts
worker: {
  runOnce: () => Promise<Result<WorkerStatus>>;
  start:   () => Promise<Result<WorkerStatus>>;
  stop:    () => Promise<Result<WorkerStatus>>;
  status:  () => Promise<Result<WorkerStatus>>;
  onStatusChanged: (cb: (s: WorkerStatus) => void) => () => void; // returns unsubscribe
};
```

### 4. Main process — `src/desktop/main.ts` / `handlers.ts`

Instantiate the runner; register the `worker:*` handlers; subscribe to
`runner.onChange` and forward to the focused window's `webContents` via
`worker:statusChanged`. On `app.before-quit`, call `runner.stop()` to kill any
child.

### 5. Preload — `src/desktop/preload.ts`

Expose `window.api.worker.*`. `onStatusChanged` wraps `ipcRenderer.on` and
returns an unsubscribe function.

### 6. Renderer — `src/renderer/components/WorkerControl.tsx`

A compact "Worker" card rendered on the Watches view (above the watch grid in
`App.tsx`/`WatchList`). Shows:

- Status badge: **Idle** / **Running once…** / **Looping**.
- Last-run summary: timestamp + ✓ success or ✗ with the `errorTail` shown.
- Controls: **Run now** button, and a **Start loop / Stop loop** toggle.

Button enablement: **Run now** disabled while `running-once` or `looping`;
**Start loop** shown when idle, **Stop loop** shown when looping. On a transition
back to `idle` after a run, the component triggers a watch-list refresh (via a
callback prop) so new best prices appear.

Subscribes to `onStatusChanged` on mount; fetches `status()` once on mount;
unsubscribes on unmount.

## Error handling

- Missing/invalid worker env → child exits non-zero → card shows `errorTail`.
- Overlapping requests are ignored by the runner and reflected in status.
- Child spawn failure (binary not found) → captured, `ok=false`, `errorTail` set.
- Killing on quit prevents orphaned worker processes.

## Testing

`src/desktop/worker-runner.test.ts` (vitest, `child_process` mocked):

- `buildSpawnCommand` returns the tsx invocation in dev and the
  `process.execPath` + `ELECTRON_RUN_AS_NODE` invocation in packaged mode, with
  `--once` only for run-once and `--env-file` always present.
- State transitions: idle → running-once → idle on child exit; idle → looping;
  stop → idle; overlap request while busy is a no-op.
- `lastRun.ok` reflects child exit code; `errorTail` populated on non-zero exit.

## Out of scope

- Live log streaming (status + last-run summary only).
- Prisma engine `asarUnpack` packaging hardening (flagged above).
- Scheduling/config of the cron expression from the GUI (worker reads
  `CRON_SCHEDULE` from its own env).
