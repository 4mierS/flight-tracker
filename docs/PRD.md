# Flight Price Tracker — Product Requirements Document

|                  |                                                                          |
| ---------------- | ------------------------------------------------------------------------ |
| **Status**       | Draft v1.0                                                               |
| **Owner**        | Solo developer (self-hosted)                                             |
| **Last updated** | 2026-06-16                                                               |
| **Related**      | `flight-tracker-v1` scaffold (Prisma schema, worker, provider, Telegram) |

---

## 1. Overview

A self-hosted engine that continuously tracks flight prices across many user-defined routes, stores full price history, and pushes a notification when a route beats a price threshold or sets a new low. A dashboard gives an at-a-glance view of every tracked route with price-history charts.

The product is built for a single operator on their own infrastructure (Docker on a Hetzner VPS via Coolify). It is **not** a booking tool and **not** a live-fare search — it is a _monitoring and trend_ engine built on cached fare data, designed so the same pattern later extends to hotels and cars.

**Core value:** answer "is this route cheap right now, relative to its own history, and should I act?" without manually checking dozens of searches.

---

## 2. Problem & Motivation

Manually checking flight prices across multiple origins, destinations, and flexible dates is tedious and easy to forget. Consumer meta-search tools optimize for a single search at a time, don't retain personal history, and bury "is this actually a good price" behind marketing urgency. There is no personal, always-on system that watches _my_ routes, remembers what prices looked like last week, and only interrupts me when something is genuinely worth acting on.

This product fills that gap: a private, continuously-running watcher with memory.

---

## 3. Goals & Non-Goals

### Goals

- Track many routes against rich criteria (multi-origin/destination, flexible dates, min stay, stops, passengers).
- Persist **every** observed price so trend, new-low detection, and deal scoring are possible.
- Notify only when a route beats a threshold or hits a new low, without spam.
- Provide a dashboard overview of all routes with price-history charts.
- Keep the data source behind an interface so providers can be swapped or added without rewrites.
- Run cheaply on existing self-hosted infrastructure using free, ToS-compliant data.

### Non-Goals

- Real-time, booking-accurate fares (the data source is a recent-search cache, not live availability).
- Actually booking or holding flights.
- A multi-tenant or public product. Single operator only.
- Beating airlines' or meta-search engines' coverage. We track _selected_ routes, not the whole market.

---

## 4. Users & Use Cases

**Primary user:** the operator — a developer comfortable with the stack who self-hosts and consumes alerts on mobile via Telegram.

**Key use cases:**

1. _Set-and-forget a route._ "Watch DUS/CGN → BKK, departing any day in November, returning 10–30 days later, max 1 stop, alert under €650."
2. _Catch a drop._ Get a Telegram ping the moment a watched route sets a new low or crosses the threshold — with enough context (price vs. previous best, dates, stops, link) to judge it instantly.
3. _Judge whether a price is good._ Open the dashboard, see the route's price history, and tell whether "under threshold" is actually cheap or just normal.
4. _Find the cheapest dates in a window (v2)._ "Show me the cheapest weekend/month for this route" instead of fixed dates.
5. _Avoid noise._ Snooze or mute a route that's pinging too often.

---

## 5. Functional Requirements

Priority key: **P0** = required for that phase to ship, **P1** = expected, **P2** = nice-to-have.

### 5.1 Watches & search parameters

| ID    | Requirement                                                                                                         | Phase | Priority |
| ----- | ------------------------------------------------------------------------------------------------------------------- | ----- | -------- |
| FR-1  | A watch supports trip type: one-way or return.                                                                      | v1    | P0       |
| FR-2  | A watch accepts multiple origin and multiple destination airports; all combinations are searched.                   | v1    | P0       |
| FR-3  | Flexible dates: an outbound date window and (for return) a return date window. A fixed date is a window of one day. | v1    | P0       |
| FR-4  | Minimum stay duration ("at least N days there") for return trips.                                                   | v1    | P0       |
| FR-5  | Direct-only flag and a maximum number of stops.                                                                     | v1    | P0       |
| FR-6  | Number of passengers.                                                                                               | v1    | P1       |
| FR-7  | Per-watch price threshold and currency.                                                                             | v1    | P0       |
| FR-8  | Active/inactive flag and per-watch snooze-until timestamp.                                                          | v1    | P0       |
| FR-9  | Nearby-airport auto-expansion (e.g. DUS → also CGN, DTM, EIN, BRU within X km).                                     | v2    | P1       |
| FR-10 | Multi-city / open-jaw itineraries.                                                                                  | v3    | P2       |

### 5.2 Data collection & history

| ID    | Requirement                                                                                                                  | Phase | Priority |
| ----- | ---------------------------------------------------------------------------------------------------------------------------- | ----- | -------- |
| FR-11 | A scheduled worker runs every few hours and processes all active watches.                                                    | v1    | P0       |
| FR-12 | Every observed price matching a watch's criteria is stored as an append-only snapshot. Current prices are never overwritten. | v1    | P0       |
| FR-13 | Snapshots are recorded even while a watch is snoozed (only alerts are suppressed).                                           | v1    | P0       |
| FR-14 | The worker is stateless between runs; all state lives in the database so containers restart cleanly.                         | v1    | P0       |
| FR-15 | The worker tolerates per-route API failures without aborting the whole run.                                                  | v1    | P0       |

### 5.3 Smart features

| ID    | Requirement                                                                                        | Phase                      | Priority |
| ----- | -------------------------------------------------------------------------------------------------- | -------------------------- | -------- |
| FR-16 | Price history + trend per route, shown so the operator can judge "good vs. just under threshold."  | v1 (data) / v2 (trend UI)  | P0/P1    |
| FR-17 | "Cheapest weekend / cheapest month" sweep over a window, surfacing the cheapest date combinations. | v2                         | P1       |
| FR-18 | Deal scoring: rank by price vs. historical median and by price-per-day, not just absolute price.   | v2                         | P1       |
| FR-19 | Snooze/mute per route to control notification volume.                                              | v1 (snooze) / v2 (mute UX) | P0/P1    |

### 5.4 Alerting

| ID    | Requirement                                                                                        | Phase | Priority |
| ----- | -------------------------------------------------------------------------------------------------- | ----- | -------- |
| FR-20 | Notify via Telegram when a route's best price is at/below its threshold.                           | v1    | P0       |
| FR-21 | Notify when a route sets a new all-time low (relative to its stored history).                      | v1    | P0       |
| FR-22 | Alerts are deduplicated so the same deal is not sent repeatedly across runs.                       | v1    | P0       |
| FR-23 | Each alert includes route, dates, stops, price, previous best, airline, and a booking/search link. | v1    | P0       |
| FR-24 | Each alert surfaces the cached-data caveat ("verify before booking").                              | v1    | P1       |
| FR-25 | Email channel (via Resend) as a secondary notification option.                                     | v3    | P2       |

### 5.5 Dashboard

| ID    | Requirement                                                                 | Phase | Priority |
| ----- | --------------------------------------------------------------------------- | ----- | -------- |
| FR-26 | List all tracked routes with their latest best price and status.            | v1    | P0       |
| FR-27 | Per-route price-history chart.                                              | v1    | P1       |
| FR-28 | Clearly label data as cached/recent-search-derived, not live.               | v1    | P1       |
| FR-29 | Show trend, historical median, and deal score per route.                    | v2    | P1       |
| FR-30 | Create/edit/snooze watches from the dashboard (rather than DB/seed script). | v2    | P1       |

---

## 6. Data Source

### 6.1 Chosen source — Travelpayouts / Aviasales **Data API**

Free, ToS-compliant; access via a token obtained by registering in the Travelpayouts affiliate network. Token is passed in the `X-Access-Token` header. Responses use a `{ success, data, error }` envelope. Confirmed live as of 2026-06.

**Endpoints in use:**

| Purpose                        | Endpoint                               | Phase | Notes                                                                                                                                                                               |
| ------------------------------ | -------------------------------------- | ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Per-route snapshot (workhorse) | `GET /aviasales/v3/prices_for_dates`   | v1    | Returns `price` + `transfers`; accepts month (`YYYY-MM`) or day (`YYYY-MM-DD`). `one_way=true` collapses to one ticket, so return trips use `one_way=false` and filter client-side. |
| Cheapest-per-day sweep         | `GET /v2/prices/month-matrix`          | v2    | Returns `value` + `number_of_changes`. Feeds "cheapest weekend/month."                                                                                                              |
| Recent deals / trend feed      | `GET /aviasales/v3/get_latest_prices`  | v2    | Returns `value` + `number_of_changes`; useful for trend and discovery.                                                                                                              |
| Nearby-airport expansion       | `GET /v2/prices/nearest-places-matrix` | v2    | Returns a `prices[]` array (non-standard envelope); has `distance` + `flexibility` params.                                                                                          |

### 6.2 Critical constraints

- **Cached, not live.** Data is built from the last ~48 hours of real user searches and retained ~7 days. It reflects "what was recently seen on this route," not bookable real-time availability. This is acceptable and intended for a trend/monitoring tool. It must be surfaced clearly in alerts and the dashboard (FR-24, FR-28).
- **Field-name inconsistency across endpoints.** `prices_for_dates` uses `price`/`transfers`; the matrix and latest-prices endpoints use `value`/`number_of_changes`. The provider layer normalizes all of these to one internal `FlightOffer` shape so no downstream code depends on endpoint quirks.
- **Currency defaults to RUB** if not passed; the client always sends an explicit currency.
- **Market parameter.** Results come from a per-market cache; some EU routes return cleaner caches under `market=uk`/`us` than the default `ru`. Exposed as a configurable env var.
- **Rate limits apply** (per Travelpayouts' rate-limit policy). The worker spaces calls and processes watches sequentially.
- **APIs are migrating through 2026.** Endpoint versions must be re-confirmed when the token is provisioned.

### 6.3 Explicitly rejected options (do not re-litigate for v1)

- **Amadeus Self-Service** — being decommissioned **2026-07-17** (keys disabled); enterprise is paid/contract-only. Do not build on it.
- **VPN / IP rotation** — irrelevant for a token-authenticated API (we pass a currency param and get identical data regardless of server location). Only matters for scraping consumer sites, which is a ToS/maintenance liability.
- **Aviasales real-time Search API** — requires 50,000+ MAU; not available. Data API only.

---

## 7. Architecture

Four components, deployed as containers on Coolify with one `docker-compose`.

1. **Worker (scheduler).** A long-lived TypeScript container running `node-cron`. Every few hours it loops over active watches, calls the data source through a provider **interface**, writes snapshots, evaluates alerts, and notifies. Stateless between runs.
2. **Database (PostgreSQL + Prisma).** Single source of truth for all state. See §8.
3. **Notifications.** Telegram bot as the primary, mobile-friendly channel (v1). Email via Resend later (v3).
4. **Dashboard.** A small Next.js (App Router) app reading Postgres: route overview + price-history charts.

**Provider abstraction (load-bearing):** all data-source access goes through a `FlightDataProvider` interface returning a normalized `FlightOffer`. Adding or swapping a provider is one new file; the worker, alerting, and dashboard never change.

```
node-cron worker ──> FlightDataProvider (interface) ──> Travelpayouts client
       │                                                       │
       ├──> PriceSnapshot (append-only writes)                 └─ normalizes price/value,
       ├──> AlertSent (dedupe-first) ──> Telegram                 transfers/changes, links
       └── reads Watch config
Next.js dashboard ──> reads PriceSnapshot / Watch
```

---

## 8. Data Model

Three starting tables. **Design rule: `price_snapshots` is append-only.** History is cheap in Postgres, and without it, trend / new-low / deal-scoring cannot work.

- **`watches`** — route config: origins[], destinations[], trip type, outbound window, return window, min stay, max stops, direct-only, passengers, threshold, currency, snooze-until, active flag.
- **`price_snapshots`** — every observed price: watch ref, origin, destination, depart date, return date, stops, price, currency, airline, link, `found_at` (cache timestamp), `observed_at` (our record time). Indexed for "history for this watch" and "best for this route+dates."
- **`alerts_sent`** — dedupe ledger: watch ref, kind (`THRESHOLD` | `NEW_LOW`), route, dates, price, and a unique `dedupe_key`. Inserted before sending; Telegram fires only if the insert wins, which is the actual anti-spam mechanism.

(Authoritative schema lives in `prisma/schema.prisma` in the scaffold.)

---

## 9. Non-Functional Requirements

| Area               | Requirement                                                                                                                                                         |
| ------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Reliability**    | A single route or provider error must not abort a run. Worker restarts cleanly with no lost state. Overlapping runs are prevented (skip if previous still running). |
| **Rate limits**    | Calls are spaced (configurable delay) and watches processed sequentially to stay within Travelpayouts limits.                                                       |
| **Cost**           | Free data source and free tooling. Runs within existing Hetzner VPS capacity.                                                                                       |
| **Security**       | Secrets (API token, bot token) only via env vars, never committed. Single-operator; no public auth surface in v1.                                                   |
| **Observability**  | Structured per-run logging: watches processed, best price per watch, previous best, alerts fired, errors.                                                           |
| **Data integrity** | Snapshots append-only; alert dedupe enforced by a DB unique constraint, not application logic alone.                                                                |
| **Portability**    | Provider interface keeps the system independent of any single data source.                                                                                          |

---

## 10. Roadmap & Milestones

### v1 — MVP (foundation)

Single/few routes, fixed-or-windowed dates, threshold + new-low alerting, scheduled worker, append-only snapshots, Telegram alerts, minimal dashboard.

**Acceptance criteria:**

- A watch can be created with multi-origin/destination, date windows, min stay, max stops, threshold, currency.
- The worker runs on schedule, stores a snapshot per matching offer, and survives per-route failures.
- A new low and a below-threshold price each produce exactly one Telegram alert; re-runs on the same fare produce none.
- Snoozed watches still record snapshots but send no alerts.
- The dashboard lists routes with latest price and a per-route history chart.

### v2 — Smart features

Cheapest-weekend/month sweep (`month-matrix`), nearby-airport expansion (`nearest-places-matrix`), deal scoring (vs. historical median + price-per-day), snooze/mute UX, dashboard watch management.

**Acceptance criteria:**

- A window sweep surfaces the cheapest date combinations for a route.
- A watch can auto-expand to nearby airports within a configured radius.
- Each route shows a deal score derived from its own history, not just absolute price.
- Watches can be created/edited/snoozed from the dashboard.

### v3 — Expansion

Multi-city / open-jaw support, email channel (Resend), then generalize the engine pattern to hotels and cars.

**Acceptance criteria:**

- An open-jaw itinerary can be tracked end-to-end.
- Alerts can be delivered by email in addition to Telegram.
- The provider/worker/snapshot pattern is reused for at least one non-flight vertical.

---

## 11. Success Metrics

This is a personal tool, so metrics are about usefulness, not growth:

- **Signal quality:** a high share of alerts are ones the operator considers worth acting on (low false-positive/spam rate).
- **Coverage:** number of routes tracked without manual effort or breakage.
- **Trust:** the operator can answer "is this price good?" from the dashboard without a separate manual search.
- **Reliability:** scheduled runs complete on time with negligible missed cycles.
- **Catch rate (qualitative):** genuine lows are surfaced promptly rather than missed.

---

## 12. Risks & Mitigations

| Risk                                           | Impact                                | Mitigation                                                                                                                                   |
| ---------------------------------------------- | ------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Cached data misleads vs. live fares            | Acting on a stale/unavailable price   | Label data as cached everywhere; treat as trend signal; include search link to verify before booking.                                        |
| Travelpayouts API migration breaks endpoints   | Worker stops collecting               | Provider interface isolates the blast radius; re-confirm endpoint versions at token setup; per-route error tolerance keeps the rest running. |
| Rate limiting / throttling                     | Incomplete runs                       | Sequential processing + configurable inter-call delay; back off on errors.                                                                   |
| Alert spam                                     | Notification fatigue, tool gets muted | Dedupe-first via DB unique constraint; per-route snooze/mute.                                                                                |
| Sparse or wrong-currency cache for some routes | Empty/odd results                     | Configurable `market` param; explicit currency on every call.                                                                                |
| Single source of truth (one provider)          | Fragility if it degrades              | Interface designed for additional providers; revisit if reliability drops.                                                                   |
| Scope creep into a live-booking product        | Wasted effort, ToS exposure           | Non-goals fixed: monitoring only, no booking, no scraping.                                                                                   |

---

## 13. Open Questions

- What inter-call delay and run cadence keep us comfortably under Travelpayouts rate limits in practice?
- Which `market` value gives the best EUR cache coverage for the operator's core EU routes?
- For deal scoring, what history window and statistic (median vs. percentile) best separate "real deal" from noise?
- Should new-low alerts be per route+date-combo or per watch overall (current scaffold: per watch best)?
- How long should snapshot history be retained before any pruning/aggregation becomes worthwhile?

---

## 14. Out of Scope (v1)

- Live, bookable fares and seat availability.
- Booking, payment, or price-hold functionality.
- Multi-user accounts, sharing, or a public interface.
- Hotels and cars (engine generalization is v3+).
- Web scraping of consumer travel sites and any VPN/proxy infrastructure.
