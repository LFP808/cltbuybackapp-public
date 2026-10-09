import { readFileSync, existsSync } from "node:fs";

/**
 * Load the env files the scripts need, in precedence order.
 *
 *   already-exported process.env   (wins — a deliberate override)
 *   .env.test.local                (QA credentials, written by test-account)
 *   .env.local                     (the real app config)
 *
 * All are covered by the existing `.env*.local` gitignore rule, so none can
 * be committed by accident.
 *
 * Deliberately a tiny hand-rolled parser rather than a dependency: it reads
 * KEY=value, ignores comments and blanks, and strips surrounding quotes. Values
 * here include unquoted addresses with spaces, which is why the regex takes the
 * whole rest of the line.
 */
export function loadEnv() {
  for (const file of [".env.test.local", ".env.local"]) {
    if (!existsSync(file)) continue;
    for (const line of readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
      if (!m) continue;
      const [, key, raw] = m;
      if (process.env[key]) continue; // first loaded wins
      process.env[key] = raw.trim().replace(/^["']|["']$/g, "");
    }
  }
  return process.env;
}

/** Read a required variable, failing with a message that says how to fix it. */
export function required(key, hint) {
  const value = process.env[key];
  if (!value) throw new Error(`${key} is not set.${hint ? ` ${hint}` : ""}`);
  return value;
}
