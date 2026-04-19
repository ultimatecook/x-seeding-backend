import { createContext, useContext, useState, useEffect } from 'react';
import en from '../locales/en.json';
import es from '../locales/es.json';

const TRANSLATIONS = { en, es };
export const SUPPORTED_LANGS = ['en', 'es'];
export const LANG_LABELS = { en: 'EN', es: 'ES' };
const STORAGE_KEY = 'portal-lang';

const I18nContext = createContext({
  t:          (key) => key,
  lang:       'en',
  changeLang: () => {},
});

/**
 * Resolves a dot-notation key against a dictionary.
 * Returns undefined if not found.
 */
function resolve(dict, key) {
  const parts = key.split('.');
  let node = dict;
  for (const part of parts) {
    if (node == null || typeof node !== 'object') return undefined;
    node = node[part];
  }
  return typeof node === 'string' ? node : undefined;
}

/**
 * Provider — wraps the portal layout.
 * Reads saved language from localStorage on mount (client-only).
 * Falls back to English for SSR and as a safety net.
 */
export function I18nProvider({ children }) {
  const [lang, setLang] = useState('en'); // SSR-safe default

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && SUPPORTED_LANGS.includes(saved) && saved !== 'en') {
        setLang(saved);
      }
    } catch {}
  }, []);

  function changeLang(newLang) {
    if (!SUPPORTED_LANGS.includes(newLang)) return;
    setLang(newLang);
    try { localStorage.setItem(STORAGE_KEY, newLang); } catch {}
  }

  /**
   * t(key, vars?)
   *  - key:  dot-notation string, e.g. 'dashboard.title'
   *  - vars: optional object for {placeholder} substitution
   *
   * Resolution order:
   *  1. Current language dict
   *  2. English fallback
   *  3. The raw key (never crashes)
   */
  function t(key, vars = {}) {
    const dict = TRANSLATIONS[lang] ?? TRANSLATIONS.en;
    let value  = resolve(dict, key);
    if (value === undefined) value = resolve(TRANSLATIONS.en, key);
    if (value === undefined) return key; // last resort

    // Replace {varName} placeholders
    return value.replace(/\{(\w+)\}/g, (_, k) => {
      const v = vars[k];
      return v !== undefined ? String(v) : `{${k}}`;
    });
  }

  return (
    <I18nContext.Provider value={{ t, lang, changeLang }}>
      {children}
    </I18nContext.Provider>
  );
}

/** Hook — returns { t, lang, changeLang } */
export function useT() {
  return useContext(I18nContext);
}
