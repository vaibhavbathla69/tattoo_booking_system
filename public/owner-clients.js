/* Black Craft Custom Tattoos — clients (CRM) view: searchable list + profile drawer */
import { api, toast, openDrawer, closeDrawer, fmtTime, fmtDate } from "./owner-app.js";

let query = "";
let inactiveMonths = "";

export async function renderClients(mount) {
  if (!mount) return;
  mount.innerHTML = `<h2 class="view-title">Clients</h2><p class="crm-empty">Loading…</p>`;

  const params = new URLSearchParams();
  if (query) params.set("query", query);
  if (inactiveMonths) params.set("inactive_months", inactiveMonths);

  let clients;
  try {
    clients = await api(`/api/owner/clients?${params.toString()}`);
  } catch (e) {
    mount.innerHTML = `<h2 class="view-title">Clients</h2><p class="crm-empty">${e.message}</p>`;
    return;
  }

  mount.innerHTML = `
    <h2 class="view-title">Clients</h2>
    <div class="toolbar">
      <input type="text" id="crm-search" placeholder="Search name or email…" value="${escapeAttr(query)}" style="min-width:220px" />
      <select id="crm-inactive">
        <option value="">Any activity</option>
        <option value="3" ${inactiveMonths === "3" ? "selected" : ""}>Inactive 3+ months</option>
        <option value="6" ${inactiveMonths === "6" ? "selected" : ""}>Inactive 6+ months</option>
        <option value="12" ${inactiveMonths === "12" ? "selected" : ""}>Inactive 12+ months</option>
      </select>
      <span class="spacer"></span>
      <span class="muted" style="color:var(--ink-dim);font-size:0.8rem;">${clients.length} client${clients.length === 1 ? "" : "s"}</span>
    </div>

    ${clients.length === 0
      ? `<p class="crm-empty">No clients match.</p>`
      : `<table class="crm-table">
          <thead><tr>
            <th>Name</th><th>Contact</th><th>Visits</th><th>Last visit</th><th>Notes</th>
          </tr></thead>
          <tbody>
            ${clients.map((c) => `
              <tr data-client-id="${c.id}">
                <td>${escapeHtml(c.name)}</td>
                <td class="muted">${escapeHtml(c.email || "—")}${c.phone ? " · " + escapeHtml(c.phone) : ""}</td>
                <td>${c.total_bookings}</td>
                <td class="muted">${c.last_visit ? fmtDate(c.last_visit, { short: true, year: true }) : "never"}</td>
                <td class="muted">${escapeHtml(truncate(c.notes, 40)) || "—"}</td>
              </tr>
            `).join("")}
          </tbody>
        </table>`
    }
  `;

  mount.querySelector("#crm-search").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { query = e.target.value.trim(); renderClients(mount); }
  });
  mount.querySelector("#crm-search").addEventListener("blur", (e) => {
    if (query !== e.target.value.trim()) { query = e.target.value.trim(); renderClients(mount); }
  });
  mount.querySelector("#crm-inactive").addEventListener("change", (e) => {
    inactiveMonths = e.target.value; renderClients(mount);
  });

  mount.querySelectorAll("tbody tr").forEach((row) => {
    row.addEventListener("click", () => openClientDrawer(row.dataset.clientId, mount));
  });
}

async function openClientDrawer(clientId, mount) {
  let client;
  try {
    client = await api(`/api/owner/clients/${clientId}`);
  } catch (e) {
    return toast(e.message, true);
  }

  const history = (client.bookings || []);
  openDrawer(`
    <h3>${escapeHtml(client.name)}</h3>
    <p class="drawer-sub">${escapeHtml(client.email || "no email")} ${client.phone ? "· " + escapeHtml(client.phone) : ""}</p>

    <div class="field">
      <label>Owner notes</label>
      <textarea id="c-notes" rows="4">${escapeHtml(client.notes || "")}</textarea>
    </div>
    <div class="actions">
      <button class="btn-primary" id="c-save-notes">Save notes</button>
    </div>

    <div class="field" style="margin-top:1.6rem;">
      <label>Booking history (${history.length})</label>
      <div class="history-list">
        ${history.length === 0 ? `<p class="muted" style="color:var(--ink-dim);font-size:0.85rem;">No bookings yet.</p>` :
          history.map((b) => `
            <div class="history-item">
              <span class="hist-date">${fmtDate(b.date, { short: true, year: true })}</span> at ${fmtTime(b.start_time)}
              — ${escapeHtml(b.artist_name)}
              <span class="status-pill ${b.status}" style="margin-left:0.4rem;">${b.status.replace("_", " ")}</span>
              ${b.style ? `<br><span class="muted" style="color:var(--ink-dim);">${escapeHtml(b.style)}</span>` : ""}
              ${b.price != null ? `<br><span class="muted" style="color:var(--ink-dim);">£${b.price}</span>` : ""}
            </div>
          `).join("")}
      </div>
    </div>
  `);

  document.getElementById("c-save-notes").addEventListener("click", async () => {
    try {
      await api(`/api/owner/clients/${clientId}/notes`, {
        method: "PUT",
        body: JSON.stringify({ notes: document.getElementById("c-notes").value }),
      });
      toast("Notes saved.");
      closeDrawer();
      renderClients(mount);
    } catch (e) {
      toast(e.message, true);
    }
  });
}

function truncate(s, n) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}
