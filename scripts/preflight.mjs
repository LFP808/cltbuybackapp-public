/**
 * Everything that has to be true before this app can serve a real customer.
 *
 *   npm run preflight              # check the local env
 *   npm run preflight -- --live    # also demand production settings
 *
 * Three things get checked, because three things have historically been wrong
 * at exactly the wrong moment:
 *
 *   ENV        every variable the code actually reads, discovered by grepping
 *              src/ rather than from a hand-kept list that drifts.
 *   SCHEMA     every column the code relies on, probed over PostgREST — and
 *              the DTS ancestor's columns probed to be GONE, because this
 *              schema was converted by hand and a half-converted database
 *              looks fine until the first write.
 *   CREDENTIALS Supabase and Twilio actually answer, and are in the mode you
 *              think they are in.
 *
 * `--live` is the one that matters on launch day: it fails if SMS is still in
 * test mode. That deploys perfectly happily and produces an app where every
 * screen looks right and no customer ever receives a text.
 *
 * Exits non-zero on any failure, so it can gate a deploy.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";
import { has } from "./lib/args.mjs";

const LIVE = has("live");
const problems = [];
const warnings = [];

const ok = (m) => console.log(`   ✓ ${m}`);
const bad = (m) => {
  problems.push(m);
  console.log(`   ✗ ${m}`);
};
const warn = (m) => {
  warnings.push(m);
  console.log(`   ! ${m}`);
};

/* ---------------- env ---------------- */

function loadEnv(file) {
  if (!existsSync(file)) return {};
  return Object.fromEntries(
    readFileSync(file, "utf8")
      .split("\n")
      .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
      .map((l) => {
        const i = l.indexOf("=");
        return [
          l.slice(0, i).trim(),
          l
            .slice(i + 1)
            .trim()
            .replace(/^["']|["']$/g, ""),
        ];
      }),
  );
}

const env = { ...loadEnv(".env.local"), ...process.env };

/**
 * Variables the code reads, found by grepping src/ — so a new one cannot be
 * added without this noticing, which a hand-maintained list cannot promise.
 */
function envVarsUsedInCode() {
  const out = execSync(`grep -rhoE "process\\.env\\.[A-Z_]+" src/ | sort -u`, { encoding: "utf8" });
  return out
    .split("\n")
    .map((l) => l.replace("process.env.", "").trim())
    .filter(Boolean);
}

// Without these the app cannot start or cannot say where meetups happen.
const REQUIRED = ["NEXT_PUBLIC_SUPABASE_URL", "BUSINESS_NAME"];

/**
 * Either-or variables: satisfied by any one of a set, so they cannot go in the
 * list above without false-alarming whenever the alternative is the one set.
 */
const REQUIRED_EITHER = [
  {
    // Supabase renamed the keys (anon -> publishable, service_role -> secret)
    // and the app reads either name, so demanding one spelling would fail a
    // deploy that is correctly configured under the other.
    keys: ["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_SUPABASE_ANON_KEY"],
    why: "the app cannot create a Supabase client without a public key",
  },
  {
    keys: ["SUPABASE_SECRET_KEY", "SUPABASE_SERVICE_ROLE_KEY"],
    why: "the sweeps, webhooks and digest have no service-role client",
  },
];

/**
 * The meetup address is a SETTING (app_settings `office_address`, saved on
 * /settings) with OFFICE_STREET / BUSINESS_STREET as the fallback for a
 * database nobody has saved to yet. officeAddressLine() feeds every meetup
 * confirmation and reminder; with neither, the customer is told to come to
 * "Charlotte, NC". Reported in the schema section, where the setting can be
 * read; `checked` is false when there were no credentials to look.
 */
const envStreet = env.OFFICE_STREET || env.BUSINESS_STREET;
function reportMeetupAddress(storedStreet, checked) {
  if (storedStreet) ok(`meetup address set on /settings (${storedStreet})`);
  else if (envStreet && checked)
    ok(`meetup address from env (${envStreet}) — save it on /settings and the env stops mattering`);
  else if (envStreet) ok(`meetup address from env (${envStreet}) — /settings not checked`);
  else if (LIVE)
    bad(
      "no meetup address — set it on /settings (or OFFICE_STREET); texts would say 'Come see us at Charlotte, NC'",
    );
  else warn("no meetup address yet — set it on /settings (or OFFICE_STREET for a fresh database)");
}

/**
 * Needed only when texting is switched on.
 *
 * Held apart from REQUIRED_LIVE because MESSAGING_ENABLED=false means these are
 * not read by anything — no send path, no webhook, no credential lookup. Demanding
 * them anyway would print four red lines and a "do not deploy" at a deployment
 * that is deliberately quiet while A2P approval is pending, and a preflight that
 * cries wolf is one somebody runs once and then stops believing.
 *
 * They become hard requirements the moment MESSAGING_ENABLED is true, which is
 * the only moment they matter.
 */
const REQUIRED_MESSAGING = [
  "TWILIO_ACCOUNT_SID",
  "TWILIO_AUTH_TOKEN",
  "TWILIO_FROM_NUMBER",
  "TWILIO_WEBHOOK_URL",
];

// Required only once real customers are involved.
const REQUIRED_LIVE = [
  "DIGEST_SECRET",
  // NOT interchangeable with DIGEST_SECRET, however much it looks it. The
  // vercel.json cron is what actually runs the morning digest, and Vercel sends
  // `Authorization: Bearer $CRON_SECRET` only when this variable is set — with
  // no way to add a header of our own. DIGEST_SECRET covers manual curl runs;
  // without CRON_SECRET the scheduled run 401s every morning in silence, which
  // is indistinguishable from a quiet day with nothing to report.
  "CRON_SECRET",
  // Gates /api/reminders — the appointment-reminder and CRM sweeps. Unset,
  // the cron 401s and every "reminders text automatically" promise in the UI
  // quietly stops being true.
  "REMINDERS_SECRET",
  // Without it the idle timeout still works but the daily ceiling does not, and
  // a session-length control that is silently off is worse than none: you
  // believe sessions end and they do not.
  "SESSION_SECRET",
  // Gates /api/device-inquiries — the public intake the marketing site's
  // quote wizard POSTs to. Unset, the route 503s and every lead the website
  // generates silently fails to arrive.
  "DEVICE_INQUIRY_SITE_ORIGIN",
  "DEVICE_INQUIRY_SITE_KEY",
];

/**
 * A value that is obviously a stand-in rather than a credential.
 *
 * Env files get shipped with their placeholders still in them, and the failure
 * is always downstream and misleading. Cheaper to catch the string here.
 */
const PLACEHOLDER = /^(paste|replace|your|xxx+|todo|changeme|<)/i;
function placeholders(env) {
  return Object.entries(env)
    .filter(([k]) => /^(TWILIO|SICKW|SUPABASE|NEXT_PUBLIC|BUSINESS|OFFICE)_/.test(k))
    .filter(([, v]) => typeof v === "string" && PLACEHOLDER.test(v.trim()))
    .map(([k]) => k);
}

console.log("\n> Environment");
// Texting off means the TWILIO_* values are read by nothing, so an unfilled one
// is a note-to-self rather than a launch blocker. It becomes a blocker the
// moment the switch flips — which is the moment it would actually bite.
const textingOn = String(env.MESSAGING_ENABLED ?? "true").toLowerCase() !== "false";
for (const key of placeholders(env)) {
  const inert = key.startsWith("TWILIO_") && !textingOn;
  const said = `${key} is still a placeholder, not a real value`;
  if (inert) warn(`${said} (harmless for now — MESSAGING_ENABLED=false)`);
  else bad(said);
}
for (const key of REQUIRED) {
  if (env[key]) ok(key);
  else bad(`${key} is missing — the app cannot run without it`);
}
for (const { keys, why } of REQUIRED_EITHER) {
  const label = `${keys[0]} (or ${keys.slice(1).join(" / ")})`;
  if (keys.some((k) => env[k])) ok(label);
  else bad(`${label} is missing — ${why}`);
}
for (const key of REQUIRED_LIVE) {
  if (env[key]) ok(key);
  else if (LIVE) bad(`${key} is missing — required before real customers`);
  else warn(`${key} not set (fine for local, required with --live)`);
}

// Only when the switch is on. See REQUIRED_MESSAGING.
for (const key of REQUIRED_MESSAGING) {
  if (env[key]) ok(key);
  else if (!textingOn) warn(`${key} not set — fine, MESSAGING_ENABLED=false`);
  else if (LIVE) bad(`${key} is missing — required once MESSAGING_ENABLED is true`);
  else warn(`${key} not set (fine for local, required with --live)`);
}

/**
 * More either-or variables, live-only. This is the SILENTLY-OFF class — the
 * app keeps working, so nothing looks broken, and the thing you believed was
 * running never runs.
 */
const REQUIRED_LIVE_EITHER = [
  {
    keys: ["TWILIO_STATUS_CALLBACK_URL", "PUBLIC_BASE_URL"],
    // sendSms only appends StatusCallback when one of these is set. Without it
    // Twilio accepts every message and never reports back: rows stay "queued"
    // forever, so the "Not delivered" badge the thread already renders can never
    // appear, and a confirmation that never arrived reads exactly like one that did.
    why: "messages stay 'queued' forever and delivery failures never surface",
  },
];
for (const { keys, why } of REQUIRED_LIVE_EITHER) {
  const label = `${keys[0]} (or ${keys.slice(1).join(" / ")})`;
  if (keys.some((k) => env[k])) ok(label);
  else if (LIVE) bad(`${label} is missing — ${why}`);
  else warn(`${label} not set — ${why}`);
}

// NODE_ENV is set by the runtime, not by a person, so it is not something to
// document or to nag about being absent.
const RUNTIME_PROVIDED = new Set(["NODE_ENV", "VERCEL_ENV", "VERCEL_URL"]);
const documented = loadEnv(".env.example");
const undocumented = envVarsUsedInCode().filter(
  (k) => !RUNTIME_PROVIDED.has(k) && !(k in documented),
);
if (undocumented.length) {
  warn(`used in code but absent from .env.example: ${undocumented.join(", ")}`);
}

/* ---------------- operating mode ---------------- */

// Printed on EVERY run, not just --live. The mode changes what the app does
// with a real customer's IMEI and phone number, and the failure it prevents is
// somebody debugging "why does every phone come back clean" for an hour.
// Neither state is a problem, so both read as ok().
console.log("\n> Operating mode");
const sickwTest = !env.SICKW_API_KEY || String(env.SICKW_TEST_MODE) === "1";
if (sickwTest) {
  const said =
    "Sickw in TEST MODE — IMEI lookups answer canned fixtures" +
    (env.SICKW_API_KEY ? " (SICKW_TEST_MODE=1)" : " (no SICKW_API_KEY)");
  // Optional-with-test-mode: check-in works fully offline, every buying fact
  // hand-editable — so this never blocks a deploy, it just must be KNOWN.
  if (LIVE) warn(`${said}. Real devices will not be verified against GSMA/iCloud.`);
  else ok(said);
} else {
  ok("Sickw live — lookups spend from the prepaid balance");
  if (!env.SICKW_SERVICE_ID)
    bad("SICKW_API_KEY set but SICKW_SERVICE_ID missing — lookups will fail");
}
if (!textingOn) ok("MESSAGING_ENABLED=false — texting is off entirely");
else if (String(env.SMS_TEST_MODE) === "false") ok("texting LIVE — SMS_TEST_MODE=false");
else if (env.SMS_TEST_MODE != null && env.SMS_TEST_MODE !== "true") {
  // isSmsTestMode() accepts exactly "true" and "false"; anything else falls
  // back to NODE_ENV — so "1" reads as test mode under `next dev` and as a
  // REAL SEND under `next start`. This exact value once had every stage text
  // failing "Twilio is not configured" in a supposedly-muted environment.
  bad(
    `SMS_TEST_MODE=${env.SMS_TEST_MODE} is neither "true" nor "false" — the mode silently follows NODE_ENV instead`,
  );
} else ok("texting in test mode — messages are logged, never delivered");

/* ---------------- live-mode switches ---------------- */

if (LIVE) {
  console.log("\n> Live-mode switches");
  // The one that fails SILENTLY. Everything renders, nothing is delivered.
  //
  // MESSAGING_ENABLED=false outranks the test-mode check: there is no test
  // mode to report when the feature is switched off entirely, and printing
  // "texts are logged" would describe rows that will never exist.
  const messagingOff = String(env.MESSAGING_ENABLED ?? "true").toLowerCase() === "false";
  if (messagingOff) {
    warn(
      "MESSAGING_ENABLED=false — texting is OFF. No booking confirmations, no reminders, no " +
        "payment texts. Everything must be said out loud on the call. Set MESSAGING_ENABLED=true " +
        "(plus TWILIO_* and SMS_TEST_MODE=false) the day the Twilio number lands.",
    );
  } else if (String(env.SMS_TEST_MODE) === "false")
    ok("SMS_TEST_MODE=false — texts will really send");
  else bad("SMS_TEST_MODE is not false — every text will be logged and never delivered");

  if (String(env.TWILIO_VALIDATE_SIGNATURE) !== "false") ok("Twilio signature validation on");
  else bad("TWILIO_VALIDATE_SIGNATURE=false — anyone can forge an inbound webhook");
}

/* ---------------- schema ---------------- */

const DB = env.NEXT_PUBLIC_SUPABASE_URL;
// Either spelling — see REQUIRED_EITHER.
const KEY = env.SUPABASE_SECRET_KEY || env.SUPABASE_SERVICE_ROLE_KEY;

/**
 * Columns the code depends on, table by table. Not every column — the ones a
 * missing migration would take away, which is what actually breaks a deploy.
 */
const SCHEMA = {
  orders:
    "id,type,status,name,phone,items,est_value,paid_amount,payment_method,payout_reason,cancel_reason,cancelled_at,stop_outcome,stop_outcome_note,stop_outcome_at,checked_in_at,pickup_date,pickup_time,walk_in,paid_at,received_at,reminders_cancelled_at,activity,bought_by,created_by",
  messages: "id,body,direction,sent_by_role,read_at,delivery_status",
  profiles: "id,role,full_name,phone,active",
  calls: "id,call_sid,status,voicemail_url,handled_at,missed_texted_at,menu_at,menu_choice",
  inventory_lots:
    "id,order_id,item,category,quantity,imei,serial,carrier,grade,details,cog,rate,status,invoice_id,disposed_at,bought_by,sold_total,ship_total,fee_total,sold_channel,sold_at",
  invoices: "id,number,buyer_id,status,projected,shipping,paid,paid_method,paid_at,voided_at",
  buyers: "id,name,terms",
  catalog_items: "id,name,category,active",
  expenses: "id,spent_on,category,amount",
  balance_snapshots: "id,as_of,bank,cash",
  app_settings: "key,value",
};

/**
 * Columns the DTS ancestor had that this schema must NOT: labels, tracking,
 * drivers, addresses on orders; expiration/condition on lots. Their PRESENCE
 * means the database was cloned rather than converted — everything still
 * works, which is exactly why nothing else would ever say so.
 */
const SCHEMA_GONE = {
  orders: ["eta", "driver_id", "label_cost", "tracking", "tracking_status", "street"],
  inventory_lots: ["expiration", "condition"],
};

if (!DB || !KEY) {
  console.log("\n> Schema\n   (skipped — no Supabase credentials)");
  reportMeetupAddress(null, false);
} else {
  console.log("\n> Schema");
  const headers = { apikey: KEY, Authorization: `Bearer ${KEY}` };
  for (const [table, select] of Object.entries(SCHEMA)) {
    const r = await fetch(`${DB}/rest/v1/${table}?select=${encodeURIComponent(select)}&limit=1`, {
      headers,
    }).catch(() => null);
    if (!r) {
      bad(`${table}: could not reach Supabase`);
      continue;
    }
    if (r.ok) {
      ok(table);
      continue;
    }
    const body = await r.text();
    const missing = body.match(/column ([\w.]+) does not exist/)?.[1];
    bad(
      missing
        ? `${table}: ${missing} is missing — a migration has not been run`
        : `${table}: ${body.slice(0, 120)}`,
    );
  }

  // The absences. Probed one column at a time, because the whole point is
  // telling WHICH ghost is still in the schema.
  for (const [table, columns] of Object.entries(SCHEMA_GONE)) {
    const still = [];
    for (const column of columns) {
      const r = await fetch(`${DB}/rest/v1/${table}?select=${column}&limit=1`, { headers }).catch(
        () => null,
      );
      if (r?.ok) still.push(column);
    }
    if (still.length) {
      warn(
        `${table}: legacy column(s) still present — ${still.join(", ")} (schema not fully converted)`,
      );
    } else {
      ok(`${table}: legacy columns gone (${columns.join(", ")})`);
    }
  }

  // Every migration on disk, so "did I run them all" has an answer.
  const files = readdirSync("supabase/migrations")
    .filter((f) => f.endsWith(".sql"))
    .sort();
  console.log(`   (${files.length} migrations on disk, latest ${files[files.length - 1]})`);

  // The "mms" storage bucket, which no table probe can see. Missing, every
  // photo fails both ways: a sent one "couldn't be attached", a received one
  // arrives as an empty bubble. Public matters as much as present, because
  // Twilio fetches outbound media anonymously.
  const bucket = await fetch(`${DB}/storage/v1/bucket/mms`, { headers })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  if (!bucket) bad('storage bucket "mms" is missing — run supabase/migrations/0004_mms_bucket.sql');
  else if (!bucket.public)
    bad('storage bucket "mms" exists but is not public — Twilio cannot fetch outbound photos');
  else ok('storage bucket "mms" (public, photos both ways)');

  // The meetup address, as the app will actually resolve it: the setting
  // first, env second. A read failure (table missing) counts as "not set".
  const officeRows = await fetch(`${DB}/rest/v1/app_settings?key=eq.office_address&select=value`, {
    headers,
  })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);
  reportMeetupAddress(officeRows?.[0]?.value?.street || null, true);

  // Row-level security, proved from a real VA session — the least-privileged
  // login there is. Two directions, because both failures are silent:
  //
  //   - the VA CAN read orders (their whole job; RLS shut too tight strands
  //     them on empty screens that look like no work rather than no access)
  //   - the VA CANNOT read the money tables (expenses, balance snapshots)
  //
  // PROVED, NOT INFERRED. PostgREST answers 200 with an empty array when RLS
  // hides every row, so an empty table looks wide open and a full one shut.
  // The only honest test is the attack itself: put a row there with the
  // service key, read it with a real VA session, take the row away again.
  console.log("\n> Row-level security, as the VA");
  const testEnv = loadEnv(".env.test.local");
  const probeEmail = testEnv.SHOOT_EMAIL;
  const probePassword = testEnv.SHOOT_PASSWORD;
  const anon = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!probeEmail || !probePassword || !anon) {
    warn("no QA VA login (run npm run test-account) — RLS not verified");
  } else {
    const token = await fetch(`${DB}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: anon, "Content-Type": "application/json" },
      body: JSON.stringify({ email: probeEmail, password: probePassword }),
    })
      .then((r) => r.json())
      .then((j) => j.access_token)
      .catch(() => null);

    if (!token) warn("could not sign in as the QA VA — RLS not verified");
    else {
      const svcHeaders = {
        apikey: KEY,
        Authorization: `Bearer ${KEY}`,
        "Content-Type": "application/json",
        Prefer: "return=representation",
      };
      const probe = async (table, row, { expectVisible }) => {
        const created = await fetch(`${DB}/rest/v1/${table}`, {
          method: "POST",
          headers: svcHeaders,
          body: JSON.stringify(row),
        })
          .then((r) => (r.ok ? r.json() : null))
          .catch(() => null);
        if (!created?.[0]?.id) {
          warn(`${table}: could not place a probe row — RLS not verified`);
          return;
        }
        const seen = await fetch(`${DB}/rest/v1/${table}?select=id&id=eq.${created[0].id}`, {
          headers: { apikey: anon, Authorization: `Bearer ${token}` },
        })
          .then((r) => (r.ok ? r.json() : []))
          .catch(() => []);
        await fetch(`${DB}/rest/v1/${table}?id=eq.${created[0].id}`, {
          method: "DELETE",
          headers: svcHeaders,
        }).catch(() => {});
        if (expectVisible) {
          if (seen.length) ok(`${table}: the VA can read it (their job)`);
          else bad(`${table}: the VA CANNOT read it — RLS is shut too tight to work`);
        } else {
          if (seen.length)
            bad(`${table}: the VA can read it — the money tables must be admin-only`);
          else ok(`${table} is closed to the VA`);
        }
      };

      await probe(
        "orders",
        {
          type: "office",
          status: "cancelled",
          name: "ZZ Preflight Probe",
          phone: "9805550000",
          items: [],
          cancel_reason: "preflight probe",
        },
        { expectVisible: true },
      );
      await probe(
        "expenses",
        { spent_on: "1970-01-02", category: "preflight probe", amount: 1 },
        { expectVisible: false },
      );
      await probe(
        "balance_snapshots",
        { as_of: "1970-01-02", bank: 1, cash: 0, note: "preflight probe" },
        { expectVisible: false },
      );
    }
  }
}

/* ---------------- credentials ---------------- */

console.log("\n> Credentials");

if (env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN) {
  const auth = Buffer.from(`${env.TWILIO_ACCOUNT_SID}:${env.TWILIO_AUTH_TOKEN}`).toString("base64");
  const r = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${env.TWILIO_ACCOUNT_SID}.json`,
    { headers: { Authorization: `Basic ${auth}` } },
  ).catch(() => null);
  if (r?.ok) ok("Twilio credentials accepted");
  else bad(`Twilio rejected the credentials (${r?.status ?? "no response"})`);
} else warn("Twilio not configured — skipped");

/* ---------------- verdict ---------------- */

console.log("\n" + "=".repeat(60));
if (warnings.length) console.log(`${warnings.length} warning(s)`);
if (problems.length) {
  console.log(`❌ ${problems.length} problem(s) — do not deploy:`);
  for (const p of problems) console.log(`   - ${p}`);
  process.exit(1);
}
console.log(LIVE ? "✅ Ready for real customers." : "✅ Ready. Re-run with --live before launch.");
