import { EventEmitter } from "node:events";
import path from "node:path";
import { describe, it, expect, vi } from "vitest";
import { buildSpawnCommand, WorkerRunner } from "./worker-runner";

const ROOT = "/repo";
const ENV_FILE = "/repo/.env";
const EXEC = "/usr/bin/electron";

const baseOpts = {
  rootDir: ROOT,
  envFile: ENV_FILE,
  execPath: EXEC,
} as const;

describe("buildSpawnCommand", () => {
  it("spawns tsx with the TS entry in dev mode", () => {
    const cmd = buildSpawnCommand({ ...baseOpts, mode: "dev" }, "loop");

    expect(cmd.command).toBe(path.join(ROOT, "node_modules", ".bin", "tsx"));
    expect(cmd.args).toEqual([
      `--env-file=${ENV_FILE}`,
      path.join(ROOT, "src", "worker", "index.ts"),
    ]);
    expect(cmd.env.ELECTRON_RUN_AS_NODE).toBeUndefined();
  });

  it("spawns Electron's node with the compiled entry in packaged mode", () => {
    const cmd = buildSpawnCommand({ ...baseOpts, mode: "packaged" }, "loop");

    expect(cmd.command).toBe(EXEC);
    expect(cmd.args).toEqual([
      `--env-file=${ENV_FILE}`,
      path.join(ROOT, "dist", "worker", "index.mjs"),
    ]);
    expect(cmd.env.ELECTRON_RUN_AS_NODE).toBe("1");
  });

  it("appends --once only for run-once", () => {
    const once = buildSpawnCommand({ ...baseOpts, mode: "dev" }, "once");
    const loop = buildSpawnCommand({ ...baseOpts, mode: "dev" }, "loop");

    expect(once.args).toContain("--once");
    expect(loop.args).not.toContain("--once");
  });

  it("appends --watch <id> (and not --once) for a per-watch search", () => {
    const cmd = buildSpawnCommand({ ...baseOpts, mode: "dev" }, "once", "w123");

    expect(cmd.args).toContain("--watch");
    expect(cmd.args).toContain("w123");
    expect(cmd.args).not.toContain("--once");
    // order: --watch immediately followed by the id
    const i = cmd.args.indexOf("--watch");
    expect(cmd.args[i + 1]).toBe("w123");
  });
});

/** Minimal stand-in for a spawned ChildProcess. */
class FakeChild extends EventEmitter {
  stderr = new EventEmitter();
  kill = vi.fn((_signal?: string) => {
    // emulate the OS delivering the signal → process exits
    queueMicrotask(() => this.emit("exit", null));
    return true;
  });
}

function makeRunner() {
  const children: FakeChild[] = [];
  const spawnFn = vi.fn(() => {
    const c = new FakeChild();
    children.push(c);
    return c;
  }) as unknown as typeof import("node:child_process").spawn;
  const runner = new WorkerRunner({ ...baseOpts, mode: "dev", spawnFn });
  return { runner, children, spawnFn };
}

describe("WorkerRunner — global job", () => {
  it("starts idle", () => {
    const { runner } = makeRunner();
    expect(runner.getStatus().state).toBe("idle");
    expect(runner.getStatus().lastRun).toBeNull();
  });

  it("runOnce -> running-once, then idle when the child exits 0", () => {
    const { runner, children } = makeRunner();
    runner.runOnce();
    expect(runner.getStatus().state).toBe("running-once");

    children[0]!.emit("exit", 0);
    const status = runner.getStatus();
    expect(status.state).toBe("idle");
    expect(status.lastRun?.mode).toBe("once");
    expect(status.lastRun?.ok).toBe(true);
    expect(status.lastRun?.exitCode).toBe(0);
  });

  it("start -> looping and stays until stopped", () => {
    const { runner, children } = makeRunner();
    runner.start();
    expect(runner.getStatus().state).toBe("looping");

    runner.stop();
    expect(children[0]!.kill).toHaveBeenCalled();
    children[0]!.emit("exit", null);
    expect(runner.getStatus().state).toBe("idle");
  });

  it("ignores a second global request while busy", () => {
    const { runner, spawnFn } = makeRunner();
    runner.start();
    runner.runOnce(); // no-op while looping
    expect(spawnFn).toHaveBeenCalledTimes(1);
    expect(runner.getStatus().state).toBe("looping");
  });

  it("records a non-zero exit as a failure with the stderr tail", () => {
    const { runner, children } = makeRunner();
    runner.runOnce();
    children[0]!.stderr.emit("data", Buffer.from("boom: missing TELEGRAM_BOT_TOKEN"));
    children[0]!.emit("exit", 1);

    const last = runner.getStatus().lastRun;
    expect(last?.ok).toBe(false);
    expect(last?.exitCode).toBe(1);
    expect(last?.errorTail).toContain("missing TELEGRAM_BOT_TOKEN");
  });

  it("notifies global subscribers on every transition", () => {
    const { runner, children } = makeRunner();
    const seen: string[] = [];
    runner.onChange((s) => seen.push(s.state));

    runner.runOnce();
    children[0]!.emit("exit", 0);

    expect(seen).toEqual(["running-once", "idle"]);
  });
});

describe("WorkerRunner — per-watch jobs", () => {
  it("searchWatch -> searching, then idle on exit 0", () => {
    const { runner, children } = makeRunner();
    runner.searchWatch("w1");
    expect(runner.getWatchStatus("w1").state).toBe("searching");

    children[0]!.emit("exit", 0);
    const s = runner.getWatchStatus("w1");
    expect(s.state).toBe("idle");
    expect(s.lastRun?.ok).toBe(true);
  });

  it("stopWatchSearch kills the child and returns to idle", () => {
    const { runner, children } = makeRunner();
    runner.searchWatch("w1");
    runner.stopWatchSearch("w1");
    expect(children[0]!.kill).toHaveBeenCalled();
    children[0]!.emit("exit", null);
    expect(runner.getWatchStatus("w1").state).toBe("idle");
  });

  it("ignores a second search for the same watch while searching", () => {
    const { runner, spawnFn } = makeRunner();
    runner.searchWatch("w1");
    runner.searchWatch("w1");
    expect(spawnFn).toHaveBeenCalledTimes(1);
  });

  it("runs a watch search independently of the global loop", () => {
    const { runner, children, spawnFn } = makeRunner();
    runner.start(); // global loop running
    runner.searchWatch("w1"); // not blocked by global

    expect(spawnFn).toHaveBeenCalledTimes(2);
    expect(runner.getStatus().state).toBe("looping");
    expect(runner.getWatchStatus("w1").state).toBe("searching");

    children[1]!.emit("exit", 0); // watch finishes
    expect(runner.getWatchStatus("w1").state).toBe("idle");
    expect(runner.getStatus().state).toBe("looping"); // global unaffected
  });

  it("reports all per-watch statuses", () => {
    const { runner } = makeRunner();
    runner.searchWatch("w1");
    runner.searchWatch("w2");
    const all = runner.getAllWatchStatuses();
    expect(all.map((s) => s.watchId).sort()).toEqual(["w1", "w2"]);
    expect(all.every((s) => s.state === "searching")).toBe(true);
  });

  it("notifies watch subscribers on transitions", () => {
    const { runner, children } = makeRunner();
    const seen: string[] = [];
    runner.onWatchChange((s) => seen.push(`${s.watchId}:${s.state}`));

    runner.searchWatch("w1");
    children[0]!.emit("exit", 0);

    expect(seen).toEqual(["w1:searching", "w1:idle"]);
  });
});
