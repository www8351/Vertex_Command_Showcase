import { useState, useCallback, useEffect, useRef } from "react";
import { Canvas } from "@react-three/fiber";
import type { RootState } from "@react-three/fiber";
import Scene from "@/components/webgl/Scene";
import { WebGLErrorBoundary } from "@/components/webgl/WebGLErrorBoundary";
import { useTelemetryStream } from "@/hooks/useTelemetryStream";
import { useTelemetryStore } from "@/stores/telemetryStore";
import { MonitorX, RefreshCw, Wifi, WifiOff } from "lucide-react";

function ContextLostFallback({ onRetry }: { onRetry: () => void }) {
  return (
    <div className="h-full w-full flex items-center justify-center bg-[#0a0a0f]">
      <div className="max-w-sm w-full text-center space-y-4 p-8">
        <div className="w-16 h-16 rounded-full bg-amber-500/10 border border-amber-500/20 flex items-center justify-center mx-auto">
          <MonitorX className="w-8 h-8 text-amber-400" />
        </div>
        <h2 className="text-lg font-bold text-white">Graphics Context Lost</h2>
        <p className="text-sm text-zinc-400 leading-relaxed">
          The WebGL rendering context was lost. This can happen due to GPU resource limits or a driver reset.
        </p>
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition-colors"
          data-testid="button-webgl-context-retry"
        >
          <RefreshCw className="w-4 h-4" />
          Retry
        </button>
      </div>
    </div>
  );
}

function TelemetryHUD() {
  const drawdownRisk = useTelemetryStore((s) => s.drawdownRisk);
  const dailyPnL = useTelemetryStore((s) => s.dailyPnL);
  const status = useTelemetryStore((s) => s.status);

  const riskPct = (drawdownRisk * 100).toFixed(1);
  const riskColor =
    drawdownRisk > 0.7
      ? "text-red-400"
      : drawdownRisk > 0.4
        ? "text-amber-400"
        : "text-emerald-400";

  const pnlColor = dailyPnL >= 0 ? "text-emerald-400" : "text-red-400";

  const statusIcon = status === "breached" ? WifiOff : Wifi;
  const StatusIcon = statusIcon;
  const statusColor =
    status === "breached"
      ? "text-red-400"
      : status === "risk"
        ? "text-amber-400"
        : "text-emerald-400";

  return (
    <div
      className="absolute top-4 left-4 z-10 bg-black/60 backdrop-blur-sm border border-white/10 rounded-xl p-4 space-y-2 min-w-[200px] pointer-events-none select-none"
      data-testid="hud-telemetry"
    >
      <div className="flex items-center gap-2 text-xs">
        <StatusIcon className={`w-3.5 h-3.5 ${statusColor}`} />
        <span className={statusColor}>
          {status.toUpperCase()}
        </span>
      </div>

      <div className="border-t border-white/5 pt-2 space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className="text-zinc-500">Drawdown Risk</span>
          <span className={riskColor} data-testid="text-drawdown-risk">
            {riskPct}%
          </span>
        </div>
        <div className="flex justify-between text-xs">
          <span className="text-zinc-500">Daily P&L</span>
          <span className={pnlColor} data-testid="text-daily-pnl">
            ${dailyPnL.toFixed(2)}
          </span>
        </div>
      </div>
    </div>
  );
}

export default function WebGL3D() {
  const [canvasKey, setCanvasKey] = useState(0);
  const [contextLost, setContextLost] = useState(false);
  const canvasElRef = useRef<HTMLCanvasElement | null>(null);
  const listenerRef = useRef<((e: Event) => void) | null>(null);

  useTelemetryStream();

  const handleRetry = useCallback(() => {
    setContextLost(false);
    setCanvasKey((k) => k + 1);
  }, []);

  const handleCreated = useCallback((state: RootState) => {
    state.gl.setClearColor("#0a0a0f");

    const canvas = state.gl.domElement;
    canvasElRef.current = canvas;

    const onLost = (e: Event): void => {
      e.preventDefault();
      setContextLost(true);
    };
    listenerRef.current = onLost;

    canvas.addEventListener("webglcontextlost", onLost);
  }, []);

  useEffect(() => {
    return () => {
      const canvas = canvasElRef.current;
      const listener = listenerRef.current;
      if (canvas && listener) {
        canvas.removeEventListener("webglcontextlost", listener);
      }
      canvasElRef.current = null;
      listenerRef.current = null;
    };
  }, [canvasKey]);

  return (
    <div
      className="relative w-full h-screen bg-[#0a0a0f]"
      data-testid="container-webgl-3d"
    >
      <TelemetryHUD />
      {contextLost ? (
        <ContextLostFallback onRetry={handleRetry} />
      ) : (
        <WebGLErrorBoundary key={canvasKey}>
          <Canvas
            shadows
            camera={{ position: [3, 3, 3], fov: 50 }}
            gl={{ antialias: true, alpha: false }}
            style={{ width: "100%", height: "100%" }}
            onCreated={handleCreated}
          >
            <Scene />
          </Canvas>
        </WebGLErrorBoundary>
      )}
    </div>
  );
}
