/**
 * Who can see what.
 *
 * ============================================================================
 * EDIT THIS TABLE TO CHANGE PERMISSIONS. Nothing else needs to change.
 * ============================================================================
 *
 * One table drives three things, so they can never disagree:
 *   - the middleware gate (a VA typing /expenses is redirected, not shown)
 *   - which sidebar links render
 *   - where each role lands when they sign in
 *
 * Paths are the CLEAN urls people actually see (/customers), not the internal
 * /employee/* route tree — middleware checks access before it rewrites.
 *
 * Matching is longest-prefix, so a more specific rule wins over a general one.
 * `exact: true` matches only that path, which "/" needs or it would match
 * everything.
 *
 * FAIL-CLOSED: a path with no rule is denied to everyone. Adding a page
 * therefore means adding a line here — deliberately, so a new screen is never
 * accidentally world-readable to every role.
 */
import { dayKey } from "./dates";

export const ROUTE_ACCESS = [
  { path: "/", exact: true, roles: ["admin", "va"] },
  { path: "/customers", roles: ["admin", "va"] },
  { path: "/messages", roles: ["admin", "va"] },
  // Answering the phone is the same job as answering texts, and gates the
  // voice access token.
  { path: "/calls", roles: ["admin", "va"] },
  { path: "/new", roles: ["admin", "va"] },
  { path: "/calendar", roles: ["admin", "va"] },
  { path: "/orders", roles: ["admin", "va"] },

  // The VA WRITES inventory here, unlike the DTS app this grew from: they
  // put temporary device names on rows for Jaime to see, and check-in pulls
  // the real facts from Sickw by IMEI (Jaime, 2026-08-13).
  { path: "/inventory", roles: ["admin", "va"] },
  { path: "/inventory/check-in", roles: ["admin", "va"] },
  // The 4x2 device labels (condition + barcode + IMEI + device), printed from
  // the grid's selection or an order's check-in. Already covered by the
  // /inventory prefix; listed so the page is a deliberate entry like every
  // other, not an accident of prefix matching.
  { path: "/inventory/labels", roles: ["admin", "va"] },

  // The VA also builds invoices and prices the lines — the export/reconcile
  // flow with the buyer sheet is their job (Jaime, 2026-08-13).
  { path: "/invoices", roles: ["admin", "va"] },

  // Leads from the marketing site's quote wizard. Same job as answering
  // texts/calls, so both roles triage them (Jaime, 2026-10-02).
  { path: "/leads", roles: ["admin", "va"] },

  // The money going out that isn't a customer payout — ad spend, payroll.
  { path: "/expenses", roles: ["admin"] },

  // Revenue minus cost minus expenses — what the business actually nets.
  // Not everybody's business.
  { path: "/pl", roles: ["admin"] },

  // The item catalog (labelled Item Catalog in the UI; the /pricing path is
  // historical). What we buy is the admin's call.
  { path: "/pricing", roles: ["admin"] },
  { path: "/team", roles: ["admin"] },

  // API keys, booking hours, grades, payment methods.
  { path: "/settings", roles: ["admin"] },
];

/** Where each role lands on sign-in, and where a denied request is sent. */
export const ROLE_HOME = {
  admin: "/",
  va: "/",
};

/** Paths that bypass this table entirely (auth pages, sign-out). */
const UNGATED = ["/login", "/auth"];

/** @returns {boolean} whether `pathname` is exempt from role checks. */
export function isUngated(pathname) {
  return UNGATED.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** The most specific rule matching a path, or null when none does. */
function ruleFor(pathname) {
  let best = null;
  for (const rule of ROUTE_ACCESS) {
    const hit = rule.exact
      ? pathname === rule.path
      : pathname === rule.path || pathname.startsWith(`${rule.path}/`);
    if (hit && (!best || rule.path.length > best.path.length)) best = rule;
  }
  return best;
}

/**
 * Whether a role may open a path. Unknown paths and unknown roles are denied.
 *
 * @param {string} role
 * @param {string} pathname a clean, pre-rewrite path such as "/customers"
 */
export function canAccess(role, pathname) {
  if (isUngated(pathname)) return true;
  const rule = ruleFor(pathname);
  return Boolean(rule && rule.roles.includes(role));
}

/**
 * ============================================================================
 * READ-ONLY AREAS — screens a role may open but must not change.
 * ============================================================================
 *
 * Currently EMPTY: the VA writes everywhere they can read (inventory naming
 * and invoice pricing are their job). The mechanism stays because every write
 * action already calls canWrite(), and the day a role needs read-only access
 * to a money screen this is one entry, not a refactor. Roles not listed are
 * unrestricted — fail-open, same default as DATA_SCOPE and for the same
 * reason: forgetting an entry shows too much rather than freezing someone
 * mid-shift.
 */
export const READ_ONLY_AREAS = {};

/**
 * Whether this role may perform a WRITE reachable from `pathname`.
 *
 * Composed from canAccess rather than parallel to it, so a path nobody may
 * open is also a path nobody may write — the fail-closed default keeps
 * working and there is no second table to forget.
 *
 * Server actions under /inventory and /invoices call this instead of
 * canAccess. The UI hides the same buttons, but the action is the check that
 * counts: a server action is a public POST endpoint whatever the page renders.
 */
export function canWrite(role, pathname) {
  if (!canAccess(role, pathname)) return false;
  const readOnly = READ_ONLY_AREAS[role] ?? [];
  return !readOnly.some((area) => pathname === area || pathname.startsWith(`${area}/`));
}

/**
 * Whether this role sees the Overview view of the dashboard.
 *
 * A VIEW, not a route (`/?view=overview`), so it cannot live in the table
 * above — but it is the same kind of decision, which is why it sits here next
 * to it. Excluded for the VA because it is the business's numbers: leads,
 * repeat-customer rates, payout totals and pipeline value. The Orders list on
 * the same page is their actual work and stays.
 */
export function canSeeOverview(role) {
  return role === "admin";
}

/** Where to send this role — their home, or the first thing they can open. */
export function homeFor(role) {
  const home = ROLE_HOME[role];
  if (home && canAccess(role, home)) return home;
  const first = ROUTE_ACCESS.find((r) => r.roles.includes(role));
  return first?.path ?? "/login";
}

/** Filter a list of nav items ({ href }) down to what this role may open. */
export function navFor(role, items) {
  return items.filter((item) => canAccess(role, item.href));
}

/**
 * ============================================================================
 * DATA SCOPE — which orders a role may see, regardless of how they ask.
 * ============================================================================
 *
 * Currently EMPTY: both roles see every order. The mechanism stays wired
 * through lib/repositories/scope.js because it is the difference between
 * "blocked a page" and "the rows never leave Postgres", and the next
 * restricted role (an in-store employee, a second VA) is one entry here
 * rather than a security project. A role NOT listed is unrestricted —
 * deliberately the opposite default from ROUTE_ACCESS: forgetting a role
 * here shows too much rather than locking someone out mid-shift.
 */
export const DATA_SCOPE = {};

/**
 * Whether this role handles the customer conversation: the inbox, the call
 * log, the notification bell, the new-reply chime.
 *
 * DERIVED from /messages rather than listed separately, so ROUTE_ACCESS stays
 * the one table to edit.
 */
export function canContactCustomers(role) {
  return canAccess(role, "/messages");
}

/**
 * Whether this person may text or call the customer on ONE order.
 *
 * With no scoped roles left, this is the same question as
 * canContactCustomers — but every composer and call button already asks it
 * per-order, and keeping the signature means the next restricted role slots
 * back in here without touching the callers. The extra parameters are
 * accepted and ignored for exactly that reason.
 *
 * @param {string} role
 * @param {object} order a mapped domain order
 * @param {string|null} staffId the person asking
 * @param {string} today YYYY-MM-DD
 */
export function canContactOrder(role, order, staffId, today) {
  return canContactCustomers(role);
}

/** Today as YYYY-MM-DD in the runtime's timezone — kept for callers of canContactOrder. */
export function todayKey(now = new Date()) {
  return dayKey(now);
}

/**
 * Order types this role may see, or null when unrestricted.
 * @returns {string[] | null}
 */
export function orderTypesFor(role) {
  return DATA_SCOPE[role]?.orderTypes ?? null;
}

/** Whether this role only sees orders assigned to them. */
export function isOwnedOnly(role) {
  return Boolean(DATA_SCOPE[role]?.ownedOnly);
}

/**
 * Whether a single order is within this role's scope.
 *
 * @param {string} role
 * @param {object} order a mapped domain order (or a raw row)
 * @param {string|null} [staffId] required for roles restricted to their own work
 */
export function canSeeOrder(role, order, staffId = null) {
  const types = orderTypesFor(role);
  if (types && !types.includes(order?.type || "office")) {
    return false;
  }
  if (isOwnedOnly(role)) {
    const assignee = order?.assigneeId ?? null;
    if (!staffId || !assignee || assignee !== staffId) return false;
  }
  return true;
}
