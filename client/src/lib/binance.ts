export interface BinanceKline {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface BinanceTicker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
  quoteVolume: string;
  highPrice: string;
  lowPrice: string;
}

const BASE_URL = 'https://api.binance.com/api/v3';
const WS_URL = 'wss://stream.binance.com:9443/ws';

export const INTERVAL_MAP: Record<string, string> = {
  '1m': '1m',
  '3m': '3m',
  '5m': '5m',
  '15m': '15m',
  '30m': '30m',
  '1h': '1h',
  '4h': '4h',
  '8h': '8h',
  '1d': '1d',
};

const TOP_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
  'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT',
  'MATICUSDT', 'UNIUSDT', 'LTCUSDT', 'ATOMUSDT', 'NEARUSDT',
  'AAVEUSDT', 'FILUSDT', 'APTUSDT', 'ARBUSDT', 'OPUSDT',
  'SUIUSDT', 'SEIUSDT', 'INJUSDT', 'TIAUSDT'
];

let tickerCache: { data: BinanceTicker[]; ts: number } | null = null;
const TICKER_CACHE_TTL = 5000;
const KLINE_CACHE_TTL = 10000;
const klineCache = new Map<string, { data: BinanceKline[]; ts: number }>();

export async function fetchKlines(symbol: string, interval: string, limit = 200): Promise<BinanceKline[]> {
  const pair = `${symbol.toUpperCase()}USDT`;
  const binanceInterval = INTERVAL_MAP[interval] || '1h';
  const cacheKey = `${pair}:${binanceInterval}:${limit}`;

  const cached = klineCache.get(cacheKey);
  if (cached && Date.now() - cached.ts < KLINE_CACHE_TTL) {
    return cached.data;
  }

  try {
    const response = await fetch(`${BASE_URL}/klines?symbol=${pair}&interval=${binanceInterval}&limit=${limit}`);
    if (!response.ok) return [];
    const data = await response.json();

    const mapped = data.map((d: any[]) => ({
      time: d[0] / 1000,
      open: parseFloat(d[1]),
      high: parseFloat(d[2]),
      low: parseFloat(d[3]),
      close: parseFloat(d[4]),
      volume: parseFloat(d[5]),
    }));
    klineCache.set(cacheKey, { data: mapped, ts: Date.now() });
    return mapped;
  } catch (error) {
    console.error('Error fetching klines:', error);
    return [];
  }
}

export async function fetchTickersForSymbols(symbols: string[]): Promise<BinanceTicker[]> {
  try {
    const symbolsParam = JSON.stringify(symbols.map(s => s.toUpperCase()));
    const response = await fetch(`${BASE_URL}/ticker/24hr?symbols=${encodeURIComponent(symbolsParam)}`);
    if (!response.ok) return [];
    return await response.json();
  } catch (error) {
    console.error('Error fetching tickers:', error);
    return [];
  }
}

export async function fetch24hTicker(): Promise<BinanceTicker[]> {
  if (tickerCache && Date.now() - tickerCache.ts < TICKER_CACHE_TTL) {
    return tickerCache.data;
  }
  try {
    const response = await fetch(`${BASE_URL}/ticker/24hr?symbols=${encodeURIComponent(JSON.stringify(TOP_SYMBOLS))}`);
    if (!response.ok) {
      const fallback = await fetch(`${BASE_URL}/ticker/24hr`);
      const data = await fallback.json();
      const filtered = data.filter((t: any) => t.symbol.endsWith('USDT'));
      tickerCache = { data: filtered.slice(0, 50), ts: Date.now() };
      return tickerCache.data;
    }
    const data = await response.json();
    tickerCache = { data, ts: Date.now() };
    return data;
  } catch (error) {
    console.error('Error fetching ticker:', error);
    return [];
  }
}

export function subscribeToTicker(symbols: string[], onMessage: (data: any) => void) {
  const streams = symbols.map(s => `${s.toLowerCase()}@ticker`).join('/');
  const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);

  ws.onmessage = (event) => {
    const wrapper = JSON.parse(event.data);
    const d = wrapper.data;
    onMessage([{
      s: d.s,
      c: d.c,
      P: d.P,
      q: d.q,
    }]);
  };

  ws.onerror = () => {};

  return () => ws.close();
}

export interface OrderBookEntry {
  price: number;
  quantity: number;
  total: number;
}

export interface OrderBookData {
  bids: OrderBookEntry[];
  asks: OrderBookEntry[];
  spread: number;
  spreadPercent: number;
  bidTotal: number;
  askTotal: number;
  imbalance: number;
}

export async function fetchOrderBook(symbol: string, limit = 20): Promise<OrderBookData> {
  const pair = `${symbol.toUpperCase()}USDT`;
  try {
    const response = await fetch(`${BASE_URL}/depth?symbol=${pair}&limit=${limit}`);
    if (!response.ok) throw new Error('Failed to fetch order book');
    const data = await response.json();

    const bids: OrderBookEntry[] = data.bids.map((b: string[]) => ({
      price: parseFloat(b[0]),
      quantity: parseFloat(b[1]),
      total: parseFloat(b[0]) * parseFloat(b[1]),
    }));

    const asks: OrderBookEntry[] = data.asks.map((a: string[]) => ({
      price: parseFloat(a[0]),
      quantity: parseFloat(a[1]),
      total: parseFloat(a[0]) * parseFloat(a[1]),
    }));

    const bestBid = bids[0]?.price || 0;
    const bestAsk = asks[0]?.price || 0;
    const spread = bestAsk - bestBid;
    const spreadPercent = bestBid > 0 ? (spread / bestBid) * 100 : 0;
    const bidTotal = bids.reduce((s, b) => s + b.total, 0);
    const askTotal = asks.reduce((s, a) => s + a.total, 0);
    const imbalance = bidTotal + askTotal > 0 ? ((bidTotal - askTotal) / (bidTotal + askTotal)) * 100 : 0;

    return { bids, asks, spread, spreadPercent, bidTotal, askTotal, imbalance };
  } catch (error) {
    console.error('Error fetching order book:', error);
    return { bids: [], asks: [], spread: 0, spreadPercent: 0, bidTotal: 0, askTotal: 0, imbalance: 0 };
  }
}

export function subscribeToKline(symbol: string, interval: string, onUpdate: (kline: BinanceKline) => void) {
  const pair = `${symbol.toLowerCase()}usdt`;
  const binanceInterval = INTERVAL_MAP[interval] || '1h';
  const ws = new WebSocket(`${WS_URL}/${pair}@kline_${binanceInterval}`);

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    const k = data.k;
    onUpdate({
      time: k.t / 1000,
      open: parseFloat(k.o),
      high: parseFloat(k.h),
      low: parseFloat(k.l),
      close: parseFloat(k.c),
      volume: parseFloat(k.v),
    });
  };

  return () => ws.close();
}
