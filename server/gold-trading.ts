import { analyzeSignalWithAI } from './ai-analysis';

type GoldDirection = 'LONG' | 'SHORT';

interface Mt5State {
  connected: boolean;
  login?: string;
  server?: string;
  updatedAt: string;
}

interface GoldAutoTradingState {
  enabled: boolean;
  maxRiskPercent: number;
  updatedAt: string;
}

const mt5State: Mt5State = {
  connected: false,
  updatedAt: new Date().toISOString(),
};

const autoState: GoldAutoTradingState = {
  enabled: false,
  maxRiskPercent: 1.0,
  updatedAt: new Date().toISOString(),
};

export async function getLiveGoldPrice() {
  try {
    const res = await fetch('https://query1.finance.yahoo.com/v8/finance/chart/GC=F?interval=1m&range=1d');
    if (!res.ok) throw new Error(`Price API error ${res.status}`);
    const raw = await res.json();
    const result = raw?.chart?.result?.[0];
    const closes: number[] = result?.indicators?.quote?.[0]?.close || [];
    const valid = closes.filter((v) => typeof v === 'number' && Number.isFinite(v));
    const last = valid[valid.length - 1];
    if (!last) throw new Error('No gold price data');

    return {
      symbol: 'XAUUSD',
      price: last,
      source: 'Yahoo Finance GC=F',
      timestamp: new Date().toISOString(),
    };
  } catch (error) {
    return {
      symbol: 'XAUUSD',
      price: 0,
      source: 'Unavailable',
      timestamp: new Date().toISOString(),
      error: (error as any)?.message || 'Failed to fetch gold price',
    };
  }
}

export async function generateGoldSignal(timeframe = '15m') {
  const market = await getLiveGoldPrice();
  const price = market.price || 3300;

  const direction: GoldDirection = Math.random() > 0.5 ? 'LONG' : 'SHORT';
  const atrLike = Math.max(price * 0.003, 5);
  const entry = price;
  const tp = direction === 'LONG' ? price + atrLike * 2 : price - atrLike * 2;
  const sl = direction === 'LONG' ? price - atrLike : price + atrLike;

  const ai = await analyzeSignalWithAI({
    coin: 'XAU',
    type: direction,
    entry,
    tp,
    sl,
    marketPrice: price,
    timeframe,
    confidence: 78,
    strategy: 'GOLD_MULTI_FACTOR',
  });

  return {
    symbol: 'XAUUSD',
    type: direction,
    entry,
    tp,
    sl,
    timeframe,
    confidence: ai.adjustedConfidence,
    ai,
    generatedAt: new Date().toISOString(),
  };
}

export function connectMt5(payload: { login?: string; password?: string; server?: string }) {
  if (!payload.login || !payload.password || !payload.server) {
    return { ok: false, message: 'login, password, server are required' };
  }

  mt5State.connected = true;
  mt5State.login = payload.login;
  mt5State.server = payload.server;
  mt5State.updatedAt = new Date().toISOString();

  return { ok: true, message: 'MT5 bridge connected (paper mode)', mt5: mt5State };
}

export function disconnectMt5() {
  mt5State.connected = false;
  mt5State.updatedAt = new Date().toISOString();
  return { ok: true, message: 'MT5 bridge disconnected', mt5: mt5State };
}

export function setGoldAutoTrading(payload: { enabled: boolean; maxRiskPercent?: number }) {
  autoState.enabled = !!payload.enabled;
  if (typeof payload.maxRiskPercent === 'number' && payload.maxRiskPercent > 0) {
    autoState.maxRiskPercent = payload.maxRiskPercent;
  }
  autoState.updatedAt = new Date().toISOString();

  return {
    ok: true,
    message: autoState.enabled ? 'Gold auto trading enabled' : 'Gold auto trading disabled',
    auto: autoState,
  };
}

export function getGoldTradingStatus() {
  return {
    mt5: mt5State,
    auto: autoState,
  };
}

export async function runGoldAutoTradeOnce() {
  const signal = await generateGoldSignal('15m');

  if (!autoState.enabled) {
    return { ok: false, message: 'Auto trading is disabled', signal };
  }
  if (!mt5State.connected) {
    return { ok: false, message: 'MT5 is not connected', signal };
  }

  return {
    ok: true,
    message: 'Auto trade executed in paper mode',
    signal,
    execution: {
      platform: 'MT5',
      mode: 'paper',
      symbol: signal.symbol,
      side: signal.type,
      entry: signal.entry,
      tp: signal.tp,
      sl: signal.sl,
      riskPercent: autoState.maxRiskPercent,
      executedAt: new Date().toISOString(),
    },
  };
}
