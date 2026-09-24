/**
 * The board: public posts by signed-in principals, under their full name.
 * Posts in any language are translated to English ONCE, when saved — never when read.
 * Posts already in Latin script skip the AI entirely.
 */
import { json, error, clip, clipText, readJson, randomId, limited } from "../lib/http.js";
import { db, card, requireUser } from "../lib/db.js";
import { gemini } from "../lib/gemini.js";

const KINDS = new Set(["question", "idea", "offer"]);
const needsTranslation = (s) => /[^\u0000-ɏḀ-ỿ -⁯₠-⃏\s]/.test(s);

const SYSTEM = [
  "Translate a post by a Jewish school principal into natural, faithful English for an international conference board.",
  "Keep the tone and meaning; do not add, summarize or censor. Keep Hebrew terms that English readers in Jewish education use (e.g. Shabbat, Kabbalat Shabbat).",
  "lang is the ISO 639-1 code of the original.",
  'Return JSON only: {"lang":string,"text":string}',
].join(" ");

/** GET /api/board — latest posts with their authors. */
export async function listPosts({ request, env }) {
  const u = await requireUser(env, request);
  const d = await db(env);
  const { results } = await d.prepare(
    "SELECT p.id AS post_id, p.kind, p.text, p.original, p.lang, p.created_at AS posted_at, u.* FROM posts p JOIN users u ON u.id = p.user_id ORDER BY p.created_at DESC LIMIT 100"
  ).all();
  return json({
    me: u.id,
    posts: results.map((r) => ({ id: r.post_id, kind: r.kind, text: r.text, original: r.original, lang: r.lang, at: r.posted_at, author: card(r) })),
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

  if (needsTranslation(text)) {
    const { data } = await gemini(env, { system: SYSTEM, text, maxOutputTokens: 600, temperature: 0.2 });
    post.lang = clip(data?.lang, 5).toLowerCase() || "und";
    post.text = clipText(data?.text, 1500) || text;
    post.original = text;
  }
  const d = await db(env);
  const now = Date.now();
  await d.prepare("INSERT INTO posts (id, user_id, kind, text, original, lang, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)")
    .bind(post.id, u.id, post.kind, post.text, post.original, post.lang, now).run();
  return json({ post: { ...post, at: now, author: card(u) } }, 201);
}

/** DELETE /api/board/:id — authors can remove their own posts. */
export async function deletePost({ request, env, params }) {
  const u = await requireUser(env, request);
  const d = await db(env);
  await d.prepare("DELETE FROM posts WHERE id = ? AND user_id = ?").bind(params.id, u.id).run();
  return json({ ok: true });
}
