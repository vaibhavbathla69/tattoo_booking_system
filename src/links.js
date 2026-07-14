import db from "./db.js";

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function slugify(text) {
  const base = String(text || "")
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return base || "link";
}

function generateUniqueSlug(title) {
  const base = slugify(title);
  let slug = base;
  let n = 2;
  while (db.prepare("SELECT 1 FROM booking_links WHERE slug = ?").get(slug)) {
    slug = `${base}-${n++}`;
  }
  return slug;
}

function bookedCount(linkId) {
  return db
    .prepare("SELECT COUNT(*) AS n FROM bookings WHERE link_id = ? AND status != 'cancelled'")
    .get(linkId).n;
}

/** 'open' | 'full' | 'expired' | 'paused' */
export function getLinkStatus(link) {
  if (!link.active) return "paused";
  if (link.expires_at && link.expires_at < todayISO()) return "expired";
  // A booking window that has entirely passed (e.g. a "today only" sale, the
  // day after) reads the same as an expired link to the customer.
  if (link.bookable_until && link.bookable_until < todayISO()) return "expired";
  if (link.max_bookings != null && bookedCount(link.id) >= link.max_bookings) return "full";
  return "open";
}

/** Is `dateStr` a date this link is allowed to book an appointment for? */
export function isDateBookable(link, dateStr) {
  if (link.bookable_from && dateStr < link.bookable_from) return false;
  if (link.bookable_until && dateStr > link.bookable_until) return false;
  return true;
}

function withComputed(link) {
  if (!link) return null;
  return { ...link, status: getLinkStatus(link), booked_count: bookedCount(link.id) };
}

export function getLinkBySlug(slug) {
  const link = db
    .prepare(
      `SELECT bl.*, a.name AS artist_name, a.styles AS artist_styles
       FROM booking_links bl JOIN artists a ON a.id = bl.artist_id
       WHERE bl.slug = ?`
    )
    .get(slug);
  return withComputed(link);
}

export function getLinkById(id) {
  const link = db
    .prepare(
      `SELECT bl.*, a.name AS artist_name FROM booking_links bl JOIN artists a ON a.id = bl.artist_id WHERE bl.id = ?`
    )
    .get(id);
  return withComputed(link);
}

export function listBookingLinks() {
  const links = db
    .prepare(
      `SELECT bl.*, a.name AS artist_name FROM booking_links bl JOIN artists a ON a.id = bl.artist_id
       ORDER BY bl.created_at DESC`
    )
    .all();
  return links.map(withComputed);
}

export function createBookingLink({
  title, description, artist_id, price, duration_minutes, max_bookings, expires_at, bookable_from, bookable_until,
}) {
  const slug = generateUniqueSlug(title);
  const result = db
    .prepare(
      `INSERT INTO booking_links (slug, title, description, artist_id, price, duration_minutes, max_bookings, expires_at, bookable_from, bookable_until)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(
      slug, title, description || "", artist_id, price, duration_minutes,
      max_bookings ?? null, expires_at ?? null, bookable_from ?? null, bookable_until ?? null
    );
  return getLinkById(result.lastInsertRowid);
}

export function updateBookingLink(id, fields) {
  const existing = db.prepare("SELECT * FROM booking_links WHERE id = ?").get(id);
  if (!existing) return null;

  const allowed = [
    "title", "description", "price", "duration_minutes", "max_bookings",
    "expires_at", "active", "artist_id", "bookable_from", "bookable_until",
  ];
  const set = {};
  for (const key of allowed) {
    if (fields[key] !== undefined) {
      set[key] = key === "active" ? (fields[key] ? 1 : 0) : fields[key];
    }
  }
  if (Object.keys(set).length === 0) return getLinkById(id);

  const clause = Object.keys(set).map((k) => `${k} = ?`).join(", ");
  db.prepare(`UPDATE booking_links SET ${clause} WHERE id = ?`).run(...Object.values(set), id);
  return getLinkById(id);
}
