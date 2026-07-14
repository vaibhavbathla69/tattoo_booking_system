/* Black Craft Custom Tattoos — calendar view: week grid of bookings, click to manage */
import { api, toast, openDrawer, closeDrawer, fmtTime, fmtDate, todayISO, addDays, mondayOf, artistColor } from "./owner-app.js";

const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const SLOT_H = 44; // px per hour row — keep in sync with owner.css --slot-h

// Module-level state persists across re-renders (nav position, filter)
let weekStart = mondayOf("2026-08-03"); // demo default — Black Craft Custom Tattoos, August 2026
let artistFilter = "";

function toMinutes(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
}

// Tint an artist's identity hex to a translucent fill for booking chips.
function tint(hex, alpha) {
  const n = parseInt(hex.replace("#", ""), 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
}

function dowOf(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).getDay();
}

export async function renderCalendar(mount) {
  if (!mount) return;
  mount.innerHTML = `<h2 class="view-title">Calendar</h2><p class="cal-empty-note">Loading…</p>`;

  const [artists, hours] = await Promise.all([
    api("/api/artists"),
    api("/api/hours"),
  ]);

  const weekEnd = addDays(weekStart, 6);
  let bookings;
  try {
    bookings = await api(`/api/owner/bookings?start_date=${weekStart}&end_date=${weekEnd}`);
  } catch (e) {
    mount.innerHTML = `<h2 class="view-title">Calendar</h2><p class="cal-empty-note">${e.message}</p>`;
    return;
  }

  if (artistFilter) {
    bookings = bookings.filter((b) => String(b.artist_id) === artistFilter);
  }

  const bookingsByDate = {};
  for (const b of bookings) {
    (bookingsByDate[b.date] ||= []).push(b);
  }

  // Studio-wide open/close envelope so every day column shares one time axis
  const openDays = hours.filter((h) => !h.closed);
  const earliest = openDays.length ? Math.min(...openDays.map((h) => toMinutes(h.open_time))) : 9 * 60;
  const latest = openDays.length ? Math.max(...openDays.map((h) => toMinutes(h.close_time))) : 18 * 60;
  const totalHours = Math.ceil((latest - earliest) / 60);

  const today = todayISO();
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));

  mount.innerHTML = `
    <h2 class="view-title">Calendar</h2>
    <div class="cal-wrap">
      <div class="toolbar">
        <button class="btn-ghost" id="cal-prev">‹ Prev</button>
        <button class="btn-ghost" id="cal-today">Today</button>
        <button class="btn-ghost" id="cal-next">Next ›</button>
        <span class="cal-range-label">${fmtDate(weekStart, { short: true })} – ${fmtDate(weekEnd, { short: true, year: true })}</span>
        <span class="spacer"></span>
        <select id="cal-artist-filter">
          <option value="">All artists</option>
          ${artists.map((a) => `<option value="${a.id}" ${artistFilter === String(a.id) ? "selected" : ""}>${a.name}</option>`).join("")}
        </select>
        <button class="btn-primary" id="cal-new-booking">+ New booking</button>
      </div>

      <div class="legend">
        ${artists.map((a) => `<span class="legend-item"><span class="legend-swatch" style="background:${artistColor(a.id)}"></span>${a.name}</span>`).join("")}
      </div>

      <div class="cal-grid" style="--slot-h:${SLOT_H}px">
        <div class="cal-head-cell"></div>
        ${days.map((d) => {
          const dow = dowOf(d);
          const dayHours = hours.find((h) => h.day_of_week === dow);
          const isToday = d === today;
          const closed = !dayHours || dayHours.closed;
          return `<div class="cal-head-cell ${isToday ? "today" : ""} ${closed ? "closed" : ""}">
            <div class="dow">${DAY_NAMES[dow]}</div>
            <div class="dnum">${Number(d.split("-")[2])}</div>
          </div>`;
        }).join("")}

        <div class="cal-time-col" style="height:${totalHours * SLOT_H}px">
          ${Array.from({ length: totalHours }, (_, i) => {
            const mins = earliest + i * 60;
            const hh = String(Math.floor(mins / 60)).padStart(2, "0");
            return `<div class="cal-time-label" style="height:${SLOT_H}px">${hh}:00</div>`;
          }).join("")}
        </div>

        ${days.map((d) => {
          const dow = dowOf(d);
          const dayHours = hours.find((h) => h.day_of_week === dow);
          const closed = !dayHours || dayHours.closed;
          const dayBookings = (bookingsByDate[d] || []).filter((b) => b.status !== "cancelled");

          const chips = dayBookings.map((b) => {
            const start = toMinutes(b.start_time) - earliest;
            const top = (start / 60) * SLOT_H;
            const height = Math.max((b.duration_minutes / 60) * SLOT_H, 22);
            const color = artistColor(b.artist_id);
            const tall = height >= 46; // room for a third line (the piece/style)
            return `<div class="booking-chip status-${b.status}" data-booking-id="${b.id}"
                style="top:${top}px; height:${height}px; border-left-color:${color}; background:${tint(color, 0.16)}">
              <div class="chip-time">${fmtTime(b.start_time)}</div>
              <div class="chip-client">${escapeHtml(b.client_name)}</div>
              ${tall && b.style ? `<div class="chip-style">${escapeHtml(b.style)}</div>` : ""}
            </div>`;
          }).join("");

          return `<div class="cal-day-col ${closed ? "closed-day" : ""}" data-date="${d}"
              style="height:${totalHours * SLOT_H}px">${chips}</div>`;
        }).join("")}
      </div>
    </div>
  `;

  $id("cal-prev").addEventListener("click", () => { weekStart = addDays(weekStart, -7); renderCalendar(mount); });
  $id("cal-next").addEventListener("click", () => { weekStart = addDays(weekStart, 7); renderCalendar(mount); });
  $id("cal-today").addEventListener("click", () => { weekStart = mondayOf(todayISO()); renderCalendar(mount); });
  $id("cal-artist-filter").addEventListener("change", (e) => { artistFilter = e.target.value; renderCalendar(mount); });
  $id("cal-new-booking").addEventListener("click", () => openBookingForm(artists, mount));

  mount.querySelectorAll(".booking-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const booking = bookings.find((b) => String(b.id) === chip.dataset.bookingId);
      if (booking) openBookingDrawer(booking, artists, mount);
    });
  });

  function $id(id) { return mount.querySelector(`#${id}`); }
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Customer's reference photos + links/notes, shown in the booking drawer.
function refBlockHtml(booking) {
  let images = [];
  try { images = JSON.parse(booking.reference_images || "[]"); } catch { images = []; }
  images = images.filter((s) => typeof s === "string" && s.startsWith("data:image/"));
  const notes = (booking.reference_notes || "").trim();
  if (!images.length && !notes) return "";
  const photos = images.length
    ? `<div class="ref-photos">${images.map((src, i) =>
        `<a href="${src}" target="_blank" rel="noopener" class="ref-photo"><img src="${src}" alt="reference ${i + 1}" /></a>`
      ).join("")}</div>`
    : "";
  const noteLine = notes
    ? `<p style="font-size:0.85rem;color:var(--ink-dim);margin-top:0.5rem;">${escapeHtml(notes)}</p>`
    : "";
  const label = images.length ? `Reference (${images.length} photo${images.length === 1 ? "" : "s"})` : "Reference";
  return `<div class="field"><label>${label}</label>${photos}${noteLine}</div>`;
}

// ---------------------------------------------------------------------------
// Booking detail / edit drawer
// ---------------------------------------------------------------------------

function openBookingDrawer(booking, artists, mount) {
  openDrawer(`
    <h3>${escapeHtml(booking.client_name)}</h3>
    <p class="drawer-sub">
      <span class="status-pill ${booking.status}">${booking.status.replace("_", " ")}</span>
      &nbsp;·&nbsp; ${booking.client_email || "no email"} ${booking.client_phone ? "· " + booking.client_phone : ""}
    </p>

    <div class="field-row">
      <div class="field">
        <label>Artist</label>
        <select id="d-artist">
          ${artists.map((a) => `<option value="${a.name}" ${a.name === booking.artist_name ? "selected" : ""}>${a.name}</option>`).join("")}
        </select>
      </div>
      <div class="field">
        <label>Status</label>
        <select id="d-status">
          ${["pending", "confirmed", "completed", "cancelled", "no_show"].map((s) =>
            `<option value="${s}" ${s === booking.status ? "selected" : ""}>${s.replace("_", " ")}</option>`
          ).join("")}
        </select>
      </div>
    </div>

    <div class="field-row">
      <div class="field"><label>Date</label><input type="date" id="d-date" value="${booking.date}" /></div>
      <div class="field"><label>Start time</label><input type="time" id="d-time" value="${booking.start_time}" /></div>
      <div class="field"><label>Duration (min)</label><input type="number" id="d-duration" value="${booking.duration_minutes}" min="15" step="15" /></div>
    </div>

    <div class="field-row">
      <div class="field"><label>Style</label><input type="text" id="d-style" value="${escapeHtml(booking.style || "")}" /></div>
      <div class="field"><label>Price (£)</label><input type="number" id="d-price" value="${booking.price ?? ""}" min="0" step="1" /></div>
    </div>

    <div class="field-row">
      <label style="display:flex;align-items:center;gap:0.5rem;font-size:0.85rem;color:var(--ink);margin-top:0.2rem;">
        <input type="checkbox" id="d-deposit" ${booking.deposit_paid ? "checked" : ""} style="width:auto;" /> Deposit paid
      </label>
    </div>

    <div class="field">
      <label>Description</label>
      <p style="font-size:0.85rem;color:var(--ink-dim);">${escapeHtml(booking.description || "—")}</p>
    </div>

    ${refBlockHtml(booking)}

    <div class="field">
      <label>Notes</label>
      <textarea id="d-notes" rows="3">${escapeHtml(booking.notes || "")}</textarea>
    </div>

    <div class="actions">
      <button class="btn-primary" id="d-save">Save changes</button>
      <button class="btn-danger" id="d-cancel">Cancel booking</button>
    </div>
  `);

  document.getElementById("d-save").addEventListener("click", async () => {
    try {
      await api(`/api/owner/bookings/${booking.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          artist: document.getElementById("d-artist").value,
          status: document.getElementById("d-status").value,
          date: document.getElementById("d-date").value,
          start_time: document.getElementById("d-time").value,
          duration_minutes: Number(document.getElementById("d-duration").value),
          style: document.getElementById("d-style").value,
          price: document.getElementById("d-price").value ? Number(document.getElementById("d-price").value) : null,
          deposit_paid: document.getElementById("d-deposit").checked,
          notes: document.getElementById("d-notes").value,
        }),
      });
      toast("Booking updated.");
      closeDrawer();
      renderCalendar(mount);
    } catch (e) {
      toast(e.message, true);
    }
  });

  document.getElementById("d-cancel").addEventListener("click", async () => {
    if (!confirm(`Cancel ${booking.client_name}'s booking on ${fmtDate(booking.date, { short: true })} at ${fmtTime(booking.start_time)}?`)) return;
    try {
      await api(`/api/owner/bookings/${booking.id}/cancel`, { method: "POST" });
      toast("Booking cancelled.");
      closeDrawer();
      renderCalendar(mount);
    } catch (e) {
      toast(e.message, true);
    }
  });
}

function openBookingForm(artists, mount) {
  openDrawer(`
    <h3>New booking</h3>
    <p class="drawer-sub">Adds directly — use for walk-ins or phone bookings.</p>

    <div class="field-row">
      <div class="field"><label>Client name</label><input type="text" id="n-name" /></div>
      <div class="field"><label>Artist</label>
        <select id="n-artist">${artists.map((a) => `<option value="${a.name}">${a.name}</option>`).join("")}</select>
      </div>
    </div>
    <div class="field-row">
      <div class="field"><label>Email <span style="opacity:.6">optional</span></label><input type="email" id="n-email" /></div>
      <div class="field"><label>Phone <span style="opacity:.6">optional</span></label><input type="tel" id="n-phone" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Date</label><input type="date" id="n-date" value="${todayISO()}" /></div>
      <div class="field"><label>Start time</label><input type="time" id="n-time" value="10:00" /></div>
      <div class="field"><label>Duration (min)</label><input type="number" id="n-duration" value="60" min="15" step="15" /></div>
    </div>
    <div class="field"><label>Style / piece</label><input type="text" id="n-style" /></div>
    <div class="field"><label>Notes</label><textarea id="n-notes" rows="2"></textarea></div>

    <div class="actions">
      <button class="btn-primary" id="n-save">Add booking</button>
    </div>
  `);

  document.getElementById("n-save").addEventListener("click", async () => {
    const name = document.getElementById("n-name").value.trim();
    if (!name) return toast("Client name is required.", true);
    try {
      await api("/api/owner/bookings", {
        method: "POST",
        body: JSON.stringify({
          client_name: name,
          client_email: document.getElementById("n-email").value.trim() || undefined,
          client_phone: document.getElementById("n-phone").value.trim() || undefined,
          artist: document.getElementById("n-artist").value,
          date: document.getElementById("n-date").value,
          start_time: document.getElementById("n-time").value,
          duration_minutes: Number(document.getElementById("n-duration").value) || 60,
          style: document.getElementById("n-style").value.trim(),
          notes: document.getElementById("n-notes").value.trim(),
        }),
      });
      toast("Booking added.");
      closeDrawer();
      renderCalendar(mount);
    } catch (e) {
      toast(e.message, true);
    }
  });
}
