"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Pencil, Check, X } from "lucide-react";
import { saveContactNameAction } from "@/app/employee/messages/actions";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/cn";

/**
 * A contact's name, correctable in place.
 *
 * The name normally comes from whatever was typed on their most recent order,
 * which is right until someone mistypes it or a customer says "it's Kate, not
 * Katherine". Saving here writes an override on the contact — the orders keep
 * the names they were taken under, because an order records what was agreed
 * rather than what we later learned to call someone.
 *
 * Shared by the customer page and the inbox profile, so a correction made in
 * one is the name shown in the other.
 *
 * @param {{phone:string, name:string, className?:string, as?:'h1'|'h2'}} props
 */
export function EditableName({ phone, name, className, as: Tag = "h1" }) {
  const router = useRouter();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(name || "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function save() {
    const clean = value.trim();
    if (clean === (name || "").trim()) return setEditing(false);
    setBusy(true);
    setError("");
    const { ok, error } = await runAction(
      () => saveContactNameAction(phone, clean),
      "Could not save that name.",
    );
    setBusy(false);

    // Stay in edit mode on a refusal, or the old name reappears with no reason.
    if (!ok) {
      setError(error);
      return;
    }
    setEditing(false);
    router.refresh();
  }

  function cancel() {
    setValue(name || "");
    setError("");
    setEditing(false);
  }

  if (!editing) {
    return (
      <div className="group flex min-w-0 items-center gap-1.5">
        <Tag className={cn("min-w-0 break-words", className)}>{name}</Tag>
        <button
          onClick={() => {
            setValue(name || "");
            setEditing(true);
          }}
          aria-label="Edit name"
          // Always present on touch, where there is no hover to reveal it.
          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-md text-muted opacity-100 transition-colors hover:bg-accent-l hover:text-accent lg:opacity-0 lg:group-hover:opacity-100 lg:focus-visible:opacity-100"
        >
          <Pencil size={12} />
        </button>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      <div className="flex min-w-0 items-center gap-1.5">
        <input
          autoFocus
          value={value}
          disabled={busy}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") save();
            if (e.key === "Escape") cancel();
          }}
          maxLength={80}
          aria-label="Customer name"
          className="min-w-0 flex-1 rounded-lg border-[1.5px] border-line bg-white px-2 py-1 text-[15px] font-semibold text-ink outline-none focus:border-accent"
        />
        <button
          onClick={save}
          disabled={busy}
          aria-label="Save name"
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-accent text-white hover:bg-accent-dark"
        >
          <Check size={14} />
        </button>
        <button
          onClick={cancel}
          disabled={busy}
          aria-label="Cancel"
          className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md text-muted hover:bg-bg hover:text-ink"
        >
          <X size={14} />
        </button>
      </div>
      {/* Clearing the box is a real choice, so it says what will happen. */}
      <p className="mt-1 text-[11px] text-muted">
        {value.trim()
          ? "Enter to save, Esc to cancel."
          : "Leave empty to use the name on their latest order."}
      </p>
      {error && <p className="mt-1 text-[11.5px] text-red-500">{error}</p>}
    </div>
  );
}
