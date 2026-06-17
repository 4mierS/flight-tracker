import { useCallback, useEffect, useState } from "react";
import type { WatchDTO, WatchRunStatus } from "../../desktop/shared";
import { WatchCard } from "./WatchCard";

interface Props {
  watches: WatchDTO[] | null;
  onCreate: () => void;
  onEdit: (w: WatchDTO) => void;
  onChanged: () => Promise<void>;
}

export function WatchList({ watches, onCreate, onEdit, onChanged }: Props) {
  const [busyId, setBusyId] = useState<string | null>(null);
  const [runStatuses, setRunStatuses] = useState<Map<string, WatchRunStatus>>(new Map());

  // Track per-watch search status: seed once, then live-update via push events.
  useEffect(() => {
    void window.api.worker.watchStatuses().then((res) => {
      if (res.ok) setRunStatuses(new Map(res.data.map((s) => [s.watchId, s])));
    });
    return window.api.worker.onWatchStatusChanged((s) => {
      setRunStatuses((prev) => {
        const next = new Map(prev);
        next.set(s.watchId, s);
        return next;
      });
      // A finished search may have produced a new best price → refresh the list.
      if (s.state === "idle") void onChanged();
    });
  }, [onChanged]);

  const act = useCallback(
    async (id: string, fn: () => Promise<{ ok: boolean; error?: string }>) => {
      setBusyId(id);
      const res = await fn();
      setBusyId(null);
      if (!res.ok) alert(res.error ?? "Action failed");
      await onChanged();
    },
    [onChanged],
  );

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
          {watches.map((w) => (
            <WatchCard
              key={w.id}
              watch={w}
              runStatus={runStatuses.get(w.id)}
              busy={busyId === w.id}
              onEdit={onEdit}
              onAct={act}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
