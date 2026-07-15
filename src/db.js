import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataDir = path.join(__dirname, "..", "data");
mkdirSync(dataDir, { recursive: true });

const db = new Database(path.join(dataDir, "studio.db"));
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
CREATE TABLE IF NOT EXISTS artists (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  styles TEXT NOT NULL,
  bio TEXT NOT NULL DEFAULT '',
  rate_note TEXT NOT NULL DEFAULT '',
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  duration_minutes INTEGER NOT NULL,
  price REAL,                        -- null means "varies by artist"
  description TEXT NOT NULL DEFAULT '',
  icon TEXT NOT NULL DEFAULT '✦',
  sort_order INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS booking_links (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  artist_id INTEGER NOT NULL REFERENCES artists(id),
  price REAL NOT NULL,
  duration_minutes INTEGER NOT NULL,
  max_bookings INTEGER,              -- null = unlimited
  expires_at TEXT,                   -- 'YYYY-MM-DD', null = never expires
  bookable_from TEXT,                -- 'YYYY-MM-DD', null = no restriction
  bookable_until TEXT,               -- 'YYYY-MM-DD', null = no restriction
  active INTEGER NOT NULL DEFAULT 1, -- owner can pause without deleting
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS studio_hours (
  day_of_week INTEGER PRIMARY KEY,  -- 0=Sunday .. 6=Saturday
  open_time TEXT,                   -- 'HH:MM', null when closed
  close_time TEXT,
  closed INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS clients (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id INTEGER NOT NULL REFERENCES clients(id),
  artist_id INTEGER NOT NULL REFERENCES artists(id),
  service_id INTEGER REFERENCES services(id),
  link_id INTEGER REFERENCES booking_links(id),
  date TEXT NOT NULL,               -- 'YYYY-MM-DD'
  start_time TEXT NOT NULL,         -- 'HH:MM'
  duration_minutes INTEGER NOT NULL DEFAULT 60,
  style TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  reference_notes TEXT NOT NULL DEFAULT '',
  reference_images TEXT NOT NULL DEFAULT '[]',  -- JSON array of downscaled data URLs
  consent_token TEXT,                -- unguessable id for the client's consent-form link
  consent_json TEXT,                 -- JSON of the completed consent answers
  consent_signature TEXT,            -- signature image (data URL)
  consent_signed_at TEXT,            -- ISO timestamp when signed
  status TEXT NOT NULL DEFAULT 'confirmed'
    CHECK (status IN ('pending','confirmed','cancelled','completed','no_show')),
  deposit_paid INTEGER NOT NULL DEFAULT 0,
  checkout_session_id TEXT,          -- Stripe Checkout session while awaiting payment
  amount_paid REAL,                  -- deposit actually captured, in pounds
  price REAL,
  notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'web',  -- 'web' or 'owner'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(date);
CREATE INDEX IF NOT EXISTS idx_bookings_artist ON bookings(artist_id, date);
CREATE INDEX IF NOT EXISTS idx_clients_email ON clients(email);
`);

// Lightweight migration for DBs created before rate_note / service_id existed.
function addColumnIfMissing(table, column, ddl) {
  const cols = db.prepare(`PRAGMA table_info(${table})`).all();
  if (!cols.some((c) => c.name === column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}
addColumnIfMissing("artists", "rate_note", "rate_note TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("bookings", "service_id", "service_id INTEGER REFERENCES services(id)");
addColumnIfMissing("bookings", "link_id", "link_id INTEGER REFERENCES booking_links(id)");
addColumnIfMissing("booking_links", "bookable_from", "bookable_from TEXT");
addColumnIfMissing("booking_links", "bookable_until", "bookable_until TEXT");
addColumnIfMissing("bookings", "checkout_session_id", "checkout_session_id TEXT");
addColumnIfMissing("bookings", "amount_paid", "amount_paid REAL");
addColumnIfMissing("bookings", "reference_images", "reference_images TEXT NOT NULL DEFAULT '[]'");
addColumnIfMissing("bookings", "consent_token", "consent_token TEXT");
addColumnIfMissing("bookings", "consent_json", "consent_json TEXT");
addColumnIfMissing("bookings", "consent_signature", "consent_signature TEXT");
addColumnIfMissing("bookings", "consent_signed_at", "consent_signed_at TEXT");

// Seed artists and opening hours on first run
const artistCount = db.prepare("SELECT COUNT(*) AS n FROM artists").get().n;
if (artistCount === 0) {
  const insert = db.prepare(
    "INSERT INTO artists (name, styles, bio, rate_note) VALUES (?, ?, ?, ?)"
  );
  insert.run(
    "Craig",
    "Custom blackwork, traditional",
    "Craig is the owner and lead artist at Black Craft Custom Tattoos — bold custom blackwork and classic traditional tattoos with clean, confident linework. Over a decade behind the machine.",
    "£350 full day / £175 half day"
  );
  insert.run(
    "Elena Cross",
    "Realism, black & grey portraits",
    "Elena specialises in photorealistic black & grey work — portraits, wildlife, and fine-detail pieces that hold up close.",
    "£350 full day / £175 half day"
  );
}

// Backfill rate notes for artists that predate the rate_note column
const RATE_NOTES = {
  "Craig": "£350 full day / £175 half day",
  "Elena Cross": "£350 full day / £175 half day",
};
for (const [name, note] of Object.entries(RATE_NOTES)) {
  db.prepare("UPDATE artists SET rate_note = ? WHERE name = ? AND rate_note = ''").run(note, name);
}

const serviceCount = db.prepare("SELECT COUNT(*) AS n FROM services").get().n;
if (serviceCount === 0) {
  const insert = db.prepare(
    `INSERT INTO services (name, duration_minutes, price, description, icon, sort_order)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  insert.run(
    "Full day session", 300, 350,
    "A full day in the chair, 9:30am–2:30pm — large pieces, sleeves, or multi-session backpieces.",
    "☀", 1
  );
  insert.run(
    "Half day session", 180, 175,
    "Three hours, 4pm–7pm — medium-sized pieces or detailed smaller work.",
    "◐", 2
  );
  insert.run(
    "Standard session", 120, null,
    "A 2-hour slot for most single pieces. Price varies by artist.",
    "◑", 3
  );
  insert.run(
    "Small piece", 60, null,
    "An hour slot for small, simple designs. Price varies by artist.",
    "✎", 4
  );
  insert.run(
    "Consultation", 15, 0,
    "Talk through your idea, placement, and sizing before booking a session. No commitment, free.",
    "◇", 5
  );
  insert.run(
    "Touch-up", 60, 0,
    "Free touch-up for a piece done at this studio within the last year.",
    "✓", 6
  );
}

const hoursCount = db.prepare("SELECT COUNT(*) AS n FROM studio_hours").get().n;
if (hoursCount === 0) {
  const insert = db.prepare(
    "INSERT INTO studio_hours (day_of_week, open_time, close_time, closed) VALUES (?, ?, ?, ?)"
  );
  insert.run(0, "11:00", "16:00", 0); // Sunday — shorter hours
  for (const d of [1, 2, 3, 4, 5, 6]) {  // Mon–Sat (Mon open for bank-holiday demo dates)
    insert.run(d, "09:30", "19:00", 0);
  }
}

// Seed demo clients, bookings, and a flash-sale link for Black Craft Custom
// Tattoos (August 2026 demo data) — only runs against a fresh database.
const bookingCount = db.prepare("SELECT COUNT(*) AS n FROM bookings").get().n;
if (bookingCount === 0) {
  const craig = db.prepare("SELECT id FROM artists WHERE name = ?").get("Craig");
  const elena = db.prepare("SELECT id FROM artists WHERE name = ?").get("Elena Cross");
  const fullDaySvc = db.prepare("SELECT id FROM services WHERE name = ?").get("Full day session");
  const halfDaySvc = db.prepare("SELECT id FROM services WHERE name = ?").get("Half day session");

  if (craig && elena && fullDaySvc && halfDaySvc) {
    const insertClient = db.prepare("INSERT INTO clients (name, email, phone) VALUES (?, ?, ?)");
    const insertBooking = db.prepare(`
      INSERT INTO bookings
        (client_id, artist_id, service_id, link_id, date, start_time, duration_minutes, style, description, status, deposit_paid, price, source)
      VALUES (@client_id, @artist_id, @service_id, @link_id, @date, @start_time, @duration_minutes, @style, @description, @status, @deposit_paid, @price, @source)
    `);

    // Flash-sale link: "August Special" — £350/slot, 6 slots, expires 31 Aug 2026
    const augustSpecial = db.prepare(`
      INSERT INTO booking_links
        (slug, title, description, artist_id, price, duration_minutes, max_bookings, expires_at, bookable_from, bookable_until)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      "august-special",
      "August Special",
      "Full-day custom slot with Craig — £350, this August only.",
      craig.id, 350, 300, 6, "2026-08-31", "2026-08-01", "2026-08-31"
    ).lastInsertRowid;

    const seedBookings = [
      // Confirmed full-day bookings — 9:30am-2:30pm, £350
      { client: ["Sam Whitfield", "sam.whitfield@example.com", "07700 900111"], artist: craig.id, service: fullDaySvc.id, link: null, date: "2026-08-06", start: "09:30", dur: 300, style: "Blackwork sleeve", desc: "Full sleeve, blackwork geometric patterns down the forearm.", price: 350 },
      { client: ["Ellie Marsh", "ellie.marsh@example.com", "07700 900112"], artist: elena.id, service: fullDaySvc.id, link: null, date: "2026-08-13", start: "09:30", dur: 300, style: "Realism portrait", desc: "Black & grey portrait piece, upper arm.", price: 350 },
      { client: ["Tom Brackley", "tom.brackley@example.com", "07700 900113"], artist: craig.id, service: fullDaySvc.id, link: null, date: "2026-08-20", start: "09:30", dur: 300, style: "Traditional chest piece", desc: "Bold traditional chest piece, classic colour palette.", price: 350 },

      // Confirmed half-day bookings — 4pm-7pm, £175
      { client: ["Priya Anand", "priya.anand@example.com", "07700 900114"], artist: craig.id, service: halfDaySvc.id, link: null, date: "2026-08-07", start: "16:00", dur: 180, style: "Blackwork forearm piece", desc: "Blackwork botanical piece, forearm.", price: 175 },
      { client: ["Callum Ross", "callum.ross@example.com", "07700 900115"], artist: elena.id, service: halfDaySvc.id, link: null, date: "2026-08-14", start: "16:00", dur: 180, style: "Realism animal portrait", desc: "Black & grey wildlife portrait, shoulder.", price: 175 },
      { client: ["Harriet Doyle", "harriet.doyle@example.com", "07700 900116"], artist: craig.id, service: halfDaySvc.id, link: null, date: "2026-08-21", start: "16:00", dur: 180, style: "Traditional flash piece", desc: "Traditional flash design, calf.", price: 175 },

      // Fully booked day (Craig, studio open to close) — demonstrates double-booking prevention
      { client: ["Marcus Webb", "marcus.webb@example.com", "07700 900117"], artist: craig.id, service: fullDaySvc.id, link: null, date: "2026-08-11", start: "09:30", dur: 570, style: "Blackwork full sleeve", desc: "Full sleeve blackwork — booked solid, studio open to close.", price: 350 },

      // August Special flash-sale bookings (3 of 6 slots taken)
      { client: ["Nina Osei", "nina.osei@example.com", "07700 900118"], artist: craig.id, service: fullDaySvc.id, link: augustSpecial, date: "2026-08-05", start: "09:30", dur: 300, style: "August Special — Blackwork", desc: "Booked via the August Special flash-sale link.", price: 350 },
      { client: ["Ryan Foster", "ryan.foster@example.com", "07700 900119"], artist: craig.id, service: fullDaySvc.id, link: augustSpecial, date: "2026-08-12", start: "09:30", dur: 300, style: "August Special — Traditional", desc: "Booked via the August Special flash-sale link.", price: 350 },
      { client: ["Zoe Bennett", "zoe.bennett@example.com", "07700 900120"], artist: craig.id, service: fullDaySvc.id, link: augustSpecial, date: "2026-08-19", start: "09:30", dur: 300, style: "August Special — Blackwork", desc: "Booked via the August Special flash-sale link.", price: 350 },
    ];

    for (const b of seedBookings) {
      const [name, email, phone] = b.client;
      const clientId = insertClient.run(name, email, phone).lastInsertRowid;
      insertBooking.run({
        client_id: clientId,
        artist_id: b.artist,
        service_id: b.service,
        link_id: b.link,
        date: b.date,
        start_time: b.start,
        duration_minutes: b.dur,
        style: b.style,
        description: b.desc,
        status: "confirmed",
        deposit_paid: 1,
        price: b.price,
        source: "web",
      });
    }
  }
}

/** Find an existing client by name+email (the identity rule) or create one. */
export function findOrCreateClient({ name, email, phone }) {
  const cleanName = name.trim();
  const cleanEmail = email ? email.trim().toLowerCase() : null;

  let client = null;
  if (cleanEmail) {
    client = db
      .prepare(
        "SELECT * FROM clients WHERE lower(name) = lower(?) AND lower(email) = ?"
      )
      .get(cleanName, cleanEmail);
  } else {
    client = db
      .prepare("SELECT * FROM clients WHERE lower(name) = lower(?)")
      .get(cleanName);
  }

  if (client) {
    // Backfill contact details we didn't have before
    if (phone && !client.phone) {
      db.prepare("UPDATE clients SET phone = ? WHERE id = ?").run(phone, client.id);
      client.phone = phone;
    }
    return client;
  }

  const result = db
    .prepare("INSERT INTO clients (name, email, phone) VALUES (?, ?, ?)")
    .run(cleanName, cleanEmail, phone || null);
  return db.prepare("SELECT * FROM clients WHERE id = ?").get(result.lastInsertRowid);
}

export default db;
