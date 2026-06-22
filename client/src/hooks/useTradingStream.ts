import { useEffect, useRef, useState, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiUrl } from "@/lib/apiBase";

export interface WSConnectionState {
  connectionId: number;
  state: string;
}

interface StreamEvent {
  type: string;
  connectionId?: number;
  position?: any;
  order?: any;
  balance?: any;
  state?: string;
  states?: WSConnectionState[];
  executionStates?: WSConnectionState[];
  symbol?: string;
  action?: string;
  followerName?: string;
  masterPrice?: number;
  currentPrice?: number;
  slippagePercent?: number;
  slippageTicks?: number;
  groupId?: number;
}

const INVALIDATION_DEBOUNCE_MS = 500;

export function useTradingStream(onSlippageBlocked?: (event: StreamEvent) => void) {
  const [isConnected, setIsConnected] = useState(false);
  const [wsStates, setWsStates] = useState<WSConnectionState[]>([]);
  const [execStates, setExecStates] = useState<WSConnectionState[]>([]);
  const eventSourceRef = useRef<EventSource | null>(null);
  const queryClient = useQueryClient();
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const invalidationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const slippageCallbackRef = useRef(onSlippageBlocked);
  slippageCallbackRef.current = onSlippageBlocked;

  const debouncedInvalidate = useCallback(() => {
    if (invalidationTimerRef.current) return;
    invalidationTimerRef.current = setTimeout(() => {
      invalidationTimerRef.current = null;
      queryClient.invalidateQueries({ queryKey: ["/api/v1/accounts"] });
    }, INVALIDATION_DEBOUNCE_MS);
  }, [queryClient]);

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
    }

    const es = new EventSource(apiUrl("/api/v1/trading/stream"), { withCredentials: true });
    eventSourceRef.current = es;

    es.onopen = () => {
      setIsConnected(true);
    };

    es.onmessage = (event) => {
      try {
        const data: StreamEvent = JSON.parse(event.data);

        switch (data.type) {
          case "connected":
            setIsConnected(true);
            break;

          case "wsStates":
            if (data.states) {
              setWsStates(data.states);
            }
            if (data.executionStates) {
              setExecStates(data.executionStates);
            }
            break;

          case "wsStateChange":
            if (data.connectionId !== undefined && data.state) {
              setWsStates(prev => {
                const existing = prev.find(s => s.connectionId === data.connectionId);
                if (existing) {
                  return prev.map(s =>
                    s.connectionId === data.connectionId
                      ? { ...s, state: data.state! }
                      : s
                  );
                }
                return [...prev, { connectionId: data.connectionId!, state: data.state! }];
              });
            }
            break;

          case "execStateChange":
            if (data.connectionId !== undefined && data.state) {
              setExecStates(prev => {
                const existing = prev.find(s => s.connectionId === data.connectionId);
                if (existing) {
                  return prev.map(s =>
                    s.connectionId === data.connectionId
                      ? { ...s, state: data.state! }
                      : s
                  );
                }
                return [...prev, { connectionId: data.connectionId!, state: data.state! }];
              });
            }
            break;

          case "positionUpdate":
          case "orderUpdate":
          case "balanceUpdate":
            debouncedInvalidate();
            break;

          case "slippageBlocked":
            if (slippageCallbackRef.current) {
              slippageCallbackRef.current(data);
            }
            queryClient.invalidateQueries({ queryKey: ["/api/v1/copy-trading/groups"] });
            break;
        }
      } catch (err) {
        console.warn("[TradingStream] Failed to parse SSE event:", err);
      }
    };

    es.onerror = () => {
      setIsConnected(false);
      es.close();
      eventSourceRef.current = null;

      reconnectTimerRef.current = setTimeout(() => {
        connect();
      }, 5000);
    };
  }, [queryClient, debouncedInvalidate]);

  useEffect(() => {
    connect();

    return () => {
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      if (invalidationTimerRef.current) {
        clearTimeout(invalidationTimerRef.current);
      }
    };
  }, [connect]);

  const getConnectionState = useCallback(
    (connectionId: number): string | undefined => {
      return wsStates.find(s => s.connectionId === connectionId)?.state;
    },
    [wsStates]
  );

  const getExecConnectionState = useCallback(
    (connectionId: number): string | undefined => {
      return execStates.find(s => s.connectionId === connectionId)?.state;
    },
    [execStates]
  );

  const isConnectionLive = useCallback(
    (connectionId: number): boolean => {
      const state = getConnectionState(connectionId);
      return state === "connected";
    },
    [getConnectionState]
  );

  const isExecConnectionLive = useCallback(
    (connectionId: number): boolean => {
      const state = getExecConnectionState(connectionId);
      return state === "connected";
    },
    [getExecConnectionState]
  );

  return {
    isConnected,
    wsStates,
    execStates,
    getConnectionState,
    getExecConnectionState,
    isConnectionLive,
    isExecConnectionLive,
  };
}
