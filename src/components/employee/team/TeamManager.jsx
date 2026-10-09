"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  UserPlus,
  Copy,
  Check,
  AlertCircle,
  X,
  KeyRound,
  UserX,
  UserCheck,
  Phone,
} from "lucide-react";
import {
  Card,
  Button,
  Input,
  Avatar,
  SectionLabel,
  EmptyState,
  Badge,
  Modal,
  DialogFooter,
} from "@/components/ui";
import { ROLES, roleLabel } from "@/domain/roles";
import {
  addTeamMemberAction,
  setRoleAction,
  setTeamPhoneAction,
  setTeamActiveAction,
  resetPasswordAction,
} from "@/app/employee/team/actions";
import { fmtPhone } from "@/domain/format";
import { runAction } from "@/lib/run-action";
import { cn } from "@/lib/cn";

/**
 * Add and manage staff logins. The login creates the profile, and the
 * profile's generated id is what every other table points at — there is no
 * id for anyone to type or keep in sync.
 */
export function TeamManager({ members, isAdmin, currentUserId }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ email: "", name: "", role: "va" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [created, setCreated] = useState(null); // { name, email, password }
  const [copied, setCopied] = useState(false);
  const [roleBusyId, setRoleBusyId] = useState(null);
  // The member whose access is being switched off, or null. Deactivating is
  // the one destructive thing on this page, so it confirms.
  const [deactivating, setDeactivating] = useState(null);
  // Which row's phone field is being edited, and the value in it.
  const [phoneEdit, setPhoneEdit] = useState(null);

  async function add() {
    setBusy(true);
    setError("");
    const { ok, error, result } = await runAction(
      () => addTeamMemberAction(form),
      "Could not add that person.",
    );
    setBusy(false);

    // The result IS the new member's one-time password panel. On a refusal it
    // has no password, so showing it would hand over a credentials card reading
    // "undefined".
    if (!ok) {
      setError(error);
      return;
    }
    setCreated({ ...result, email: form.email.trim().toLowerCase() });
    setForm({ email: "", name: "", role: "va" });
    setOpen(false);
    router.refresh();
  }

  async function changeRole(id, role) {
    setRoleBusyId(id);
    setError("");
    const { ok, error } = await runAction(
      () => setRoleAction(id, role),
      "Could not change that role.",
    );
    setRoleBusyId(null);

    // "You can't remove your own admin access." is the message that must not
    // vanish here — losing it means an unrecoverable lockout looks like it
    // worked.
    if (!ok) {
      setError(error);
      return;
    }
    router.refresh();
  }

  /** Shared by role, phone, access and reset — one busy row, one error line. */
  async function rowAction(id, fn, fallback) {
    setRoleBusyId(id);
    setError("");
    const { ok, error: why, result } = await runAction(fn, fallback);
    setRoleBusyId(null);
    if (!ok) {
      setError(why);
      return null;
    }
    router.refresh();
    return result;
  }

  async function savePhone(m) {
    const value = phoneEdit?.value ?? "";
    setPhoneEdit(null);
    await rowAction(m.id, () => setTeamPhoneAction(m.id, value), "Could not save that number.");
  }

  async function toggleActive(m, active) {
    setDeactivating(null);
    await rowAction(m.id, () => setTeamActiveAction(m.id, active), "Could not change that login.");
  }

  async function resetPassword(m) {
    const result = await rowAction(
      m.id,
      () => resetPasswordAction(m.id),
      "Could not reset that password.",
    );
    // Reuses the one-time credentials panel: same handover, same warning, and
    // the same single chance to read it.
    if (result?.password)
      setCreated({ name: m.name, role: m.role, email: "", password: result.password });
  }

  function copyPassword() {
    navigator.clipboard?.writeText(created.password).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <div className="max-w-2xl">
      {/* The password exists in readable form exactly once. If this panel is
          dismissed before it's handed over, the only way back is a reset. */}
      {created && (
        <Card className="mb-4 border-accent/40 bg-accent-l/40">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13.5px] font-bold text-ink">
                {created.email
                  ? `${created.name} can now sign in as ${roleLabel(created.role)}`
                  : `New password for ${created.name}`}
              </p>
              <p className="mt-0.5 text-[12px] text-muted">
                Give them these details. The password is shown once and can&apos;t be looked up
                again — only reset.
              </p>
              <div className="mt-2.5 space-y-1 rounded-lg bg-white p-3 font-mono text-[12.5px]">
                {created.email && <div>{created.email}</div>}
                <div className="font-bold">{created.password}</div>
              </div>
              <Button variant="ghost" size="sm" className="mt-2" onClick={copyPassword}>
                {copied ? <Check size={14} /> : <Copy size={14} />}
                {copied ? "Copied" : "Copy password"}
              </Button>
            </div>
            <button
              onClick={() => setCreated(null)}
              aria-label="Dismiss"
              className="rounded-md p-1 text-muted hover:bg-white hover:text-ink"
            >
              <X size={16} />
            </button>
          </div>
        </Card>
      )}

      {error && (
        <p className="mb-3 flex items-center gap-1.5 text-[13px] text-red-500">
          <AlertCircle size={14} /> {error}
        </p>
      )}

      {isAdmin && (
        <div className="mb-4">
          {open ? (
            <Card className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <Input
                  label="Name"
                  value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Ray Delgado"
                  autoFocus
                />
                <Input
                  label="Email"
                  type="email"
                  value={form.email}
                  onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
                  placeholder="ray@example.com"
                />
              </div>
              <label className="flex flex-col gap-1.5">
                <span className="text-[13px] font-medium text-ink">Role</span>
                <select
                  value={form.role}
                  onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}
                  className="h-9 rounded-lg border border-line bg-white px-3 text-[14px]"
                >
                  {ROLES.map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(r)}
                    </option>
                  ))}
                </select>
                <span className="text-[12px] text-muted">
                  Admins see everything; a VA sees the day-to-day, not the books.
                </span>
              </label>
              <div className="flex gap-2">
                <Button disabled={busy} onClick={add}>
                  {busy ? "Adding…" : "Create login"}
                </Button>
                <Button variant="ghost" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </div>
            </Card>
          ) : (
            <Button onClick={() => setOpen(true)}>
              <UserPlus size={15} /> Add team member
            </Button>
          )}
        </div>
      )}

      <SectionLabel>Team · {members.length}</SectionLabel>
      {members.length === 0 ? (
        <Card>
          <EmptyState icon={UserPlus}>No team members yet.</EmptyState>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {members.map((m) => (
            <Card key={m.id} className="p-3.5">
              <div className="flex flex-wrap items-center gap-3">
                <Avatar initial={(m.name || "?").trim()[0]?.toUpperCase() || "?"} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span
                      className={cn(
                        "truncate text-[13.5px] font-semibold",
                        m.active ? "text-ink" : "text-muted line-through",
                      )}
                    >
                      {m.name}
                    </span>
                    {m.id === currentUserId && (
                      <span className="text-[11px] font-normal text-muted">(you)</span>
                    )}
                    {!m.active && <Badge className="bg-bg text-muted">No access</Badge>}
                  </div>
                  <div className="flex flex-wrap items-center gap-x-2 text-[11px] text-muted">
                    {m.createdAt && <span>Added {new Date(m.createdAt).toLocaleDateString()}</span>}
                    {m.phone && (
                      <span className="inline-flex items-center gap-1">
                        · <Phone size={10} /> {fmtPhone(m.phone)}
                      </span>
                    )}
                  </div>
                </div>
                {isAdmin ? (
                  <select
                    value={m.role}
                    disabled={roleBusyId === m.id}
                    onChange={(e) => changeRole(m.id, e.target.value)}
                    aria-label={`Role for ${m.name}`}
                    className="rounded-lg border border-line bg-white px-2.5 py-1.5 text-[12.5px] disabled:opacity-60"
                  >
                    {ROLES.map((r) => (
                      <option key={r} value={r}>
                        {roleLabel(r)}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="text-[12.5px] text-muted">{roleLabel(m.role)}</span>
                )}
              </div>

              {isAdmin && (
                <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-line pt-2">
                  {phoneEdit?.id === m.id ? (
                    <>
                      <input
                        value={phoneEdit.value}
                        onChange={(e) => setPhoneEdit({ id: m.id, value: e.target.value })}
                        placeholder="(704) 555-0142"
                        aria-label={`Phone for ${m.name}`}
                        autoFocus
                        className="h-8 w-40 rounded-lg border border-line px-2.5 text-[12.5px] outline-none focus:border-accent"
                      />
                      <Button size="sm" disabled={roleBusyId === m.id} onClick={() => savePhone(m)}>
                        Save
                      </Button>
                      <Button size="sm" variant="ghost" onClick={() => setPhoneEdit(null)}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <Button
                      size="sm"
                      variant="ghost"
                      disabled={roleBusyId === m.id}
                      onClick={() => setPhoneEdit({ id: m.id, value: m.phone || "" })}
                    >
                      <Phone size={13} /> {m.phone ? "Change phone" : "Add phone"}
                    </Button>
                  )}

                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={roleBusyId === m.id}
                    onClick={() => resetPassword(m)}
                  >
                    <KeyRound size={13} /> Reset password
                  </Button>

                  {/* Never on your own row: locking yourself out cannot be
                      undone from inside the app. */}
                  {m.id !== currentUserId &&
                    (m.active ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={roleBusyId === m.id}
                        onClick={() => setDeactivating(m)}
                      >
                        <UserX size={13} /> Deactivate
                      </Button>
                    ) : (
                      <Button
                        size="sm"
                        variant="ghost"
                        disabled={roleBusyId === m.id}
                        onClick={() => toggleActive(m, true)}
                      >
                        <UserCheck size={13} /> Reactivate
                      </Button>
                    ))}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Modal
        open={Boolean(deactivating)}
        onClose={() => setDeactivating(null)}
        title="Deactivate login"
      >
        {deactivating && (
          <div className="space-y-3">
            <p className="text-[13px] text-ink">
              {deactivating.name} won&apos;t be able to sign in from now on, and stops appearing
              when a pickup is assigned.
            </p>
            <p className="text-[12px] text-muted">
              Their name stays on the orders, payouts, and activity they handled — nothing in the
              history changes. You can switch them back on at any time.
            </p>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setDeactivating(null)}>
                Cancel
              </Button>
              <Button onClick={() => toggleActive(deactivating, false)}>Deactivate</Button>
            </DialogFooter>
          </div>
        )}
      </Modal>
    </div>
  );
}
