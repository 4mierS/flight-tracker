import { prisma } from "../lib/db"

/**
 * Inserts the Germany→Jordan watch so the worker tracks it every cycle.
 * Run: npm run seed
 * Idempotent: re-running replaces the watch with the same label instead of
 * creating duplicates. Then `npm run worker:once` to do a single fetch cycle.
 */
const LABEL = "Germany→Jordan"

async function main() {
  // Idempotency: clear any prior watch with this label before re-creating.
  await prisma.watch.deleteMany({ where: { label: LABEL } })

  const watch = await prisma.watch.create({
    data: {
      label: LABEL,
      // German airports with nonstop service to Amman.
      origins: ["DUS", "HAM"],
      destinations: ["AMM"],
      tripType: "RETURN",

      // Depart window: All of July
      departFrom: new Date("2026-07-01"),
      departTo: new Date("2026-07-31"),
      // Return window: July 10 through August 30 (so 9-30 day stays from July departures)
      returnFrom: new Date("2026-07-10"),
      returnTo: new Date("2026-08-30"),
      minStayDays: 9,
      maxStayDays: 30,

      directOnly: false,
      maxStops: 2,
      passengers: 3,

      threshold: 700, // alert at/below 700 EUR
      currency: "EUR",
      active: true,
    },
  })
  console.log("Created watch:", watch.id, watch.label)
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => prisma.$disconnect())
