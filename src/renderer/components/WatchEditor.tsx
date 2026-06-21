import { useEffect, useMemo, useState } from "react";
import type { WatchDTO } from "../../desktop/shared";
import { watchInputSchema } from "../../lib/validation/watch";
import {
  emptyForm,
  formFromDTO,
  formToInput,
  shiftReturnWindow,
  updateStayDays,
  type WatchFormState,
} from "../lib/form";

type Props =
  | { mode: "create"; onDone: () => void; onCancel: () => void }
  | { mode: "edit"; watch: WatchDTO; onDone: () => void; onCancel: () => void };

export function WatchEditor(props: Props) {
  const initial = useMemo<WatchFormState>(
    () => (props.mode === "edit" ? formFromDTO(props.watch) : emptyForm()),
    [props],
  );
  const [form, setForm] = useState<WatchFormState>(initial);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const isReturn = form.tripType === "RETURN";

  // Ensure return dates are calculated correctly for stay-based mode
  useEffect(() => {
    if (isReturn && form.returnMode === "stay-based") {
      setForm((f) => updateStayDays(f, f.minStayDays, f.maxStayDays));
    }
  }, [form.departFrom, form.departTo, isReturn, form.returnMode]);

  function set<K extends keyof WatchFormState>(key: K, value: WatchFormState[K]) {
    if (key === "returnMode" && form.tripType === "RETURN") {
      // When switching to stay-based mode, recalculate return dates
      setForm((f) => {
        if (value === "stay-based") {
          return updateStayDays(f, f.minStayDays, f.maxStayDays);
        }
        return { ...f, [key]: value };
      });
    } else {
      setForm((f) => ({ ...f, [key]: value }));
    }
  }

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setServerError(null);

    const input = formToInput(form);
    const parsed = watchInputSchema.safeParse(input);
    if (!parsed.success) {
      const errs: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const k = String(issue.path[0] ?? "form");
        if (!errs[k]) errs[k] = issue.message;
      }
      setFieldErrors(errs);
      return;
    }
    setFieldErrors({});

    setSaving(true);
    const res =
      props.mode === "edit"
        ? await window.api.watches.update(props.watch.id, input)
        : await window.api.watches.create(input);
    setSaving(false);

    if (res.ok) props.onDone();
    else setServerError(res.error);
  }

  const err = (k: string) =>
    fieldErrors[k] ? <span className="field-error">{fieldErrors[k]}</span> : null;

  return (
    <section className="editor">
      <div className="section-head">
        <h1>{props.mode === "edit" ? "Edit watch" : "New watch"}</h1>
      </div>

      {serverError && <div className="banner banner-error">{serverError}</div>}

      <form onSubmit={onSubmit} className="form">
        <label className="field">
          <span>Label</span>
          <input
            value={form.label}
            placeholder="e.g. Germany→Jordan (direct)"
            onChange={(e) => set("label", e.target.value)}
          />
          {err("label")}
        </label>

        <div className="field-row">
          <label className="field">
            <span>Origins (IATA)</span>
            <input
              value={form.origins}
              placeholder="FRA, MUC, BER"
              onChange={(e) => set("origins", e.target.value)}
            />
            {err("origins")}
          </label>
          <label className="field">
            <span>Destinations (IATA)</span>
            <input
              value={form.destinations}
              placeholder="AMM"
              onChange={(e) => set("destinations", e.target.value)}
            />
            {err("destinations")}
          </label>
        </div>

        <div className="field-row">
          <label className="field">
            <span>Trip type</span>
            <select
              value={form.tripType}
              onChange={(e) =>
                set("tripType", e.target.value as WatchFormState["tripType"])
              }
            >
              <option value="RETURN">Round-trip</option>
              <option value="ONE_WAY">One-way</option>
            </select>
          </label>
          <label className="field">
            <span>Currency</span>
            <input
              value={form.currency}
              onChange={(e) => set("currency", e.target.value)}
            />
            {err("currency")}
          </label>
        </div>

        <fieldset className="group">
          <legend>Outbound window</legend>
          <div className="field-row">
            <label className="field">
              <span>From</span>
              <input
                type="date"
                value={form.departFrom}
                onChange={(e) =>
                  setForm((f) => shiftReturnWindow(f, e.target.value))
                }
              />
              {err("departFrom")}
            </label>
            <label className="field">
              <span>To</span>
              <input
                type="date"
                value={form.departTo}
                onChange={(e) => set("departTo", e.target.value)}
              />
              {err("departTo")}
            </label>
          </div>
        </fieldset>

        {isReturn && (
          <fieldset className="group">
            <legend>Return settings</legend>
            <div className="field-row checks">
              <label className="check">
                <input
                  type="radio"
                  name="returnMode"
                  value="stay-based"
                  checked={form.returnMode === "stay-based"}
                  onChange={() => set("returnMode", "stay-based")}
                />
                <span>Calculate from stay duration</span>
              </label>
              <label className="check">
                <input
                  type="radio"
                  name="returnMode"
                  value="date-based"
                  checked={form.returnMode === "date-based"}
                  onChange={() => set("returnMode", "date-based")}
                />
                <span>Enter return dates manually</span>
              </label>
            </div>

            {form.returnMode === "stay-based" ? (
              <div className="field-row">
                <label className="field">
                  <span>Min stay (days)</span>
                  <input
                    type="number"
                    min={0}
                    value={form.minStayDays}
                    onChange={(e) =>
                      setForm((f) =>
                        updateStayDays(f, e.target.value, f.maxStayDays),
                      )
                    }
                  />
                  {err("minStayDays")}
                </label>
                <label className="field">
                  <span>Max stay (days)</span>
                  <input
                    type="number"
                    min={0}
                    placeholder="optional"
                    value={form.maxStayDays}
                    onChange={(e) =>
                      setForm((f) =>
                        updateStayDays(f, f.minStayDays, e.target.value),
                      )
                    }
                  />
                  {err("maxStayDays")}
                </label>
                <div className="field" style={{ opacity: 0.6, pointerEvents: "none" }}>
                  <span>Return: {form.returnFrom} to {form.returnTo}</span>
                </div>
              </div>
            ) : (
              <div className="field-row">
                <label className="field">
                  <span>Return from</span>
                  <input
                    type="date"
                    value={form.returnFrom}
                    onChange={(e) => set("returnFrom", e.target.value)}
                  />
                  {err("returnFrom")}
                </label>
                <label className="field">
                  <span>Return to</span>
                  <input
                    type="date"
                    value={form.returnTo}
                    onChange={(e) => set("returnTo", e.target.value)}
                  />
                  {err("returnTo")}
                </label>
              </div>
            )}
          </fieldset>
        )}

        <div className="field-row">
          <label className="field">
            <span>Max stops</span>
            <input
              type="number"
              min={0}
              max={3}
              value={form.maxStops}
              onChange={(e) => set("maxStops", e.target.value)}
            />
            {err("maxStops")}
          </label>
          <label className="field">
            <span>Passengers</span>
            <input
              type="number"
              min={1}
              max={9}
              value={form.passengers}
              onChange={(e) => set("passengers", e.target.value)}
            />
            {err("passengers")}
          </label>
          <label className="field">
            <span>Threshold ({form.currency || "—"})</span>
            <input
              type="number"
              min={1}
              placeholder="alert at/below"
              value={form.threshold}
              onChange={(e) => set("threshold", e.target.value)}
            />
            {err("threshold")}
          </label>
        </div>

        <div className="field-row checks">
          <label className="check">
            <input
              type="checkbox"
              checked={form.directOnly}
              onChange={(e) => set("directOnly", e.target.checked)}
            />
            <span>Direct flights only</span>
          </label>
          <label className="check">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => set("active", e.target.checked)}
            />
            <span>Active</span>
          </label>
        </div>

        <div className="form-actions">
          <button type="button" className="btn btn-ghost" onClick={props.onCancel}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving}>
            {saving ? "Saving…" : props.mode === "edit" ? "Save changes" : "Create watch"}
          </button>
        </div>
      </form>
    </section>
  );
}
