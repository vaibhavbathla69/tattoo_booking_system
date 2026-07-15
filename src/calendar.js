import db from "./db.js";

/**
 * iCal (.ics) feed of studio bookings. The owner subscribes to the feed URL in
 * Google/Apple Calendar and every booking shows up on their phone, updating
 * automatically as bookings come in or change.
 */

/** Secret that guards the feed URL (calendar apps can't send auth headers). */
export function calendarToken() {
  // .trim() — a hosting dashboard's textarea can append an invisible newline,
  // which would silently never match the token in the URL.
  return (process.env.CALENDAR_TOKEN || "").trim();
}

// Escape per RFC 5545: backslash, semicolon, comma, and newlines.
function esc(text) {
  return String(text ?? "")
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r?\n/g, "\\n");
}

function pad(n) {
  return String(n).padStart(2, "0");
}

/** 'YYYY-MM-DD' + 'HH:MM' + minutes → floating local iCal stamp (YYYYMMDDTHHMMSS). */
function localStamp(dateStr, timeStr, addMinutes = 0) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const [hh, mm] = timeStr.split(":").map(Number);
  const dt = new Date(y, m - 1, d, hh, mm + addMinutes);
  return (
    `${dt.getFullYear()}${pad(dt.getMonth() + 1)}${pad(dt.getDate())}` +
    `T${pad(dt.getHours())}${pad(dt.getMinutes())}00`
  );
}

function utcStamp(date) {
  return (
    `${date.getUTCFullYear()}${pad(date.getUTCMonth() + 1)}${pad(date.getUTCDate())}` +
    `T${pad(date.getUTCHours())}${pad(date.getUTCMinutes())}${pad(date.getUTCSeconds())}Z`
  );
}

/** Build the whole calendar feed as an ICS string. */
export function buildIcs({ calendarName = "Studio Bookings" } = {}) {
  const rows = db
    .prepare(
      `SELECT b.id, b.date, b.start_time, b.duration_minutes, b.style, b.description,
              b.status, b.deposit_paid, b.consent_signed_at,
              a.name AS artist_name, c.name AS client_name, c.phone AS client_phone,
              c.email AS client_email
       FROM bookings b
       JOIN artists a ON a.id = b.artist_id
       JOIN clients c ON c.id = b.client_id
       WHERE b.status IN ('confirmed','completed')
       ORDER BY b.date, b.start_time`
    )
    .all();

  const now = utcStamp(new Date());
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Studio Booking//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${esc(calendarName)}`,
    "X-PUBLISHED-TTL:PT15M",
  ];

  for (const b of rows) {
    const details = [
      b.style ? `Piece: ${b.style}` : null,
      `Artist: ${b.artist_name}`,
      b.client_phone ? `Phone: ${b.client_phone}` : null,
      b.client_email ? `Email: ${b.client_email}` : null,
      `Deposit: ${b.deposit_paid ? "paid" : "not paid"}`,
      `Consent form: ${b.consent_signed_at ? "signed" : "not signed"}`,
      b.description ? `\nNotes: ${b.description}` : null,
    ]
      .filter(Boolean)
      .join("\n");

    lines.push(
      "BEGIN:VEVENT",
      `UID:booking-${b.id}@studio-booking`,
      `DTSTAMP:${now}`,
      `DTSTART:${localStamp(b.date, b.start_time)}`,
      `DTEND:${localStamp(b.date, b.start_time, b.duration_minutes)}`,
      `SUMMARY:${esc(`${b.client_name} — ${b.style || "Session"}`)}`,
      `DESCRIPTION:${esc(details)}`,
      `STATUS:${b.status === "completed" ? "CONFIRMED" : "CONFIRMED"}`,
      "END:VEVENT"
    );
  }

  lines.push("END:VCALENDAR");
  return lines.join("\r\n") + "\r\n"; // ICS requires CRLF
}
