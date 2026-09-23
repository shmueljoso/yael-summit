/**
 * /api/board — the principals' message board.
 *   GET  → latest posts (English, with the original text when translated)
 *   POST → { kind, name, school, text } in any language; saved in English
 *
 * Translation happens ONCE, when a post is saved — never when people read the board.
 * Posts already in English (Latin script) skip the AI completely.
 * One Gemini call translates the text, name and school together and flags spam/abuse.
 *
 * Needs a KV namespace bound as BOARD (Pages → Settings → Bindings → KV namespace).
 */
import { json, clip, sameOrigin, gemini } from "../../lib/gemini.js";

const KEY = "posts";
const KEEP = 150;           // posts kept on the board
const PER_MINUTE = 3;       // posts per IP per minute
const KINDS = new Set(["question", "idea", "offer"]);

// Anything outside Latin script (Hebrew, Arabic, Cyrillic, Amharic…) needs translating.
const needsTranslation = (s) => /[^\u0000-ɏḀ-ỿ -⁯₠-⃏\s]/.test(s);

const SYSTEM = [
  "You translate posts written by Israeli school principals for an English-language conference board.",
  "Translate text into natural, faithful English — keep the tone, do not add or summarize.",
  "Transliterate the person's name into English letters and translate the school name.",
  "lang is the ISO 639-1 code of the original text.",
  "ok is false only for spam, abuse, or identifying details about a specific student.",
  'Return JSON only: {"lang":string,"text":string,"name":string,"school":string,"ok":boolean}',
].join(" ");

async function readPosts(env) {
  return (await env.BOARD.get(KEY, "json")) || [];
}

export async function onRequestGet({ env }) {
  if (!env.BOARD) return json({ error: "board_not_configured" }, 503);
  const posts = await readPosts(env);
  return json({ posts: posts.slice(0, 60) }, 200, { "cache-control": "public, max-age=15" });
}

export async function onRequestPost({ request, env }) {
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  if (!env.BOARD) return json({ error: "board_not_configured" }, 503);

  const raw = await request.text();
  if (raw.length > 3000) return json({ error: "too_large" }, 413);
  let body;
  try { body = JSON.parse(raw); } catch { return json({ error: "bad_json" }, 400); }

  const post = {
    kind: KINDS.has(body?.kind) ? body.kind : "question",
    name: clip(body?.name, 40),
    school: clip(body?.school, 60),
    text: clip(body?.text, 500),
  };
  if (post.text.length < 3) return json({ error: "empty" }, 400);

  // Light rate limit per IP (KV's minimum TTL is 60s).
  const ip = request.headers.get("cf-connecting-ip") || "unknown";
  const rlKey = `rl:${ip}`;
  const used = Number(await env.BOARD.get(rlKey)) || 0;
  if (used >= PER_MINUTE) return json({ error: "slow_down" }, 429);
  await env.BOARD.put(rlKey, String(used + 1), { expirationTtl: 60 });

  let saved = { ...post, lang: "en" };
  if (needsTranslation(post.text)) {
    if (!env.GEMINI_API_KEY) return json({ error: "ai_not_configured" }, 503);
    try {
      const { data } = await gemini(env, {
        system: SYSTEM,
        text: `name: ${post.name || "-"}\nschool: ${post.school || "-"}\ntext: ${post.text}`,
        maxOutputTokens: 400,
        temperature: 0.2,
      });
      if (data?.ok === false) return json({ error: "rejected" }, 422);
      saved = {
        ...post,
        lang: clip(data?.lang, 5).toLowerCase() || "und",
        text: clip(data?.text, 900) || post.text,
        name: clip(data?.name, 60) || post.name,
        school: clip(data?.school, 80) || post.school,
        original: post.text,
      };
    } catch {
      return json({ error: "ai_failed" }, 502);
    }
  }

  saved.id = crypto.randomUUID();
  saved.ts = Date.now();

  // Single-key list: simple and fine at conference scale.
  const posts = await readPosts(env);
  posts.unshift(saved);
  await env.BOARD.put(KEY, JSON.stringify(posts.slice(0, KEEP)));

  return json({ post: saved }, 201);
}

export const onRequest = () => json({ error: "method_not_allowed" }, 405, { allow: "GET, POST" });
