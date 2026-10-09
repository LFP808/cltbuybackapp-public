"use client";

import { useEffect, useState } from "react";
import { Trash2, StickyNote } from "lucide-react";
import { Card } from "@/components/ui";
import { ITEM_CATALOG, categoriesOf } from "@/domain/catalog";
import { DEFAULT_GRADES, CARRIERS } from "@/domain/inventory";
import { itemsTotal, uid, currency } from "@/domain/format";
import { runAction } from "@/lib/run-action";
import { addGradeAction } from "@/app/employee/settings/actions";

// The select's sentinel for "open the add-a-condition input". Not a value a
// grade could be: the save action trims and a leading "+" is never offered.
const ADD_CONDITION = "__add_condition__";

/**
 * The line-items card: pick from the catalog, say what condition it's in,
 * price and count each row.
 *
 * Owns no state - `items` live in the form, because submit needs them and
 * "what this order is worth" is the form's business. The seam is exactly
 * (items, setItems), which is what made this card extractable while the
 * customer block above it is not.
 *
 * `catalog` is the DB-backed item list, handed down from the page; the static
 * seed is only the fallback for a render that didn't get one, so an item
 * added on the Item Catalog page shows up here without a deploy.
 *
 * `grades` is the condition ladder (the `grades` setting) the Condition
 * picker offers. One ladder for booking AND check-in on purpose: what the
 * customer says on the phone seeds the grade the device gets on the bench,
 * and the label prints whichever won. `requireCondition` marks the picker as
 * mandatory (a meetup; see domain/validation.js) — the form still submits,
 * and validation names the line that's missing one.
 */
export function ItemsEditor({
  items,
  setItems,
  catalog,
  grades = DEFAULT_GRADES,
  requireCondition = false,
  error = null,
}) {
  const catalogItems = catalog?.length ? catalog : ITEM_CATALOG;
  const categories = categoriesOf(catalogItems);
  // null = affordance collapsed; a string = the custom name being typed.
  const [customName, setCustomName] = useState(null);
  // The ladder as this card knows it: starts from the setting and grows when
  // somebody adds a condition here, so the new word is offered on the next
  // row without a reload. Re-seeded if the page hands down a new list.
  const [conditions, setConditions] = useState(grades);
  useEffect(() => setConditions(grades), [grades]);
  // Which row has the "add a condition" input open, and what's typed in it.
  const [addingFor, setAddingFor] = useState(null);
  const [newCondition, setNewCondition] = useState("");
  const [addBusy, setAddBusy] = useState(false);
  const [addError, setAddError] = useState("");

  /**
   * Add a catalog item with NO price. What we pay varies per customer and per
   * the real condition of the device, so the catalog is deliberately not used
   * as a price anchor — the employee types the agreed number.
   *
   * Price and quantity are held as raw strings while editing so the fields can
   * be cleared; they are coerced to numbers on submit. No condition either:
   * the picker starts blank so a row can't carry a condition nobody chose.
   */
  function addCatalogItem(name) {
    if (!name) return;
    setItems((prev) => [
      ...prev,
      { id: uid(), name, quantity: "1", price: "", condition: "", carrier: "" },
    ]);
  }

  const updateItem = (id, patch) =>
    setItems((prev) => prev.map((it) => (it.id === id ? { ...it, ...patch } : it)));
  const removeItem = (id) => setItems((prev) => prev.filter((it) => it.id !== id));

  /**
   * A one-off item that is NOT in the catalog — the console or GPU someone
   * brings along with their phones. It rides the same items jsonb as a
   * catalog pick (name, qty, price) and deliberately writes nothing back to
   * the catalog: the catalog is the curated list of what we buy on purpose,
   * not a log of everything that ever crossed the counter.
   */
  function addCustomItem() {
    const name = (customName || "").trim();
    if (!name) return;
    setItems((prev) => [
      ...prev,
      { id: uid(), name, quantity: "1", price: "", condition: "", carrier: "" },
    ]);
    setCustomName(null);
  }

  function pickCondition(id, value) {
    if (value === ADD_CONDITION) {
      setAddingFor(id);
      setNewCondition("");
      setAddError("");
      return;
    }
    updateItem(id, { condition: value });
  }

  /**
   * Add a word to the ladder and pick it for this row. The action appends
   * to the shared setting (additive only — pruning is the admin's, on
   * /settings) and hands back the whole list, so what this card offers next
   * is exactly what was saved, including the existing spelling when the word
   * was already there.
   */
  async function saveCondition() {
    const name = newCondition.trim();
    if (!name || addBusy) return;
    setAddBusy(true);
    setAddError("");
    const { ok, error: err, result } = await runAction(() => addGradeAction(name));
    setAddBusy(false);
    if (!ok) {
      setAddError(err);
      return;
    }
    setConditions(result.grades);
    updateItem(addingFor, { condition: result.name });
    setAddingFor(null);
    setNewCondition("");
  }

  const unpricedCount = items.filter((it) => !(Number(it.price) > 0)).length;

  return (
    <Card className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold text-ink">What are they bringing?</h3>
        <span className="text-[13px] font-bold tabular-nums text-accent">
          {currency(itemsTotal(items))}
        </span>
      </div>

      {/* Grouped optgroups keep the ~150-model catalog navigable: the native
          select gives type-ahead and a scrollable menu for free, and the
          categories cut each list to a screenful. */}
      <select
        className="w-full rounded-lg border border-line bg-white px-3 py-2.5 text-[14px]"
        value=""
        onChange={(e) => addCatalogItem(e.target.value)}
      >
        <option value="">+ Add item from catalog…</option>
        {categories.map((cat) => (
          <optgroup key={cat} label={cat}>
            {catalogItems
              .filter((i) => i.category === cat)
              .map((i) => (
                <option key={i.name} value={i.name}>
                  {i.name}
                </option>
              ))}
          </optgroup>
        ))}
      </select>

      {customName == null ? (
        <button
          type="button"
          onClick={() => setCustomName("")}
          className="text-[12px] font-semibold text-accent"
        >
          + Custom item…
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <input
            value={customName}
            onChange={(e) => setCustomName(e.target.value)}
            onKeyDown={(e) => {
              // Enter adds the item, not the ORDER — this input lives inside
              // the form, and submitting a half-typed order is the default.
              if (e.key === "Enter") {
                e.preventDefault();
                addCustomItem();
              }
              if (e.key === "Escape") setCustomName(null);
            }}
            placeholder="e.g. PS5 console, RTX 3080"
            aria-label="Custom item name"
            autoFocus
            className="h-9 min-w-0 flex-1 rounded-lg border border-line bg-white px-3 text-[13px] outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={addCustomItem}
            className="h-9 rounded-lg bg-accent-l px-3 text-[12.5px] font-semibold text-accent hover:bg-accent-l/70"
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => setCustomName(null)}
            aria-label="Cancel custom item"
            className="text-[12px] font-semibold text-muted hover:text-ink"
          >
            Cancel
          </button>
        </div>
      )}

      {items.map((it) => {
        // A stored condition the ladder no longer lists (renamed or removed
        // on /settings since) still has to be displayable, or the select
        // would render blank and the save would silently drop it.
        const options =
          it.condition && !conditions.includes(it.condition)
            ? [...conditions, it.condition]
            : conditions;
        const missing = requireCondition && !String(it.condition || "").trim();
        return (
          <div key={it.id} className="space-y-1">
            {/* Wraps on a phone: name on its own line, the three inputs under
                it. On a desktop it is one row. */}
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-[6rem] flex-1 truncate text-[13px]">{it.name}</span>
              {/* CONDITION, picked not typed: the ladder is shared with
                  check-in, and "good" next to "B" would be two conditions. */}
              <select
                value={it.condition || ""}
                onChange={(e) => pickCondition(it.id, e.target.value)}
                aria-label={`Condition for ${it.name}`}
                className={
                  "h-[34px] max-w-[9rem] rounded-md border bg-white px-2 text-[13px] " +
                  (missing && error ? "border-destructive" : "border-line")
                }
              >
                <option value="">{requireCondition ? "Condition *" : "Condition…"}</option>
                {options.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
                <option value={ADD_CONDITION}>+ Add a condition…</option>
              </select>
              {/* CARRIER, same fixed list check-in offers — Unlocked is its
                  own option, so picking it says "unlocked" without a second
                  checkbox. Optional: not every booking call gets this far,
                  and check-in's own lookup is the fact that sticks. */}
              <select
                value={it.carrier || ""}
                onChange={(e) => updateItem(it.id, { carrier: e.target.value })}
                aria-label={`Carrier for ${it.name}`}
                className="h-[34px] max-w-[8rem] rounded-md border border-line bg-white px-2 text-[13px]"
              >
                <option value="">Carrier…</option>
                {CARRIERS.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min="1"
                value={it.quantity}
                onChange={(e) => updateItem(it.id, { quantity: e.target.value })}
                className="w-16 rounded-md border border-line px-2 py-1.5 text-[13px]"
                aria-label="Quantity"
              />
              <input
                type="number"
                step="0.01"
                min="0"
                value={it.price}
                onChange={(e) => updateItem(it.id, { price: e.target.value })}
                placeholder="0.00"
                className="w-20 rounded-md border border-line px-2 py-1.5 text-[13px]"
                aria-label="Price"
              />
              <button type="button" onClick={() => removeItem(it.id)} aria-label="Remove">
                <Trash2 size={15} className="text-muted hover:text-red-500" />
              </button>
            </div>

            {addingFor === it.id && (
              <div className="flex flex-wrap items-center gap-1.5 pl-1">
                <input
                  value={newCondition}
                  onChange={(e) => setNewCondition(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      saveCondition();
                    }
                    if (e.key === "Escape") setAddingFor(null);
                  }}
                  placeholder="New condition, e.g. Cracked back"
                  aria-label={`New condition for ${it.name}`}
                  maxLength={40}
                  autoFocus
                  disabled={addBusy}
                  className="h-8 min-w-0 flex-1 rounded-md border border-line px-2 text-[12.5px] outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={saveCondition}
                  disabled={addBusy || !newCondition.trim()}
                  className="h-8 rounded-md bg-accent-l px-2.5 text-[12px] font-semibold text-accent disabled:opacity-50"
                >
                  {addBusy ? "Adding…" : "Add"}
                </button>
                <button
                  type="button"
                  onClick={() => setAddingFor(null)}
                  className="text-[12px] font-semibold text-muted"
                >
                  Cancel
                </button>
                {/* Said plainly: this word joins the shared ladder every
                    screen offers, not a private note on this order. */}
                <span className="basis-full text-[11px] text-muted">
                  Adds it to the condition list for everyone (Settings prunes it).
                </span>
                {addError && (
                  <span className="basis-full text-[12px] text-destructive">{addError}</span>
                )}
              </div>
            )}

            {/* OPTIONAL, and captured while the customer is still on the phone —
                "cracked screen", "still has Find My on". Written here it is
                waiting on the check-in screen later, when somebody has the
                device in hand and is deciding grade and price per row.
                Collapsed until asked for: most lines need no note, and an empty
                box on every row turns a two-line order into a wall of inputs. */}
            {it.note != null ? (
              <div className="flex items-center gap-1.5 pl-1">
                <StickyNote size={13} className="flex-shrink-0 text-status-awaiting" />
                <input
                  value={it.note}
                  onChange={(e) => updateItem(it.id, { note: e.target.value })}
                  placeholder="e.g. cracked screen, Find My still on, no charger"
                  aria-label={`Note for ${it.name}`}
                  maxLength={300}
                  autoFocus
                  className="min-w-0 flex-1 rounded-md border border-line px-2 py-1 text-[12.5px] outline-none focus:border-accent"
                />
                <button
                  type="button"
                  onClick={() => updateItem(it.id, { note: undefined })}
                  aria-label={`Remove note for ${it.name}`}
                  className="text-[11.5px] font-semibold text-muted"
                >
                  Remove
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => updateItem(it.id, { note: "" })}
                className="pl-1 text-[11.5px] font-semibold text-accent"
              >
                + note
              </button>
            )}
          </div>
        );
      })}

      {error && <p className="text-[12.5px] font-semibold text-destructive">{error}</p>}

      {unpricedCount > 0 && (
        <p className="rounded-md bg-status-awaiting-bg px-2.5 py-1.5 text-[12px] text-status-awaiting">
          {unpricedCount} item{unpricedCount === 1 ? "" : "s"} without a price will save as $0.
        </p>
      )}
    </Card>
  );
}
