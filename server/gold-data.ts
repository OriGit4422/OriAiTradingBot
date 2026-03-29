/**
 * Gold market data module
 * - Spot price: metals.live API (free, no key)
 * - OHLCV candles: Yahoo Finance GC=F (free, no key)
 */

export interface GoldCandle {
  time: number; // Unix timestamp (seconds)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface GoldSpot {
  price: number;
  change24h: number;
  changePct24h: number;
  high24h: number;
  low24h: number;
  timestamp: number;
}

// ── Spot price ────────────────────────────────────────────────────────────────

// Cached spot to avoid hammering APIs on every request
let cachedSpot: { data: GoldSpot; at: number } | null = null;
const SPOT_CACHE_MS = 30_000;

export async function getGoldSpotPrice(): Promise<GoldSpot> {
  if (cachedSpot && Date.now() - cachedSpot.at < SPOT_CACHE_MS) {
    return cachedSpot.data;
  }

  // Try Yahoo Finance first (most reliable for gold spot)
  try {
    const yf = await fetchYahooQuote();
    if (yf.price > 0) {
      const spot = { ...yf, timestamp: Date.now() };
      cachedSpot = { data: spot, at: Date.now() };
      return spot;
    }
  } catch { /* continue to next source */ }

  // Try metals.live
  try {
    const res = await fetch('https://api.metals.live/v1/spot', {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      signal: AbortSignal.timeout(8000),
    });
    if (res.ok) {
      const data = await res.json();
      const price = parseFloat(data.gold ?? data.XAU ?? 0);
      if (price > 0) {
        const spot = { price, change24h: 0, changePct24h: 0, high24h: price, low24h: price, timestamp: Date.now() };
        cachedSpot = { data: spot, at: Date.now() };
        return spot;
      }
    }
  } catch { /* continue */ }

  // Final fallback: use last cached value or a reasonable static estimate
  if (cachedSpot) return cachedSpot.data;
  const fallback = { price: 3320, change24h: 0, changePct24h: 0, high24h: 3330, low24h: 3310, timestamp: Date.now() };
  cachedSpot = { data: fallback, at: Date.now() };
  return fallback;
}

async function fetchYahooQuote(): Promise<Omit<GoldSpot, 'timestamp'>> {
  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
    'Accept-Language': 'en-US,en;q=0.9',
  };

  // Try v8 first, fall back to v10
  const urls = [
    'https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1d&range=2d',
    'https://query2.finance.yahoo.com/v8/finance/chart/GC=F?interval=1d&range=2d',
    'https://query1.finance.yahoo.com/v10/finance/quoteSummary/GC=F?modules=price',
  ];

  let lastErr: any;
  for (const url of urls) {
    try {
      const res = await fetch(url, { headers, signal: AbortSignal.timeout(10000) });
      if (!res.ok) { lastErr = new Error(`Yahoo ${res.status}`); continue; }
      const json = await res.json();

      // v8 chart response
      const result = json?.chart?.result?.[0];
      if (result) {
        const meta = result.meta;
        const price = meta.regularMarketPrice ?? 0;
        if (price > 0) {
          const prev = meta.chartPreviousClose ?? price;
          const change24h = price - prev;
          const changePct24h = prev ? (change24h / prev) * 100 : 0;
          const high24h = meta.regularMarketDayHigh ?? price;
          const low24h = meta.regularMarketDayLow ?? price;
          return { price, change24h, changePct24h, high24h, low24h };
        }
      }

      // v10 quoteSummary response
      const priceModule = json?.quoteSummary?.result?.[0]?.price;
      if (priceModule) {
        const price = priceModule.regularMarketPrice?.raw ?? 0;
        if (price > 0) {
          const change24h = priceModule.regularMarketChange?.raw ?? 0;
          const changePct24h = priceModule.regularMarketChangePercent?.raw ? priceModule.regularMarketChangePercent.raw * 100 : 0;
          const high24h = priceModule.regularMarketDayHigh?.raw ?? price;
          const low24h = priceModule.regularMarketDayLow?.raw ?? price;
          return { price, change24h, changePct24h, high24h, low24h };
        }
      }
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr ?? new Error('All Yahoo Finance endpoints failed');
}

// ── OHLCV candles ─────────────────────────────────────────────────────────────

const INTERVAL_MAP: Record<string, string> = {
  '1m':  '1m',
  '5m':  '5m',
  '15m': '15m',
  '30m': '30m',
  '1h':  '60m',
  '4h':  '1h',   // Yahoo doesn't have 4h; we resample 1h
  '1d':  '1d',
};

const RANGE_MAP: Record<string, string> = {
  '1m':  '1d',
  '5m':  '5d',
  '15m': '5d',
  '30m': '1mo',
  '1h':  '1mo',
  '4h':  '3mo',
  '1d':  '1y',
};

export async function getGoldCandles(interval: string = '1h', limit = 200): Promise<GoldCandle[]> {
  const yfInterval = INTERVAL_MAP[interval] ?? '60m';
  const range = RANGE_MAP[interval] ?? '1mo';

  const headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json',
  };
  const urls = [
    `https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=${yfInterval}&range=${range}`,
    `https://query2.finance.yahoo.com/v8/finance/chart/GC=F?interval=${yfInterval}&range=${range}`,
  ];
  let res: Response | null = null;
  for (const url of urls) {
    try {
      const r = await fetch(url, { headers, signal: AbortSignal.timeout(12000) });
      if (r.ok) { res = r; break; }
    } catch { continue; }
  }
  if (!res) throw new Error(`Yahoo Finance candles: all endpoints failed`);
  const json = await res.json();
  const result = json?.chart?.result?.[0];
  if (!result) throw new Error('No Yahoo Finance candles result');

  const timestamps: number[] = result.timestamp ?? [];
  const q = result.indicators?.quote?.[0] ?? {};
  const opens: number[]   = q.open   ?? [];
  const highs: number[]   = q.high   ?? [];
  const lows: number[]    = q.low    ?? [];
  const closes: number[]  = q.close  ?? [];
  const volumes: number[] = q.volume ?? [];

  let candles: GoldCandle[] = timestamps.map((t, i) => ({
    time: t,
    open:   opens[i]   ?? closes[i] ?? 0,
    high:   highs[i]   ?? closes[i] ?? 0,
    low:    lows[i]    ?? closes[i] ?? 0,
    close:  closes[i]  ?? 0,
    volume: volumes[i] ?? 0,
  })).filter(c => c.close > 0);

  // Resample 1h → 4h if needed
  if (interval === '4h') {
    candles = resampleTo4h(candles);
  }

  return candles.slice(-limit);
}

function resampleTo4h(candles: GoldCandle[]): GoldCandle[] {
  const out: GoldCandle[] = [];
  const FOUR_HOURS = 4 * 3600;
  let bucket: GoldCandle[] = [];
  let bucketStart = 0;

  for (const c of candles) {
    const bStart = Math.floor(c.time / FOUR_HOURS) * FOUR_HOURS;
    if (bStart !== bucketStart) {
      if (bucket.length > 0) out.push(mergeBucket(bucket, bucketStart));
      bucket = [];
      bucketStart = bStart;
    }
    bucket.push(c);
  }
  if (bucket.length > 0) out.push(mergeBucket(bucket, bucketStart));
  return out;
}

function mergeBucket(bucket: GoldCandle[], time: number): GoldCandle {
  return {
    time,
    open:   bucket[0].open,
    high:   Math.max(...bucket.map(c => c.high)),
    low:    Math.min(...bucket.map(c => c.low)),
    close:  bucket[bucket.length - 1].close,
    volume: bucket.reduce((s, c) => s + c.volume, 0),
  };
}
