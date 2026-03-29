export interface ExchangeConnectionResult {
  ok: boolean;
  exchange: 'binance' | 'bybit';
  latencyMs: number;
  message: string;
}

async function timedFetch(url: string, headers?: Record<string, string>) {
  const started = Date.now();
  const res = await fetch(url, { headers });
  const latencyMs = Date.now() - started;
  return { res, latencyMs };
}

export async function testBinanceConnectivity(apiKey?: string): Promise<ExchangeConnectionResult> {
  try {
    const { res, latencyMs } = await timedFetch('https://api.binance.com/api/v3/ping', apiKey ? { 'X-MBX-APIKEY': apiKey } : undefined);
    if (!res.ok) {
      return { ok: false, exchange: 'binance', latencyMs, message: `Binance ping failed: ${res.status}` };
    }
    return {
      ok: true,
      exchange: 'binance',
      latencyMs,
      message: apiKey ? 'Connected to Binance API (public connectivity verified, key present).' : 'Connected to Binance public API.',
    };
  } catch (error: any) {
    return { ok: false, exchange: 'binance', latencyMs: -1, message: error?.message || 'Binance connection failed' };
  }
}

export async function testBybitConnectivity(apiKey?: string): Promise<ExchangeConnectionResult> {
  try {
    const { res, latencyMs } = await timedFetch('https://api.bybit.com/v5/market/time', apiKey ? { 'X-BAPI-API-KEY': apiKey } : undefined);
    if (!res.ok) {
      return { ok: false, exchange: 'bybit', latencyMs, message: `Bybit ping failed: ${res.status}` };
    }
    return {
      ok: true,
      exchange: 'bybit',
      latencyMs,
      message: apiKey ? 'Connected to Bybit API (public connectivity verified, key present).' : 'Connected to Bybit public API.',
    };
  } catch (error: any) {
    return { ok: false, exchange: 'bybit', latencyMs: -1, message: error?.message || 'Bybit connection failed' };
  }
}
