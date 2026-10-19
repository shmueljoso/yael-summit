/**
 * The board: public posts by signed-in principals, under their full name.
 * Posts in any language are translated to English ONCE, when saved — never when read.
 * Posts already in Latin script skip the AI entirely.
 */
import { json, error, clip, clipText, readJson, randomId, limited } from "../lib/http.js";
import { db, card, requireUser, isAdmin } from "../lib/db.js";
import { notify as phone } from "../lib/push.js";
import { gemini } from "../lib/gemini.js";
import { sendMail, siteUrl } from "../lib/mail.js";

const KINDS = new Set(["question", "idea", "offer"]);
const needsTranslation = (s) => /[^\u0000-ɏḀ-ỿ -⁯₠-⃏\s]/.test(s);

const SYSTEM = [
  "Translate a post by a Jewish school principal into natural, faithful English for an international conference board.",
  "Keep the tone and meaning; do not add, summarize or censor. Keep Hebrew terms that English readers in Jewish education use (e.g. Shabbat, Kabbalat Shabbat).",
  "lang is the ISO 639-1 code of the original.",
  'Return JSON only: {"lang":string,"text":string}',
].join(" ");

/** English text for the board: translated once when written; English skips the AI. */
async function translated(env, text) {
  if (!needsTranslation(text)) return { text, original: null, lang: "en" };
  const { data } = await gemini(env, { system: SYSTEM, text, maxOutputTokens: 600, temperature: 0.2 });
  return { text: clipText(data?.text, 1500) || text, original: text, lang: clip(data?.lang, 5).toLowerCase() || "und" };
}

/** GET /api/board — latest posts with their authors. */
export async function listPosts({ request, env }) {
  const u = await requireUser(env, request);
  const d = await db(env);
  const { results } = await d.prepare(
    `SELECT p.id AS post_id, p.kind, p.text, p.original, p.lang, p.created_at AS posted_at,
       (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS replies,
       (SELECT MAX(created_at) FROM comments c WHERE c.post_id = p.id) AS last_reply, u.*
     FROM posts p JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC LIMIT 200`
  ).all();
  return json({
    me: u.id,
    posts: results.map((r) => ({ id: r.post_id, kind: r.kind, text: r.text, original: r.original, lang: r.lang, at: r.posted_at, replies: r.replies, last_reply: r.last_reply, author: card(r) })),
  });
}

/** POST /api/board { kind, text } */
export async function createPost({ request, env }) {
  const u = await requireUser(env, request);
  if (await limited(env, `post:${u.id}`, 3)) return error(429, "slow_down", "You've posted a few times in a row. Try again in a minute.");
  const b = await readJson(request);
  const text = clipText(b.text, 1000);
  if (text.length < 3) return error(400, "empty", "Write a few words first.");
  const post = { id: randomId(8), kind: KINDS.has(b.kind) ? b.kind : "question", text, original: null, lang: "en" };

  Object.assign(post, await translated(env, text));
  const d = await db(env);
  const now = Date.now();
  await d.prepare("INSERT INTO posts (id, user_id, kind, text, original, lang, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(post.id, u.id, post.kind, post.text, post.original, post.lang, now).run();
  return json({ post: { ...post, at: now, author: card(u) } }, 201);
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
    d.prepare("DELETE FROM comments WHERE post_id = ?").bind(params.id),
    d.prepare("DELETE FROM posts WHERE id = ?").bind(params.id),
  ]);
  return json({ ok: true });
}

// ---------- replies ----------
const KIND_WORD = { question: "question", idea: "idea", offer: "offer" };
const REPLY_MAIL_GAP = 2 * 60 * 60; // at most one email per conversation every two hours

/** GET /api/board/:id/comments */
export async function listComments({ request, env, params }) {
  const u = await requireUser(env, request);
  const d = await db(env);
  const { results } = await d.prepare(
    "SELECT c.id AS comment_id, c.text, c.original, c.lang, c.created_at AS at, u.* FROM comments c JOIN users u ON u.id = c.user_id WHERE c.post_id = ? ORDER BY c.created_at ASC LIMIT 300"
  ).bind(params.id).all();
  return json({ me: u.id, admin: isAdmin(env, u), comments: results.map((r) => ({ id: r.comment_id, text: r.text, original: r.original, lang: r.lang, at: r.at, author: card(r) })) });
}

/** POST /api/board/:id/comments { text } — a reply. Everyone in the conversation is told. */
export async function addComment({ request, env, params, waitUntil }) {
  const u = await requireUser(env, request);
  if (await limited(env, `comment:${u.id}`, 8)) return error(429, "slow_down", "You're replying very fast. Try again in a minute.");
  const b = await readJson(request);
  const raw = clipText(b.text, 1000);
  if (raw.length < 2) return error(400, "empty", "Write a few words first.");
  const d = await db(env);
  const post = await d.prepare("SELECT p.*, a.full_name AS author_name FROM posts p JOIN users a ON a.id = p.user_id WHERE p.id = ?").bind(params.id).first();
  if (!post) return error(404, "not_found", "This post was removed.");
  const c = { id: randomId(8), ...(await translated(env, raw)) };
  const now = Date.now();
  await d.prepare("INSERT INTO comments (id, post_id, user_id, text, original, lang, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(c.id, post.id, u.id, c.text, c.original, c.lang, now).run();

  // Who is in this conversation: the post's author and everyone who replied, except the writer.
  const { results: people } = await d.prepare(
    "SELECT * FROM users WHERE id != ?2 AND (id = ?1 OR id IN (SELECT user_id FROM comments WHERE post_id = ?3))"
  ).bind(post.user_id, u.id, post.id).all();
  const snippet = post.text.length > 70 ? `${post.text.slice(0, 70)}…` : post.text;
  const said = c.text.length > 160 ? `${c.text.slice(0, 160)}…` : c.text;
  for (const p of people) {
    const yours = p.id === post.user_id;
    const title = yours ? `${u.full_name} replied to your ${KIND_WORD[post.kind] || "post"}` : `${u.full_name} also replied on “${snippet}”`;
    await phone(env, d, p.id, { kind: "reply", title, body: said, url: `#/board/${post.id}` }, waitUntil);
    if (p.email_notify !== 0 && p.email) {
      const key = `mailreply:${post.id}:${p.id}`;
      if (!(env.BOARD && (await env.BOARD.get(key)))) {
        await env.BOARD?.put(key, "1", { expirationTtl: REPLY_MAIL_GAP });
        waitUntil(sendMail(env, {
          to: p.email, subject: title, heading: title,
          lines: [yours ? `On your post: “${snippet}”` : `On ${post.author_name}'s post: “${snippet}”`],
          quote: said, button: "Read the conversation", url: siteUrl(request, `#/board/${post.id}`),
        }));
      }
    }
  }
  return json({ comment: { ...c, at: now, author: card(u) } }, 201);
}

/** DELETE /api/board/comments/:id — your own reply, or any reply for the foundation team. */
export async function deleteComment({ request, env, params }) {
  const u = await requireUser(env, request);
  const d = await db(env);
  const c = await d.prepare("SELECT user_id FROM comments WHERE id = ?").bind(params.id).first();
  if (!c) return json({ ok: true });
  if (c.user_id !== u.id && !isAdmin(env, u)) return error(403, "forbidden", "You can only remove your own replies.");
  await d.prepare("DELETE FROM comments WHERE id = ?").bind(params.id).run();
  return json({ ok: true });
}
