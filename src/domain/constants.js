import { Clock, CheckCircle2, DollarSign } from "lucide-react";

/**
 * The ordered lifecycle an order moves through. Icons are attached here so
 * every stepper renders from the same source. Everything is handed over in
 * person — there is no label step and no carrier — so the ladder is short:
 * an appointment, the buy, the payout.
 */
export const STAGES = [
  { key: "awaiting", label: "Awaiting Meetup", icon: Clock },
  { key: "received", label: "Bought", icon: CheckCircle2 },
  { key: "paid", label: "Payment Sent", icon: DollarSign },
];

/**
 * Business days after a customer's FIRST successful payout before the review
 * ask is still considered due. Zero: the ask fires immediately, the moment
 * the order is marked paid (see attemptImmediateReviewAsk in
 * lib/reminder-sweep.js) - paid never sends any OTHER text, so there's no
 * back-to-back-ping to avoid. Kept at 0 rather than removed because the daily
 * sweep still reads it as a same-day safety net when the immediate send
 * fails (a thrown error, a walk-in created by script, etc).
 */
export const REVIEW_ASK_AFTER_BUSINESS_DAYS = 0;

/**
 * Where the review ask sends people. IN CODE rather than env: it is public,
 * it never varies by environment, and one less variable is one less thing to
 * forget on a redeploy.
 *
 * EMPTY UNTIL CLT BUYBACK HAS A GOOGLE LISTING LINK — and while it is empty,
 * needsReviewAsk() refuses for every order, so the sweep sends nothing. Paste
 * a Maps share link (or a https://g.page/r/.../review link to open the dialog
 * directly) to turn the feature on.
 */
export const GOOGLE_REVIEW_URL = "https://share.google/lDyLWEOKaKlykcZCK";

/**
 * Calendar days after the payout past which the review ask is silently
 * dropped. The ceiling is what makes shipping this feature safe: without it,
 * the first sweep after deploy would text every customer ever paid, and a
 * sweep outage would come back asking about a payout from three weeks ago -
 * both worse than no ask at all.
 */
export const REVIEW_ASK_WINDOW_DAYS = 7;

/**
 * Days after a no-show before the sweep asks the customer once whether they
 * still want to sell. The immediate "sorry we missed you" text goes when the
 * outcome is reported; this is the second touch for the ones who never
 * replied to it. Once, not repeating — after that it is a person's judgement
 * call, not a schedule's.
 */
export const FAILED_STOP_FOLLOW_UP_DAYS = 2;

/**
 * The automatic appointment reminders, in minutes on the BUSINESS clock
 * (America/New_York — never the server's, which is UTC when hosted). Each is
 * a "from" gate checked by a frequent cron, not a fire time: the sweep runs
 * every 15 minutes and each lane sends once it is past its gate, so 10:00
 * means "the first run after 10am Eastern", year-round, DST included — which
 * a fixed UTC cron hour can never say.
 */
// The day-before nudge: mid-morning, when a reply can still move the day.
export const APPT_DAY_BEFORE_FROM_MINUTES = 10 * 60;
// The morning-of nudge. 8am Eastern.
export const APPT_MORNING_FROM_MINUTES = 8 * 60;
// "See you in about 30 minutes." The window is wider than 30 because the
// cron ticks every 15 minutes: due once inside 40, so the send really lands
// 25-40 minutes ahead depending on where the tick falls.
export const APPT_SOON_WINDOW_MINUTES = 40;
// An appointment this close to the morning gate skips the morning text —
// the 30-minute one is about to say something better, and two texts in the
// same hour about one visit is how numbers get muted.
export const APPT_MORNING_SKIP_WITHIN_MINUTES = 60;

/**
 * Word a customer texts back to stop automated reminders for an open order.
 *
 * NOT "CANCEL", and nothing else off Twilio's default opt-out list either
 * (STOP, STOPALL, UNSUBSCRIBE, CANCEL, END, QUIT, REVOKE, OPTOUT). Those are
 * handled by the CARRIER before the webhook is ever called, on a bare long
 * code with no Messaging Service to customise them — so inviting "reply
 * CANCEL" would invite customers to block themselves from every message we
 * send, payout notices included, which is the exact opposite of what this
 * keyword means here (see domain/contact-status.js).
 *
 * Any replacement must stay off that list, stay inside GSM-7, and stay one
 * word: the inbound webhook matches the whole message body.
 */
export const REMINDER_OPT_OUT_KEYWORD = "PAUSE";

/**
 * Payment methods offered at payout and invoice settle — the FALLBACK list.
 * The live list is the `payment_methods` app_settings key, edited on
 * /settings; this constant is what a picker shows when that read fails, and
 * the seed the setting starts from. Cash first: it is the pitch on every ad.
 */
export const PAYMENT_METHODS = ["Cash", "Zelle", "Cash App", "Venmo", "PayPal", "Wire"];

/**
 * Where customers come from — the picker's presets, not a constraint. Free
 * text underneath, same shape as expense categories: the editor also offers
 * whatever the data already uses, so a new ad channel never needs a deploy.
 */
export const LEAD_SOURCES = [
  "Facebook ad",
  "TikTok",
  "Google",
  "Referral",
  "Repeat customer",
  "Walk-in",
  "Other",
];
