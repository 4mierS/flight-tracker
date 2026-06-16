import { prisma } from "../lib/db";

/**
 * Inserts the Germany→Jordan watch so the worker tracks it every cycle.
 * Run: npm run seed
 * Idempotent: re-running replaces the watch with the same label instead of
 * creating duplicates. Then `npm run worker:once` to do a single fetch cycle.
 */
const LABEL = "Germany→Jordan (direct)";

async function main() {
  // Idempotency: clear any prior watch with this label before re-creating.
  await prisma.watch.deleteMany({ where: { label: LABEL } });

  const watch = await prisma.watch.create({
    data: {
      label: LABEL,
      // German airports with nonstop service to Amman.
      origins: ["FRA", "MUC", "BER"],
      destinations: ["AMM"], // Amman, Queen Alia International
      tripType: "RETURN",

      // Depart window: next ~3 months.
      departFrom: new Date("2026-06-16"),
      departTo: new Date("2026-09-16"),
      // Return window: through end of September.
      returnFrom: new Date("2026-06-23"),
      returnTo: new Date("2026-09-30"),
      minStayDays: 7, // at least a week in Jordan

      directOnly: true, // strict nonstop only
      maxStops: 0,
      passengers: 1,

      threshold: 350, // alert at/below 350 EUR
      currency: "EUR",
      active: true,
    },
  });
  console.log("Created watch:", watch.id, watch.label);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
