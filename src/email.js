/* Enquiry emails via Resend (https://resend.com).

   Optional, like the Stripe/OpenRouter integrations: with no RESEND_API_KEY it
   quietly no-ops, so enquiries never depend on email. Sending is fire-and-forget
   and self-contained — a failed email is logged, never thrown, and can't break
   an enquiry submit or an approval.

   Studio-aware: this build serves multiple studios (Black Craft + presets), so
   the branding/sign-off is passed in per call as `studioName` rather than baked
   in. No nodemailer dependency — Resend is a plain HTTPS API over fetch. */

const KEY = (process.env.RESEND_API_KEY || "").trim();
const FROM = (process.env.EMAIL_FROM || "Studio <onboarding@resend.dev>").trim();
const OWNER_EMAIL = (process.env.OWNER_EMAIL || "").trim();
const BASE = (process.env.PUBLIC_BASE_URL || "http://localhost:3000").trim().replace(/\/+$/, "");
const DEFAULT_STUDIO = "Custom Tattoo Studio";

export function emailEnabled() {
  return !!KEY;
}

function esc(s) {
  return String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
}
function money(n) {
  return n == null ? null : `£${Number(n).toFixed(0)}`;
}

async function send({ to, subject, html, text, replyTo }) {
  if (!KEY || !to) return { skipped: true };
  try {
    const res = await fetch("https://api.resend.com/emails", {
      // A real multipart text+HTML message reads as personal/transactional to
      // Gmail & Outlook, which helps it land in the Primary inbox.
      method: "POST",
      headers: { Authorization: `Bearer ${KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [to], subject, html, text, reply_to: replyTo }),
    });
    if (!res.ok) {
      console.error("Email send failed:", res.status, (await res.text()).slice(0, 300));
      return { ok: false };
    }
    return { ok: true };
  } catch (err) {
    console.error("Email error:", err.message);
    return { ok: false };
  }
}

// ---- shared branded shell ----
function shell(studio, inner) {
  return `<!doctype html><html><body style="margin:0;background:#fdfcfb;font-family:'Helvetica Neue',Arial,sans-serif;color:#2e2c2b;">
    <div style="max-width:520px;margin:0 auto;padding:32px 20px;">
      <div style="text-align:center;margin-bottom:24px;">
        <div style="font-size:22px;font-weight:700;letter-spacing:0.5px;text-transform:uppercase;">${esc(studio)}</div>
      </div>
      <div style="background:#ffffff;border:1px solid #e8e4e0;border-radius:6px;padding:28px 26px;">
        ${inner}
      </div>
      <div style="text-align:center;color:#9a968f;font-size:12px;margin-top:20px;line-height:1.6;">
        ${esc(studio)}
      </div>
    </div>
  </body></html>`;
}

function detailRows(rows) {
  return rows
    .filter(([, v]) => v != null && v !== "")
    .map(([k, v]) => `<tr>
      <td style="padding:6px 0;color:#6a6764;font-size:14px;">${esc(k)}</td>
      <td style="padding:6px 0;text-align:right;font-size:14px;font-weight:500;">${esc(v)}</td></tr>`)
    .join("");
}

const TYPE_LABEL = { flash: "Flash", custom: "Custom design", unsure: "Not sure yet" };

/**
 * Notify the owner that a new enquiry has landed. No-ops without a key or an
 * OWNER_EMAIL. `e` is a plain object built by the server.
 */
export async function sendEnquiryNotification(e) {
  if (!KEY || !OWNER_EMAIL) return { skipped: true };
  const studio = e.studioName || DEFAULT_STUDIO;

  const html = shell(studio, `
    <h1 style="font-size:20px;margin:0 0 14px;">New enquiry</h1>
    <table style="width:100%;border-collapse:collapse;border-top:1px solid #e8e4e0;">
      ${detailRows([
        ["Name", e.name],
        ["Email", e.email],
        ["Phone", e.phone],
        ["Type", TYPE_LABEL[e.tattoo_type] || ""],
        ["Placement", e.placement],
        ["Size", e.size],
        ["Budget", e.budget],
        ["Reference photos", e.referenceCount ? String(e.referenceCount) : "none"],
      ])}
    </table>
    <p style="color:#6a6764;font-size:13px;margin:16px 0 4px;font-weight:600;">Their idea</p>
    <p style="font-size:14px;line-height:1.6;white-space:pre-wrap;margin:0;">${esc(e.description)}</p>
    <p style="color:#6a6764;font-size:13px;margin:20px 0 0;">Review it in your dashboard to approve and reply.</p>
  `);

  const lines = [`New enquiry from ${e.name || "a customer"}.`, "", `Email: ${e.email || "—"}`];
  if (e.phone) lines.push(`Phone: ${e.phone}`);
  if (e.tattoo_type) lines.push(`Type: ${TYPE_LABEL[e.tattoo_type] || e.tattoo_type}`);
  if (e.placement) lines.push(`Placement: ${e.placement}`);
  if (e.size) lines.push(`Size: ${e.size}`);
  if (e.budget) lines.push(`Budget: ${e.budget}`);
  lines.push(
    `Reference photos: ${e.referenceCount ? e.referenceCount : "none"}`,
    "", "Their idea:", e.description || "",
    "", "Review it in your dashboard to approve and reply."
  );

  return send({
    to: OWNER_EMAIL,
    subject: `New enquiry — ${e.name || "customer"}`,
    html,
    text: lines.join("\n"),
    replyTo: e.email || undefined,
  });
}

/**
 * Email the customer after the owner approves their enquiry: the artist's note,
 * the optional price offered, and a link to book a slot through the normal flow.
 * No-ops without a key or a customer email.
 */
export async function sendEnquiryApproved({ name, email, note, price, bookingUrl, studioName }) {
  if (!KEY || !email) return { skipped: true };

  const studio = studioName || DEFAULT_STUDIO;
  const url = bookingUrl || `${BASE}/book`;
  const first = name ? String(name).split(" ")[0] : "there";
  const defaultNote = "Thanks for your enquiry — I'd love to take on your piece. Whenever you're ready, pick a slot that suits you using the link below and I'll see you in the chair.";
  const bodyNote = note && note.trim() ? note.trim() : defaultNote;
  const priceLine = price != null ? `Estimated price for the piece: ${money(price)}.` : "";

  // Personal, letter-style layout (greeting + note + a plain inline link) rather
  // than a marketing banner — reads as a 1:1 reply, keeping it out of Promotions.
  const html = shell(studio, `
    <p style="font-size:15px;line-height:1.7;margin:0 0 16px;">Hi ${esc(first)},</p>
    <p style="font-size:15px;line-height:1.7;white-space:pre-wrap;margin:0 0 16px;">${esc(bodyNote)}</p>
    ${priceLine ? `<p style="font-size:15px;line-height:1.7;margin:0 0 16px;">${esc(priceLine)}</p>` : ""}
    <p style="font-size:15px;line-height:1.7;margin:0 0 16px;">
      Book your slot here: <a href="${url}" style="color:#c0392b;">${esc(url)}</a>
    </p>
    <p style="font-size:15px;line-height:1.7;margin:16px 0 0;">Speak soon,<br/>${esc(studio)}</p>
  `);

  const lines = [`Hi ${first},`, "", bodyNote];
  if (priceLine) lines.push("", priceLine);
  lines.push("", `Book your slot here: ${url}`, "", "Speak soon,", studio);

  return send({
    to: email,
    subject: "Re: your tattoo enquiry",
    html,
    text: lines.join("\n"),
    replyTo: OWNER_EMAIL || undefined,
  });
}
