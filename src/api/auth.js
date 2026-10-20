/** Sign up, sign in, sign out. Principals register with their full name. */
import { json, error, clip, readJson, randomId, limited } from "../lib/http.js";
import { db, full, hashPassword, startSession, endSessionCookie } from "../lib/db.js";
import { sha256 } from "../lib/http.js";
import { sendMail, mailOn, siteUrl } from "../lib/mail.js";
import { okLang, LANGS } from "../lib/translate.js";
import { tr } from "../lib/i18n.js";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function signup({ request, env }) {
  const ip = request.headers.get("cf-connecting-ip") || "local";
  if (await limited(env, `signup:${ip}`, 5)) return error(429, "slow_down", "Too many attempts. Try again in a minute.");

  const b = await readJson(request);
  const full_name = clip(b.full_name, 80);
  const email = clip(b.email, 120).toLowerCase();
  const password = String(b.password || "");

  if (env.SIGNUP_CODE && String(b.code || "").trim() !== env.SIGNUP_CODE) {
    return error(403, "bad_code", "That access code isn't right. Check the invitation from the Yael Foundation.");
  }
  if (full_name.split(" ").filter(Boolean).length < 2) return error(400, "full_name", "Please enter your full name (first and last).");
  if (!EMAIL.test(email)) return error(400, "email", "Please enter a valid email address.");
  if (password.length < 8) return error(400, "password", "Use a password of at least 8 characters.");
  if (b.agree !== true && b.agree !== "on") return error(400, "agree", "Please agree to the privacy policy and terms to join.");

  const d = await db(env);
  if (await d.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first()) {
    return error(409, "email_taken", "An account with this email already exists. Sign in instead.");
  }
  const id = randomId(8);
  const salt = randomId(16);
  const pass_hash = await hashPassword(password, salt);
  await d.prepare(
    "INSERT INTO users (id, email, pass_hash, salt, full_name, created_at, consented_at, lang) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).bind(id, email, pass_hash, salt, full_name, Date.now(), Date.now(), LANGS.includes(b.lang) ? b.lang : "").run();

  const cookie = await startSession(env, id, request);
  const u = await d.prepare("SELECT * FROM users WHERE id = ?").bind(id).first();
  return json({ me: full(u) }, 201, { "set-cookie": cookie });
}

export async function login({ request, env }) {
  const ip = request.headers.get("cf-connecting-ip") || "local";
  if (await limited(env, `login:${ip}`, 10)) return error(429, "slow_down", "Too many attempts. Try again in a minute.");

  const b = await readJson(request);
  const email = clip(b.email, 120).toLowerCase();
  const d = await db(env);
  const u = await d.prepare("SELECT * FROM users WHERE email = ?").bind(email).first();
  if (!u || (await hashPassword(String(b.password || ""), u.salt)) !== u.pass_hash) {
    return error(401, "bad_login", "Email or password is incorrect.");
  }
  const cookie = await startSession(env, u.id, request);
  return json({ me: full(u) }, 200, { "set-cookie": cookie });
}

export async function logout({ request, env }) {
  const token = (request.headers.get("cookie") || "").match(/(?:^|;\s*)ys=([^;]+)/)?.[1];
  if (token && env.DB) await (await db(env)).prepare("DELETE FROM sessions WHERE token = ?").bind(token).run();
  return json({ ok: true }, 200, { "set-cookie": endSessionCookie });
}

const RESET_TTL = 60 * 60 * 1000; // one hour

/** POST /api/auth/forgot { email } — emails a one-hour link to choose a new password. Never says whether the email exists. */
export async function forgot({ request, env, waitUntil }) {
  const ip = request.headers.get("cf-connecting-ip") || "local";
  if (await limited(env, `forgot:${ip}`, 5)) return error(429, "slow_down", "Too many attempts. Try again in a minute.");
  if (!mailOn(env)) return error(503, "mail_not_configured", "Password reset by email isn't available yet. Contact the Yael Foundation team.");
  const b = await readJson(request);
  const email = clip(b.email, 120).toLowerCase();
  if (!EMAIL.test(email)) return error(400, "email", "Please enter a valid email address.");
  const d = await db(env);
  const u = await d.prepare("SELECT id, full_name, email, lang FROM users WHERE email = ?").bind(email).first();
  if (u && !(await limited(env, `forgot:${email}`, 3))) {
    const token = randomId(32);
    await d.batch([
      d.prepare("DELETE FROM password_resets WHERE user_id = ? OR expires < ?").bind(u.id, Date.now()),
      d.prepare("INSERT INTO password_resets (token_hash, user_id, expires) VALUES (?, ?, ?)").bind(await sha256(token), u.id, Date.now() + RESET_TTL),
    ]);
    const lang = okLang(u.lang);
    waitUntil(sendMail(env, {
      to: u.email, subject: tr(lang, "reset_subject"), heading: tr(lang, "reset_subject"), lang,
      lines: [tr(lang, "reset_l1", { first: u.full_name.split(" ")[0] }), tr(lang, "reset_l2")],
      button: tr(lang, "reset_subject"), url: siteUrl(request, `#/reset/${token}`),
    }));
  }
  return json({ ok: true });
}

/** POST /api/auth/reset { token, password } — sets the new password, signs out every other device, signs in here. */
export async function reset({ request, env }) {
  const ip = request.headers.get("cf-connecting-ip") || "local";
  if (await limited(env, `reset:${ip}`, 10)) return error(429, "slow_down", "Too many attempts. Try again in a minute.");
  const b = await readJson(request);
  const password = String(b.password || "");
  if (password.length < 8) return error(400, "password", "Use a password of at least 8 characters.");
  const d = await db(env);
  const hash = await sha256(String(b.token || ""));
  const row = await d.prepare("SELECT * FROM password_resets WHERE token_hash = ?").bind(hash).first();
  if (!row || row.expires < Date.now()) return error(400, "bad_token", "This link has expired or was already used. Ask for a new one.");
  const salt = randomId(16);
  await d.batch([
    d.prepare("UPDATE users SET pass_hash = ?, salt = ? WHERE id = ?").bind(await hashPassword(password, salt), salt, row.user_id),
    d.prepare("DELETE FROM password_resets WHERE user_id = ?").bind(row.user_id),
    d.prepare("DELETE FROM sessions WHERE user_id = ?").bind(row.user_id),
  ]);
  const cookie = await startSession(env, row.user_id, request);
  const u = await d.prepare("SELECT * FROM users WHERE id = ?").bind(row.user_id).first();
  return json({ me: full(u) }, 200, { "set-cookie": cookie });
}
