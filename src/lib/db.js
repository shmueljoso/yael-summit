/**
 * Data layer on Cloudflare D1 (SQLite). Tables are created on first use, so a fresh
 * database needs no migration step.
 */
import { error, getCookie, randomId } from "./http.js";
import { hasDemo, seedDemo, removeDemo } from "./demo.js";

export const TOPICS = {
  identity: "Jewish identity",
  israel: "Israel education",
  hebrew: "Hebrew language",
  studies: "Jewish studies curriculum",
  community: "Parents & community",
  enrollment: "Enrollment & affordability",
  staff: "Staff recruitment & retention",
  wellbeing: "Student wellbeing",
  security: "Security & antisemitism",
  innovation: "Innovation & technology",
  leadership: "Leadership & governance",
  fundraising: "Fundraising & development",
};
export const LEVELS = {
  early: "Early childhood", elem: "Elementary", mid: "Middle school", high: "High school",
  k12: "K–12 school", supp: "Supplementary school", other: "Other",
};
export const LINK_KINDS = ["linkedin", "facebook", "instagram", "x", "website"];

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, pass_hash TEXT NOT NULL, salt TEXT NOT NULL,
    full_name TEXT NOT NULL, role_title TEXT DEFAULT '', school TEXT DEFAULT '', city TEXT DEFAULT '', country TEXT DEFAULT '',
    level TEXT DEFAULT '', bio TEXT DEFAULT '', topics TEXT DEFAULT '[]', gives TEXT DEFAULT '[]', seeks TEXT DEFAULT '[]',
    links TEXT DEFAULT '{}', phone TEXT DEFAULT '', avatar INTEGER DEFAULT 0, created_at INTEGER NOT NULL, seen_at INTEGER DEFAULT 0)`,
  `CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL, expires INTEGER NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS connections (
    a TEXT NOT NULL, b TEXT NOT NULL, status TEXT NOT NULL, requested_by TEXT NOT NULL, note TEXT DEFAULT '',
    created_at INTEGER NOT NULL, accepted_at INTEGER, PRIMARY KEY (a, b))`,
  `CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT, pair TEXT NOT NULL, from_id TEXT NOT NULL, to_id TEXT NOT NULL,
    body TEXT NOT NULL, created_at INTEGER NOT NULL, read_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS messages_pair ON messages (pair, id)`,
  `CREATE INDEX IF NOT EXISTS messages_to ON messages (to_id, read_at)`,
  `CREATE TABLE IF NOT EXISTS posts (
    id TEXT PRIMARY KEY, user_id TEXT NOT NULL, kind TEXT NOT NULL, text TEXT NOT NULL, original TEXT,
    lang TEXT DEFAULT 'en', created_at INTEGER NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS posts_time ON posts (created_at)`,
];

// Columns added after launch. ALTER fails harmlessly when the column already exists.
const MIGRATIONS = [
  "ALTER TABLE users ADD COLUMN is_demo INTEGER DEFAULT 0",
  "ALTER TABLE users ADD COLUMN lat REAL",
  "ALTER TABLE users ADD COLUMN lng REAL",
];

async function prepare(env) {
  const d = env.DB;
  await d.batch(SCHEMA.map((q) => d.prepare(q)));
  for (const q of MIGRATIONS) { try { await d.prepare(q).run(); } catch { /* already applied */ } }
  // Sample content: DEMO_DATA "on" keeps it, "off" removes it (see demo.js).
  const demo = String(env.DEMO_DATA || "off").toLowerCase() === "on";
  const present = await hasDemo(d);
  if (demo && !present) await seedDemo(d);
  if (!demo && present) await removeDemo(d);
}

let ready = null;
export function db(env) {
  if (!env.DB) throw Object.assign(new Error("db_not_configured"), { status: 503 });
  ready ??= prepare(env).catch((e) => { ready = null; throw e; });
  return ready.then(() => env.DB);
}

export const demoOn = (env) => String(env.DEMO_DATA || "off").toLowerCase() === "on";

/** Canonical key for a pair of users, so each connection or conversation has one row. */
export const pairOf = (x, y) => (x < y ? [x, y] : [y, x]);
export const pairKey = (x, y) => pairOf(x, y).join("|");

const parse = (s, fallback) => { try { return JSON.parse(s); } catch { return fallback; } };

/** What any signed-in principal can see. */
export function card(u) {
  return {
    id: u.id, full_name: u.full_name, role_title: u.role_title, school: u.school, city: u.city, country: u.country,
    level: u.level, bio: u.bio, topics: parse(u.topics, []), gives: parse(u.gives, []), seeks: parse(u.seeks, []),
    avatar: u.avatar ? `/api/avatar/${u.id}?v=${u.avatar}` : null,
    ...(u.is_demo ? { sample: true } : {}),
  };
}
/** Adds contact details: only for yourself and for accepted connections. */
export function full(u) {
  return { ...card(u), email: u.email, phone: u.phone, links: parse(u.links, {}) };
}

// ---------- passwords & sessions ----------
const ITER = 100000; // Workers' PBKDF2 limit
export async function hashPassword(password, saltHex) {
  const salt = Uint8Array.from(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: ITER }, key, 256);
  return [...new Uint8Array(bits)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

const SESSION_DAYS = 60;
export async function startSession(env, userId, request) {
  const token = randomId(32);
  const expires = Date.now() + SESSION_DAYS * 864e5;
  await (await db(env)).prepare("INSERT INTO sessions (token, user_id, expires) VALUES (?, ?, ?)").bind(token, userId, expires).run();
  const secure = new URL(request.url).protocol === "https:" ? "; Secure" : "";
  return `ys=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure}`;
}
export const endSessionCookie = "ys=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0";

/** Returns the signed-in user row, or null. */
export async function currentUser(env, request) {
  const token = getCookie(request, "ys");
  if (!token) return null;
  const d = await db(env);
  const u = await d.prepare(
    "SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token = ? AND s.expires > ?"
  ).bind(token, Date.now()).first();
  if (u && Date.now() - (u.seen_at || 0) > 5 * 60e3) {
    await d.prepare("UPDATE users SET seen_at = ? WHERE id = ?").bind(Date.now(), u.id).run();
  }
  return u || null;
}

export async function requireUser(env, request) {
  const u = await currentUser(env, request);
  if (!u) throw Object.assign(new Error("signin_required"), { status: 401 });
  return u;
}

/** Connection row between two users, or null. */
export async function connectionBetween(d, x, y) {
  const [a, b] = pairOf(x, y);
  return d.prepare("SELECT * FROM connections WHERE a = ? AND b = ?").bind(a, b).first();
}

export { error };
