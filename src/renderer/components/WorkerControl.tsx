import { useCallback, useEffect, useRef, useState } from "react";
import type { WorkerStatus } from "../../desktop/shared";

interface Props {
  /** Called when a run finishes so the watch list can refresh (new best prices). */
  onRunFinished: () => void;
}

const STATE_LABEL: Record<WorkerStatus["state"], string> = {
  idle: "Idle",
  "running-once": "Running once…",
  looping: "Looping",
};

const STATE_BADGE: Record<WorkerStatus["state"], string> = {
  idle: "badge badge-muted",
  "running-once": "badge badge-info",
  looping: "badge badge-ok",
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleString();
}

export function WorkerControl({ onRunFinished }: Props) {
  const [status, setStatus] = useState<WorkerStatus | null>(null);
  const [pending, setPending] = useState(false);
  const prevState = useRef<WorkerStatus["state"] | null>(null);

  useEffect(() => {
    void window.api.worker.status().then((res) => {
      if (res.ok) setStatus(res.data);
    });
    const unsubscribe = window.api.worker.onStatusChanged((s) => {
      // A transition back to idle means a run just finished → refresh the list.
      if (prevState.current && prevState.current !== "idle" && s.state === "idle") {
        onRunFinished();
      }
      prevState.current = s.state;
      setStatus(s);
    });
    return unsubscribe;
  }, [onRunFinished]);

  const act = useCallback(
    async (fn: () => Promise<{ ok: boolean; error?: string; data?: WorkerStatus }>) => {
      setPending(true);
      const res = await fn();
      setPending(false);
      if (!res.ok) {
        alert(res.error ?? "Worker action failed");
      } else if (res.data) {
        setStatus(res.data);
        prevState.current = res.data.state;
      }
    },
    [],
  );

  const state = status?.state ?? "idle";
  const busy = state !== "idle";
  const lastRun = status?.lastRun ?? null;

  return (
    <section className="worker-card">
      <div className="worker-head">
        <div className="worker-title">
          <span className={STATE_BADGE[state]}>{STATE_LABEL[state]}</span>
          <h2>Worker</h2>
        </div>
        <div className="worker-actions">
          <button
            className="btn btn-primary"
            disabled={pending || busy}
            onClick={() => void act(() => window.api.worker.runOnce())}
          >
            Run now
          </button>
          {state === "looping" ? (
            <button
              className="btn btn-danger"
              disabled={pending}
              onClick={() => void act(() => window.api.worker.stop())}
            >
              Stop loop
            </button>
          ) : (
            <button
              className="btn btn-ghost"
              disabled={pending || busy}
              onClick={() => void act(() => window.api.worker.start())}
            >
              Start loop
            </button>
          )}
        </div>
      </div>

      {lastRun ? (
        <p className="worker-lastrun">
          Last {lastRun.mode === "once" ? "run" : "loop"}:{" "}
          {lastRun.finishedAt ? (
            lastRun.ok ? (
              <span className="worker-ok">✓ finished {formatTime(lastRun.finishedAt)}</span>
            ) : (
              <span className="worker-err">
                ✗ failed (exit {lastRun.exitCode ?? "?"})
                {lastRun.errorTail ? ` — ${lastRun.errorTail.trim().slice(-200)}` : ""}
              </span>
            )
          ) : (
            <span className="muted">started {formatTime(lastRun.startedAt)}…</span>
          )}
        </p>
      ) : (
        <p className="worker-lastrun muted">No runs yet this session.</p>
      )}
    </section>
  );
}
