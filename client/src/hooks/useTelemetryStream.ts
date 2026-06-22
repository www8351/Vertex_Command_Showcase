import { useEffect, useRef } from "react";
import { useTelemetryStore } from "@/stores/telemetryStore";
import { apiUrl } from "@/lib/apiBase";

const SSE_ENDPOINT = "/api/v1/trading/stream";
const RECONNECT_DELAY_MS = 3000;

export function useTelemetryStream() {
  const updateTelemetry = useTelemetryStore((state) => state.updateTelemetry);
  const eventSourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    let reconnectTimeout: ReturnType<typeof setTimeout>;

    const connect = () => {
      const es = new EventSource(apiUrl(SSE_ENDPOINT), { withCredentials: true });
      eventSourceRef.current = es;

      es.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data) as Record<string, unknown>;

          if (payload.type === "equityUpdate") {
            const risk = Number(payload.riskPercent);
            const pnl = Number(payload.dailyPnL);
            const status = payload.status as "healthy" | "risk" | "breached" | undefined;

            updateTelemetry({
              ...(Number.isFinite(risk) ? { drawdownRisk: risk } : {}),
              ...(Number.isFinite(pnl) ? { dailyPnL: pnl } : {}),
              ...(status ? { status } : {}),
            });
          }
        } catch (err) {
          console.error("SSE Payload Parse Error:", err);
        }
      };

      es.onerror = () => {
        console.warn("SSE Connection lost. Reconnecting...");
        es.close();
        reconnectTimeout = setTimeout(connect, RECONNECT_DELAY_MS);
      };
    };

    connect();

    return () => {
      clearTimeout(reconnectTimeout);
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
      }
    };
  }, [updateTelemetry]);
}
