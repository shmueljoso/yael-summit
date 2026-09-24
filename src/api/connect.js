/**
 * POST /api/connect — Cloudflare Pages Function.
 * Matching runs in the browser for free; this endpoint only writes a short "why you should meet"
 * line and a conversation starter for up to 3 matches, in ONE Gemini call.
 *
 * Credit savers:
 *  - called only when the user clicks the AI button (never on page load)
 *  - input is reduced to topic ids + first names, lengths are capped
 *  - short system prompt, JSON output, small maxOutputTokens, minimal thinking
 *  - identical requests are served from Cloudflare's edge cache for 30 days
 *  - requests from other sites are rejected
 *
 * Env (Cloudflare Pages → Settings → Variables and Secrets):
 *   GEMINI_API_KEY  (secret, required)
 *   GEMINI_MODEL    (optional)
 */
import { json, clip, sameOrigin, sha256, gemini, modelOf } from "../lib/gemini.js";

const CACHE_SECONDS = 60 * 60 * 24 * 30;

const TOPICS = {
  climate: "school climate & safety", inclusion: "inclusion", ai: "AI & technology",
  staff: "teacher resilience", parents: "parents & community", wellbeing: "student wellbeing",
  gaps: "closing learning gaps", innovation: "pedagogical innovation", leadership: "leadership",
};
const LEVELS = { elem: "elementary", mid: "middle school", high: "high school", six: "6-year school" };
const REGIONS = { north: "North", haifa: "Haifa", center: "Center", jlm: "Jerusalem", south: "South" };

const SYSTEM = [
  "You connect Israeli school principals ahead of the Yael Foundation summit.",
  "For each match write in English: why — one warm, specific sentence (max 30 words) on why they should meet;",
  "opener — one concrete conversation-starter question (max 18 words). No superlatives, no emoji.",
  'Return JSON only: {"items":[{"id":number,"why":string,"opener":string}]}',
].join(" ");

const ids = (arr, dict) => (Array.isArray(arr) ? arr.filter((x) => x in dict).slice(0, 6) : []);
const names = (arr, dict) => ids(arr, dict).map((x) => dict[x]).join(", ") || "-";

function compact(body) {
  const me = body?.me ?? {};
  const matches = (Array.isArray(body?.matches) ? body.matches : []).slice(0, 3).map((m) => ({
    id: Number(m?.id) || 0,
    name: clip(m?.name, 20),
    level: LEVELS[m?.level] ? m.level : "",
    region: REGIONS[m?.region] ? m.region : "",
    topics: ids(m?.topics, TOPICS),
    gives: ids(m?.gives, TOPICS),
    seeks: ids(m?.seeks, TOPICS),
  }));
  return {
    me: {
      level: LEVELS[me.level] ? me.level : "",
      region: REGIONS[me.region] ? me.region : "",
      topics: ids(me.topics, TOPICS),
      gives: ids(me.gives, TOPICS),
      seeks: ids(me.seeks, TOPICS),
      note: clip(me.note, 200),
    },
    matches,
  };
}

function prompt({ me, matches }) {
  const lines = [
    `Me: ${LEVELS[me.level] || "-"}, ${REGIONS[me.region] || "-"}. Working on: ${names(me.topics, TOPICS)}. Strong in: ${names(me.gives, TOPICS)}. Want to learn: ${names(me.seeks, TOPICS)}.`,
  ];
  if (me.note) lines.push(`About my school: ${me.note}`);
  lines.push("Matches:");
  for (const m of matches) {
    lines.push(`id=${m.id} ${m.name} (${LEVELS[m.level] || "-"}, ${REGIONS[m.region] || "-"}) working on: ${names(m.topics, TOPICS)}; strong in: ${names(m.gives, TOPICS)}; wants to learn: ${names(m.seeks, TOPICS)}`);
  }
  return lines.join("\n");
}

export async function onRequestPost({ request, env, waitUntil }) {
  if (!sameOrigin(request)) return json({ error: "forbidden" }, 403);
  if (!env.GEMINI_API_KEY) return json({ error: "ai_not_configured" }, 503);

  const raw = await request.text();
  if (raw.length > 4000) return json({ error: "too_large" }, 413);
  let body;
  try { body = compact(JSON.parse(raw)); } catch { return json({ error: "bad_json" }, 400); }
  if (!body.matches.length) return json({ error: "no_matches" }, 400);

  const text = prompt(body);
  const cache = caches.default;
  const cacheKey = new Request(`https://cache.internal/connect/${await sha256(modelOf(env) + "\n" + text)}`);

  const hit = await cache.match(cacheKey);
  if (hit) {
    const r = new Response(hit.body, hit);
    r.headers.set("x-cache", "HIT");
    return r;
  }

  try {
    const { data, usage } = await gemini(env, { system: SYSTEM, text, maxOutputTokens: 450, temperature: 0.7 });
    const items = (Array.isArray(data?.items) ? data.items : []).slice(0, 3).map((it) => ({
      id: Number(it?.id),
      why: clip(it?.why, 280),
      opener: clip(it?.opener, 160),
    }));
    if (!items.length) return json({ error: "empty" }, 502);
    const res = json({ items }, 200, {
      "cache-control": `public, max-age=${CACHE_SECONDS}`,
      "x-cache": "MISS",
      ...(usage != null ? { "x-ai-tokens": String(usage) } : {}),
    });
    waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  } catch {
    return json({ error: "ai_failed" }, 502);
  }
}

export const onRequest = () => json({ error: "method_not_allowed" }, 405, { allow: "POST" });
