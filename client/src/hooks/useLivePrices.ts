/**
 * useLivePrices — Real-time price streaming via Server-Sent Events
 * Connects to /api/prices/stream?exchange=NSE|BSE
 * Streams Angel One live quotes every 4 seconds.
 * Returns a map of symbol → live price data.
 */
import { useEffect, useRef, useState, useCallback } from "react";

export interface LivePrice {
  symbol:        string;
  exchange:      string;
  price:         number;
  prevClose:     number;
  open:          number;
  high:          number;
  low:           number;
  change:        number;
  changePercent: number;
  volume:        string;
  ts:            number;
  flash?:        "up" | "down"; // for visual flash animation
}

export type LivePriceMap = Record<string, LivePrice>;

export function useLivePrices(exchange: "NSE" | "BSE"): {
  prices: LivePriceMap;
  connected: boolean;
  lastTick: number;
} {
  const [prices, setPrices]       = useState<LivePriceMap>({});
  const [connected, setConnected] = useState(false);
  const [lastTick, setLastTick]   = useState(0);
  const esRef        = useRef<EventSource | null>(null);
  const prevRef      = useRef<LivePriceMap>({});
  const connectRef   = useRef<() => void>(() => {});
  // Flash timers: clear flash class after 600ms
  const flashTimers  = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

  const connect = useCallback(() => {
    if (esRef.current) { esRef.current.close(); esRef.current = null; }

    const es = new EventSource(`/api/prices/stream?exchange=${exchange}`);
    esRef.current = es;

    es.onopen = () => setConnected(true);

    es.onmessage = (event) => {
      try {
        const updates: LivePrice[] = JSON.parse(event.data);
        setPrices(prev => {
          const next = { ...prev };
          for (const u of updates) {
            const old = prevRef.current[u.symbol];
            // Determine flash direction
            let flash: "up" | "down" | undefined;
            if (old) {
              if (u.price > old.price) flash = "up";
              else if (u.price < old.price) flash = "down";
            }
            next[u.symbol] = { ...u, flash };

            // Clear flash after 600ms
            if (flash) {
              if (flashTimers.current[u.symbol]) {
                clearTimeout(flashTimers.current[u.symbol]);
              }
              flashTimers.current[u.symbol] = setTimeout(() => {
                setPrices(p => {
                  if (!p[u.symbol]) return p;
                  return { ...p, [u.symbol]: { ...p[u.symbol], flash: undefined } };
                });
              }, 600);
            }
          }
          prevRef.current = next;
          return next;
        });
        setLastTick(Date.now());
      } catch (e) { console.warn("[LivePrices] parse error", e); }
    };

    es.onerror = () => {
      setConnected(false);
      es.close();
      esRef.current = null;
      // Reconnect after 5 seconds using ref to avoid stale closure
      setTimeout(() => connectRef.current(), 5000);
    };
  }, [exchange]);

  // Keep connectRef current so the reconnect timeout always calls latest version
  useEffect(() => { connectRef.current = connect; }, [connect]);

  useEffect(() => {
    connect();
    return () => {
      if (esRef.current) { esRef.current.close(); esRef.current = null; }
      Object.values(flashTimers.current).forEach(clearTimeout);
    };
  }, [connect]);

  return { prices, connected, lastTick };
}
