# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Flight Price Tracker** — A self-hosted flight price monitoring engine that continuously tracks prices across user-defined routes, maintains full price history, and sends Telegram alerts for new lows or below-threshold prices.

Key insight: The system is built on **append-only snapshots**, not live pricing. Every observed price is stored as a new `PriceSnapshot` row, enabling trend detection and new-low discovery without overwriting historical data.

## Tech Stack

- **Language**: TypeScript (ESM, run-from-source via `tsx`)
- **Runtime**: Node.js 20+
- **Database**: PostgreSQL + Prisma 6.2.1 (append-only schema)
- **Scheduler**: `node-cron` (polls on a configurable interval)
- **UI**: Electron (React renderer) + desktop background worker
- **Testing**: Vitest
- **Config**: Zod-validated environment variables (fail-fast at boot)
- **Alerts**: Telegram Bot API
- **Flight data**: Travelpayouts Data API (cached recent searches, not live bookings)

## Architecture

### Core Flow

```
worker/index.ts (scheduled or on-demand)
  ↓
run-watch.ts (for each active Watch)
  ↓
providers/travelpayouts.ts (fetch offers via FlightDataProvider interface)
  ↓
Database:
  - PriceSnapshot (append-only, indexed by watch+date)
  - AlertSent (dedupe to prevent re-alerting same deal)
  - Watch (configuration)
  - Settings (global caps, retention policy)
  ↓
notify/telegram.ts (send alert if new low or below threshold)
```

### Key Data Models (Prisma)

- **Watch**: Route configuration (origins[], destinations[], date windows, constraints, thresholds, active/snooze flags)
- **PriceSnapshot**: Every observed price (append-only; indexed for fast history lookups)
- **AlertSent**: Deduplication table with `dedupeKey` unique constraint (prevents re-alerting same deal)
- **Settings**: Global config (daily alert cap, timezone, retention limits)

### Provider Pattern

The worker doesn't import a concrete provider directly. Instead:
1. `src/lib/providers/index.ts` exports `getProvider()` — single point where the active provider is selected
2. `TravelpayoutsProvider` implements `FlightDataProvider` interface (defined in `types.ts`)
3. To add a second source: create a new provider class, switch selection in `index.ts`

### Append-Only Design

- `PriceSnapshot` is **never updated**; queries always ask "what's the best price we've seen?"
- Enables safe concurrent runs (no locking needed) and natural trend detection
- Retention can be configured (Settings: `retentionDays`, `maxSnapshotsPerWatch`) but deletes never overwrite

### Alert Deduplication

- Alert deduplication happens via a **unique constraint on `dedupeKey`** in `AlertSent`
- Worker attempts an `INSERT` first; if it violates the constraint, no alert is sent
- This is the "insert-first-check-later" pattern, not check-then-insert (which has a race)

## Development Commands

| Command | What it does |
|---------|------------|
| `npm run worker` | Worker in watch mode (reloads on source changes) |
| `npm run worker:start` | Run scheduled worker (boots once, then on `CRON_SCHEDULE`) |
| `npm run worker:once` | Single fetch cycle, then exit (for testing) |
| `npm run seed` | Insert sample watch (idempotent by label) |
| `npm run gui:dev` | Vite dev server (http://localhost:5173) + Electron in dev |
| `npm run gui:build` | Build React renderer + Electron main/preload to dist/ |
| `npm run gui:start` | Run packaged Electron app from dist/ |
| `npm run test` | Run all tests (vitest) in CI mode |
| `npm run test:watch` | Run tests in watch mode |
| `npm run prisma:generate` | Regenerate Prisma client (auto-run after schema changes) |
| `npm run prisma:migrate` | Create/apply dev migration interactively |
| `npm run prisma:deploy` | Apply pending migrations (production — non-interactive) |
| `npm run prisma:studio` | Open Prisma Studio UI to browse/edit data |

## Database Setup

1. **Start Postgres** (local dev):
   ```bash
   docker compose up -d db
   ```

2. **Apply migrations**:
   ```bash
   npx prisma migrate dev --name init
   ```

3. **Optional: Seed with example watch**:
   ```bash
   npm run seed
   ```

4. **For production deploys**:
   ```bash
   npm run prisma:deploy
   ```

## Configuration (Environment Variables)

All configuration is validated by `src/lib/env.ts` using Zod. Missing required vars cause a boot-time error.

**Required:**
- `DATABASE_URL` — PostgreSQL connection string
- `TRAVELPAYOUTS_TOKEN` — API token from Travelpayouts (affiliate account)
- `TELEGRAM_BOT_TOKEN` — Bot token from @BotFather
- `TELEGRAM_CHAT_ID` — Chat ID from @userinfobot

**Optional (with defaults):**
- `TRAVELPAYOUTS_MARKET` — Cache market (`uk`/`us`/`ru`…; default `uk`)
- `CRON_SCHEDULE` — node-cron expression (default `"0 */4 * * *"` = every 4 hours)
- `DEFAULT_CURRENCY` — Fallback currency (default `EUR`)
- `PROVIDER_REQUEST_DELAY_MS` — Delay between API calls (default `400`ms, respect rate limits)

See `.env.example` for an annotated template.

## Testing

- **Framework**: Vitest
- **Pattern**: No separate vitest.config (uses defaults); config is in `package.json`
- **Test files**: Colocated with source (e.g., `daily-cap.ts` + `daily-cap.test.ts`)
- **Run**: `npm run test` (CI mode), `npm run test:watch` (dev)

### Writing Tests

Tests use `describe`/`it` from vitest:

```typescript
import { describe, it, expect } from "vitest"

describe("myFunction", () => {
  it("does X when Y", () => {
    expect(result).toBe(expected)
  })
})
```

**Mocking Prisma**: Tests create a minimal stub that exposes only what the code touches (see `daily-cap.test.ts` for the pattern). This avoids importing the real Prisma client in tests.

## File Structure

```
src/
  worker/
    index.ts           # Scheduler entry, --once/--watch flags, tick loop
    run-watch.ts       # Core logic: collect offers → filter → snapshot → alert
    daily-cap.ts       # Global daily alert cap with timezone support
    seed-example.ts    # Sample watch (edit to define your own)
    cleanup.ts         # Prune old snapshots by age/count
    *.test.ts          # Tests (colocated)
  
  lib/
    env.ts             # Zod-validated environment (boots with all required vars)
    db.ts              # Prisma client singleton
    providers/
      index.ts         # getProvider() — single point of provider selection
      types.ts         # FlightDataProvider interface + FlightOffer type
      travelpayouts.ts # Concrete Travelpayouts API client
    notify/
      telegram.ts      # Send Telegram alerts

  desktop/
    main.ts            # Electron main process
    preload.ts         # Preload bridge (IPC)
    handlers.ts        # IPC handlers (spawn worker, fetch watch, etc.)
    worker-runner.ts   # Spawns worker process
    
  renderer/
    App.tsx            # React root
    global.d.ts        # Type definitions for IPC

prisma/
  schema.prisma        # Data models (Watch, PriceSnapshot, AlertSent, Settings)
  migrations/          # Auto-generated migration files

vite.config.ts         # Main: builds Electron main + preload + React renderer
vite.worker.config.ts  # Separate build for packaged worker
```

## Key Concepts to Understand

### Month-Based Provider Queries

`run-watch.ts` expands date ranges into **month-based queries**. The `monthsBetween()` function computes distinct YYYY-MM values, and the worker queries once per month (not once per day). This reduces API calls while covering the full date range.

### Deduplication via Unique Constraint

Alert deduplication uses a **unique constraint on `dedupeKey`** in the `AlertSent` table. The worker tries to insert; if the constraint is violated, it knows the alert was already sent.

**Important**: Do not use a check-then-insert pattern (race condition). Always insert first.

### Snapshot Retention

Snapshots can be pruned by age or per-watch count via Settings. Pruning is non-fatal; if it fails, the run continues. See `cleanup.ts` and the prune logic in `worker/index.ts`.

### Telegram Alert Deduplication & Daily Cap

- **Dedup**: `AlertSent.dedupeKey` unique constraint
- **Daily cap**: `Settings.dailyMessageCap` + `Settings.timezone`. The `canSendNow()` function counts alerts sent since local midnight in the configured timezone, blocking new alerts once the cap is reached.

## Common Development Tasks

### Add a New Watch

1. **Option A**: Edit `src/worker/seed-example.ts`, adjust fields, run `npm run seed`
2. **Option B**: Open `npm run prisma:studio`, add a `Watch` row manually

### Add a Provider (e.g., Kiwi, Kayak)

1. Create `src/lib/providers/my-provider.ts` implementing `FlightDataProvider`
2. Update `src/lib/providers/index.ts` to instantiate it (add env var if needed)
3. Tests for the new provider should mock the external API

### Modify the Schema

1. Update `prisma/schema.prisma`
2. Run `npm run prisma:migrate` to create a migration interactively
3. The migration is auto-applied locally; push `migrations/` to git

### Deploy

1. Ensure all migrations are applied: `npm run prisma:deploy`
2. Set environment variables on the VPS
3. Run `docker compose up -d` (uses `docker-compose.yml`)
4. Worker starts automatically; logs go to Docker

## Notes on Electron Development

- **Dev mode**: `npm run gui:dev` starts Vite on port 5173 + Electron window pointing to it
- **Build**: `npm run gui:build` compiles React to `dist/renderer` + Electron main to `dist/desktop`
- **Packaged mode**: Worker runs as a child process spawned by the Electron main thread
- **Preload bridge**: `src/desktop/preload.ts` exposes IPC methods to the renderer (sandbox)
- The Electron app embeds the worker logic but can also run the worker standalone via npm scripts

## Testing Strategy

- **Unit tests**: Utility functions, filtering logic, timezone math (see `daily-cap.test.ts`)
- **Integration**: Worker + database interactions (mocked Prisma)
- **No E2E setup yet**: The project is pre-release; E2E tests can be added later with Playwright or similar

## Debugging Tips

1. **Worker logs**: Check console output (timestamp, run duration, errors)
2. **Database state**: `npm run prisma:studio` to inspect records
3. **Single watch**: `npm run worker:once --watch <watchId>` to debug a specific watch
4. **API responses**: `run-watch.ts` and `travelpayouts.ts` include detailed logging (watch for `console.log` in production)

## Common Pitfalls

- **Forgetting migrations**: If schema changes, always run `npm run prisma:migrate` (and push migrations to git)
- **Hardcoded env vars**: Always read from `env.ts`, never from `process.env` directly
- **Overwriting snapshots**: Never `UPDATE PriceSnapshot`; always `INSERT` append-only
- **Alert race condition**: Do not check-then-insert; use unique constraint + insert-first
- **Database connection**: Ensure `DATABASE_URL` is set before starting the worker

## Related Documentation

- **Product Requirements**: `docs/PRD.md` (market data source rationale, roadmap)
- **README**: High-level overview + quick-start guide
- **Prisma Docs**: Schema design, migrations, client API
- **node-cron**: Cron expression syntax (https://crontab.guru)
- **Travelpayouts**: API docs (cached data, rate limits, market codes)
