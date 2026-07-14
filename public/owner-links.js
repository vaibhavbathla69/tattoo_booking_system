/* Black Craft Custom Tattoos — booking links view: create/manage shareable flash-drop links */
import { api, toast, openDrawer, closeDrawer, fmtDate, todayISO } from "./owner-app.js";

function dateWindowLabel(l) {
  if (!l.bookable_from && !l.bookable_until) return "any date";
  if (l.bookable_from && l.bookable_from === l.bookable_until) {
    return l.bookable_from === todayISO() ? "today only" : fmtDate(l.bookable_from, { short: true, year: true });
  }
  const from = l.bookable_from ? fmtDate(l.bookable_from, { short: true }) : "…";
  const until = l.bookable_until ? fmtDate(l.bookable_until, { short: true, year: true }) : "…";
  return `${from} – ${until}`;
}

export async function renderLinks(mount) {
  if (!mount) return;
  mount.innerHTML = `<h2 class="view-title">Booking Links</h2><p class="crm-empty">Loading…</p>`;

  let links, artists;
  try {
    [links, artists] = await Promise.all([
      api("/api/owner/links"),
      api("/api/artists"),
    ]);
  } catch (e) {
    mount.innerHTML = `<h2 class="view-title">Booking Links</h2><p class="crm-empty">${e.message}</p>`;
    return;
  }

  mount.innerHTML = `
    <h2 class="view-title">Booking Links</h2>
    <p style="color:var(--ink-dim);font-size:0.85rem;margin-bottom:1rem;">
      Share a link for a one-off offer — a flash sheet, a promotion — with one fixed artist, price, and duration.
    </p>
    <div class="toolbar">
      <span class="spacer"></span>
      <button class="btn-primary" id="link-new">+ New link</button>
    </div>
    ${links.length === 0
      ? `<p class="crm-empty">No booking links yet.</p>`
      : `<table class="crm-table">
          <thead><tr>
            <th>Title</th><th>Artist</th><th>Price</th><th>Booked</th><th>Status</th><th>Dates</th><th>Link</th>
          </tr></thead>
          <tbody>
            ${links.map((l) => `
              <tr data-link-id="${l.id}">
                <td>${escapeHtml(l.title)}</td>
                <td class="muted">${escapeHtml(l.artist_name)}</td>
                <td>£${l.price}</td>
                <td class="muted">${l.booked_count}${l.max_bookings != null ? ` / ${l.max_bookings}` : ""}</td>
                <td><span class="status-pill ${l.status}">${l.status}</span></td>
                <td class="muted">${dateWindowLabel(l)}</td>
                <td class="muted"><code>/b/${escapeHtml(l.slug)}</code></td>
              </tr>
            `).join("")}
          </tbody>
        </table>`
    }
  `;

  mount.querySelector("#link-new").addEventListener("click", () => openLinkForm(artists, mount));
  mount.querySelectorAll("tbody tr").forEach((row) => {
    const link = links.find((l) => String(l.id) === row.dataset.linkId);
    row.addEventListener("click", () => openLinkDrawer(link, artists, mount));
  });
}

function resolveArtistIdByName(artists, name) {
  if (!name) return null;
  const match = artists.find((a) => a.name.toLowerCase().includes(String(name).toLowerCase()));
  return match ? match.id : null;
}

/**
 * Field markup for creating a booking link, reused by both the dashboard's
 * "+ New link" drawer and the inline form the chat assistant can open.
 * Fields are addressed by `data-field`, not `id` — this same markup can be
 * live in the DOM more than once at a time (a drawer open alongside a chat
 * message), and duplicate ids would make `getElementById` grab the wrong one.
 */
export function linkFormFieldsHtml(artists, prefill = {}) {
  const preselectId = prefill.artist ? resolveArtistIdByName(artists, prefill.artist) : null;
  const todayOnly = !!prefill.today_only;
  const bookableFrom = prefill.bookable_from || (todayOnly ? todayISO() : "");
  const bookableUntil = prefill.bookable_until || (todayOnly ? todayISO() : "");

  return `
    <div class="field"><label>Title</label><input type="text" data-field="title" placeholder="Summer Flash Sheet" value="${escapeHtml(prefill.title || "")}" /></div>
    <div class="field"><label>Description <span style="opacity:.6">optional</span></label><textarea data-field="description" rows="3" placeholder="Sizing, placement, what's on offer…">${escapeHtml(prefill.description || "")}</textarea></div>

    <div class="field-row">
      <div class="field"><label>Artist</label>
        <select data-field="artist">${artists.map((a) => `<option value="${a.id}" ${a.id === preselectId ? "selected" : ""}>${escapeHtml(a.name)}</option>`).join("")}</select>
      </div>
      <div class="field"><label>Price (£)</label><input type="number" data-field="price" min="0" step="1" value="${prefill.price ?? ""}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Duration (min)</label><input type="number" data-field="duration" min="15" step="15" value="${prefill.duration_minutes ?? 60}" /></div>
      <div class="field"><label>Max bookings <span style="opacity:.6">optional</span></label><input type="number" data-field="max" min="1" step="1" value="${prefill.max_bookings ?? ""}" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Bookable from <span style="opacity:.6">optional</span></label><input type="date" data-field="bookable-from" value="${bookableFrom}" /></div>
      <div class="field"><label>Bookable until <span style="opacity:.6">optional</span></label><input type="date" data-field="bookable-until" value="${bookableUntil}" /></div>
    </div>
    <p style="margin:-0.6rem 0 1rem;">
      <button type="button" class="btn-ghost" data-action="today-only" style="font-size:0.78rem;padding:0.35rem 0.8rem;">Today only</button>
      <span style="color:var(--ink-dim);font-size:0.78rem;margin-left:0.5rem;">Leave both blank to allow any open date.</span>
    </p>
    <div class="field"><label>Link expires <span style="opacity:.6">optional</span></label><input type="date" data-field="expires" value="${prefill.expires_at || ""}" /></div>

    <div class="actions">
      <button class="btn-primary" data-action="save">Create link</button>
    </div>
  `;
}

/** Wires up the "Today only" button and submit handler for a container that
 * already holds `linkFormFieldsHtml` markup. Calls `onCreated(link)` on success. */
export function wireLinkForm(container, artists, { onCreated }) {
  const field = (name) => container.querySelector(`[data-field="${name}"]`);

  container.querySelector('[data-action="today-only"]').addEventListener("click", () => {
    field("bookable-from").value = todayISO();
    field("bookable-until").value = todayISO();
  });

  container.querySelector('[data-action="save"]').addEventListener("click", async () => {
    const title = field("title").value.trim();
    const price = field("price").value;
    const duration = field("duration").value;
    if (!title) return toast("Title is required.", true);
    if (price === "") return toast("Price is required.", true);
    if (!duration) return toast("Duration is required.", true);

    try {
      const created = await api("/api/owner/links", {
        method: "POST",
        body: JSON.stringify({
          title,
          description: field("description").value.trim(),
          artist: Number(field("artist").value),
          price: Number(price),
          duration_minutes: Number(duration),
          max_bookings: field("max").value ? Number(field("max").value) : undefined,
          expires_at: field("expires").value || undefined,
          bookable_from: field("bookable-from").value || undefined,
          bookable_until: field("bookable-until").value || undefined,
        }),
      });
      onCreated(created);
    } catch (e) {
      toast(e.message, true);
    }
  });
}

function openLinkForm(artists, mount) {
  openDrawer(`
    <h3>New booking link</h3>
    <p class="drawer-sub">Fixes one artist, price, and duration for whoever books through it.</p>
    ${linkFormFieldsHtml(artists)}
  `);

  wireLinkForm(document.getElementById("drawer"), artists, {
    onCreated: (created) => {
      toast(`Link created: /b/${created.slug}`);
      closeDrawer();
      renderLinks(mount);
    },
  });
}

function openLinkDrawer(link, artists, mount) {
  const fullUrl = `${location.origin}/b/${link.slug}`;
  openDrawer(`
    <h3>${escapeHtml(link.title)}</h3>
    <p class="drawer-sub">
      <span class="status-pill ${link.status}">${link.status}</span>
      &nbsp;·&nbsp; ${link.booked_count}${link.max_bookings != null ? ` / ${link.max_bookings}` : ""} booked
    </p>

    <div class="field">
      <label>Shareable link</label>
      <div class="link-url-row">
        <code>${escapeHtml(fullUrl)}</code>
        <button class="btn-copy" id="l-copy">Copy</button>
      </div>
    </div>

    <div class="field-row">
      <div class="field"><label>Artist</label>
        <select id="l-artist">${artists.map((a) => `<option value="${a.id}" ${a.id === link.artist_id ? "selected" : ""}>${escapeHtml(a.name)}</option>`).join("")}</select>
      </div>
      <div class="field"><label>Price (£)</label><input type="number" id="l-price" value="${link.price}" min="0" step="1" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Duration (min)</label><input type="number" id="l-duration" value="${link.duration_minutes}" min="15" step="15" /></div>
      <div class="field"><label>Max bookings <span style="opacity:.6">optional</span></label><input type="number" id="l-max" value="${link.max_bookings ?? ""}" min="1" step="1" /></div>
    </div>
    <div class="field-row">
      <div class="field"><label>Bookable from <span style="opacity:.6">optional</span></label><input type="date" id="l-bookable-from" value="${link.bookable_from ?? ""}" /></div>
      <div class="field"><label>Bookable until <span style="opacity:.6">optional</span></label><input type="date" id="l-bookable-until" value="${link.bookable_until ?? ""}" /></div>
    </div>
    <p style="margin:-0.6rem 0 1rem;">
      <button type="button" class="btn-ghost" id="l-today-only" style="font-size:0.78rem;padding:0.35rem 0.8rem;">Today only</button>
      <button type="button" class="btn-ghost" id="l-clear-dates" style="font-size:0.78rem;padding:0.35rem 0.8rem;">Any date</button>
    </p>
    <div class="field"><label>Link expires <span style="opacity:.6">optional</span></label><input type="date" id="l-expires" value="${link.expires_at ?? ""}" /></div>
    <div class="field"><label>Description</label><textarea id="l-desc" rows="3">${escapeHtml(link.description || "")}</textarea></div>

    <div class="actions">
      <button class="btn-primary" id="l-save">Save changes</button>
      <button class="btn-ghost" id="l-toggle">${link.active ? "Pause link" : "Reactivate link"}</button>
    </div>
  `);

  document.getElementById("l-today-only").addEventListener("click", () => {
    document.getElementById("l-bookable-from").value = todayISO();
    document.getElementById("l-bookable-until").value = todayISO();
  });
  document.getElementById("l-clear-dates").addEventListener("click", () => {
    document.getElementById("l-bookable-from").value = "";
    document.getElementById("l-bookable-until").value = "";
  });

  document.getElementById("l-copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(fullUrl);
      toast("Link copied.");
    } catch {
      toast("Couldn't copy — select and copy manually.", true);
    }
  });

  document.getElementById("l-save").addEventListener("click", async () => {
    try {
      await api(`/api/owner/links/${link.id}`, {
        method: "PATCH",
        body: JSON.stringify({
          artist: Number(document.getElementById("l-artist").value),
          price: Number(document.getElementById("l-price").value),
          duration_minutes: Number(document.getElementById("l-duration").value),
          max_bookings: document.getElementById("l-max").value ? Number(document.getElementById("l-max").value) : null,
          expires_at: document.getElementById("l-expires").value || null,
          bookable_from: document.getElementById("l-bookable-from").value || null,
          bookable_until: document.getElementById("l-bookable-until").value || null,
          description: document.getElementById("l-desc").value.trim(),
        }),
      });
      toast("Link updated.");
      closeDrawer();
      renderLinks(mount);
    } catch (e) {
      toast(e.message, true);
    }
  });

  document.getElementById("l-toggle").addEventListener("click", async () => {
    try {
      await api(`/api/owner/links/${link.id}`, {
        method: "PATCH",
        body: JSON.stringify({ active: !link.active }),
      });
      toast(link.active ? "Link paused." : "Link reactivated.");
      closeDrawer();
      renderLinks(mount);
    } catch (e) {
      toast(e.message, true);
    }
  });
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
