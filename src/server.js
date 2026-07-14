import "dotenv/config";
import express from "express";
import crypto from "crypto";
import path from "path";
import { fileURLToPath } from "url";
import db, { findOrCreateClient } from "./db.js";
import { getAvailabilityForDate, isSlotBookable, getAllHours, PENDING_HOLD_MINUTES } from "./availability.js";
import { ownerChat, toolHandlers } from "./ai.js";
import { getLinkBySlug, isDateBookable } from "./links.js";
import { paymentsEnabled, depositAmountPounds, createDepositCheckout, constructWebhookEvent, demoMode } from "./payments.js";

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
app.use(express.static(path.join(__dirname, "..", "public")));

// Shareable booking links (e.g. an Instagram flash-drop link) land on the
// same customer SPA; app.js reads the slug from the URL and switches into
// link mode instead of the normal service/artist browse flow.
app.get("/b/:slug", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
});

// /book is an alias for the booking page so demo links read nicely, e.g.
// demo.yoursite.com/book?studio=Golden+Goose+Tattoo (app.js reads ?studio=).
app.get("/book", (req, res) => {
  res.sendFile(path.join(__dirname, "..", "public", "index.html"));
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

app.post("/api/bookings", async (req, res) => {
  const { name, email, phone, artist_id, service_id, date, start_time, description, reference_notes, reference_images, link_slug } =
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
  const result = db
    .prepare(
      `INSERT INTO bookings (client_id, artist_id, service_id, link_id, date, start_time, duration_minutes,
                             style, description, reference_notes, reference_images, price, status, source)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'web')`
    )
    .run(
      clientRow.id, artist.id, service ? service.id : null, link ? link.id : null,
      date, start_time, durationMinutes, styleLabel,
      description.trim(), (reference_notes || "").trim(), JSON.stringify(cleanImages), fixedPrice, initialStatus
    );
  const bookingId = result.lastInsertRowid;

  if (!takePayment) {
    return res.status(201).json({
      booking_id: bookingId,
      artist: artist.name,
      service: styleLabel,
      date,
      start_time,
    });
  }

  try {
    const session = await createDepositCheckout({
      bookingId, artistName: artist.name, styleLabel, date, startTime: start_time,
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
    .prepare("SELECT status, deposit_paid FROM bookings WHERE checkout_session_id = ?")
    .get(req.params.sid);
  if (!row) return res.status(404).json({ error: "Not found." });
  res.json({ status: row.status, deposit_paid: !!row.deposit_paid });
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
