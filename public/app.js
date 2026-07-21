/* Black Craft Custom Tattoos — customer booking flow: service → artist → date/time → details → done */

const $ = (id) => document.getElementById(id);
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

const state = {
  service: null, // {id, name, duration_minutes, price, description, icon}
  artist: null,  // {id, name, styles, bio, rate_note}
  date: null,    // 'YYYY-MM-DD'
  time: null,    // 'HH:MM'
};

let services = [];
let artists = [];
let hours = [];
let config = { payments_enabled: false, deposit_amount: 0 }; // from /api/config
let refImages = []; // customer's reference photos (downscaled data URLs) for this booking
let consentToken = null; // set once booked — links the client to their consent form
let calendarMonthCursor = null; // 'YYYY-MM-01' — visible calendar month
let monthAvail = {};            // 'YYYY-MM-DD' -> number of open slots (undefined = not yet loaded)
let monthAvailToken = 0;        // guards against out-of-order month fetches
let currentStep = "service";
let linkMode = false;  // true when booking through a shareable /b/:slug link
let linkSlug = null;
let linkBookableFrom = null; // link's optional booking-date window
let linkBookableUntil = null;

const STEP_ORDER = ["service", "artist", "datetime", "details"];
const STEP_TITLES = {
  service: "Select a service",
  artist: "Select a team member",
  datetime: "Select a date & time",
  details: "Your details",
  done: "",
};

// ---------------------------------------------------------------------------
// Formatting helpers
// ---------------------------------------------------------------------------

function fmtTime(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hr = ((h + 11) % 12) + 1;
  return m === 0 ? `${hr}${suffix}` : `${hr}:${String(m).padStart(2, "0")}${suffix}`;
}

function fmtDateLong(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    weekday: "long", day: "numeric", month: "long",
  });
}

function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + n);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function fmtDuration(mins) {
  if (mins < 60) return `${mins} mins`;
  const h = mins / 60;
  return `${h} hr${h !== 1 ? "s" : ""}`;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function bookCtaLabel() {
  return config.payments_enabled ? `Pay £${config.deposit_amount} deposit & book` : "Confirm booking";
}

// ---------------------------------------------------------------------------
// Demo personalisation: one generic build, studio name passed as ?studio=...
// so the same page feels tailored per lead (e.g. /?studio=Golden+Goose+Tattoo).
// ---------------------------------------------------------------------------

const DEFAULT_STUDIO = "Black Craft Custom Tattoos";
let activePreset = null; // resolved from ?studio= against window.DEMO_PRESETS

// Resolve the ?studio= param into { name, preset }. If it matches a preset
// slug we load that studio's full config; otherwise we treat it as a plain
// studio name (so ?studio=Golden+Goose+Tattoo still just swaps the name).
function resolveStudio() {
  const raw = (new URLSearchParams(location.search).get("studio") || "").trim();
  if (!raw) return { name: DEFAULT_STUDIO, preset: null };
  const presets = window.DEMO_PRESETS || {};
  const slug = raw.toLowerCase().replace(/\s+/g, "-");
  const preset = presets[raw] || presets[slug] || null;
  const name = (preset && preset.name) ? preset.name : raw.replace(/\s+/g, " ").slice(0, 48);
  return { name, preset };
}

// Split a studio name into two roughly-balanced lines for the big wordmark.
function splitWordmark(name) {
  const words = name.trim().split(/\s+/);
  if (words.length <= 1) return [name.trim(), ""];
  let best = 1, bestDiff = Infinity;
  for (let i = 1; i < words.length; i++) {
    const diff = Math.abs(words.slice(0, i).join(" ").length - words.slice(i).join(" ").length);
    if (diff < bestDiff) { bestDiff = diff; best = i; }
  }
  return [words.slice(0, best).join(" "), words.slice(best).join(" ")];
}

function applyStudioName(name) {
  // textContent everywhere below → the value can never inject markup.
  document.title = `${name} — Book a Session`;

  const wm = document.querySelector(".wordmark");
  if (wm) {
    const [l1, l2] = splitWordmark(name);
    wm.textContent = l1;
    if (l2) { const s = document.createElement("span"); s.textContent = l2; wm.appendChild(s); }
  }
  const sideName = document.querySelector(".studio-card h3");
  if (sideName) sideName.textContent = name;
  const footName = document.querySelector(".site-footer span");
  if (footName) footName.textContent = name;
}

// Optional header extras a preset can supply: a script sub-line (tagline) and a
// framed photo above the wordmark. The photo is progressive — if it 404s we
// hide the frame so the page still reads as a clean text header.
function applyHeaderExtras() {
  if (!activePreset) return;

  if (activePreset.tagline) {
    const script = document.querySelector(".brand-script");
    if (script) script.textContent = activePreset.tagline;
  }

  if (activePreset.headerImage) {
    const holder = $("brand-photo");
    const header = document.querySelector(".site-header");
    if (!holder) return;
    const img = document.createElement("img");
    img.alt = activePreset.name || "";
    // If the real photo 404s, drop to a designed placeholder (if the preset
    // supplies one); only if that also fails do we hide the frame entirely.
    let triedFallback = false;
    img.addEventListener("error", () => {
      if (activePreset.headerImageFallback && !triedFallback) {
        triedFallback = true;
        img.src = activePreset.headerImageFallback;
        return;
      }
      holder.hidden = true;
      if (header) header.classList.remove("has-photo");
    });
    img.src = activePreset.headerImage;
    holder.appendChild(img);
    holder.hidden = false;
    if (header) header.classList.add("has-photo");
  }
}

// Relabel the real artists/services with the preset's names/prices. Each
// relabelled entry keeps a REAL id (cycled if the preset lists more than
// exist) so availability, booking, and the deposit flow keep working.
function applyArtistPreset(realArtists) {
  const pre = activePreset && activePreset.artists;
  if (!pre || !pre.length || !realArtists.length) return realArtists;
  return pre.map((pa, i) => {
    const base = realArtists[i % realArtists.length];
    return { ...base, name: pa.name || base.name, styles: pa.styles || base.styles, rate_note: pa.rate || base.rate_note };
  });
}
function applyServicePreset(realServices) {
  const pre = activePreset && activePreset.services;
  if (!pre || !pre.length || !realServices.length) return realServices;
  return pre.map((ps, i) => {
    const base = realServices[i % realServices.length];
    return {
      ...base,
      name: ps.name || base.name,
      price: (ps.price !== undefined ? ps.price : base.price),
      // Display-only overrides — availability still runs off the real seeded
      // service's id/duration underneath (curated presets bypass it entirely).
      duration_minutes: (ps.duration !== undefined ? ps.duration : base.duration_minutes),
      description: (ps.description !== undefined ? ps.description : base.description),
    };
  });
}

// Curated availability: when a preset supplies an `availability` map, the
// calendar shows ONLY those dates and offers only the listed slots for the
// selected service — matching what the studio actually posted.
function curatedMode() {
  return !!(activePreset && activePreset.availability);
}
function curatedSlots(dateStr) {
  const av = activePreset && activePreset.availability;
  if (!av || !av[dateStr] || !state.service) return [];
  return av[dateStr].filter((e) => e.service === state.service.name).map((e) => e.start);
}
function curatedHasService(dateStr) {
  return curatedSlots(dateStr).length > 0;
}

// ---------------------------------------------------------------------------
// Navigation
// ---------------------------------------------------------------------------

function goTo(step) {
  currentStep = step;
  render();
}

function goBack() {
  const idx = STEP_ORDER.indexOf(currentStep);
  if (idx > 0) goTo(STEP_ORDER[idx - 1]);
}

function render() {
  $("back-btn").hidden = linkMode || currentStep === "service" || currentStep === "done";
  $("step-title").textContent = STEP_TITLES[currentStep];

  const renderers = {
    service: renderServiceStep,
    artist: renderArtistStep,
    datetime: renderDateTimeStep,
    details: renderDetailsStep,
    done: renderDoneStep,
  };
  renderers[currentStep]();
  renderSummary();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

$("back-btn").addEventListener("click", goBack);

// ---------------------------------------------------------------------------
// Step 1: service
// ---------------------------------------------------------------------------

function renderServiceStep() {
  const wrap = $("step-content");
  wrap.innerHTML = `<div class="svc-list">${services.map(svcRowHtml).join("")}</div>`;

  wrap.querySelectorAll(".svc-row").forEach((row) => {
    row.addEventListener("click", (e) => {
      if (e.target.classList.contains("svc-details-link")) return;
      state.service = services.find((s) => s.id === Number(row.dataset.id));
      state.artist = null;
      state.date = null;
      state.time = null;
      goTo("artist");
    });
  });
  wrap.querySelectorAll(".svc-details-link").forEach((link) => {
    link.addEventListener("click", (e) => {
      e.stopPropagation();
      const desc = link.closest(".svc-row").querySelector(".svc-desc");
      desc.hidden = !desc.hidden;
    });
  });
}

function durationBadge(mins) {
  if (mins < 60) return `${mins}m`;
  const h = mins / 60;
  return Number.isInteger(h) ? `${h}h` : `${Math.floor(h)}h${(mins % 60)}`;
}

function svcRowHtml(s) {
  const priceLabel = s.price == null ? `Click "Details" to see artist prices` : (s.price === 0 ? "Free" : `£${s.price}`);
  return `
    <div class="svc-row" data-id="${s.id}">
      <span class="svc-icon">${durationBadge(s.duration_minutes)}</span>
      <span class="svc-info">
        <span class="svc-name">${escapeHtml(s.name)}</span><br />
        <span class="svc-meta"><span class="svc-details-link">Details</span> · ${priceLabel}</span>
        <span class="svc-desc" hidden>${escapeHtml(s.description)}</span>
      </span>
      <span class="svc-chevron">›</span>
    </div>`;
}

// ---------------------------------------------------------------------------
// Step 2: artist
// ---------------------------------------------------------------------------

function renderArtistStep() {
  const wrap = $("step-content");
  wrap.innerHTML = `<div class="artist-grid-2">${artists.map(artistCardHtml).join("")}</div>`;

  wrap.querySelectorAll(".artist-card-2").forEach((card) => {
    card.querySelector(".btn-book").addEventListener("click", () => {
      state.artist = artists.find((a) => a.id === Number(card.dataset.id));
      state.date = null;
      state.time = null;
      goTo("datetime");
    });
  });
}

function artistCardHtml(a) {
  const initials = a.name.split(" ").map((w) => w[0]).slice(0, 2).join("").toUpperCase();
  return `
    <div class="artist-card-2" data-id="${a.id}">
      <div class="artist-avatar">${initials}</div>
      <div class="artist-name">${escapeHtml(a.name)}</div>
      <div class="artist-rate">${escapeHtml(a.rate_note || a.styles)}</div>
      <button class="btn-book">Book</button>
    </div>`;
}

// ---------------------------------------------------------------------------
// Step 3: date & time
// ---------------------------------------------------------------------------

function shiftMonth(delta) {
  const [y, m] = calendarMonthCursor.split("-").map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  calendarMonthCursor = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
  monthAvail = {}; // new month — availability must be re-fetched
}

function availabilityUrl(dateStr) {
  const url = new URL("/api/availability", location.origin);
  url.searchParams.set("date", dateStr);
  url.searchParams.set("artist_id", state.artist.id);
  if (state.service.id) {
    url.searchParams.set("service_id", state.service.id);
  } else {
    url.searchParams.set("duration", state.service.duration_minutes);
  }
  return url;
}

// Fetch open-slot counts for every bookable day in the visible month so the
// grid can show availability at a glance (open / fully booked) instead of
// forcing a click on each day to find out. Uses only the public availability
// endpoint, one lightweight request per candidate day.
async function loadMonthAvailability() {
  // Curated calendars compute their dots synchronously in renderCalendarGrid.
  if (curatedMode()) return;
  const [y, m] = calendarMonthCursor.split("-").map(Number);
  const daysInMonth = new Date(y, m, 0).getDate();
  const today = todayISO();
  const token = ++monthAvailToken;

  const candidates = [];
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const dow = new Date(y, m - 1, day).getDay();
    const dayHours = hours.find((h) => h.day_of_week === dow);
    const closed = !dayHours || dayHours.closed;
    const outsideWindow =
      (linkBookableFrom && iso < linkBookableFrom) || (linkBookableUntil && iso > linkBookableUntil);
    if (closed || iso < today || outsideWindow) continue;
    candidates.push(iso);
  }

  await Promise.all(
    candidates.map(async (iso) => {
      try {
        const data = await fetch(availabilityUrl(iso)).then((r) => r.json());
        monthAvail[iso] = (data[0] && data[0].slots ? data[0].slots.length : 0);
      } catch {
        /* leave undefined — day just renders neutral */
      }
    })
  );

  if (token === monthAvailToken) renderCalendarGrid(); // ignore stale month
}

function renderDateTimeStep() {
  if (!calendarMonthCursor) {
    calendarMonthCursor = "2026-08-01"; // demo default — Black Craft Custom Tattoos, August 2026
  }

  const wrap = $("step-content");
  wrap.innerHTML = `
    <div class="datetime-layout">
      <div class="cal-panel">
        <div class="cal-month-head">
          <div class="cal-month-label" id="cal-month-label"></div>
          <div class="cal-month-nav">
            <button id="cal-prev-month" aria-label="Previous month">‹</button>
            <button id="cal-next-month" aria-label="Next month">›</button>
          </div>
        </div>
        <div class="cal-weekdays"><span>Mo</span><span>Tu</span><span>We</span><span>Th</span><span>Fr</span><span>Sa</span><span>Su</span></div>
        <div class="cal-days-grid" id="cal-days-grid"></div>
        <div class="cal-legend">
          <span class="cal-legend-item"><span class="cal-dot open"></span>Available</span>
          ${curatedMode() ? "" : `<span class="cal-legend-item"><span class="cal-dot full"></span>Fully booked</span>`}
        </div>
      </div>
      <div class="time-panel" id="time-panel">
        <p class="no-slots-msg">Pick a date to see available times.</p>
      </div>
    </div>`;

  $("cal-prev-month").addEventListener("click", () => { shiftMonth(-1); renderCalendarGrid(); loadMonthAvailability(); });
  $("cal-next-month").addEventListener("click", () => { shiftMonth(1); renderCalendarGrid(); loadMonthAvailability(); });
  renderCalendarGrid();
  loadMonthAvailability();

  if (state.date) loadSlotsForDate(state.date);
}

function renderCalendarGrid() {
  const [y, m] = calendarMonthCursor.split("-").map(Number);
  $("cal-month-label").textContent = new Date(y, m - 1, 1).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  const firstDow = new Date(y, m - 1, 1).getDay(); // 0 = Sunday
  const leadingBlanks = firstDow === 0 ? 6 : firstDow - 1; // Monday-first grid
  const daysInMonth = new Date(y, m, 0).getDate();
  const today = todayISO();

  $("cal-prev-month").disabled = calendarMonthCursor <= `${today.slice(0, 7)}-01`;

  const curated = curatedMode();
  let html = "";
  for (let i = 0; i < leadingBlanks; i++) html += `<div class="cal-day empty"></div>`;
  for (let day = 1; day <= daysInMonth; day++) {
    const iso = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const isPast = iso < today;
    const classes = ["cal-day"];
    let disabled = false, na = false;

    if (curated) {
      // Only allowlisted dates are bookable; everything else is dimmed (na).
      if (isPast) disabled = true;
      else if (!curatedHasService(iso)) na = true;
      else classes.push("has-open");
    } else {
      const dow = new Date(y, m - 1, day).getDay();
      const dayHours = hours.find((h) => h.day_of_week === dow);
      const closed = !dayHours || dayHours.closed;
      const outsideLinkWindow =
        (linkBookableFrom && iso < linkBookableFrom) || (linkBookableUntil && iso > linkBookableUntil);
      disabled = closed || isPast || outsideLinkWindow;
      // 0 open slots = fully booked, >0 = available (once counts have loaded).
      if (!disabled && monthAvail[iso] !== undefined) {
        classes.push(monthAvail[iso] > 0 ? "has-open" : "is-full");
      }
    }

    if (disabled) classes.push("disabled");
    if (na) classes.push("na");
    if (iso === today) classes.push("today");
    if (iso === state.date) classes.push("selected");
    html += `<div class="${classes.join(" ")}" data-date="${iso}">${day}</div>`;
  }
  $("cal-days-grid").innerHTML = html;

  $("cal-days-grid").querySelectorAll(".cal-day:not(.disabled):not(.empty):not(.na)").forEach((cell) => {
    cell.addEventListener("click", () => {
      state.date = cell.dataset.date;
      state.time = null;
      renderCalendarGrid();
      loadSlotsForDate(state.date);
    });
  });
}

async function loadSlotsForDate(dateStr) {
  const panel = $("time-panel");
  panel.innerHTML = `<p class="time-date-label">${fmtDateLong(dateStr)}</p><p class="no-slots-msg">Loading…</p>`;

  let slots;
  if (curatedMode()) {
    slots = curatedSlots(dateStr);
  } else {
    let data;
    try {
      data = await fetch(availabilityUrl(dateStr)).then((r) => r.json());
    } catch {
      panel.innerHTML = `<p class="time-date-label">${fmtDateLong(dateStr)}</p><p class="no-slots-msg">Couldn't load times — try again.</p>`;
      return;
    }
    slots = (data[0] && data[0].slots) || [];
  }

  if (slots.length === 0) {
    panel.innerHTML = `<p class="time-date-label">${fmtDateLong(dateStr)}</p><p class="no-slots-msg">No availability that day — try another date.</p>`;
    return;
  }

  panel.innerHTML = `
    <p class="time-date-label">${fmtDateLong(dateStr)}</p>
    <div class="time-slot-list">
      ${slots.map((t) => `<button class="time-slot ${t === state.time ? "selected" : ""}" data-time="${t}">${fmtTime(t)}</button>`).join("")}
    </div>`;

  panel.querySelectorAll(".time-slot").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.time = btn.dataset.time;
      goTo("details");
    });
  });
}

// ---------------------------------------------------------------------------
// Step 4: details
// ---------------------------------------------------------------------------

function renderDetailsStep() {
  const wrap = $("step-content");
  wrap.innerHTML = `
    <form id="booking-form">
      <div class="field"><label for="f-name">Name</label><input id="f-name" type="text" required autocomplete="name" /></div>
      <div class="field"><label for="f-email">Email</label><input id="f-email" type="email" required autocomplete="email" /></div>
      <div class="field"><label for="f-phone">Phone <span class="optional">optional</span></label><input id="f-phone" type="tel" autocomplete="tel" /></div>
      <div class="field">
        <label for="f-desc">What are you thinking of getting?</label>
        <textarea id="f-desc" rows="4" required placeholder="Placement, size, style, subject — whatever you know so far."></textarea>
      </div>
      <div class="field">
        <label>Reference photos <span class="optional">optional</span></label>
        <div class="uploader" id="uploader">
          <input id="f-images" type="file" accept="image/*" multiple hidden />
          <button type="button" class="upload-btn" id="upload-btn">＋ Add photos</button>
          <span class="upload-hint">or drop images here</span>
        </div>
        <div class="upload-previews" id="upload-previews"></div>
      </div>
      <div class="field">
        <label for="f-refs">Anything else / links <span class="optional">optional</span></label>
        <textarea id="f-refs" rows="2" placeholder="Pinterest or Instagram links, or notes about the idea."></textarea>
      </div>
      <p class="field-error" id="form-error" hidden></p>
      ${config.payments_enabled ? `<p class="deposit-note">${config.demo_mode ? `<strong>Demo — no real charge.</strong> This shows our secure checkout; use any Stripe test card. ` : ""}A £${config.deposit_amount} deposit secures your slot — it comes off the total on the day${config.demo_mode ? "" : ", and you'll be taken to our secure checkout to pay"}.</p>` : ""}
      <button type="submit" class="cta" id="submit-btn">${bookCtaLabel()}</button>
    </form>`;

  $("booking-form").addEventListener("submit", submitBooking);
  wireImageUpload();
  renderPreviews();
}

// --- Reference photo upload (client-side downscale → data URLs) ------------
const MAX_IMAGES = 6;

async function fileToScaledDataUrl(file) {
  const dataUrl = await new Promise((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
  const img = await new Promise((res, rej) => {
    const i = new Image();
    i.onload = () => res(i);
    i.onerror = rej;
    i.src = dataUrl;
  });
  const maxDim = 1400;
  let { width, height } = img;
  if (Math.max(width, height) > maxDim) {
    const s = maxDim / Math.max(width, height);
    width = Math.round(width * s);
    height = Math.round(height * s);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.82); // downscaled so payloads stay small
}

function renderPreviews() {
  const wrap = $("upload-previews");
  if (!wrap) return;
  wrap.innerHTML = refImages
    .map((src, i) => `<div class="preview"><img src="${src}" alt="reference ${i + 1}" /><button type="button" class="preview-remove" data-i="${i}" aria-label="Remove photo">×</button></div>`)
    .join("");
  wrap.querySelectorAll(".preview-remove").forEach((b) =>
    b.addEventListener("click", () => { refImages.splice(Number(b.dataset.i), 1); renderPreviews(); })
  );
}

async function addFiles(fileList) {
  for (const f of Array.from(fileList)) {
    if (refImages.length >= MAX_IMAGES) break;
    if (!f.type.startsWith("image/")) continue;
    try { refImages.push(await fileToScaledDataUrl(f)); } catch { /* skip unreadable file */ }
  }
  renderPreviews();
}

function wireImageUpload() {
  const input = $("f-images"), btn = $("upload-btn"), zone = $("uploader");
  if (!input || !btn) return;
  btn.addEventListener("click", () => input.click());
  input.addEventListener("change", () => { addFiles(input.files); input.value = ""; });
  if (zone) {
    ["dragover", "dragenter"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.add("drag"); }));
    ["dragleave", "drop"].forEach((ev) => zone.addEventListener(ev, (e) => { e.preventDefault(); zone.classList.remove("drag"); }));
    zone.addEventListener("drop", (e) => { if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files); });
  }
}

async function submitBooking(e) {
  e.preventDefault();
  const errEl = $("form-error");
  errEl.hidden = true;
  const btn = $("submit-btn");
  btn.disabled = true;
  btn.textContent = config.payments_enabled ? "Redirecting to payment…" : "Booking…";

  try {
    const res = await fetch("/api/bookings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: $("f-name").value,
        email: $("f-email").value,
        phone: $("f-phone").value,
        description: $("f-desc").value,
        reference_notes: $("f-refs").value,
        reference_images: refImages,
        artist_id: state.artist.id,
        service_id: state.service.id,
        link_slug: linkMode ? linkSlug : undefined,
        date: state.date,
        start_time: state.time,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    // Payments on → server returns a Stripe Checkout URL to collect the
    // deposit; hand off to it. Payments off → booking is already confirmed.
    if (data.checkout_url) {
      window.location.href = data.checkout_url;
      return;
    }
    consentToken = data.consent_token || null;
    goTo("done");
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
    if (/taken/i.test(err.message)) {
      state.time = null;
      goTo("datetime");
    }
  } finally {
    btn.disabled = false;
    btn.textContent = bookCtaLabel();
  }
}

// ---------------------------------------------------------------------------
// Step 5: done
// ---------------------------------------------------------------------------

function renderDoneStep() {
  const wrap = $("step-content");
  wrap.innerHTML = `
    <div class="confirm-card" style="margin:0 auto;text-align:center;max-width:420px;">
      <span class="confirm-mark">✦</span>
      <h2>You're booked in.</h2>
      <p>${fmtDateLong(state.date)} at ${fmtTime(state.time)} with ${escapeHtml(state.artist.name)}.</p>
      <p class="confirm-note">We've saved your details — if anything changes, get in touch and we'll sort it.</p>
      ${consentToken ? `<a class="cta" href="/consent/${encodeURIComponent(consentToken)}" style="display:inline-block;text-decoration:none;">Complete your consent form</a>` : ""}
      <button class="cta ghost" id="book-another" style="margin-top:0.7rem;">Book another session</button>
    </div>`;
  $("book-another").addEventListener("click", () => location.reload());
}

// ---------------------------------------------------------------------------
// Sidebar summary
// ---------------------------------------------------------------------------

function renderSummary() {
  const card = $("summary-card");
  if (!state.service) {
    card.hidden = true;
    return;
  }
  card.hidden = false;

  const priceLabel = state.service.price == null
    ? (state.artist ? (state.artist.rate_note || "Price varies by artist") : "Price varies by artist")
    : (state.service.price === 0 ? "Free" : `£${state.service.price}`);

  const lines = [`
    <div class="summary-line">
      <div>
        <div class="summary-name">${escapeHtml(state.service.name)}</div>
        <div class="summary-sub">${fmtDuration(state.service.duration_minutes)}${state.artist ? " · with " + escapeHtml(state.artist.name) : ""}</div>
      </div>
      <div class="summary-price">${priceLabel}</div>
    </div>`];

  if (state.date && state.time) {
    lines.push(`
      <div class="summary-line">
        <div class="summary-sub">${fmtDateLong(state.date)} at ${fmtTime(state.time)}</div>
      </div>`);
  }

  $("summary-lines").innerHTML = lines.join("");
}

// ---------------------------------------------------------------------------
// Booking-link mode (customer arrived via /b/:slug — a shared flash-drop link)
// ---------------------------------------------------------------------------

function renderLinkUnavailable(data) {
  $("back-btn").hidden = true;
  $("step-title").textContent = "";
  $("summary-card").hidden = true;

  const messages = {
    full: "This offer is fully booked.",
    expired: "This link has expired.",
    paused: "This link isn't available right now.",
    not_found: "We couldn't find that booking link.",
    no_availability: "There are no available dates for this offer.",
  };
  const heading = data.title ? escapeHtml(data.title) : "Not available";
  const message = messages[data.status] || "This link isn't available anymore.";

  $("step-content").innerHTML = `
    <div class="confirm-card" style="margin:0 auto;text-align:center;max-width:420px;">
      <span class="confirm-mark">✦</span>
      <h2>${heading}</h2>
      <p class="confirm-note">${message}</p>
      <a href="/" class="cta ghost" style="display:inline-block;text-decoration:none;">See our services</a>
    </div>`;
}

async function loadStudioHoursBlurb() {
  hours = await fetch("/api/hours").then((r) => r.json());
  const openDays = hours.filter((h) => !h.closed);
  const closedDays = hours.filter((h) => h.closed).map((h) => DAY_NAMES[h.day_of_week]);
  $("studio-hours-blurb").textContent =
    (closedDays.length ? `Closed ${closedDays.join(" & ")}s. ` : "") +
    openDays.map((h) => `${DAY_NAMES[h.day_of_week].slice(0, 3)} ${fmtTime(h.open_time)}–${fmtTime(h.close_time)}`).join(" · ");
}

function hasAnyOpenDayInWindow(fromISO, untilISO) {
  let cursor = fromISO;
  for (let guard = 0; cursor <= untilISO && guard < 366; guard++) {
    const [y, m, d] = cursor.split("-").map(Number);
    const dow = new Date(y, m - 1, d).getDay();
    const dayHours = hours.find((h) => h.day_of_week === dow);
    if (dayHours && !dayHours.closed) return true;
    cursor = addDays(cursor, 1);
  }
  return false;
}

async function initLinkMode(slug) {
  linkMode = true;
  linkSlug = slug;

  // Awaited (not fire-and-forget) — the "no open day in this link's window"
  // check below needs `hours` populated before it can run.
  await loadStudioHoursBlurb();

  let data;
  try {
    const res = await fetch(`/api/links/${encodeURIComponent(slug)}`);
    data = await res.json();
    if (!res.ok) {
      renderLinkUnavailable({ status: "not_found" });
      return;
    }
  } catch {
    renderLinkUnavailable({ status: "not_found" });
    return;
  }

  if (data.status !== "open") {
    renderLinkUnavailable(data);
    return;
  }

  // Fabricate a "service" so the existing summary/step rendering works unchanged
  state.service = {
    id: null,
    name: data.title,
    duration_minutes: data.duration_minutes,
    price: data.price,
    description: data.description,
  };
  state.artist = { id: data.artist_id, name: data.artist_name, rate_note: "" };
  linkBookableFrom = data.bookable_from || null;
  linkBookableUntil = data.bookable_until || null;

  // A window that only ever lands on days the studio is closed (e.g. a
  // "today only" sale created on a day the shop happens to be shut) has
  // nothing to offer — say so plainly instead of showing a dead calendar.
  if (linkBookableFrom && linkBookableUntil && !hasAnyOpenDayInWindow(linkBookableFrom, linkBookableUntil)) {
    renderLinkUnavailable({ title: data.title, status: "no_availability" });
    return;
  }

  // Land on the month the window actually falls in, not always the current
  // month — a sale booked a week out shouldn't open on a blank calendar.
  if (linkBookableFrom) {
    calendarMonthCursor = `${linkBookableFrom.slice(0, 7)}-01`;
  }

  goTo("datetime");

  // A single-day window (e.g. "today only") has exactly one selectable date —
  // pick it automatically so the customer doesn't have to click it themselves.
  if (linkBookableFrom && linkBookableFrom === linkBookableUntil) {
    const dayCell = document.querySelector(`.cal-day[data-date="${linkBookableFrom}"]:not(.disabled)`);
    if (dayCell) dayCell.click();
  }
}

// ---------------------------------------------------------------------------
// Init
// ---------------------------------------------------------------------------

async function init() {
  config = await fetch("/api/config").then((r) => r.json()).catch(() => config);

  const studio = resolveStudio();
  activePreset = studio.preset;
  applyStudioName(studio.name);
  applyHeaderExtras();

  if (config.demo_mode) {
    const banner = $("demo-banner");
    if (banner) banner.hidden = false;
  }

  // Returning from Stripe Checkout (success_url / cancel_url).
  const params = new URLSearchParams(location.search);
  const bookingParam = params.get("booking");
  if (bookingParam === "paid" || bookingParam === "cancelled") {
    return renderPaymentReturn(bookingParam, params.get("session_id"));
  }

  const linkMatch = location.pathname.match(/^\/b\/([^/]+)\/?$/);
  if (linkMatch) {
    return initLinkMode(decodeURIComponent(linkMatch[1]));
  }

  const [svcs, arts] = await Promise.all([
    fetch("/api/services").then((r) => r.json()),
    fetch("/api/artists").then((r) => r.json()),
    loadStudioHoursBlurb(),
  ]);
  // Relabel with the studio's preset (display-only; real ids preserved).
  services = applyServicePreset(svcs);
  artists = applyArtistPreset(arts);

  render();
}

// Landing page after the customer returns from Stripe Checkout.
async function renderPaymentReturn(kind, sessionId) {
  $("back-btn").hidden = true;
  $("step-title").textContent = "";
  $("summary-card").hidden = true;
  loadStudioHoursBlurb();

  const wrap = $("step-content");
  if (kind === "cancelled") {
    wrap.innerHTML = `
      <div class="confirm-card" style="margin:0 auto;text-align:center;max-width:420px;">
        <span class="confirm-mark">✦</span>
        <h2>Payment cancelled</h2>
        <p class="confirm-note">No deposit was taken and the slot wasn't booked. Start again whenever you're ready.</p>
        <a href="/" class="cta ghost" style="display:inline-block;text-decoration:none;">Start a new booking</a>
      </div>`;
    return;
  }

  wrap.innerHTML = `
    <div class="confirm-card" style="margin:0 auto;text-align:center;max-width:420px;">
      <span class="confirm-mark">✦</span>
      <h2>You're booked in.</h2>
      <p class="confirm-note" id="pay-return-msg">Confirming your deposit…</p>
      <div id="pay-return-consent"></div>
      <a href="/" class="cta ghost" style="display:inline-block;text-decoration:none;margin-top:0.7rem;">Book another session</a>
    </div>`;

  const msg = $("pay-return-msg");
  if (!sessionId) {
    msg.textContent = "Deposit received — we'll see you then.";
    return;
  }

  const showConsent = (tok) => {
    if (!tok) return;
    $("pay-return-consent").innerHTML =
      `<a class="cta" href="/consent/${encodeURIComponent(tok)}" style="display:inline-block;text-decoration:none;">Complete your consent form</a>`;
  };

  // Poll briefly for the webhook to flip the booking to confirmed.
  for (let i = 0; i < 5; i++) {
    try {
      const s = await fetch(`/api/bookings/by-session/${encodeURIComponent(sessionId)}`).then((r) => r.json());
      if (s.status === "confirmed") {
        msg.textContent = "Deposit received — your booking is confirmed. We'll see you then.";
        showConsent(s.consent_token);
        return;
      }
      showConsent(s.consent_token);
    } catch { /* keep polling */ }
    await new Promise((r) => setTimeout(r, 1200));
  }
  msg.textContent = "Deposit received — your booking is being confirmed. Check your email shortly.";
}

init();
