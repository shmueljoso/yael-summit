/** Small HTTP helpers shared by every API handler. */

export const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra },
  });

export const error = (status, code, message) => json({ error: code, message }, status);

export const clip = (s, n) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, n);
/** Like clip, but keeps line breaks (for bios and messages). */
export const clipText = (s, n) => String(s ?? "").replace(/\r/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim().slice(0, n);

/** Rejects cross-site writes, so nobody can post on a principal's behalf from another page. */
export function sameOrigin(request) {
  const origin = request.headers.get("origin");
  return !origin || new URL(origin).host === new URL(request.url).host;
}

export async function readJson(request, max = 20000) {
  const raw = await request.text();
  if (raw.length > max) throw Object.assign(new Error("too_large"), { status: 413 });
  try { return raw ? JSON.parse(raw) : {}; } catch { throw Object.assign(new Error("bad_json"), { status: 400 }); }
}

export function getCookie(request, name) {
  const all = request.headers.get("cookie") || "";
  for (const part of all.split(/;\s*/)) {
    const i = part.indexOf("=");
    if (i > 0 && part.slice(0, i) === name) return decodeURIComponent(part.slice(i + 1));
  }
  return null;
}

export async function sha256(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

export const randomId = (bytes = 16) =>
  [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

/** Per-key rate limit in KV (minimum window is KV's 60s TTL). Returns true when over the limit. */
export async function limited(env, key, max) {
  if (!env.BOARD) return false;
  const k = `rl:${key}`;
  const used = Number(await env.BOARD.get(k)) || 0;
  if (used >= max) return true;
  await env.BOARD.put(k, String(used + 1), { expirationTtl: 60 });
  return false;
}
