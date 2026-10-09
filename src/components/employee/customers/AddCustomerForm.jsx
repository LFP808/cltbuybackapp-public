"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal, Input, Button, DialogFooter } from "@/components/ui";
import { createCustomerAction } from "@/app/employee/customers/actions";
import { runAction } from "@/lib/run-action";

const EMPTY = { name: "", phone: "" };

/** Modal to add a customer by hand. */
export function AddCustomerForm({ open, onClose }) {
  const router = useRouter();
  const [form, setForm] = useState(EMPTY);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  async function submit() {
    setError("");
    setBusy(true);
    const { ok, error } = await runAction(
      () => createCustomerAction(form),
      "Could not add customer.",
    );
    // Cleared on EVERY path: this modal is mounted permanently by CustomersList,
    // so a busy flag left set on success disables the form until a page reload.
    setBusy(false);

    // Only clear and close on a real success — closing the modal on a refusal
    // reads as "saved" for a customer that was never created.
    if (!ok) {
      setError(error);
      return;
    }
    setForm(EMPTY);
    onClose();
    router.refresh();
  }

  return (
    <Modal open={open} onClose={onClose} title="Add customer">
      <div className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Name" value={form.name} onChange={set("name")} autoFocus />
          <Input label="Phone" value={form.phone} onChange={set("phone")} />
        </div>
        {error && <p className="text-[13px] text-red-500">{error}</p>}
        <DialogFooter>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={busy}>
            {busy ? "Adding…" : "Add customer"}
          </Button>
        </DialogFooter>
      </div>
    </Modal>
  );
}
