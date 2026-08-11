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
  /**
   * Where the newest data came from. 'rest' means the socket is not delivering
   * and numbers are only as fresh as the 30 s poll, which the badge must not
   * present as live.
   */
  source: 'socket' | 'rest' | 'none';
  get: (coin: string) => LiveQuote | undefined;
}

// Symbols not present in the REST seed are dropped from the subscription at
// runtime (see `verified`), so a delisting or a rename — MATIC -> POL, for one —
// costs a ticker rather than the whole feed. Both are listed; whichever Binance
// actually serves is the one subscribed to.
const DEFAULT_SYMBOLS = [
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'DOT', 'LINK',
  'MATIC', 'POL', 'UNI', 'LTC', 'ATOM', 'NEAR', 'AAVE', 'FIL', 'APT', 'ARB', 'OP',
  'SUI', 'SEI', 'INJ', 'TIA',
];

/** Data older than this is no longer presented as live. */
export const STALE_AFTER_MS = 15_000;
/** REST safety net cadence while the socket is healthy (cheap, public endpoint). */
const FALLBACK_POLL_MS = 30_000;
const MAX_RECONNECT_DELAY_MS = 30_000;
/**
 * A healthy combined ticker stream delivers something every second or so. Past
 * this much silence the socket is treated as dead and rebuilt: a half-open TCP
 * connection still reports readyState OPEN while delivering nothing, which is
 * the failure that makes a dashboard quietly show minute-old prices.
 */
const SOCKET_SILENCE_TIMEOUT_MS = 20_000;
const WATCHDOG_INTERVAL_MS = 5_000;
/**
 * Backstop for the rAF flush. Browsers stop firing requestAnimationFrame in a
 * hidden or occluded tab, so a queued batch can sit unflushed indefinitely.
 */
const FLUSH_BACKSTOP_MS = 250;

const Ctx = createContext<LivePriceStore>({
  quotes: {},
  status: 'connecting',
  lastTickAt: 0,
  ageMs: Infinity,
  source: 'none',
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
  const [source, setSource] = useState<LivePriceStore['source']>('none');
  // Re-render on a timer purely so the staleness badge counts up.
  const [, setTick] = useState(0);

  // Pending updates are accumulated here and flushed once per frame.
  const pending = useRef<Record<string, LiveQuote>>({});
  const frame = useRef<number | null>(null);
  const backstop = useRef<ReturnType<typeof setTimeout> | null>(null);
  const socket = useRef<WebSocket | null>(null);
  const reconnectAttempt = useRef(0);
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closedByUs = useRef(false);
  /** Last time the SOCKET delivered a frame — distinct from REST-sourced freshness. */
  const lastSocketAt = useRef(0);
  /**
   * Symbols the REST seed proved exist. Binance rejects a combined stream that
   * names an unknown symbol and closes the connection, so one delisted ticker in
   * the default list takes the entire feed down. Subscribing only to confirmed
   * symbols makes the feed self-healing across listing changes.
   */
  const verified = useRef<string[] | null>(null);

  const symbolKey = symbols.join(',');

  const flush = useCallback(() => {
    if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null; }
    if (backstop.current !== null) { clearTimeout(backstop.current); backstop.current = null; }
    const batch = pending.current;
    pending.current = {};
    if (!Object.keys(batch).length) return;
    setQuotes(prev => ({ ...prev, ...batch }));
    setLastTickAt(Date.now());
    setSource('socket');
  }, []);

  const queue = useCallback((q: LiveQuote) => {
    pending.current[q.symbol] = q;
    // rAF keeps this to one React commit per painted frame, but it never fires
    // in a hidden tab; the timer guarantees the batch lands either way. Whichever
    // runs first cancels the other inside flush().
    if (frame.current === null) frame.current = requestAnimationFrame(flush);
    if (backstop.current === null) backstop.current = setTimeout(flush, FLUSH_BACKSTOP_MS);
  }, [flush]);

  // ── REST seed + fallback ───────────────────────────────────────────────────
  // Keyed on symbolKey rather than the `symbols` array: an inline array prop
  // would otherwise give pollOnce a new identity every render, tearing down and
  // rebuilding the WebSocket in a loop and leaving prices permanently behind.
  const pollOnce = useCallback(async () => {
    const wanted = symbolKey.split(',').filter(Boolean);
    try {
      const tickers = await fetch24hTicker();
      const now = Date.now();
      const next: Record<string, LiveQuote> = {};
      const seen: string[] = [];
      for (const t of tickers) {
        const sym = bareSymbol(t.symbol);
        seen.push(sym);
        if (!wanted.includes(sym)) continue;
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
      if (seen.length) {
        const live = wanted.filter(s => seen.includes(s));
        // Only narrow the subscription when the seed actually resolved symbols;
        // an empty or partial response must not silently unsubscribe everything.
        if (live.length) verified.current = live;
      }
      if (Object.keys(next).length) {
        setQuotes(prev => ({ ...prev, ...next }));
        setLastTickAt(now);
        // REST is a fallback, not the live feed. Only claim 'socket' freshness
        // when the socket itself has delivered recently.
        setSource(Date.now() - lastSocketAt.current < SOCKET_SILENCE_TIMEOUT_MS ? 'socket' : 'rest');
      }
    } catch {
      setStatus(s => (s === 'live' ? 'degraded' : 'offline'));
    }
  }, [symbolKey]);

  // ── WebSocket lifecycle ────────────────────────────────────────────────────
  useEffect(() => {
    closedByUs.current = false;

    const connect = () => {
      if (closedByUs.current) return;
      // Prefer the REST-confirmed list; before the seed lands, fall back to the
      // configured symbols so the socket is not blocked on the first poll.
      const subscribe = verified.current ?? symbolKey.split(',').filter(Boolean);
      if (!subscribe.length) return;

      const streams = subscribe.map(s => `${s.toLowerCase()}usdt@ticker`).join('/');
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
        // Not 'live' until a frame actually arrives: an accepted connection that
        // never delivers is exactly the case the watchdog below exists for.
        lastSocketAt.current = Date.now();
        setStatus('live');
      };

      ws.onmessage = (event) => {
        try {
          const d = JSON.parse(event.data)?.data;
          if (!d?.s) return;
          lastSocketAt.current = Date.now();
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

    /**
     * Force a rebuild when the socket goes quiet. readyState stays OPEN on a
     * half-open connection and after Binance's 24 h stream expiry, so 'onclose'
     * alone does not catch this — without the watchdog the badge keeps saying
     * LIVE while every panel shows prices from the 30 s REST poll.
     */
    const watchdog = setInterval(() => {
      if (closedByUs.current || document.hidden) return;
      const ws = socket.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) return;
      if (Date.now() - lastSocketAt.current < SOCKET_SILENCE_TIMEOUT_MS) return;
      setStatus('degraded');
      setSource('rest');
      try { ws.close(); } catch { /* onclose schedules the reconnect */ }
    }, WATCHDOG_INTERVAL_MS);

    const scheduleReconnect = () => {
      if (closedByUs.current || reconnectTimer.current) return;
      const attempt = Math.min(reconnectAttempt.current++, 5);
      const delay = Math.min(1000 * 2 ** attempt, MAX_RECONNECT_DELAY_MS);
      reconnectTimer.current = setTimeout(() => {
        reconnectTimer.current = null;
        connect();
      }, delay);
    };

    // Seed first so the socket subscribes to a REST-confirmed symbol list, but
    // never let a slow or blocked REST call hold the feed hostage — connect
    // anyway after a short grace period and let the watchdog correct it.
    const seeded = pollOnce();
    const graceMs = 1500;
    void Promise.race([seeded, new Promise(r => setTimeout(r, graceMs))])
      .then(() => { if (!closedByUs.current && !socket.current) connect(); });

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
      const ws = socket.current;
      const silent = Date.now() - lastSocketAt.current >= SOCKET_SILENCE_TIMEOUT_MS;
      if (!ws || ws.readyState > WebSocket.OPEN) {
        reconnectAttempt.current = 0;
        connect();
      } else if (silent) {
        // Suspended sockets often come back OPEN but dead. Rebuild rather than
        // trusting a connection that has not spoken since before the tab slept.
        try { ws.close(); } catch { /* onclose schedules the reconnect */ }
      }
    };
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      closedByUs.current = true;
      document.removeEventListener('visibilitychange', onVisible);
      clearInterval(poll);
      clearInterval(watchdog);
      if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null; }
      // Null the refs, not just cancel: a stale non-null frame id makes queue()
      // believe a flush is already scheduled, and the feed stops updating for
      // good on the next mount.
      if (frame.current !== null) { cancelAnimationFrame(frame.current); frame.current = null; }
      if (backstop.current !== null) { clearTimeout(backstop.current); backstop.current = null; }
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
    // 'live' has to mean the socket is delivering. REST-sourced quotes are at
    // best 30 s granular, so they are reported as degraded however recently the
    // last poll landed — showing a poll result as a live tick is the exact
    // dishonesty this store exists to avoid.
    status:
      status === 'live' && (ageMs > STALE_AFTER_MS || source === 'rest')
        ? 'degraded'
        : status,
    lastTickAt,
    ageMs,
    source,
    get: (coin: string) => quotes[coin.replace(/USDT$/i, '').toUpperCase()],
  }), [quotes, status, lastTickAt, ageMs, source]);

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
