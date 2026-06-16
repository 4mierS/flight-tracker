import cron from "node-cron";
import { env } from "../lib/env";
import { prisma } from "../lib/db";
import { processAllWatches } from "./run-watch";

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
  } catch (err) {
    console.error("Run threw:", err);
  } finally {
    running = false;
    console.log(`(${reason}) took ${Math.round((Date.now() - started) / 1000)}s`);
  }
}

async function main() {
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
