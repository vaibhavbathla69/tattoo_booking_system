import "dotenv/config";
import express from "express";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import db, { findOrCreateClient, createEnquiry, listEnquiries, getEnquiry, getEnquiryByToken, approveEnquiry, declineEnquiry, markEnquiryBooked } from "./db.js";
import { getAvailabilityForDate, isSlotBookable, getAllHours, PENDING_HOLD_MINUTES } from "./availability.js";
import { ownerChat, toolHandlers } from "./ai.js";
import { getLinkBySlug, isDateBookable } from "./links.js";
import { sendEnquiryNotification, sendEnquiryApproved } from "./email.js";
import { paymentsEnabled, depositAmountPounds, createDepositCheckout, constructWebhookEvent, demoMode } from "./payments.js";
import { buildIcs, calendarToken } from "./calendar.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

// Stripe webhooks must be verified against the RAW request body, so this route
// is registered with express.raw BEFORE the global express.json() below —
// otherwise the parsed body breaks signature verification.
app.post("/api/webhooks/stripe", express.raw({ type: "application/json" }), (req, res) => {
  let event;
  try {
    event = constructWebhookEvent(req.body, req.headers["stripe-signature"]);
  } catch (err) {
    console.error("Webhook signature verification failed:", err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  if (event.type === "checkout.session.completed") {
    const session = event.data.object;
    const bookingId = Number(session.metadata?.booking_id);
    if (bookingId) {
      // Only a still-pending booking gets confirmed — idempotent if Stripe
      // retries the webhook.
      db.prepare(
        `UPDATE bookings SET status = 'confirmed', deposit_paid = 1, amount_paid = ?
         WHERE id = ? AND status = 'pending'`
      ).run((session.amount_total || 0) / 100, bookingId);
    }
  } else if (event.type === "checkout.session.expired") {
    const bookingId = Number(event.data.object.metadata?.booking_id);
    if (bookingId) {
      db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ? AND status = 'pending'").run(bookingId);
    }
  }

  res.json({ received: true });
});

// Limit raised so bookings can carry a few downscaled reference photos
// (data URLs) in the JSON body.
app.use(express.json({ limit: "12mb" }));
// index:false so the "/" and "/book" routes below (which inject per-studio
// <title>/OG meta) own the booking page; static still serves every asset.
app.use(express.static(path.join(__dirname, "..", "public"), { index: false }));

// ---------------------------------------------------------------------------
// Per-studio link meta. app.js relabels the page live once it loads, but link
// crawlers (Slack/iMessage/WhatsApp) don't run JS — so we inject the studio's
// name into <title>/OG tags server-side, keyed off ?studio=. Mirrors the
// display names in public/demo-presets.js (only needed for the crawler meta).
// ---------------------------------------------------------------------------
const STUDIO_META = {
  "classic-tattoo": "Classic Tattoo Studio",
  "black-craft": "Black Craft Custom Tattoos",
  "hidden-gem-cardiff": "Kenzie Katz",
  "inked-byro": "Denver Fine Line Tattoos",
  "abigail-rae": "Abigail Rae",
};
const escHtml = (s) =>
  String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

function studioDisplayName(raw) {
  const v = (raw || "").toString().trim();
  if (!v) return null;
  const slug = v.toLowerCase().replace(/\s+/g, "-");
  return STUDIO_META[v] || STUDIO_META[slug] || v.replace(/\s+/g, " ").slice(0, 48);
}

const INDEX_HTML = fs.readFileSync(path.join(__dirname, "..", "public", "index.html"), "utf8");

function sendBookingPage(req, res) {
  const name = studioDisplayName(req.query.studio);
  if (!name) return res.type("html").send(INDEX_HTML); // base URL — leave defaults
  const title = `${name} — Book a Session`;
  const desc = `Book your appointment with ${name} online.`;
  const html = INDEX_HTML
    .replace(/<title>[^<]*<\/title>/, `<title>${escHtml(title)}</title>`)
    .replace(/(<meta property="og:title" content=")[^"]*(")/, `$1${escHtml(title)}$2`)
    .replace(/(<meta name="description" content=")[^"]*(")/, `$1${escHtml(desc)}$2`)
    .replace(/(<meta property="og:description" content=")[^"]*(")/, `$1${escHtml(desc)}$2`);
  res.type("html").send(html);
}

// The booking SPA — served for the root and the /book alias, both of which
// take ?studio=… (e.g. demo.yoursite.com/book?studio=Golden+Goose+Tattoo).
app.get("/", sendBookingPage);
app.get("/book", sendBookingPage);

// Abigail Rae — a dedicated landing hero (distinct from the booking SPA). Its
// "Book a Session" CTA flows into /book?studio=abigail-rae like the other
// presets. Reachable at the pretty /abigail as well as the raw file URL.
app.get("/abigail", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "abigail-rae.html"));
});

// Her "enquire first" form (the hero CTA lands here instead of the booking flow).
app.get("/abigail/enquire", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "abigail-enquire.html"));
});

// The customer's "book at the agreed price" page, reached from the approval
// email's unguessable token. Shows the agreed price + deposit, a date/time
// picker, and pays the deposit to confirm.
app.get("/enquiry/:token", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "enquiry-book.html"));
});

// Shareable booking links (e.g. an Instagram flash-drop link) land on the
// same customer SPA; app.js reads the slug from the URL and switches into
// link mode instead of the normal service/artist browse flow.
app.get("/b/:slug", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

// The client's consent form, opened from their unguessable per-booking link.
app.get("/consent/:token", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "consent.html"));
});

// ---------------------------------------------------------------------------
// Calendar feed (.ics) — the owner subscribes to this URL in Google/Apple
// Calendar and bookings appear on their phone, refreshing automatically.
// Calendar apps can't send auth headers, so the secret lives in the URL.
// ---------------------------------------------------------------------------
app.get("/api/calendar/:token", (req, res) => {
  const token = String(req.params.token || "").replace(/\.ics$/i, "");
  const expected = calendarToken();
  if (!expected || token !== expected) return res.status(404).send("Not found");
  res.set("Content-Type", "text/calendar; charset=utf-8");
  res.set("Cache-Control", "no-cache");
  res.send(buildIcs({ calendarName: "Studio Bookings" }));
});

// ---------------------------------------------------------------------------
// Public customer API
// ---------------------------------------------------------------------------

app.get("/api/services", (req, res) => {
  res.json(
    db
      .prepare(
        "SELECT id, name, duration_minutes, price, description, icon FROM services WHERE active = 1 ORDER BY sort_order"
      )
      .all()
  );
});

app.get("/api/artists", (req, res) => {
  res.json(
    db.prepare("SELECT id, name, styles, bio, rate_note FROM artists WHERE active = 1").all()
  );
});

app.get("/api/hours", (req, res) => {
  res.json(getAllHours());
});

// Public booking config so the UI knows whether to mention a deposit / demo.
app.get("/api/config", (req, res) => {
  res.json({
    payments_enabled: paymentsEnabled(),
    deposit_amount: paymentsEnabled() ? depositAmountPounds() : 0,
    demo_mode: demoMode(),
  });
});

app.get("/api/availability", (req, res) => {
  const { date, artist_id, service_id, duration } = req.query;
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: "A date (YYYY-MM-DD) is required." });
  }
  let slotDuration;
  if (service_id) {
    const service = db.prepare("SELECT duration_minutes FROM services WHERE id = ?").get(Number(service_id));
    if (!service) return res.status(400).json({ error: "Unknown service." });
    slotDuration = service.duration_minutes;
  } else if (duration) {
    slotDuration = Number(duration);
  }
  res.json(getAvailabilityForDate(date, artist_id ? Number(artist_id) : null, { slotDuration }));
});

// Public lookup for a shareable booking link (flash drops etc.) — only
// exposes booking-relevant details while the link is actually open, so a
// dead link doesn't leak the promotion's price/description forever.
app.get("/api/links/:slug", (req, res) => {
  const link = getLinkBySlug(req.params.slug);
  if (!link) return res.status(404).json({ error: "That booking link doesn't exist." });
  if (link.status !== "open") {
    return res.json({ slug: link.slug, title: link.title, status: link.status });
  }
  res.json({
    slug: link.slug,
    title: link.title,
    description: link.description,
    status: link.status,
    artist_id: link.artist_id,
    artist_name: link.artist_name,
    price: link.price,
    duration_minutes: link.duration_minutes,
    bookable_from: link.bookable_from,
    bookable_until: link.bookable_until,
  });
});

// "Enquire first" submissions — stored, not turned into a booking. The studio
// follows up to quote and agree a date before any deposit is taken.
app.post("/api/enquiries", (req, res) => {
  const { name, email, phone, description, tattoo_type, placement, size, budget, reference_images, studio } =
    req.body || {};

  if (!name || !name.trim()) return res.status(400).json({ error: "Name is required." });
  const hasEmail = email && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email);
  if (!hasEmail && !(phone && phone.trim()))
    return res.status(400).json({ error: "Leave an email or a phone number so Abigail can reply." });
  if (!description || !description.trim())
    return res.status(400).json({ error: "Tell Abigail a little about your idea." });

  const cleanImages = Array.isArray(reference_images)
    ? reference_images.filter((s) => typeof s === "string" && /^data:image\/(png|jpe?g|webp|gif);base64,/.test(s)).slice(0, 6)
    : [];

  const row = createEnquiry({
    name, email, phone, description, tattoo_type, placement, size, budget,
    reference_images: cleanImages, studio,
  });

  // Fire-and-forget owner alert — never blocks or breaks the submit.
  sendEnquiryNotification({
    name: row.name, email: row.email, phone: row.phone, description: row.description,
    tattoo_type: row.tattoo_type, placement: row.placement, size: row.size, budget: row.budget,
    referenceCount: cleanImages.length,
    studioName: studioDisplayName(studio) || undefined,
  }).catch((e) => console.error("enquiry notify:", e.message));

  res.status(201).json({ ok: true, enquiry_id: row.id });
});

// Default session length used when scheduling an approved enquiry (the exact
// length is agreed in the conversation; this just shapes the slot grid).
const ENQUIRY_SESSION_MINUTES = 120;

// Resolve a token to a still-valid approved-with-price enquiry, or null.
function bookableEnquiry(token) {
  const e = getEnquiryByToken(token);
  if (!e || e.status !== "approved" || e.quoted_price == null) return null;
  return e;
}

// Context for the customer's "book at the agreed price" page.
app.get("/api/enquiry-booking/:token", (req, res) => {
  const e = bookableEnquiry(req.params.token);
  if (!e) return res.status(404).json({ error: "This booking link isn't valid." });

  // If they've already booked and it wasn't cancelled, don't let them book twice.
  let alreadyBooked = false;
  if (e.booking_id) {
    const b = db.prepare("SELECT status FROM bookings WHERE id = ?").get(e.booking_id);
    alreadyBooked = !!b && b.status !== "cancelled";
  }
  const artist = db.prepare("SELECT * FROM artists WHERE active = 1 ORDER BY id LIMIT 1").get();

  res.json({
    studio: e.studio || "",
    studio_name: studioDisplayName(e.studio) || "Custom Tattoo Studio",
    client_name: e.name,
    email: e.email || "",
    description: e.description,
    tattoo_type: e.tattoo_type,
    agreed_price: e.quoted_price,
    reply_note: e.reply_note,
    deposit_amount: paymentsEnabled() ? depositAmountPounds() : 0,
    payments_enabled: paymentsEnabled(),
    demo_mode: demoMode(),
    artist_id: artist ? artist.id : null,
    duration_minutes: ENQUIRY_SESSION_MINUTES,
    already_booked: alreadyBooked,
  });
});

// Book the agreed piece: fixed price = the quote, standard deposit. Mirrors the
// /api/bookings deposit flow but the price/duration come from the enquiry, never
// the client.
app.post("/api/enquiry-booking/:token/book", async (req, res) => {
  const e = bookableEnquiry(req.params.token);
  if (!e) return res.status(404).json({ error: "This booking link isn't valid." });

  if (e.booking_id) {
    const existing = db.prepare("SELECT status FROM bookings WHERE id = ?").get(e.booking_id);
    if (existing && existing.status !== "cancelled")
      return res.status(409).json({ error: "This piece is already booked in." });
  }

  const { date, start_time, email } = req.body || {};
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return res.status(400).json({ error: "Pick a date." });
  if (!start_time || !/^\d{2}:\d{2}$/.test(start_time)) return res.status(400).json({ error: "Pick a time slot." });
  const todayStr = new Date().toLocaleDateString("en-CA"); // YYYY-MM-DD, local
  if (date < todayStr) return res.status(400).json({ error: "That date is in the past." });

  // The enquiry may have come in phone-only; a booking needs an email for the
  // receipt/confirmation, so accept one from the page if we don't have it.
  const contactEmail = (e.email || (email || "")).trim();
  if (!contactEmail || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(contactEmail))
    return res.status(400).json({ error: "A valid email is required for your confirmation." });

  const artist = db.prepare("SELECT * FROM artists WHERE active = 1 ORDER BY id LIMIT 1").get();
  if (!artist) return res.status(500).json({ error: "No artist configured." });

  const duration = ENQUIRY_SESSION_MINUTES;
  const check = isSlotBookable(date, artist.id, start_time, duration);
  if (!check.ok) return res.status(409).json({ error: "That slot has just been taken — please pick another." });

  const takePayment = paymentsEnabled();
  const initialStatus = takePayment ? "pending" : "confirmed";
  const clientRow = findOrCreateClient({ name: e.name, email: contactEmail, phone: e.phone });
  const consentToken = crypto.randomBytes(16).toString("hex");
  const styleLabel = "Custom tattoo";

  const result = db
    .prepare(
      `INSERT INTO bookings (client_id, artist_id, service_id, link_id, date, start_time, duration_minutes,
                             style, description, reference_notes, reference_images, price, status,
                             consent_token, source)
       VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?, '', ?, ?, ?, ?, 'web')`
    )
    .run(
      clientRow.id, artist.id, date, start_time, duration, styleLabel,
      e.description || "", e.reference_images || "[]", e.quoted_price, initialStatus, consentToken
    );
  const bookingId = result.lastInsertRowid;
  markEnquiryBooked(e.id, bookingId);

  if (!takePayment) {
    return res.status(201).json({ booked: true, booking_id: bookingId, consent_token: consentToken });
  }

  try {
    const session = await createDepositCheckout({
      bookingId, artistName: studioDisplayName(e.studio) || artist.name,
      styleLabel: `${styleLabel} (agreed £${e.quoted_price})`,
      date, startTime: start_time, returnStudio: e.studio || "",
    });
    db.prepare("UPDATE bookings SET checkout_session_id = ? WHERE id = ?").run(session.id, bookingId);
    return res.status(201).json({ checkout_url: session.url });
  } catch (err) {
    db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(bookingId);
    console.error("Stripe checkout error (enquiry):", err);
    return res.status(502).json({ error: "Couldn't start payment — please try again." });
  }
});

app.post("/api/bookings", async (req, res) => {
  const { name, email, phone, artist_id, service_id, date, start_time, description, reference_notes, reference_images, link_slug, studio } =
    req.body || {};

  // Keep only valid image data URLs, capped, so a booking can't carry junk or
  // an unbounded payload.
  const cleanImages = Array.isArray(reference_images)
    ? reference_images.filter((s) => typeof s === "string" && /^data:image\/(png|jpe?g|webp|gif);base64,/.test(s)).slice(0, 6)
    : [];

  if (!name || !name.trim()) return res.status(400).json({ error: "Name is required." });
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email))
    return res.status(400).json({ error: "A valid email is required." });
  if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date))
    return res.status(400).json({ error: "Pick a date." });
  if (!start_time || !/^\d{2}:\d{2}$/.test(start_time))
    return res.status(400).json({ error: "Pick a time slot." });
  if (!description || !description.trim())
    return res.status(400).json({ error: "Tell us what you'd like done." });

  const today = new Date();
  const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
  if (date < todayStr) return res.status(400).json({ error: "That date is in the past." });

  // Booking via a shareable link: artist, price, and duration all come from
  // the link record — never trust client-sent values for these, since the
  // link is what fixes the promotion's terms. Status is re-checked here,
  // synchronously with the insert below, so two simultaneous bookings can't
  // both slip in under a link's cap (Node/better-sqlite3 run this handler
  // to completion with no await between the check and the insert).
  let artist, service = null, link = null, fixedPrice = null, durationMinutes, styleLabel;

  if (link_slug) {
    link = getLinkBySlug(link_slug);
    if (!link) return res.status(404).json({ error: "That booking link doesn't exist." });
    if (link.status !== "open") {
      const messages = {
        full: "That offer is fully booked.",
        expired: "That link has expired.",
        paused: "That link isn't available right now.",
      };
      return res.status(409).json({ error: messages[link.status] || "That link isn't available." });
    }
    if (!isDateBookable(link, date)) {
      return res.status(400).json({ error: "This offer isn't bookable on that date." });
    }
    artist = db.prepare("SELECT * FROM artists WHERE id = ?").get(link.artist_id);
    durationMinutes = link.duration_minutes;
    fixedPrice = link.price;
    styleLabel = link.title;
  } else {
    if (!service_id) return res.status(400).json({ error: "Pick a service." });
    if (!artist_id) return res.status(400).json({ error: "Pick an artist." });
    artist = db.prepare("SELECT * FROM artists WHERE id = ? AND active = 1").get(Number(artist_id));
    if (!artist) return res.status(400).json({ error: "Unknown artist." });
    service = db.prepare("SELECT * FROM services WHERE id = ? AND active = 1").get(Number(service_id));
    if (!service) return res.status(400).json({ error: "Unknown service." });
    durationMinutes = service.duration_minutes;
    styleLabel = service.name;
  }

  const check = isSlotBookable(date, artist.id, start_time, durationMinutes);
  if (!check.ok)
    return res.status(409).json({ error: "That slot has just been taken — please pick another." });

  // When payments are on, the booking is inserted as 'pending' first — that
  // row holds the slot (availability counts active pendings) across the
  // redirect to Stripe, so the double-booking guarantee survives the async
  // gap. The webhook flips it to 'confirmed' once the deposit clears. With no
  // Stripe key, it inserts straight to 'confirmed' as before (no deposit).
  const takePayment = paymentsEnabled();
  const initialStatus = takePayment ? "pending" : "confirmed";

  const clientRow = findOrCreateClient({ name, email, phone });
  const consentToken = crypto.randomBytes(16).toString("hex");
  const result = db
    .prepare(
      `INSERT INTO bookings (client_id, artist_id, service_id, link_id, date, start_time, duration_minutes,
                             style, description, reference_notes, reference_images, price, status,
                             consent_token, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'web')`
    )
    .run(
      clientRow.id, artist.id, service ? service.id : null, link ? link.id : null,
      date, start_time, durationMinutes, styleLabel,
      description.trim(), (reference_notes || "").trim(), JSON.stringify(cleanImages), fixedPrice, initialStatus,
      consentToken
    );
  const bookingId = result.lastInsertRowid;

  if (!takePayment) {
    return res.status(201).json({
      booking_id: bookingId,
      artist: artist.name,
      service: styleLabel,
      date,
      start_time,
      consent_token: consentToken,
    });
  }

  try {
    const session = await createDepositCheckout({
      bookingId, artistName: artist.name, styleLabel, date, startTime: start_time,
      returnStudio: typeof studio === "string" ? studio.slice(0, 64) : "",
    });
    db.prepare("UPDATE bookings SET checkout_session_id = ? WHERE id = ?").run(session.id, bookingId);
    return res.status(201).json({ booking_id: bookingId, checkout_url: session.url });
  } catch (err) {
    // Release the held slot so a Stripe failure doesn't leave a ghost pending.
    db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(bookingId);
    console.error("Stripe checkout error:", err);
    return res.status(502).json({ error: "Couldn't start payment — please try again." });
  }
});

// Public status lookup for the post-checkout return page (no PII, just enough
// to tell the customer whether the deposit has landed yet).
app.get("/api/bookings/by-session/:sid", (req, res) => {
  const row = db
    .prepare("SELECT status, deposit_paid, consent_token FROM bookings WHERE checkout_session_id = ?")
    .get(req.params.sid);
  if (!row) return res.status(404).json({ error: "Not found." });
  res.json({ status: row.status, deposit_paid: !!row.deposit_paid, consent_token: row.consent_token });
});

// ---------------------------------------------------------------------------
// Client consent form — reached via the booking's unguessable consent_token.
// ---------------------------------------------------------------------------

app.get("/api/consent/:token", (req, res) => {
  const b = db
    .prepare(
      `SELECT b.date, b.start_time, b.style, b.consent_signed_at,
              a.name AS artist_name, c.name AS client_name
       FROM bookings b
       JOIN artists a ON a.id = b.artist_id
       JOIN clients c ON c.id = b.client_id
       WHERE b.consent_token = ?`
    )
    .get(req.params.token);
  if (!b) return res.status(404).json({ error: "That consent form link isn't valid." });
  res.json({
    client_name: b.client_name,
    artist_name: b.artist_name,
    style: b.style,
    date: b.date,
    start_time: b.start_time,
    signed: !!b.consent_signed_at,
    signed_at: b.consent_signed_at,
  });
});

app.post("/api/consent/:token", (req, res) => {
  const b = db.prepare("SELECT id FROM bookings WHERE consent_token = ?").get(req.params.token);
  if (!b) return res.status(404).json({ error: "That consent form link isn't valid." });

  const { answers, signature } = req.body || {};
  if (!answers || typeof answers !== "object")
    return res.status(400).json({ error: "Please complete the form." });
  if (typeof signature !== "string" || !/^data:image\/(png|jpe?g);base64,/.test(signature))
    return res.status(400).json({ error: "A signature is required." });

  db.prepare(
    `UPDATE bookings SET consent_json = ?, consent_signature = ?, consent_signed_at = datetime('now')
     WHERE id = ?`
  ).run(JSON.stringify(answers), signature, b.id);

  res.json({ ok: true });
});

// ---------------------------------------------------------------------------
// Owner auth + chat
// ---------------------------------------------------------------------------

const sessions = new Set();

app.post("/api/owner/login", (req, res) => {
  const password = (req.body || {}).password;
  const expected = process.env.OWNER_PASSWORD;
  if (!expected) return res.status(500).json({ error: "OWNER_PASSWORD is not configured." });
  if (password !== expected) return res.status(401).json({ error: "Wrong password." });
  const token = crypto.randomBytes(24).toString("hex");
  sessions.add(token);
  res.json({ token });
});

function requireOwner(req, res, next) {
  const token = (req.headers.authorization || "").replace(/^Bearer\s+/i, "");
  if (!sessions.has(token)) return res.status(401).json({ error: "Not logged in." });
  next();
}

app.post("/api/owner/chat", requireOwner, async (req, res) => {
  const { history, message } = req.body || {};
  if (!message || !message.trim())
    return res.status(400).json({ error: "Empty message." });
  if (!process.env.OPENROUTER_API_KEY)
    return res.status(500).json({
      error: "OPENROUTER_API_KEY is not set — add it to the .env file to enable the assistant.",
    });

  try {
    const safeHistory = Array.isArray(history)
      ? history
          .filter((m) => (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
          .slice(-40)
      : [];
    const result = await ownerChat(safeHistory, message.trim());
    res.json({ reply: result.text, form: result.form });
  } catch (err) {
    console.error("Owner chat error:", err);
    res.status(502).json({ error: "The assistant hit a problem. Try again." });
  }
});

// ---------------------------------------------------------------------------
// Owner dashboard data API — reuses the exact same handlers the AI calls,
// so the dashboard and the chat can never disagree about the data.
// ---------------------------------------------------------------------------

function handlerRoute(handler) {
  return (req, res) => {
    const result = handler({ ...req.query, ...req.params, ...req.body });
    if (result && result.error) return res.status(400).json(result);
    res.json(result);
  };
}

app.get("/api/owner/bookings", requireOwner, handlerRoute(toolHandlers.get_bookings));
app.get("/api/owner/availability", requireOwner, handlerRoute(toolHandlers.get_availability));
app.get("/api/owner/clients", requireOwner, handlerRoute(toolHandlers.find_clients));
app.get("/api/owner/clients/:client_id", requireOwner, (req, res) => {
  const result = toolHandlers.get_client({ client_id: Number(req.params.client_id) });
  if (result && result.error) return res.status(404).json(result);
  res.json(result);
});
app.put("/api/owner/clients/:client_id/notes", requireOwner, (req, res) => {
  const result = toolHandlers.update_client_notes({
    client_id: Number(req.params.client_id),
    notes: (req.body || {}).notes || "",
  });
  if (result && result.error) return res.status(400).json(result);
  res.json(result);
});
app.get("/api/owner/stats", requireOwner, handlerRoute(toolHandlers.get_stats));

// The private calendar-subscribe URL (owner-only — the token is the secret).
app.get("/api/owner/calendar-url", requireOwner, (req, res) => {
  const token = calendarToken();
  if (!token) return res.json({ url: null });
  const base = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
  res.json({ url: `${base}/api/calendar/${token}.ics` });
});

app.post("/api/owner/bookings", requireOwner, handlerRoute(toolHandlers.create_booking));
app.patch("/api/owner/bookings/:booking_id", requireOwner, (req, res) => {
  const result = toolHandlers.update_booking({
    ...req.body,
    booking_id: Number(req.params.booking_id),
  });
  if (result && result.error) return res.status(400).json(result);
  res.json(result);
});
app.post("/api/owner/bookings/:booking_id/cancel", requireOwner, (req, res) => {
  const result = toolHandlers.cancel_booking({ booking_id: Number(req.params.booking_id) });
  if (result && result.error) return res.status(400).json(result);
  res.json(result);
});

app.get("/api/owner/links", requireOwner, handlerRoute(toolHandlers.list_booking_links));
app.post("/api/owner/links", requireOwner, handlerRoute(toolHandlers.create_booking_link));
app.patch("/api/owner/links/:link_id", requireOwner, (req, res) => {
  const result = toolHandlers.update_booking_link({
    ...req.body,
    link_id: Number(req.params.link_id),
  });
  if (result && result.error) return res.status(400).json(result);
  res.json(result);
});

// ---- Enquiries (owner reviews, approves with a note/price, or declines) ----
// No email layer in this build, so approving records the quote/note and marks
// the enquiry approved; the artist follows up with the customer and shares the
// booking link (/book?studio=…) herself.
app.get("/api/owner/enquiries", requireOwner, (req, res) => {
  res.json({ enquiries: listEnquiries() });
});

app.post("/api/owner/enquiries/:id/approve", requireOwner, (req, res) => {
  const id = Number(req.params.id);
  const existing = getEnquiry(id);
  if (!existing) return res.status(404).json({ error: "Enquiry not found." });

  const { price, note } = req.body || {};
  const quotedPrice = price === "" || price == null ? null : Number(price);
  if (quotedPrice != null && !Number.isFinite(quotedPrice))
    return res.status(400).json({ error: "Price must be a number." });

  // With a price, mint an unguessable token → a personal "book at the agreed
  // price" page. Without one, we fall back to the generic studio booking link.
  const approveToken = quotedPrice != null ? crypto.randomBytes(16).toString("hex") : null;
  const updated = approveEnquiry(id, { quotedPrice, replyNote: (note || "").trim(), approveToken });

  // Email the customer their note/price + the link. Fire-and-forget.
  const base = (process.env.PUBLIC_BASE_URL || `${req.protocol}://${req.get("host")}`).replace(/\/+$/, "");
  const bookingUrl = updated.approve_token
    ? `${base}/enquiry/${updated.approve_token}`
    : (updated.studio ? `${base}/book?studio=${encodeURIComponent(updated.studio)}` : `${base}/book`);
  sendEnquiryApproved({
    name: updated.name, email: updated.email, note: updated.reply_note, price: updated.quoted_price,
    bookingUrl, studioName: studioDisplayName(updated.studio) || undefined,
  }).catch((e) => console.error("enquiry approve email:", e.message));

  res.json(updated);
});

app.post("/api/owner/enquiries/:id/decline", requireOwner, (req, res) => {
  const id = Number(req.params.id);
  if (!getEnquiry(id)) return res.status(404).json({ error: "Enquiry not found." });
  res.json(declineEnquiry(id));
});

// ---------------------------------------------------------------------------

// Release abandoned checkouts: a 'pending' booking whose payment window has
// passed is cancelled so the slot frees up in the UI. Availability already
// ignores stale pendings (see PENDING_HOLD_MINUTES), so this is housekeeping
// to keep the data tidy rather than a correctness requirement.
if (paymentsEnabled()) {
  setInterval(() => {
    try {
      db.prepare(
        `UPDATE bookings SET status = 'cancelled'
         WHERE status = 'pending' AND created_at < datetime('now', '-${PENDING_HOLD_MINUTES} minutes')`
      ).run();
    } catch (err) {
      console.error("Pending-sweep error:", err);
    }
  }, 5 * 60 * 1000).unref();
}

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Studio booking system running at http://localhost:${PORT}`);
  console.log(`  Customer booking:  http://localhost:${PORT}/`);
  console.log(`  Owner chat:        http://localhost:${PORT}/owner.html`);
  console.log(
    paymentsEnabled()
      ? `  Payments:          ON — £${depositAmountPounds()} deposit via Stripe`
      : `  Payments:          OFF — set STRIPE_SECRET_KEY to take deposits`
  );
  if (demoMode()) console.log(`  Demo mode:         ON — no real charge; "demo" banner shown`);
});
