"use client";

import { useState } from "react";
import { Plus, X, ChevronUp, ChevronDown } from "lucide-react";
import { Card, Button } from "@/components/ui";
import { uid } from "@/domain/format";
import { runAction } from "@/lib/run-action";
import { saveNameListAction } from "@/app/employee/settings/actions";

/**
 * One admin-editable ordered name list (grades, payment methods) — the same
 * save-in-place pattern as BookingHoursCard. Order is part of the setting:
 * the first entry is what pickers land on by default, so rows reorder with
 * arrows rather than asking anyone to delete-and-retype.
 *
 * Refusals from the action arrive naming the row they're about and land
 * verbatim in the red line; nothing is validated twice here.
 */
export function NameListCard({ title, description, helper, settingKey, names }) {
  const [rows, setRows] = useState(() => names.map((name) => ({ id: uid(), name })));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);

  const rename = (id, name) =>
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, name } : r)));

  const move = (id, dir) =>
    setRows((prev) => {
      const at = prev.findIndex((r) => r.id === id);
      const to = at + dir;
      if (to < 0 || to >= prev.length) return prev;
      const next = [...prev];
      [next[at], next[to]] = [next[to], next[at]];
      return next;
    });

  async function save() {
    setBusy(true);
    setError("");
    setSaved(false);
    const { ok, error: err } = await runAction(() =>
      saveNameListAction(
        settingKey,
        rows.map((r) => r.name),
      ),
    );
    setBusy(false);
    if (!ok) {
      setError(err);
      return;
    }
    setSaved(true);
  }

  return (
    <Card>
      <div className="text-[14px] font-bold text-ink">{title}</div>
      <p className="mt-0.5 text-[12.5px] text-muted">{description}</p>

      <div className="mt-3 space-y-1.5">
        {rows.map((row, i) => (
          <div key={row.id} className="flex items-center gap-1.5">
            <input
              value={row.name}
              onChange={(e) => rename(row.id, e.target.value)}
              aria-label={`${title} entry ${i + 1}`}
              className="h-8 w-44 rounded-lg border border-line bg-white px-2.5 text-[13px] outline-none focus:border-accent"
            />
            <button
              type="button"
              aria-label={`Move ${row.name || "this entry"} up`}
              disabled={i === 0}
              onClick={() => move(row.id, -1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-bg hover:text-ink disabled:opacity-30"
            >
              <ChevronUp size={14} />
            </button>
            <button
              type="button"
              aria-label={`Move ${row.name || "this entry"} down`}
              disabled={i === rows.length - 1}
              onClick={() => move(row.id, 1)}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-bg hover:text-ink disabled:opacity-30"
            >
              <ChevronDown size={14} />
            </button>
            <button
              type="button"
              aria-label={`Remove ${row.name || "this entry"}`}
              onClick={() => setRows((prev) => prev.filter((r) => r.id !== row.id))}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-muted hover:bg-bg hover:text-ink"
            >
              <X size={14} />
            </button>
          </div>
        ))}
      </div>

      <Button
        type="button"
        variant="ghost"
        className="mt-2"
        onClick={() => setRows((prev) => [...prev, { id: uid(), name: "" }])}
      >
        <Plus size={14} /> Add one
      </Button>

      {helper && <p className="mt-2 text-[12px] text-muted">{helper}</p>}

      <div className="mt-3 flex items-center gap-3">
        <Button onClick={save} disabled={busy}>
          {busy ? "Saving…" : "Save list"}
        </Button>
        {saved && (
          <span className="text-[12px] font-semibold text-accent">
            Saved - pickers offer it immediately.
          </span>
        )}
      </div>
      {error && <p className="mt-2 text-[12px] font-semibold text-red-500">{error}</p>}
    </Card>
  );
}
