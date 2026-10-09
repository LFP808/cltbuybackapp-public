/**
 * Brand tokens lifted from the CLT Buyback marketing site — action blue over
 * an airy white page, DM Serif Display over DM Sans, mono for data. GREEN IS
 * RESERVED FOR MONEY: `cash` marks money-positive figures (net profit, paid,
 * inflows) and nothing else, which is why the action color is `accent`, not a
 * hue name — the DTS ancestor's forest green meant both "button" and "profit"
 * and the two could never be told apart.
 *
 * The shadcn-style UI kit layers on these same tokens, so every existing
 * utility class (text-ink, bg-accent-l, …) resolves unchanged. `bg` is the
 * SUNKEN gray (hovers, tracks, disabled fills) — the page itself is white.
 *
 * @type {import('tailwindcss').Config}
 */
module.exports = {
  darkMode: ["class"],
  content: ["./src/**/*.{js,jsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#f6f7f9",
        ink: "#16181d",
        muted: "#676c76",
        line: "#e7e8ec",
        ring: "#1a56db",
        destructive: "#c0392b",
        accent: {
          DEFAULT: "#1a56db",
          dark: "#123a94",
          l: "#eaf1fd",
        },
        // Money-positive only. Applying it to anything that isn't cash melts
        // the one signal the P/L page depends on.
        cash: {
          DEFAULT: "#1e8a4c",
          l: "#d3eedd",
        },
        // Status palette — awaiting stays amber (attention), received rides
        // the accent (work in motion), paid is settled money so it is cash.
        status: {
          awaiting: "#8A6A1E",
          "awaiting-bg": "#F1E9D8",
          sent: "#2A6E8C",
          "sent-bg": "#E4EEF4",
          received: "#1a56db",
          "received-bg": "#eaf1fd",
          paid: "#1e8a4c",
          "paid-bg": "#d3eedd",
        },
      },
      fontFamily: {
        sans: ["var(--font-dm-sans)", "DM Sans", "system-ui", "sans-serif"],
        serif: ["var(--font-dm-serif)", "DM Serif Display", "Georgia", "serif"],
        mono: ["var(--font-mono)", "IBM Plex Mono", "monospace"],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 4px)",
        sm: "calc(var(--radius) - 6px)",
        card: "14px",
        pill: "24px",
      },
      boxShadow: {
        xs: "0 1px 2px rgba(22, 24, 29, 0.05)",
        card: "0 1px 2px rgba(22, 24, 29, 0.04), 0 1px 3px rgba(22, 24, 29, 0.04)",
        pop: "0 4px 12px rgba(22, 24, 29, 0.10), 0 2px 4px rgba(22, 24, 29, 0.06)",
      },
      keyframes: {
        "fade-in": {
          from: { opacity: "0", transform: "translateY(4px)" },
          to: { opacity: "1", transform: "translateY(0)" },
        },
        "delayed-in": {
          from: { opacity: "0" },
          to: { opacity: "1" },
        },
      },
      animation: {
        "fade-in": "fade-in 0.25s cubic-bezier(0.16, 1, 0.3, 1) both",
        // `both` holds opacity 0 through the delay, so a navigation that
        // resolves quickly never paints the spinner at all.
        //
        // Short delay on purpose. The nav overlay covers click -> commit with no
        // delay of its own, and this covers commit -> content; a longer pause
        // here would put a blank gap between the two, which is the thing they
        // exist to prevent.
        "delayed-in": "delayed-in 0.15s ease-out 0.08s both",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};
