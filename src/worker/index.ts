import cron from "node-cron";
import { env } from "../lib/env";
import { prisma } from "../lib/db";
import { processAllWatches, processWatchById } from "./run-watch";
import { runCleanup } from "./cleanup";

/** Read the value following a CLI flag, e.g. `--watch <id>`. */
function flagValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

let running = false;

/** Guard against overlapping runs if one cycle outlasts the cron interval. */
async function tick(reason: string) {
  if (running) {
    console.warn(`Skipping ${reason}: previous run still in progress`);
    return;
  }
  running = true;
  const started = Date.now();
  try {
    await processAllWatches();
    await pruneSnapshots();
  } catch (err) {
    console.error("Run threw:", err);
  } finally {
    running = false;
    console.log(`(${reason}) took ${Math.round((Date.now() - started) / 1000)}s`);
  }
}

/**
 * Best-effort snapshot retention. Reads the current limits off the Settings
 * singleton each run, so config changes take effect on the next cycle. Failures
 * are logged but never abort the run — housekeeping must not block tracking.
 */
async function pruneSnapshots() {
  try {
    const settings = await prisma.settings.findUnique({
      where: { id: "singleton" },
      select: { retentionDays: true, maxSnapshotsPerWatch: true },
    });
    if (!settings) return;

    const { byAge, byCount } = await runCleanup(prisma, settings);
    if (byAge || byCount) {
      console.log(`Cleanup: removed ${byAge} by age, ${byCount} by count`);
    }
  } catch (err) {
    console.error("Cleanup failed (non-fatal):", err);
  }
}

async function main() {
  // Single-watch on-demand search (GUI "Search now"): run it and exit.
  const watchId = flagValue("--watch");
  if (watchId) {
    console.log(`Worker: single-watch search ${watchId}`);
    await processWatchById(watchId);
    await prisma.$disconnect();
    return;
  }

  console.log(`Worker up. Schedule: "${env.CRON_SCHEDULE}"`);

  // Run once immediately on boot, then on schedule.
  if (process.argv.includes("--once")) {
    await tick("manual --once");
    await prisma.$disconnect();
    return;
  }

  await tick("startup");
  cron.schedule(env.CRON_SCHEDULE, () => void tick("cron"));
}

// Clean shutdown so the container restarts cleanly (worker is stateless).
for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    console.log(`${sig} received, shutting down`);
    await prisma.$disconnect();
    process.exit(0);
  });
}

main().catch(async (err) => {
  console.error("Fatal on startup:", err);
  await prisma.$disconnect();
  process.exit(1);
});
