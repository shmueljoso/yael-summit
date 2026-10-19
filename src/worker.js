/**
 * Worker entry: serves the site from public/ and routes /api/* to the handlers.
 * Only /api/* runs code (run_worker_first in wrangler.jsonc); everything else is static.
 */
import { error, sameOrigin } from "./lib/http.js";
import * as auth from "./api/auth.js";
import * as profile from "./api/profile.js";
import * as conn from "./api/connections.js";
import * as msg from "./api/messages.js";
import * as board from "./api/board.js";
import * as admin from "./api/admin.js";
import * as notes from "./api/notifications.js";

const ROUTES = [
  ["POST", "/api/auth/signup", auth.signup],
  ["POST", "/api/auth/login", auth.login],
  ["POST", "/api/auth/logout", auth.logout],
  ["POST", "/api/auth/forgot", auth.forgot],
  ["POST", "/api/auth/reset", auth.reset],
  ["GET", "/api/me", profile.me],
  ["PUT", "/api/me", profile.updateMe],
  ["DELETE", "/api/me", profile.deleteMe],
  ["PUT", "/api/me/avatar", profile.putAvatar],
  ["DELETE", "/api/me/avatar", profile.deleteAvatar],
  ["GET", "/api/avatar/:id", profile.avatar],
  ["GET", "/api/schools", profile.schools],
  ["GET", "/api/people", profile.people],
  ["GET", "/api/people/:id", profile.person],
  ["GET", "/api/suggestions", conn.suggestions],
  ["POST", "/api/intro/:id", conn.intro],
  ["GET", "/api/connections", conn.list],
  ["POST", "/api/connections", conn.request],
  ["POST", "/api/connections/:id/accept", conn.accept],
  ["DELETE", "/api/connections/:id", conn.remove],
  ["GET", "/api/map", conn.map],
  ["GET", "/api/stats", conn.stats],
  ["GET", "/api/messages", msg.conversations],
  ["GET", "/api/messages/:id", msg.thread],
  ["POST", "/api/messages/:id", msg.send],
  ["GET", "/api/board", board.listPosts],
  ["POST", "/api/board", board.createPost],
  ["DELETE", "/api/board/:id", board.deletePost],
  ["POST", "/api/board/:id/report", board.reportPost],
  ["GET", "/api/board/:id/comments", board.listComments],
  ["POST", "/api/board/:id/comments", board.addComment],
  ["DELETE", "/api/board/comments/:id", board.deleteComment],
  ["GET", "/api/notifications", notes.list],
  ["GET", "/api/push/key", notes.key],
  ["POST", "/api/push", notes.subscribe],
  ["DELETE", "/api/push", notes.unsubscribe],
  ["GET", "/api/admin/impact", admin.impact],
  ["GET", "/api/admin", admin.overview],
  ["PUT", "/api/admin/members/:id", admin.setSchool],
  ["DELETE", "/api/admin/members/:id", admin.removeMember],
  ["DELETE", "/api/admin/posts/:id", admin.removePost],
  ["DELETE", "/api/admin/reports/:id", admin.dismissReport],
].map(([method, path, fn]) => [method, new RegExp(`^${path.replace(/:(\w+)/g, "(?<$1>[A-Za-z0-9_-]+)")}$`), fn]);

const MESSAGES = {
  db_not_configured: "The database isn't connected yet.",
  ai_not_configured: "AI isn't connected yet (missing GEMINI_API_KEY).",
  signin_required: "Please sign in.",
  admin_only: "This page is for the Yael Foundation team.",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    // Lets Android open links to this site straight in the Yael Summit app (verified App Links).
    if (url.pathname === "/.well-known/assetlinks.json") return assetLinks();
    if (!url.pathname.startsWith("/api/")) return env.ASSETS.fetch(request);
    if (request.method !== "GET" && !sameOrigin(request)) return error(403, "forbidden", "Cross-site request blocked.");

    const pathMatches = ROUTES.filter(([, re]) => re.test(url.pathname));
    if (!pathMatches.length) return error(404, "not_found", "Unknown API route.");
    const route = pathMatches.find(([m]) => m === request.method);
    if (!route) return error(405, "method_not_allowed", "Method not allowed.");

    try {
      const params = route[1].exec(url.pathname).groups || {};
      return await route[2]({ request, env, params, waitUntil: (p) => ctx.waitUntil(p) });
    } catch (e) {
      const status = e.status || 500;
      if (status === 500) console.error(e);
      return error(status, e.message || "server_error", MESSAGES[e.message] || (status === 500 ? "Something went wrong on our side." : e.message));
    }
  },
};

// The Android app's package and signing-certificate fingerprint (android/app/yael-summit.keystore).
const ANDROID_APP = { package: "org.yaelfoundation.summit", sha256: "CE:42:87:31:61:2B:24:4A:67:3B:C8:B1:C6:BD:A6:2E:E5:5F:6A:87:AD:F7:F8:D4:02:FA:57:AD:00:29:A2:AE" };
function assetLinks() {
  return new Response(JSON.stringify([{
    relation: ["delegate_permission/common.handle_all_urls"],
    target: { namespace: "android_app", package_name: ANDROID_APP.package, sha256_cert_fingerprints: [ANDROID_APP.sha256] },
  }]), { headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" } });
}
