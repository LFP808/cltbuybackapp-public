"use client";

import { useState, useTransition } from "react";
import { PhoneForwarded } from "lucide-react";
import { Button, Modal, DialogFooter } from "@/components/ui";
import { useStaff } from "@/components/employee/StaffContext";
import { fmtPhone } from "@/domain/format";
import { runAction } from "@/lib/run-action";
import { callCustomerAction } from "@/app/employee/calls/actions";

/**
 * Call a customer through the owner's cell — the call-through.
 *
 * Renders only for an admin, because the button's first act is to make the
 * owner's personal phone ring (the action re-checks the role server-side;
 * this gate is so nobody else sees a button that can't work for them). Sits
 * beside the browser softphone's CallButton, which renders nothing until its
 * Twilio API keys exist — this one needs only the credentials texting uses.
 *
 * Confirms before dialling, like every send: a misclick here rings two real
 * phones. The dialog says exactly what will happen, because "Call" reading as
 * "this browser will call them" and then your pocket ringing is a jump scare.
 */
export function CallCustomerButton({
  phone,
  name,
  className,
  variant = "ghost",
  size = "sm",
  label,
}) {
  const { role } = useStaff();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [placed, setPlaced] = useState(false);
  const [pending, startTransition] = useTransition();

  if (role !== "admin" || !phone) return null;

  function openConfirm() {
    setError("");
    setPlaced(false);
    setOpen(true);
  }

  function dial() {
    setError("");
    startTransition(async () => {
      const { ok, error: message } = await runAction(() => callCustomerAction({ phone, name }));
      if (!ok) return setError(message);
      setPlaced(true);
    });
  }

  return (
    <>
      <Button
        type="button"
        variant={variant}
        size={size}
        className={className}
        onClick={openConfirm}
        aria-label={`Call ${fmtPhone(phone)} via your phone`}
      >
        <PhoneForwarded size={15} /> {label ?? "Call"}
      </Button>

      <Modal open={open} onClose={() => setOpen(false)} title={`Call ${name || fmtPhone(phone)}`}>
        {placed ? (
          <div className="space-y-3">
            <p className="text-[13.5px] text-ink">
              Your phone is ringing. Answer it and you&apos;ll be connected to{" "}
              {name || fmtPhone(phone)} — they see the business number.
            </p>
            <DialogFooter>
              <Button onClick={() => setOpen(false)}>Done</Button>
            </DialogFooter>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-[13.5px] text-ink">
              Your own phone rings first. Answer it, and {name || "the customer"} at{" "}
              {fmtPhone(phone)} is dialled and connected — their caller ID shows the business
              number, not yours.
            </p>
            {error && <p className="text-[12.5px] text-red-600">{error}</p>}
            <DialogFooter>
              <Button
                type="button"
                variant="ghost"
                onClick={() => setOpen(false)}
                disabled={pending}
              >
                Cancel
              </Button>
              <Button onClick={dial} disabled={pending}>
                {pending ? "Placing call..." : "Ring my phone"}
              </Button>
            </DialogFooter>
          </div>
        )}
      </Modal>
    </>
  );
}
