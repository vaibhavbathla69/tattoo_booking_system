import OpenAI from "openai";
import db, { findOrCreateClient } from "./db.js";
import { getAvailabilityForDate, isSlotBookable, getAllHours } from "./availability.js";
import { createBookingLink, listBookingLinks, updateBookingLink } from "./links.js";

// Any model slug from https://openrouter.ai/models — override via OPENROUTER_MODEL.
const MODEL = process.env.OPENROUTER_MODEL || "anthropic/claude-3.7-sonnet";
const MAX_LOOP_ITERATIONS = 12;

const client = new OpenAI({
  baseURL: "https://openrouter.ai/api/v1",
  // Placeholder lets the client construct even before a key is set — the chat
  // endpoint checks OPENROUTER_API_KEY and refuses the call with a clear message.
  apiKey: process.env.OPENROUTER_API_KEY || "not-set",
  defaultHeaders: {
    "HTTP-Referer": "http://localhost:3000",
    "X-Title": "Black Craft Custom Tattoos Studio Assistant",
  },
});

// Temporary cost-visibility logging for testing — prints per-call token usage
// and a running session total to the console. Pricing below is for
// deepseek/deepseek-v4-flash specifically; update these two constants (or
// just ignore the $ figures) if OPENROUTER_MODEL changes to something else.
const PRICE_PER_1M_INPUT = 0.09;
const PRICE_PER_1M_OUTPUT = 0.18;
let usageTotals = { calls: 0, promptTokens: 0, completionTokens: 0, cost: 0 };

function logUsage(usage) {
  if (!usage) return;
  const inTok = usage.prompt_tokens ?? 0;
  const outTok = usage.completion_tokens ?? 0;
  const cost = (inTok / 1e6) * PRICE_PER_1M_INPUT + (outTok / 1e6) * PRICE_PER_1M_OUTPUT;

  usageTotals.calls += 1;
  usageTotals.promptTokens += inTok;
  usageTotals.completionTokens += outTok;
  usageTotals.cost += cost;

  console.log(
    `[ai usage] call #${usageTotals.calls}: ${inTok} in / ${outTok} out tokens ` +
    `(~$${cost.toFixed(6)}) — session total: ${usageTotals.calls} calls, ` +
    `${usageTotals.promptTokens} in / ${usageTotals.completionTokens} out tokens, ~$${usageTotals.cost.toFixed(4)}`
  );
}

// ---------------------------------------------------------------------------
// Tool implementations
// ---------------------------------------------------------------------------

function resolveArtist(nameOrId) {
  if (typeof nameOrId === "number") {
    return db.prepare("SELECT * FROM artists WHERE id = ?").get(nameOrId);
  }
  return db
    .prepare("SELECT * FROM artists WHERE lower(name) LIKE lower(?) AND active = 1")
    .get(`%${nameOrId}%`);
}

const BOOKING_SELECT = `
  SELECT b.id, b.date, b.start_time, b.duration_minutes, b.style, b.description,
         b.status, b.deposit_paid, b.price, b.notes, b.source,
         b.reference_notes, b.reference_images,
         b.consent_signed_at, b.consent_json, b.consent_signature, b.consent_token,
         a.id AS artist_id, a.name AS artist_name, c.id AS client_id, c.name AS client_name,
         c.email AS client_email, c.phone AS client_phone
  FROM bookings b
  JOIN artists a ON a.id = b.artist_id
  JOIN clients c ON c.id = b.client_id`;

export const toolHandlers = {
  list_artists() {
    return db
      .prepare("SELECT id, name, styles, bio FROM artists WHERE active = 1")
      .all();
  },

  get_studio_hours() {
    const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    return getAllHours().map((h) => ({
      day: days[h.day_of_week],
      closed: !!h.closed,
      open: h.open_time,
      close: h.close_time,
    }));
  },

  get_bookings({ start_date, end_date, artist, status, client_query }) {
    let sql = `${BOOKING_SELECT} WHERE b.date >= ? AND b.date <= ?`;
    const params = [start_date, end_date || start_date];
    if (artist) {
      const a = resolveArtist(artist);
      if (!a) return { error: `No artist found matching "${artist}".` };
      sql += " AND b.artist_id = ?";
      params.push(a.id);
    }
    if (status) {
      sql += " AND b.status = ?";
      params.push(status);
    } else {
      sql += " AND b.status != 'cancelled'";
    }
    if (client_query) {
      sql += " AND (lower(c.name) LIKE lower(?) OR lower(c.email) LIKE lower(?))";
      params.push(`%${client_query}%`, `%${client_query}%`);
    }
    sql += " ORDER BY b.date, b.start_time";
    return db.prepare(sql).all(...params);
  },

  get_availability({ date, artist }) {
    let artistId = null;
    if (artist) {
      const a = resolveArtist(artist);
      if (!a) return { error: `No artist found matching "${artist}".` };
      artistId = a.id;
    }
    return getAvailabilityForDate(date, artistId);
  },

  find_clients({ query, inactive_months, style }) {
    let sql = `
      SELECT c.id, c.name, c.email, c.phone, c.notes,
             COUNT(b.id) AS total_bookings,
             MAX(CASE WHEN b.status = 'completed' THEN b.date END) AS last_visit
      FROM clients c
      LEFT JOIN bookings b ON b.client_id = c.id AND b.status != 'cancelled'
      WHERE 1=1`;
    const params = [];
    if (query) {
      sql += " AND (lower(c.name) LIKE lower(?) OR lower(c.email) LIKE lower(?))";
      params.push(`%${query}%`, `%${query}%`);
    }
    if (style) {
      sql += ` AND c.id IN (
        SELECT client_id FROM bookings
        WHERE lower(style) LIKE lower(?) OR lower(description) LIKE lower(?))`;
      params.push(`%${style}%`, `%${style}%`);
    }
    sql += " GROUP BY c.id";
    if (inactive_months) {
      sql += ` HAVING last_visit IS NULL OR last_visit <= date('now', ?)`;
      params.push(`-${inactive_months} months`);
    }
    sql += " ORDER BY c.name LIMIT 100";
    return db.prepare(sql).all(...params);
  },

  get_client({ client_id, name, email }) {
    let c = null;
    if (client_id) {
      c = db.prepare("SELECT * FROM clients WHERE id = ?").get(client_id);
    } else if (email) {
      c = db.prepare("SELECT * FROM clients WHERE lower(email) = lower(?)").get(email);
    } else if (name) {
      c = db.prepare("SELECT * FROM clients WHERE lower(name) LIKE lower(?)").get(`%${name}%`);
    }
    if (!c) return { error: "Client not found." };
    const history = db
      .prepare(`${BOOKING_SELECT} WHERE b.client_id = ? ORDER BY b.date DESC`)
      .all(c.id);
    return { ...c, bookings: history };
  },

  update_client_notes({ client_id, notes }) {
    const c = db.prepare("SELECT * FROM clients WHERE id = ?").get(client_id);
    if (!c) return { error: "Client not found." };
    db.prepare("UPDATE clients SET notes = ? WHERE id = ?").run(notes, client_id);
    return { ok: true, client_id, notes };
  },

  get_stats({ start_date, end_date }) {
    const range = [start_date, end_date];
    const totals = db
      .prepare(
        `SELECT COUNT(*) AS total_bookings,
                SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completed,
                SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelled,
                SUM(CASE WHEN status = 'no_show' THEN 1 ELSE 0 END) AS no_shows,
                SUM(CASE WHEN status = 'completed' THEN COALESCE(price, 0) ELSE 0 END) AS revenue
         FROM bookings WHERE date >= ? AND date <= ?`
      )
      .get(...range);
    const byArtist = db
      .prepare(
        `SELECT a.id AS artist_id, a.name AS artist, COUNT(*) AS bookings,
                SUM(CASE WHEN b.status = 'completed' THEN COALESCE(b.price, 0) ELSE 0 END) AS revenue
         FROM bookings b JOIN artists a ON a.id = b.artist_id
         WHERE b.date >= ? AND b.date <= ? AND b.status != 'cancelled'
         GROUP BY a.id ORDER BY bookings DESC`
      )
      .all(...range);
    const byStyle = db
      .prepare(
        `SELECT style, COUNT(*) AS bookings FROM bookings
         WHERE date >= ? AND date <= ? AND status != 'cancelled' AND style != ''
         GROUP BY lower(style) ORDER BY bookings DESC LIMIT 10`
      )
      .all(...range);
    return { ...totals, by_artist: byArtist, by_style: byStyle };
  },

  create_booking(input) {
    const a = resolveArtist(input.artist);
    if (!a) return { error: `No artist found matching "${input.artist}".` };
    const duration = input.duration_minutes || 60;
    const check = isSlotBookable(input.date, a.id, input.start_time, duration);
    if (!check.ok) return { error: check.reason };

    const c = findOrCreateClient({
      name: input.client_name,
      email: input.client_email,
      phone: input.client_phone,
    });
    const result = db
      .prepare(
        `INSERT INTO bookings (client_id, artist_id, date, start_time, duration_minutes,
                               style, description, deposit_paid, notes, source)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'owner')`
      )
      .run(
        c.id, a.id, input.date, input.start_time, duration,
        input.style || "", input.description || "",
        input.deposit_paid ? 1 : 0, input.notes || ""
      );
    return db
      .prepare(`${BOOKING_SELECT} WHERE b.id = ?`)
      .get(result.lastInsertRowid);
  },

  update_booking(input) {
    const b = db.prepare("SELECT * FROM bookings WHERE id = ?").get(input.booking_id);
    if (!b) return { error: "Booking not found." };

    const fields = {};
    if (input.date) fields.date = input.date;
    if (input.start_time) fields.start_time = input.start_time;
    if (input.duration_minutes) fields.duration_minutes = input.duration_minutes;
    if (input.style !== undefined) fields.style = input.style;
    if (input.status) fields.status = input.status;
    if (input.deposit_paid !== undefined) fields.deposit_paid = input.deposit_paid ? 1 : 0;
    if (input.price !== undefined) fields.price = input.price;
    if (input.notes !== undefined) fields.notes = input.notes;
    if (input.artist) {
      const a = resolveArtist(input.artist);
      if (!a) return { error: `No artist found matching "${input.artist}".` };
      fields.artist_id = a.id;
    }
    if (Object.keys(fields).length === 0) return { error: "No fields to update." };

    // If the appointment is moving, verify the new slot is free
    const movesSlot = fields.date || fields.start_time || fields.duration_minutes || fields.artist_id;
    const willBeActive = (fields.status || b.status) === "confirmed";
    if (movesSlot && willBeActive) {
      // Temporarily exclude this booking from the clash check by cancelling it in a transaction
      const check = db.transaction(() => {
        db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(b.id);
        const r = isSlotBookable(
          fields.date || b.date,
          fields.artist_id || b.artist_id,
          fields.start_time || b.start_time,
          fields.duration_minutes || b.duration_minutes
        );
        db.prepare("UPDATE bookings SET status = ? WHERE id = ?").run(b.status, b.id);
        return r;
      })();
      if (!check.ok) return { error: check.reason };
    }

    const setClause = Object.keys(fields).map((k) => `${k} = ?`).join(", ");
    db.prepare(`UPDATE bookings SET ${setClause} WHERE id = ?`).run(
      ...Object.values(fields), b.id
    );
    return db.prepare(`${BOOKING_SELECT} WHERE b.id = ?`).get(b.id);
  },

  cancel_booking({ booking_id }) {
    const b = db.prepare("SELECT * FROM bookings WHERE id = ?").get(booking_id);
    if (!b) return { error: "Booking not found." };
    db.prepare("UPDATE bookings SET status = 'cancelled' WHERE id = ?").run(booking_id);
    return { ok: true, cancelled_booking_id: booking_id };
  },

  create_booking_link({ title, description, artist, price, duration_minutes, max_bookings, expires_at, bookable_from, bookable_until }) {
    if (!title || !title.trim()) return { error: "The link needs a title." };
    const a = resolveArtist(artist);
    if (!a) return { error: `No artist found matching "${artist}".` };
    if (price == null || price < 0) return { error: "Price is required for a booking link." };
    if (!duration_minutes || duration_minutes <= 0) return { error: "Duration is required for a booking link." };
    if (bookable_from && bookable_until && bookable_from > bookable_until) {
      return { error: "bookable_from must be on or before bookable_until." };
    }

    const link = createBookingLink({
      title: title.trim(),
      description: description || "",
      artist_id: a.id,
      price,
      duration_minutes,
      max_bookings: max_bookings ?? null,
      expires_at: expires_at || null,
      bookable_from: bookable_from || null,
      bookable_until: bookable_until || null,
    });
    return { ...link, url: `/b/${link.slug}` };
  },

  list_booking_links() {
    return listBookingLinks().map((l) => ({ ...l, url: `/b/${l.slug}` }));
  },

  // Not a data operation — the agentic loop intercepts this call and ends the
  // turn early, so this handler never actually runs. It exists so the tool
  // has a real name/schema pair like every other tool.
  open_booking_link_form() {
    return { ok: true };
  },

  update_booking_link({ link_id, slug, active, max_bookings, expires_at, price, duration_minutes, title, description, artist, bookable_from, bookable_until }) {
    let id = link_id;
    if (!id && slug) {
      const bySlug = db.prepare("SELECT id FROM booking_links WHERE slug = ?").get(slug);
      if (!bySlug) return { error: `No booking link found with slug "${slug}".` };
      id = bySlug.id;
    }
    if (!id) return { error: "Specify which link to update by link_id or slug." };

    let artist_id;
    if (artist !== undefined) {
      const a = resolveArtist(artist);
      if (!a) return { error: `No artist found matching "${artist}".` };
      artist_id = a.id;
    }

    const updated = updateBookingLink(id, {
      active, max_bookings, expires_at, price, duration_minutes, title, description, artist_id, bookable_from, bookable_until,
    });
    if (!updated) return { error: "Booking link not found." };
    return { ...updated, url: `/b/${updated.slug}` };
  },
};

// ---------------------------------------------------------------------------
// Tool schemas
// ---------------------------------------------------------------------------

const tools = [
  {
    name: "list_artists",
    description: "List the studio's artists with their styles and bios.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_studio_hours",
    description: "Get the studio's opening hours for each day of the week.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "get_bookings",
    description:
      "List bookings in a date range. Call this to answer any question about what is scheduled on a day, week or period. Cancelled bookings are excluded unless status is set explicitly.",
    input_schema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "Range start, YYYY-MM-DD" },
        end_date: { type: "string", description: "Range end inclusive, YYYY-MM-DD. Defaults to start_date." },
        artist: { type: "string", description: "Filter by artist name (partial match ok)" },
        status: { type: "string", enum: ["confirmed", "cancelled", "completed", "no_show"] },
        client_query: { type: "string", description: "Filter by client name or email (partial match)" },
      },
      required: ["start_date"],
    },
  },
  {
    name: "get_availability",
    description:
      "Get free appointment slots for a date, for one artist or all artists. Accounts for opening hours and existing booking durations.",
    input_schema: {
      type: "object",
      properties: {
        date: { type: "string", description: "YYYY-MM-DD" },
        artist: { type: "string", description: "Artist name; omit for all artists" },
      },
      required: ["date"],
    },
  },
  {
    name: "find_clients",
    description:
      "Search the client database. Use for marketing-style queries: clients matching a name/email, clients who had a given style, or clients inactive for N months.",
    input_schema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Partial name or email" },
        inactive_months: { type: "integer", description: "Only clients with no completed visit in the last N months" },
        style: { type: "string", description: "Only clients who have had a booking matching this style/description keyword" },
      },
    },
  },
  {
    name: "get_client",
    description:
      "Get one client's full profile: contact details, owner notes, and complete booking history. Look up by id, email, or partial name.",
    input_schema: {
      type: "object",
      properties: {
        client_id: { type: "integer" },
        name: { type: "string" },
        email: { type: "string" },
      },
    },
  },
  {
    name: "update_client_notes",
    description: "Replace the owner's notes on a client record.",
    input_schema: {
      type: "object",
      properties: {
        client_id: { type: "integer" },
        notes: { type: "string" },
      },
      required: ["client_id", "notes"],
    },
  },
  {
    name: "get_stats",
    description:
      "Business stats for a date range: booking counts by status, revenue from completed sessions, busiest artists, most popular styles.",
    input_schema: {
      type: "object",
      properties: {
        start_date: { type: "string", description: "YYYY-MM-DD" },
        end_date: { type: "string", description: "YYYY-MM-DD" },
      },
      required: ["start_date", "end_date"],
    },
  },
  {
    name: "create_booking",
    description:
      "Create a new booking. Reuses the existing client record when name and email match a previous booking. Fails if the slot is taken or outside opening hours.",
    input_schema: {
      type: "object",
      properties: {
        client_name: { type: "string" },
        client_email: { type: "string" },
        client_phone: { type: "string" },
        artist: { type: "string", description: "Artist name" },
        date: { type: "string", description: "YYYY-MM-DD" },
        start_time: { type: "string", description: "HH:MM 24h" },
        duration_minutes: { type: "integer", description: "Defaults to 60" },
        style: { type: "string" },
        description: { type: "string" },
        deposit_paid: { type: "boolean" },
        notes: { type: "string" },
      },
      required: ["client_name", "artist", "date", "start_time"],
    },
  },
  {
    name: "update_booking",
    description:
      "Update an existing booking: move time/date/artist, change status (completed, no_show, confirmed), record deposit, set price, or edit notes. Verifies the new slot is free when moving. Only call after the owner has confirmed the change when it modifies the appointment itself.",
    input_schema: {
      type: "object",
      properties: {
        booking_id: { type: "integer" },
        date: { type: "string" },
        start_time: { type: "string" },
        duration_minutes: { type: "integer" },
        artist: { type: "string" },
        style: { type: "string" },
        status: { type: "string", enum: ["confirmed", "cancelled", "completed", "no_show"] },
        deposit_paid: { type: "boolean" },
        price: { type: "number" },
        notes: { type: "string" },
      },
      required: ["booking_id"],
    },
  },
  {
    name: "cancel_booking",
    description:
      "Cancel a booking, freeing its slot. NEVER call this until the owner has explicitly confirmed the specific booking in this conversation.",
    input_schema: {
      type: "object",
      properties: { booking_id: { type: "integer" } },
      required: ["booking_id"],
    },
  },
  {
    name: "open_booking_link_form",
    description:
      "Show the owner a fill-in-the-boxes form for creating a shareable booking link (e.g. a flash sheet drop), instead of asking for each detail one at a time in the chat. Call this as soon as the owner expresses intent to create a link or run a sale — even with zero details given. If they already mentioned some details (artist, price, duration, 'today only', a cap, etc.) in their message, pass those along as pre-fill values so the form opens partly filled in; leave anything unmentioned out entirely so the field starts blank. The owner completes and submits the form themselves — you do not create the link.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short name shown to customers, e.g. 'Summer Flash Sheet'" },
        description: { type: "string", description: "What's on offer — sizing, placement, subject matter" },
        artist: { type: "string", description: "Artist name, if mentioned" },
        price: { type: "number" },
        duration_minutes: { type: "integer" },
        max_bookings: { type: "integer", description: "Cap on total bookings this link accepts, if mentioned" },
        today_only: { type: "boolean", description: "True if the owner said the sale/offer is for today only" },
        bookable_from: { type: "string", description: "YYYY-MM-DD — earliest appointment date, if the owner named a specific date or range" },
        bookable_until: { type: "string", description: "YYYY-MM-DD — latest appointment date, if the owner named a specific date or range" },
        expires_at: { type: "string", description: "YYYY-MM-DD — if the owner said the link itself should stop working after some date" },
      },
    },
  },
  {
    name: "list_booking_links",
    description:
      "List every booking link with how many spots are booked against its cap (if any), and whether it's open, full, expired, or paused.",
    input_schema: { type: "object", properties: {} },
  },
  {
    name: "update_booking_link",
    description:
      "Update a booking link — pause it (active: false) or reactivate it (active: true), change its cap, expiry, price, duration, title, description, or which calendar dates it can be booked for. Identify the link by link_id or slug.",
    input_schema: {
      type: "object",
      properties: {
        link_id: { type: "integer" },
        slug: { type: "string" },
        active: { type: "boolean", description: "Set false to pause the link, true to reactivate it" },
        max_bookings: { type: "integer" },
        expires_at: { type: "string", description: "YYYY-MM-DD" },
        price: { type: "number" },
        duration_minutes: { type: "integer" },
        title: { type: "string" },
        description: { type: "string" },
        bookable_from: { type: "string", description: "YYYY-MM-DD — earliest appointment date this link can book" },
        bookable_until: { type: "string", description: "YYYY-MM-DD — latest appointment date this link can book" },
      },
    },
  },
];

// OpenAI/OpenRouter tool-calling format: wrap each schema in a `function` object.
const openaiTools = tools.map((t) => ({
  type: "function",
  function: {
    name: t.name,
    description: t.description,
    parameters: t.input_schema,
  },
}));

// ---------------------------------------------------------------------------
// System prompt
// ---------------------------------------------------------------------------

function systemPrompt() {
  const today = new Date();
  const dateStr = today.toLocaleDateString("en-GB", {
    weekday: "long", year: "numeric", month: "long", day: "numeric",
  });
  const iso = today.toISOString().slice(0, 10);
  return `You are the booking assistant for a tattoo studio. You help the owner manage the schedule and client list through conversation. Today is ${dateStr} (${iso}).

You have tools that query and update the studio's booking database. Use them to answer questions — never guess or invent data. If the tools can't provide something, say so plainly.

How to respond:
- Be brief and practical, like an efficient colleague. No filler, no pleasantries, no restating what the owner already knows.
- Plain language only. Never show database IDs, table names, JSON, or technical output. Refer to bookings by client name, day and time.
- Format times naturally ("2pm", "Saturday 14 June") and lists cleanly.
- If a required detail is missing (e.g. "add a booking" without a date), ask for only the specific missing piece.
- All prices are in GBP — always write amounts with £, never $ or another currency symbol.

Hard rules:
- Never cancel a booking, or change its date, time, or artist, without first stating exactly which booking you mean (client, day, time, artist) and getting an explicit yes from the owner in this conversation. Marking a session completed, recording a deposit, adding a price, or adding notes does not need confirmation.
- Never fabricate bookings, clients, availability, or figures. Everything you state must come from a tool result in this conversation.
- Revenue figures only cover completed sessions with a recorded price — say "recorded revenue" and mention if sessions are missing prices.
- Never claim you can do something outside your tools (sending emails, taking payments, etc.).

Booking links: when the owner wants a shareable link for a one-off drop (e.g. a flash sheet posted on Instagram) or says anything like "add a link" / "run a sale" / "make a flash offer", call open_booking_link_form right away — do not ask for the details in text first, and do not try to create the link yourself. Pass along anything they already mentioned (artist, price, duration, "today only", a cap, etc.) as pre-fill values; the owner fills in whatever's left and submits the form themselves. Keep your accompanying message to one short line. For pausing, reactivating, or editing an existing link, use update_booking_link as normal — that stays a normal chat action.`;
}

// ---------------------------------------------------------------------------
// Agentic loop
// ---------------------------------------------------------------------------

/**
 * Run one owner-chat turn. `history` is [{role: 'user'|'assistant', content: string}]
 * from previous turns; `userMessage` is the new message.
 * Returns { text, form? } — `form` is present when the assistant wants the
 * frontend to render a fillable box (e.g. creating a booking link) instead
 * of continuing in plain text.
 */
export async function ownerChat(history, userMessage) {
  const messages = [
    { role: "system", content: systemPrompt() },
    ...history.map((m) => ({ role: m.role, content: m.content })),
    { role: "user", content: userMessage },
  ];

  for (let i = 0; i < MAX_LOOP_ITERATIONS; i++) {
    const response = await client.chat.completions.create({
      model: MODEL,
      max_tokens: 4096,
      messages,
      tools: openaiTools,
      tool_choice: "auto",
    });

    logUsage(response.usage);

    const choice = response.choices[0];
    const msg = choice.message;

    // No tool calls — this is the assistant's final answer.
    if (!msg.tool_calls || msg.tool_calls.length === 0) {
      return { text: (msg.content || "").trim() || "…" };
    }

    // A form-trigger tool ends the turn immediately — the frontend renders a
    // fillable box instead of the assistant continuing to ask questions in
    // text. Whatever the model already parsed from the owner's message comes
    // along as pre-fill values.
    const formCall = msg.tool_calls.find((c) => c.function.name === "open_booking_link_form");
    if (formCall) {
      let prefill = {};
      try {
        prefill = formCall.function.arguments ? JSON.parse(formCall.function.arguments) : {};
      } catch {
        prefill = {};
      }
      return {
        text: (msg.content || "").trim() || "Here's a form to set it up:",
        form: { type: "booking_link", prefill },
      };
    }

    // Echo the assistant turn (with its tool_calls) back into the history.
    messages.push(msg);

    for (const call of msg.tool_calls) {
      let result;
      try {
        const args = call.function.arguments ? JSON.parse(call.function.arguments) : {};
        const handler = toolHandlers[call.function.name];
        result = handler ? handler(args) : { error: `Unknown tool ${call.function.name}` };
      } catch (err) {
        result = { error: String(err.message || err) };
      }
      messages.push({
        role: "tool",
        tool_call_id: call.id,
        content: JSON.stringify(result),
      });
    }
  }

  return { text: "Sorry — that request took too many steps. Try breaking it into smaller questions." };
}
