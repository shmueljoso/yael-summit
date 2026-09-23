/**
 * POST /api/connect — Cloudflare Pages Function.
 * The matching itself runs in the browser for free; this endpoint only writes a short
 * "why you should meet" line and an opening question for up to 3 matches, in ONE Gemini call.
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
 *   GEMINI_MODEL    (optional, default below)
 */

const DEFAULT_MODEL = "gemini-3.5-flash-lite";
const CACHE_SECONDS = 60 * 60 * 24 * 30;

const TOPICS = {
  climate: "אקלים ומוגנות", inclusion: "שילוב והכלה", ai: "AI וטכנולוגיה",
  staff: "צוות וחוסן מורים", parents: "הורים וקהילה", wellbeing: "רווחה רגשית",
  gaps: "צמצום פערים", innovation: "פדגוגיה חדשנית", leadership: "ניהול ומנהיגות",
};
const LEVELS = { elem: "יסודי", mid: "חט״ב", high: "תיכון", six: "שש־שנתי" };
const REGIONS = { north: "צפון", haifa: "חיפה", center: "מרכז", jlm: "ירושלים", south: "דרום" };

const SYSTEM = [
  "את/ה מחבר/ת בין מנהלי בתי ספר לקראת כנס של קרן יעל.",
  "לכל התאמה כתוב/י בעברית: why — משפט אחד חם ומדויק (עד 30 מילים) למה כדאי להם להיפגש,",
  "ו-opener — שאלת פתיחה אחת קונקרטית לשיחה (עד 18 מילים). בלי סופרלטיבים, בלי אימוג׳י.",
  'החזר/י JSON בלבד: {"items":[{"id":number,"why":string,"opener":string}]}',
].join(" ");

const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });

const ids = (arr, dict) => (Array.isArray(arr) ? arr.filter((x) => x in dict).slice(0, 6) : []);
const names = (arr, dict) => ids(arr, dict).map((x) => dict[x]).join(", ") || "-";
const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

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
    `אני: ${LEVELS[me.level] || "-"}, ${REGIONS[me.region] || "-"}. מתמודד/ת עם: ${names(me.topics, TOPICS)}. חזק/ה ב: ${names(me.gives, TOPICS)}. רוצה ללמוד: ${names(me.seeks, TOPICS)}.`,
  ];
  if (me.note) lines.push(`על בית הספר שלי: ${me.note}`);
  lines.push("התאמות:");
  for (const m of matches) {
    lines.push(`id=${m.id} ${m.name} (${LEVELS[m.level] || "-"}, ${REGIONS[m.region] || "-"}) מתמודד/ת: ${names(m.topics, TOPICS)}; חזק/ה ב: ${names(m.gives, TOPICS)}; רוצה ללמוד: ${names(m.seeks, TOPICS)}`);
  }
  return lines.join("\n");
}

async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function callGemini(env, text) {
  const model = env.GEMINI_MODEL || DEFAULT_MODEL;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const base = {
    systemInstruction: { parts: [{ text: SYSTEM }] },
    contents: [{ role: "user", parts: [{ text }] }],
    generationConfig: {
      temperature: 0.7,
      maxOutputTokens: 450,
      responseMimeType: "application/json",
    },
  };
  const send = (body) =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify(body),
    });

  // Ask for minimal thinking (fewer billed tokens). If this model doesn't accept the
  // setting, retry once without it.
  let res = await send({ ...base, generationConfig: { ...base.generationConfig, thinkingConfig: { thinkingLevel: "minimal" } } });
  if (res.status === 400) res = await send(base);
  if (!res.ok) throw new Error(`gemini ${res.status}`);

  const data = await res.json();
  const out = data?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  const parsed = JSON.parse(out.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  const items = (Array.isArray(parsed?.items) ? parsed.items : []).slice(0, 3).map((it) => ({
    id: Number(it?.id),
    why: clip(it?.why, 280),
    opener: clip(it?.opener, 160),
  }));
  return { items, usage: data?.usageMetadata?.totalTokenCount ?? null };
}

export async function onRequestPost({ request, env, waitUntil }) {
  // Same-site only, so the key can't be used from someone else's page.
  const origin = request.headers.get("origin");
  if (origin && new URL(origin).host !== new URL(request.url).host) {
    return json({ error: "forbidden" }, 403);
  }
  if (!env.GEMINI_API_KEY) return json({ error: "ai_not_configured" }, 503);

  const raw = await request.text();
  if (raw.length > 4000) return json({ error: "too_large" }, 413);
  let body;
  try { body = compact(JSON.parse(raw)); } catch { return json({ error: "bad_json" }, 400); }
  if (!body.matches.length) return json({ error: "no_matches" }, 400);

  const text = prompt(body);
  const cache = caches.default;
  const cacheKey = new Request(`https://cache.internal/connect/${await sha256((env.GEMINI_MODEL || DEFAULT_MODEL) + "\n" + text)}`);

  const hit = await cache.match(cacheKey);
  if (hit) {
    const r = new Response(hit.body, hit);
    r.headers.set("x-cache", "HIT");
    return r;
  }

  try {
    const { items, usage } = await callGemini(env, text);
    if (!items.length) return json({ error: "empty" }, 502);
    const res = json({ items }, 200, {
      "cache-control": `public, max-age=${CACHE_SECONDS}`,
      "x-cache": "MISS",
      ...(usage != null ? { "x-ai-tokens": String(usage) } : {}),
    });
    waitUntil(cache.put(cacheKey, res.clone()));
    return res;
  } catch (err) {
    return json({ error: "ai_failed" }, 502);
  }
}

export const onRequest = () => json({ error: "method_not_allowed" }, 405, { allow: "POST" });
