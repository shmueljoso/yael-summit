/**
 * Shared Gemini helper. Every call is small by design: short system prompt, JSON output,
 * capped output tokens, minimal thinking. Callers cache results so a question is paid for once.
 */

export const DEFAULT_MODEL = "gemini-3.5-flash-lite";

export const modelOf = (env) => env.GEMINI_MODEL || DEFAULT_MODEL;

/**
 * Calls Gemini once and returns { data, usage } where data is the parsed JSON reply.
 * Asks for minimal thinking; if the model rejects that setting, retries once without it.
 */
export async function gemini(env, { system, text, maxOutputTokens = 400, temperature = 0.6 }) {
  if (!env.GEMINI_API_KEY) throw Object.assign(new Error("ai_not_configured"), { status: 503 });
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
  if (!res.ok) throw Object.assign(new Error(`gemini ${res.status}`), { status: 502 });

  const out = await res.json();
  const raw = out?.candidates?.[0]?.content?.parts?.map((p) => p.text || "").join("") || "";
  const data = JSON.parse(raw.replace(/^```(?:json)?\s*|\s*```$/g, ""));
  return { data, usage: out?.usageMetadata?.totalTokenCount ?? null };
}
