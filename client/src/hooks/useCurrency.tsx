import { createContext, useContext, useState, useCallback, type ReactNode } from "react";

type PnlDisplayMode = "usd" | "eur" | "pct";

interface CurrencyContextValue {
  pnlDisplayMode: PnlDisplayMode;
  cyclePnlMode: () => void;
  formatCurrency: (val: number, compact?: boolean) => string;
  formatPnl: (profit: number, size: number) => string;
}

const CurrencyContext = createContext<CurrencyContextValue | null>(null);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [pnlDisplayMode, setPnlDisplayMode] = useState<PnlDisplayMode>(() => {
    return (localStorage.getItem("vertex_pnl_mode") as PnlDisplayMode) || "usd";
  });

  const cyclePnlMode = useCallback(() => {
    setPnlDisplayMode((prev) => {
      const next = prev === "usd" ? "eur" : prev === "eur" ? "pct" : "usd";
      localStorage.setItem("vertex_pnl_mode", next);
      return next;
    });
  }, []);

  const formatCurrency = useCallback(
    (val: number, compact = false) => {
      if (compact && Math.abs(val) >= 1000)
        return (val / 1000).toFixed(1) + "k";
      if (pnlDisplayMode === "eur") {
        return new Intl.NumberFormat("de-DE", {
          style: "currency",
          currency: "EUR",
          maximumFractionDigits: 0,
        }).format(val * 0.92);
      }
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: "USD",
        maximumFractionDigits: 0,
      }).format(val);
    },
    [pnlDisplayMode],
  );

  const formatPnl = useCallback(
    (profit: number, size: number) => {
      if (pnlDisplayMode === "pct") {
        const pct = size > 0 ? (profit / size) * 100 : 0;
        return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
      }
      return formatCurrency(profit);
    },
    [pnlDisplayMode, formatCurrency],
  );

  return (
    <CurrencyContext.Provider
      value={{ pnlDisplayMode, cyclePnlMode, formatCurrency, formatPnl }}
    >
      {children}
    </CurrencyContext.Provider>
  );
}

export function useCurrency() {
  const ctx = useContext(CurrencyContext);
  if (!ctx)
    throw new Error("useCurrency must be used within a CurrencyProvider");
  return ctx;
}
