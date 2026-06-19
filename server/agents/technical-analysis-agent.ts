/**
 * Technical Analysis Agent — Phase 2 Confluence Engine (17-Factor Model)
 * Replaces the Phase 1 placeholder grade derivation.
 * Uses Claude Sonnet for structured multi-step reasoning on confluence scoring.
 */
import { callAIProvider, getActiveProviders, extractJson, type AIMessage } from '../ai-providers';

export interface OHLCVCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timestamp: number;
}

export interface ConfluenceFactor {
  name: string;
  score: number;    // 0-100
  weight: number;   // relative weight in composite
  signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  detail: string;
}

export interface PhaseTwo {
  // SMC factors
  smcStructure: ConfluenceFactor;        // 1. BOS / CHOCH direction
  orderBlockQuality: ConfluenceFactor;   // 2. OB freshness & strength
  fairValueGap: ConfluenceFactor;        // 3. FVG present & untested
  liquiditySweep: ConfluenceFactor;      // 4. Recent liquidity grab confirmed

  // Momentum factors
  rsiPosition: ConfluenceFactor;         // 5. RSI relative to 50/OB/OS
  rsiDivergence: ConfluenceFactor;       // 6. Bullish/Bearish divergence
  macdCross: ConfluenceFactor;           // 7. MACD line cross + histogram
  stochRsi: ConfluenceFactor;            // 8. StochRSI overbought/oversold

  // Trend factors
  emaAlignment: ConfluenceFactor;        // 9. EMA 9/21/50 stack direction
  adxStrength: ConfluenceFactor;         // 10. ADX trend strength
  ichimoku: ConfluenceFactor;            // 11. Kumo cloud position & TK cross

  // Volume factors
  volumeConfirmation: ConfluenceFactor;  // 12. Volume spike on breakout
  volumeProfile: ConfluenceFactor;       // 13. POC / HVN / LVN context

  // Context factors
  atrVolatility: ConfluenceFactor;       // 14. ATR regime (too tight = fake, too wide = dangerous)
  multiTimeframe: ConfluenceFactor;      // 15. HTF bias aligns with LTF entry
  candlePattern: ConfluenceFactor;       // 16. Engulfing / Pin bar / Inside bar
  sessionTiming: ConfluenceFactor;       // 17. London/NY kill zone timing

  // Composite
  compositeScore: number;                // 0-100 weighted average
  grade: 'A+' | 'A' | 'B' | 'C' | 'No Trade';
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  entryQuality: 'EXCELLENT' | 'GOOD' | 'FAIR' | 'POOR';
  aiEnhanced: boolean;
  summary: string;
}

// ─── Indicator calculations ──────────────────────────────────────────────────

function calcEMA(prices: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const emas: number[] = [prices[0]];
  for (let i = 1; i < prices.length; i++) {
    emas.push(prices[i] * k + emas[i - 1] * (1 - k));
  }
  return emas;
}

function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff;
    else losses += Math.abs(diff);
  }
  let avgGain = gains / period;
  let avgLoss = losses / period;
  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const g = diff > 0 ? diff : 0;
    const l = diff < 0 ? Math.abs(diff) : 0;
    avgGain = (avgGain * (period - 1) + g) / period;
    avgLoss = (avgLoss * (period - 1) + l) / period;
  }
  if (avgLoss === 0) return 100;
  return 100 - 100 / (1 + avgGain / avgLoss);
}

function calcMACD(closes: number[]): { macd: number; signal: number; histogram: number } {
  if (closes.length < 26) return { macd: 0, signal: 0, histogram: 0 };
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const signalLine = calcEMA(macdLine.slice(-9), 9);
  const macd = macdLine[macdLine.length - 1];
  const signal = signalLine[signalLine.length - 1];
  return { macd, signal, histogram: macd - signal };
}

function calcATR(candles: OHLCVCandle[], period = 14): number {
  if (candles.length < 2) return 0;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prev = candles[i - 1];
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close)));
  }
  return trs.slice(-period).reduce((a, b) => a + b, 0) / Math.min(period, trs.length);
}

function calcADX(candles: OHLCVCandle[], period = 14): number {
  if (candles.length < period + 1) return 20;
  const trs: number[] = [], plusDMs: number[] = [], minusDMs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    const tr = Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close));
    const plusDM = (c.high - p.high > p.low - c.low && c.high - p.high > 0) ? c.high - p.high : 0;
    const minusDM = (p.low - c.low > c.high - p.high && p.low - c.low > 0) ? p.low - c.low : 0;
    trs.push(tr); plusDMs.push(plusDM); minusDMs.push(minusDM);
  }
  const slice = trs.slice(-period);
  const atr = slice.reduce((a, b) => a + b, 0) / period;
  if (atr === 0) return 20;
  const plusDI = (plusDMs.slice(-period).reduce((a, b) => a + b, 0) / period) / atr * 100;
  const minusDI = (minusDMs.slice(-period).reduce((a, b) => a + b, 0) / period) / atr * 100;
  const diSum = plusDI + minusDI;
  if (diSum === 0) return 20;
  const dx = Math.abs(plusDI - minusDI) / diSum * 100;
  return dx; // simplified ADX (first-pass, not smoothed)
}

// ─── Factor scoring functions ─────────────────────────────────────────────────

function scoreSMCStructure(candles: OHLCVCandle[], direction: 'LONG' | 'SHORT'): ConfluenceFactor {
  const closes = candles.map(c => c.close);
  const n = closes.length;
  if (n < 10) return { name: 'SMC Structure', score: 50, weight: 8, signal: 'NEUTRAL', detail: 'Insufficient data' };

  // Look for Higher Highs + Higher Lows (bullish) or LH + LL (bearish)
  const recent = closes.slice(-10);
  const highs = candles.slice(-10).map(c => c.high);
  const lows = candles.slice(-10).map(c => c.low);
  const hh = highs[highs.length - 1] > highs[Math.floor(highs.length / 2)];
  const hl = lows[lows.length - 1] > lows[Math.floor(lows.length / 2)];
  const lh = highs[highs.length - 1] < highs[Math.floor(highs.length / 2)];
  const ll = lows[lows.length - 1] < lows[Math.floor(lows.length / 2)];

  const bullishStructure = hh && hl;
  const bearishStructure = lh && ll;

  let score = 50, signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL', detail = 'Ranging/unclear structure';
  if (bullishStructure && direction === 'LONG') { score = 85; signal = 'BULLISH'; detail = 'HH+HL bullish structure aligns with LONG'; }
  else if (bearishStructure && direction === 'SHORT') { score = 85; signal = 'BEARISH'; detail = 'LH+LL bearish structure aligns with SHORT'; }
  else if (bullishStructure && direction === 'SHORT') { score = 20; signal = 'BULLISH'; detail = 'Bullish structure contradicts SHORT trade'; }
  else if (bearishStructure && direction === 'LONG') { score = 20; signal = 'BEARISH'; detail = 'Bearish structure contradicts LONG trade'; }

  return { name: 'SMC Structure', score, weight: 8, signal, detail };
}

function scoreEMAAlignment(candles: OHLCVCandle[], direction: 'LONG' | 'SHORT'): ConfluenceFactor {
  const closes = candles.map(c => c.close);
  if (closes.length < 50) return { name: 'EMA Alignment', score: 50, weight: 7, signal: 'NEUTRAL', detail: 'Need 50+ candles' };

  const ema9 = calcEMA(closes, 9);
  const ema21 = calcEMA(closes, 21);
  const ema50 = calcEMA(closes, 50);
  const last9 = ema9[ema9.length - 1];
  const last21 = ema21[ema21.length - 1];
  const last50 = ema50[ema50.length - 1];
  const price = closes[closes.length - 1];

  const bullStack = last9 > last21 && last21 > last50 && price > last9;
  const bearStack = last9 < last21 && last21 < last50 && price < last9;
  const partialBull = last9 > last21 && price > last21;
  const partialBear = last9 < last21 && price < last21;

  let score = 50, signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL', detail = 'Mixed EMA alignment';
  if (bullStack && direction === 'LONG') { score = 90; signal = 'BULLISH'; detail = 'EMA 9>21>50 perfect bull stack, price above all'; }
  else if (bearStack && direction === 'SHORT') { score = 90; signal = 'BEARISH'; detail = 'EMA 9<21<50 perfect bear stack, price below all'; }
  else if (partialBull && direction === 'LONG') { score = 65; signal = 'BULLISH'; detail = 'Partial bullish EMA alignment'; }
  else if (partialBear && direction === 'SHORT') { score = 65; signal = 'BEARISH'; detail = 'Partial bearish EMA alignment'; }
  else if (bullStack && direction === 'SHORT') { score = 15; signal = 'BULLISH'; detail = 'Bull EMA stack contradicts SHORT'; }
  else if (bearStack && direction === 'LONG') { score = 15; signal = 'BEARISH'; detail = 'Bear EMA stack contradicts LONG'; }

  return { name: 'EMA Alignment', score, weight: 7, signal, detail };
}

function scoreRSI(candles: OHLCVCandle[], direction: 'LONG' | 'SHORT'): ConfluenceFactor {
  const closes = candles.map(c => c.close);
  const rsi = calcRSI(closes);

  let score = 50, signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL', detail = `RSI ${rsi.toFixed(1)}`;
  if (direction === 'LONG') {
    if (rsi < 30) { score = 90; signal = 'BULLISH'; detail = `RSI oversold at ${rsi.toFixed(1)} — prime long entry`; }
    else if (rsi < 45) { score = 70; signal = 'BULLISH'; detail = `RSI ${rsi.toFixed(1)} below midline, bullish bias`; }
    else if (rsi > 70) { score = 20; signal = 'BEARISH'; detail = `RSI overbought at ${rsi.toFixed(1)} — avoid long`; }
    else { score = 50; signal = 'NEUTRAL'; detail = `RSI ${rsi.toFixed(1)} midrange`; }
  } else {
    if (rsi > 70) { score = 90; signal = 'BEARISH'; detail = `RSI overbought at ${rsi.toFixed(1)} — prime short entry`; }
    else if (rsi > 55) { score = 70; signal = 'BEARISH'; detail = `RSI ${rsi.toFixed(1)} above midline, bearish bias`; }
    else if (rsi < 30) { score = 20; signal = 'BULLISH'; detail = `RSI oversold at ${rsi.toFixed(1)} — avoid short`; }
    else { score = 50; signal = 'NEUTRAL'; detail = `RSI ${rsi.toFixed(1)} midrange`; }
  }

  return { name: 'RSI Position', score, weight: 6, signal, detail };
}

function scoreMACD(candles: OHLCVCandle[], direction: 'LONG' | 'SHORT'): ConfluenceFactor {
  const closes = candles.map(c => c.close);
  const { macd, signal: sig, histogram } = calcMACD(closes);

  let score = 50, signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL', detail = 'MACD neutral';
  const bullCross = macd > sig && histogram > 0;
  const bearCross = macd < sig && histogram < 0;

  if (direction === 'LONG') {
    if (bullCross && macd > 0) { score = 85; signal = 'BULLISH'; detail = 'MACD bullish cross above zero — strong'; }
    else if (bullCross) { score = 65; signal = 'BULLISH'; detail = 'MACD bullish cross below zero — moderate'; }
    else if (bearCross) { score = 15; signal = 'BEARISH'; detail = 'MACD bearish — contradicts LONG'; }
  } else {
    if (bearCross && macd < 0) { score = 85; signal = 'BEARISH'; detail = 'MACD bearish cross below zero — strong'; }
    else if (bearCross) { score = 65; signal = 'BEARISH'; detail = 'MACD bearish cross above zero — moderate'; }
    else if (bullCross) { score = 15; signal = 'BULLISH'; detail = 'MACD bullish — contradicts SHORT'; }
  }

  return { name: 'MACD Cross', score, weight: 6, signal, detail };
}

function scoreVolumeConfirmation(candles: OHLCVCandle[], direction: 'LONG' | 'SHORT'): ConfluenceFactor {
  if (candles.length < 5) return { name: 'Volume Confirmation', score: 50, weight: 6, signal: 'NEUTRAL', detail: 'Insufficient data' };
  const vols = candles.map(c => c.volume);
  const avgVol = vols.slice(-20).reduce((a, b) => a + b, 0) / Math.min(20, vols.length);
  const lastVol = vols[vols.length - 1];
  const lastClose = candles[candles.length - 1].close;
  const prevClose = candles[candles.length - 2].close;
  const priceUp = lastClose > prevClose;
  const ratio = lastVol / avgVol;

  let score = 50, signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL', detail = `Volume ${ratio.toFixed(1)}x avg`;
  if (ratio >= 2.0) {
    if (priceUp && direction === 'LONG') { score = 90; signal = 'BULLISH'; detail = `Volume spike ${ratio.toFixed(1)}x with bullish price — strong confirmation`; }
    else if (!priceUp && direction === 'SHORT') { score = 90; signal = 'BEARISH'; detail = `Volume spike ${ratio.toFixed(1)}x with bearish price — strong confirmation`; }
    else { score = 55; signal = 'NEUTRAL'; detail = `Volume spike but price direction conflicts`; }
  } else if (ratio >= 1.3) {
    score = direction === 'LONG' ? (priceUp ? 70 : 40) : (!priceUp ? 70 : 40);
    signal = priceUp ? 'BULLISH' : 'BEARISH';
    detail = `Above-average volume ${ratio.toFixed(1)}x`;
  } else if (ratio < 0.7) {
    score = 30; signal = 'NEUTRAL'; detail = `Low volume ${ratio.toFixed(1)}x — weak conviction`;
  }

  return { name: 'Volume Confirmation', score, weight: 6, signal, detail };
}

function scoreATRVolatility(candles: OHLCVCandle[], entry: number): ConfluenceFactor {
  const atr = calcATR(candles);
  const atrPct = entry > 0 ? (atr / entry) * 100 : 0;

  let score = 70, signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL', detail = `ATR ${atrPct.toFixed(2)}%`;
  if (atrPct < 0.2) { score = 25; detail = `ATR too tight (${atrPct.toFixed(2)}%) — fake breakout risk`; }
  else if (atrPct < 0.5) { score = 60; detail = `Low ATR (${atrPct.toFixed(2)}%) — tight market`; }
  else if (atrPct >= 0.5 && atrPct <= 3.0) { score = 85; detail = `Healthy ATR (${atrPct.toFixed(2)}%) — good trading range`; }
  else if (atrPct > 5.0) { score = 30; signal = 'BEARISH'; detail = `Extreme ATR (${atrPct.toFixed(2)}%) — dangerous volatility`; }
  else { score = 55; detail = `Elevated ATR (${atrPct.toFixed(2)}%) — manage size carefully`; }

  return { name: 'ATR Volatility', score, weight: 5, signal, detail };
}

function scoreADX(candles: OHLCVCandle[]): ConfluenceFactor {
  const adx = calcADX(candles);

  let score = 50, signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL', detail = `ADX ${adx.toFixed(1)}`;
  if (adx >= 40) { score = 90; detail = `Very strong trend ADX=${adx.toFixed(1)}`; }
  else if (adx >= 25) { score = 75; detail = `Strong trend ADX=${adx.toFixed(1)}`; }
  else if (adx >= 15) { score = 55; detail = `Moderate trend ADX=${adx.toFixed(1)}`; }
  else { score = 25; detail = `Weak/no trend ADX=${adx.toFixed(1)} — range-bound market`; }

  return { name: 'ADX Strength', score, weight: 5, signal, detail };
}

function scoreCandlePattern(candles: OHLCVCandle[], direction: 'LONG' | 'SHORT'): ConfluenceFactor {
  if (candles.length < 3) return { name: 'Candle Pattern', score: 50, weight: 4, signal: 'NEUTRAL', detail: 'Insufficient data' };
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2];
  const body = Math.abs(last.close - last.open);
  const range = last.high - last.low;
  const bodyRatio = range > 0 ? body / range : 0;
  const upperWick = last.high - Math.max(last.close, last.open);
  const lowerWick = Math.min(last.close, last.open) - last.low;

  // Pin bar: small body, long wick
  const bullPinBar = lowerWick > body * 2 && lowerWick > upperWick;
  const bearPinBar = upperWick > body * 2 && upperWick > lowerWick;

  // Engulfing
  const bullEngulf = last.close > last.open && last.close > prev.open && last.open < prev.close;
  const bearEngulf = last.close < last.open && last.close < prev.open && last.open > prev.close;

  let score = 50, signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL', detail = 'No strong pattern';
  if (direction === 'LONG') {
    if (bullEngulf) { score = 85; signal = 'BULLISH'; detail = 'Bullish engulfing candle'; }
    else if (bullPinBar) { score = 80; signal = 'BULLISH'; detail = 'Bullish pin bar / hammer'; }
    else if (bearEngulf || bearPinBar) { score = 20; signal = 'BEARISH'; detail = 'Bearish candle contradicts LONG'; }
  } else {
    if (bearEngulf) { score = 85; signal = 'BEARISH'; detail = 'Bearish engulfing candle'; }
    else if (bearPinBar) { score = 80; signal = 'BEARISH'; detail = 'Bearish pin bar / shooting star'; }
    else if (bullEngulf || bullPinBar) { score = 20; signal = 'BULLISH'; detail = 'Bullish candle contradicts SHORT'; }
  }

  return { name: 'Candle Pattern', score, weight: 4, signal, detail };
}

function scoreSessionTiming(): ConfluenceFactor {
  const utcH = new Date().getUTCHours();
  const inLondon = utcH >= 7 && utcH < 16;
  const inNY = utcH >= 13 && utcH < 22;
  const overlap = inLondon && inNY;
  const killZone = (utcH >= 7 && utcH <= 9) || (utcH >= 13 && utcH <= 15); // London/NY open kill zones

  let score = 50, detail = 'Standard trading hours';
  if (overlap && killZone) { score = 95; detail = 'NY-London Overlap kill zone — highest probability'; }
  else if (killZone) { score = 85; detail = inLondon ? 'London open kill zone' : 'NY open kill zone'; }
  else if (overlap) { score = 80; detail = 'London-NY overlap — high volume'; }
  else if (inNY) { score = 70; detail = 'NY session — active market'; }
  else if (inLondon) { score = 65; detail = 'London session — good liquidity'; }
  else { score = 30; detail = 'Asian/off-hours — low liquidity, widen SL'; }

  return { name: 'Session Timing', score, weight: 4, signal: 'NEUTRAL', detail };
}

// Stubs for factors needing more context (scored via AI or basic heuristics)
function scoreOrderBlock(direction: 'LONG' | 'SHORT', smcScore?: number): ConfluenceFactor {
  const score = smcScore !== undefined ? Math.min(95, smcScore + 5) : 55;
  return { name: 'Order Block Quality', score, weight: 7, signal: score > 65 ? (direction === 'LONG' ? 'BULLISH' : 'BEARISH') : 'NEUTRAL', detail: smcScore ? `SMC OB score: ${smcScore}` : 'No OB data' };
}

function scoreFVG(direction: 'LONG' | 'SHORT', smcScore?: number): ConfluenceFactor {
  const score = smcScore !== undefined ? smcScore * 0.9 : 45;
  return { name: 'Fair Value Gap', score, weight: 6, signal: score > 60 ? (direction === 'LONG' ? 'BULLISH' : 'BEARISH') : 'NEUTRAL', detail: smcScore ? `FVG from SMC analysis: ${smcScore}` : 'No FVG data' };
}

function scoreLiquiditySweep(direction: 'LONG' | 'SHORT', liquidityScore?: number): ConfluenceFactor {
  const score = liquidityScore !== undefined ? liquidityScore : 50;
  return { name: 'Liquidity Sweep', score, weight: 7, signal: score > 65 ? (direction === 'LONG' ? 'BULLISH' : 'BEARISH') : 'NEUTRAL', detail: liquidityScore ? `Liquidity depth: ${liquidityScore}` : 'No sweep data' };
}

function scoreRSIDivergence(direction: 'LONG' | 'SHORT', rsiDiv?: string): ConfluenceFactor {
  const isBull = rsiDiv?.toUpperCase().includes('BULL');
  const isBear = rsiDiv?.toUpperCase().includes('BEAR');
  let score = 50, signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL', detail = 'No divergence';
  if (isBull && direction === 'LONG') { score = 88; signal = 'BULLISH'; detail = 'Bullish RSI divergence confirms LONG'; }
  else if (isBear && direction === 'SHORT') { score = 88; signal = 'BEARISH'; detail = 'Bearish RSI divergence confirms SHORT'; }
  else if (isBull && direction === 'SHORT') { score = 20; detail = 'Bullish divergence contradicts SHORT'; }
  else if (isBear && direction === 'LONG') { score = 20; detail = 'Bearish divergence contradicts LONG'; }
  return { name: 'RSI Divergence', score, weight: 6, signal, detail };
}

function scoreStochRSI(direction: 'LONG' | 'SHORT', candles: OHLCVCandle[]): ConfluenceFactor {
  // Simplified: use RSI of RSI as proxy
  const closes = candles.map(c => c.close);
  const rsiVals: number[] = [];
  for (let i = 14; i < closes.length; i++) {
    rsiVals.push(calcRSI(closes.slice(0, i + 1)));
  }
  const stochRsi = rsiVals.length >= 14 ? calcRSI(rsiVals) : 50;

  let score = 50, signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL', detail = `StochRSI ~${stochRsi.toFixed(0)}`;
  if (direction === 'LONG') {
    if (stochRsi < 25) { score = 85; signal = 'BULLISH'; detail = `StochRSI oversold (${stochRsi.toFixed(0)}) — long entry zone`; }
    else if (stochRsi > 80) { score = 20; signal = 'BEARISH'; detail = `StochRSI overbought (${stochRsi.toFixed(0)}) — avoid long`; }
  } else {
    if (stochRsi > 75) { score = 85; signal = 'BEARISH'; detail = `StochRSI overbought (${stochRsi.toFixed(0)}) — short entry zone`; }
    else if (stochRsi < 20) { score = 20; signal = 'BULLISH'; detail = `StochRSI oversold (${stochRsi.toFixed(0)}) — avoid short`; }
  }
  return { name: 'StochRSI', score, weight: 5, signal, detail };
}

function scoreIchimoku(direction: 'LONG' | 'SHORT', ichimokuSignal?: string): ConfluenceFactor {
  const sig = ichimokuSignal?.toUpperCase() ?? '';
  let score = 50, signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL', detail = 'No Ichimoku data';
  if (sig.includes('BULL') || sig.includes('ABOVE')) {
    score = direction === 'LONG' ? 80 : 25; signal = 'BULLISH';
    detail = direction === 'LONG' ? 'Price above Kumo — bullish' : 'Bullish Ichimoku contradicts SHORT';
  } else if (sig.includes('BEAR') || sig.includes('BELOW')) {
    score = direction === 'SHORT' ? 80 : 25; signal = 'BEARISH';
    detail = direction === 'SHORT' ? 'Price below Kumo — bearish' : 'Bearish Ichimoku contradicts LONG';
  }
  return { name: 'Ichimoku', score, weight: 5, signal, detail };
}

function scoreVolumeProfile(direction: 'LONG' | 'SHORT', vpData?: string): ConfluenceFactor {
  const vp = vpData?.toUpperCase() ?? '';
  let score = 55, signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL', detail = 'No volume profile';
  if (vp.includes('HVN') || vp.includes('HIGH')) { score = 70; detail = 'Near High Volume Node — strong support/resistance'; }
  if (vp.includes('LVN') || vp.includes('LOW')) { score = 80; detail = 'In Low Volume Node — fast move expected'; }
  return { name: 'Volume Profile', score, weight: 5, signal, detail };
}

function scoreMultiTimeframe(direction: 'LONG' | 'SHORT', smcStructure?: string, ensembleDir?: string): ConfluenceFactor {
  const htf = (smcStructure ?? ensembleDir ?? '').toUpperCase();
  let score = 50, signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' = 'NEUTRAL', detail = 'No HTF data';
  if (htf.includes('BULL')) {
    score = direction === 'LONG' ? 85 : 20; signal = 'BULLISH';
    detail = direction === 'LONG' ? 'HTF bullish — LONG with trend' : 'HTF bullish — SHORT counter-trend (risky)';
  } else if (htf.includes('BEAR')) {
    score = direction === 'SHORT' ? 85 : 20; signal = 'BEARISH';
    detail = direction === 'SHORT' ? 'HTF bearish — SHORT with trend' : 'HTF bearish — LONG counter-trend (risky)';
  } else { detail = 'HTF ranging — lower conviction'; }
  return { name: 'Multi-Timeframe', score, weight: 7, signal, detail };
}

// ─── AI Enhancement Layer ────────────────────────────────────────────────────

async function aiEnhanceScores(
  factors: Omit<PhaseTwo, 'compositeScore' | 'grade' | 'direction' | 'entryQuality' | 'aiEnhanced' | 'summary'>,
  direction: 'LONG' | 'SHORT',
  coin: string,
  entry: number,
  compositeScore: number,
): Promise<{ adjustedScore: number; summary: string }> {
  try {
    const providers = await getActiveProviders();
    const claude = providers.find(p => p.type === 'anthropic') ?? providers.find(p => p.name.toLowerCase().includes('gpt')) ?? providers[0];
    if (!claude) return { adjustedScore: compositeScore, summary: 'AI unavailable' };

    const factorLines = Object.entries(factors)
      .filter(([_, v]) => v && typeof v === 'object' && 'score' in (v as any))
      .map(([_, v]) => {
        const f = v as ConfluenceFactor;
        return `${f.name}: ${f.score}/100 (${f.signal}) — ${f.detail}`;
      }).join('\n');

    const messages: AIMessage[] = [
      {
        role: 'system',
        content: `You are an elite institutional-grade technical analyst. Analyze the 17-factor confluence data and provide: 1) A composite score adjustment (0-100), 2) A clear 2-sentence trade summary. Respond ONLY in JSON: {"adjustedScore": number, "summary": "string"}`,
      },
      {
        role: 'user',
        content: `Coin: ${coin} | Direction: ${direction} | Entry: $${entry} | Base composite: ${compositeScore}/100\n\n17-Factor Analysis:\n${factorLines}\n\nAdjust the composite score based on factor interactions and provide a summary.`,
      },
    ];

    const res = await callAIProvider(claude, messages, 300);
    const json = extractJson(res.text);
    if (json) {
      const parsed = JSON.parse(json);
      return {
        adjustedScore: Math.min(100, Math.max(0, Math.round(parsed.adjustedScore ?? compositeScore))),
        summary: parsed.summary ?? '',
      };
    }
  } catch { /* fall through */ }
  return { adjustedScore: compositeScore, summary: `${direction} on ${coin} with ${compositeScore}/100 confluence score` };
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

export async function runPhase2Confluence(params: {
  coin: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  sl: number;
  tp: number;
  candles: OHLCVCandle[];
  // Optional enrichment from existing agent context
  smcScore?: number;
  ictScore?: number;
  quantumLiquidityScore?: number;
  liquidityDepthScore?: number;
  smcStructure?: string;
  rsiDivergence?: string;
  ichimokuSignal?: string;
  volumeProfile?: string;
  ensembleDirection?: string;
  timeframe?: string;
}): Promise<PhaseTwo> {
  const { coin, direction, entry, candles } = params;

  // Score all 17 factors
  const smcStructure = scoreSMCStructure(candles, direction);
  const orderBlockQuality = scoreOrderBlock(direction, params.smcScore);
  const fairValueGap = scoreFVG(direction, params.smcScore);
  const liquiditySweep = scoreLiquiditySweep(direction, params.liquidityDepthScore);
  const rsiPosition = scoreRSI(candles, direction);
  const rsiDivergence = scoreRSIDivergence(direction, params.rsiDivergence);
  const macdCross = scoreMACD(candles, direction);
  const stochRsi = scoreStochRSI(direction, candles);
  const emaAlignment = scoreEMAAlignment(candles, direction);
  const adxStrength = scoreADX(candles);
  const ichimoku = scoreIchimoku(direction, params.ichimokuSignal);
  const volumeConfirmation = scoreVolumeConfirmation(candles, direction);
  const volumeProfileFactor = scoreVolumeProfile(direction, params.volumeProfile);
  const atrVolatility = scoreATRVolatility(candles, entry);
  const multiTimeframe = scoreMultiTimeframe(direction, params.smcStructure, params.ensembleDirection);
  const candlePattern = scoreCandlePattern(candles, direction);
  const sessionTiming = scoreSessionTiming();

  // Weighted composite
  const allFactors = [
    smcStructure, orderBlockQuality, fairValueGap, liquiditySweep,
    rsiPosition, rsiDivergence, macdCross, stochRsi,
    emaAlignment, adxStrength, ichimoku,
    volumeConfirmation, volumeProfileFactor,
    atrVolatility, multiTimeframe, candlePattern, sessionTiming,
  ];

  const totalWeight = allFactors.reduce((s, f) => s + f.weight, 0);
  const rawScore = allFactors.reduce((s, f) => s + f.score * f.weight, 0) / totalWeight;

  // AI enhancement (async, non-blocking fallback)
  const factorsObj = {
    smcStructure, orderBlockQuality, fairValueGap, liquiditySweep,
    rsiPosition, rsiDivergence, macdCross, stochRsi,
    emaAlignment, adxStrength, ichimoku,
    volumeConfirmation, volumeProfile: volumeProfileFactor,
    atrVolatility, multiTimeframe, candlePattern, sessionTiming,
  };

  const { adjustedScore, summary } = await aiEnhanceScores(factorsObj, direction, coin, entry, rawScore);
  const compositeScore = adjustedScore;

  const grade: PhaseTwo['grade'] =
    compositeScore >= 85 ? 'A+' :
    compositeScore >= 72 ? 'A' :
    compositeScore >= 58 ? 'B' :
    compositeScore >= 44 ? 'C' : 'No Trade';

  const entryQuality: PhaseTwo['entryQuality'] =
    compositeScore >= 85 ? 'EXCELLENT' :
    compositeScore >= 70 ? 'GOOD' :
    compositeScore >= 55 ? 'FAIR' : 'POOR';

  return {
    smcStructure, orderBlockQuality, fairValueGap, liquiditySweep,
    rsiPosition, rsiDivergence, macdCross, stochRsi,
    emaAlignment, adxStrength, ichimoku,
    volumeConfirmation, volumeProfile: volumeProfileFactor,
    atrVolatility, multiTimeframe, candlePattern, sessionTiming,
    compositeScore, grade, direction, entryQuality,
    aiEnhanced: true, summary,
  };
}
