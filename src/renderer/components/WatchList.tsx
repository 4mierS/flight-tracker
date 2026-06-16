import { useState } from "react";
import type { WatchDTO } from "../../desktop/shared";

interface Props {
  watches: WatchDTO[] | null;
  onCreate: () => void;
  onEdit: (w: WatchDTO) => void;
  onChanged: () => Promise<void>;
}

function routeSummary(w: WatchDTO): string {
  return `${w.origins.join("/")} → ${w.destinations.join("/")}`;
}

function statusBadge(w: WatchDTO): { label: string; cls: string } {
  if (!w.active) return { label: "Paused", cls: "badge badge-muted" };
  if (w.snoozeUntil && new Date(w.snoozeUntil) > new Date())
    return { label: "Snoozed", cls: "badge badge-warn" };
  return { label: "Active", cls: "badge badge-ok" };
}

export function WatchList({ watches, onCreate, onEdit, onChanged }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);

  async function act(id: string, fn: () => Promise<{ ok: boolean; error?: string }>) {
    setBusyId(id);
    const res = await fn();
    setBusyId(null);
    if (!res.ok) alert(res.error ?? "Action failed");
    await onChanged();
  }

  if (watches === null) {
    return <div className="empty">Loading watches…</div>;
  }

  return (
    <section>
      <div className="section-head">
        <div>
          <h1>Watches</h1>
          <p className="muted">
            {watches.length} route{watches.length === 1 ? "" : "s"} tracked
          </p>
        </div>
        <button className="btn btn-primary" onClick={onCreate}>
          + New watch
        </button>
      </div>

      {watches.length === 0 ? (
        <div className="empty">
          No watches yet. Create one to start tracking a route.
        </div>
      ) : (
        <ul className="watch-grid">
          {watches.map((w) => {
            const badge = statusBadge(w);
            const snoozed = w.snoozeUntil && new Date(w.snoozeUntil) > new Date();
            return (
              <li key={w.id} className="watch-card">
                <div className="watch-card-top">
                  <span className={badge.cls}>{badge.label}</span>
                  {w.directOnly && <span className="badge badge-info">Direct</span>}
                </div>
                <h2 className="watch-route">{routeSummary(w)}</h2>
                <p className="watch-label">{w.label ?? "Untitled watch"}</p>

                <dl className="watch-meta">
                  <div>
                    <dt>Best seen</dt>
                    <dd>{w.bestPrice !== null ? `${w.bestPrice} ${w.currency}` : "—"}</dd>
                  </div>
                  <div>
                    <dt>Threshold</dt>
                    <dd>{w.threshold !== null ? `${w.threshold} ${w.currency}` : "—"}</dd>
                  </div>
                  <div>
                    <dt>Trip</dt>
                    <dd>{w.tripType === "RETURN" ? "Round-trip" : "One-way"}</dd>
                  </div>
                </dl>

                <div className="watch-actions">
                  <button className="btn btn-ghost" onClick={() => onEdit(w)}>
                    Edit
                  </button>
                  <button
                    className="btn btn-ghost"
                    disabled={busyId === w.id}
                    onClick={() =>
                      act(w.id, () => window.api.watches.setActive(w.id, !w.active))
                    }
                  >
                    {w.active ? "Pause" : "Resume"}
                  </button>
                  <button
                    className="btn btn-ghost"
                    disabled={busyId === w.id}
                    onClick={() =>
                      act(w.id, () =>
                        window.api.watches.snooze(
                          w.id,
                          snoozed
                            ? null
                            : new Date(Date.now() + 7 * 86_400_000).toISOString(),
                        ),
                      )
                    }
                  >
                    {snoozed ? "Unsnooze" : "Snooze 7d"}
                  </button>
                  <button
                    className="btn btn-danger"
                    disabled={busyId === w.id}
                    onClick={() => {
                      if (confirm(`Delete watch "${w.label ?? routeSummary(w)}"?`))
                        void act(w.id, () => window.api.watches.remove(w.id));
                    }}
                  >
                    Delete
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
