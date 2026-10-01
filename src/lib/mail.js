/**
 * Email through Resend (resend.com). Turned on by two settings in Cloudflare:
 *   RESEND_API_KEY  (secret)  the API key
 *   MAIL_FROM       (variable) a sender on a domain verified in Resend, e.g. "Yael Summit <summit@yaelfoundation.org>"
 * Without them nothing is sent and nothing breaks.
 */
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const mailOn = (env) => !!(env.RESEND_API_KEY && env.MAIL_FROM);

/** Sends one email. Returns true when Resend accepted it. Never throws. */
export async function sendMail(env, { to, subject, heading, lines = [], quote = "", button, url }) {
  if (!mailOn(env) || !to) return false;
  const text = [heading, "", ...lines, quote ? `\n“${quote}”\n` : "", url ? `${button || "Open"}: ${url}` : "", "", "Yael Summit · Constellation"].join("\n");
  const html = `<!doctype html><html><body style="margin:0;background:#F5F3EE;font-family:Arial,Helvetica,sans-serif;color:#0B1740">
  <div style="max-width:520px;margin:0 auto;padding:32px 20px">
    <p style="margin:0 0 18px;font-size:12px;letter-spacing:.24em;text-transform:uppercase;color:#A57A26">Yael Summit · Constellation</p>
    <div style="background:#fff;border-radius:20px;padding:28px">
      <h1 style="margin:0 0 14px;font-family:Georgia,serif;font-size:24px;font-weight:600">${esc(heading)}</h1>
      ${lines.map((l) => `<p style="margin:0 0 12px;font-size:15px;line-height:1.6;color:#4F5A80">${esc(l)}</p>`).join("")}
      ${quote ? `<p style="margin:0 0 16px;padding:12px 16px;border-radius:12px;background:#EEF1F8;font-size:15px;line-height:1.6;white-space:pre-line">${esc(quote)}</p>` : ""}
      ${url ? `<p style="margin:22px 0 0"><a href="${esc(url)}" style="display:inline-block;padding:12px 22px;border-radius:999px;background:#2A5BE0;color:#fff;text-decoration:none;font-size:15px">${esc(button || "Open")}</a></p>` : ""}
    </div>
    <p style="margin:18px 4px 0;font-size:12px;line-height:1.6;color:#7C85A5">You get these emails because you're a member of the Yael Summit network. You can turn them off in Edit profile.</p>
  </div></body></html>`;
  try {
    const r = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, "content-type": "application/json" },
      body: JSON.stringify({ from: env.MAIL_FROM, to: Array.isArray(to) ? to : [to], subject, html, text }),
    });
    if (!r.ok) console.log("mail failed", r.status, await r.text().catch(() => ""));
    return r.ok;
  } catch (e) {
    console.log("mail error", e?.message);
    return false;
  }
}

/** The site's own address, for links in emails. */
export const siteUrl = (request, hash = "") => `${new URL(request.url).origin}/${hash}`;
