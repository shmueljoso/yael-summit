/**
 * Firebase Cloud Messaging: wakes the Android app the moment something happens, even when it's closed.
 *
 * Turned on by the FCM_SERVICE_ACCOUNT secret in Cloudflare (the whole JSON key file from
 * Firebase → Project settings → Service accounts). Without it nothing is sent and the app falls
 * back to checking every ~15 minutes by itself.
 *
 * Like Web Push, the message carries no content: it only says "something new". The app then reads
 * the notification from /api/notifications with its own sign-in, so names and messages never pass
 * through Google's servers.
 */
const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (obj) => b64u(new TextEncoder().encode(JSON.stringify(obj)));

let account = null, accountRaw = null, cached = null;

function serviceAccount(env) {
  if (!env.FCM_SERVICE_ACCOUNT) return null;
  if (accountRaw !== env.FCM_SERVICE_ACCOUNT) {
    accountRaw = env.FCM_SERVICE_ACCOUNT; cached = null;
    try { account = JSON.parse(env.FCM_SERVICE_ACCOUNT); } catch { account = null; console.log("FCM_SERVICE_ACCOUNT isn't valid JSON"); }
  }
  return account?.private_key && account?.client_email && account?.project_id ? account : null;
}

export const fcmOn = (env) => !!serviceAccount(env);

/** A Google access token for sending, made from the service account key and reused for about an hour. */
async function accessToken(sa) {
  if (cached && cached.exp > Date.now() + 60e3) return cached.token;
  const now = Math.floor(Date.now() / 1000);
  const unsigned = `${enc({ alg: "RS256", typ: "JWT" })}.${enc({
    iss: sa.client_email, scope: "https://www.googleapis.com/auth/firebase.messaging",
    aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600,
  })}`;
  const der = Uint8Array.from(atob(sa.private_key.replace(/-----[^-]+-----|\s/g, "")), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(unsigned));
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `grant_type=${encodeURIComponent("urn:ietf:params:oauth:grant-type:jwt-bearer")}&assertion=${unsigned}.${b64u(sig)}`,
  });
  if (!r.ok) throw new Error(`fcm auth ${r.status} ${await r.text().catch(() => "")}`);
  const { access_token, expires_in } = await r.json();
  cached = { token: access_token, exp: Date.now() + (expires_in || 3600) * 1000 };
  return access_token;
}

/** Wakes one app install. Returns "ok", "gone" (the app was uninstalled or the token expired) or "error". */
export async function fcmSend(env, token) {
  const sa = serviceAccount(env);
  if (!sa) return "error";
  try {
    const r = await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(sa.project_id)}/messages:send`, {
      method: "POST",
      headers: { authorization: `Bearer ${await accessToken(sa)}`, "content-type": "application/json" },
      body: JSON.stringify({ message: { token, data: { kind: "new" }, android: { priority: "HIGH", ttl: "86400s" } } }),
    });
    if (r.ok) return "ok";
    const text = await r.text().catch(() => "");
    if (r.status === 404 || /UNREGISTERED|registration-token-not-registered/.test(text)) return "gone";
    if (r.status === 401) cached = null;
    console.log("fcm failed", r.status, text.slice(0, 300));
    return "error";
  } catch (e) {
    console.log("fcm error", e?.message);
    return "error";
  }
}
