/**
 * Create (or reset) QA logins — one per role — so every flow and every
 * role-gated screen can actually be opened and driven.
 *
 *   npm run test-account            # create/reset admin and va
 *   npm run test-account -- --show  # print the current credentials
 *   npm run test-account -- --role=va
 *   npm run test-account -- --delete
 *
 * Credentials are written to .env.test.local, which the other scripts read, so
 * `npm run shoot` and `npm run walkthrough` work with no further setup. That
 * file matches the existing `.env*.local` gitignore rule and cannot be
 * committed by accident.
 *
 * THESE ARE REAL LOGINS in your Supabase project. They use @example.com, a
 * reserved domain that can never receive mail, so they are obvious in the auth
 * user list and can't be confused with a colleague's account. `--delete`
 * removes them and their profiles.
 */
import { writeFileSync, readFileSync, existsSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";
import { loadEnv, required } from "./lib/env.mjs";
import { flag, has } from "./lib/args.mjs";

loadEnv();

const doDelete = has("delete");
const showOnly = has("show");
const onlyRole = flag("role", null);
const domain = flag("domain", "example.com");

const CRED_FILE = ".env.test.local";

/**
 * One account per role. `envPrefix` is what the other scripts look for —
 * SHOOT_EMAIL / SHOOT_PASSWORD is the default pair they already use, so staff
 * deliberately takes the unprefixed name.
 */
const ACCOUNTS = [
  { role: "admin", name: "QA Admin", envPrefix: "SHOOT_ADMIN" },
  { role: "va", name: "QA VA", envPrefix: "SHOOT" },
];

const wanted = onlyRole ? ACCOUNTS.filter((a) => a.role === onlyRole) : ACCOUNTS;
if (wanted.length === 0) {
  throw new Error(`Unknown role "${onlyRole}". Try: ${ACCOUNTS.map((a) => a.role).join(", ")}`);
}

const url = required("NEXT_PUBLIC_SUPABASE_URL", "Set it in .env.local.");
const key = required("SUPABASE_SERVICE_ROLE_KEY", "Set it in .env.local.");
const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

const emailFor = (role) => `qa-${role}@${domain}`;

/** Readable aloud and typeable — these get pasted into a login form by hand. */
function generatePassword(length = 16) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

async function findUser(email) {
  // No get-by-email in the admin API, so page through. A QA project has few
  // users; 200 is plenty and keeps this to one request.
  const { data, error } = await supabase.auth.admin.listUsers({ page: 1, perPage: 200 });
  if (error) throw error;
  return data.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) || null;
}

// --- show ------------------------------------------------------------------
if (showOnly) {
  if (!existsSync(CRED_FILE)) {
    console.log(`No ${CRED_FILE} yet. Run: npm run test-account`);
    process.exit(0);
  }
  console.log(readFileSync(CRED_FILE, "utf8").trim());
  process.exit(0);
}

// --- delete ----------------------------------------------------------------
if (doDelete) {
  for (const acct of wanted) {
    const email = emailFor(acct.role);
    const user = await findUser(email);
    if (!user) {
      console.log(`${email.padEnd(28)} not found`);
      continue;
    }
    // The profile row is removed by the on-delete cascade from auth.users.
    const { error } = await supabase.auth.admin.deleteUser(user.id);
    console.log(`${email.padEnd(28)} ${error ? `FAILED: ${error.message}` : "deleted"}`);
  }
  console.log(`\nDelete ${CRED_FILE} by hand if you want the credentials gone too.`);
  process.exit(0);
}

// --- create / reset --------------------------------------------------------
const results = [];

for (const acct of wanted) {
  const email = emailFor(acct.role);
  const password = generatePassword();
  const existing = await findUser(email);

  if (existing) {
    // Reset rather than fail: re-running this is how you recover a password
    // nobody wrote down, and it must not need a manual delete first.
    const { error } = await supabase.auth.admin.updateUserById(existing.id, {
      password,
      email_confirm: true,
      user_metadata: { full_name: acct.name },
    });
    if (error) throw new Error(`Could not reset ${email}: ${error.message}`);
    results.push({ ...acct, email, password, id: existing.id, action: "reset" });
  } else {
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // no SMTP in this project; an unconfirmed user can't sign in
      user_metadata: { full_name: acct.name },
    });
    if (error) throw new Error(`Could not create ${email}: ${error.message}`);
    results.push({ ...acct, email, password, id: data.user.id, action: "created" });
  }
}

// The trigger writes full_name from user_metadata; the role is ours to set,
// and must be re-applied on reset in case someone changed it in the UI.
for (const r of results) {
  const { error } = await supabase.from("profiles").update({ role: r.role }).eq("id", r.id);
  if (error) throw new Error(`Could not set role for ${r.email}: ${error.message}`);
}

// --- write the credentials the other scripts read --------------------------
// Merged, not overwritten: running with --role=driver must not drop the staff
// credentials the walkthrough needs.
// EXACT keys, not a prefix test: "SHOOT_" is also the start of
// "SHOOT_ADMIN_EMAIL", so a prefix match on the VA account would delete the
// admin credentials every time someone ran --role=va.
const replacing = new Set(
  results.flatMap((r) => [`${r.envPrefix}_EMAIL`, `${r.envPrefix}_PASSWORD`]),
);
const existingLines = existsSync(CRED_FILE) ? readFileSync(CRED_FILE, "utf8").split("\n") : [];
const kept = existingLines.filter((l) => {
  const m = l.match(/^([A-Z0-9_]+)=/);
  return m ? !replacing.has(m[1]) : false; // comments are re-added below
});

const lines = [
  "# QA logins, written by `npm run test-account`.",
  "# Gitignored via .env*.local — never commit these.",
  "",
  ...kept,
  ...results.flatMap((r) => [
    `${r.envPrefix}_EMAIL=${r.email}`,
    `${r.envPrefix}_PASSWORD=${r.password}`,
  ]),
];
writeFileSync(CRED_FILE, `${lines.join("\n")}\n`);

console.log(`\n${results.length} QA login(s) ready:\n`);
console.log("  ROLE     EMAIL                        PASSWORD           ");
for (const r of results) {
  console.log(`  ${r.role.padEnd(8)} ${r.email.padEnd(28)} ${r.password}  (${r.action})`);
}
console.log(`\nWritten to ${CRED_FILE} — shoot and walkthrough pick these up automatically.`);
console.log("Sign in at http://localhost:3000/login");
