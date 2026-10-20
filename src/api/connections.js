/**
 * Connections: suggestions, requests, accept/decline, the constellation map, and the
 * optional AI "why you should meet" line. Matching itself is plain arithmetic — no AI cost.
 */
import { json, error, clip, readJson, sha256, limited } from "../lib/http.js";
import { db, card, requireUser, connectionBetween, pairOf, TOPICS } from "../lib/db.js";
import { gemini, modelOf } from "../lib/gemini.js";
import { locate } from "../lib/places.js";
import { UNJOINED_SCHOOLS } from "./profile.js";
import { sendMail, siteUrl } from "../lib/mail.js";
import { notify as phone } from "../lib/push.js";
import { translate, stored, okLang, LANG_NAMES } from "../lib/translate.js";
import { tr, listIn, topicsIn } from "../lib/i18n.js";

const first = (name) => String(name || "").split(" ")[0];
const schoolLine = (x) => [x.role_title, x.school, x.country].filter(Boolean).join(" · ");

/** Emails a member about connection activity, in their language, if they haven't turned emails off. */
function notify(env, request, waitUntil, to, mail) {
  if (!to?.email || to.email_notify === 0) return;
  waitUntil(sendMail(env, { to: to.email, url: siteUrl(request, mail.hash || "#/"), lang: okLang(to.lang), ...mail }));
}

const parse = (s) => { try { return JSON.parse(s); } catch { return []; } };
const inter = (a, b) => a.filter((x) => b.includes(x));
// Topic names mid-sentence: lower-case, except English proper nouns ("Hebrew", "Jewish", "Israel") and German nouns.
const label = (t, lang = "en") => {
  const s = topicsIn(lang, TOPICS)[t] || t;
  return lang === "de" || (lang === "en" && /^(Hebrew|Jewish|Israel)/.test(s)) ? s : s[0].toLowerCase() + s.slice(1);
};

function score(me, x) {
  const [ms, mg, mt, xs, xg, xt] = [me.seeks, me.gives, me.topics, x.seeks, x.gives, x.topics].map(parse);
  const give = inter(ms, xg), get = inter(xs, mg), shared = inter(mt, xt);
  let s = give.length * 3 + get.length * 2 + shared.length * 1.5;
  if (me.level && me.level === x.level) s += 1;
  if (me.country && x.country && me.country.toLowerCase() !== x.country.toLowerCase()) s += 0.75; // cross-community ideas
  return { s, pct: Math.round(40 + 59 * Math.min(1, s / 11)), give, get, shared };
}

function reason(m, first, lang) {
  const list = (ts) => listIn(lang, ts.map((t) => label(t, lang)));
  const parts = [];
  if (m.give.length) parts.push(tr(lang, "r_strong", { first, list: list(m.give) }));
  if (m.get.length) parts.push(tr(lang, "r_wants", { first, list: list(m.get) }));
  if (m.shared.length) parts.push(tr(lang, "r_both", { list: list(m.shared) }));
  return parts.join(" ") || tr(lang, "r_fresh");
}

/** GET /api/suggestions — up to 6 principals worth meeting, not yet connected. */
export async function suggestions({ request, env }) {
  const u = await requireUser(env, request);
  const d = await db(env);
  const [{ results: users }, { results: conns }] = await Promise.all([
    d.prepare("SELECT * FROM users WHERE id != ?").bind(u.id).all(),
    d.prepare("SELECT a, b FROM connections WHERE a = ? OR b = ?").bind(u.id, u.id).all(),
  ]);
  const taken = new Set(conns.map((c) => (c.a === u.id ? c.b : c.a)));
  const list = users
    .filter((x) => !taken.has(x.id))
    .map((x) => ({ x, m: score(u, x) }))
    .sort((a, b) => b.m.s - a.m.s || b.x.created_at - a.x.created_at)
    .slice(0, 6)
    .map(({ x, m }) => ({ ...card(x), match: m.pct, reason: reason(m, x.full_name.split(" ")[0], okLang(u.lang)), give: m.give, shared: m.shared }));
  const complete = parse(u.topics).length + parse(u.gives).length + parse(u.seeks).length > 0;
  return json({ suggestions: list, profile_complete: complete });
}

/** GET /api/connections — accepted, received and sent. */
export async function list({ request, env }) {
  const u = await requireUser(env, request);
  const d = await db(env);
  const { results } = await d.prepare(
    `SELECT c.*, x.* , c.created_at AS c_created FROM connections c
     JOIN users x ON x.id = CASE WHEN c.a = ?1 THEN c.b ELSE c.a END
     WHERE c.a = ?1 OR c.b = ?1 ORDER BY COALESCE(c.accepted_at, c.created_at) DESC`
  ).bind(u.id).all();
  const out = { connected: [], received: [], sent: [] };
  const notes = await stored(d, results.filter((r) => r.note && r.requested_by !== u.id).map((r) => `n:${r.a}:${r.b}`), okLang(u.lang));
  for (const r of results) {
    const note = (r.requested_by !== u.id && notes.get(`n:${r.a}:${r.b}`)) || r.note;
    const item = { ...card(r), note, since: r.accepted_at || r.c_created };
    if (r.status === "accepted") out.connected.push(item);
    else if (r.requested_by === u.id) out.sent.push(item);
    else out.received.push(item);
  }
  return json(out);
}

/** POST /api/connections { to, note } — ask to connect (accepts at once if they already asked you). */
export async function request({ request, env, waitUntil }) {
  const u = await requireUser(env, request);
  if (await limited(env, `connect:${u.id}`, 20)) return error(429, "slow_down", "That's a lot of requests at once. Try again in a minute.");
  const b = await readJson(request);
  const to = clip(b.to, 40);
  if (!to || to === u.id) return error(400, "bad_target", "Choose someone to connect with.");
  const d = await db(env);
  const other = await d.prepare("SELECT * FROM users WHERE id = ?").bind(to).first();
  if (!other) return error(404, "not_found", "This principal wasn't found.");
  const existing = await connectionBetween(d, u.id, to);
  const [a, bb] = pairOf(u.id, to);
  if (existing) {
    if (existing.status === "pending" && existing.requested_by !== u.id) {
      await d.prepare("UPDATE connections SET status = 'accepted', accepted_at = ? WHERE a = ? AND b = ?").bind(Date.now(), a, bb).run();
      const lang = okLang(other.lang);
      notify(env, request, waitUntil, other, accepted(u, lang));
      await phone(env, d, other.id, { kind: "accepted", title: tr(lang, "connected_title", { name: u.full_name }), body: tr(lang, "accepted_body"), url: `#/messages/${u.id}` }, waitUntil);
      return json({ connection: "connected" });
    }
    return json({ connection: existing.status === "accepted" ? "connected" : "sent" });
  }
  const note = clip(b.note, 300);
  await d.prepare(
    "INSERT INTO connections (a, b, status, requested_by, note, created_at) VALUES (?, ?, 'pending', ?, ?, ?)"
  ).bind(a, bb, u.id, note, Date.now()).run();
  // The note, in the recipient's language (kept as written if it already is, or if the AI is unavailable).
  const lang = okLang(other.lang);
  const r = note ? await translate(env, d, `n:${a}:${bb}`, note, [lang]) : null;
  const said = r?.t?.[lang] || note;
  notify(env, request, waitUntil, other, {
    subject: tr(lang, "request_title", { name: u.full_name }),
    heading: tr(lang, "request_heading", { name: u.full_name }),
    lines: [schoolLine(u) || tr(lang, "principal"), tr(lang, "request_line")],
    quote: said, button: tr(lang, "see_request"), hash: "#/",
  });
  await phone(env, d, other.id, { kind: "request", title: tr(lang, "request_title", { name: u.full_name }), body: clip(said, 200) || schoolLine(u), url: "#/" }, waitUntil);
  return json({ connection: "sent" }, 201);
}

const accepted = (u, lang) => ({
  subject: tr(lang, "accepted_title", { name: u.full_name }),
  heading: tr(lang, "connected_title", { name: u.full_name }),
  lines: [schoolLine(u) || tr(lang, "principal"), tr(lang, "accepted_line", { first: first(u.full_name) })],
  button: tr(lang, "message_first", { first: first(u.full_name) }), hash: `#/messages/${u.id}`,
});

/** POST /api/connections/:id/accept */
export async function accept({ request, env, params, waitUntil }) {
  const u = await requireUser(env, request);
  const d = await db(env);
  const c = await connectionBetween(d, u.id, params.id);
  if (!c || c.status !== "pending" || c.requested_by === u.id) return error(404, "not_found", "There's no request to accept.");
  await d.prepare("UPDATE connections SET status = 'accepted', accepted_at = ? WHERE a = ? AND b = ?").bind(Date.now(), c.a, c.b).run();
  const other = await d.prepare("SELECT * FROM users WHERE id = ?").bind(params.id).first();
  const lang = okLang(other?.lang);
  notify(env, request, waitUntil, other, accepted(u, lang));
  await phone(env, d, params.id, { kind: "accepted", title: tr(lang, "accepted_title", { name: u.full_name }), body: tr(lang, "accepted_body"), url: `#/messages/${u.id}` }, waitUntil);
  return json({ connection: "connected" });
}

/** DELETE /api/connections/:id — decline a request, cancel yours, or disconnect. */
export async function remove({ request, env, params }) {
  const u = await requireUser(env, request);
  const d = await db(env);
  const [a, b] = pairOf(u.id, params.id);
  await d.batch([
    d.prepare("DELETE FROM connections WHERE a = ? AND b = ?").bind(a, b),
    d.prepare("DELETE FROM translations WHERE item = ?").bind(`n:${a}:${b}`),
  ]);
  return json({ connection: null });
}

/** GET /api/map — the whole constellation: everyone, and the accepted connections between them. */
export async function map({ request, env }) {
  const u = await requireUser(env, request);
  const d = await db(env);
  const [{ results: users }, { results: edges }, { results: waiting }] = await Promise.all([
    d.prepare("SELECT id, full_name, school, city, country, level, topics, avatar, lat, lng FROM users").all(),
    d.prepare("SELECT a, b FROM connections WHERE status = 'accepted'").all(),
    d.prepare(UNJOINED_SCHOOLS).all(),
  ]);
  return json({
    me: u.id,
    nodes: users.map((x) => {
      const [lat, lng] = x.lat != null ? [x.lat, x.lng] : locate(x.city, x.country) || [null, null];
      return { id: x.id, name: x.full_name, school: x.school, city: x.city, country: x.country, level: x.level || "", topics: parse(x.topics), lat, lng, avatar: x.avatar ? `/api/avatar/${x.id}?v=${x.avatar}` : null };
    }).concat(waiting.map((s) => ({ id: `school:${s.id}`, waiting: true, name: s.name, school: s.name, city: s.city, country: s.country, level: s.level || "", topics: [] }))),
    edges: edges.map((e) => [e.a, e.b]),
  });
}

const SYSTEM = [
  "You introduce principals of Jewish schools around the world to each other before the Yael Foundation summit.",
  "Write in the language the request names. why: one warm, specific sentence (max 30 words) on why these two should talk.",
  "opener: one concrete first question the reader could ask (max 18 words). No superlatives, no emoji.",
  'Return JSON only: {"why":string,"opener":string}',
].join(" ");

function brief(x) {
  const t = (k) => parse(x[k]).map((t) => label(t)).join(", ") || "-";
  return `${x.role_title || "Principal"}, ${x.school || "a Jewish school"} (${[x.city, x.country].filter(Boolean).join(", ") || "-"}). Working on: ${t("topics")}. Strong in: ${t("gives")}. Wants to learn: ${t("seeks")}.${x.bio ? ` About: ${clip(x.bio, 240)}` : ""}`;
}

/** POST /api/intro/:id — AI wording for one suggestion. Cached per profile pair, so each pair is paid once. */
export async function intro({ request, env, params }) {
  const u = await requireUser(env, request);
  const d = await db(env);
  const x = await d.prepare("SELECT * FROM users WHERE id = ?").bind(params.id).first();
  if (!x) return error(404, "not_found", "This principal wasn't found.");
  const lang = okLang(u.lang);
  const text = `Language: ${LANG_NAMES[lang]}\nReader — ${brief(u)}\nOther (${x.full_name.split(" ")[0]}) — ${brief(x)}`;
  const key = `ai:${await sha256(modelOf(env) + text)}`;
  const hit = await env.BOARD?.get(key, "json");
  if (hit) return json(hit, 200, { "x-cache": "HIT" });
  if (await limited(env, `ai:${u.id}`, 10)) return error(429, "slow_down", "Try again in a minute.");
  const { data, usage } = await gemini(env, { system: SYSTEM, text, maxOutputTokens: 200, temperature: 0.7 });
  const out = { why: clip(data?.why, 280), opener: clip(data?.opener, 160) };
  if (!out.why) return error(502, "ai_failed", "The AI didn't answer. Try again.");
  await env.BOARD?.put(key, JSON.stringify(out), { expirationTtl: 60 * 60 * 24 * 60 });
  return json(out, 200, { "x-cache": "MISS", ...(usage != null ? { "x-ai-tokens": String(usage) } : {}) });
}

/** GET /api/stats — public numbers for the landing page. */
export async function stats({ env }) {
  const d = await db(env);
  const [u, s, c, k] = await Promise.all([
    d.prepare("SELECT COUNT(*) n FROM users").first(),
    d.prepare("SELECT COUNT(*) n FROM schools").first(),
    d.prepare("SELECT COUNT(DISTINCT c) n FROM (SELECT LOWER(TRIM(country)) c FROM users WHERE country != '' UNION SELECT LOWER(TRIM(country)) FROM schools WHERE country != '')").first(),
    d.prepare("SELECT COUNT(*) n FROM connections WHERE status = 'accepted'").first(),
  ]);
  return json({ principals: u?.n || 0, schools: s?.n || 0, countries: c?.n || 0, connections: k?.n || 0, contact: env.CONTACT_EMAIL || "" }, 200, { "cache-control": "public, max-age=60" });
}
