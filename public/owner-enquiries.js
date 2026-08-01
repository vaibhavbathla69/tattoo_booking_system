/* Enquiries view — review "enquire first" submissions, approve with a note and
   an optional price, or decline. Ported from the black-craft build; this build
   has no email layer, so approving records the quote/note and marks it approved
   (the artist follows up and shares the booking link herself). */
import { api, toast, openDrawer, closeDrawer, fmtDate } from "./owner-app.js";

const STATUS_LABEL = { new: "new", approved: "approved", declined: "declined" };
const TYPE_LABEL = { flash: "Flash", custom: "Custom design", unsure: "Not sure yet" };

function parseImages(json) {
  try {
    const arr = JSON.parse(json || "[]");
    return Array.isArray(arr) ? arr : [];
  } catch { return []; }
}

// Reflect the count of unactioned enquiries on the dashboard tab.
function updateTabBadge(enquiries) {
  const tab = document.getElementById("tab-enquiries");
  if (!tab) return;
  const n = enquiries.filter((e) => e.status === "new").length;
  tab.textContent = n > 0 ? `Enquiries (${n})` : "Enquiries";
}

export async function renderEnquiries(mount) {
  if (!mount) return;
  mount.innerHTML = `<h2 class="view-title">Enquiries</h2><p class="crm-empty">Loading…</p>`;

  let enquiries;
  try {
    ({ enquiries } = await api("/api/owner/enquiries"));
  } catch (e) {
    mount.innerHTML = `<h2 class="view-title">Enquiries</h2><p class="crm-empty">${escapeHtml(e.message)}</p>`;
    return;
  }

  updateTabBadge(enquiries);

  mount.innerHTML = `
    <h2 class="view-title">Enquiries</h2>
    <p style="color:var(--ink-dim);font-size:0.85rem;margin-bottom:1rem;">
      Ideas sent in from the enquiry form. Open one to see the details, then approve it (recording a note and optional price) or decline it.
    </p>
    ${enquiries.length === 0
      ? `<p class="crm-empty">No enquiries yet.</p>`
      : `<table class="crm-table">
          <thead><tr>
            <th>Name</th><th>Idea</th><th>Type</th><th>Sent</th><th>Status</th>
          </tr></thead>
          <tbody>
            ${enquiries.map((e) => `
              <tr data-enq-id="${e.id}">
                <td>${escapeHtml(e.name)}</td>
                <td class="muted">${escapeHtml(truncate(e.description, 44))}</td>
                <td class="muted">${escapeHtml(TYPE_LABEL[e.tattoo_type] || "—")}</td>
                <td class="muted">${fmtDate(e.created_at.slice(0, 10), { short: true, year: true })}</td>
                <td><span class="status-pill ${e.status}">${STATUS_LABEL[e.status] || e.status}</span></td>
              </tr>
            `).join("")}
          </tbody>
        </table>`
    }
  `;

  mount.querySelectorAll("tbody tr").forEach((row) => {
    const enq = enquiries.find((e) => String(e.id) === row.dataset.enqId);
    row.addEventListener("click", () => openEnquiryDrawer(enq, mount));
  });
}

function openEnquiryDrawer(enq, mount) {
  const images = parseImages(enq.reference_images);
  const detail = (label, value) =>
    value ? `<p style="margin:0.15rem 0;"><span class="muted" style="color:var(--ink-dim);">${label}:</span> ${escapeHtml(value)}</p>` : "";

  const contact = [enq.email, enq.phone].filter(Boolean).map(escapeHtml).join(" · ");
  const actioned = enq.status !== "new";

  openDrawer(`
    <h3>${escapeHtml(enq.name)}</h3>
    <p class="drawer-sub">
      <span class="status-pill ${enq.status}">${STATUS_LABEL[enq.status] || enq.status}</span>
      ${contact ? "&nbsp;·&nbsp; " + contact : ""}
    </p>

    <div class="field">
      <label>Their idea</label>
      <p style="white-space:pre-wrap;font-size:0.9rem;line-height:1.5;margin:0;">${escapeHtml(enq.description)}</p>
    </div>

    ${(enq.tattoo_type || enq.placement || enq.size || enq.budget) ? `<div class="field">
      ${detail("Type", TYPE_LABEL[enq.tattoo_type] || "")}
      ${detail("Placement", enq.placement)}
      ${detail("Size", enq.size)}
      ${detail("Budget", enq.budget)}
    </div>` : ""}

    ${images.length ? `<div class="field">
      <label>Reference photos (${images.length})</label>
      <div class="enq-thumbs">
        ${images.map((src, i) => `<button type="button" class="enq-thumb" data-i="${i}" aria-label="View reference ${i + 1}"><img src="${src}" alt="reference ${i + 1}" /></button>`).join("")}
      </div>
    </div>` : ""}

    ${actioned
      ? `<div class="field">
           <label>Outcome</label>
           <p style="margin:0;font-size:0.9rem;">
             ${enq.status === "approved" ? "Approved" : "Declined"}${enq.responded_at ? ` on ${fmtDate(enq.responded_at.slice(0, 10), { short: true, year: true })}` : ""}.
             ${enq.quoted_price != null ? `<br>Price offered: £${enq.quoted_price}` : ""}
             ${enq.reply_note ? `<br><span class="muted" style="color:var(--ink-dim);white-space:pre-wrap;">${escapeHtml(enq.reply_note)}</span>` : ""}
           </p>
         </div>
         ${enq.status === "approved" && enq.approve_token ? `<div class="field">
           <label>${enq.booking_id ? "Booked in ✓" : "Book-at-agreed-price link"}</label>
           ${enq.booking_id
             ? `<p style="margin:0;font-size:0.9rem;color:#1a7367;">The customer has booked and paid their deposit.</p>`
             : `<p style="margin:0 0 .4rem;font-size:0.82rem;color:var(--ink-dim);">Emailed to the customer. Copy it if you need to resend:</p>
                <input readonly value="${escapeHtml(location.origin + "/enquiry/" + enq.approve_token)}"
                  onclick="this.select()" style="width:100%;font-size:0.82rem;padding:.5rem .6rem;border:1px solid var(--line,#e8e4e0);border-radius:4px;background:#faf8f6;" />`}
         </div>` : ""}`
      : `<div class="field-row">
           <div class="field"><label>Price offered (£) <span style="opacity:.6">optional</span></label>
             <input type="number" id="enq-price" min="0" step="1" placeholder="e.g. 240" />
           </div>
         </div>
         <div class="field">
           <label>Note to customer <span style="opacity:.6">optional</span></label>
           <textarea id="enq-note" rows="4" placeholder="A note for your records / to send on — e.g. 'Love this idea, I can do it as a half day for £240. I'll send a booking link.'"></textarea>
         </div>
         <div class="actions">
           <button class="btn-primary" id="enq-approve">Approve</button>
           <button class="btn-ghost" id="enq-decline">Decline</button>
         </div>`
    }
  `);

  // Click a reference thumbnail → open it in a lightbox (not a new tab).
  document.querySelectorAll(".enq-thumb").forEach((el) => {
    el.addEventListener("click", () => openLightbox(images[Number(el.dataset.i)]));
  });

  if (actioned) return;

  document.getElementById("enq-approve").addEventListener("click", async () => {
    const price = document.getElementById("enq-price").value;
    const note = document.getElementById("enq-note").value;
    try {
      await api(`/api/owner/enquiries/${enq.id}/approve`, {
        method: "POST",
        body: JSON.stringify({ price: price === "" ? null : Number(price), note }),
      });
      toast("Approved — quote and note saved.");
      closeDrawer();
      renderEnquiries(mount);
    } catch (e) {
      toast(e.message, true);
    }
  });

  document.getElementById("enq-decline").addEventListener("click", async () => {
    try {
      await api(`/api/owner/enquiries/${enq.id}/decline`, { method: "POST" });
      toast("Enquiry declined.");
      closeDrawer();
      renderEnquiries(mount);
    } catch (e) {
      toast(e.message, true);
    }
  });
}

// A simple full-screen image viewer. Click the backdrop, the ×, or press Esc
// to close; clicking the image itself doesn't dismiss it.
function openLightbox(src) {
  const box = document.createElement("div");
  box.className = "lightbox";
  box.innerHTML = `<button class="lightbox-close" aria-label="Close">×</button><img src="${src}" alt="reference photo" />`;
  const close = () => {
    box.remove();
    document.removeEventListener("keydown", onKey);
  };
  const onKey = (e) => { if (e.key === "Escape") close(); };
  box.addEventListener("click", close);
  box.querySelector("img").addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("keydown", onKey);
  document.body.appendChild(box);
}

function truncate(s, n) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1) + "…" : s;
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
