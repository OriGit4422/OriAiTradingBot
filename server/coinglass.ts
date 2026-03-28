import { storage } from './storage';

export interface CoinglassData {
  coin: string;
  fundingRate: number;          // average funding rate across exchanges (e.g. 0.0001 = 0.01%)
  fundingRatePercent: number;   // human-readable %
  longPercent: number;          // % of traders that are long
  shortPercent: number;         // % of traders that are short
  openInterestUSD: number;      // total OI in USD
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  signal: string;
  available: boolean;
  error?: string;
}

const SYMBOL_MAP: Record<string, string> = {
  BTC: 'BTC', ETH: 'ETH', SOL: 'SOL', BNB: 'BNB',
  XRP: 'XRP', ADA: 'ADA', DOGE: 'DOGE', AVAX: 'AVAX',
};

async function cgFetch(path: string, apiKey: string): Promise<any> {
  const res = await fetch(`https://open-api.coinglass.com/public/v2${path}`, {
    headers: { 'coinglassSecret': apiKey, 'Content-Type': 'application/json' },
    signal: AbortSignal.timeout(8000),
  });
  if (!res.ok) throw new Error(`Coinglass ${res.status}: ${await res.text()}`);
  const json = await res.json();
  if (json.code !== '0' && json.success === false) throw new Error(json.msg || 'Coinglass error');
  return json.data ?? json;
}

export async function getCoinglassData(coin: string): Promise<CoinglassData> {
  const base: CoinglassData = {
    coin, fundingRate: 0, fundingRatePercent: 0, longPercent: 50, shortPercent: 50,
    openInterestUSD: 0, bias: 'NEUTRAL', signal: 'Coinglass API key not configured', available: false,
  };

  try {
    const settings = await storage.getSettings();
    const apiKey = settings?.coinglassApiKey;
    if (!apiKey) return base;

    const symbol = SYMBOL_MAP[coin] ?? coin;

    const [fundingResult, lsResult, oiResult] = await Promise.allSettled([
      cgFetch(`/funding?symbol=${symbol}`, apiKey),
      cgFetch(`/globalLongShortAccountRatio?symbol=${symbol}USDT&interval=1h&limit=1`, apiKey),
      cgFetch(`/open_interest?symbol=${symbol}`, apiKey),
    ]);

    // --- Funding Rate ---
    let fundingRate = 0;
    if (fundingResult.status === 'fulfilled') {
      const rates = (Array.isArray(fundingResult.value) ? fundingResult.value : [])
        .filter((e: any) => e.rate != null)
        .map((e: any) => parseFloat(e.rate));
      if (rates.length) fundingRate = rates.reduce((a: number, b: number) => a + b, 0) / rates.length;
    }

    // --- Long/Short Ratio ---
    let longPercent = 50, shortPercent = 50;
    if (lsResult.status === 'fulfilled') {
      const list = lsResult.value?.list ?? lsResult.value ?? [];
      if (list.length) {
        const latest = list[list.length - 1];
        longPercent  = parseFloat(latest.longAccount ?? latest.long  ?? '0.5') * 100;
        shortPercent = parseFloat(latest.shortAccount ?? latest.short ?? '0.5') * 100;
      }
    }

    // --- Open Interest ---
    let openInterestUSD = 0;
    if (oiResult.status === 'fulfilled') {
      const oiData = Array.isArray(oiResult.value) ? oiResult.value : [];
      openInterestUSD = oiData.reduce((acc: number, e: any) => acc + parseFloat(e.openInterestAmount ?? e.oi ?? '0'), 0);
    }

    const fundingRatePercent = parseFloat((fundingRate * 100).toFixed(5));

    // --- Determine Bias (contrarian logic) ---
    let bias: CoinglassData['bias'] = 'NEUTRAL';
    let signal = '';

    if (fundingRate > 0.0005) {
      // >0.05% per 8h — extremely over-leveraged longs
      bias = 'BEARISH';
      signal = `🔴 Extreme positive funding ${fundingRatePercent}% — long squeeze risk. ${longPercent.toFixed(0)}% traders long.`;
    } else if (fundingRate < -0.0003) {
      // Negative funding — over-leveraged shorts
      bias = 'BULLISH';
      signal = `🟢 Negative funding ${fundingRatePercent}% — short squeeze setup. ${longPercent.toFixed(0)}% traders long.`;
    } else if (longPercent > 65) {
      bias = 'BEARISH';
      signal = `🔴 ${longPercent.toFixed(0)}% of traders long — crowded trade, liquidation cascade risk.`;
    } else if (longPercent < 35) {
      bias = 'BULLISH';
      signal = `🟢 Only ${longPercent.toFixed(0)}% long — short squeeze potential if price pumps.`;
    } else {
      bias = 'NEUTRAL';
      signal = `⚪ Balanced: ${longPercent.toFixed(0)}% long / ${shortPercent.toFixed(0)}% short, funding ${fundingRatePercent}%`;
    }

    return { coin, fundingRate, fundingRatePercent, longPercent, shortPercent, openInterestUSD, bias, signal, available: true };
  } catch (err: any) {
    console.error('[Coinglass]', err.message);
    return { ...base, signal: `Coinglass unavailable: ${err.message}`, error: err.message };
  }
}
