/** Direct messages. Only between principals who are connected. */
import { json, error, clipText, readJson, limited } from "../lib/http.js";
import { db, card, requireUser, connectionBetween, pairKey } from "../lib/db.js";
import { sendMail, siteUrl } from "../lib/mail.js";
import { notify as phone } from "../lib/push.js";
import { translate, stored, okLang } from "../lib/translate.js";
import { tr } from "../lib/i18n.js";

const MAIL_GAP = 2 * 60 * 60; // at most one email per conversation every two hours
const ONLINE = 6 * 60e3;      // seen this recently → they'll see it on the site, no email

/** Emails the recipient about a new message, in their language, unless they're on the site, opted out, or were emailed recently. */
async function notifyMessage(env, request, d, from, to, body) {
  const toId = to?.id;
  if (!to?.email || to.email_notify === 0 || Date.now() - (to.seen_at || 0) < ONLINE) return;
  const key = `mailmsg:${pairKey(from.id, toId)}:${toId}`;
  if (env.BOARD && (await env.BOARD.get(key))) return;
  await env.BOARD?.put(key, "1", { expirationTtl: MAIL_GAP });
  const first = from.full_name.split(" ")[0];
  const lang = okLang(to.lang);
  await sendMail(env, {
    to: to.email, subject: tr(lang, "message_subject", { name: from.full_name }), lang,
    heading: tr(lang, "message_heading", { first }),
    lines: [[from.role_title, from.school].filter(Boolean).join(" · ") || tr(lang, "principal")],
    quote: body.length > 280 ? `${body.slice(0, 280)}…` : body,
    button: tr(lang, "reply"), url: siteUrl(request, `#/messages/${from.id}`),
  });
}

/**
 * Messages are translated into the recipient's language when sent (one short AI call).
 * Each side reads the other's messages in their own language; "Show original" keeps the words as written.
 *   m: rows with id, from_id, body, lang.  Returns Map id → { body, original }.
 */
async function forViewer(env, d, u, rows, waitUntil) {
  const theirs = rows.filter((m) => m.from_id !== u.id);
  const lang = okLang(u.lang);
  const trs = await stored(d, theirs.map((m) => `m:${m.id}`), lang);
  const out = new Map(), todo = [];
  for (const m of theirs) {
    const t = m.lang !== lang && trs.get(`m:${m.id}`);
    if (t) out.set(m.id, { body: t, original: m.body, lang: m.lang });
    else if (m.lang !== lang) todo.push(m);
  }
  // Older messages, or ones written before the reader changed language: translated now, shown next time.
  if (todo.length && waitUntil) waitUntil((async () => {
    for (const m of todo.slice(-4)) {
      const t = await translate(env, d, `m:${m.id}`, m.body, [lang]);
      if (t) await d.prepare("UPDATE messages SET lang = ? WHERE id = ?").bind(t.lang, m.id).run();
    }
  })().catch(() => {}));
  return out;
}

/** GET /api/messages — your conversations, newest first, with unread counts. */
export async function conversations({ request, env, waitUntil }) {
  const u = await requireUser(env, request);
  const d = await db(env);
  const { results } = await d.prepare(
    `SELECT m.*, (SELECT COUNT(*) FROM messages r WHERE r.pair = m.pair AND r.to_id = ?1 AND r.read_at IS NULL) AS unread
     FROM messages m WHERE m.id IN (SELECT MAX(id) FROM messages WHERE from_id = ?1 OR to_id = ?1 GROUP BY pair)
     ORDER BY m.id DESC LIMIT 100`
  ).bind(u.id).all();
  if (!results.length) return json({ conversations: [] });
  const others = [...new Set(results.map((m) => (m.from_id === u.id ? m.to_id : m.from_id)))];
  const { results: users } = await d.prepare(`SELECT * FROM users WHERE id IN (${others.map(() => "?").join(",")})`).bind(...others).all();
  const byId = new Map(users.map((x) => [x.id, card(x)]));
  const trs = await forViewer(env, d, u, results, waitUntil);
  return json({
    conversations: results.map((m) => ({
      with: byId.get(m.from_id === u.id ? m.to_id : m.from_id),
      last: { body: (trs.get(m.id)?.body || m.body).slice(0, 140), mine: m.from_id === u.id, at: m.created_at },
      unread: m.unread,
    })).filter((c) => c.with),
  });
}

/** GET /api/messages/:id?after= — the thread with one principal; marks their messages read. */
export async function thread({ request, env, params, waitUntil }) {
  const u = await requireUser(env, request);
  const d = await db(env);
  const c = await connectionBetween(d, u.id, params.id);
  if (c?.status !== "accepted") return error(403, "not_connected", "You can message a principal once you're connected.");
  const after = Number(new URL(request.url).searchParams.get("after")) || 0;
  const pair = pairKey(u.id, params.id);
  const { results } = await d.prepare(
    "SELECT id, from_id, body, lang, created_at FROM messages WHERE pair = ? AND id > ? ORDER BY id DESC LIMIT 200"
  ).bind(pair, after).all();
  await d.prepare("UPDATE messages SET read_at = ? WHERE pair = ? AND to_id = ? AND read_at IS NULL").bind(Date.now(), pair, u.id).run();
  const other = await d.prepare("SELECT * FROM users WHERE id = ?").bind(params.id).first();
  const trs = await forViewer(env, d, u, results, waitUntil);
  return json({ with: card(other), messages: results.reverse().map((m) => ({ id: m.id, mine: m.from_id === u.id, body: m.body, at: m.created_at, ...(trs.get(m.id) || {}) })) });
}

/** POST /api/messages/:id { body } */
export async function send({ request, env, params, waitUntil }) {
  const u = await requireUser(env, request);
  if (await limited(env, `msg:${u.id}`, 30)) return error(429, "slow_down", "You're sending messages very fast. Wait a moment.");
  const b = await readJson(request);
  const body = clipText(b.body, 2000);
  if (!body) return error(400, "empty", "Write a message first.");
  const d = await db(env);
  const c = await connectionBetween(d, u.id, params.id);
  if (c?.status !== "accepted") return error(403, "not_connected", "You can message a principal once you're connected.");
  const r = await d.prepare(
    "INSERT INTO messages (pair, from_id, to_id, body, created_at) VALUES (?, ?, ?, ?, ?) RETURNING id, created_at"
  ).bind(pairKey(u.id, params.id), u.id, params.id, body, Date.now()).first();
  // Translated for the recipient before they're told, so the notification is in their language too.
  const to = await d.prepare("SELECT * FROM users WHERE id = ?").bind(params.id).first();
  const lang = okLang(to?.lang);
  // Both read the same language: no AI call, the message is taken to be in it.
  const t = okLang(u.lang) === lang ? { lang } : await translate(env, d, `m:${r.id}`, body, [lang]);
  if (t) await d.prepare("UPDATE messages SET lang = ? WHERE id = ?").bind(t.lang, r.id).run();
  const said = t?.t?.[lang] || body;
  waitUntil(notifyMessage(env, request, d, u, to, said).catch(() => {}));
  await phone(env, d, params.id, { kind: "message", title: u.full_name, body: said.length > 160 ? `${said.slice(0, 160)}…` : said, url: `#/messages/${u.id}` }, waitUntil);
  return json({ message: { id: r.id, mine: true, body, at: r.created_at } }, 201);
}
