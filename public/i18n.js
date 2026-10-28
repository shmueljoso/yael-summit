/*
 * The site in eight languages.
 *
 * Screens are written in English in app.js. This module translates them as they appear: a
 * MutationObserver swaps every text node and placeholder/aria-label/title/alt whose English text is
 * in the language's dictionary (public/i18n/<lang>.js, loaded only for that language).
 * Strings with values in them go through t("…{name}…", { name }) in app.js instead.
 * What members write (posts, replies, messages, bios, notes) is marked translate="no" and never touched;
 * the server translates it with the AI and sends it in the reader's language.
 *
 * Which language: the one chosen on this device → the account's → the phone's → the country's → English.
 */
export const LANGS = {
  en: "English", es: "Español", fr: "Français", ru: "Русский", he: "עברית", de: "Deutsch", pt: "Português", uk: "Українська",
};
// Names of languages a post can be translated from, in the reader's language.
const LANG_NAMES = {
  en: { en: "English", es: "Spanish", fr: "French", ru: "Russian", he: "Hebrew", de: "German", pt: "Portuguese", uk: "Ukrainian", it: "Italian", hu: "Hungarian", ar: "Arabic", nl: "Dutch" },
  es: { en: "inglés", es: "español", fr: "francés", ru: "ruso", he: "hebreo", de: "alemán", pt: "portugués", uk: "ucraniano", it: "italiano", hu: "húngaro", ar: "árabe", nl: "neerlandés" },
  fr: { en: "anglais", es: "espagnol", fr: "français", ru: "russe", he: "hébreu", de: "allemand", pt: "portugais", uk: "ukrainien", it: "italien", hu: "hongrois", ar: "arabe", nl: "néerlandais" },
  ru: { en: "английского", es: "испанского", fr: "французского", ru: "русского", he: "иврита", de: "немецкого", pt: "португальского", uk: "украинского", it: "итальянского", hu: "венгерского", ar: "арабского", nl: "нидерландского" },
  he: { en: "אנגלית", es: "ספרדית", fr: "צרפתית", ru: "רוסית", he: "עברית", de: "גרמנית", pt: "פורטוגזית", uk: "אוקראינית", it: "איטלקית", hu: "הונגרית", ar: "ערבית", nl: "הולנדית" },
  de: { en: "Englisch", es: "Spanisch", fr: "Französisch", ru: "Russisch", he: "Hebräisch", de: "Deutsch", pt: "Portugiesisch", uk: "Ukrainisch", it: "Italienisch", hu: "Ungarisch", ar: "Arabisch", nl: "Niederländisch" },
  pt: { en: "inglês", es: "espanhol", fr: "francês", ru: "russo", he: "hebraico", de: "alemão", pt: "português", uk: "ucraniano", it: "italiano", hu: "húngaro", ar: "árabe", nl: "neerlandês" },
  uk: { en: "англійської", es: "іспанської", fr: "французької", ru: "російської", he: "івриту", de: "німецької", pt: "португальської", uk: "української", it: "італійської", hu: "угорської", ar: "арабської", nl: "нідерландської" },
};
// Countries whose principals most likely read one of our languages (when the phone's language isn't one).
const BY_COUNTRY = {
  es: "ES MX AR CL CO PE UY VE PA CR EC BO PY GT DO CU SV HN NI PR",
  fr: "FR BE MC LU MA TN DZ SN CI",
  ru: "RU BY KZ KG UZ AZ AM GE MD TJ TM",
  uk: "UA",
  he: "IL",
  de: "DE AT CH LI",
  pt: "BR PT AO MZ",
};

const read = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k, v) => { try { localStorage.setItem(k, v); } catch { /* storage unavailable */ } };
const known = (l) => (l && LANGS[l] ? l : null);
const fromPhone = () => { for (const l of navigator.languages || [navigator.language]) { const k = known(String(l).slice(0, 2).toLowerCase()); if (k) return k; } return null; };

/** True when someone picked the language on this device (it then wins over the account's). */
export const chosenHere = () => !!known(read("lang"));
export let LANG = known(read("lang")) || known(read("langAuto")) || fromPhone() || "en";
let dict = {};

const norm = (s) => s.replace(/\s+/g, " ").trim();

/** A UI string in the current language, with {placeholders} filled in. */
export function t(key, vars = {}) {
  const s = dict[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? "");
}
/** For dates and numbers. */
export const locale = () => ({ en: undefined, pt: "pt-BR" }[LANG] ?? LANG);
/** The name of a language (a post's original language), for "Translated from …". */
export const langName = (code) => LANG_NAMES[LANG][code] || LANG_NAMES.en[code] || null;

// ---------- translating the page as it's drawn ----------
const ATTRS = ["placeholder", "aria-label", "title", "alt"];
function text(node) {
  const v = node.nodeValue, k = norm(v);
  if (!k || !/\p{L}/u.test(k)) return;
  const tr = dict[k];
  if (tr !== undefined && tr !== k) node.nodeValue = v.match(/^\s*/)[0] + tr + v.match(/\s*$/)[0];
}
function attrs(el) {
  for (const a of ATTRS) {
    const v = el.getAttribute(a);
    if (v) { const tr = dict[norm(v)]; if (tr !== undefined && tr !== v) el.setAttribute(a, tr); }
  }
}
// What members write is never touched; form fields keep what was typed but get their placeholder translated.
const noText = (el) => !el || el.closest('[translate="no"], script, style, textarea');
const noAttrs = (el) => el.closest('[translate="no"]');
function walk(root) {
  if (root.nodeType === 3) { if (!noText(root.parentElement)) text(root); return; }
  if (root.nodeType !== 1 || noAttrs(root)) return;
  attrs(root);
  if (noText(root)) return;
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, {
    acceptNode: (n) => {
      if (n.nodeType !== 1) return NodeFilter.FILTER_ACCEPT;
      if (n.getAttribute("translate") === "no") return NodeFilter.FILTER_REJECT;
      if (/^(SCRIPT|STYLE|TEXTAREA)$/.test(n.tagName)) { attrs(n); return NodeFilter.FILTER_REJECT; }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  for (let n = w.nextNode(); n; n = w.nextNode()) { if (n.nodeType === 3) text(n); else attrs(n); }
}

function start() {
  const html = document.documentElement;
  html.lang = LANG; html.dir = LANG === "he" ? "rtl" : "ltr";
  if (LANG === "en") return;
  // Hebrew and Cyrillic letters, in fonts that sit well next to the site's own.
  const fonts = { he: "hebrew", ru: "cyrillic", uk: "cyrillic" }[LANG];
  if (fonts) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = `fonts/${fonts}.css`; document.head.appendChild(l); }
  walk(document.body);
  new MutationObserver((list) => {
    for (const m of list) {
      if (m.type === "childList") m.addedNodes.forEach(walk);
      else if (m.type === "characterData") { if (!noText(m.target.parentElement)) text(m.target); }
      else if (!noAttrs(m.target)) attrs(m.target);
    }
  }).observe(document.body, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

/** Loads the dictionary and starts translating. Resolves once the page can be drawn. */
export const ready = (async () => {
  if (!known(read("lang")) && !known(read("langAuto")) && !fromPhone()) {
    // The phone speaks none of our languages: guess from the country, once, without delaying the page much.
    try {
      const ctl = new AbortController(); setTimeout(() => ctl.abort(), 1500);
      const { country } = await (await fetch("/api/geo", { signal: ctl.signal })).json();
      const l = Object.keys(BY_COUNTRY).find((k) => BY_COUNTRY[k].split(" ").includes(country));
      write("langAuto", l || "en");
      if (l) LANG = l;
    } catch { /* stay in English */ }
  }
  if (LANG !== "en") {
    try { dict = (await import(`./i18n/${LANG}.js`)).default; } catch { dict = {}; }
  }
  start();
})();

/** Switches language: remembered on this device (and on the account by the caller), then the page reloads in it. */
export function setLang(l) {
  if (!known(l)) return;
  write("lang", l);
  location.reload();
}
/** Adopts the account's language on a new device. */
export function adopt(l) {
  if (!known(l) || l === LANG) return false;
  write("langAuto", l);
  location.reload();
  return true;
}
