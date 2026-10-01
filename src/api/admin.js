/**
 * The foundation's admin page: who joined, fixing a wrong school, removing an account,
 * and reviewing reported board posts. Only for emails listed in the ADMIN_EMAILS secret.
 */
import { json, error, clip } from "../lib/http.js";
import { db, requireAdmin, deleteUserData } from "../lib/db.js";

/** GET /api/admin — members, open reports and a few numbers. */
export async function overview({ request, env }) {
  await requireAdmin(env, request);
  const d = await db(env);
  const [{ results: members }, { results: reports }, schools] = await Promise.all([
    d.prepare(
      `SELECT u.id, u.full_name, u.email, u.role_title, u.school, u.school_id, u.city, u.country, u.created_at, u.seen_at, u.avatar,
        (SELECT COUNT(*) FROM connections c WHERE c.status = 'accepted' AND (c.a = u.id OR c.b = u.id)) AS connections,
        (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id) AS posts
       FROM users u ORDER BY u.created_at DESC`
    ).all(),
    d.prepare(
      `SELECT r.id, r.reason, r.created_at, p.id AS post_id, p.text, p.kind, p.created_at AS posted_at,
        a.id AS author_id, a.full_name AS author, rp.full_name AS reporter
       FROM reports r JOIN posts p ON p.id = r.post_id JOIN users a ON a.id = p.user_id LEFT JOIN users rp ON rp.id = r.reporter_id
       ORDER BY r.created_at DESC`
    ).all(),
    d.prepare("SELECT COUNT(*) n, (SELECT COUNT(DISTINCT school_id) FROM users WHERE school_id IS NOT NULL) joined FROM schools").first(),
  ]);
  return json({
    members: members.map((m) => ({ ...m, avatar: m.avatar ? `/api/avatar/${m.id}?v=${m.avatar}` : null })),
    reports,
    counts: { members: members.length, schools: schools?.n || 0, schools_joined: schools?.joined || 0, reports: reports.length },
  });
}

/** PUT /api/admin/members/:id { school_id } — move a member to another school, or unlink (null). */
export async function setSchool({ request, env, params }) {
  await requireAdmin(env, request);
  const d = await db(env);
  const b = await request.json().catch(() => ({}));
  if (!b.school_id) {
    await d.prepare("UPDATE users SET school_id = NULL WHERE id = ?").bind(params.id).run();
    return json({ ok: true });
  }
  const s = await d.prepare("SELECT * FROM schools WHERE id = ?").bind(clip(b.school_id, 60)).first();
  if (!s) return error(404, "not_found", "That school isn't in the list.");
  await d.prepare("UPDATE users SET school_id = ?, school = ?, city = ?, country = ? WHERE id = ?").bind(s.id, s.name, s.city, s.country, params.id).run();
  return json({ ok: true });
}

/** DELETE /api/admin/members/:id — remove an account and everything it created. */
export async function removeMember({ request, env, params }) {
  const me = await requireAdmin(env, request);
  if (params.id === me.id) return error(400, "self", "To delete your own account, use Edit profile.");
  await deleteUserData(await db(env), params.id);
  return json({ ok: true });
}

/** DELETE /api/admin/posts/:id — remove any board post (and its reports). */
export async function removePost({ request, env, params }) {
  await requireAdmin(env, request);
  const d = await db(env);
  await d.batch([
    d.prepare("DELETE FROM reports WHERE post_id = ?").bind(params.id),
    d.prepare("DELETE FROM posts WHERE id = ?").bind(params.id),
  ]);
  return json({ ok: true });
}

/** DELETE /api/admin/reports/:id — the post is fine; close the report. */
export async function dismissReport({ request, env, params }) {
  await requireAdmin(env, request);
  await (await db(env)).prepare("DELETE FROM reports WHERE id = ?").bind(params.id).run();
  return json({ ok: true });
}
