import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import LanguageDetector from "i18next-browser-languagedetector";
import he from "./locales/he.json";
import en from "./locales/en.json";
import ar from "./locales/ar.json";
import es from "./locales/es.json";

const resources = {
  he: { translation: he },
  en: { translation: en },
  ar: { translation: ar },
  es: { translation: es },
};

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: "he",
    detection: {
      order: ["localStorage"],
      lookupLocalStorage: "vertex_lang",
      caches: ["localStorage"],
    },
    interpolation: {
      escapeValue: false,
    },
  });

export const RTL_LANGUAGES = ["he", "ar"];

const LOCALE_MAP: Record<string, string> = {
  he: "he-IL",
  en: "en-US",
  ar: "ar-SA",
  es: "es-ES",
};

export function getDateLocale(lang: string): string {
  const base = lang.split('-')[0].toLowerCase();
  return LOCALE_MAP[base] || lang;
}

export function isRTL(lang: string): boolean {
  const base = lang.split('-')[0].toLowerCase();
  return RTL_LANGUAGES.includes(base);
}

export function applyDirection(lang: string): void {
  const dir = isRTL(lang) ? "rtl" : "ltr";
  document.documentElement.dir = dir;
  document.documentElement.lang = lang;
}

i18n.on("languageChanged", (lng) => {
  applyDirection(lng);
  localStorage.setItem("vertex_lang", lng);
});

applyDirection(i18n.language || "he");

export default i18n;
