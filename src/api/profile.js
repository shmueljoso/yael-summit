/** Profiles: your own (view/edit/photo), the directory, and other principals' pages. */
import { json, error, clip, clipText, readJson } from "../lib/http.js";
import { db, card, full, currentUser, requireUser, connectionBetween, TOPICS, LEVELS, LINK_KINDS } from "../lib/db.js";

const topicList = (arr) => (Array.isArray(arr) ? [...new Set(arr.filter((t) => t in TOPICS))].slice(0, 5) : []);

function cleanLink(v) {
  const s = clip(v, 200);
  if (!s) return "";
  const url = /^https?:\/\//i.test(s) ? s : `https://${s}`;
  try { const u = new URL(url); return u.protocol === "https:" || u.protocol === "http:" ? u.href : ""; } catch { return ""; }
}

/** GET /api/me — the signed-in principal plus badge counts, or { me: null }. */
export async function me({ request, env }) {
  const u = await currentUser(env, request);
  if (!u) return json({ me: null });
  const d = await db(env);
  const [req, unread] = await Promise.all([
    d.prepare("SELECT COUNT(*) n FROM connections WHERE status = 'pending' AND requested_by != ? AND (a = ? OR b = ?)").bind(u.id, u.id, u.id).first(),
    d.prepare("SELECT COUNT(*) n FROM messages WHERE to_id = ? AND read_at IS NULL").bind(u.id).first(),
  ]);
  return json({ me: full(u), counts: { requests: req?.n || 0, unread: unread?.n || 0 }, taxonomy: { topics: TOPICS, levels: LEVELS } });
}

/** PUT /api/me — update your profile. Everything except the full name is optional. */
export async function updateMe({ request, env }) {
  const u = await requireUser(env, request);
  const b = await readJson(request);
  const full_name = clip(b.full_name, 80);
  if (full_name.split(" ").filter(Boolean).length < 2) return error(400, "full_name", "Please keep your full name (first and last).");
  const links = {};
  for (const k of LINK_KINDS) { const v = cleanLink(b.links?.[k]); if (v) links[k] = v; }
  const vals = {
    full_name,
    role_title: clip(b.role_title, 80), school: clip(b.school, 100), city: clip(b.city, 60), country: clip(b.country, 60),
    level: b.level in LEVELS ? b.level : "", bio: clipText(b.bio, 800),
    topics: JSON.stringify(topicList(b.topics)), gives: JSON.stringify(topicList(b.gives)), seeks: JSON.stringify(topicList(b.seeks)),
    links: JSON.stringify(links), phone: clip(b.phone, 40),
  };
  const d = await db(env);
  const cols = Object.keys(vals);
  await d.prepare(`UPDATE users SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).bind(...cols.map((c) => vals[c]), u.id).run();
  const fresh = await d.prepare("SELECT * FROM users WHERE id = ?").bind(u.id).first();
  return json({ me: full(fresh) });
}

/** PUT /api/me/avatar — body is a JPEG/PNG/WebP data URL, already resized in the browser. */
export async function putAvatar({ request, env }) {
  const u = await requireUser(env, request);
  if (!env.BOARD) return error(503, "storage_not_configured", "Photo storage isn't set up yet.");
  const b = await readJson(request, 400000);
  const m = String(b.image || "").match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return error(400, "bad_image", "Upload a JPG, PNG or WebP image.");
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  if (bytes.length > 250000) return error(413, "too_large", "That photo is too large. Try a smaller one.");
  await env.BOARD.put(`avatar:${u.id}`, bytes, { metadata: { type: m[1] } });
  const d = await db(env);
  await d.prepare("UPDATE users SET avatar = avatar + 1 WHERE id = ?").bind(u.id).run();
  const fresh = await d.prepare("SELECT * FROM users WHERE id = ?").bind(u.id).first();
  return json({ me: full(fresh) });
}

/** DELETE /api/me/avatar */
export async function deleteAvatar({ request, env }) {
  const u = await requireUser(env, request);
  if (env.BOARD) await env.BOARD.delete(`avatar:${u.id}`);
  const d = await db(env);
  await d.prepare("UPDATE users SET avatar = 0 WHERE id = ?").bind(u.id).run();
  return json({ ok: true });
}

/** GET /api/avatar/:id — photos are only for signed-in principals. URLs are versioned, so cache hard. */
export async function avatar({ request, env, params }) {
  await requireUser(env, request);
  const { value, metadata } = (await env.BOARD?.getWithMetadata(`avatar:${params.id}`, "arrayBuffer")) || {};
  if (!value) return new Response("Not found", { status: 404 });
  return new Response(value, { headers: { "content-type": metadata?.type || "image/jpeg", "cache-control": "private, max-age=31536000, immutable" } });
}

/** GET /api/people?q=&topic= — the directory, with your connection status to each person. */
export async function people({ request, env }) {
  const u = await requireUser(env, request);
  const url = new URL(request.url);
  const q = clip(url.searchParams.get("q"), 60).toLowerCase();
  const topic = url.searchParams.get("topic");
  const d = await db(env);
  const [{ results: users }, { results: conns }] = await Promise.all([
    d.prepare("SELECT * FROM users WHERE id != ? ORDER BY created_at DESC LIMIT 1000").bind(u.id).all(),
    d.prepare("SELECT * FROM connections WHERE a = ? OR b = ?").bind(u.id, u.id).all(),
  ]);
  const status = new Map(conns.map((c) => [c.a === u.id ? c.b : c.a, c.status === "accepted" ? "connected" : c.requested_by === u.id ? "sent" : "received"]));
  const list = users
    .map((x) => ({ ...card(x), connection: status.get(x.id) || null }))
    .filter((p) => !topic || p.topics.includes(topic))
    .filter((p) => !q || [p.full_name, p.school, p.city, p.country].join(" ").toLowerCase().includes(q));
  return json({ people: list });
}

/** GET /api/people/:id — a profile page. Contact details only when connected (or yourself). */
export async function person({ request, env, params }) {
  const u = await requireUser(env, request);
  const d = await db(env);
  const x = await d.prepare("SELECT * FROM users WHERE id = ?").bind(params.id).first();
  if (!x) return error(404, "not_found", "This profile doesn't exist.");
  const self = x.id === u.id;
  const c = self ? null : await connectionBetween(d, u.id, x.id);
  const connected = c?.status === "accepted";
  const connection = self ? "self" : !c ? null : connected ? "connected" : c.requested_by === u.id ? "sent" : "received";
  const [{ results: posts }, counts] = await Promise.all([
    d.prepare("SELECT id, kind, text, original, lang, created_at FROM posts WHERE user_id = ? ORDER BY created_at DESC LIMIT 10").bind(x.id).all(),
    d.prepare("SELECT COUNT(*) n FROM connections WHERE status = 'accepted' AND (a = ? OR b = ?)").bind(x.id, x.id).first(),
  ]);
  return json({
    profile: { ...(self || connected ? full(x) : card(x)), connection, connections: counts?.n || 0, note: connection === "received" ? c.note : undefined },
    posts,
  });
}
