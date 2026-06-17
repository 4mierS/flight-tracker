import { useCallback, useEffect, useState } from "react";
import type { WatchDTO } from "../desktop/shared";
import { WatchList } from "./components/WatchList";
import { WatchEditor } from "./components/WatchEditor";
import { SettingsPanel } from "./components/SettingsPanel";
import { WorkerControl } from "./components/WorkerControl";

type View =
  | { name: "list" }
  | { name: "create" }
  | { name: "edit"; watch: WatchDTO }
  | { name: "settings" };

export function App() {
  const [view, setView] = useState<View>({ name: "list" });
  const [watches, setWatches] = useState<WatchDTO[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    const res = await window.api.watches.list();
    if (res.ok) {
      setWatches(res.data);
      setError(null);
    } else {
      setError(res.error);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const goList = useCallback(() => {
    setView({ name: "list" });
    void refresh();
  }, [refresh]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">✈</span>
          <span>Flight Tracker</span>
        </div>
        <nav className="nav">
          <button
            className={view.name === "list" ? "nav-link active" : "nav-link"}
            onClick={goList}
          >
            Watches
          </button>
          <button
            className={view.name === "settings" ? "nav-link active" : "nav-link"}
            onClick={() => setView({ name: "settings" })}
          >
            Settings
          </button>
        </nav>
      </header>

      <main className="content">
        {error && (
          <div className="banner banner-error">
            Can’t reach the database — {error}
            <button className="btn btn-ghost" onClick={() => void refresh()}>
              Retry
            </button>
          </div>
        )}

        {view.name === "list" && (
          <>
            <WorkerControl onRunFinished={() => void refresh()} />
            <WatchList
              watches={watches}
              onCreate={() => setView({ name: "create" })}
              onEdit={(w) => setView({ name: "edit", watch: w })}
              onChanged={refresh}
            />
          </>
        )}

        {view.name === "create" && (
          <WatchEditor mode="create" onDone={goList} onCancel={goList} />
        )}

        {view.name === "edit" && (
          <WatchEditor
            mode="edit"
            watch={view.watch}
            onDone={goList}
            onCancel={goList}
          />
        )}

        {view.name === "settings" && <SettingsPanel onClose={goList} />}
      </main>
    </div>
  );
}
