/* Yael Summit · Constellation — single-page app. No framework, no build step. */

// =============================================================
// helpers
// =============================================================
const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const view = $("#view");

const I = {
  home: '<path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z"/>',
  people: '<circle cx="9" cy="8" r="3.2"/><path d="M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6"/><circle cx="17" cy="9" r="2.5"/><path d="M15.5 14.2c3 .3 5.5 2.6 5.5 5.8"/>',
  chat: '<path d="M4 5h16v11H9l-5 4z"/>',
  board: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M8 9h8M8 13h8M8 17h5"/>',
  star: '<path d="M12 3 21 18H3z"/><path d="M12 21 3 6h18z"/>',
  mail: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/>',
  phone: '<path d="M6 3h3l2 5-2.5 1.5a11 11 0 0 0 5 5L15 12l5 2v3a2 2 0 0 1-2 2A15 15 0 0 1 4 5a2 2 0 0 1 2-2z"/>',
  link: '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>',
  lock: '<rect x="5" y="10" width="14" height="10" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/>',
  pin: '<path d="M12 21s-6-5.3-6-11a6 6 0 0 1 12 0c0 5.7-6 11-6 11z"/><circle cx="12" cy="10" r="2"/>',
  send: '<path d="M4 12 20 4l-6 16-3-7z"/>',
  spark: '<path d="M12 2l1.8 6.2L20 10l-6.2 1.8L12 18l-1.8-6.2L4 10l6.2-1.8z"/>',
  back: '<path d="M15 5 8 12l7 7"/>',
};
const icon = (name, fill = false) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true" fill="${fill ? "currentColor" : "none"}" stroke="${fill ? "none" : "currentColor"}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${I[name]}</svg>`;

const initials = (name) => String(name || "?").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase();
const AV_GRADS = [["#2E66F5", "#7A5CF0"], ["#1F8FB8", "#2E66F5"], ["#B8894A", "#E0B866"], ["#7A5CF0", "#C2629B"], ["#1E9E86", "#2E7BD6"], ["#C25B5B", "#E09A5B"], ["#4A5BD6", "#1FA3F2"], ["#8A6BE0", "#3E4FCF"]];
const avStyle = (p) => { let h = 0; for (const c of String(p?.id || p?.full_name || p?.name || "")) h = (h * 31 + c.charCodeAt(0)) >>> 0; const [a, b] = AV_GRADS[h % AV_GRADS.length]; return `background:linear-gradient(135deg,${a},${b})`; };
const sampleTag = (p) => (p?.sample ? `<span class="sample-tag" title="Sample profile for demonstration">Sample</span>` : "");
const avatar = (p, size = "") =>
  `<span class="av ${size}" style="${avStyle(p)}">${p?.avatar ? `<img src="${esc(p.avatar)}" alt="" loading="lazy">` : esc(initials(p?.full_name || p?.name))}</span>`;
const first = (name) => String(name || "").split(" ")[0];
const place = (p) => [p.city, p.country].filter(Boolean).join(", ");
const where = (p) => [p.school, place(p)].filter(Boolean).join(" · ");

function ago(ts) {
  const m = Math.round((Date.now() - ts) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24);
  return d < 7 ? `${d}d ago` : new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" });
}
const clock = (ts) => new Date(ts).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });

let toastTimer;
function toast(msg) {
  const t = $("#toast");
  t.textContent = msg; t.hidden = false;
  clearTimeout(toastTimer); toastTimer = setTimeout(() => (t.hidden = true), 3200);
}

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { "content-type": "application/json" } : {},
    body: body ? JSON.stringify(body) : undefined,
    credentials: "same-origin",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || "Something went wrong. Try again.");
    err.status = res.status; err.code = data.error;
    if (res.status === 401 && state.me) { state.me = null; renderChrome(); go("#/signin"); }
    throw err;
  }
  return data;
}

const state = { me: null, counts: { requests: 0, unread: 0 }, topics: {}, levels: {} };
const topicLabel = (t) => state.topics[t] || t;

// =============================================================
// routing
// =============================================================
let routeToken = 0;
const cleanups = [];
const onLeave = (fn) => cleanups.push(fn);
const go = (hash) => { if (location.hash === hash) route(); else location.hash = hash; };

const ROUTES = [
  [/^$/, () => (state.me ? home() : landing("join"))],
  [/^join$/, () => (state.me ? go("#/") : landing("join"))],
  [/^signin$/, () => (state.me ? go("#/") : landing("signin"))],
  [/^summit$/, () => summit()],
  [/^people$/, () => auth(() => people("list"))],
  [/^map$/, () => auth(() => people("map"))],
  [/^world$/, () => auth(() => people("world"))],
  [/^u\/([\w-]+)$/, (id) => auth(() => profile(id))],
  [/^me\/edit$/, () => auth(() => editProfile())],
  [/^messages$/, () => auth(() => messages(null))],
  [/^messages\/([\w-]+)$/, (id) => auth(() => messages(id))],
  [/^board$/, () => auth(() => board())],
];

function auth(fn) { if (!state.me) { go("#/signin"); return; } fn(); }

function route() {
  while (cleanups.length) { try { cleanups.pop()(); } catch { /* ignore */ } }
  routeToken++;
  const path = location.hash.replace(/^#\/?/, "");
  for (const [re, fn] of ROUTES) {
    const m = path.match(re);
    if (m) { fn(...m.slice(1)); renderChrome(); view.focus({ preventScroll: true }); window.scrollTo(0, 0); return; }
  }
  go("#/");
}
addEventListener("hashchange", route);

const loadingHTML = '<div class="loading"><div class="spinner" aria-label="Loading"></div></div>';
/** Renders a loading state, runs the loader, and ignores its result if the user already navigated away. */
async function load(fn) {
  const token = routeToken;
  view.innerHTML = loadingHTML;
  try {
    const html = await fn();
    if (token === routeToken && typeof html === "string") view.innerHTML = html;
    return token === routeToken;
  } catch (e) {
    if (token === routeToken) view.innerHTML = `<div class="wrap section"><div class="empty"><b>That didn't load.</b><span>${esc(e.message)}</span><button class="btn btn-soft btn-sm" onclick="location.reload()">Reload</button></div></div>`;
    return false;
  }
}

// =============================================================
// chrome: top nav, tab bar, account menu
// =============================================================
const NAV = [
  ["#/", "Constellation", "home"],
  ["#/people", "People", "people"],
  ["#/messages", "Messages", "chat"],
  ["#/board", "Board", "board"],
  ["#/summit", "The Summit", "star"],
];

function current(href) {
  const h = location.hash || "#/";
  if (href === "#/") return h === "#/" || h === "#";
  if (href === "#/people") return h.startsWith("#/people") || h.startsWith("#/map") || h.startsWith("#/world") || (h.startsWith("#/u/") && h !== `#/u/${state.me?.id}`);
  return h.startsWith(href);
}

function renderChrome() {
  const signed = !!state.me;
  document.body.classList.toggle("signed-in", signed);
  const badge = (key) => {
    const n = key === "home" ? state.counts.requests : key === "chat" ? state.counts.unread : 0;
    return n ? `<span class="badge">${n > 9 ? "9+" : n}</span>` : "";
  };
  $("#nav").innerHTML = signed
    ? NAV.map(([href, label, ic]) => `<a href="${href}" ${current(href) ? 'aria-current="page"' : ""}>${label}${badge(ic)}</a>`).join("")
    : `<a href="#/summit" ${current("#/summit") ? 'aria-current="page"' : ""}>The Summit</a>`;
  $("#navEnd").innerHTML = signed
    ? `<button class="me-btn" id="meBtn" aria-haspopup="true" aria-expanded="false">${avatar(state.me, "xs")}<span class="me-name">${esc(first(state.me.full_name))}</span></button>
       <div class="menu" id="meMenu" hidden>
         <a href="#/u/${state.me.id}">My profile</a><a href="#/me/edit">Edit profile</a><a href="#/summit">The Summit</a><button id="signOut">Sign out</button>
       </div>`
    : `<a class="btn btn-quiet btn-sm" href="#/signin">Sign in</a><a class="btn btn-gold btn-sm" href="#/join">Join</a>`;
  const tab = $("#tabbar");
  tab.hidden = !signed;
  if (signed) {
    tab.innerHTML = NAV.slice(0, 4).map(([href, label, ic]) => `<a href="${href}" ${current(href) ? 'aria-current="page"' : ""}>${icon(ic)}${label}${badge(ic)}</a>`).join("") +
      `<a href="#/u/${state.me.id}" ${location.hash === `#/u/${state.me.id}` ? 'aria-current="page"' : ""}>${avatar(state.me, "xs")}Me</a>`;
    const btn = $("#meBtn"), menu = $("#meMenu");
    btn.onclick = (e) => { e.stopPropagation(); menu.hidden = !menu.hidden; btn.setAttribute("aria-expanded", String(!menu.hidden)); };
    menu.onclick = () => (menu.hidden = true);
    $("#signOut").onclick = async () => { await api("POST", "/api/auth/logout").catch(() => {}); state.me = null; renderChrome(); go("#/signin"); toast("Signed out."); };
  }
}
document.addEventListener("click", () => { const m = $("#meMenu"); if (m) m.hidden = true; });

async function refreshMe() {
  const data = await api("GET", "/api/me");
  state.me = data.me;
  if (data.counts) state.counts = data.counts;
  if (data.taxonomy) { state.topics = data.taxonomy.topics; state.levels = data.taxonomy.levels; }
  renderChrome();
}
setInterval(() => { if (state.me && !document.hidden) refreshMe().catch(() => {}); }, 45000);

// =============================================================
// canvases: night sky, profile cover, constellation map
// =============================================================
function seeded(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
function hashSeed(str) { let h = 2166136261; for (const c of String(str)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return h >>> 0; }
function fit(cv) {
  const d = Math.min(devicePixelRatio || 1, 2), r = cv.getBoundingClientRect();
  cv.width = Math.max(1, r.width * d); cv.height = Math.max(1, r.height * d);
  const c = cv.getContext("2d"); c.setTransform(d, 0, 0, d, 0, 0);
  return { c, w: r.width, h: r.height };
}
function animate(draw) {
  let raf = 0, on = true;
  const loop = (t) => { if (!on) return; draw(t); if (!reduceMotion) raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);
  onLeave(() => { on = false; cancelAnimationFrame(raf); });
}

/** Background sky for the landing page: twinkling stars that form constellations. */
function sky(cv) {
  let g, stars, groups;
  const build = () => {
    g = fit(cv); const r = seeded(7), n = Math.min(240, Math.round((g.w * g.h) / 6000));
    stars = Array.from({ length: n }, () => ({ x: r() * g.w, y: r() * g.h, s: r() < .1 ? 1.4 + r() * 1.2 : .4 + r() * .8, t: r() * 7 }));
    groups = [];
    for (let k = 0; k < 8; k++) {
      const chain = [Math.floor(r() * n)];
      for (let j = 0; j < 4; j++) {
        const a = stars[chain[chain.length - 1]]; let best = -1, bd = 1e9;
        stars.forEach((b, i) => { const d = Math.hypot(a.x - b.x, a.y - b.y); if (!chain.includes(i) && d > 40 && d < 170 && d < bd) { bd = d; best = i; } });
        if (best < 0) break; chain.push(best);
      }
      groups.push({ chain, ph: r() * 10, per: 10 + r() * 6 });
    }
  };
  build(); const onR = () => build(); addEventListener("resize", onR); onLeave(() => removeEventListener("resize", onR));
  animate((t) => {
    const { c, w, h } = g, k = (reduceMotion ? 6000 : t) / 1000; c.clearRect(0, 0, w, h);
    for (const gr of groups) {
      const p = ((k + gr.ph) % gr.per) / gr.per, grow = Math.min(1, p * 3), a = p < .75 ? 1 : 1 - (p - .75) / .25;
      c.strokeStyle = `rgba(216,176,96,${.35 * a})`; c.lineWidth = .8; c.beginPath();
      const segs = (gr.chain.length - 1) * grow;
      for (let i = 0; i < gr.chain.length - 1; i++) {
        const f = Math.max(0, Math.min(1, segs - i)); if (!f) break;
        const A = stars[gr.chain[i]], B = stars[gr.chain[i + 1]]; c.moveTo(A.x, A.y); c.lineTo(A.x + (B.x - A.x) * f, A.y + (B.y - A.y) * f);
      }
      c.stroke();
    }
    for (const s of stars) {
      const tw = reduceMotion ? .8 : .5 + .5 * Math.sin(k * 1.3 + s.t);
      c.fillStyle = `rgba(242,240,234,${tw})`; c.beginPath(); c.arc(s.x, s.y, s.s, 0, 7); c.fill();
    }
  });
}

/** Profile cover: a small constellation unique to each person. */
function cover(cv, seed, links = 0) {
  const { c, w, h } = fit(cv), r = seeded(hashSeed(seed));
  for (let i = 0; i < 90; i++) { c.fillStyle = `rgba(242,240,234,${.2 + r() * .6})`; c.beginPath(); c.arc(r() * w, r() * h, r() * 1.2 + .2, 0, 7); c.fill(); }
  const cx = w * (.62 + r() * .2), cy = h * (.35 + r() * .2), n = Math.min(14, 5 + links);
  const pts = Array.from({ length: n }, (_, i) => { const a = (i / n) * Math.PI * 2 + r(), d = 40 + r() * Math.min(w, h) * .45; return [cx + Math.cos(a) * d * 1.3, cy + Math.sin(a) * d * .7]; });
  c.strokeStyle = "rgba(216,176,96,.45)"; c.lineWidth = 1;
  pts.forEach(([x, y]) => { c.beginPath(); c.moveTo(cx, cy); c.lineTo(x, y); c.stroke(); });
  pts.forEach(([x, y]) => { c.fillStyle = "rgba(141,184,255,.95)"; c.beginPath(); c.arc(x, y, 2.4, 0, 7); c.fill(); });
  c.fillStyle = "#F1D591"; c.shadowColor = "#F1D591"; c.shadowBlur = 16; c.beginPath(); c.arc(cx, cy, 5, 0, 7); c.fill(); c.shadowBlur = 0;
}

// =============================================================
// connection controls (shared by cards, profiles and the board)
// =============================================================
function connectButtons(p, opts = {}) {
  const id = esc(p.id), s = p.connection, sm = opts.sm ? "btn-sm" : "";
  if (s === "self") return `<a class="btn btn-soft" href="#/me/edit">Edit profile</a>`;
  if (s === "connected") return `<a class="btn btn-primary ${sm}" href="#/messages/${id}">${icon("chat")}Message</a>`;
  if (s === "sent") return `<button class="btn btn-soft ${sm}" data-act="cancel" data-id="${id}">Request sent · Cancel</button>`;
  if (s === "received") return `<button class="btn btn-gold ${sm}" data-act="accept" data-id="${id}">Accept</button><button class="btn btn-quiet ${sm}" data-act="decline" data-id="${id}">Decline</button>`;
  return `<button class="btn btn-primary ${sm}" data-act="connect" data-id="${id}" data-name="${esc(p.full_name)}">Connect</button>`;
}

/** A small dialog to add a note to a connection request. Resolves to the note, or null if cancelled. */
function askNote(name, preset = "") {
  return new Promise((resolve) => {
    const d = document.createElement("dialog");
    d.className = "panel-lg note-dialog";
    d.innerHTML = `<form method="dialog" class="stack">
      <h2 class="display" style="font-size:1.8rem">Connect with ${esc(first(name))}</h2>
      <label class="field"><span>Add a note <span class="tiny">(optional)</span></span>
        <textarea class="textarea" id="connNote" maxlength="300" placeholder="Hi ${esc(first(name))}, I'd love to hear how you…">${esc(preset)}</textarea></label>
      <div style="display:flex;gap:8px;justify-content:flex-end"><button class="btn btn-quiet" value="cancel">Cancel</button><button class="btn btn-primary" value="send">Send request</button></div>
    </form>`;
    d.addEventListener("close", () => { resolve(d.returnValue === "send" ? $("#connNote", d).value : null); d.remove(); });
    d.addEventListener("click", (e) => { if (e.target === d) d.close("cancel"); });
    document.body.appendChild(d); d.showModal();
  });
}

/** Handles Connect / Accept / Decline / Cancel buttons anywhere inside `root`. */
function wireConnect(root, after) {
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b || !["connect", "accept", "decline", "cancel"].includes(b.dataset.act)) return;
    const id = b.dataset.id, act = b.dataset.act;
    try {
      if (act === "connect") {
        const note = await askNote(b.dataset.name, b.dataset.note || "");
        if (note === null) return;
        b.disabled = true;
        const r = await api("POST", "/api/connections", { to: id, note });
        toast(r.connection === "connected" ? "You're connected." : "Request sent.");
      } else if (act === "accept") {
        b.disabled = true; await api("POST", `/api/connections/${id}/accept`); toast("You're connected. Say hello!");
      } else {
        b.disabled = true; await api("DELETE", `/api/connections/${id}`); toast(act === "decline" ? "Request declined." : "Request cancelled.");
      }
      refreshMe().catch(() => {});
      after?.(id, act);
    } catch (err) { toast(err.message); b.disabled = false; }
  });
}

// =============================================================
// landing + sign in / join
// =============================================================
function landing(mode) {
  const join = mode === "join";
  view.innerHTML = `
  <div class="landing">
    <canvas class="land-sky" id="sky" aria-hidden="true"></canvas>
    <div class="wrap land-hero">
      <div class="land-copy fade-in">
        <p class="label">Yael Summit · Constellation</p>
        <h1 class="display">Every leader is a star. <em>Together, a constellation.</em></h1>
        <p class="lede">Jewish school leaders from around the world, connected before the summit even begins. Find the principals facing what you face, and start the conversation.</p>
        <ul class="land-points">
          <li>Get matched with leaders who have solved what you're working on.</li>
          <li>Connect, see each other's details and talk directly.</li>
          <li>Ask the whole network, in any language.</li>
        </ul>
        <div class="land-stats" id="landStats" hidden></div>
        <div class="land-foot"><a href="#/summit" class="btn btn-quiet">About the summit →</a></div>
      </div>
      <div class="auth panel-lg fade-in">
        <p class="label">${join ? "Join the constellation" : "Welcome back"}</p>
        <h2>${join ? "Create your profile" : "Sign in"}</h2>
        <form id="authForm" novalidate>
          ${join ? `<label class="field"><span>Full name</span><input class="input" id="a-name" name="full_name" autocomplete="name" required placeholder="First and last name"><span class="hint">Shown to other principals exactly as you write it.</span></label>` : ""}
          <label class="field"><span>Email</span><input class="input" id="a-email" name="email" type="email" autocomplete="email" required></label>
          <label class="field"><span>Password</span><input class="input" id="a-pass" name="password" type="password" autocomplete="${join ? "new-password" : "current-password"}" required minlength="8">${join ? '<span class="hint">At least 8 characters.</span>' : ""}</label>
          ${join ? `<label class="field"><span>Access code <span class="tiny">(from your invitation)</span></span><input class="input" id="a-code" name="code" autocomplete="off"></label>` : ""}
          <p class="form-error" id="authErr" role="alert"></p>
          <button class="btn btn-gold btn-block" type="submit">${join ? "Light up my star" : "Sign in"}</button>
          <p class="switch">${join ? 'Already joined? <button type="button" data-to="signin">Sign in</button>' : 'New here? <button type="button" data-to="join">Create your profile</button>'}</p>
        </form>
      </div>
    </div>
  </div>`;
  sky($("#sky"));
  api("GET", "/api/stats").then((st) => {
    const box = $("#landStats"); if (!box || !st.principals) return;
    box.innerHTML = `<div><b>${st.principals}</b><span>principals</span></div><div><b>${st.countries}</b><span>countries</span></div><div><b>${st.connections}</b><span>connections</span></div>`;
    box.hidden = false;
  }).catch(() => {});
  $$("[data-to]").forEach((b) => (b.onclick = () => go(`#/${b.dataset.to}`)));
  $("#authForm").onsubmit = async (e) => {
    e.preventDefault();
    const f = Object.fromEntries(new FormData(e.target));
    const btn = e.target.querySelector("[type=submit]"), err = $("#authErr");
    btn.disabled = true; err.textContent = "";
    try {
      await api("POST", join ? "/api/auth/signup" : "/api/auth/login", f);
      await refreshMe();
      go(join ? "#/me/edit" : "#/");
      if (join) toast("Welcome! Tell other principals a little about you.");
    } catch (ex) { err.textContent = ex.message; btn.disabled = false; }
  };
}

// =============================================================
// home: your constellation (requests, suggestions, connections)
// =============================================================
async function home() {
  const me = state.me;
  const ok = await load(async () => {
    const [sug, cons] = await Promise.all([api("GET", "/api/suggestions"), api("GET", "/api/connections")]);
    const reqs = cons.received;
    return `
    <div class="wrap">
      <div class="home-head fade-in">
        ${avatar(me, "lg")}
        <div class="grow"><p class="label">Your constellation</p><h1 class="display">Shalom, ${esc(first(me.full_name))}</h1></div>
        <div class="stat-row">
          <div class="stat"><b>${cons.connected.length}</b><span>connections</span></div>
          <div class="stat"><b>${reqs.length}</b><span>requests</span></div>
        </div>
      </div>

      ${!sug.profile_complete ? `<div class="nudge fade-in"><span><b>Complete your profile</b> so we can suggest the right principals: what you're working on, where you're strong, what you want to learn.</span><a class="btn btn-gold btn-sm" href="#/me/edit">Complete profile</a></div>` : ""}

      ${reqs.length ? `<section class="section"><div class="section-head"><h2>Requests</h2></div><div class="stack" id="reqs">
        ${reqs.map((p) => `<div class="req">${avatar(p, "sm")}<div class="who"><a href="#/u/${esc(p.id)}">${esc(p.full_name)}</a><span class="tiny">${esc(where(p))}</span>${p.note ? `<span class="note">“${esc(p.note)}”</span>` : ""}</div><div class="acts">${connectButtons({ ...p, connection: "received" }, { sm: true })}</div></div>`).join("")}
      </div></section>` : ""}

      <section class="section">
        <div class="section-head"><h2>Principals to meet</h2><a href="#/people" class="btn btn-quiet btn-sm">Browse everyone →</a></div>
        ${sug.suggestions.length ? `<div class="cards" id="sugg">${sug.suggestions.map(suggCard).join("")}</div>`
          : `<div class="empty"><b>You're one of the first stars here.</b><span>As more principals join, we'll suggest the ones worth meeting.</span></div>`}
      </section>

      <section class="section">
        <div class="section-head"><h2>Your connections</h2>${cons.sent.length ? `<span class="tiny">${cons.sent.length} request${cons.sent.length > 1 ? "s" : ""} waiting for an answer</span>` : ""}</div>
        ${cons.connected.length ? `<div class="people-row">${cons.connected.map((p) => `<a class="mini" href="#/u/${esc(p.id)}">${avatar(p, "lg")}<span>${esc(p.full_name)}</span><small>${esc(p.country || p.school || "")}</small></a>`).join("")}</div>`
          : `<div class="empty"><span>No connections yet. Start with one of the principals above.</span></div>`}
      </section>
    </div>`;
  });
  if (!ok) return;
  const root = view.firstElementChild;
  wireConnect(root, () => home());
  root.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act=why]");
    if (!b) return;
    b.disabled = true; b.textContent = "Writing…";
    try {
      const r = await api("POST", `/api/intro/${b.dataset.id}`);
      const card = b.closest(".sugg");
      const why = $(".why", card); why.textContent = r.why; why.classList.add("ai");
      const op = $(".opener", card); op.textContent = `Ask: “${r.opener}”`; op.hidden = false;
      b.remove();
    } catch (err) { toast(err.message); b.disabled = false; b.innerHTML = `${icon("spark", true)}Why meet?`; }
  });
}

function suggCard(p) {
  return `<article class="sugg">
    <div class="top">${avatar(p, "lg")}<div class="who"><a href="#/u/${esc(p.id)}">${esc(p.full_name)}</a> ${sampleTag(p)}<span class="where">${esc(where(p) || "Principal")}</span></div>
      <div class="ring" style="--p:${p.match}" title="${p.match}% match"><span>${p.match}%</span></div></div>
    <p class="why">${esc(p.reason)}</p>
    <p class="opener" hidden></p>
    ${p.give.length || p.shared.length ? `<div class="chips">${p.give.map((t) => `<span class="chip gold">Can help: ${esc(topicLabel(t))}</span>`).join("")}${p.shared.map((t) => `<span class="chip plain">${esc(topicLabel(t))}</span>`).join("")}</div>` : ""}
    <div class="acts">${connectButtons({ ...p, connection: null }, { sm: true })}<button class="btn btn-soft btn-sm" data-act="why" data-id="${esc(p.id)}">${icon("spark", true)}Why meet?</button></div>
  </article>`;
}

// =============================================================
// people: directory + constellation map
// =============================================================
function people(mode) {
  let q = "", topic = "";
  view.innerHTML = `
  <div class="wrap section">
    <div class="section-head"><div><p class="label">People</p><h2>The constellation</h2></div>
      <div class="seg" role="radiogroup" aria-label="View">
        <label><input type="radio" name="pv" value="list" id="pv-list" ${mode === "list" ? "checked" : ""}>List</label>
        <label><input type="radio" name="pv" value="map" id="pv-map" ${mode === "map" ? "checked" : ""}>Constellation</label>
        <label><input type="radio" name="pv" value="world" id="pv-world" ${mode === "world" ? "checked" : ""}>World</label>
      </div></div>
    <div class="toolbar">
      ${mode === "list" ? `<input class="input" id="pq" type="search" placeholder="Search by name, school or country" aria-label="Search">` : ""}
      <div class="chips" id="ptopics" role="group" aria-label="Filter by topic">
        <button class="chip gold" data-topic="">All</button>${Object.entries(state.topics).map(([k, v]) => `<button class="chip plain" data-topic="${k}">${esc(v)}</button>`).join("")}
      </div>
    </div>
    <div id="pbody">${loadingHTML}</div>
  </div>`;
  $$("[name=pv]").forEach((r) => (r.onchange = () => go({ map: "#/map", world: "#/world" }[r.value] || "#/people")));
  const pickTopic = (e, then) => {
    const c = e.target.closest("[data-topic]"); if (!c) return;
    topic = c.dataset.topic; $$("#ptopics .chip").forEach((x) => (x.className = `chip ${x === c ? "gold" : "plain"}`)); then(topic);
  };

  if (mode === "map") { constellationMap((setFilter) => ($("#ptopics").onclick = (e) => pickTopic(e, setFilter))); return; }
  if (mode === "world") { worldMap((setFilter) => ($("#ptopics").onclick = (e) => pickTopic(e, setFilter))); return; }

  const token = routeToken, body = $("#pbody");
  async function refresh() {
    try {
      const { people } = await api("GET", `/api/people?${new URLSearchParams({ q, topic })}`);
      if (token !== routeToken) return;
      body.innerHTML = people.length
        ? `<div class="cards">${people.map((p) => `<a class="person" href="#/u/${esc(p.id)}">${avatar(p, "lg")}<span class="who"><b>${esc(p.full_name)} ${sampleTag(p)}</b><span>${esc(p.role_title || "Principal")}</span><span>${esc(where(p))}</span></span>${p.connection ? `<span class="state ${p.connection}">${{ connected: "Connected", sent: "Requested", received: "Wants to connect" }[p.connection]}</span>` : ""}</a>`).join("")}</div>`
        : `<div class="empty"><span>${q || topic ? "No principals match that yet." : "No other principals have joined yet."}</span></div>`;
    } catch (e) { body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; }
  }
  let t; $("#pq").oninput = (e) => { clearTimeout(t); t = setTimeout(() => { q = e.target.value.trim(); refresh(); }, 250); };
  $("#ptopics").onclick = (e) => pickTopic(e, refresh);
  refresh();
}

async function constellationMap(onFilterReady) {
  const token = routeToken, body = $("#pbody");
  let data;
  try { data = await api("GET", "/api/map"); } catch (e) { body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (token !== routeToken) return;
  body.innerHTML = `<div class="map-wrap"><canvas id="mapCv" role="img" aria-label="Map of all principals and their connections"></canvas>
    <div class="map-legend"><span><i style="background:var(--gold)"></i>your connections</span><span><i style="background:var(--sky)"></i>other connections</span><span>${data.nodes.length} principals · ${data.edges.length} connections</span></div>
    <div class="map-tip" id="mapTip" hidden></div></div>`;
  const cv = $("#mapCv"), tip = $("#mapTip");
  const topicKeys = Object.keys(state.topics);
  const COLORS = ["#8DB8FF", "#F1D591", "#7FDDB0", "#E78FB3", "#B39CFF", "#6FD3E8", "#F2A66B", "#9FB0FF", "#E6C07A", "#86E0C8", "#FF9F9F", "#C7D2FF"];
  let filter = "";
  onFilterReady((f) => (filter = f));
  const mine = new Set(data.edges.filter((e) => e.includes(data.me)).flat());

  let g, nodes, byId;
  const layout = () => {
    g = fit(cv);
    const r = seeded(99);
    nodes = data.nodes.map((n) => {
      const ti = Math.max(0, topicKeys.indexOf(n.topics[0] || ""));
      const a = (ti / topicKeys.length) * Math.PI * 2 - Math.PI / 2, center = n.id === data.me;
      return { ...n, x: center ? .5 : .5 + Math.cos(a) * .3 + (r() - .5) * .16, y: center ? .5 : .5 + Math.sin(a) * .32 + (r() - .5) * .16, c: n.topics[0] ? COLORS[ti % COLORS.length] : "#A9B3D6", t: r() * 6 };
    });
    for (let it = 0; it < 120; it++) for (const n of nodes) {
      if (n.id === data.me) continue;
      for (const m of nodes) { if (m === n) continue; const dx = n.x - m.x, dy = n.y - m.y, d = Math.hypot(dx, dy) || .001; if (d < .06) { n.x += (dx / d) * (.06 - d) * .3; n.y += (dy / d) * (.06 - d) * .3; } }
      n.x = Math.min(.95, Math.max(.05, n.x)); n.y = Math.min(.93, Math.max(.07, n.y));
    }
    byId = new Map(nodes.map((n) => [n.id, n]));
  };
  layout();
  addEventListener("resize", layout); onLeave(() => removeEventListener("resize", layout));
  let hover = null;
  const P = (n) => [n.x * g.w, n.y * g.h];
  const rd = seeded(5), dust = Array.from({ length: 140 }, () => ({ x: rd(), y: rd(), s: rd() < .1 ? 1.6 : 1, a: .15 + rd() * .35 }));

  animate((t) => {
    const { c, w, h } = g, k = t / 1000; c.clearRect(0, 0, w, h);
    for (const s of dust) { c.fillStyle = `rgba(242,240,234,${s.a})`; c.fillRect(s.x * w, s.y * h, s.s, s.s); }
    const on = (n) => !filter || n.topics.includes(filter);
    for (const [a, b] of data.edges) {
      const A = byId.get(a), B = byId.get(b); if (!A || !B) continue;
      const isMine = a === data.me || b === data.me;
      c.strokeStyle = isMine ? "rgba(241,213,145,.75)" : on(A) && on(B) ? "rgba(141,184,255,.28)" : "rgba(141,184,255,.06)";
      c.lineWidth = isMine ? 1.5 : .8; c.beginPath(); c.moveTo(...P(A)); c.lineTo(...P(B)); c.stroke();
    }
    for (const n of nodes) {
      const [x, y] = P(n), me = n.id === data.me, tw = reduceMotion ? 1 : .75 + .25 * Math.sin(k * 1.3 + n.t);
      const rad = me ? 8 : n === hover ? 7 : mine.has(n.id) ? 5.5 : 4.5;
      c.globalAlpha = on(n) || me ? tw : .15;
      c.fillStyle = me ? "#F1D591" : n.c; c.shadowColor = c.fillStyle; c.shadowBlur = me || n === hover ? 18 : 8;
      c.beginPath(); c.arc(x, y, rad, 0, 7); c.fill(); c.shadowBlur = 0; c.globalAlpha = 1;
      if (me || n === hover) { c.fillStyle = "#F2F0EA"; c.font = "500 12px DM Sans, sans-serif"; c.textAlign = "center"; c.fillText(me ? "You" : n.name, x, y - rad - 8); }
    }
  });
  const pick = (e) => { const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; let best = null, bd = 20; for (const n of nodes) { const d = Math.hypot(n.x * g.w - x, n.y * g.h - y); if (d < bd) { bd = d; best = n; } } return best; };
  const show = (n) => {
    hover = n; tip.hidden = !n;
    if (n) tip.innerHTML = `${avatar({ id: n.id, avatar: n.avatar, full_name: n.name }, "sm")}<div><b>${esc(n.name)}</b> ${sampleTag(n)}<div class="tiny">${esc([n.school, n.country].filter(Boolean).join(" · "))}</div></div><a class="btn btn-soft btn-sm" href="#/u/${esc(n.id)}">View</a>`;
  };
  cv.onpointermove = (e) => { if (e.pointerType !== "mouse") return; const n = pick(e); if (n !== hover) show(n); };
  cv.onclick = (e) => { const n = pick(e); if (n && n === hover && e.pointerType === "mouse") go(`#/u/${n.id}`); else show(n); };
}

// World view: every school at its place on a night-time Earth, connections as arcs.
let landCache = null;
async function worldMap(onFilterReady) {
  const token = routeToken, body = $("#pbody");
  let data;
  try {
    [data, landCache] = await Promise.all([api("GET", "/api/map"), landCache || fetch("assets/land.json").then((r) => r.json())]);
  } catch (e) { body.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
  if (token !== routeToken) return;
  const placed = data.nodes.filter((n) => n.lat != null && n.lng != null);
  const countries = new Set(placed.map((n) => (n.country || "").toLowerCase())).size;
  body.innerHTML = `<div class="map-wrap world"><canvas id="worldCv" role="img" aria-label="World map of principals' schools and their connections"></canvas>
    <div class="map-legend"><span><i style="background:var(--gold)"></i>your connections</span><span><i style="background:var(--sky)"></i>other connections</span><span>${placed.length} schools · ${countries} countries</span></div>
    <div class="map-tip" id="mapTip" hidden></div></div>
    ${placed.length < data.nodes.length ? `<p class="tiny" style="margin-top:10px">${data.nodes.length - placed.length} principal(s) aren't on the map yet: add a city and country to the profile.</p>` : ""}`;
  const cv = $("#worldCv"), tip = $("#mapTip");
  let filter = ""; onFilterReady((f) => (filter = f));
  const mine = new Set(data.edges.filter((e) => e.includes(data.me)).flat());

  // Projection: equirectangular, trimmed to where people live (lat 78°N to 56°S).
  const N = 78, S = -56;
  let g, dots, nodes, byId;
  const proj = (lat, lng) => [((lng + 180) / 360) * g.w, ((N - lat) / (N - S)) * g.h];
  const build = () => {
    cv.style.height = `${Math.round(cv.getBoundingClientRect().width * .52)}px`;
    g = fit(cv);
    // Land as a field of small dots, like city lights seen from space.
    const off = document.createElement("canvas"); off.width = Math.ceil(g.w); off.height = Math.ceil(g.h);
    const o = off.getContext("2d"); o.fillStyle = "#fff";
    for (const ring of landCache) {
      o.beginPath();
      for (let i = 0; i < ring.length; i += 2) { const [x, y] = proj(ring[i + 1], ring[i]); i ? o.lineTo(x, y) : o.moveTo(x, y); }
      o.closePath(); o.fill();
    }
    const img = o.getImageData(0, 0, off.width, off.height).data, step = Math.max(4, Math.round(g.w / 170));
    dots = document.createElement("canvas"); dots.width = cv.width; dots.height = cv.height;
    const dc = dots.getContext("2d"), dpr = cv.width / g.w; dc.scale(dpr, dpr);
    for (let y = step / 2; y < g.h; y += step) for (let x = step / 2; x < g.w; x += step) {
      if (img[(Math.floor(y) * off.width + Math.floor(x)) * 4 + 3] > 0) { dc.fillStyle = "rgba(141,184,255,.22)"; dc.beginPath(); dc.arc(x, y, step * .2, 0, 7); dc.fill(); }
    }
    // Several schools in one city: spread them in a small spiral so each stays clickable.
    const seen = new Map();
    nodes = placed.map((n) => {
      const [x, y] = proj(n.lat, n.lng), k = `${Math.round(x / 6)}:${Math.round(y / 6)}`, i = seen.get(k) || 0; seen.set(k, i + 1);
      const r = i ? 5 + 3.2 * Math.sqrt(i) : 0, a = i * 2.4;
      return { ...n, x: x + Math.cos(a) * r, y: y + Math.sin(a) * r, t: (i * 1.7) % 6 };
    });
    byId = new Map(nodes.map((n) => [n.id, n]));
  };
  build();
  addEventListener("resize", build); onLeave(() => removeEventListener("resize", build));

  let hover = null;
  const arc = (A, B) => { const mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2, d = Math.hypot(B.x - A.x, B.y - A.y); return [mx, my - d * .22]; };
  animate((t) => {
    const { c, w, h } = g, k = t / 1000;
    c.clearRect(0, 0, w, h); c.drawImage(dots, 0, 0, w, h);
    const on = (n) => !filter || n.topics.includes(filter);
    data.edges.forEach(([a, b], i) => {
      const A = byId.get(a), B = byId.get(b); if (!A || !B) return;
      const isMine = a === data.me || b === data.me, [cx, cy] = arc(A, B);
      c.strokeStyle = isMine ? "rgba(241,213,145,.8)" : on(A) && on(B) ? "rgba(141,184,255,.32)" : "rgba(141,184,255,.06)";
      c.lineWidth = isMine ? 1.6 : .9; c.beginPath(); c.moveTo(A.x, A.y); c.quadraticCurveTo(cx, cy, B.x, B.y); c.stroke();
      if (!reduceMotion && (isMine || (on(A) && on(B)))) { // a small light travelling along each arc
        const p = ((k * .12 + i * .137) % 1), q = 1 - p;
        const x = q * q * A.x + 2 * q * p * cx + p * p * B.x, y = q * q * A.y + 2 * q * p * cy + p * p * B.y;
        c.fillStyle = isMine ? "rgba(241,213,145,.95)" : "rgba(190,215,255,.8)"; c.beginPath(); c.arc(x, y, 1.6, 0, 7); c.fill();
      }
    });
    for (const n of nodes) {
      const me = n.id === data.me, tw = reduceMotion ? 1 : .75 + .25 * Math.sin(k * 1.4 + n.t);
      const rad = me ? 6 : n === hover ? 5.5 : mine.has(n.id) ? 4 : 3.2;
      c.globalAlpha = on(n) || me ? tw : .15;
      c.fillStyle = me || mine.has(n.id) ? "#F1D591" : "#CFE0FF"; c.shadowColor = c.fillStyle; c.shadowBlur = me || n === hover ? 16 : 7;
      c.beginPath(); c.arc(n.x, n.y, rad, 0, 7); c.fill(); c.shadowBlur = 0; c.globalAlpha = 1;
      if (me || n === hover) { c.fillStyle = "#F2F0EA"; c.font = "500 12px DM Sans, sans-serif"; c.textAlign = "center"; c.fillText(me ? "You" : n.name, n.x, n.y - rad - 7); }
    }
  });
  const pick = (e) => { const r = cv.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top; let best = null, bd = 14; for (const n of nodes) { const d = Math.hypot(n.x - x, n.y - y); if (d < bd) { bd = d; best = n; } } return best; };
  const show = (n) => {
    hover = n; tip.hidden = !n;
    if (n) tip.innerHTML = `${avatar({ id: n.id, avatar: n.avatar, full_name: n.name }, "sm")}<div><b>${esc(n.name)}</b> ${sampleTag(n)}<div class="tiny">${esc([n.school, [n.city, n.country].filter(Boolean).join(", ")].filter(Boolean).join(" · "))}</div></div><a class="btn btn-soft btn-sm" href="#/u/${esc(n.id)}">View</a>`;
  };
  cv.onpointermove = (e) => { if (e.pointerType !== "mouse") return; const n = pick(e); if (n !== hover) show(n); };
  cv.onclick = (e) => { const n = pick(e); if (n && n === hover && e.pointerType === "mouse") go(`#/u/${n.id}`); else show(n); };
}

// =============================================================
// profile page
// =============================================================
const KIND_NAMES = { question: "Question", idea: "Idea", offer: "Offer" };
const LINK_NAMES = { linkedin: "LinkedIn", facebook: "Facebook", instagram: "Instagram", x: "X", website: "Website" };

async function profile(id) {
  let data;
  const ok = await load(async () => {
    data = await api("GET", `/api/people/${id}`);
    const p = data.profile, self = p.connection === "self", open = self || p.connection === "connected";
    const chipRow = (arr, cls = "") => (arr.length ? `<div class="chips">${arr.map((t) => `<span class="chip ${cls}">${esc(topicLabel(t))}</span>`).join("")}</div>` : `<p class="tiny">Not filled in yet.</p>`);
    const links = Object.entries(p.links || {});
    return `
    <div class="wrap prof fade-in">
      <div class="cover"><canvas id="coverCv" aria-hidden="true"></canvas></div>
      <div class="prof-head">
        ${avatar(p, "xl")}
        <div class="id">
          <h1 class="display">${esc(p.full_name)}</h1>${p.sample ? `<p>${sampleTag(p)} <span class="tiny">A sample profile, here to show how the network works.</span></p>` : ""}
          <p class="role">${esc([p.role_title, p.school].filter(Boolean).join(" · ") || "Principal")}</p>
          <div class="loc">${place(p) ? `<span>${esc(place(p))}</span>` : ""}${p.level ? `<span>${esc(state.levels[p.level] || "")}</span>` : ""}<span><b style="color:var(--gold-2)">${p.connections}</b> connection${p.connections === 1 ? "" : "s"}</span></div>
        </div>
        <div class="acts" id="profActs">${connectButtons(p)}${p.connection === "connected" ? `<span class="state connected" style="align-self:center">Connected</span>` : ""}</div>
      </div>

      <div class="prof-body">
        <div class="stack">
          ${p.connection === "received" && p.note ? `<div class="note-in"><span class="label">Their note</span><p style="margin-top:6px">“${esc(p.note)}”</p></div>` : ""}
          <section class="panel"><h3>About</h3>${p.bio ? `<p class="bio">${esc(p.bio)}</p>` : `<p class="tiny">${self ? 'Add a few lines about you and your school in <a href="#/me/edit">Edit profile</a>.' : "No bio yet."}</p>`}</section>
          <section class="panel stack"><div><h3>Working on</h3>${chipRow(p.topics)}</div><div><h3>Strong in, happy to help</h3>${chipRow(p.gives, "gold")}</div><div><h3>Wants to learn</h3>${chipRow(p.seeks, "plain")}</div></section>
          <section class="panel"><h3>On the board</h3>${data.posts.length ? `<div class="stack">${data.posts.map((x) => `<div><span class="kind ${esc(x.kind)}">${KIND_NAMES[x.kind] || "Post"}</span> <span class="tiny">${ago(x.created_at)}</span><p style="margin-top:6px;white-space:pre-line" dir="auto">${esc(x.text)}</p></div>`).join("")}</div>` : `<p class="tiny">No posts yet.</p>`}</section>
        </div>
        <aside class="stack">
          <section class="panel">
            <h3>Contact</h3>
            ${open ? `<div class="contact">
                ${p.email ? `<a href="mailto:${esc(p.email)}">${icon("mail")}${esc(p.email)}</a>` : ""}
                ${p.phone ? `<div>${icon("phone")}${esc(p.phone)}</div>` : ""}
                ${links.map(([k, v]) => `<a href="${esc(v)}" target="_blank" rel="noopener noreferrer">${icon("link")}${LINK_NAMES[k] || k}</a>`).join("")}
                ${!p.phone && !links.length && self ? `<p class="tiny">Add a phone number or social links in <a href="#/me/edit">Edit profile</a>.</p>` : ""}
              </div>`
              : `<div class="locked">${icon("lock")}<span>Contact details and messages open once you're connected.</span></div>`}
          </section>
          ${self ? `<section class="panel"><h3>Who sees what</h3><p class="tiny">Every signed-in principal sees your name, photo, school, bio and topics. Only your connections see your email, phone and links.</p></section>` : ""}
        </aside>
      </div>
    </div>`;
  });
  if (!ok) return;
  cover($("#coverCv"), id, data.profile.connections);
  wireConnect(view.firstElementChild, () => profile(id));
}

// =============================================================
// edit profile
// =============================================================
function editProfile() {
  const me = state.me;
  const pick = (name, sel, max = 5) => `<div class="pick" data-max="${max}">${Object.entries(state.topics).map(([k, v]) => `<label><input type="checkbox" name="${name}" value="${k}" id="e-${name}-${k}" ${sel.includes(k) ? "checked" : ""}>${esc(v)}</label>`).join("")}</div>`;
  view.innerHTML = `
  <div class="wrap">
    <form class="edit fade-in" id="editForm" novalidate>
      <aside class="panel photo-box">
        <div id="photoPrev">${avatar(me, "xl")}</div>
        <input type="file" id="photoIn" accept="image/*">
        <button type="button" class="btn btn-soft btn-sm" id="photoBtn">${me.avatar ? "Change photo" : "Add a photo"}</button>
        ${me.avatar ? `<button type="button" class="linkish" id="photoDel">Remove photo</button>` : ""}
        <p class="tiny">Optional. A photo helps people recognize you at the summit.</p>
      </aside>
      <div class="stack">
        <section class="panel-lg group">
          <div><p class="label">Your profile</p><h2 class="display" style="font-size:2rem;margin-top:6px">How other principals will see you</h2></div>
          <label class="field"><span>Full name</span><input class="input" name="full_name" id="e-name" value="${esc(me.full_name)}" required></label>
          <div class="grid-2">
            <label class="field"><span>Role</span><input class="input" name="role_title" id="e-role" value="${esc(me.role_title)}" placeholder="Head of School"></label>
            <label class="field"><span>School</span><input class="input" name="school" id="e-school" value="${esc(me.school)}" placeholder="Herzl Jewish Day School"></label>
            <label class="field"><span>City</span><input class="input" name="city" id="e-city" value="${esc(me.city)}"></label>
            <label class="field"><span>Country</span><input class="input" name="country" id="e-country" value="${esc(me.country)}"></label>
          </div>
          <label class="field"><span>School type</span><select class="select" name="level" id="e-level"><option value="">Choose…</option>${Object.entries(state.levels).map(([k, v]) => `<option value="${k}" ${me.level === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select></label>
          <label class="field"><span>About you and your school</span><textarea class="textarea" name="bio" id="e-bio" maxlength="800" placeholder="A few lines: your school, your community, what you're proud of, what keeps you up at night.">${esc(me.bio)}</textarea></label>
        </section>
        <section class="panel-lg group">
          <fieldset><legend>What are you working on this year? <span class="tiny">Up to 5</span></legend>${pick("topics", me.topics)}</fieldset>
          <fieldset><legend>Where are you strong and happy to help? <span class="tiny">Up to 5</span></legend>${pick("gives", me.gives)}</fieldset>
          <fieldset><legend>What would you most like to learn from peers? <span class="tiny">Up to 5</span></legend>${pick("seeks", me.seeks)}</fieldset>
        </section>
        <section class="panel-lg group">
          <div><h3 style="font-size:1.1rem">Contact & links</h3><p class="tiny">Only your connections see these.</p></div>
          <div class="grid-2">
            <label class="field"><span>Phone / WhatsApp</span><input class="input" name="phone" id="e-phone" value="${esc(me.phone)}" placeholder="+1 416 555 0100"></label>
            ${Object.entries(LINK_NAMES).map(([k, v]) => `<label class="field"><span>${v}</span><input class="input" name="link-${k}" id="e-link-${k}" value="${esc(me.links?.[k] || "")}" placeholder="${k === "website" ? "yourschool.org" : `${k}.com/…`}"></label>`).join("")}
          </div>
        </section>
        <p class="form-error" id="editErr" role="alert"></p>
        <div class="savebar"><a class="btn btn-quiet" href="#/u/${me.id}">View profile</a><button class="btn btn-gold" type="submit">Save profile</button></div>
      </div>
    </form>
  </div>`;

  $$(".pick").forEach((box) => {
    const max = Number(box.dataset.max);
    const sync = () => { const n = $$("input:checked", box).length; $$("input", box).forEach((i) => (i.disabled = !i.checked && n >= max)); };
    box.addEventListener("change", sync); sync();
  });

  $("#photoBtn").onclick = () => $("#photoIn").click();
  $("#photoIn").onchange = async (e) => {
    const file = e.target.files[0]; if (!file) return;
    try {
      const url = await resizeImage(file, 400);
      $("#photoPrev").innerHTML = `<span class="av xl"><img src="${url}" alt=""></span>`;
      const r = await api("PUT", "/api/me/avatar", { image: url });
      state.me = r.me; renderChrome(); toast("Photo updated.");
    } catch (err) { toast(err.message || "That photo couldn't be used. Try another one."); }
  };
  $("#photoDel")?.addEventListener("click", async () => {
    await api("DELETE", "/api/me/avatar").catch((err) => toast(err.message)); await refreshMe(); editProfile(); toast("Photo removed.");
  });

  $("#editForm").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target), btn = e.target.querySelector("[type=submit]");
    const body = {
      full_name: fd.get("full_name"), role_title: fd.get("role_title"), school: fd.get("school"), city: fd.get("city"), country: fd.get("country"),
      level: fd.get("level"), bio: fd.get("bio"), phone: fd.get("phone"),
      topics: fd.getAll("topics"), gives: fd.getAll("gives"), seeks: fd.getAll("seeks"),
      links: Object.fromEntries(Object.keys(LINK_NAMES).map((k) => [k, fd.get(`link-${k}`)])),
    };
    btn.disabled = true; $("#editErr").textContent = "";
    try { const r = await api("PUT", "/api/me", body); state.me = r.me; renderChrome(); toast("Profile saved."); go(`#/u/${r.me.id}`); }
    catch (err) { $("#editErr").textContent = err.message; btn.disabled = false; }
  };
}

/** Center-crops and resizes an image file to a square JPEG data URL. */
async function resizeImage(file, size) {
  const bmp = await createImageBitmap(file);
  const s = Math.min(bmp.width, bmp.height);
  const cv = document.createElement("canvas"); cv.width = cv.height = size;
  cv.getContext("2d").drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, size, size);
  return cv.toDataURL("image/jpeg", .85);
}

// =============================================================
// messages
// =============================================================
async function messages(withId) {
  const token = routeToken;
  view.innerHTML = `<div class="wrap"><div class="inbox ${withId ? "has-thread" : ""}"><div class="list" id="convList">${loadingHTML}</div><div class="thread" id="thread">${withId ? loadingHTML : `<div class="empty" style="margin:auto;text-align:center;justify-items:center">${icon("chat")}<span>Choose a conversation, or message one of your connections from their profile.</span></div>`}</div></div></div>`;

  async function loadList() {
    const { conversations } = await api("GET", "/api/messages");
    if (token !== routeToken) return;
    let html = conversations.map((c) => `<a class="conv" href="#/messages/${esc(c.with.id)}" ${c.with.id === withId ? 'aria-current="true"' : ""}>${avatar(c.with, "sm")}<span class="who"><b>${esc(c.with.full_name)}</b><span>${c.last.mine ? "You: " : ""}${esc(c.last.body)}</span></span>${c.unread ? `<span class="dot">${c.unread}</span>` : `<span class="tiny">${ago(c.last.at)}</span>`}</a>`).join("");
    if (!conversations.length) {
      const { connected } = await api("GET", "/api/connections");
      if (token !== routeToken) return;
      html = connected.length
        ? `<p class="tiny" style="padding:10px">Start a conversation with one of your connections:</p>` + connected.map((p) => `<a class="conv" href="#/messages/${esc(p.id)}" ${p.id === withId ? 'aria-current="true"' : ""}>${avatar(p, "sm")}<span class="who"><b>${esc(p.full_name)}</b><span>${esc(where(p))}</span></span></a>`).join("")
        : `<div class="empty" style="margin:8px"><span>Messages open once you're connected with someone.</span><a class="btn btn-soft btn-sm" href="#/">Find principals</a></div>`;
    }
    $("#convList").innerHTML = html;
  }
  loadList().catch((e) => { if (token === routeToken) $("#convList").innerHTML = `<div class="empty">${esc(e.message)}</div>`; });
  const listTimer = setInterval(() => { if (!document.hidden) loadList().catch(() => {}); }, 20000);
  onLeave(() => clearInterval(listTimer));

  if (!withId) return;
  let lastId = 0, lastDay = "";
  const bubble = (m) => {
    const day = new Date(m.at).toDateString();
    const sep = day !== lastDay ? `<div class="day">${new Date(m.at).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</div>` : "";
    lastDay = day; lastId = Math.max(lastId, m.id);
    return `${sep}<div class="bubble ${m.mine ? "mine" : ""}">${esc(m.body)}<time>${clock(m.at)}</time></div>`;
  };
  let data;
  try { data = await api("GET", `/api/messages/${withId}`); }
  catch (e) {
    if (token === routeToken) $("#thread").innerHTML = `<div class="empty" style="margin:auto"><span>${esc(e.message)}</span><a class="btn btn-soft btn-sm" href="#/u/${esc(withId)}">View profile</a></div>`;
    return;
  }
  if (token !== routeToken) return;
  const w = data.with;
  $("#thread").innerHTML = `
    <div class="thread-head"><a href="#/messages" class="btn btn-quiet btn-sm" aria-label="Back to conversations" style="padding:.4rem">${icon("back")}</a>${avatar(w, "sm")}<div style="display:grid"><a href="#/u/${esc(w.id)}">${esc(w.full_name)}</a><span class="tiny">${esc(where(w))}</span></div></div>
    <div class="bubbles" id="bubbles">${data.messages.length ? data.messages.map(bubble).join("") : `<div class="day" id="hello">Say shalom to ${esc(first(w.full_name))}.</div>`}</div>
    <form class="composer" id="composer"><textarea class="textarea" id="msgIn" rows="1" maxlength="2000" placeholder="Write a message…" aria-label="Message"></textarea><button class="btn btn-primary" type="submit" aria-label="Send">${icon("send")}</button></form>`;
  const box = $("#bubbles"), input = $("#msgIn");
  const toBottom = () => (box.scrollTop = box.scrollHeight);
  toBottom();
  refreshMe().catch(() => {});
  try { const draft = sessionStorage.getItem(`draft:${withId}`); if (draft) { input.value = draft; sessionStorage.removeItem(`draft:${withId}`); } } catch { /* storage unavailable */ }
  input.focus();
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); $("#composer").requestSubmit(); } });
  input.addEventListener("input", () => { input.style.height = "auto"; input.style.height = `${Math.min(160, input.scrollHeight)}px`; });
  $("#composer").onsubmit = async (e) => {
    e.preventDefault();
    const body = input.value.trim(); if (!body) return;
    input.value = ""; input.style.height = "auto";
    try {
      const { message } = await api("POST", `/api/messages/${withId}`, { body });
      $("#hello")?.remove();
      box.insertAdjacentHTML("beforeend", bubble(message)); toBottom(); loadList().catch(() => {});
    } catch (err) { input.value = body; toast(err.message); }
  };
  const poll = setInterval(async () => {
    if (document.hidden) return;
    try {
      const r = await api("GET", `/api/messages/${withId}?after=${lastId}`);
      if (token !== routeToken) return;
      const fresh = r.messages.filter((m) => m.id > lastId);
      if (fresh.length) { $("#hello")?.remove(); const near = box.scrollHeight - box.scrollTop - box.clientHeight < 80; box.insertAdjacentHTML("beforeend", fresh.map(bubble).join("")); if (near) toBottom(); }
    } catch { /* keep polling */ }
  }, 5000);
  onLeave(() => clearInterval(poll));
}

// =============================================================
// board
// =============================================================
const LANGS = { he: "Hebrew", ru: "Russian", es: "Spanish", fr: "French", pt: "Portuguese", de: "German", uk: "Ukrainian", it: "Italian", hu: "Hungarian", ar: "Arabic", nl: "Dutch" };

async function board() {
  let data;
  const ok = await load(async () => {
    data = await api("GET", "/api/board");
    return `
    <div class="wrap section">
      <div class="section-head"><div><p class="label">The board</p><h2>Ask the whole constellation</h2></div></div>
      <div class="board">
        <div class="stack" id="posts">${data.posts.length ? data.posts.map((p) => postHTML(p, data.me)).join("") : `<div class="empty" id="noPosts"><b>No posts yet.</b><span>Ask a question, share an idea, or offer help. Write in any language — it's translated to English for everyone.</span></div>`}</div>
        <form class="panel-lg compose" id="compose" novalidate>
          <div class="seg" role="radiogroup" aria-label="Post type">
            <label><input type="radio" name="kind" value="question" id="k-q" checked>Question</label>
            <label><input type="radio" name="kind" value="idea" id="k-i">Idea</label>
            <label><input type="radio" name="kind" value="offer" id="k-o">Offer help</label>
          </div>
          <label class="field"><span>Your post</span><textarea class="textarea" id="postText" name="text" maxlength="1000" dir="auto" placeholder="How are you handling… ? / We tried… / Happy to share…"></textarea>
            <span class="hint">Posted under your name. Any language works; it's translated to English once, when you post.</span></label>
          <button class="btn btn-gold btn-block" type="submit">Post to the board</button>
        </form>
      </div>
    </div>`;
  });
  if (!ok) return;
  const root = view.firstElementChild, list = $("#posts");
  $("#compose").onsubmit = async (e) => {
    e.preventDefault();
    const fd = new FormData(e.target), btn = e.target.querySelector("[type=submit]");
    const text = String(fd.get("text") || "").trim();
    if (text.length < 3) { toast("Write a few words first."); return; }
    btn.disabled = true; btn.textContent = /[^\u0000-ɏ\s]/.test(text) ? "Translating and posting…" : "Posting…";
    try {
      const { post } = await api("POST", "/api/board", { kind: fd.get("kind"), text });
      $("#noPosts")?.remove();
      data.posts.unshift(post); list.insertAdjacentHTML("afterbegin", postHTML(post, state.me.id));
      e.target.reset(); toast(post.original ? `Posted, translated from ${LANGS[post.lang] || "your language"}.` : "Posted.");
    } catch (err) { toast(err.message); }
    btn.disabled = false; btn.textContent = "Post to the board";
  };
  wireConnect(root, () => {});
  list.addEventListener("click", async (e) => {
    const t = e.target.closest("[data-act]"); if (!t) return;
    if (t.dataset.act === "orig") {
      const o = $(".orig", t.closest(".post")); o.hidden = !o.hidden; t.textContent = t.textContent.replace(o.hidden ? "Hide" : "Show", o.hidden ? "Show" : "Hide");
    } else if (t.dataset.act === "del") {
      try { await api("DELETE", `/api/board/${t.dataset.id}`); t.closest(".post").remove(); toast("Post removed."); } catch (err) { toast(err.message); }
    } else if (t.dataset.act === "help") {
      const p = data.posts.find((x) => x.id === t.dataset.id);
      const note = `About your post: “${p.text.slice(0, 120)}${p.text.length > 120 ? "…" : ""}” — I think I can help.`;
      const person = await api("GET", `/api/people/${p.author.id}`).then((r) => r.profile).catch(() => null);
      if (person?.connection === "connected") {
        try { sessionStorage.setItem(`draft:${p.author.id}`, `${note}\n\n`); } catch { /* storage unavailable */ }
        go(`#/messages/${p.author.id}`);
      } else if (person?.connection === "sent") toast("You've already asked to connect. They'll see your request.");
      else if (person?.connection === "received") toast("They've already asked to connect with you. Accept it on your Constellation page.");
      else {
        const b = document.createElement("button");
        Object.assign(b.dataset, { act: "connect", id: p.author.id, name: p.author.full_name, note }); b.hidden = true;
        list.appendChild(b); b.click(); b.remove();
      }
    }
  });
}

function postHTML(p, meId) {
  const a = p.author, mine = a.id === meId;
  return `<article class="post fade-in">
    <div class="head">${avatar(a, "sm")}<div class="who"><span><a href="#/u/${esc(a.id)}">${esc(a.full_name)}</a> ${sampleTag(a)}</span><span>${esc(where(a))}${where(a) ? " · " : ""}${ago(p.at)}</span></div><span class="kind ${esc(p.kind)}">${KIND_NAMES[p.kind] || "Post"}</span></div>
    <p class="text" dir="auto">${esc(p.text)}</p>
    ${p.original ? `<p class="orig" dir="auto" lang="${esc(p.lang)}" hidden>${esc(p.original)}</p>` : ""}
    <div class="foot">
      ${mine ? `<button class="linkish" data-act="del" data-id="${esc(p.id)}">Delete</button>` : `<button class="btn btn-soft btn-sm" data-act="help" data-id="${esc(p.id)}">I can help</button>`}
      ${p.original ? `<button class="linkish" data-act="orig">Translated from ${LANGS[p.lang] || "another language"} · Show original</button>` : ""}
    </div>
  </article>`;
}

// =============================================================
// the summit (details coming soon)
// =============================================================
function summit() {
  view.innerHTML = `
  <div class="wrap soon fade-in">
    <img class="poster" src="assets/summit-logo.jpg" alt="Yael Summit emblem: a star of David made of a blue ribbon and a gold triangle, over the Earth at night">
    <div class="stack" style="gap:18px">
      <p class="label">The Yael Summit</p>
      <h1 class="display">Constellation</h1>
      <p class="muted" style="font-size:1.15rem;max-width:44ch">An international gathering of Jewish school leaders, hosted by the Yael Foundation. The program, speakers, dates and venue are coming soon.</p>
      <div class="facts"><div><span>Dates</span>Coming soon</div><div><span>Venue</span>Coming soon</div><div><span>Program</span>Coming soon</div></div>
      <div style="display:flex;gap:10px;flex-wrap:wrap">${state.me ? `<a class="btn btn-gold" href="#/">Back to my constellation</a>` : `<a class="btn btn-gold" href="#/join">Join the constellation</a><a class="btn btn-quiet" href="#/signin">Sign in</a>`}</div>
    </div>
  </div>`;
}

// =============================================================
// boot
// =============================================================
(async () => {
  view.innerHTML = loadingHTML;
  try { await refreshMe(); } catch { state.me = null; }
  route();
})();
