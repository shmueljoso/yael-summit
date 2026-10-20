/**
 * Everyone reads the network in their own language.
 * Posts, replies and messages are translated once, when written, in a single Gemini call per
 * item, and stored in the translations table. Reading is free: no AI on the way out.
 */
import { gemini } from "./gemini.js";

export const LANGS = ["en", "es", "fr", "ru", "he", "de", "pt", "uk"];
export const LANG_NAMES = { en: "English", es: "Spanish", fr: "French", ru: "Russian", he: "Hebrew", de: "German", pt: "Portuguese", uk: "Ukrainian" };
export const okLang = (l) => (LANGS.includes(l) ? l : "en");

const SYSTEM = [
  "You translate short texts written by principals of Jewish schools for an international network.",
  "Detect the language of the text (ISO 639-1 code). Translate it faithfully into each requested language, keeping tone and meaning:",
  "do not add, summarize or censor. Keep names, school names and Jewish terms readers know (Shabbat, Kabbalat Shabbat, chesed, tikkun olam).",
  "Hebrew uses Hebrew script; Russian and Ukrainian use Cyrillic. Skip the text's own language.",
  'Return JSON only: {"lang":string,"t":{"<code>":string}}',
].join(" ");

/**
 * Translates `text` into `targets` and stores the results under `item` (e.g. "p:<post id>").
 * Returns { lang, t } — the detected source language and the translations — or null if the AI is unavailable.
 */
export async function translate(env, d, item, text, targets = LANGS) {
  if (!env.GEMINI_API_KEY || !text) return null;
  try {
    const want = targets.filter((l) => LANGS.includes(l));
    const { data } = await gemini(env, {
      system: SYSTEM,
      text: `Languages: ${want.map((l) => `${l} (${LANG_NAMES[l]})`).join(", ")}\n\nText:\n${text}`,
      maxOutputTokens: Math.min(8000, 300 + Math.ceil(text.length / 2.5) * want.length),
      temperature: 0.2,
    });
    const lang = String(data?.lang || "").toLowerCase().slice(0, 5) || "und";
    const t = {};
    for (const l of want) if (l !== lang && typeof data?.t?.[l] === "string" && data.t[l].trim()) t[l] = data.t[l].trim().slice(0, 3000);
    const rows = Object.entries(t);
    if (rows.length) {
      await d.batch(rows.map(([l, s]) => d.prepare(
        "INSERT INTO translations (item, lang, text) VALUES (?, ?, ?) ON CONFLICT(item, lang) DO UPDATE SET text = excluded.text"
      ).bind(item, l, s)));
    }
    return { lang, t };
  } catch {
    return null;
  }
}

/** Stored translations for these items in one language: Map item → text. */
export async function stored(d, items, lang) {
  const out = new Map();
  for (let i = 0; i < items.length; i += 90) {
    const chunk = items.slice(i, i + 90);
    if (!chunk.length) continue;
    const { results } = await d.prepare(`SELECT item, text FROM translations WHERE lang = ? AND item IN (${chunk.map(() => "?").join(",")})`).bind(lang, ...chunk).all();
    for (const r of results) out.set(r.item, r.text);
  }
  return out;
}

/**
 * What one reader sees of a stored post or reply: their language, with the original for "Show original".
 *   row: { text (English), original (as written, if not English), lang (its language, "und" if not yet known) }
 *   trText: the stored translation into the reader's language, if any.
 * missing: true when the reader should have a translation that isn't there yet (it's then made in the background).
 */
export function view(row, trText, reader) {
  const src = row.original ?? row.text;
  if (row.lang === reader) return { text: src, original: null, lang: row.lang, missing: false };
  if (reader === "en") return { text: row.text, original: row.original, lang: row.lang, missing: row.lang === "und" };
  if (trText) return { text: trText, original: src, lang: row.lang, missing: false };
  return { text: row.text, original: row.original, lang: row.lang, missing: true }; // English for now
}
