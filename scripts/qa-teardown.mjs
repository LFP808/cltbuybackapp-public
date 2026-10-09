/**
 * Remove EVERY QA login before go-live — by pattern, not by list.
 *
 *   npm run qa:teardown            # dry run: shows what would be deleted
 *   npm run qa:teardown -- --yes   # actually delete
 *
 * This exists because the by-list version already failed once without running:
 * DEPLOYMENT.md's cleanup step named `qa-staff@` while the seeder had been
 * renamed to create `qa-va@` — so following the checklist to the letter
 * deleted an account that didn't exist and left a working staff login (with
 * its password sitting in .env.test.local) live in production. A pattern
 * can't drift when a role is renamed; a hand-maintained list just did.
 *
 * Matches any auth user whose email local-part starts with "qa-". The seeder
 * only ever creates qa-<role>@ addresses (default domain example.com, reserved
 * and unable to receive mail), and the dry run prints exactly what matched, so
 * a false positive is seen before anything is touched. Profiles go with the
 * users via the on-delete cascade.
 *
 * It also sweeps leftover QA DATA by the same pattern-not-list rule: every
 * seeding script tags what it creates ("ZZ QA …", "ZZ Test …", "ZZ Inv …")
 * and deletes it in a finally block — but a run that dies hard leaves its
 * rows, and those are exactly the rows that must not reach go-live.
 */
import { existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { loadEnv, required } from "./lib/env.mjs";
import { has } from "./lib/args.mjs";

loadEnv();

const confirmed = has("yes");

const url = required("NEXT_PUBLIC_SUPABASE_URL", "Set it in .env.local.");
const key = required("SUPABASE_SERVICE_ROLE_KEY", "Set it in .env.local.");
const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

/** Page through every auth user — one short page is the end. */
async function listAllUsers() {
  const users = [];
  for (let page = 1; ; page++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    users.push(...data.users);
    if (data.users.length < 200) return users;
  }
}

const all = await listAllUsers();
const qa = all.filter((u) => /^qa-/i.test(String(u.email || "")));

/**
 * Leftover seeded rows, found by the "ZZ " name tag every QA script uses.
 * Orders anchor most of it (lots and messages hang off them by FK); buyers
 * anchor the invoices.
 */
async function findLeftovers() {
  const [orders, buyers] = await Promise.all([
    supabase.from("orders").select("id, name").like("name", "ZZ %"),
    supabase.from("buyers").select("id, name").like("name", "ZZ %"),
  ]);
  return { orders: orders.data || [], buyers: buyers.data || [] };
}

const leftovers = await findLeftovers();

if (qa.length === 0 && !leftovers.orders.length && !leftovers.buyers.length) {
  console.log(`No qa-* logins or ZZ-tagged rows found (${all.length} users checked). Nothing to do.`);
  process.exit(0);
}

if (qa.length) {
  console.log(`${qa.length} QA login(s) found:\n`);
  for (const u of qa) {
    const last = u.last_sign_in_at ? new Date(u.last_sign_in_at).toLocaleDateString() : "never";
    console.log(`  ${String(u.email).padEnd(32)} last sign-in: ${last}`);
  }
}
if (leftovers.orders.length || leftovers.buyers.length) {
  console.log(`\nLeftover QA data (a run that died before its own cleanup):`);
  for (const o of leftovers.orders) console.log(`  order  ${o.name}`);
  for (const b of leftovers.buyers) console.log(`  buyer  ${b.name}`);
}

if (!confirmed) {
  console.log("\nDry run - nothing deleted. Re-run with --yes to remove them:");
  console.log("  npm run qa:teardown -- --yes");
  process.exit(0);
}

let failed = 0;
for (const u of qa) {
  // Profile rows are removed by the on-delete cascade from auth.users.
  const { error } = await supabase.auth.admin.deleteUser(u.id);
  if (error) failed++;
  console.log(`  ${String(u.email).padEnd(32)} ${error ? `FAILED: ${error.message}` : "deleted"}`);
}

// Data goes in FK order: lots and messages point at orders and invoices;
// invoices point at buyers. Orders last among their dependents.
if (leftovers.orders.length || leftovers.buyers.length) {
  const orderIds = leftovers.orders.map((o) => o.id);
  const buyerIds = leftovers.buyers.map((b) => b.id);
  const steps = [];
  if (orderIds.length) {
    steps.push(["inventory_lots", supabase.from("inventory_lots").delete().in("order_id", orderIds)]);
    steps.push(["messages", supabase.from("messages").delete().in("order_id", orderIds)]);
  }
  if (buyerIds.length) {
    steps.push(["invoices", supabase.from("invoices").delete().in("buyer_id", buyerIds)]);
    steps.push(["buyers", supabase.from("buyers").delete().in("id", buyerIds)]);
  }
  if (orderIds.length) {
    steps.push(["orders", supabase.from("orders").delete().in("id", orderIds)]);
  }
  for (const [table, query] of steps) {
    const { error } = await query;
    if (error) failed++;
    console.log(`  ${table.padEnd(32)} ${error ? `FAILED: ${error.message}` : "swept"}`);
  }
}

if (existsSync(".env.test.local")) {
  console.log("\nDelete .env.test.local by hand too - the passwords in it are now dead, but");
  console.log("a credentials file with no matching account is still clutter worth removing.");
}
console.log(
  failed ? `\n${failed} deletion(s) FAILED - fix and re-run.` : "\nAll QA logins removed.",
);
process.exit(failed ? 1 : 0);
