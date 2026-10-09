"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Plus, CalendarClock, Store } from "lucide-react";
import { Button, Input, Card } from "@/components/ui";
import { ItemsEditor } from "@/components/employee/new-order/ItemsEditor";
import { MeetupSchedule, pickupSummary } from "@/components/employee/new-order/MeetupSchedule";
import { WalkInPayout } from "@/components/employee/new-order/WalkInPayout";
import { KnownCustomerNotice } from "@/components/employee/new-order/KnownCustomerNotice";
import { itemsTotal, currency } from "@/domain/format";
import { LEAD_SOURCES, PAYMENT_METHODS } from "@/domain/constants";
import { DEFAULT_GRADES } from "@/domain/inventory";
import { validateNewOrder, firstError } from "@/domain/validation";
import { createOrderAction } from "@/app/employee/actions";

/** Book a meetup or record a walk-in, with catalog-backed line items. */
export function NewOrderForm({
  prefill,
  // One-line version of our meetup address, composed server-side —
  // officeAddressLine() reads the /settings value (and server-only env).
  officeLine = "",
  catalog = [],
  // Every upcoming booking, slimmed (see listAppointments) — the slot
  // picker's view of the day, so a VA sees a clash before promising it.
  appointments = [],
  // The admin-set booking schedule (per-weekday hours + date overrides,
  // normalized); see /settings.
  bookingSchedule,
  // The admin-set payout methods for the walk-in payout; falls back to the
  // domain constant when the page didn't fetch them.
  paymentMethods = PAYMENT_METHODS,
  // The condition ladder (the `grades` setting) the per-item Condition picker
  // offers; required on every booked line. Same fallback rule as above.
  grades = DEFAULT_GRADES,
}) {
  const router = useRouter();
  /**
   * A walk-in is a MEETUP THAT SKIPPED THE APPOINTMENT, so it is a flag on
   * the one stored type ("office") rather than a second type. The pill below
   * is the only place the two diverge for the person typing: are they
   * coming, or are they here?
   */
  const [walkIn, setWalkIn] = useState(false);
  // Cash by context (a walk-in pays at the counter) — but only if the admin
  // kept Cash on the list; a default the select can't display submits a
  // method nobody picked.
  const [payout, setPayout] = useState(() => ({
    amount: "",
    method: paymentMethods.includes("Cash") ? "Cash" : paymentMethods[0] || "Cash",
  }));
  // False while the amount is still just the line-item total. See WalkInPayout.
  const [payoutTouched, setPayoutTouched] = useState(false);
  const [form, setForm] = useState({ name: "", phone: "", ...prefill });
  // "How did they hear about us?" — a fact about the PERSON, not the order,
  // so it rides the payload to the server and lands on contact_notes there.
  const [leadSource, setLeadSource] = useState("");
  const [items, setItems] = useState([]);
  const [pickup, setPickup] = useState({ pickupDate: "", pickupTime: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [fieldErrors, setFieldErrors] = useState({});
  // What we already know about this phone number, fetched on blur.
  const [known, setKnown] = useState(null);
  // >0 when the server refused because this number already has open orders.
  const [duplicateCount, setDuplicateCount] = useState(0);
  // Set when the server refused because the 15-minute slot is already booked.
  // Mirrors the duplicate flow: a stop with a way through, not a wall.
  const [slotTaken, setSlotTaken] = useState(false);

  // Clearing the error as soon as someone edits the field keeps the form from
  // nagging about something they're in the middle of fixing.
  const set = (k) => (e) => {
    const { value } = e.target;
    setForm((f) => ({ ...f, [k]: value }));
    setFieldErrors((prev) => (prev[k] ? { ...prev, [k]: undefined } : prev));
  };

  /**
   * Look the number up as soon as it's complete. An open order on the same
   * phone is the signal that matters — that's a duplicate about to happen.
   * The lookup also fills a blank name: a guess is not a fact, so a name
   * already typed is left alone.
   */
  async function checkCustomer(phone) {
    const digits = String(phone || "")
      .replace(/\D/g, "")
      .slice(-10);
    if (digits.length !== 10) {
      setKnown(null);
      return;
    }
    try {
      const res = await fetch(`/api/customer-check/${digits}`);
      if (!res.ok) return setKnown(null);
      const data = await res.json();
      if (!data.known) {
        setKnown(null);
        return;
      }
      setKnown(data);
      if (data.name) {
        setForm((f) => (f.name.trim() ? f : { ...f, name: data.name }));
      }
    } catch {
      /* non-fatal: the lookup is an aid, not a gate */
    }
  }

  async function onSubmit(e, { confirmDuplicate = false, confirmDoubleBook = false } = {}) {
    e?.preventDefault?.();
    setError("");
    if (!confirmDuplicate) setDuplicateCount(0);
    if (!confirmDoubleBook) setSlotTaken(false);

    // Built once and reused for the create call below, so the rules the form
    // checks and the rules the server checks run against the same object — it
    // used to assemble the payload twice, which is two places for them to
    // drift. Line items are edited as strings; the stored order holds numbers.
    const priced = items.map((it) => ({
      ...it,
      quantity: Number(it.quantity) || 1,
      price: Number(it.price) || 0,
    }));
    const payload = {
      ...form,
      type: "office",
      walkIn,
      leadSource,
      items: priced,
      estValue: itemsTotal(priced),
      ...(walkIn
        ? {
            // The payout only exists on a walk-in, and an untouched amount
            // means the line-item total — the same value the card has been
            // showing all along.
            paidAmount: payoutTouched ? payout.amount : String(itemsTotal(priced)),
            paymentMethod: payout.method,
          }
        : pickup),
    };
    const errors = validateNewOrder(payload);
    if (Object.keys(errors).length > 0) {
      setFieldErrors(errors);
      setError(firstError(errors));
      return;
    }
    setFieldErrors({});
    setBusy(true);
    try {
      const result = await createOrderAction({ ...payload, confirmDuplicate, confirmDoubleBook });

      // Expected failures come back rather than throwing — Next would strip the
      // message and the field map off a thrown error in production.
      if (result?.error) {
        if (result.fieldErrors) setFieldErrors(result.fieldErrors);
        if (result.duplicateCount) setDuplicateCount(result.duplicateCount);
        if (result.slotTaken) setSlotTaken(true);
        setError(result.error);
        setBusy(false);
        return;
      }
      // A confirmation the customer never got is carried across the redirect
      // as a flag, not a message — the reason is in the log, not the URL. The
      // banner lives on the order page, which is the next thing the person
      // sees.
      router.push(`/orders/${result.id}${result.textError ? "?text=failed" : ""}`);
    } catch (err) {
      // The action returns the same field map, so a rule the form somehow
      // missed still lands on the right input.
      if (err?.fieldErrors) setFieldErrors(err.fieldErrors);
      // Not a validation failure — the server is asking whether this really is
      // a second visit. Everything typed stays put; one more press goes through.
      if (err?.duplicateCount) setDuplicateCount(err.duplicateCount);
      setError(err?.message || "Could not create the order.");
      setBusy(false);
    }
  }

  const summary = pickupSummary(pickup);
  const estTotal = itemsTotal(items);

  return (
    <form onSubmit={onSubmit} className="max-w-5xl space-y-4">
      {/* One choice, two kinds of job: are they coming, or are they here?
          Both save as type "office" — walk-in is a flag, not a type. Same
          segmented-control chrome as the calendar's view tabs. */}
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="inline-flex w-full rounded-pill border-[1.5px] border-line bg-white p-1 sm:w-auto">
          {[
            { key: "meetup", label: "Meetup", icon: CalendarClock },
            { key: "walk_in", label: "Walk-in", icon: Store },
          ].map((t) => {
            const active = (walkIn ? "walk_in" : "meetup") === t.key;
            const Icon = t.icon;
            return (
              <button
                key={t.key}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setWalkIn(t.key === "walk_in");
                  setFieldErrors({});
                }}
                className={
                  "inline-flex flex-1 items-center justify-center gap-1.5 rounded-pill px-4 py-1.5 text-[13px] font-semibold transition-colors sm:flex-none " +
                  (active ? "bg-accent text-white" : "text-muted hover:text-ink")
                }
              >
                <Icon size={14} /> {t.label}
              </button>
            );
          })}
        </div>
        {walkIn && (
          <p className="text-[12px] text-muted">
            Already happened — no texts, no calendar entry, saved as paid.
          </p>
        )}
      </div>

      {/* MEETUP: who + what + the actions on the left, the booking card on
          the right, so the columns roughly balance and the Create button
          lives with the form instead of floating at the page's foot. A
          walk-in has no calendar, so it keeps the same card rhythm in one
          column. min-w-0 because grid items refuse to shrink below their
          content otherwise, and the picker must never push the page wide. */}
      <div className={walkIn ? "max-w-xl space-y-4" : "grid gap-4 lg:grid-cols-2 lg:items-start"}>
        <div className="min-w-0 space-y-4">
          <Card className="space-y-3">
            <h3 className="text-[13px] font-semibold text-ink">Customer</h3>
            <div className="grid gap-3 sm:grid-cols-2">
              <Input
                label="Customer name"
                value={form.name}
                onChange={set("name")}
                error={fieldErrors.name}
                required
              />
              <Input
                label="Phone"
                value={form.phone}
                onChange={set("phone")}
                onBlur={(e) => checkCustomer(e.target.value)}
                error={fieldErrors.phone}
                placeholder="(704) 555-0142"
                required
              />
            </div>

            {/* Optional, and first-order-wins on the server: a repeat order
                can't overwrite where somebody ORIGINALLY came from. */}
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-medium text-ink">
                How did they hear about us?{" "}
                <span className="font-normal text-muted">(optional)</span>
              </span>
              <select
                value={leadSource}
                onChange={(e) => setLeadSource(e.target.value)}
                className="h-9 w-full rounded-lg border border-line bg-white px-3 text-[14px] sm:w-1/2"
              >
                <option value="">Not asked</option>
                {LEAD_SOURCES.map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>

            {/* What we already know about this number. An open order is a
                warning; a past order is just a familiar face. */}
            {known && <KnownCustomerNotice known={known} />}
          </Card>

          <ItemsEditor
            items={items}
            // Editing a line clears the "pick a condition" refusal the same
            // way typing in a field clears its own error.
            setItems={(fn) => {
              setItems(fn);
              setFieldErrors((prev) => (prev.items ? { ...prev, items: undefined } : prev));
            }}
            catalog={catalog}
            grades={grades}
            // A booking needs a condition per line; a walk-in's devices are
            // in hand and get graded at check-in minutes later.
            requireCondition={!walkIn}
            error={fieldErrors.items}
          />

          {/* AFTER the items, because the amount defaults to their total and
              reading it the other way round asks what you paid before you have
              said what for. */}
          {walkIn && (
            <WalkInPayout
              payout={payout}
              setPayout={setPayout}
              total={estTotal}
              touched={payoutTouched}
              setTouched={setPayoutTouched}
              fieldErrors={fieldErrors}
              paymentMethods={paymentMethods}
            />
          )}
        </div>

        {/* The appointment, beside the form on a desktop (spanning both left
            rows, so the actions card tucks under the customer stack with no
            void) and BETWEEN items and the Create button when stacked on a
            phone — pick the time before the button asks you to commit. */}
        {!walkIn && (
          <div className="min-w-0 space-y-4 lg:col-start-2 lg:row-span-2 lg:row-start-1">
            <MeetupSchedule
              pickup={pickup}
              // Editing the schedule clears a "slot taken" refusal: the clash
              // being fixed is the likeliest reason anyone touches it.
              setPickup={(fn) => {
                setPickup(fn);
                setSlotTaken(false);
              }}
              officeLine={officeLine}
              appointments={appointments}
              bookingSchedule={bookingSchedule}
            />
          </div>
        )}

        <div className="min-w-0 space-y-4 lg:col-start-1 lg:row-start-2">
          {duplicateCount > 0 && (
            <Card className="border-status-awaiting/40 bg-status-awaiting-bg/50">
              <p className="text-[13px] font-semibold text-status-awaiting">
                Create a second order anyway?
              </p>
              <p className="mt-0.5 text-[12.5px] text-muted">
                Only if this is genuinely a different batch of devices — two open orders for one
                visit means one of them never closes.
              </p>
              <Button
                type="button"
                variant="ghost"
                className="mt-2"
                disabled={busy}
                // Carries the OTHER banner's confirmation when it is already on
                // screen: both warnings were read, and re-refusing the one just
                // confirmed would bounce the person between the two forever.
                onClick={(e) =>
                  onSubmit(e, { confirmDuplicate: true, confirmDoubleBook: slotTaken })
                }
              >
                Yes, create it anyway
              </Button>
            </Card>
          )}

          {slotTaken && (
            <Card className="border-status-awaiting/40 bg-status-awaiting-bg/50">
              <p className="text-[13px] font-semibold text-status-awaiting">
                Book the same time slot anyway?
              </p>
              <p className="mt-0.5 text-[12.5px] text-muted">
                Someone is already booked then — the schedule shows who. Two visits in one slot
                means two places to be at once, unless different people are covering them.
              </p>
              <Button
                type="button"
                variant="ghost"
                className="mt-2"
                disabled={busy}
                onClick={(e) =>
                  onSubmit(e, { confirmDoubleBook: true, confirmDuplicate: duplicateCount > 0 })
                }
              >
                Yes, book it anyway
              </Button>
            </Card>
          )}

          {/* The close: what was chosen, what it comes to, and the button —
              together, because "Create order" floating at the page's foot is
              how orders got created with the summary unread. */}
          <Card className="space-y-3">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[13px]">
              {!walkIn &&
                (summary ? (
                  <>
                    <span
                      data-pickup-summary
                      className="inline-flex items-center gap-1.5 rounded-lg bg-accent-l px-2.5 py-1.5 font-semibold text-accent"
                    >
                      <CalendarClock size={14} />
                      {summary}
                    </span>
                    <button
                      type="button"
                      onClick={() => setPickup((p) => ({ ...p, pickupDate: "", pickupTime: "" }))}
                      className="text-[12px] font-semibold text-muted hover:text-ink"
                    >
                      Clear
                    </button>
                  </>
                ) : (
                  <span className="text-muted">Pick a time &rarr;</span>
                ))}
              <span className="ml-auto text-muted">
                Est. total{" "}
                <span className="font-bold tabular-nums text-ink">{currency(estTotal)}</span>
              </span>
            </div>

            {error && <p className="text-[13px] text-destructive">{error}</p>}

            <div className="flex gap-2">
              <Button type="submit" disabled={busy}>
                <Plus size={16} /> {busy ? "Creating…" : "Create order"}
              </Button>
              <Button type="button" variant="ghost" onClick={() => router.push("/")}>
                Cancel
              </Button>
            </div>
          </Card>
        </div>
      </div>
    </form>
  );
}
