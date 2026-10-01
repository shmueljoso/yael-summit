/** Profiles: your own (view/edit/photo), the directory, and other principals' pages. */
import { json, error, clip, clipText, readJson } from "../lib/http.js";
import { db, card, full, currentUser, requireUser, connectionBetween, TOPICS, LEVELS, LINK_KINDS } from "../lib/db.js";
import { locate } from "../lib/places.js";

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
  const d = await db(env);
  // Picking a school from the list fixes its name and place; otherwise the typed values are used.
  const picked = b.school_id ? await d.prepare("SELECT * FROM schools WHERE id = ?").bind(clip(b.school_id, 60)).first() : null;
  const vals = {
    full_name,
    role_title: clip(b.role_title, 80),
    school: picked ? picked.name : clip(b.school, 100), city: picked ? picked.city : clip(b.city, 60), country: picked ? picked.country : clip(b.country, 60),
    school_id: picked ? picked.id : null,
    level: b.level in LEVELS ? b.level : picked?.level || "", bio: clipText(b.bio, 800),
    topics: JSON.stringify(topicList(b.topics)), gives: JSON.stringify(topicList(b.gives)), seeks: JSON.stringify(topicList(b.seeks)),
    links: JSON.stringify(links), phone: clip(b.phone, 40),
  };
  [vals.lat, vals.lng] = locate(vals.city, vals.country) || [null, null];
  const cols = Object.keys(vals);
  await d.prepare(`UPDATE users SET ${cols.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`).bind(...cols.map((c) => vals[c]), u.id).run();
  const fresh = await d.prepare("SELECT * FROM users WHERE id = ?").bind(u.id).first();
  return json({ me: full(fresh) });
}

/**
 * Profile photos live in D1 next to the profile, so every device sees the same photo
 * the moment it's saved. (They used to be in KV, which other locations can see late.)
 */

/** PUT /api/me/avatar — body is a JPEG/PNG/WebP data URL, already resized in the browser. */
export async function putAvatar({ request, env }) {
  const u = await requireUser(env, request);
  const b = await readJson(request, 400000);
  const m = String(b.image || "").match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);
  if (!m) return error(400, "bad_image", "Upload a JPG, PNG or WebP image.");
  const bytes = Uint8Array.from(atob(m[2]), (c) => c.charCodeAt(0));
  if (bytes.length > 250000) return error(413, "too_large", "That photo is too large. Try a smaller one.");
  const d = await db(env);
  await d.batch([
    d.prepare("INSERT INTO avatars (user_id, type, data) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET type = excluded.type, data = excluded.data").bind(u.id, m[1], bytes),
    d.prepare("UPDATE users SET avatar = avatar + 1 WHERE id = ?").bind(u.id),
  ]);
  const fresh = await d.prepare("SELECT * FROM users WHERE id = ?").bind(u.id).first();
  return json({ me: full(fresh) });
}

/** DELETE /api/me/avatar */
export async function deleteAvatar({ request, env }) {
  const u = await requireUser(env, request);
  const d = await db(env);
  await d.batch([
    d.prepare("DELETE FROM avatars WHERE user_id = ?").bind(u.id),
    d.prepare("UPDATE users SET avatar = 0 WHERE id = ?").bind(u.id),
  ]);
  if (env.BOARD) await env.BOARD.delete(`avatar:${u.id}`).catch(() => {});
  return json({ ok: true });
}

/** GET /api/avatar/:id — photos are only for signed-in principals. URLs are versioned, so cache hard. */
export async function avatar({ request, env, params }) {
  await requireUser(env, request);
  const d = await db(env);
  let row = await d.prepare("SELECT type, data FROM avatars WHERE user_id = ?").bind(params.id).first();
  if (!row && env.BOARD) {
    // A photo saved before the move to D1: copy it over once.
    const { value, metadata } = (await env.BOARD.getWithMetadata(`avatar:${params.id}`, "arrayBuffer")) || {};
    if (value) {
      row = { type: metadata?.type || "image/jpeg", data: value };
      await d.prepare("INSERT OR IGNORE INTO avatars (user_id, type, data) VALUES (?, ?, ?)").bind(params.id, row.type, new Uint8Array(value)).run();
    }
  }
  if (!row) return new Response("Not found", { status: 404, headers: { "cache-control": "no-store" } });
  const data = row.data instanceof ArrayBuffer ? row.data : new Uint8Array(row.data);
  return new Response(data, { headers: { "content-type": row.type, "cache-control": "private, max-age=31536000, immutable" } });
}

/** GET /api/schools — every school in the network, for the school picker. Signed-in only. */
export async function schools({ request, env }) {
  await requireUser(env, request);
  const d = await db(env);
  const { results } = await d.prepare("SELECT id, name, city, country, level FROM schools ORDER BY name COLLATE NOCASE").all();
  return json({ schools: results });
}

/** Schools in the list whose principal hasn't joined yet. */
export const UNJOINED_SCHOOLS = "SELECT s.* FROM schools s WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.school_id = s.id) ORDER BY s.country, s.city, s.name";

/** GET /api/people?q=&topic= — the directory, with your connection status to each person, plus schools not on it yet. */
export async function people({ request, env }) {
  const u = await requireUser(env, request);
  const url = new URL(request.url);
  const q = clip(url.searchParams.get("q"), 60).toLowerCase();
  const topic = url.searchParams.get("topic");
  const d = await db(env);
  const [{ results: users }, { results: conns }, { results: waiting }] = await Promise.all([
    d.prepare("SELECT * FROM users WHERE id != ? ORDER BY created_at DESC LIMIT 1000").bind(u.id).all(),
    d.prepare("SELECT * FROM connections WHERE a = ? OR b = ?").bind(u.id, u.id).all(),
    d.prepare(UNJOINED_SCHOOLS).all(),
  ]);
  const status = new Map(conns.map((c) => [c.a === u.id ? c.b : c.a, c.status === "accepted" ? "connected" : c.requested_by === u.id ? "sent" : "received"]));
  const list = users
    .map((x) => ({ ...card(x), connection: status.get(x.id) || null }))
    .filter((p) => !topic || p.topics.includes(topic))
    .filter((p) => !q || [p.full_name, p.school, p.city, p.country].join(" ").toLowerCase().includes(q));
  const schoolsLeft = topic ? [] : waiting
    .map((s) => ({ id: s.id, name: s.name, city: s.city, country: s.country, level: s.level }))
    .filter((s) => !q || [s.name, s.city, s.country].join(" ").toLowerCase().includes(q));
  return json({ people: list, schools: schoolsLeft });
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
