/**
 * A short two-note chime, synthesised rather than loaded.
 *
 * No audio file to ship, cache, or 404, and it stays audible in a noisy back
 * office without being shrill. Browsers refuse to start audio before a user
 * gesture, so the context is created lazily and resumed on demand — by the
 * time an alert fires, staff have invariably clicked something.
 *
 * Shared by every realtime alert (InboundAlerts, LeadAlerts) so the Web Audio
 * synthesis isn't duplicated and every chime sounds the same.
 *
 * @param {{ current: AudioContext | null }} ref a ref to reuse one context
 */
export async function chime(ref) {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (!Ctx) return;
    if (!ref.current) ref.current = new Ctx();
    const ctx = ref.current;
    if (ctx.state === "suspended") await ctx.resume();

    const now = ctx.currentTime;
    // Two rising notes (A5 -> C#6): reads as a notification, not an alarm.
    [880, 1108.73].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = freq;
      const start = now + i * 0.12;
      // Exponential decay — a hard stop clicks.
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.18, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.28);
      osc.connect(gain).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.3);
    });
  } catch {
    // Audio is a nicety; never let it break the page.
  }
}
