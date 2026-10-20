/**
 * The board: public posts by signed-in principals, under their full name.
 * Each post and reply is translated ONCE, when written, into every site language;
 * every reader then sees it in their own language (with "Show original").
 */
import { json, error, clip, clipText, readJson, randomId, limited } from "../lib/http.js";
import { db, card, requireUser, isAdmin } from "../lib/db.js";
import { notify as phone } from "../lib/push.js";
import { sendMail, siteUrl } from "../lib/mail.js";
import { translate, stored, view, okLang, LANGS } from "../lib/translate.js";
import { tr } from "../lib/i18n.js";

const KINDS = new Set(["question", "idea", "offer"]);

/** Translates a new text into all languages. Row fields: text = English, original = as written (if not English), lang. */
async function written(env, d, item, src) {
  const r = await translate(env, d, item, src, LANGS);
  if (!r) return { text: src, original: null, lang: "und", t: {} };  // AI unavailable: shown as written, translated later
  if (r.lang === "en") return { text: src, original: null, lang: "en", t: r.t };
  return { text: r.t.en || src, original: src, lang: r.lang, t: r.t };
}

/** Translates up to a few older items the reader can't read yet, after the response is sent. */
function backfill(env, d, waitUntil, table, prefix, rows) {
  const todo = rows.slice(0, 4);
  if (!todo.length) return;
  waitUntil((async () => {
    for (const r of todo) {
      const src = r.original ?? r.text;
      const res = await translate(env, d, prefix + r.id, src, LANGS);
      if (res && r.lang === "und") {
        await d.prepare(`UPDATE ${table} SET text = ?, original = ?, lang = ? WHERE id = ?`)
          .bind(res.lang === "en" ? src : res.t.en || src, res.lang === "en" ? null : src, res.lang, r.id).run();
      }
    }
  })().catch(() => {}));
}

/** GET /api/board — latest posts with their authors, in the reader's language. */
export async function listPosts({ request, env, waitUntil }) {
  const u = await requireUser(env, request);
  const d = await db(env);
  const { results } = await d.prepare(
    `SELECT p.id AS post_id, p.kind, p.text AS src_text, p.original AS src_original, p.lang AS src_lang, p.created_at AS posted_at,
       (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS replies,
       (SELECT MAX(created_at) FROM comments c WHERE c.post_id = p.id) AS last_reply, u.*
     FROM posts p JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC LIMIT 200`
  ).all();
  const reader = okLang(u.lang);
  const trs = await stored(d, results.map((r) => `p:${r.post_id}`), reader);
  const missing = [];
  const posts = results.map((r) => {
    const row = { id: r.post_id, text: r.src_text, original: r.src_original, lang: r.src_lang }; // u.* has its own lang
    const v = view(row, trs.get(`p:${r.post_id}`), reader);
    if (v.missing) missing.push(row);
    return { id: r.post_id, kind: r.kind, text: v.text, original: v.original, lang: v.lang, at: r.posted_at, replies: r.replies, last_reply: r.last_reply, author: card(r) };
  });
  backfill(env, d, waitUntil, "posts", "p:", missing);
  return json({ me: u.id, posts });
}

/** POST /api/board { kind, text } */
export async function createPost({ request, env }) {
  const u = await requireUser(env, request);
  if (await limited(env, `post:${u.id}`, 3)) return error(429, "slow_down", "You've posted a few times in a row. Try again in a minute.");
  const b = await readJson(request);
  const text = clipText(b.text, 1000);
  if (text.length < 3) return error(400, "empty", "Write a few words first.");
  const d = await db(env);
  const post = { id: randomId(8), kind: KINDS.has(b.kind) ? b.kind : "question" };
  const w = await written(env, d, `p:${post.id}`, text);
  Object.assign(post, { text: w.text, original: w.original, lang: w.lang });
  const now = Date.now();
  await d.prepare("INSERT INTO posts (id, user_id, kind, text, original, lang, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(post.id, u.id, post.kind, post.text, post.original, post.lang, now).run();
  // The writer sees their post as written.
  return json({ post: { id: post.id, kind: post.kind, text, original: null, lang: post.lang, translated: post.lang !== "und", at: now, replies: 0, author: card(u) } }, 201);
}

/** POST /api/board/:id/report { reason } — flag a post for the foundation team. */
export async function reportPost({ request, env, params, waitUntil }) {
  const u = await requireUser(env, request);
  if (await limited(env, `report:${u.id}`, 5)) return error(429, "slow_down", "Try again in a minute.");
  const b = await readJson(request);
  const d = await db(env);
  const post = await d.prepare("SELECT p.id, p.text, a.full_name FROM posts p JOIN users a ON a.id = p.user_id WHERE p.id = ?").bind(params.id).first();
  if (!post) return error(404, "not_found", "This post was already removed.");
  const reason = clip(b.reason, 300);
  const r = await d.prepare("INSERT OR IGNORE INTO reports (id, post_id, reporter_id, reason, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(randomId(8), post.id, u.id, reason, Date.now()).run();
  const admins = String(env.ADMIN_EMAILS || "").split(/[\s,;]+/).filter(Boolean);
  if (r.meta?.changes && admins.length) {
    waitUntil(sendMail(env, {
      to: admins, subject: "A board post was reported",
      heading: "A board post was reported",
      lines: [`${u.full_name} reported a post by ${post.full_name}.`, reason ? `Reason: ${reason}` : "No reason given."],
      quote: post.text.slice(0, 400), button: "Review it", url: siteUrl(request, "#/admin"),
    }));
  }
  return json({ ok: true });
}

/** DELETE /api/board/:id — authors can remove their own posts. */
export async function deletePost({ request, env, params }) {
  const u = await requireUser(env, request);
  const d = await db(env);
  const mine = await d.prepare("SELECT 1 FROM posts WHERE id = ? AND user_id = ?").bind(params.id, u.id).first();
  if (mine) await d.batch([
    d.prepare("DELETE FROM reports WHERE post_id = ?").bind(params.id),
    d.prepare("DELETE FROM translations WHERE item = ? OR item IN (SELECT 'c:' || id FROM comments WHERE post_id = ?)").bind(`p:${params.id}`, params.id),
    d.prepare("DELETE FROM comments WHERE post_id = ?").bind(params.id),
    d.prepare("DELETE FROM posts WHERE id = ?").bind(params.id),
  ]);
  return json({ ok: true });
}

// ---------- replies ----------
const REPLY_MAIL_GAP = 2 * 60 * 60; // at most one email per conversation every two hours
const cut = (s, n) => (s.length > n ? `${s.slice(0, n)}…` : s);

/** GET /api/board/:id/comments — in the reader's language. */
export async function listComments({ request, env, params, waitUntil }) {
  const u = await requireUser(env, request);
  const d = await db(env);
  const { results } = await d.prepare(
    "SELECT c.id AS comment_id, c.text AS src_text, c.original AS src_original, c.lang AS src_lang, c.created_at AS at, u.* FROM comments c JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.created_at ASC LIMIT 300"
  ).bind(params.id).all();
  const reader = okLang(u.lang);
  const trs = await stored(d, results.map((r) => `c:${r.comment_id}`), reader);
  const missing = [];
  const comments = results.map((r) => {
    const row = { id: r.comment_id, text: r.src_text, original: r.src_original, lang: r.src_lang };
    const v = view(row, trs.get(`c:${r.comment_id}`), reader);
    if (v.missing) missing.push(row);
    return { id: r.comment_id, text: v.text, original: v.original, lang: v.lang, at: r.at, author: card(r) };
  });
  backfill(env, d, waitUntil, "comments", "c:", missing);
  return json({ me: u.id, admin: isAdmin(env, u), comments });
}

/** POST /api/board/:id/comments { text } — a reply. Everyone in the conversation is told, in their language. */
export async function addComment({ request, env, params, waitUntil }) {
  const u = await requireUser(env, request);
  if (await limited(env, `comment:${u.id}`, 8)) return error(429, "slow_down", "You're replying very fast. Try again in a minute.");
  const b = await readJson(request);
  const raw = clipText(b.text, 1000);
  if (raw.length < 2) return error(400, "empty", "Write a few words first.");
  const d = await db(env);
  const post = await d.prepare("SELECT p.*, a.full_name AS author_name FROM posts p JOIN users a ON a.id = p.user_id WHERE p.id = ?").bind(params.id).first();
  if (!post) return error(404, "not_found", "This post was removed.");
  const id = randomId(8);
  const w = await written(env, d, `c:${id}`, raw);
  const now = Date.now();
  await d.prepare("INSERT INTO comments (id, post_id, user_id, text, original, lang, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(id, post.id, u.id, w.text, w.original, w.lang, now).run();

  // Who is in this conversation: the post's author and everyone who replied, except the writer.
  const { results: people } = await d.prepare(
    "SELECT * FROM users WHERE id != ?2 AND (id = ?1 OR id IN (SELECT user_id FROM comments WHERE post_id = ?3))"
  ).bind(post.user_id, u.id, post.id).all();
  const postSrc = post.original ?? post.text;
  const postTr = new Map();
  for (const p of people) {
    const lang = okLang(p.lang);
    if (!postTr.has(lang)) postTr.set(lang, view(post, (await stored(d, [`p:${post.id}`], lang)).get(`p:${post.id}`), lang).text);
    const snippet = cut(postTr.get(lang) || postSrc, 70);
    const said = cut(w.lang === lang ? raw : (w.t[lang] || w.text), 160);
    const yours = p.id === post.user_id;
    const title = yours
      ? tr(lang, "reply_yours", { name: u.full_name, kind: tr(lang, `kind_${post.kind}`) || tr(lang, "kind_post") })
      : tr(lang, "reply_also", { name: u.full_name, snippet });
    await phone(env, d, p.id, { kind: "reply", title, body: said, url: `#/board/${post.id}` }, waitUntil);
    if (p.email_notify !== 0 && p.email) {
      const key = `mailreply:${post.id}:${p.id}`;
      if (!(env.BOARD && (await env.BOARD.get(key)))) {
        await env.BOARD?.put(key, "1", { expirationTtl: REPLY_MAIL_GAP });
        waitUntil(sendMail(env, {
          to: p.email, subject: title, heading: title, lang,
          lines: [yours ? tr(lang, "on_your_post", { snippet }) : tr(lang, "on_their_post", { author: post.author_name, snippet })],
          quote: said, button: tr(lang, "read_conversation"), url: siteUrl(request, `#/board/${post.id}`),
        }));
      }
    }
  }
  // The writer sees their reply as written.
  return json({ comment: { id, text: raw, original: null, lang: w.lang, at: now, author: card(u) } }, 201);
}

/** DELETE /api/board/comments/:id — your own reply, or any reply for the foundation team. */
export async function deleteComment({ request, env, params }) {
  const u = await requireUser(env, request);
  const d = await db(env);
  const c = await d.prepare("SELECT user_id FROM comments WHERE id = ?").bind(params.id).first();
  if (!c) return json({ ok: true });
  if (c.user_id !== u.id && !isAdmin(env, u)) return error(403, "forbidden", "You can only remove your own replies.");
  await d.batch([
    d.prepare("DELETE FROM translations WHERE item = ?").bind(`c:${params.id}`),
    d.prepare("DELETE FROM comments WHERE id = ?").bind(params.id),
  ]);
  return json({ ok: true });
}
