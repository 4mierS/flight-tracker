# Desktop GUI + Daily Message Cap — Design

| | |
| --- | --- |
| **Status** | Approved 2026-06-16 |
| **Related** | `docs/PRD.md` (FR-26, FR-30 pulled forward; FR-19 extended) |

## Goal

Replace the seed-script workflow with a **local desktop app** to manage watches and
settings, and add a **global daily cap** on Telegram alerts. The price-checking worker
and Postgres stay on the always-on server so alerts never stop; the desktop app is a
second consumer of the same database.

## Decisions (locked during brainstorming)

- **Daily cap is global** — one number across all watches.
- **On cap reached: drop until tomorrow** — stop sending; extra deals are skipped.
  Applies uniformly to THRESHOLD and NEW_LOW.
- **Local GUI, worker stays on server (24/7)** — keeps alerts always-on.
- **Desktop app talks directly to Postgres via Prisma** (SSL / SSH tunnel) — no API layer.
- **Electron** desktop framework — reuses existing TS/Prisma code with no new language.
- **GUI scope v1:** watch CRUD + snooze/activate + Settings (cap). Charts deferred.
- Web password/PIN is **moot** (no web surface); security rests on the DB connection.

## Architecture

```
 YOUR PC                          ALWAYS-ON SERVER (Hetzner/Coolify)
┌──────────────────────┐         ┌─────────────────────────────────┐
│ Electron desktop app │         │  node-cron worker (every 4h)    │
│  • main process      │         │   ├─ reads Watch + Settings     │
│    └ PrismaClient ───┼──SSL───▶│  PostgreSQL  ◀──────────────────┤
│  • renderer (React)  │  /tunnel│   ├─ writes PriceSnapshot       │
│    └ IPC only        │         │   └─ AlertSent + Telegram       │
└──────────────────────┘         └─────────────────────────────────┘
```

The desktop app and worker share `prisma/schema.prisma` and `src/lib`.

## Repo layout

```
src/
  lib/            # shared: db, env, providers, notify, validation (new)
  worker/         # unchanged except run-watch.ts cap check
  desktop/
    main.ts       # Electron main; owns PrismaClient; registers IPC handlers
    preload.ts    # contextBridge → typed window.api (renderer's only DB path)
  renderer/       # React + Vite UI (watch list, editor, settings)
```

Tooling: `electron`, `electron-builder`, `vite`, `@vitejs/plugin-react`, `react`,
`react-dom`. New scripts: `gui:dev`, `gui:build`.

## Data model change

One new singleton table; **no change to `Watch`**:

```prisma
model Settings {
  id              String   @id @default("singleton")
  dailyMessageCap Int?     // null = unlimited
  timezone        String   @default("Europe/Berlin")
  updatedAt       DateTime @updatedAt
}
```

## Daily-cap enforcement (worker)

In `fireAlert`, **before** the dedupe insert:

1. Load `Settings.dailyMessageCap` (null ⇒ unlimited, no-op).
2. Count `AlertSent` rows with `sentAt >= start-of-today` in `Settings.timezone`.
3. If `count >= cap` → **skip both the dedupe insert and the send**, so the deal stays
   eligible to alert tomorrow. Log `cap reached: N/N today, skipping`.

No new counter: `AlertSent.sentAt` is the ledger. Watches process sequentially, so a
re-query per alert is correct. A pure helper `isUnderDailyCap(count, cap)` is unit-tested.

## Desktop UI (3 screens)

- **Watch list** — per watch: label, route, trip type, latest best price, threshold,
  active/snoozed badge. Actions: edit · snooze · activate/deactivate · delete.
- **Watch editor** — every `Watch` field, validated by a shared Zod schema
  (`src/lib/validation/watch.ts`) reused by the IPC handler. Replaces the seed script.
- **Settings** — daily message cap (blank = unlimited) + timezone.

## Security & data flow

- Renderer has **no DB access**; it calls `window.api.watches.*` / `settings.*` over IPC.
  Only the main process holds `PrismaClient` and `DATABASE_URL`.
- `DATABASE_URL` lives in a local, uncommitted config pointing at remote Postgres over
  `sslmode=require` (or SSH tunnel). IP allowlist recommended in Coolify.

## Error handling

IPC handlers return `{ ok: true, data }` / `{ ok: false, error }`. UI shows inline
validation errors and a "can't reach server database" state on connection failure.

## Testing

- **Unit:** Zod watch schema; `isUnderDailyCap(count, cap)`.
- **Integration:** worker cap behavior (mock prisma — under-cap sends + inserts;
  at/over-cap skips both).
- **Renderer:** form-validation component tests (Vitest + React Testing Library).
- Electron E2E (Playwright) deferred.

## Build caveat

Repo is on the Windows filesystem under WSL. Electron GUI needs WSLg to run from WSL;
`electron-builder` must bundle the Prisma query engine for `windows`. Pin the engine
target; document packaging from the Windows side if WSLg is fussy.

## Out of scope (deferred)

Price-history charts, "run now" trigger, web/PWA, multi-user, email channel.