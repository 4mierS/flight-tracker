import { useEffect, useState } from "react";
import { settingsInputSchema } from "../../lib/validation/watch";

interface Props {
  onClose: () => void;
}

// A small curated list; the schema accepts any valid IANA zone.
const COMMON_ZONES = [
  "Europe/Berlin",
  "Europe/London",
  "Europe/Amman",
  "UTC",
  "America/New_York",
  "Asia/Bangkok",
];

export function SettingsPanel({ onClose }: Props) {
  const [cap, setCap] = useState("");
  const [retentionDays, setRetentionDays] = useState("");
  const [maxSnapshots, setMaxSnapshots] = useState("");
  const [timezone, setTimezone] = useState("Europe/Berlin");
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    void (async () => {
      const res = await window.api.settings.get();
      if (res.ok) {
        setCap(res.data.dailyMessageCap?.toString() ?? "");
        setRetentionDays(res.data.retentionDays?.toString() ?? "");
        setMaxSnapshots(res.data.maxSnapshotsPerWatch?.toString() ?? "");
        setTimezone(res.data.timezone);
      } else {
        setError(res.error);
      }
      setLoaded(true);
    })();
  }, []);

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSaved(false);

    const capValue = cap.trim() === "" ? null : Number(cap);
    const retentionValue = retentionDays.trim() === "" ? null : Number(retentionDays);
    const maxSnapshotsValue = maxSnapshots.trim() === "" ? null : Number(maxSnapshots);
    const parsed = settingsInputSchema.safeParse({
      dailyMessageCap: capValue,
      retentionDays: retentionValue,
      maxSnapshotsPerWatch: maxSnapshotsValue,
      timezone,
    });
    if (!parsed.success) {
      setError(parsed.error.issues.map((i) => i.message).join("; "));
      return;
    }

    setSaving(true);
    const res = await window.api.settings.update(parsed.data);
    setSaving(false);
    if (res.ok) setSaved(true);
    else setError(res.error);
  }

  if (!loaded) return <div className="empty">Loading settings…</div>;

  return (
    <section className="settings">
      <div className="section-head">
        <h1>Settings</h1>
      </div>

      {error && <div className="banner banner-error">{error}</div>}
      {saved && <div className="banner banner-ok">Saved.</div>}

      <form onSubmit={onSubmit} className="form form-narrow">
        <label className="field">
          <span>Daily message cap</span>
          <input
            type="number"
            min={1}
            placeholder="blank = unlimited"
            value={cap}
            onChange={(e) => {
              setCap(e.target.value);
              setSaved(false);
            }}
          />
          <small className="muted">
            Max Telegram alerts per day across all watches. Once reached, further
            deals are skipped until the next day (they can alert tomorrow). Leave
            blank for unlimited.
          </small>
        </label>

        <label className="field">
          <span>Keep history for (days)</span>
          <input
            type="number"
            min={1}
            placeholder="blank = keep forever"
            value={retentionDays}
            onChange={(e) => {
              setRetentionDays(e.target.value);
              setSaved(false);
            }}
          />
          <small className="muted">
            Price snapshots older than this are deleted on each worker run.
            Leave blank to keep all history.
          </small>
        </label>

        <label className="field">
          <span>Max snapshots per watch</span>
          <input
            type="number"
            min={1}
            placeholder="blank = unlimited"
            value={maxSnapshots}
            onChange={(e) => {
              setMaxSnapshots(e.target.value);
              setSaved(false);
            }}
          />
          <small className="muted">
            Keeps only the newest N price snapshots for each watch; older ones
            are pruned. Leave blank for unlimited.
          </small>
        </label>

        <label className="field">
          <span>Day resets at midnight in</span>
          <input
            list="tz-list"
            value={timezone}
            onChange={(e) => {
              setTimezone(e.target.value);
              setSaved(false);
            }}
          />
          <datalist id="tz-list">
            {COMMON_ZONES.map((z) => (
              <option key={z} value={z} />
            ))}
          </datalist>
        </label>

        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Back
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : "Save settings"}
          </button>
        </div>
      </form>
    </section>
  );
}
