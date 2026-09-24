/** Sign up, sign in, sign out. Principals register with their full name. */
import { json, error, clip, readJson, randomId, limited } from "../lib/http.js";
import { db, full, hashPassword, startSession, endSessionCookie } from "../lib/db.js";

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

  const d = await db(env);
  if (await d.prepare("SELECT 1 FROM users WHERE email = ?").bind(email).first()) {
    return error(409, "email_taken", "An account with this email already exists. Sign in instead.");
  }
  const id = randomId(8);
  const salt = randomId(16);
  const pass_hash = await hashPassword(password, salt);
  await d.prepare(
    "INSERT INTO users (id, email, pass_hash, salt, full_name, created_at) VALUES (?, ?, ?, ?, ?, ?)"
  ).bind(id, email, pass_hash, salt, full_name, Date.now()).run();

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
