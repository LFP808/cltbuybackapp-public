/**
 * Command-line arguments, parsed the same way everywhere.
 *
 * This block was copy-pasted into eight scripts. Defaults differ per script and
 * that is fine — each passes its own — but the parser itself had drifted into
 * eight chances to fix a bug in one place and not the others.
 */
const args = process.argv.slice(2);

/** `--name=value`, or `fallback` when the flag is absent. */
export function flag(name, fallback = null) {
  const prefix = `--${name}=`;
  const hit = args.find((a) => a.startsWith(prefix));
  // slice, not split("="): `--fill="Phone::a=b"` is a real argument shape that
  // shoot.mjs accepts, and split would have handed back "Phone::a".
  return hit ? hit.slice(prefix.length) : fallback;
}

/** A bare `--name` switch. */
export function has(name) {
  return args.includes(`--${name}`);
}

/** The first non-flag argument — a route path, usually. */
export function positional(fallback = null) {
  return args.find((a) => !a.startsWith("--")) ?? fallback;
}

export { args };
