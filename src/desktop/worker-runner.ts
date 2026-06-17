import { spawn as nodeSpawn, type ChildProcess } from "node:child_process";
import path from "node:path";
import type { WorkerStatus, WorkerLastRun, WatchRunStatus } from "./shared";

/**
 * Owns the spawned worker child processes and exposes a small state machine to
 * the desktop main process. The worker is the SAME entry used standalone
 * (`src/worker/index.ts`); we just spawn it and let it load its own secrets via
 * `--env-file`, so the desktop process never touches provider/Telegram tokens.
 *
 * Work is modelled as independent "jobs" keyed by id:
 *  - "global"      — the global card's once/loop (one at a time)
 *  - "watch:<id>"  — an on-demand single-watch search (one per watch at a time)
 * Jobs run concurrently with each other.
 */

type RunMode = "once" | "loop";

const GLOBAL = "global";
const WATCH_PREFIX = "watch:";
const watchKey = (id: string): string => `${WATCH_PREFIX}${id}`;
const STDERR_TAIL_BYTES = 2048;

export interface SpawnCommand {
  command: string;
  args: string[];
  env: NodeJS.ProcessEnv;
}

interface CommandOptions {
  mode: "dev" | "packaged";
  /** Repo root (dev) or unpacked app root (packaged). */
  rootDir: string;
  /** Worker env file passed as `--env-file` (holds the worker's secrets). */
  envFile: string;
  /** Electron's bundled Node binary (`process.execPath`) for packaged spawns. */
  execPath: string;
}

export interface RunnerOptions extends CommandOptions {
  /** Injectable for tests; defaults to node:child_process spawn. */
  spawnFn?: typeof nodeSpawn;
}

interface Job {
  child: ChildProcess | null;
  stderrTail: string;
  running: boolean;
  /** Last requested mode, used to render the global state (running-once vs looping). */
  mode: RunMode;
  lastRun: WorkerLastRun | null;
}

/**
 * Build the exact command/args/env to launch the worker. Pure and side-effect
 * free so it can be unit-tested without spawning. `--env-file` is supported by
 * both tsx (dev) and Node 20+ (packaged Electron node), matching the project's
 * existing `tsx --env-file=.env` worker scripts. When `watchId` is given, the
 * worker runs a single watch (`--watch <id>`) instead of `--once`/loop.
 */
export function buildSpawnCommand(
  opts: CommandOptions,
  runMode: RunMode,
  watchId?: string,
): SpawnCommand {
  const tailArgs = watchId
    ? ["--watch", watchId]
    : runMode === "once"
      ? ["--once"]
      : [];
  const envFileArg = `--env-file=${opts.envFile}`;

  if (opts.mode === "dev") {
    const tsx = path.join(opts.rootDir, "node_modules", ".bin", "tsx");
    const entry = path.join(opts.rootDir, "src", "worker", "index.ts");
    return {
      command: tsx,
      args: [envFileArg, entry, ...tailArgs],
      env: { ...process.env },
    };
  }

  const entry = path.join(opts.rootDir, "dist", "worker", "index.mjs");
  return {
    command: opts.execPath,
    args: [envFileArg, entry, ...tailArgs],
    // Make Electron behave as a plain Node process for this child.
    env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
  };
}

export class WorkerRunner {
  private readonly jobs = new Map<string, Job>();
  private readonly globalListeners = new Set<(status: WorkerStatus) => void>();
  private readonly watchListeners = new Set<(status: WatchRunStatus) => void>();
  private readonly opts: CommandOptions;
  private readonly spawnFn: typeof nodeSpawn;

  constructor(options: RunnerOptions) {
    const { spawnFn, ...opts } = options;
    this.opts = opts;
    this.spawnFn = spawnFn ?? nodeSpawn;
  }

  // ---- Global job (the worker card) -------------------------------------

  getStatus(): WorkerStatus {
    const job = this.jobs.get(GLOBAL);
    const state: WorkerStatus["state"] = !job?.running
      ? "idle"
      : job.mode === "loop"
        ? "looping"
        : "running-once";
    return { state, lastRun: job?.lastRun ?? null };
  }

  onChange(cb: (status: WorkerStatus) => void): () => void {
    this.globalListeners.add(cb);
    return () => this.globalListeners.delete(cb);
  }

  runOnce(): WorkerStatus {
    this.spawnJob(GLOBAL, "once");
    return this.getStatus();
  }

  start(): WorkerStatus {
    this.spawnJob(GLOBAL, "loop");
    return this.getStatus();
  }

  stop(): WorkerStatus {
    this.jobs.get(GLOBAL)?.child?.kill("SIGTERM");
    return this.getStatus();
  }

  // ---- Per-watch jobs ("Search now") ------------------------------------

  getWatchStatus(id: string): WatchRunStatus {
    const job = this.jobs.get(watchKey(id));
    return {
      watchId: id,
      state: job?.running ? "searching" : "idle",
      lastRun: job?.lastRun ?? null,
    };
  }

  getAllWatchStatuses(): WatchRunStatus[] {
    const out: WatchRunStatus[] = [];
    for (const [key, job] of this.jobs) {
      if (!key.startsWith(WATCH_PREFIX)) continue;
      out.push({
        watchId: key.slice(WATCH_PREFIX.length),
        state: job.running ? "searching" : "idle",
        lastRun: job.lastRun,
      });
    }
    return out;
  }

  onWatchChange(cb: (status: WatchRunStatus) => void): () => void {
    this.watchListeners.add(cb);
    return () => this.watchListeners.delete(cb);
  }

  searchWatch(id: string): WatchRunStatus {
    this.spawnJob(watchKey(id), "once", id);
    return this.getWatchStatus(id);
  }

  stopWatchSearch(id: string): WatchRunStatus {
    this.jobs.get(watchKey(id))?.child?.kill("SIGTERM");
    return this.getWatchStatus(id);
  }

  /** Kill every running child (global + per-watch). Called on app quit. */
  stopAll(): void {
    for (const job of this.jobs.values()) job.child?.kill("SIGTERM");
  }

  // ---- Internals --------------------------------------------------------

  private getJob(key: string): Job {
    let job = this.jobs.get(key);
    if (!job) {
      job = { child: null, stderrTail: "", running: false, mode: "once", lastRun: null };
      this.jobs.set(key, job);
    }
    return job;
  }

  private emitFor(key: string): void {
    if (key === GLOBAL) {
      const status = this.getStatus();
      for (const cb of this.globalListeners) cb(status);
    } else if (key.startsWith(WATCH_PREFIX)) {
      const status = this.getWatchStatus(key.slice(WATCH_PREFIX.length));
      for (const cb of this.watchListeners) cb(status);
    }
  }

  private spawnJob(key: string, runMode: RunMode, watchId?: string): void {
    const job = this.getJob(key);
    // One child per job; a request while busy is ignored, not an error.
    if (job.running) return;

    const cmd = buildSpawnCommand(this.opts, runMode, watchId);
    job.stderrTail = "";
    job.running = true;
    job.mode = runMode;
    job.lastRun = {
      mode: watchId ? "once" : runMode,
      startedAt: new Date().toISOString(),
      finishedAt: null,
      ok: null,
      exitCode: null,
      errorTail: null,
    };
    this.emitFor(key);

    let child: ChildProcess;
    try {
      child = this.spawnFn(cmd.command, cmd.args, {
        cwd: this.opts.rootDir,
        env: cmd.env,
      });
    } catch (err) {
      this.finish(key, false, null, err instanceof Error ? err.message : String(err));
      return;
    }
    job.child = child;

    child.stderr?.on("data", (chunk: Buffer | string) => {
      job.stderrTail = (job.stderrTail + chunk.toString()).slice(-STDERR_TAIL_BYTES);
    });

    child.on("error", (err: Error) => {
      this.finish(key, false, null, err.message);
    });

    child.on("exit", (code) => {
      // If we already finished via an 'error' event, ignore the trailing exit.
      if (job.child !== child) return;
      const ok = code === 0;
      this.finish(key, ok, code, ok ? null : job.stderrTail || null);
    });
  }

  private finish(
    key: string,
    ok: boolean,
    exitCode: number | null,
    errorTail: string | null,
  ): void {
    const job = this.getJob(key);
    job.child = null;
    job.running = false;
    if (job.lastRun) {
      job.lastRun = {
        ...job.lastRun,
        finishedAt: new Date().toISOString(),
        ok,
        exitCode,
        errorTail,
      };
    }
    this.emitFor(key);
  }
}
