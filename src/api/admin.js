/**
 * The foundation's admin page: who joined, fixing a wrong school, removing an account,
 * and reviewing reported board posts. Only for emails listed in the ADMIN_EMAILS secret.
 */
import { json, error, clip } from "../lib/http.js";
import { db, requireAdmin, deleteUserData, TOPICS } from "../lib/db.js";

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
    d.prepare("DELETE FROM comments WHERE post_id = ?").bind(params.id),
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

/**
 * GET /api/admin/impact — the network's impact, for the foundation (admin only).
 * Growth over time, connections across borders, what principals want to learn versus can teach,
 * conversations and the board.
 */
export async function impact({ request, env }) {
  await requireAdmin(env, request);
  const d = await db(env);
  const [{ results: users }, { results: conns }, msgs, posts, schools, { results: kinds }] = await Promise.all([
    d.prepare("SELECT id, full_name, school, country, school_id, topics, gives, seeks, created_at FROM users").all(),
    d.prepare("SELECT a, b, status, note, created_at, accepted_at FROM connections").all(),
    d.prepare("SELECT COUNT(*) n, COUNT(DISTINCT pair) pairs FROM messages").first(),
    d.prepare(`SELECT COUNT(*) n, (SELECT COUNT(*) FROM comments) replies,
      (SELECT COUNT(*) FROM posts p WHERE EXISTS (SELECT 1 FROM comments c WHERE c.post_id = p.id AND c.user_id != p.user_id)) answered FROM posts`).first(),
    d.prepare("SELECT COUNT(*) n, (SELECT COUNT(DISTINCT school_id) FROM users WHERE school_id IS NOT NULL) joined FROM schools").first(),
    d.prepare("SELECT kind, COUNT(*) n FROM posts GROUP BY kind").all(),
  ]);
  const parse = (s) => { try { return JSON.parse(s) || []; } catch { return []; } };
  const byId = new Map(users.map((u) => [u.id, u]));
  const accepted = conns.filter((c) => c.status === "accepted");
  const country = (id) => (byId.get(id)?.country || "").trim();

  // Growth by week: members joined and connections made (cumulative).
  const WEEK = 7 * 864e5;
  const first = Math.min(...users.map((u) => u.created_at), Date.now());
  const weeks = Math.max(1, Math.ceil((Date.now() - first) / WEEK));
  const step = Math.max(1, Math.ceil(weeks / 26));
  const growth = [];
  for (let w = 0; w <= weeks; w += step) {
    const t = first + w * WEEK;
    growth.push({ t, members: users.filter((u) => u.created_at <= t).length, connections: accepted.filter((c) => (c.accepted_at || c.created_at) <= t).length });
  }
  growth.push({ t: Date.now(), members: users.length, connections: accepted.length });

  // Across borders: country pairs, and how connected each country is.
  const pairs = new Map(), degree = new Map();
  let cross = 0;
  for (const c of accepted) {
    const x = country(c.a), y = country(c.b);
    for (const k of [x, y]) if (k) degree.set(k, (degree.get(k) || 0) + 1);
    if (x && y && x.toLowerCase() !== y.toLowerCase()) {
      cross++;
      const key = [x, y].sort().join(" ↔ ");
      pairs.set(key, (pairs.get(key) || 0) + 1);
    }
  }
  const top = (m, n) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, n).map(([k, v]) => ({ k, v }));

  // What principals want to learn (demand) versus what they can teach (supply).
  const demand = new Map(), supply = new Map(), working = new Map();
  for (const u of users) {
    for (const t of parse(u.seeks)) demand.set(t, (demand.get(t) || 0) + 1);
    for (const t of parse(u.gives)) supply.set(t, (supply.get(t) || 0) + 1);
    for (const t of parse(u.topics)) working.set(t, (working.get(t) || 0) + 1);
  }
  const topics = Object.entries(TOPICS).map(([k, label]) => ({ k, label, seek: demand.get(k) || 0, give: supply.get(k) || 0, work: working.get(k) || 0 }));

  // Most connected principals.
  const deg = new Map();
  for (const c of accepted) for (const id of [c.a, c.b]) deg.set(id, (deg.get(id) || 0) + 1);
  const connectors = [...deg.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
    .map(([id, n]) => ({ id, name: byId.get(id)?.full_name || "—", school: byId.get(id)?.school || "", country: country(id), n }));

  const countries = new Set(users.map((u) => (u.country || "").trim().toLowerCase()).filter(Boolean));
  return json({
    totals: {
      members: users.length, schools: schools?.n || 0, schools_joined: schools?.joined || 0, countries: countries.size,
      connections: accepted.length, pending: conns.length - accepted.length, cross_border: cross,
      met_in_person: accepted.filter((c) => /in person/i.test(c.note || "")).length,
      messages: msgs?.n || 0, conversations: msgs?.pairs || 0,
      posts: posts?.n || 0, replies: posts?.replies || 0, answered: posts?.answered || 0,
      avg_connections: users.length ? Math.round((accepted.length * 2 / users.length) * 10) / 10 : 0,
    },
    growth, pairs: top(pairs, 10), countries: top(degree, 12), topics, connectors,
    posts_by_kind: Object.fromEntries(kinds.map((r) => [r.kind, r.n])),
  });
}
