/**
 * Live Price Store — one WebSocket for the whole app.
 * ─────────────────────────────────────────────────────────────────────────────
 * Replaces the per-panel 20–30 s REST polling that made prices look frozen.
 * Binance pushes a ticker event roughly every second per symbol, so quotes are
 * sub-second fresh instead of up to half a minute stale.
 *
 * Design notes:
 *   • ONE combined stream for every symbol the app cares about. Panels read from
 *     this store instead of opening their own socket or poll loop.
 *   • Updates are batched into a single React commit per animation frame. A raw
 *     per-message setState would re-render the dashboard hundreds of times a
 *     second and jank the UI.
 *   • REST is kept only as a cold-start seed and as a fallback while the socket
 *     is down, with exponential reconnect backoff.
 *   • `lastTickAt` is exposed so the UI can *show* staleness rather than quietly
 *     displaying an old number as if it were live.
 */
import {
  createContext, useContext, useEffect, useMemo, useRef, useState, useCallback,
} from 'react';
import { fetch24hTicker } from './binance';

export interface LiveQuote {
  symbol: string;       // bare coin, e.g. "BTC"
  price: number;
  changePercent: number;
  quoteVolume: number;
  high24h: number;
  low24h: number;
  /** epoch ms of the last update for this symbol */
  at: number;
}

export type FeedStatus = 'connecting' | 'live' | 'degraded' | 'offline';

interface LivePriceStore {
  quotes: Record<string, LiveQuote>;
  status: FeedStatus;
  /** epoch ms of the most recent tick from any symbol; 0 before the first one. */
  lastTickAt: number;
  /** Age of the freshest data in ms — drives the staleness badge. */
  ageMs: number;
  get: (coin: string) => LiveQuote | undefined;
}

const DEFAULT_SYMBOLS = [
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'DOT', 'LINK',
  'MATIC', 'UNI', 'LTC', 'ATOM', 'NEAR', 'AAVE', 'FIL', 'APT', 'ARB', 'OP',
  'SUI', 'SEI', 'INJ', 'TIA',
];

/** Data older than this is no longer presented as live. */
export const STALE_AFTER_MS = 15_000;
/** REST safety net cadence while the socket is healthy (cheap, public endpoint). */
const FALLBACK_POLL_MS = 30_000;
const MAX_RECONNECT_DELAY_MS = 30_000;

const Ctx = createContext<LivePriceStore>({
  quotes: {},
  status: 'connecting',
  lastTickAt: 0,
  ageMs: Infinity,
  get: () => undefined,
});

function bareSymbol(pair: string): string {
  return pair.replace(/USDT$/i, '').toUpperCase();
}

export function LivePriceProvider({
  children,
  symbols = DEFAULT_SYMBOLS,
}: {
  children: React.ReactNode;
  symbols?: string[];
}) {
  const [quotes, setQuotes] = useState<Record<string, LiveQuote>>({});
  const [status, setStatus] = useState<FeedStatus>('connecting');
  const [lastTickAt, setLastTickAt] = useState(0);
  // Re-render on a timer purely so the staleness badge counts up.
  const [, setTick] = useState(0);

  // Pending updates are accumulated here and flushed once per frame.
  const pending = useRef<Record<string, LiveQuote>>({});
  const frame = useRef<number | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedByUs = useRef(false);

  const symbolKey = symbols.join(',');

  const flush = useCallback(() => {
    frame.current = null;
    const batch = pending.current;
    pending.current = {};
    if (!Object.keys(batch).length) return;
    setQuotes(prev => ({ ...prev, ...batch }));
    setLastTickAt(Date.now());
  }, []);

  const queue = useCallback((q: LiveQuote) => {
    pending.current[q.symbol] = q;
    if (frame.current === null) {
      frame.current = requestAnimationFrame(flush);
    }
  }, [flush]);

  // ── REST seed + fallback ───────────────────────────────────────────────────
  const pollOnce = useCallback(async () => {
    try {
      const tickers = await fetch24hTicker();
      const now = Date.now();
      const next: Record<string, LiveQuote> = {};
      for (const t of tickers) {
        const sym = bareSymbol(t.symbol);
        if (!symbols.includes(sym)) continue;
        next[sym] = {
          symbol: sym,
          price: parseFloat(t.lastPrice),
          changePercent: parseFloat(t.priceChangePercent),
          quoteVolume: parseFloat(t.quoteVolume),
          high24h: parseFloat(t.highPrice ?? '0'),
          low24h: parseFloat(t.lowPrice ?? '0'),
          at: now,
        };
      }
      if (Object.keys(next).length) {
        setQuotes(prev => ({ ...prev, ...next }));
        setLastTickAt(now);
      }
    } catch {
      setStatus(s => (s === 'live' ? 'degraded' : 'offline'));
    }
  }, [symbols]);

  // ── WebSocket lifecycle ────────────────────────────────────────────────────
  useEffect(() => {
    closedByUs.current = false;

    const connect = () => {
      if (closedByUs.current) return;
      const streams = symbols.map(s => `${s.toLowerCase()}usdt@ticker`).join('/');
      let ws: WebSocket;
      try {
        ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
      } catch {
        scheduleReconnect();
        return;
      }
      socket.current = ws;
      setStatus(prev => (prev === 'live' ? prev : 'connecting'));

      ws.onopen = () => {
        reconnectAttempt.current = 0;
        setStatus('live');
      };

      ws.onmessage = (event) => {
        try {
          const d = JSON.parse(event.data)?.data;
          if (!d?.s) return;
          queue({
            symbol: bareSymbol(d.s),
            price: parseFloat(d.c),
            changePercent: parseFloat(d.P),
            quoteVolume: parseFloat(d.q),
            high24h: parseFloat(d.h),
            low24h: parseFloat(d.l),
            at: Date.now(),
          });
        } catch {
          /* a single malformed frame is not worth tearing the socket down */
        }
      };

      ws.onerror = () => setStatus('degraded');

      ws.onclose = () => {
        socket.current = null;
        if (closedByUs.current) return;
        setStatus('degraded');
        scheduleReconnect();
      };
    };

    const scheduleReconnect = () => {
      if (closedByUs.current || reconnectTimer.current) return;
      const attempt = Math.min(reconnectAttempt.current++, 5);
      const delay = Math.min(1000 * 2 ** attempt, MAX_RECONNECT_DELAY_MS);
      reconnectTimer.current = setTimeout(() => {
        reconnectTimer.current = null;
        connect();
      }, delay);
    };

    void pollOnce();     // seed immediately so the UI is never blank
    connect();

    // Safety net: if the socket silently stops delivering, REST keeps the
    // numbers moving and the status badge tells the truth about it.
    const poll = setInterval(() => {
      if (document.hidden) return;
      void pollOnce();
    }, FALLBACK_POLL_MS);

    // Browsers suspend sockets in background tabs; reconnect on return.
    const onVisible = () => {
      if (document.hidden) return;
      void pollOnce();
      if (!socket.current || socket.current.readyState > WebSocket.OPEN) {
        reconnectAttempt.current = 0;
        connect();
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      closedByUs.current = true;
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(poll);
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current);
      if (frame.current !== null) cancelAnimationFrame(frame.current);
      socket.current?.close();
      socket.current = null;
    };
    // symbolKey stands in for the array identity so a new array literal with the
    // same contents does not tear down the socket on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbolKey, pollOnce, queue]);

  // Drives the age counter without touching the quote data.
  useEffect(() => {
    const id = setInterval(() => setTick(t => t + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const ageMs = lastTickAt ? Date.now() - lastTickAt : Infinity;

  const value = useMemo<LivePriceStore>(() => ({
    quotes,
    status: ageMs > STALE_AFTER_MS && status === 'live' ? 'degraded' : status,
    lastTickAt,
    ageMs,
    get: (coin: string) => quotes[coin.replace(/USDT$/i, '').toUpperCase()],
  }), [quotes, status, lastTickAt, ageMs]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useLivePrices() {
  return useContext(Ctx);
}

/** Convenience hook for a single symbol. */
export function useLivePrice(coin: string): LiveQuote | undefined {
  const { get } = useLivePrices();
  return get(coin);
}
