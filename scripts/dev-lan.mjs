/**
 * Start the dev server so a phone on the same Wi-Fi can reach it.
 *
 *   npm run dev:lan
 *
 * The app serves one hostname and decides nothing from it, so all this has to
 * do is bind Next to 0.0.0.0 and tell you the LAN address to type.
 *
 * This is for looking at the UI on a real device. It is NOT a public tunnel —
 * for anything that needs to reach you from the internet (Twilio webhooks),
 * use ngrok or a Cloudflare tunnel instead.
 */
import { networkInterfaces } from "node:os";
import { spawn } from "node:child_process";
import { createServer } from "node:net";

const PORT = process.env.PORT || "3000";

/** First non-internal IPv4 address — the one other devices can route to. */
function lanAddress() {
  for (const addrs of Object.values(networkInterfaces())) {
    for (const addr of addrs ?? []) {
      if (addr.family === "IPv4" && !addr.internal) return addr.address;
    }
  }
  return null;
}

/**
 * Next's own EADDRINUSE is a raw stack trace that doesn't say what to do about
 * it. Checking first turns "leftover dev server" into one actionable line —
 * and it is nearly always a leftover dev server.
 */
function portInUse(port) {
  return new Promise((resolve) => {
    const probe = createServer()
      .once("error", (err) => resolve(err.code === "EADDRINUSE"))
      .once("listening", () => probe.close(() => resolve(false)))
      .listen(port, "0.0.0.0");
  });
}

const ip = lanAddress();
if (!ip) {
  console.error("No LAN IP found — are you connected to Wi-Fi?");
  process.exit(1);
}

if (await portInUse(PORT)) {
  console.error(`
  Port ${PORT} is already in use — usually another dev server still running.

    See what has it   lsof -ti:${PORT}
    Stop it           lsof -ti:${PORT} | xargs kill
    Or use another    PORT=3001 npm run dev:lan
`);
  process.exit(1);
}

console.log(`
  Serving the app to your network.

    On this Mac      http://localhost:${PORT}  (unchanged)
    On your phone    http://${ip}:${PORT}

  Same Wi-Fi, no VPN. Stop with Ctrl-C.
`);

spawn("npx", ["next", "dev", "--hostname", "0.0.0.0", "--port", PORT], {
  stdio: "inherit",
}).on("exit", (code) => process.exit(code ?? 0));
