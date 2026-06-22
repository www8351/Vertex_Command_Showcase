import { create } from "zustand";

type AccountStatus = "healthy" | "risk" | "breached";

interface TelemetryState {
  drawdownRisk: number;
  dailyPnL: number;
  status: AccountStatus;
  updateTelemetry: (data: Partial<Omit<TelemetryState, "updateTelemetry">>) => void;
}

export const useTelemetryStore = create<TelemetryState>((set) => ({
  drawdownRisk: 0,
  dailyPnL: 0,
  status: "healthy",
  updateTelemetry: (data) => set((state) => ({ ...state, ...data })),
}));
