import { useCallback, useEffect, useRef, useState } from "react";
import type { WatchDTO, WatchRunStatus, SnapshotDTO } from "../../desktop/shared";

interface Props {
  watch: WatchDTO;
  runStatus: WatchRunStatus | undefined;
  busy: boolean;
  onEdit: (w: WatchDTO) => void;
  /** Run a watch-scoped action that returns the standard envelope, then refresh. */
  onAct: (id: string, fn: () => Promise<{ ok: boolean; error?: string }>) => Promise<void>;
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

function snapshotRoute(s: SnapshotDTO): string {
  return `${s.origin}→${s.destination}`;
}

function stopsLabel(stops: number): string {
  if (stops === 0) return "direct";
  return `${stops} stop${stops === 1 ? "" : "s"}`;
}

export function WatchCard({ watch: w, runStatus, busy, onEdit, onAct }: Props) {
  const [expanded, setExpanded] = useState(false);
  const [results, setResults] = useState<SnapshotDTO[] | null>(null);
  const [resultsError, setResultsError] = useState<string | null>(null);

  const searching = runStatus?.state === "searching";
  const lastRun = runStatus?.lastRun ?? null;
  const snoozed = w.snoozeUntil && new Date(w.snoozeUntil) > new Date();
  const badge = statusBadge(w);

  const loadResults = useCallback(async () => {
    const res = await window.api.watches.snapshots(w.id);
    if (res.ok) {
      setResults(res.data);
      setResultsError(null);
    } else {
      setResultsError(res.error);
    }
  }, [w.id]);

  const toggleResults = useCallback(() => {
    setExpanded((prev) => {
      const next = !prev;
      if (next && results === null) void loadResults();
      return next;
    });
  }, [results, loadResults]);

  // When a search completes, refresh the inline results if they're showing.
  const lastFinishedRef = useRef<string | null>(null);
  useEffect(() => {
    const finishedAt = runStatus?.lastRun?.finishedAt ?? null;
    if (finishedAt && finishedAt !== lastFinishedRef.current) {
      lastFinishedRef.current = finishedAt;
      if (expanded) void loadResults();
    }
  }, [runStatus?.lastRun?.finishedAt, expanded, loadResults]);

  return (
    <li className="watch-card">
      <div className="watch-card-top">
        <span className={badge.cls}>{badge.label}</span>
        {w.directOnly && <span className="badge badge-info">Direct</span>}
        {searching && <span className="badge badge-info">Searching…</span>}
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

      <div className="watch-search-row">
        {searching ? (
          <button
            className="btn btn-danger"
            onClick={() => void onAct(w.id, () => window.api.worker.stopWatchSearch(w.id))}
          >
            Stop
          </button>
        ) : (
          <button
            className="btn btn-primary"
            onClick={() => void onAct(w.id, () => window.api.worker.searchWatch(w.id))}
          >
            Search now
          </button>
        )}
        <button className="btn btn-ghost" onClick={toggleResults}>
          {expanded ? "▾" : "▸"} Recent results
        </button>
        {lastRun && lastRun.finishedAt && lastRun.ok === false && (
          <span className="worker-err" title={lastRun.errorTail ?? ""}>
            ✗ search failed
          </span>
        )}
      </div>

      {expanded && (
        <div className="watch-results">
          {resultsError ? (
            <p className="worker-err">{resultsError}</p>
          ) : results === null ? (
            <p className="muted">Loading…</p>
          ) : results.length === 0 ? (
            <p className="muted">No results recorded yet. Try “Search now”.</p>
          ) : (
            <ul className="result-list">
              {results.map((s) => (
                <li key={s.id} className="result-row">
                  <span className="result-price">
                    {s.price} {s.currency}
                  </span>
                  <span className="result-route">{snapshotRoute(s)}</span>
                  <span className="muted">{stopsLabel(s.stops)}</span>
                  <span className="result-dates muted">
                    {s.departDate}
                    {s.returnDate ? `→${s.returnDate}` : ""}
                  </span>
                  {s.link && (
                    <a href={s.link} target="_blank" rel="noopener noreferrer">
                      open
                    </a>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <div className="watch-actions">
        <button className="btn btn-ghost" onClick={() => onEdit(w)}>
          Edit
        </button>
        <button
          className="btn btn-ghost"
          disabled={busy}
          onClick={() => onAct(w.id, () => window.api.watches.setActive(w.id, !w.active))}
        >
          {w.active ? "Pause" : "Resume"}
        </button>
        <button
          className="btn btn-ghost"
          disabled={busy}
          onClick={() =>
            onAct(w.id, () =>
              window.api.watches.snooze(
                w.id,
                snoozed ? null : new Date(Date.now() + 7 * 86_400_000).toISOString(),
              ),
            )
          }
        >
          {snoozed ? "Unsnooze" : "Snooze 7d"}
        </button>
        <button
          className="btn btn-danger"
          disabled={busy}
          onClick={() => {
            if (confirm(`Delete watch "${w.label ?? routeSummary(w)}"?`))
              void onAct(w.id, () => window.api.watches.remove(w.id));
          }}
        >
          Delete
        </button>
      </div>
    </li>
  );
}
