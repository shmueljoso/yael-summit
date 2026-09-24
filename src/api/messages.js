/** Direct messages. Only between principals who are connected. */
import { json, error, clipText, readJson, limited } from "../lib/http.js";
import { db, card, requireUser, connectionBetween, pairKey } from "../lib/db.js";

/** GET /api/messages — your conversations, newest first, with unread counts. */
export async function conversations({ request, env }) {
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
  return json({
    conversations: results.map((m) => ({
      with: byId.get(m.from_id === u.id ? m.to_id : m.from_id),
      last: { body: m.body.slice(0, 140), mine: m.from_id === u.id, at: m.created_at },
      unread: m.unread,
    })).filter((c) => c.with),
  });
}

/** GET /api/messages/:id?after= — the thread with one principal; marks their messages read. */
export async function thread({ request, env, params }) {
  const u = await requireUser(env, request);
  const d = await db(env);
  const c = await connectionBetween(d, u.id, params.id);
  if (c?.status !== "accepted") return error(403, "not_connected", "You can message a principal once you're connected.");
  const after = Number(new URL(request.url).searchParams.get("after")) || 0;
  const pair = pairKey(u.id, params.id);
  const { results } = await d.prepare(
    "SELECT id, from_id, body, created_at FROM messages WHERE pair = ? AND id > ? ORDER BY id DESC LIMIT 200"
  ).bind(pair, after).all();
  await d.prepare("UPDATE messages SET read_at = ? WHERE pair = ? AND to_id = ? AND read_at IS NULL").bind(Date.now(), pair, u.id).run();
  const other = await d.prepare("SELECT * FROM users WHERE id = ?").bind(params.id).first();
  return json({ with: card(other), messages: results.reverse().map((m) => ({ id: m.id, mine: m.from_id === u.id, body: m.body, at: m.created_at })) });
}

/** POST /api/messages/:id { body } */
export async function send({ request, env, params }) {
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
  return json({ message: { id: r.id, mine: true, body, at: r.created_at } }, 201);
}
