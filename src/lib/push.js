/**
 * Phone notifications.
 *
 * notify() records what happened (a request, a message, a reply…) in the notifications table and
 * then wakes the member's devices:
 *  - Browsers and home-screen apps (Android, iPhone 16.4+, desktop) get a Web Push "tickle" with
 *    no payload. The service worker then reads the newest notification from /api/notifications.
 *    That keeps the content off third-party push servers and needs no message encryption.
 *  - The Android app gets a Firebase Cloud Messaging wake-up, also with no content (src/lib/fcm.js),
 *    and reads /api/notifications itself. Without Firebase it still checks every ~15 minutes.
 *
 * The VAPID key pair that signs pushes is created on first use and kept in the meta table,
 * so there is nothing to configure.
 */
import { fcmSend } from "./fcm.js";

const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const enc = (obj) => b64u(new TextEncoder().encode(JSON.stringify(obj)));

let keyCache = null;
/** { publicKey: base64url raw P-256 point, privateKey: CryptoKey } */
export async function vapidKeys(d) {
  if (keyCache) return keyCache;
  let row = await d.prepare("SELECT v FROM meta WHERE k = 'vapid'").first();
  if (!row) {
    const pair = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"]);
    const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
    const pub = b64u(await crypto.subtle.exportKey("raw", pair.publicKey));
    await d.prepare("INSERT OR IGNORE INTO meta (k, v) VALUES ('vapid', ?)").bind(JSON.stringify({ jwk, pub })).run();
    row = await d.prepare("SELECT v FROM meta WHERE k = 'vapid'").first(); // another request may have won the race
  }
  const { jwk, pub } = JSON.parse(row.v);
  const privateKey = await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  keyCache = { publicKey: pub, privateKey };
  return keyCache;
}

async function vapidHeader(keys, endpoint, contact) {
  const aud = new URL(endpoint).origin;
  const unsigned = `${enc({ typ: "JWT", alg: "ES256" })}.${enc({ aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: contact })}`;
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, keys.privateKey, new TextEncoder().encode(unsigned));
  return `vapid t=${unsigned}.${b64u(sig)}, k=${keys.publicKey}`;
}

/** Wakes every browser and Android app the member signed up. Expired subscriptions are removed. */
export async function pushTo(env, d, userId) {
  const { results } = await d.prepare("SELECT endpoint FROM push_subs WHERE user_id = ?").bind(userId).all();
  if (!results.length) return;
  const gone = (endpoint) => d.prepare("DELETE FROM push_subs WHERE endpoint = ?").bind(endpoint).run();
  const apps = results.filter((r) => r.endpoint.startsWith("fcm:"));
  const browsers = results.filter((r) => !r.endpoint.startsWith("fcm:"));
  await Promise.all(apps.map(async ({ endpoint }) => { if ((await fcmSend(env, endpoint.slice(4))) === "gone") await gone(endpoint); }));
  if (!browsers.length) return;
  const keys = await vapidKeys(d);
  const contact = `mailto:${env.CONTACT_EMAIL || "noreply@yaelfoundation.org"}`;
  await Promise.all(browsers.map(async ({ endpoint }) => {
    try {
      const r = await fetch(endpoint, {
        method: "POST",
        headers: { authorization: await vapidHeader(keys, endpoint, contact), ttl: "86400", urgency: "high", "content-length": "0" },
      });
      if (r.status === 404 || r.status === 410) await gone(endpoint);
    } catch { /* the push service is unreachable; the next notification will try again */ }
  }));
}

/**
 * Records a notification and wakes the member's devices.
 * n = { kind, title, body, url }  (url is a site hash, e.g. "#/messages/abc")
 */
export async function notify(env, d, userId, n, waitUntil) {
  if (!userId) return;
  await d.prepare("INSERT INTO notifications (user_id, kind, title, body, url, created_at) VALUES (?, ?, ?, ?, ?, ?)")
    .bind(userId, n.kind, String(n.title).slice(0, 140), String(n.body || "").slice(0, 240), n.url || "#/", Date.now()).run();
  const p = pushTo(env, d, userId).catch(() => {});
  if (waitUntil) waitUntil(p); else await p;
}
