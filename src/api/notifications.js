/** Notifications for phones: the list the Android app and the service worker read, and push sign-up. */
import { json, error, clip, readJson } from "../lib/http.js";
import { db, requireUser } from "../lib/db.js";
import { vapidKeys } from "../lib/push.js";

/** GET /api/notifications?after=<id> — newest first, at most 20. `latest` is the newest id overall. */
export async function list({ request, env }) {
  const u = await requireUser(env, request);
  const after = Number(new URL(request.url).searchParams.get("after")) || 0;
  const d = await db(env);
  const [{ results }, top] = await Promise.all([
    d.prepare("SELECT id, kind, title, body, url, created_at FROM notifications WHERE user_id = ? AND id > ? ORDER BY id DESC LIMIT 20").bind(u.id, after).all(),
    d.prepare("SELECT MAX(id) id FROM notifications WHERE user_id = ?").bind(u.id).first(),
  ]);
  return json({ notifications: results, latest: top?.id || 0 });
}

/** GET /api/push/key — the public key browsers need to subscribe. */
export async function key({ env }) {
  return json({ key: (await vapidKeys(await db(env))).publicKey }, 200, { "cache-control": "public, max-age=86400" });
}

/** POST /api/push { endpoint } — this browser wants notifications. DELETE removes it. */
export async function subscribe({ request, env }) {
  const u = await requireUser(env, request);
  const b = await readJson(request);
  const endpoint = clip(b.endpoint, 1000);
  if (!/^https:\/\//.test(endpoint)) return error(400, "bad_endpoint", "That subscription isn't valid.");
  const d = await db(env);
  await d.prepare("INSERT INTO push_subs (endpoint, user_id, created_at) VALUES (?, ?, ?) ON CONFLICT(endpoint) DO UPDATE SET user_id = excluded.user_id")
    .bind(endpoint, u.id, Date.now()).run();
  return json({ ok: true });
}

export async function unsubscribe({ request, env }) {
  const u = await requireUser(env, request);
  const b = await readJson(request);
  await (await db(env)).prepare("DELETE FROM push_subs WHERE endpoint = ? AND user_id = ?").bind(clip(b.endpoint, 1000), u.id).run();
  return json({ ok: true });
}
