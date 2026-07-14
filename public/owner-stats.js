/* Black Craft Custom Tattoos — stats view: stat tiles + bar charts (Chart.js) */
import { api, todayISO, addDays, mondayOf, artistColor } from "./owner-app.js";

// Non-artist single-series charts use the sage slot (validated alongside the
// three artist colors — see owner.css .viz-root) so it never collides with
// an artist's identity color.
const SINGLE_SERIES_HUE = "#5c8a35";

let preset = "august_2026"; // demo default — the season the seeded data lives in
let charts = []; // Chart.js instances — destroy before re-render to avoid leaks

function rangeFor(preset) {
  const today = todayISO();
  if (preset === "august_2026") return ["2026-08-01", "2026-08-31"];
  if (preset === "this_week") return [mondayOf(today), addDays(mondayOf(today), 6)];
  if (preset === "last_30") return [addDays(today, -29), today];
  if (preset === "last_month") {
    const [y, m] = today.split("-").map(Number);
    const firstOfThis = `${y}-${String(m).padStart(2, "0")}-01`;
    const lastOfPrev = addDays(firstOfThis, -1);
    const [py, pm] = lastOfPrev.split("-").map(Number);
    return [`${py}-${String(pm).padStart(2, "0")}-01`, lastOfPrev];
  }
  // this_month (default)
  const [y, m] = today.split("-").map(Number);
  return [`${y}-${String(m).padStart(2, "0")}-01`, today];
}

// SUM() over zero rows is SQL NULL, so empty ranges come back as null for
// every field except COUNT — coalesce to 0 so tiles never read "null".
const num = (v) => Number(v || 0);

export async function renderStats(mount) {
  if (!mount) return;
  charts.forEach((c) => c.destroy());
  charts = [];

  mount.innerHTML = `<h2 class="view-title">Stats</h2><p class="chart-empty">Loading…</p>`;

  const [start, end] = rangeFor(preset);
  let stats;
  try {
    stats = await api(`/api/owner/stats?start_date=${start}&end_date=${end}`);
  } catch (e) {
    mount.innerHTML = `<h2 class="view-title">Stats</h2><p class="chart-empty">${e.message}</p>`;
    return;
  }

  mount.innerHTML = `
    <h2 class="view-title">Stats</h2>
    <div class="toolbar">
      <select id="stats-preset">
        <option value="august_2026" ${preset === "august_2026" ? "selected" : ""}>August 2026</option>
        <option value="this_week" ${preset === "this_week" ? "selected" : ""}>This week</option>
        <option value="this_month" ${preset === "this_month" ? "selected" : ""}>This month</option>
        <option value="last_month" ${preset === "last_month" ? "selected" : ""}>Last month</option>
        <option value="last_30" ${preset === "last_30" ? "selected" : ""}>Last 30 days</option>
      </select>
    </div>

    <div class="stat-tiles">
      <div class="stat-tile"><div class="stat-label">Bookings</div><div class="stat-value">${num(stats.total_bookings)}</div></div>
      <div class="stat-tile"><div class="stat-label">Completed</div><div class="stat-value">${num(stats.completed)}</div></div>
      <div class="stat-tile"><div class="stat-label">Cancelled</div><div class="stat-value">${num(stats.cancelled)}</div></div>
      <div class="stat-tile"><div class="stat-label">No-shows</div><div class="stat-value">${num(stats.no_shows)}</div></div>
      <div class="stat-tile accent"><div class="stat-label">Recorded revenue</div><div class="stat-value">£${num(stats.revenue).toFixed(0)}</div></div>
    </div>

    <div class="chart-grid">
      <div class="chart-card">
        <h4>Bookings by artist</h4>
        <div id="chart-artist-wrap"></div>
      </div>
      <div class="chart-card">
        <h4>Popular styles</h4>
        <div id="chart-style-wrap"></div>
      </div>
    </div>
  `;

  mount.querySelector("#stats-preset").addEventListener("change", (e) => {
    preset = e.target.value;
    renderStats(mount);
  });

  renderArtistChart(mount, stats.by_artist || []);
  renderStyleChart(mount, stats.by_style || []);
}

function renderArtistChart(mount, byArtist) {
  const wrap = mount.querySelector("#chart-artist-wrap");
  if (byArtist.length === 0) {
    wrap.innerHTML = `<p class="chart-empty">No bookings in this range.</p>`;
    return;
  }
  wrap.innerHTML = `<canvas></canvas>`;
  const ctx = wrap.querySelector("canvas");

  // Fixed identity color per artist (same mapping as the calendar), keyed by
  // artist_id — never by array position, since this list is sorted by booking
  // count. Color must follow the entity, not its rank in a sorted list.
  const colors = byArtist.map((a) => artistColor(a.artist_id));

  charts.push(new Chart(ctx, {
    type: "bar",
    data: {
      labels: byArtist.map((a) => a.artist),
      datasets: [{
        data: byArtist.map((a) => a.bookings),
        backgroundColor: colors,
        borderRadius: 4,
        maxBarThickness: 36,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      plugins: { legend: { display: false }, tooltip: { callbacks: {
        label: (item) => `${item.raw} booking${item.raw === 1 ? "" : "s"}`,
      } } },
      scales: {
        x: { beginAtZero: true, ticks: { precision: 0, color: "#6a6764" }, grid: { color: "#e8e4e0" } },
        y: { ticks: { color: "#2e2c2b" }, grid: { display: false } },
      },
    },
  }));
}

function renderStyleChart(mount, byStyle) {
  const wrap = mount.querySelector("#chart-style-wrap");
  if (byStyle.length === 0) {
    wrap.innerHTML = `<p class="chart-empty">No styles recorded in this range.</p>`;
    return;
  }
  wrap.innerHTML = `<canvas></canvas>`;
  const ctx = wrap.querySelector("canvas");

  charts.push(new Chart(ctx, {
    type: "bar",
    data: {
      labels: byStyle.map((s) => s.style),
      datasets: [{
        data: byStyle.map((s) => s.bookings),
        backgroundColor: SINGLE_SERIES_HUE,
        borderRadius: 4,
        maxBarThickness: 36,
      }],
    },
    options: {
      indexAxis: "y",
      responsive: true,
      plugins: { legend: { display: false }, tooltip: { callbacks: {
        label: (item) => `${item.raw} booking${item.raw === 1 ? "" : "s"}`,
      } } },
      scales: {
        x: { beginAtZero: true, ticks: { precision: 0, color: "#6a6764" }, grid: { color: "#e8e4e0" } },
        y: { ticks: { color: "#2e2c2b" }, grid: { display: false } },
      },
    },
  }));
}
