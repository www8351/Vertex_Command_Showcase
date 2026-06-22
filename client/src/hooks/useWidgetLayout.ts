import { useState, useCallback } from "react";

export type WidgetId = "kpi" | "pnlChart" | "firmDistribution" | "calendar" | "economicCalendar" | "accounts";

export const LOCKED_WIDGETS: WidgetId[] = ["kpi", "accounts"];

export interface WidgetConfig {
  id: WidgetId;
  visible: boolean;
}

const DEFAULT_LAYOUT: WidgetConfig[] = [
  { id: "pnlChart", visible: true },
  { id: "firmDistribution", visible: true },
  { id: "calendar", visible: true },
  { id: "economicCalendar", visible: true },
];

const STORAGE_KEY = "vertex_widget_layout";

function loadLayout(): WidgetConfig[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) return DEFAULT_LAYOUT;
    const parsed = JSON.parse(stored) as WidgetConfig[];
    const knownIds = new Set(DEFAULT_LAYOUT.map((w) => w.id));
    const storedIds = new Set(parsed.map((w) => w.id));
    const missing = DEFAULT_LAYOUT.filter((w) => !storedIds.has(w.id));
    const valid = parsed.filter((w) => knownIds.has(w.id) && !LOCKED_WIDGETS.includes(w.id));
    return [...valid, ...missing];
  } catch {
    return DEFAULT_LAYOUT;
  }
}

function saveLayout(layout: WidgetConfig[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(layout));
}

export function useWidgetLayout() {
  const [widgets, setWidgets] = useState<WidgetConfig[]>(loadLayout);
  const [isCustomizing, setIsCustomizing] = useState(false);

  const reorder = useCallback((activeId: string, overId: string) => {
    setWidgets((prev) => {
      const oldIndex = prev.findIndex((w) => w.id === activeId);
      const newIndex = prev.findIndex((w) => w.id === overId);
      if (oldIndex === -1 || newIndex === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(oldIndex, 1);
      next.splice(newIndex, 0, moved);
      saveLayout(next);
      return next;
    });
  }, []);

  const toggleVisibility = useCallback((id: WidgetId) => {
    setWidgets((prev) => {
      const next = prev.map((w) =>
        w.id === id ? { ...w, visible: !w.visible } : w,
      );
      saveLayout(next);
      return next;
    });
  }, []);

  const resetLayout = useCallback(() => {
    setWidgets(DEFAULT_LAYOUT);
    saveLayout(DEFAULT_LAYOUT);
  }, []);

  return {
    widgets,
    isCustomizing,
    setIsCustomizing,
    reorder,
    toggleVisibility,
    resetLayout,
  };
}
