/**
 * Worker entry: serves the site from public/ and routes /api/* to the handlers.
 * Only /api/* requests run code (see run_worker_first in wrangler.jsonc); every
 * other request is served straight from static assets at no compute cost.
 */
import * as connect from "./api/connect.js";
import * as board from "./api/board.js";

const ROUTES = { "/api/connect": connect, "/api/board": board };

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);
    const mod = ROUTES[pathname];
    if (!mod) return env.ASSETS.fetch(request);

    const handler = mod[`onRequest${request.method[0]}${request.method.slice(1).toLowerCase()}`] || mod.onRequest;
    return handler({ request, env, waitUntil: (p) => ctx.waitUntil(p) });
  },
};
