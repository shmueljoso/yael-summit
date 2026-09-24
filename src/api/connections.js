/**
 * Connections: suggestions, requests, accept/decline, the constellation map, and the
 * optional AI "why you should meet" line. Matching itself is plain arithmetic — no AI cost.
 */
import { json, error, clip, readJson, sha256, limited } from "../lib/http.js";
import { db, card, requireUser, connectionBetween, pairOf, TOPICS } from "../lib/db.js";
import { gemini, modelOf } from "../lib/gemini.js";
import { locate } from "../lib/places.js";

const parse = (s) => { try { return JSON.parse(s); } catch { return []; } };
const inter = (a, b) => a.filter((x) => b.includes(x));
// Topic names mid-sentence: lower-case, except proper nouns ("Hebrew", "Jewish", "Israel").
const label = (t) => { const s = TOPICS[t] || t; return /^(Hebrew|Jewish|Israel)/.test(s) ? s : s[0].toLowerCase() + s.slice(1); };
const joinList = (l) => (l.length <= 1 ? l.join("") : `${l.slice(0, -1).join(", ")} and ${l[l.length - 1]}`);

function score(me, x) {
  const [ms, mg, mt, xs, xg, xt] = [me.seeks, me.gives, me.topics, x.seeks, x.gives, x.topics].map(parse);
  const give = inter(ms, xg), get = inter(xs, mg), shared = inter(mt, xt);
  let s = give.length * 3 + get.length * 2 + shared.length * 1.5;
  if (me.level && me.level === x.level) s += 1;
  if (me.country && x.country && me.country.toLowerCase() !== x.country.toLowerCase()) s += 0.75; // cross-community ideas
  return { s, pct: Math.round(40 + 59 * Math.min(1, s / 11)), give, get, shared };
}

function reason(m, first) {
  const parts = [];
  if (m.give.length) parts.push(`${first} is strong in ${joinList(m.give.map(label))}, which is what you want to learn.`);
  if (m.get.length) parts.push(`${first} wants to learn about ${joinList(m.get.map(label))}, one of your strengths.`);
  if (m.shared.length) parts.push(`You're both working on ${joinList(m.shared.map(label))}.`);
  return parts.join(" ") || "A fresh perspective from another community.";
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
    .map(({ x, m }) => ({ ...card(x), match: m.pct, reason: reason(m, x.full_name.split(" ")[0]), give: m.give, shared: m.shared }));
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
  for (const r of results) {
    const item = { ...card(r), note: r.note, since: r.accepted_at || r.c_created };
    if (r.status === "accepted") out.connected.push(item);
    else if (r.requested_by === u.id) out.sent.push(item);
    else out.received.push(item);
  }
  return json(out);
}

/** POST /api/connections { to, note } — ask to connect (accepts at once if they already asked you). */
export async function request({ request, env }) {
  const u = await requireUser(env, request);
  if (await limited(env, `connect:${u.id}`, 20)) return error(429, "slow_down", "That's a lot of requests at once. Try again in a minute.");
  const b = await readJson(request);
  const to = clip(b.to, 40);
  if (!to || to === u.id) return error(400, "bad_target", "Choose someone to connect with.");
  const d = await db(env);
  if (!(await d.prepare("SELECT 1 FROM users WHERE id = ?").bind(to).first())) return error(404, "not_found", "This principal wasn't found.");
  const existing = await connectionBetween(d, u.id, to);
  const [a, bb] = pairOf(u.id, to);
  if (existing) {
    if (existing.status === "pending" && existing.requested_by !== u.id) {
      await d.prepare("UPDATE connections SET status = 'accepted', accepted_at = ? WHERE a = ? AND b = ?").bind(Date.now(), a, bb).run();
      return json({ connection: "connected" });
    }
    return json({ connection: existing.status === "accepted" ? "connected" : "sent" });
  }
  await d.prepare(
    "INSERT INTO connections (a, b, status, requested_by, note, created_at) VALUES (?, ?, 'pending', ?, ?, ?)"
  ).bind(a, bb, u.id, clip(b.note, 300), Date.now()).run();
  return json({ connection: "sent" }, 201);
}

/** POST /api/connections/:id/accept */
export async function accept({ request, env, params }) {
  const u = await requireUser(env, request);
  const d = await db(env);
  const c = await connectionBetween(d, u.id, params.id);
  if (!c || c.status !== "pending" || c.requested_by === u.id) return error(404, "not_found", "There's no request to accept.");
  await d.prepare("UPDATE connections SET status = 'accepted', accepted_at = ? WHERE a = ? AND b = ?").bind(Date.now(), c.a, c.b).run();
  return json({ connection: "connected" });
}

/** DELETE /api/connections/:id — decline a request, cancel yours, or disconnect. */
export async function remove({ request, env, params }) {
  const u = await requireUser(env, request);
  const d = await db(env);
  const [a, b] = pairOf(u.id, params.id);
  await d.prepare("DELETE FROM connections WHERE a = ? AND b = ?").bind(a, b).run();
  return json({ connection: null });
}

/** GET /api/map — the whole constellation: everyone, and the accepted connections between them. */
export async function map({ request, env }) {
  const u = await requireUser(env, request);
  const d = await db(env);
  const [{ results: users }, { results: edges }] = await Promise.all([
    d.prepare("SELECT id, full_name, school, city, country, topics, avatar, lat, lng, is_demo FROM users").all(),
    d.prepare("SELECT a, b FROM connections WHERE status = 'accepted'").all(),
  ]);
  return json({
    me: u.id,
    nodes: users.map((x) => {
      const [lat, lng] = x.lat != null ? [x.lat, x.lng] : locate(x.city, x.country) || [null, null];
      return { id: x.id, name: x.full_name, school: x.school, city: x.city, country: x.country, topics: parse(x.topics), lat, lng, sample: !!x.is_demo, avatar: x.avatar ? `/api/avatar/${x.id}?v=${x.avatar}` : null };
    }),
    edges: edges.map((e) => [e.a, e.b]),
  });
}

const SYSTEM = [
  "You introduce principals of Jewish schools around the world to each other before the Yael Foundation summit.",
  "Write in English. why: one warm, specific sentence (max 30 words) on why these two should talk.",
  "opener: one concrete first question the reader could ask (max 18 words). No superlatives, no emoji.",
  'Return JSON only: {"why":string,"opener":string}',
].join(" ");

function brief(x) {
  const t = (k) => parse(x[k]).map(label).join(", ") || "-";
  return `${x.role_title || "Principal"}, ${x.school || "a Jewish school"} (${[x.city, x.country].filter(Boolean).join(", ") || "-"}). Working on: ${t("topics")}. Strong in: ${t("gives")}. Wants to learn: ${t("seeks")}.${x.bio ? ` About: ${clip(x.bio, 240)}` : ""}`;
}

/** POST /api/intro/:id — AI wording for one suggestion. Cached per profile pair, so each pair is paid once. */
export async function intro({ request, env, params }) {
  const u = await requireUser(env, request);
  const d = await db(env);
  const x = await d.prepare("SELECT * FROM users WHERE id = ?").bind(params.id).first();
  if (!x) return error(404, "not_found", "This principal wasn't found.");
  const text = `Reader — ${brief(u)}\nOther (${x.full_name.split(" ")[0]}) — ${brief(x)}`;
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
  const [u, c, k] = await Promise.all([
    d.prepare("SELECT COUNT(*) n FROM users").first(),
    d.prepare("SELECT COUNT(DISTINCT LOWER(TRIM(country))) n FROM users WHERE country != ''").first(),
    d.prepare("SELECT COUNT(*) n FROM connections WHERE status = 'accepted'").first(),
  ]);
  return json({ principals: u?.n || 0, countries: c?.n || 0, connections: k?.n || 0 }, 200, { "cache-control": "public, max-age=60" });
}
