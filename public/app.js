/* Connections — Yael Foundation. No libraries, no build step. */
(() => {
  "use strict";

  const S = window.SUMMIT;
  const TOPIC = Object.fromEntries(S.topics.map(t => [t.id, t]));
  const label = id => (TOPIC[id] ? TOPIC[id].label : id);
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const $ = sel => document.querySelector(sel);

  // ---------- helpers ----------
  function seeded(seed) {
    let s = seed >>> 0;
    return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  }
  function inter(a, b) { return a.filter(x => b.includes(x)); }
  function joinList(list) {
    if (list.length <= 1) return list.join("");
    return list.slice(0, -1).join(", ") + " and " + list[list.length - 1];
  }
  function firstName(n) { return n.split(" ")[0]; }
  function esc(s) { return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }

  // Resizes a canvas to its CSS box at device pixel ratio; returns a 2d context in CSS pixels.
  function fitCanvas(cv) {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const r = cv.getBoundingClientRect();
    cv.width = Math.max(1, Math.round(r.width * dpr));
    cv.height = Math.max(1, Math.round(r.height * dpr));
    const ctx = cv.getContext("2d");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: r.width, h: r.height };
  }

  // Runs `frame` only while the element is on screen.
  function animateWhenVisible(el, frame) {
    let raf = 0, on = false;
    const loop = t => { frame(t); if (on) raf = requestAnimationFrame(loop); };
    new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !on) { on = true; raf = requestAnimationFrame(loop); }
      else if (!e.isIntersecting && on) { on = false; cancelAnimationFrame(raf); }
    }).observe(el);
  }

  // =========================================================
  // 1. Hero sky — stars that slowly form constellations
  // =========================================================
  (function sky() {
    const cv = $("#sky");
    if (!cv) return;
    let ctx, w, h, stars = [], groups = [];
    const pointer = { x: -999, y: -999 };

    function build() {
      ({ ctx, w, h } = fitCanvas(cv));
      const rnd = seeded(7);
      const n = Math.round(Math.min(220, (w * h) / 5200));
      stars = Array.from({ length: n }, () => ({
        x: rnd() * w, y: rnd() * h,
        r: rnd() < 0.08 ? 1.6 + rnd() * 1.2 : 0.4 + rnd() * 0.9,
        tw: rnd() * Math.PI * 2, sp: 0.4 + rnd() * 1.2,
        dx: (rnd() - 0.5) * 0.04, dy: (rnd() - 0.5) * 0.03
      }));
      // constellations: chains of nearby bright-ish stars
      groups = [];
      const used = new Set();
      for (let g = 0; g < 7; g++) {
        let i = Math.floor(rnd() * stars.length);
        if (used.has(i)) continue;
        const chain = [i]; used.add(i);
        for (let k = 0; k < 4; k++) {
          const a = stars[chain[chain.length - 1]];
          let best = -1, bd = Infinity;
          stars.forEach((b, j) => {
            if (used.has(j)) return;
            const d = Math.hypot(a.x - b.x, a.y - b.y);
            if (d > 40 && d < 160 && d < bd) { bd = d; best = j; }
          });
          if (best < 0) break;
          chain.push(best); used.add(best);
        }
        if (chain.length > 2) groups.push({ chain, phase: rnd() * 10, period: 9 + rnd() * 6 });
      }
    }

    function draw(t) {
      const time = t / 1000;
      ctx.clearRect(0, 0, w, h);
      // constellation lines, fading in and out
      groups.forEach(g => {
        const p = ((time + g.phase) % g.period) / g.period;         // 0..1
        const grow = Math.min(1, p * 3);                               // draw in
        const alpha = p < 0.75 ? 1 : 1 - (p - 0.75) / 0.25;            // fade out
        const segs = (g.chain.length - 1) * grow;
        ctx.strokeStyle = `rgba(47,123,245,${0.3 * alpha})`;
        ctx.lineWidth = 0.8;
        ctx.beginPath();
        for (let i = 0; i < g.chain.length - 1; i++) {
          const f = Math.max(0, Math.min(1, segs - i));
          if (!f) break;
          const a = stars[g.chain[i]], b = stars[g.chain[i + 1]];
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
        }
        ctx.stroke();
      });
      // pointer connections
      stars.forEach(s => {
        const d = Math.hypot(s.x - pointer.x, s.y - pointer.y);
        if (d < 130) {
          ctx.strokeStyle = `rgba(47,123,245,${0.35 * (1 - d / 130)})`;
          ctx.lineWidth = 0.6;
          ctx.beginPath(); ctx.moveTo(pointer.x, pointer.y); ctx.lineTo(s.x, s.y); ctx.stroke();
        }
      });
      // stars
      stars.forEach(s => {
        if (!reduceMotion) {
          s.x += s.dx; s.y += s.dy;
          if (s.x < 0) s.x = w; if (s.x > w) s.x = 0;
          if (s.y < 0) s.y = h; if (s.y > h) s.y = 0;
        }
        const tw = reduceMotion ? 0.8 : 0.55 + 0.45 * Math.sin(time * s.sp + s.tw);
        ctx.fillStyle = `rgba(47,123,245,${0.25 + 0.4 * tw})`;
        ctx.beginPath(); ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2); ctx.fill();
        if (s.r > 1.5) {
          const g = ctx.createRadialGradient(s.x, s.y, 0, s.x, s.y, s.r * 6);
          g.addColorStop(0, `rgba(31,163,242,${0.25 * tw})`); g.addColorStop(1, "rgba(31,163,242,0)");
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(s.x, s.y, s.r * 6, 0, Math.PI * 2); ctx.fill();
        }
      });
    }

    build();
    draw(8000);
    addEventListener("resize", () => { build(); if (reduceMotion) draw(8000); });
    cv.parentElement.addEventListener("pointermove", e => {
      const r = cv.getBoundingClientRect(); pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top;
    });
    cv.parentElement.addEventListener("pointerleave", () => { pointer.x = pointer.y = -999; });
    if (reduceMotion) draw(8000); else animateWhenVisible(cv, draw);
  })();

  // =========================================================
  // 2. Network map
  // =========================================================
  const net = (function network() {
    const cv = $("#net");
    const card = $("#mapCard");
    let ctx, w, h;
    const state = { filter: null, hover: null, me: null, links: [], linkT0: 0 };

    // layout in unit space, computed once: topic anchors on a ring + light relaxation
    const rnd = seeded(42);
    const anchors = {};
    S.topics.forEach((t, i) => {
      const a = (i / S.topics.length) * Math.PI * 2 - Math.PI / 2;
      anchors[t.id] = { x: 0.5 + Math.cos(a) * 0.33, y: 0.5 + Math.sin(a) * 0.36 };
    });
    const nodes = S.people.map(p => {
      const a = anchors[p.topics[0]];
      return { p, x: a.x + (rnd() - 0.5) * 0.12, y: a.y + (rnd() - 0.5) * 0.12, r: 3 + p.gives.length, tw: rnd() * 6 };
    });
    for (let it = 0; it < 160; it++) {
      nodes.forEach(n => {
        const a = anchors[n.p.topics[0]];
        n.x += (a.x - n.x) * 0.02; n.y += (a.y - n.y) * 0.02;
        nodes.forEach(m => {
          if (m === n) return;
          const dx = n.x - m.x, dy = n.y - m.y, d = Math.hypot(dx, dy) || 0.001;
          if (d < 0.09) { const f = (0.09 - d) * 0.25; n.x += (dx / d) * f; n.y += (dy / d) * f; }
        });
        n.x = Math.min(0.94, Math.max(0.06, n.x)); n.y = Math.min(0.92, Math.max(0.08, n.y));
      });
    }
    const edges = [];
    for (let i = 0; i < nodes.length; i++)
      for (let j = i + 1; j < nodes.length; j++)
        if (inter(nodes[i].p.topics, nodes[j].p.topics).length >= 2) edges.push([nodes[i], nodes[j]]);

    const px = n => ({ x: n.x * w, y: n.y * h });
    const colorOf = n => TOPIC[n.p.topics[0]].color;
    const active = n => !state.filter || n.p.topics.includes(state.filter);

    function draw(t) {
      const time = (t || 0) / 1000;
      ctx.clearRect(0, 0, w, h);

      // edges
      edges.forEach(([a, b]) => {
        const on = active(a) && active(b);
        const hov = state.hover && (state.hover === a || state.hover === b);
        const A = px(a), B = px(b);
        ctx.strokeStyle = hov ? "rgba(47,123,245,.55)" : on ? `rgba(47,123,245,${state.filter ? 0.3 : 0.13})` : "rgba(11,12,28,.04)";
        ctx.lineWidth = hov ? 1.1 : 0.7;
        ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
      });

      // "me" links, drawn in over ~1.2s
      if (state.me) {
        const M = { x: state.me.x * w, y: state.me.y * h };
        const k = reduceMotion ? 1 : Math.min(1, (performance.now() - state.linkT0) / 1200);
        state.links.forEach((n, i) => {
          const f = Math.max(0, Math.min(1, k * 1.6 - i * 0.25));
          const B = px(n);
          const grad = ctx.createLinearGradient(M.x, M.y, B.x, B.y);
          grad.addColorStop(0, "rgba(47,123,245,.95)"); grad.addColorStop(1, "rgba(31,163,242,.75)");
          ctx.strokeStyle = grad; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(M.x, M.y); ctx.lineTo(M.x + (B.x - M.x) * f, M.y + (B.y - M.y) * f); ctx.stroke();
        });
      }

      // nodes
      nodes.forEach(n => {
        const P = px(n), on = active(n);
        const linked = state.links.includes(n);
        const r = n.r * (state.hover === n || linked ? 1.5 : 1);
        const tw = reduceMotion ? 1 : 0.8 + 0.2 * Math.sin(time * 1.3 + n.tw);
        const c = colorOf(n);
        if (on) {
          const g = ctx.createRadialGradient(P.x, P.y, 0, P.x, P.y, r * 5);
          g.addColorStop(0, hexA(c, 0.35 * tw)); g.addColorStop(1, hexA(c, 0));
          ctx.fillStyle = g; ctx.beginPath(); ctx.arc(P.x, P.y, r * 5, 0, Math.PI * 2); ctx.fill();
        }
        ctx.fillStyle = on ? hexA(c, tw) : "rgba(11,12,28,.12)";
        ctx.beginPath(); ctx.arc(P.x, P.y, r, 0, Math.PI * 2); ctx.fill();
        if (linked || state.hover === n) {
          ctx.fillStyle = "#0B0C1C"; ctx.font = "500 13px Rubik, sans-serif"; ctx.textAlign = "center";
          ctx.fillText(firstName(n.p.name), P.x, P.y - r - 8);
        }
      });

      // me
      if (state.me) {
        const M = { x: state.me.x * w, y: state.me.y * h };
        const pulse = reduceMotion ? 0 : (Math.sin(time * 2) + 1) / 2;
        ctx.strokeStyle = `rgba(47,123,245,${0.5 - pulse * 0.35})`;
        ctx.lineWidth = 1;
        ctx.beginPath(); ctx.arc(M.x, M.y, 14 + pulse * 8, 0, Math.PI * 2); ctx.stroke();
        star4(ctx, M.x, M.y, 12, "#2F7BF5");
        ctx.fillStyle = "#2F7BF5"; ctx.font = "600 13px Rubik, sans-serif"; ctx.textAlign = "center";
        ctx.fillText(state.me.name || "You", M.x, M.y + 30);
      }
    }

    function hexA(hex, a) {
      const n = parseInt(hex.slice(1), 16);
      return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
    }
    function star4(c, x, y, r, col) {
      c.fillStyle = col; c.beginPath();
      c.moveTo(x, y - r); c.quadraticCurveTo(x, y, x + r, y); c.quadraticCurveTo(x, y, x, y + r);
      c.quadraticCurveTo(x, y, x - r, y); c.quadraticCurveTo(x, y, x, y - r); c.fill();
    }

    function showCard(n) {
      if (!n) { card.innerHTML = '<p class="map-card-hint">Hover or tap a star to meet the principal</p>'; return; }
      const p = n.p;
      card.innerHTML = `
        <h4>${esc(p.name)}</h4>
        <p class="meta">${esc(p.school)} · ${esc(p.city)} · ${S.levels[p.level]}</p>
        <div class="tags">${p.topics.map(t => `<span class="tag">${label(t)}</span>`).join("")}</div>
        <p class="meta">Strong in: ${p.gives.map(label).join(", ")}</p>`;
    }

    function pick(e) {
      const r = cv.getBoundingClientRect();
      const x = e.clientX - r.left, y = e.clientY - r.top;
      let best = null, bd = 22;
      nodes.forEach(n => { const d = Math.hypot(n.x * w - x, n.y * h - y); if (d < bd) { bd = d; best = n; } });
      return best;
    }
    cv.addEventListener("pointermove", e => {
      const n = pick(e);
      if (n !== state.hover) { state.hover = n; if (n) showCard(n); if (reduceMotion) draw(); }
    });
    cv.addEventListener("click", e => { const n = pick(e); state.hover = n; showCard(n); if (reduceMotion) draw(); });

    function resize() { ({ ctx, w, h } = fitCanvas(cv)); draw(); }
    resize();
    addEventListener("resize", resize);
    if (!reduceMotion) animateWhenVisible(cv, draw);

    // chips
    const chips = $("#topicChips");
    const mk = (id, text, color) => {
      const b = document.createElement("button");
      b.type = "button"; b.className = "chip";
      b.setAttribute("aria-pressed", String(id === null));
      b.style.setProperty("--c", color || "var(--blue)");
      b.innerHTML = `<i></i>${text}`;
      b.addEventListener("click", () => {
        state.filter = id;
        chips.querySelectorAll(".chip").forEach(c => c.setAttribute("aria-pressed", String(c === b)));
        if (reduceMotion) draw();
      });
      chips.appendChild(b);
    };
    mk(null, "Whole network");
    S.topics.forEach(t => mk(t.id, t.label, t.color));

    return {
      connect(me, matched) {
        state.me = { x: 0.5, y: 0.5, name: firstName(me.name || "") };
        state.links = matched.map(m => nodes.find(n => n.p.id === m.p.id));
        state.linkT0 = performance.now();
        draw();
      }
    };
  })();

  // =========================================================
  // 3. Matching — runs locally, costs no AI credits
  // =========================================================
  const OPENERS = {
    climate: "What's the one thing that changed the atmosphere in your hallways?",
    inclusion: "How do you build an inclusion plan your teachers actually believe in?",
    ai: "Where is AI already saving your staff time — and where not yet?",
    staff: "What keeps good teachers at your school year after year?",
    parents: "How do you reach the parents who never come to meetings?",
    wellbeing: "What does the morning look like for a student who's struggling at your school?",
    gaps: "What worked for you in closing gaps without labeling students?",
    innovation: "Which teaching experiment worked better than you expected?",
    leadership: "How do you share responsibility in your leadership team without losing the big picture?"
  };

  function score(me, p) {
    const give = inter(me.seeks, p.gives);     // what they can give me
    const get = inter(p.seeks, me.gives);      // what I can give them
    const shared = inter(me.topics, p.topics);
    let s = give.length * 3 + get.length * 2 + shared.length * 1.5;
    if (p.level === me.level) s += 1;
    if (p.region !== me.region) s += 0.5;      // a fresh view from another region
    const pct = Math.round(40 + 59 * Math.min(1, s / 11));
    return { p, s, pct, give, get, shared };
  }

  function localText(m) {
    const n = firstName(m.p.name), parts = [];
    if (m.give.length) parts.push(`${n} has real experience in ${joinList(m.give.map(label).map(x => x.toLowerCase()))} — exactly what you're looking for.`);
    if (m.get.length) parts.push(`In return, ${n} wants to learn about ${joinList(m.get.map(label).map(x => x.toLowerCase()))}, which is your strength.`);
    if (m.shared.length) parts.push(`You're both working on ${joinList(m.shared.map(label).map(x => x.toLowerCase()))} this year.`);
    if (!parts.length) parts.push(`A fresh perspective from the ${S.regions[m.p.region]}.`);
    const t = m.give[0] || m.shared[0] || m.p.topics[0];
    return { why: parts.join(" "), opener: OPENERS[t] };
  }

  const form = $("#profileForm");
  const preset = { topics: ["parents", "gaps", "inclusion"], gives: ["innovation", "staff"], seeks: ["parents", "inclusion"] };
  ["topics", "gives", "seeks"].forEach(group => {
    const box = $("#pick-" + group);
    S.topics.forEach(t => {
      const id = `f-${group}-${t.id}`;
      const l = document.createElement("label");
      l.htmlFor = id;
      l.innerHTML = `<input type="checkbox" id="${id}" name="${group}" value="${t.id}"${preset[group].includes(t.id) ? " checked" : ""}>${t.label}`;
      box.appendChild(l);
    });
  });

  function readForm() {
    const fd = new FormData(form);
    return {
      name: (fd.get("name") || "").toString().trim(),
      level: fd.get("level"), region: fd.get("region"),
      topics: fd.getAll("topics"), gives: fd.getAll("gives"), seeks: fd.getAll("seeks"),
      note: (fd.get("note") || "").toString().trim().slice(0, 200)
    };
  }

  let current = { me: null, matches: [] };
  const list = $("#matchList");
  const aiBtn = $("#aiBtn");
  const aiStatus = $("#aiStatus");

  function render(ai) {
    if (!current.matches.length) {
      list.innerHTML = '<li class="empty">Pick at least one topic so we can find your connections.</li>';
      return;
    }
    list.innerHTML = current.matches.map(m => {
      const txt = (ai && ai[m.p.id]) || localText(m);
      const C = 2 * Math.PI * 28, off = C * (1 - m.pct / 100);
      const tags = [...m.give.map(t => `<span class="tag">Can help you: ${label(t)}</span>`),
                    ...m.shared.map(t => `<span class="tag tag-soft">${label(t)}</span>`)].join("");
      return `
      <li class="match${ai && ai[m.p.id] ? " is-ai" : ""}">
        <div class="match-score" aria-label="${m.pct} percent match">
          <svg viewBox="0 0 64 64" aria-hidden="true">
            <circle cx="32" cy="32" r="28" fill="none" stroke="rgba(47,123,245,.12)" stroke-width="2"/>
            <circle cx="32" cy="32" r="28" fill="none" stroke="#2F7BF5" stroke-width="3" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${off}"/>
          </svg>
          <span>${m.pct}%<small>match</small></span>
        </div>
        <h4 class="match-name">${esc(m.p.name)}</h4>
        <p class="match-meta">${esc(m.p.school)} · ${esc(m.p.city)} · ${S.levels[m.p.level]}</p>
        <div class="match-body">
          <p class="match-why">${esc(txt.why)}</p>
          ${tags ? `<div class="tags">${tags}</div>` : ""}
          <p class="match-open"><b>Conversation starter</b>${esc(txt.opener)}</p>
        </div>
      </li>`;
    }).join("");
  }

  function run(scrollToMap) {
    const me = readForm();
    const hasAny = me.topics.length + me.gives.length + me.seeks.length > 0;
    const matches = hasAny ? S.people.map(p => score(me, p)).sort((a, b) => b.s - a.s).slice(0, 3) : [];
    current = { me, matches };
    aiStatus.hidden = true;
    render(null);
    if (matches.length) net.connect(me, matches);
    if (scrollToMap && matches.length) $("#results").scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
  }

  form.addEventListener("submit", e => { e.preventDefault(); run(true); });
  run(false); // the page opens with the sample profile already matched

  // =========================================================
  // 4. AI wording — one request for all three, only on click, cached
  // =========================================================
  const memo = new Map();
  function cacheGet(k) {
    if (memo.has(k)) return memo.get(k);
    try { const v = localStorage.getItem("ai:" + k); return v ? JSON.parse(v) : null; } catch { return null; }
  }
  function cacheSet(k, v) {
    memo.set(k, v);
    try { localStorage.setItem("ai:" + k, JSON.stringify(v)); } catch { /* storage unavailable */ }
  }

  aiBtn.addEventListener("click", async () => {
    if (!current.matches.length) return;
    const { me, matches } = current;
    // Only what the model needs. The user's own name is not sent.
    const payload = {
      me: { level: me.level, region: me.region, topics: me.topics, gives: me.gives, seeks: me.seeks, note: me.note },
      matches: matches.map(m => ({ id: m.p.id, name: firstName(m.p.name), level: m.p.level, region: m.p.region, topics: m.p.topics, gives: m.p.gives, seeks: m.p.seeks }))
    };
    const key = JSON.stringify(payload);
    const hit = cacheGet(key);
    if (hit) { render(hit); return; }

    aiBtn.disabled = true;
    aiStatus.hidden = false;
    aiStatus.textContent = "Writing for you…";
    try {
      const res = await fetch("/api/connect", { method: "POST", headers: { "content-type": "application/json" }, body: key });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const byId = {};
      (data.items || []).forEach(it => { if (it && it.id != null && it.why) byId[it.id] = { why: it.why, opener: it.opener || "" }; });
      if (!Object.keys(byId).length) throw new Error("empty");
      cacheSet(key, byId);
      aiStatus.hidden = true;
      render(byId);
    } catch {
      aiStatus.textContent = "AI isn't connected on this copy of the site yet. Once the Gemini key is added in Cloudflare, this button writes a personal reason and conversation starter for each connection. For now you're seeing the automatic wording.";
    } finally {
      aiBtn.disabled = false;
    }
  });

  // =========================================================
  // 5. The board — posts in any language, shown in English
  //    Translation happens once on the server when a post is saved.
  // =========================================================
  (function board() {
    const form = $("#boardForm"), list = $("#posts"), status = $("#boardStatus");
    const btn = $("#boardBtn"), ta = $("#b-text"), count = $("#b-count");
    const LANG = { he: "Hebrew", ar: "Arabic", ru: "Russian", am: "Amharic", fr: "French", es: "Spanish" };
    const KIND = { question: "Question", idea: "Idea", offer: "Offer to help" };
    const samples = S.posts.map(p => ({ ...p, sample: true }));
    let posts = samples.slice();

    function ago(ts) {
      if (!ts) return "";
      const m = Math.round((Date.now() - ts) / 60000);
      if (m < 1) return "just now";
      if (m < 60) return `${m} min ago`;
      const h = Math.round(m / 60);
      return h < 24 ? `${h}h ago` : `${Math.round(h / 24)}d ago`;
    }

    function renderPosts() {
      list.innerHTML = posts.map(p => {
        const translated = p.original && p.lang && p.lang !== "en";
        return `
        <li class="post">
          <div class="post-top">
            <span class="post-kind" data-kind="${esc(p.kind)}">${KIND[p.kind] || "Post"}</span>
            ${p.sample ? '<span class="post-sample">Example</span>' : p.preview ? '<span class="post-sample">Preview — not saved</span>' : `<span class="post-sample">${ago(p.ts)}</span>`}
          </div>
          <p class="post-text" dir="auto">${esc(p.text)}</p>
          ${translated ? `<p class="post-original" dir="auto" lang="${esc(p.lang)}" hidden>${esc(p.original)}</p>` : ""}
          <div class="post-meta">
            <span><b>${esc(p.name || "A principal")}</b>${p.school ? " · " + esc(p.school) : ""}</span>
            ${translated ? `<button type="button" class="post-lang" aria-expanded="false">Translated from ${LANG[p.lang] || "another language"} · Show original</button>` : ""}
          </div>
        </li>`;
      }).join("");
    }

    list.addEventListener("click", e => {
      const b = e.target.closest(".post-lang");
      if (!b) return;
      const orig = b.closest(".post").querySelector(".post-original");
      const open = orig.hidden;
      orig.hidden = !open;
      b.setAttribute("aria-expanded", String(open));
      b.textContent = b.textContent.replace(open ? "Show original" : "Hide original", open ? "Hide original" : "Show original");
    });

    const updateCount = () => { count.textContent = ta.value.length; };
    ta.addEventListener("input", updateCount);
    updateCount();

    form.addEventListener("submit", async e => {
      e.preventDefault();
      const fd = new FormData(form);
      const post = {
        kind: fd.get("kind"),
        name: (fd.get("name") || "").toString().trim(),
        school: (fd.get("school") || "").toString().trim(),
        text: (fd.get("text") || "").toString().trim()
      };
      if (post.text.length < 3) { status.textContent = "Write a few words first."; ta.focus(); return; }

      btn.disabled = true;
      status.textContent = "Translating and posting…";
      try {
        const res = await fetch("/api/board", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(post) });
        const data = await res.json().catch(() => ({}));
        if (res.status === 429) { status.textContent = "You've posted a few times in a row — try again in a minute."; return; }
        if (res.status === 422) { status.textContent = "This post couldn't be published. Please rephrase and try again."; return; }
        if (!res.ok || !data.post) throw new Error(String(res.status));
        posts = [data.post, ...posts.filter(p => !p.sample || posts.length < 6)];
        renderPosts();
        form.reset(); updateCount();
        status.textContent = data.post.lang && data.post.lang !== "en" ? `Posted — translated from ${LANG[data.post.lang] || "your language"}.` : "Posted.";
      } catch {
        posts = [{ ...post, preview: true, lang: "en" }, ...posts];
        renderPosts();
        status.textContent = "Preview only: this copy of the site isn't connected yet, so the post wasn't translated or saved. On the live site it's translated to English and shared with everyone.";
      } finally {
        btn.disabled = false;
      }
    });

    renderPosts();
    fetch("/api/board").then(r => (r.ok ? r.json() : null)).then(data => {
      if (data && Array.isArray(data.posts) && data.posts.length) { posts = data.posts; renderPosts(); }
    }).catch(() => { /* static preview: keep the examples */ });
  })();

  // =========================================================
  // 6. "Living wall" preview — lines appear as people meet
  // =========================================================
  (function wall() {
    const cv = $("#wall");
    if (!cv) return;
    let ctx, w, h, pts = [], links = [];
    function build() {
      ({ ctx, w, h } = fitCanvas(cv));
      const rnd = seeded(11);
      pts = Array.from({ length: 46 }, () => ({ x: 0.06 + rnd() * 0.88, y: 0.1 + rnd() * 0.8 }));
      links = [];
      for (let i = 0; i < 70; i++) {
        const a = Math.floor(rnd() * pts.length);
        let b = -1, bd = Infinity;
        pts.forEach((p, j) => { if (j === a) return; const d = Math.hypot(p.x - pts[a].x, p.y - pts[a].y) + rnd() * 0.2; if (d < bd) { bd = d; b = j; } });
        links.push([a, b]);
      }
    }
    function draw(t) {
      const cycle = 14000, k = reduceMotion ? 1 : (t % cycle) / cycle;
      const shown = Math.floor(links.length * Math.min(1, k * 1.25));
      ctx.clearRect(0, 0, w, h);
      for (let i = 0; i < shown; i++) {
        const [a, b] = links[i];
        const fresh = !reduceMotion && i >= shown - 3;
        ctx.strokeStyle = fresh ? "rgba(189,235,250,.95)" : "rgba(31,163,242,.4)";
        ctx.lineWidth = fresh ? 1.4 : 0.8;
        ctx.beginPath(); ctx.moveTo(pts[a].x * w, pts[a].y * h); ctx.lineTo(pts[b].x * w, pts[b].y * h); ctx.stroke();
      }
      pts.forEach(p => { ctx.fillStyle = "rgba(255,255,255,.9)"; ctx.beginPath(); ctx.arc(p.x * w, p.y * h, 1.8, 0, Math.PI * 2); ctx.fill(); });
      ctx.fillStyle = "rgba(189,235,250,.95)"; ctx.font = "500 12px Rubik, sans-serif"; ctx.textAlign = "right";
      ctx.fillText(`${shown} new connections today`, w - 14, h - 14);
    }
    build();
    draw(9000); // a resting frame before it scrolls into view
    addEventListener("resize", () => { build(); draw(9000); });
    if (!reduceMotion) animateWhenVisible(cv, draw);
  })();
})();
