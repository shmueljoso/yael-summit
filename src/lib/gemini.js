/**
 * Shared Gemini helper for the Pages Functions.
 * Every call is small by design: short system prompt, JSON output, capped output tokens,
 * minimal thinking. Callers add edge caching on top.
 */

export const DEFAULT_MODEL = "gemini-3.5-flash-lite";

export const modelOf = (env) => env.GEMINI_MODEL || DEFAULT_MODEL;

export const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", ...extra },
  });

export const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);

/** Rejects requests posted from another site, so the key can't be used from someone else's page. */
export function sameOrigin(request) {
  const origin = request.headers.get("origin");
  return !origin || new URL(origin).host === new URL(request.url).host;
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Calls Gemini once and returns { data, usage } where data is the parsed JSON reply.
 * Asks for minimal thinking; if the model rejects that setting, retries once without it.
 */
export async function gemini(env, { system, text, maxOutputTokens = 400, temperature = 0.6 }) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelOf(env))}:generateContent`;
  const base = {
    systemInstruction: { parts: [{ text: system }] },
    contents: [{ role: "user", parts: [{ text }] }],
    generationConfig: { temperature, maxOutputTokens, responseMimeType: "application/json" },
  };
  const send = (body) =>
    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": env.GEMINI_API_KEY },
      body: JSON.stringify(body),
    });

  let res = await send({ ...base, generationConfig: { ...base.generationConfig, thinkingConfig: { thinkingLevel: "minimal" } } });
  if (res.status === 400) res = await send(base);
  if (!res.ok) throw new Error(`gemini ${res.status}`);

  const out = await res.json();
  const raw = out?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  const data = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  return { data, usage: out?.usageMetadata?.totalTokenCount ?? null };
}
