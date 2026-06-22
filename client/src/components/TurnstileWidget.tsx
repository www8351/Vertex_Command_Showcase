import { useEffect, useRef, useState, useCallback } from "react";
import { useTranslation } from "react-i18next";

interface TurnstileWidgetProps {
  siteKey: string;
  onVerify: (token: string) => void;
  onExpire?: () => void;
  onError?: () => void;
  resetKey?: number;
}

declare global {
  interface Window {
    turnstile?: {
      render: (container: HTMLElement, options: Record<string, unknown>) => string;
      reset: (widgetId: string) => void;
      remove: (widgetId: string) => void;
    };
    onTurnstileLoad?: () => void;
  }
}

let scriptLoaded = false;
let scriptLoading = false;
const loadCallbacks: (() => void)[] = [];

function loadTurnstileScript(): Promise<void> {
  return new Promise((resolve) => {
    if (scriptLoaded && window.turnstile) {
      resolve();
      return;
    }
    loadCallbacks.push(resolve);
    if (scriptLoading) return;
    scriptLoading = true;
    window.onTurnstileLoad = () => {
      scriptLoaded = true;
      loadCallbacks.forEach((cb) => cb());
      loadCallbacks.length = 0;
    };
    const script = document.createElement("script");
    script.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?onload=onTurnstileLoad&render=explicit";
    script.async = true;
    script.defer = true;
    document.head.appendChild(script);
  });
}

export default function TurnstileWidget({ siteKey, onVerify, onExpire, onError, resetKey = 0 }: TurnstileWidgetProps) {
  const { t, i18n } = useTranslation();
  const containerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "verified" | "error">("loading");

  const renderWidget = useCallback(() => {
    if (!containerRef.current || !window.turnstile) return;
    if (widgetIdRef.current) {
      window.turnstile.remove(widgetIdRef.current);
      widgetIdRef.current = null;
    }
    const lang = i18n.language === "he" ? "he" : i18n.language === "ar" ? "ar" : i18n.language === "es" ? "es" : "en";
    widgetIdRef.current = window.turnstile.render(containerRef.current, {
      sitekey: siteKey,
      theme: "dark",
      language: lang,
      callback: (token: string) => {
        setStatus("verified");
        onVerify(token);
      },
      "expired-callback": () => {
        setStatus("ready");
        onExpire?.();
      },
      "error-callback": () => {
        setStatus("error");
        onError?.();
      },
    });
    setStatus("ready");
  }, [siteKey, i18n.language, onVerify, onExpire, onError, resetKey]);

  useEffect(() => {
    loadTurnstileScript().then(renderWidget);
    return () => {
      if (widgetIdRef.current && window.turnstile) {
        window.turnstile.remove(widgetIdRef.current);
        widgetIdRef.current = null;
      }
    };
  }, [renderWidget]);

  return (
    <div className="flex flex-col items-center gap-1.5" data-testid="turnstile-widget">
      <div ref={containerRef} />
      {status === "loading" && (
        <p className="text-xs text-muted-foreground">{t("auth.turnstile.verifying")}</p>
      )}
      {status === "verified" && (
        <div className="flex items-center gap-1.5" data-testid="turnstile-verified">
          <svg className="w-4 h-4 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
          <p className="text-xs text-emerald-500 font-medium">{t("auth.turnstile.verified")}</p>
        </div>
      )}
      {status === "error" && (
        <p className="text-xs text-red-500">{t("auth.turnstile.error")}</p>
      )}
    </div>
  );
}
