"use client";

import { useState } from "react";
import { Tag, Check, Pencil, X } from "lucide-react";
import { Button } from "@/components/ui";

const TAG_PRESETS = ["VIP", "Repeat seller", "Slow to ship", "Flag for review", "Trusted"];

/**
 * Internal notes + tags for a contact.
 *
 * READ-ONLY UNTIL ASKED. Notes are reference material - staff read them far
 * more often than they change them, and a permanently open textarea took most
 * of the panel while looking like a form that wanted filling in. The pencil
 * turns it into one; the rest of the time it is simply what we know about this
 * person.
 *
 * Renders no Card of its own, so it can sit inside the one holding the identity
 * it belongs to. Callers wanting it standalone wrap it themselves.
 *
 * Tags still save the moment they are added or removed - each is a single
 * discrete choice, and one that needs a second click to stick gets left half
 * applied. The note saves on demand, because a half-typed sentence is not a
 * fact yet.
 *
 * `onSave({ notes, tags })` persists both.
 */
export function ContactNotesEditor({ notes: initialNotes, tags, onSave }) {
  const [editing, setEditing] = useState(false);
  const [notes, setNotes] = useState(initialNotes || "");
  const [tagInput, setTagInput] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");

  const dirty = notes !== (initialNotes || "");
  const isEmpty = !(initialNotes || "").trim() && tags.length === 0;

  /**
   * `onSave` may resolve to `{ error }`. This used to fire and forget, so a
   * refused save still showed the green tick and the note was simply gone.
   */
  async function persist(next) {
    setError("");
    const result = await Promise.resolve(onSave(next)).catch((err) => ({
      error: err?.message || "Could not save that.",
    }));
    if (result?.error) {
      setError(result.error);
      return false;
    }
    return true;
  }

  async function addTag(t) {
    const clean = t.trim();
    if (!clean || tags.includes(clean)) return;
    setTagInput("");
    await persist({ notes, tags: [...tags, clean] });
  }

  async function removeTag(t) {
    await persist({ notes, tags: tags.filter((x) => x !== t) });
  }

  async function saveNotes() {
    if (!(await persist({ notes, tags }))) return; // stay open so the text survives
    setEditing(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 1500);
  }

  /** Discard the edit. The typed note goes; tags already saved do not. */
  function cancel() {
    setNotes(initialNotes || "");
    setTagInput("");
    setEditing(false);
  }

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.08em] text-muted">
          <Tag size={12} /> Notes &amp; Tags
        </h3>
        {!editing && (
          <button
            onClick={() => setEditing(true)}
            aria-label="Edit notes and tags"
            className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg text-muted transition-colors hover:bg-accent-l hover:text-accent"
          >
            {saved ? <Check size={14} className="text-accent" /> : <Pencil size={13} />}
          </button>
        )}
      </div>

      {error && <p className="mb-2 text-[12px] text-red-500">{error}</p>}

      {tags.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {tags.map((t) => (
            <span
              key={t}
              className="inline-flex items-center gap-1 rounded-pill bg-accent-l py-1 pl-2.5 pr-1.5 text-[11px] font-bold text-accent"
            >
              {t}
              {editing && (
                <button
                  onClick={() => removeTag(t)}
                  aria-label={`Remove ${t}`}
                  className="opacity-60 hover:opacity-100"
                >
                  <X size={11} />
                </button>
              )}
            </span>
          ))}
        </div>
      )}

      {editing ? (
        <>
          <div className="mb-2.5 rounded-lg bg-bg p-2.5">
            <div className="flex gap-2">
              <input
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag(tagInput);
                  }
                }}
                placeholder="Add a tag…"
                className="min-w-0 flex-1 rounded-lg border-[1.5px] border-line bg-white px-2.5 py-2 text-[13px] outline-none focus:border-accent"
              />
              <Button
                variant="ghost"
                size="sm"
                onClick={() => addTag(tagInput)}
                disabled={!tagInput.trim()}
              >
                Add
              </Button>
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {TAG_PRESETS.filter((t) => !tags.includes(t)).map((t) => (
                <button
                  key={t}
                  onClick={() => addTag(t)}
                  className="rounded-pill border border-dashed border-line px-2.5 py-1 text-[11px] font-semibold text-muted hover:border-accent hover:text-accent"
                >
                  + {t}
                </button>
              ))}
            </div>
          </div>

          <textarea
            autoFocus
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            rows={4}
            placeholder="Internal notes — payment preferences, past issues, anything worth remembering…"
            className="w-full resize-y rounded-lg border-[1.5px] border-line bg-white p-2.5 text-[13px] outline-none focus:border-accent"
          />
          <div className="mt-2.5 flex justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={cancel}>
              Cancel
            </Button>
            <Button size="sm" disabled={!dirty} onClick={saveNotes}>
              Save
            </Button>
          </div>
        </>
      ) : (
        // pre-wrap so a note typed as a list stays one.
        <p
          className={
            isEmpty
              ? "text-[12.5px] italic text-muted"
              : "whitespace-pre-wrap break-words text-[13px] leading-relaxed text-ink"
          }
        >
          {isEmpty ? "Nothing noted yet." : initialNotes}
        </p>
      )}
    </div>
  );
}
