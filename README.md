# Flight Price Tracker

A self-hosted engine that continuously tracks flight prices across user-defined
routes, stores **full price history**, and pushes a **Telegram alert** when a route
beats a price threshold or sets a new all-time low.

It's a personal *monitoring and trend* tool built on cached fare data — not a
booking tool and not a live-fare search. The goal is to answer *"is this route
cheap right now, relative to its own history, and should I act?"* without manually
checking dozens of searches.

> See [`docs/PRD.md`](docs/PRD.md) for the full product requirements, data-source
> rationale, and roadmap.

## How it works

A long-lived **worker** (`node-cron`) wakes on a schedule and, for every active
watch:

1. Expands `origins[] × destinations[]` and the depart/return date windows into
   individual provider queries.
2. Fetches offers through a **provider interface** (Travelpayouts Data API today;
   swappable by adding one file) and normalizes them to a single `FlightOffer` shape.
3. Writes **every** matching offer as an append-only `PriceSnapshot` — current
   prices are never overwritten, which is what makes trend / new-low detection possible.
4. Compares the run's best price against the watch's stored history and threshold.
5. Sends a Telegram alert for a **new low** or a **below-threshold** price —
   deduplicated via a DB unique constraint so the same deal never pings twice.

Snapshots are recorded even while a watch is snoozed; only alerts are suppressed.
A global **daily message cap** (configured in the `Settings` row) can throttle how
many Telegram alerts go out per day — capped deals stay eligible and re-alert once
the cap resets. The worker is stateless between runs (all state lives in Postgres)
and tolerates per-route API failures without aborting the cycle.

```
node-cron worker ──> FlightDataProvider ──> Travelpayouts client
       │
       ├──> PriceSnapshot (append-only)
       ├──> AlertSent (dedupe-first) ──> Telegram
       └──  reads Watch config
```

## Tech stack

- **TypeScript** + [`tsx`](https://github.com/privatenumber/tsx) (ESM, run-from-source)
- **PostgreSQL** + **Prisma** (single source of truth)
- **node-cron** scheduler
- **Zod**-validated environment (fails fast at boot if config is missing)
- **Docker Compose** for local dev and Coolify/VPS deployment

## Prerequisites

- Node.js 20+ and npm
- Docker (for the local Postgres) **or** any reachable PostgreSQL instance
- A [Travelpayouts](https://www.travelpayouts.com/) affiliate account → **API token**
- A Telegram bot token (via [@BotFather](https://t.me/BotFather)) and your chat id
  (via [@userinfobot](https://t.me/userinfobot))

## Quick start

```bash
npm install
cp .env.example .env        # fill in TRAVELPAYOUTS_TOKEN, TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID
docker compose up -d db     # or point DATABASE_URL at any Postgres
npx prisma migrate dev --name init
npm run seed                # inserts one sample watch (Germany → Jordan, direct)
npm run worker:once         # single fetch cycle — should snapshot + alert
```

Once verified, run the worker on its schedule:

```bash
npm run worker:start        # runs once on boot, then on CRON_SCHEDULE
```

## Configuration

All config is environment variables, validated by [`src/lib/env.ts`](src/lib/env.ts).
See [`.env.example`](.env.example) for the annotated template.

| Variable | Required | Default | Description |
| --- | :---: | --- | --- |
| `DATABASE_URL` | ✅ | — | PostgreSQL connection string. |
| `TRAVELPAYOUTS_TOKEN` | ✅ | — | Travelpayouts Data API token (Profile → API token). |
| `TRAVELPAYOUTS_MARKET` | | `uk` | Cache market (`uk`/`us`/`ru`…). EU routes often read cleaner under `uk`/`us`. |
| `TELEGRAM_BOT_TOKEN` | ✅ | — | Bot token from @BotFather (primary alert channel). |
| `TELEGRAM_CHAT_ID` | ✅ | — | Destination chat id from @userinfobot. |
| `CRON_SCHEDULE` | | `0 */4 * * *` | node-cron expression. Default: every 4 hours. [crontab.guru](https://crontab.guru) |
| `DEFAULT_CURRENCY` | | `EUR` | Default currency for new watches / fallback. |
| `PROVIDER_REQUEST_DELAY_MS` | | `400` | Delay between provider calls to respect rate limits. |

## npm scripts

| Script | What it does |
| --- | --- |
| `npm run worker` | Worker in watch mode (auto-reload on source change). |
| `npm run worker:start` | Run the worker: once on boot, then on `CRON_SCHEDULE`. |
| `npm run worker:once` | A single fetch cycle, then exit. Useful for testing/cron-from-outside. |
| `npm run seed` | Insert the sample watch (idempotent — replaces by label). |
| `npm run prisma:generate` | Regenerate the Prisma client. |
| `npm run prisma:migrate` | Create/apply a dev migration. |
| `npm run prisma:deploy` | Apply migrations in production (`migrate deploy`). |
| `npm run prisma:studio` | Open Prisma Studio to browse/edit data. |

## Defining watches

In v1, watches are created in the database (a dashboard UI is on the roadmap).
The fastest path is to copy [`src/worker/seed-example.ts`](src/worker/seed-example.ts)
and adjust the fields, or edit rows directly via `npm run prisma:studio`.

A `Watch` supports:

- **Route:** `origins[]` × `destinations[]` (IATA codes) — all combinations searched.
- **Trip type:** `ONE_WAY` or `RETURN`.
- **Date windows:** `departFrom`/`departTo` and (for returns) `returnFrom`/`returnTo`.
  A fixed date is a one-day window.
- **Constraints:** `minStayDays`, `maxStops`, `directOnly`, `passengers`.
- **Alerting:** `threshold` (alert at/below this, in whole currency units) + `currency`.
- **Control:** `active` flag and `snoozeUntil` (snapshots still recorded while snoozed).

See [`prisma/schema.prisma`](prisma/schema.prisma) for the authoritative model.

## Deployment

The repo ships a [`docker-compose.yml`](docker-compose.yml) with the **worker** +
**Postgres** (a dashboard service is stubbed in, commented out). On a VPS via
Coolify, point a resource at this file and supply the secrets as environment
variables. The worker container restarts cleanly because all state lives in the DB.

```bash
docker compose up -d        # db + worker
```

For production migrations, run `npm run prisma:deploy` (uses `migrate deploy`, not
the interactive dev flow).

## Data source caveat

Prices come from Travelpayouts' **cache of recent real searches** (roughly the last
~48h, retained ~7 days) — not live, bookable availability. Treat alerts as a *trend
signal* and always verify on the airline/search link before booking. This is
intended and acceptable for a monitoring tool; see PRD §6 for the full rationale.

## Project layout

```
src/
  worker/
    index.ts          # scheduler + run loop (--once for a single cycle)
    run-watch.ts      # core: collect → filter → snapshot → alert
    seed-example.ts   # sample watch
  lib/
    env.ts            # Zod-validated environment
    db.ts             # Prisma client
    providers/        # FlightDataProvider interface + Travelpayouts client
    notify/telegram.ts
prisma/
  schema.prisma       # Watch / PriceSnapshot / AlertSent / Settings
  migrations/
docs/PRD.md
```
