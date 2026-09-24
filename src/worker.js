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

const ROUTES = [
  ["POST", "/api/auth/signup", auth.signup],
  ["POST", "/api/auth/login", auth.login],
  ["POST", "/api/auth/logout", auth.logout],
  ["GET", "/api/me", profile.me],
  ["PUT", "/api/me", profile.updateMe],
  ["PUT", "/api/me/avatar", profile.putAvatar],
  ["DELETE", "/api/me/avatar", profile.deleteAvatar],
  ["GET", "/api/avatar/:id", profile.avatar],
  ["GET", "/api/people", profile.people],
  ["GET", "/api/people/:id", profile.person],
  ["GET", "/api/suggestions", conn.suggestions],
  ["POST", "/api/intro/:id", conn.intro],
  ["GET", "/api/connections", conn.list],
  ["POST", "/api/connections", conn.request],
  ["POST", "/api/connections/:id/accept", conn.accept],
  ["DELETE", "/api/connections/:id", conn.remove],
  ["GET", "/api/map", conn.map],
  ["GET", "/api/messages", msg.conversations],
  ["GET", "/api/messages/:id", msg.thread],
  ["POST", "/api/messages/:id", msg.send],
  ["GET", "/api/board", board.listPosts],
  ["POST", "/api/board", board.createPost],
  ["DELETE", "/api/board/:id", board.deletePost],
].map(([method, path, fn]) => [method, new RegExp(`^${path.replace(/:(\w+)/g, "(?<$1>[A-Za-z0-9_-]+)")}$`), fn]);

const MESSAGES = {
  db_not_configured: "The database isn't connected yet.",
  ai_not_configured: "AI isn't connected yet (missing GEMINI_API_KEY).",
  signin_required: "Please sign in.",
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
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
