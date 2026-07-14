/* Black Craft Custom Tattoos — owner dashboard shell: auth, tabs, chat panel, shared helpers */
import { renderCalendar } from "./owner-calendar.js";
import { renderClients } from "./owner-clients.js";
import { renderStats } from "./owner-stats.js";
import { renderLinks, linkFormFieldsHtml, wireLinkForm } from "./owner-links.js";

export const $ = (id) => document.getElementById(id);

// ---------------------------------------------------------------------------
// Shared fetch / UI helpers (used by the view modules too)
// ---------------------------------------------------------------------------

let token = sessionStorage.getItem("owner_token");

export async function api(path, opts = {}) {
  const res = await fetch(path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(opts.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (res.status === 401) {
    sessionStorage.removeItem("owner_token");
    location.reload();
    throw new Error("Session expired");
  }
  if (!res.ok) throw new Error(data.error || "Request failed.");
  return data;
}

export function toast(message, isError = false) {
  const el = document.createElement("div");
  el.className = `toast ${isError ? "error" : ""}`.trim();
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3200);
}

export function openDrawer(html) {
  const drawer = $("drawer");
  const overlay = $("overlay");
  drawer.innerHTML = `<button class="drawer-close" id="drawer-close-btn">×</button>${html}`;
  drawer.hidden = false;
  overlay.hidden = false;
  $("drawer-close-btn").addEventListener("click", closeDrawer);
  overlay.addEventListener("click", closeDrawer, { once: true });
}

export function closeDrawer() {
  $("drawer").hidden = true;
  $("overlay").hidden = true;
}

export function fmtTime(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hr = ((h + 11) % 12) + 1;
  return m === 0 ? `${hr}${suffix}` : `${hr}:${String(m).padStart(2, "0")}${suffix}`;
}

export function fmtDate(iso, opts = {}) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", {
    weekday: opts.short ? "short" : "long",
    day: "numeric",
    month: opts.short ? "short" : "long",
    year: opts.year ? "numeric" : undefined,
  });
}

export function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export function mondayOf(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const day = date.getDay(); // 0 = Sunday
  const diff = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + diff);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function addDays(iso, n) {
  const [y, m, d] = iso.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + n);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

// Fixed artist -> color slot mapping (identity, never re-cycled). Extend if
// more artists are added — falls back to sage for anything beyond slot 3.
const ARTIST_COLORS = ["#d1583a", "#b9791a", "#1f8f83"]; // deepened for the light theme
export function artistColor(artistId) {
  return ARTIST_COLORS[(artistId - 1) % ARTIST_COLORS.length] || "#5c8a35";
}

// ---------------------------------------------------------------------------
// Views
// ---------------------------------------------------------------------------

const views = {
  calendar: { mount: null, render: renderCalendar },
  clients: { mount: null, render: renderClients },
  stats: { mount: null, render: renderStats },
  links: { mount: null, render: renderLinks },
};
let activeView = "calendar";

function refreshActiveView() {
  const v = views[activeView];
  v.render(v.mount);
}

function switchView(name) {
  activeView = name;
  document.querySelectorAll(".dash-tabs .tab").forEach((t) => {
    t.classList.toggle("active", t.dataset.view === name);
  });
  Object.entries(views).forEach(([key, v]) => {
    v.mount.hidden = key !== name;
  });
  refreshActiveView();
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

function showDashboard() {
  $("login-view").hidden = true;
  $("dash-view").hidden = false;

  views.calendar.mount = $("view-calendar");
  views.clients.mount = $("view-clients");
  views.stats.mount = $("view-stats");
  views.links.mount = $("view-links");

  document.querySelectorAll(".dash-tabs .tab").forEach((tab) => {
    tab.addEventListener("click", () => switchView(tab.dataset.view));
  });

  switchView("calendar");
  initChat();
}

async function login() {
  const err = $("login-error");
  err.hidden = true;
  try {
    const res = await fetch("/api/owner/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ password: $("password").value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Login failed.");
    token = data.token;
    sessionStorage.setItem("owner_token", token);
    showDashboard();
  } catch (e) {
    err.textContent = e.message;
    err.hidden = false;
  }
}

$("login-btn").addEventListener("click", login);
$("password").addEventListener("keydown", (e) => { if (e.key === "Enter") login(); });

// ---------------------------------------------------------------------------
// Chat panel
// ---------------------------------------------------------------------------

// Pre-loaded so the chat panel looks like Craig has already been using it —
// still just a plain in-memory array, the same shape sendChat() appends to.
const history = [
  { role: "user", content: "what have I got this week" },
  { role: "assistant", content: "This week you've got Sam Whitfield in Thursday 6th for a full-day blackwork sleeve (9:30am–2:30pm, £350), and Priya Anand Friday 7th for a half-day blackwork forearm piece (4pm–7pm, £175). Elena's got Ellie Marsh booked in the following week too. Otherwise the week's looking pretty open." },
  { role: "user", content: "add a flash day link for august, £350 a slot, 6 spaces" },
  { role: "assistant", content: "Done — created \"August Special\": £350 per full-day slot, 6 spaces total, expires 31 August 2026. Share it at /b/august-special. 3 spaces are already booked, so 3 are left." },
];
let busy = false;

function addMsg(role, text, extraClass = "") {
  const div = document.createElement("div");
  div.className = `msg ${role} ${extraClass}`.trim();
  div.textContent = text;
  $("messages").appendChild(div);
  $("messages").scrollTop = $("messages").scrollHeight;
  return div;
}

async function sendChat(text) {
  const message = (text || $("input").value).trim();
  if (!message || busy) return;
  busy = true;
  $("input").value = "";
  $("input").style.height = "auto";
  $("suggestions").style.display = "none";

  addMsg("user", message);
  const pending = addMsg("assistant", "Thinking…", "thinking");

  try {
    const res = await fetch("/api/owner/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ history, message }),
    });
    const data = await res.json();
    if (res.status === 401) {
      sessionStorage.removeItem("owner_token");
      pending.remove();
      addMsg("assistant", "Session expired — refresh and log in again.", "error");
      return;
    }
    if (!res.ok) throw new Error(data.error || "Something went wrong.");

    pending.classList.remove("thinking");
    pending.textContent = data.reply;
    history.push({ role: "user", content: message });
    history.push({ role: "assistant", content: data.reply });

    if (data.form?.type === "booking_link") {
      await renderInlineLinkForm(data.form.prefill || {});
    }

    // The assistant may have changed data (booking, client notes, etc.) —
    // refresh whatever the owner is currently looking at.
    refreshActiveView();
  } catch (e) {
    pending.classList.remove("thinking");
    pending.classList.add("error");
    pending.textContent = e.message;
  } finally {
    busy = false;
    $("messages").scrollTop = $("messages").scrollHeight;
  }
}

async function renderInlineLinkForm(prefill) {
  let artists;
  try {
    artists = await api("/api/artists");
  } catch (e) {
    addMsg("assistant", `Couldn't load the form: ${e.message}`, "error");
    return;
  }

  const box = document.createElement("div");
  box.className = "msg assistant form-msg";
  box.innerHTML = linkFormFieldsHtml(artists, prefill);
  $("messages").appendChild(box);
  $("messages").scrollTop = $("messages").scrollHeight;

  wireLinkForm(box, artists, {
    onCreated: (created) => {
      box.remove();
      addMsg("assistant", `Link created: /b/${created.slug}`);
      refreshActiveView();
    },
  });
}

function initChat() {
  for (const turn of history) addMsg(turn.role, turn.content);
  addMsg("assistant", "Morning. Ask me about the schedule, clients, or tell me what to change.");
  $("send-btn").addEventListener("click", () => sendChat());
  $("input").addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); sendChat(); }
  });
  $("input").addEventListener("input", (e) => {
    e.target.style.height = "auto";
    e.target.style.height = Math.min(e.target.scrollHeight, 110) + "px";
  });
  $("suggestions").addEventListener("click", (e) => {
    if (e.target.tagName === "BUTTON") sendChat(e.target.textContent);
  });
  $("chat-toggle").addEventListener("click", () => $("chat-panel").classList.toggle("open"));
  $("chat-close").addEventListener("click", () => $("chat-panel").classList.remove("open"));
}

if (token) showDashboard();
