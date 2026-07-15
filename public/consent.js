/* Black Craft Custom Tattoos — client consent form (opened from the booking's
   private /consent/:token link). Answers + a drawn signature are saved against
   the booking so the studio has it on file before the appointment. */

const $ = (id) => document.getElementById(id);
const token = location.pathname.split("/").filter(Boolean).pop() || "";

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fmtDateLong(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
}
function fmtTime(hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  const suffix = h >= 12 ? "pm" : "am";
  const hr = ((h + 11) % 12) + 1;
  return m === 0 ? `${hr}${suffix}` : `${hr}:${String(m).padStart(2, "0")}${suffix}`;
}

// Health questions that matter before tattooing — "yes" prompts a details box.
const QUESTIONS = [
  { id: "allergies", label: "Any allergies (inks, latex, plasters, metals)?" },
  { id: "conditions", label: "Diabetes, epilepsy, haemophilia or heart condition?" },
  { id: "blood_thinners", label: "Taking blood thinners or antibiotics?" },
  { id: "pregnant", label: "Pregnant or breastfeeding?" },
  { id: "skin", label: "Any skin conditions at the tattoo site?" },
  { id: "alcohol", label: "Drunk alcohol in the last 24 hours?" },
];

const DECLARATIONS = [
  { id: "over18", label: "I confirm I am 18 or over and can provide ID." },
  { id: "accurate", label: "The information I've given is accurate and complete." },
  { id: "permanent", label: "I understand a tattoo is permanent." },
  { id: "aftercare", label: "I agree to follow the aftercare advice I'm given." },
];

let signaturePad = null;

function renderSigned(info) {
  $("consent-title").textContent = "All done";
  $("consent-content").innerHTML = `
    <div class="confirm-card" style="margin:0 auto;text-align:center;max-width:440px;">
      <span class="confirm-mark">✦</span>
      <h2>Consent form signed.</h2>
      <p class="confirm-note">Thanks ${escapeHtml((info.client_name || "").split(" ")[0])} — we've got everything we need. See you on the day.</p>
    </div>`;
}

function renderForm(info) {
  $("consent-content").innerHTML = `
    <form id="consent-form">
      <div class="field"><label for="c-name">Full name</label><input id="c-name" type="text" required value="${escapeHtml(info.client_name || "")}" /></div>
      <div class="field"><label for="c-dob">Date of birth</label><input id="c-dob" type="date" required /></div>

      <p class="consent-section">Health check</p>
      <div id="c-questions">
        ${QUESTIONS.map((q) => `
          <div class="consent-q" data-q="${q.id}">
            <span class="consent-q-label">${escapeHtml(q.label)}</span>
            <span class="consent-toggle">
              <label><input type="radio" name="${q.id}" value="no" checked /> No</label>
              <label><input type="radio" name="${q.id}" value="yes" /> Yes</label>
            </span>
            <input class="consent-detail" id="d-${q.id}" type="text" placeholder="Please give details" hidden />
          </div>`).join("")}
      </div>

      <p class="consent-section">Declarations</p>
      <div class="consent-decls">
        ${DECLARATIONS.map((d) => `
          <label class="consent-check"><input type="checkbox" id="k-${d.id}" required /> <span>${escapeHtml(d.label)}</span></label>
        `).join("")}
      </div>

      <p class="consent-section">Signature</p>
      <div class="sig-wrap">
        <canvas id="sig-pad" class="sig-pad" width="600" height="180"></canvas>
        <div class="sig-actions">
          <span class="sig-hint">Sign above with your finger or mouse</span>
          <button type="button" class="upload-btn" id="sig-clear">Clear</button>
        </div>
      </div>

      <p class="field-error" id="consent-error" hidden></p>
      <button type="submit" class="cta" id="consent-submit">Submit consent form</button>
    </form>`;

  // "Yes" reveals a details box
  QUESTIONS.forEach((q) => {
    document.querySelectorAll(`input[name="${q.id}"]`).forEach((radio) =>
      radio.addEventListener("change", () => {
        $(`d-${q.id}`).hidden = document.querySelector(`input[name="${q.id}"]:checked`).value !== "yes";
      })
    );
  });

  $("sig-clear").addEventListener("click", () => signaturePad.clear());
  signaturePad = makeSignaturePad($("sig-pad"));
  $("consent-form").addEventListener("submit", submit);
}

/** Minimal pointer-based signature pad. */
function makeSignaturePad(canvas) {
  const ctx = canvas.getContext("2d");
  // Scale for crisp lines on high-DPI screens.
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * ratio;
  canvas.height = rect.height * ratio;
  ctx.scale(ratio, ratio);
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.strokeStyle = "#2e2c2b";

  let drawing = false, empty = true;
  const pos = (e) => {
    const r = canvas.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  canvas.addEventListener("pointerdown", (e) => {
    drawing = true; empty = false;
    canvas.setPointerCapture(e.pointerId);
    const p = pos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y);
  });
  canvas.addEventListener("pointermove", (e) => {
    if (!drawing) return;
    e.preventDefault();
    const p = pos(e); ctx.lineTo(p.x, p.y); ctx.stroke();
  });
  ["pointerup", "pointerleave", "pointercancel"].forEach((ev) =>
    canvas.addEventListener(ev, () => { drawing = false; })
  );

  return {
    clear() { ctx.clearRect(0, 0, canvas.width, canvas.height); empty = true; },
    isEmpty() { return empty; },
    toDataUrl() {
      // Flatten onto white so the signature isn't transparent.
      const out = document.createElement("canvas");
      out.width = canvas.width; out.height = canvas.height;
      const octx = out.getContext("2d");
      octx.fillStyle = "#ffffff";
      octx.fillRect(0, 0, out.width, out.height);
      octx.drawImage(canvas, 0, 0);
      return out.toDataURL("image/png");
    },
  };
}

async function submit(e) {
  e.preventDefault();
  const err = $("consent-error");
  err.hidden = true;

  if (signaturePad.isEmpty()) {
    err.textContent = "Please add your signature.";
    err.hidden = false;
    return;
  }

  const answers = {
    full_name: $("c-name").value.trim(),
    date_of_birth: $("c-dob").value,
    health: Object.fromEntries(QUESTIONS.map((q) => {
      const val = document.querySelector(`input[name="${q.id}"]:checked`).value;
      return [q.id, { question: q.label, answer: val, details: val === "yes" ? $(`d-${q.id}`).value.trim() : "" }];
    })),
    declarations: Object.fromEntries(DECLARATIONS.map((d) => [d.id, $(`k-${d.id}`).checked])),
  };

  const btn = $("consent-submit");
  btn.disabled = true;
  btn.textContent = "Submitting…";
  try {
    const res = await fetch(`/api/consent/${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answers, signature: signaturePad.toDataUrl() }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Something went wrong.");
    renderSigned({ client_name: answers.full_name });
  } catch (e2) {
    err.textContent = e2.message;
    err.hidden = false;
    btn.disabled = false;
    btn.textContent = "Submit consent form";
  }
}

async function init() {
  const config = await fetch("/api/config").then((r) => r.json()).catch(() => ({}));
  if (config.demo_mode) { const b = $("demo-banner"); if (b) b.hidden = false; }

  let info;
  try {
    const res = await fetch(`/api/consent/${encodeURIComponent(token)}`);
    info = await res.json();
    if (!res.ok) throw new Error(info.error || "Invalid link");
  } catch (e) {
    $("consent-title").textContent = "";
    $("consent-content").innerHTML = `
      <div class="confirm-card" style="margin:0 auto;text-align:center;max-width:420px;">
        <span class="confirm-mark">✦</span>
        <h2>Link not found</h2>
        <p class="confirm-note">${escapeHtml(e.message)}</p>
        <a href="/" class="cta ghost" style="display:inline-block;text-decoration:none;">Go to booking</a>
      </div>`;
    return;
  }

  $("appt-name").textContent = info.client_name || "";
  $("appt-details").textContent =
    `${fmtDateLong(info.date)} at ${fmtTime(info.start_time)} with ${info.artist_name}` +
    (info.style ? ` · ${info.style}` : "");

  if (info.signed) renderSigned(info);
  else renderForm(info);
}

init();
