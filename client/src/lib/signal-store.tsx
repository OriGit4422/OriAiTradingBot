/**
 * Shared Signal Store — single source of truth for all dashboard signal panels.
 *
 * Without this, SignalFeed, TopSignalsPanel, and the Signals page each fetch
 * their own copy of klines at different timestamps, producing divergent results
 * for the same coin/timeframe. This context fetches once and shares the result.
 */
import { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { getQuantumSignal, calculateMultiTFConfluence } from './strategies';
import { fetchKlines } from './binance';
import { enhanceSignalsWithAI } from './signal-ai';

const SIGNAL_COINS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX'];
const TIMEFRAMES = ['5m', '15m', '1h', '4h', '1d', '1w'];
const REFRESH_INTERVAL_MS = 90_000; // 90 s

export interface SharedSignal {
  id: string;
  coin: string;
  timeframe: string;
  type: 'LONG' | 'SHORT';
  strategy: string;
  entry: number;
  tp: number;
  sl: number;
  marketPrice: number;
  confidence: number;
  signalScore: number;
  indicators: Record<string, any>;
  aiConfirmation?: any;
  timestamp: string;
  status: string;
}

interface SignalStore {
  signals: SharedSignal[];
  confluenceData: ReturnType<typeof calculateMultiTFConfluence>;
  isLoading: boolean;
  lastUpdated: Date | null;
  refresh: () => void;
}

const SignalStoreContext = createContext<SignalStore>({
  signals: [],
  confluenceData: [],
  isLoading: true,
  lastUpdated: null,
  refresh: () => {},
});

export function SignalStoreProvider({ children }: { children: React.ReactNode }) {
  const [signals, setSignals] = useState<SharedSignal[]>([]);
  const [confluenceData, setConfluenceData] = useState<ReturnType<typeof calculateMultiTFConfluence>>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const fetchingRef = useRef(false);

  const generate = useCallback(async () => {
    if (fetchingRef.current) return;
    fetchingRef.current = true;
    setIsLoading(true);

    const tasks = SIGNAL_COINS.flatMap(coin => TIMEFRAMES.map(tf => ({ coin, tf })));

    const results = await Promise.allSettled(
      tasks.map(async ({ coin, tf }) => {
        try {
          const data = await fetchKlines(coin, tf, 200);
          if (data.length > 50) {
            const signal = getQuantumSignal(coin, data[data.length - 1].close, data, tf);
            signal.timeframe = tf;
            return signal as SharedSignal;
          }
        } catch {
          // ignore per-coin failures
        }
        return null;
      })
    );

    const raw = results
      .filter((r): r is PromiseFulfilledResult<SharedSignal> => r.status === 'fulfilled' && r.value !== null)
      .map(r => r.value);

    const enhanced = await enhanceSignalsWithAI(raw, 12);
    setSignals(enhanced);
    setConfluenceData(calculateMultiTFConfluence(enhanced));
    setLastUpdated(new Date());
    setIsLoading(false);
    fetchingRef.current = false;
  }, []);

  useEffect(() => {
    generate();
    const id = setInterval(() => { if (!document.hidden) generate(); }, REFRESH_INTERVAL_MS);
    return () => clearInterval(id);
  }, [generate]);

  return (
    <SignalStoreContext.Provider value={{ signals, confluenceData, isLoading, lastUpdated, refresh: generate }}>
      {children}
    </SignalStoreContext.Provider>
  );
}

export function useSignalStore() {
  return useContext(SignalStoreContext);
}
