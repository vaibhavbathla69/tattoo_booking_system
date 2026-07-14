import db from "./db.js";

const SLOT_MINUTES = 60;

// How long an unpaid 'pending' booking holds its slot before it's considered
// abandoned and the slot is offered again. Kept in one place so the SQL below
// and the sweeper in server.js agree.
export const PENDING_HOLD_MINUTES = 15;

// A booking occupies its slot if it's confirmed/completed, OR it's a pending
// (mid-checkout) booking still inside the hold window. Stale pendings drop out
// automatically here, so availability is correct even before the sweeper runs.
const OCCUPIED_CLAUSE = `(
  status IN ('confirmed','completed')
  OR (status = 'pending' AND created_at > datetime('now', '-${PENDING_HOLD_MINUTES} minutes'))
)`;

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

function toHHMM(minutes) {
  const h = String(Math.floor(minutes / 60)).padStart(2, "0");
  const m = String(minutes % 60).padStart(2, "0");
  return `${h}:${m}`;
}

/** Day of week (0=Sunday) for a 'YYYY-MM-DD' string, timezone-safe. */
function dayOfWeek(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

export function getHoursForDate(dateStr) {
  return db
    .prepare("SELECT * FROM studio_hours WHERE day_of_week = ?")
    .get(dayOfWeek(dateStr));
}

export function getAllHours() {
  return db.prepare("SELECT * FROM studio_hours ORDER BY day_of_week").all();
}

/**
 * Available slot start times for one artist on one date.
 * A slot is blocked if any active booking for that artist overlaps it —
 * a 3-hour session starting 13:00 blocks 13:00, 14:00 and 15:00.
 */
export function getAvailableSlots(dateStr, artistId, { slotDuration = SLOT_MINUTES } = {}) {
  const hours = getHoursForDate(dateStr);
  if (!hours || hours.closed) return [];

  const open = toMinutes(hours.open_time);
  const close = toMinutes(hours.close_time);

  const bookings = db
    .prepare(
      `SELECT start_time, duration_minutes FROM bookings
       WHERE artist_id = ? AND date = ? AND ${OCCUPIED_CLAUSE}`
    )
    .all(artistId, dateStr);

  const busy = bookings.map((b) => {
    const start = toMinutes(b.start_time);
    return [start, start + b.duration_minutes];
  });

  const slots = [];
  for (let t = open; t + slotDuration <= close; t += SLOT_MINUTES) {
    const overlaps = busy.some(([s, e]) => t < e && t + slotDuration > s);
    if (!overlaps) slots.push(toHHMM(t));
  }
  return slots;
}

/** Availability across artists: { artistId: [slots] } */
export function getAvailabilityForDate(dateStr, artistId = null, { slotDuration } = {}) {
  const artists = artistId
    ? db.prepare("SELECT * FROM artists WHERE id = ? AND active = 1").all(artistId)
    : db.prepare("SELECT * FROM artists WHERE active = 1").all();

  return artists.map((a) => ({
    artist_id: a.id,
    artist_name: a.name,
    slots: getAvailableSlots(dateStr, a.id, slotDuration ? { slotDuration } : {}),
  }));
}

/** True if the artist is free for [start, start+duration) within opening hours. */
export function isSlotBookable(dateStr, artistId, startTime, durationMinutes) {
  const hours = getHoursForDate(dateStr);
  if (!hours || hours.closed) return { ok: false, reason: "Studio is closed that day." };

  const start = toMinutes(startTime);
  const end = start + durationMinutes;
  if (start < toMinutes(hours.open_time) || end > toMinutes(hours.close_time)) {
    return {
      ok: false,
      reason: `Outside opening hours (${hours.open_time}–${hours.close_time}).`,
    };
  }

  const clash = db
    .prepare(
      `SELECT b.id, b.start_time, b.duration_minutes, c.name AS client_name
       FROM bookings b JOIN clients c ON c.id = b.client_id
       WHERE b.artist_id = ? AND b.date = ? AND ${OCCUPIED_CLAUSE.replace(/status/g, "b.status").replace(/created_at/g, "b.created_at")}`
    )
    .all(artistId, dateStr)
    .find((b) => {
      const s = toMinutes(b.start_time);
      return start < s + b.duration_minutes && end > s;
    });

  if (clash) {
    return {
      ok: false,
      reason: `Clashes with an existing booking at ${clash.start_time} (${clash.duration_minutes} min).`,
    };
  }
  return { ok: true };
}
