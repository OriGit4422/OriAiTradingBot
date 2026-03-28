import type { Signal } from '@shared/schema';

export interface SignalPerformance {
  id: string;
  coin: string;
  type: string;
  timeframe: string;
  createdAt: string;
  ageHours: number;
  entry: number;
  tp: number;
  sl: number;
  confidence: number;
  outcome: 'TP_HIT' | 'SL_HIT' | 'RUNNING' | 'NO_DATA';
  hitAt?: string;
}

interface KlineTuple extends Array<any> {
  0: number; // open time
  1: string;
  2: string; // high
  3: string; // low
  4: string;
}

async function fetchSignalKlines(symbol: string, startTime: number, endTime: number): Promise<KlineTuple[]> {
  const url = new URL('https://api.binance.com/api/v3/klines');
  url.searchParams.set('symbol', `${symbol.toUpperCase()}USDT`);
  url.searchParams.set('interval', '5m');
  url.searchParams.set('startTime', String(startTime));
  url.searchParams.set('endTime', String(endTime));
  url.searchParams.set('limit', '1000');

  const res = await fetch(url.toString());
  if (!res.ok) return [];
  return (await res.json()) as KlineTuple[];
}

export async function evaluateSignalPerformance(signal: Signal, hours = 24): Promise<SignalPerformance> {
  const created = new Date(signal.createdAt);
  const now = new Date();
  const ageHours = (now.getTime() - created.getTime()) / 3600000;

  const summary: SignalPerformance = {
    id: signal.id,
    coin: signal.coin,
    type: signal.type,
    timeframe: signal.timeframe,
    createdAt: created.toISOString(),
    ageHours: Math.round(ageHours * 10) / 10,
    entry: signal.entry,
    tp: signal.tp,
    sl: signal.sl,
    confidence: signal.confidence,
    outcome: 'NO_DATA',
  };

  if (ageHours < hours) {
    summary.outcome = 'RUNNING';
    return summary;
  }

  const klines = await fetchSignalKlines(signal.coin, created.getTime(), now.getTime());
  if (!klines.length) return summary;

  for (const k of klines) {
    const time = new Date(k[0]).toISOString();
    const high = parseFloat(k[2]);
    const low = parseFloat(k[3]);

    if (signal.type === 'LONG') {
      if (low <= signal.sl) {
        summary.outcome = 'SL_HIT';
        summary.hitAt = time;
        return summary;
      }
      if (high >= signal.tp) {
        summary.outcome = 'TP_HIT';
        summary.hitAt = time;
        return summary;
      }
    } else {
      if (high >= signal.sl) {
        summary.outcome = 'SL_HIT';
        summary.hitAt = time;
        return summary;
      }
      if (low <= signal.tp) {
        summary.outcome = 'TP_HIT';
        summary.hitAt = time;
        return summary;
      }
    }
  }

  summary.outcome = 'RUNNING';
  return summary;
}

export async function evaluateSignalsPerformance(signals: Signal[], hours = 24): Promise<SignalPerformance[]> {
  const results = await Promise.allSettled(signals.map((s) => evaluateSignalPerformance(s, hours)));
  return results
    .filter((r): r is PromiseFulfilledResult<SignalPerformance> => r.status === 'fulfilled')
    .map((r) => r.value)
    .sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
}
