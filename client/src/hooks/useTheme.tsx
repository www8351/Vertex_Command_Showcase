import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

export type ThemeMode = "light" | "dark" | "system";

export interface AccentColor {
  name: string;
  hue: number;
  saturation: number;
}

export const ACCENT_PRESETS: AccentColor[] = [
  { name: "indigo", hue: 224, saturation: 76 },
  { name: "blue", hue: 210, saturation: 80 },
  { name: "violet", hue: 270, saturation: 70 },
  { name: "rose", hue: 350, saturation: 75 },
  { name: "orange", hue: 25, saturation: 85 },
  { name: "amber", hue: 40, saturation: 90 },
  { name: "emerald", hue: 155, saturation: 70 },
  { name: "teal", hue: 175, saturation: 65 },
  { name: "cyan", hue: 190, saturation: 80 },
  { name: "red", hue: 0, saturation: 72 },
];

interface ThemeContextValue {
  mode: ThemeMode;
  setMode: (mode: ThemeMode) => void;
  resolvedTheme: "light" | "dark";
  accent: AccentColor;
  setAccent: (accent: AccentColor) => void;
}

const STORAGE_KEY_MODE = "vertex-theme-mode";
const STORAGE_KEY_ACCENT = "vertex-accent";

const ThemeContext = createContext<ThemeContextValue | null>(null);

function getSystemTheme(): "light" | "dark" {
  if (typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches) {
    return "dark";
  }
  return "light";
}

function applyAccentColors(accent: AccentColor) {
  const root = document.documentElement;
  root.style.setProperty("--ring", `${accent.hue} ${accent.saturation}% 48%`);
  root.style.setProperty("--accent-brand", `${accent.hue} ${accent.saturation}% 48%`);
  root.style.setProperty("--accent-brand-light", `${accent.hue} ${accent.saturation}% 58%`);
  root.style.setProperty("--accent-brand-dark", `${accent.hue} ${accent.saturation}% 38%`);
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_MODE);
      if (stored === "light" || stored === "dark" || stored === "system") return stored;
    } catch {}
    return "dark";
  });

  const [accent, setAccentState] = useState<AccentColor>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY_ACCENT);
      if (stored) {
        const parsed = JSON.parse(stored);
        if (parsed.name && typeof parsed.hue === "number") return parsed;
      }
    } catch {}
    return ACCENT_PRESETS[0];
  });

  const [systemPref, setSystemPref] = useState<"light" | "dark">(getSystemTheme);
  const resolvedTheme: "light" | "dark" = mode === "system" ? systemPref : mode;

  useEffect(() => {
    const root = document.documentElement;
    if (resolvedTheme === "dark") {
      root.classList.add("dark");
    } else {
      root.classList.remove("dark");
    }
  }, [resolvedTheme]);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const handler = () => setSystemPref(mq.matches ? "dark" : "light");
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    applyAccentColors(accent);
  }, [accent]);

  const setMode = useCallback((m: ThemeMode) => {
    setModeState(m);
    try { localStorage.setItem(STORAGE_KEY_MODE, m); } catch {}
  }, []);

  const setAccent = useCallback((a: AccentColor) => {
    setAccentState(a);
    try { localStorage.setItem(STORAGE_KEY_ACCENT, JSON.stringify(a)); } catch {}
  }, []);

  return (
    <ThemeContext.Provider value={{ mode, setMode, resolvedTheme, accent, setAccent }}>
      {children}
    </ThemeContext.Provider>
  );
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error("useTheme must be used within ThemeProvider");
  return ctx;
}
