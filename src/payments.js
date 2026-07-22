import Stripe from "stripe";

// Env values are .trim()'d throughout: hosting dashboards (Render et al) use
// multi-line inputs that quietly append a newline, which is invisible in the UI
// but corrupts URLs, keys and token comparisons.
const DEMO = /^(1|true|yes|on)$/i.test((process.env.DEMO_MODE || "").trim());
const KEY = (process.env.STRIPE_SECRET_KEY || "").trim();
const IS_LIVE_KEY = KEY.startsWith("sk_live_");

// Hard safety net: in demo mode we must never touch real money, so a live key
// is refused outright (payments fall back to instant confirmation instead).
if (DEMO && IS_LIVE_KEY) {
  console.warn(
    "[DEMO_MODE] A live Stripe key (sk_live_) is set — refusing to take real payments. " +
    "Use an sk_test_ key for the demo. Payments are disabled."
  );
}

// Payments are optional. With no STRIPE_SECRET_KEY the whole booking flow falls
// back to instant confirmation (no deposit) — so the app keeps working out of
// the box and only starts taking money once a (safe) key is configured.
const stripe = KEY && !(DEMO && IS_LIVE_KEY)
  ? new Stripe(KEY)
  : null;

export function paymentsEnabled() {
  return stripe !== null;
}

/** True when running as a no-real-charge sales demo. */
export function demoMode() {
  return DEMO;
}

/** Deposit taken to hold a booking, in whole pounds (config: DEPOSIT_AMOUNT). */
export function depositAmountPounds() {
  const n = Number(process.env.DEPOSIT_AMOUNT);
  return Number.isFinite(n) && n > 0 ? Math.round(n) : 50;
}

function baseUrl() {
  return (process.env.PUBLIC_BASE_URL || "http://localhost:3000").trim().replace(/\/+$/, "");
}

/**
 * Create a Stripe Checkout session for a booking's deposit. The booking must
 * already exist as 'pending'; its id travels in metadata so the webhook can
 * confirm it. Returns the Stripe session (use `.url` to redirect the customer).
 */
export async function createDepositCheckout({ bookingId, artistName, styleLabel, date, startTime, returnStudio }) {
  const base = baseUrl();
  // Carry the studio slug back through the redirect so the customer lands on
  // the SAME branded page (?studio=…) after paying or cancelling, instead of
  // dropping to the default studio.
  const studioQS = returnStudio ? `&studio=${encodeURIComponent(returnStudio)}` : "";
  return stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        quantity: 1,
        price_data: {
          currency: "gbp",
          unit_amount: depositAmountPounds() * 100,
          product_data: {
            name: `Deposit — ${styleLabel}`,
            description: `${artistName} · ${date} at ${startTime}`,
          },
        },
      },
    ],
    metadata: { booking_id: String(bookingId) },
    // Stripe substitutes the real session id into this placeholder on redirect.
    success_url: `${base}/?booking=paid&session_id={CHECKOUT_SESSION_ID}${studioQS}`,
    cancel_url: `${base}/?booking=cancelled&session_id={CHECKOUT_SESSION_ID}${studioQS}`,
  });
}

/** Verify and parse a webhook request. Throws if the signature is invalid. */
export function constructWebhookEvent(rawBody, signature) {
  return stripe.webhooks.constructEvent(rawBody, signature, (process.env.STRIPE_WEBHOOK_SECRET || "").trim());
}
