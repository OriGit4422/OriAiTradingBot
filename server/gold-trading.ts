import { analyzeGold } from './gold-analysis';
import { getGoldSpotPrice, getGoldCandles as fetchGoldCandles } from './gold-data';
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
    const spot = await getGoldSpotPrice();
    return {
      symbol: 'XAUUSD',
      price: spot.price,
      change24h: spot.change24h,
      changePct24h: spot.changePct24h,
      high24h: spot.high24h,
      low24h: spot.low24h,
      source: 'Yahoo Finance XAUUSD',
      timestamp: new Date(spot.timestamp).toISOString(),
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

export async function getGoldCandles(timeframe = '1h') {
  // Delegate to gold-data.ts which has caching, proper headers, and fallbacks
  const candles = await fetchGoldCandles(timeframe, 300);
  // Return with Unix seconds timestamps (consistent with gold-data.ts, required by lightweight-charts)
  return candles;
}

export async function generateGoldSignal(timeframe = '15m') {
  // Use the full technical analysis pipeline from gold-analysis.ts
  const signal = await analyzeGold(timeframe);
  return {
    symbol: 'XAUUSD',
    type: signal.type === 'BUY' ? 'LONG' : signal.type === 'SELL' ? 'SHORT' : 'NEUTRAL',
    entry: signal.entry,
    tp: signal.tp,
    sl: signal.sl,
    rrRatio: signal.rrRatio,
    timeframe,
    confidence: signal.confidence,
    trend: signal.trend,
    strength: signal.strength,
    reasoning: signal.reasoning,
    indicators: signal.indicators,
    keyLevels: signal.keyLevels,
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
  // Check preconditions before making expensive API/AI calls
  if (!autoState.enabled) {
    return { ok: false, message: 'Auto trading is disabled' };
  }
  if (!mt5State.connected) {
    return { ok: false, message: 'MT5 is not connected' };
  }

  const signal = await generateGoldSignal('15m');

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
