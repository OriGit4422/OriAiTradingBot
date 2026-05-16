/**
 * Gold trading analysis module
 * Technical indicators + Multi-AI for XAUUSD signals
 */

import { callMultiAI } from './ai-providers';
import { getGoldCandles, GoldCandle } from "./gold-data";

export interface GoldSignal {
  type: 'BUY' | 'SELL' | 'NEUTRAL';
  entry: number;
  tp: number;
  sl: number;
  rrRatio: number;
  confidence: number;
  timeframe: string;
  reasoning: string;
  trend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
  strength: 'STRONG' | 'MODERATE' | 'WEAK';
  keyLevels: { support: number; resistance: number };
  indicators: {
    rsi: number;
    macd: { value: number; signal: number; histogram: number };
    ema20: number;
    ema50: number;
    atr: number;
    bbUpper: number;
    bbLower: number;
    bbMiddle: number;
  };
  generatedAt: number;
}

// ── Technical indicators ──────────────────────────────────────────────────────

function calcEMA(prices: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const ema: number[] = [];
  let prev = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  ema.push(prev);
  for (let i = period; i < prices.length; i++) {
    prev = prices[i] * k + prev * (1 - k);
    ema.push(prev);
  }
  return ema;
}

function calcRSI(closes: number[], period = 14): number {
  if (closes.length < period + 1) return 50;
  let gains = 0, losses = 0;
  for (let i = closes.length - period; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function calcMACD(closes: number[]): { value: number; signal: number; histogram: number } {
  if (closes.length < 35) return { value: 0, signal: 0, histogram: 0 };
  const ema12 = calcEMA(closes, 12);
  const ema26 = calcEMA(closes, 26);
  // Align lengths
  const len = Math.min(ema12.length, ema26.length);
  const macdLine = ema12.slice(-len).map((v, i) => v - ema26.slice(-len)[i]);
  const signalLine = calcEMA(macdLine, 9);
  const value = macdLine[macdLine.length - 1];
  const signal = signalLine[signalLine.length - 1];
  return { value, signal, histogram: value - signal };
}

function calcATR(candles: GoldCandle[], period = 14): number {
  if (candles.length < 2) return 10;
  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const prev = candles[i - 1].close;
    const curr = candles[i];
    trs.push(Math.max(curr.high - curr.low, Math.abs(curr.high - prev), Math.abs(curr.low - prev)));
  }
  const slice = trs.slice(-period);
  return slice.reduce((a, b) => a + b, 0) / slice.length;
}

function calcBollingerBands(closes: number[], period = 20, multiplier = 2) {
  const slice = closes.slice(-period);
  const mean = slice.reduce((a, b) => a + b, 0) / period;
  const std = Math.sqrt(slice.reduce((sum, v) => sum + (v - mean) ** 2, 0) / period);
  return { upper: mean + multiplier * std, lower: mean - multiplier * std, middle: mean };
}

function findSupportResistance(candles: GoldCandle[]): { support: number; resistance: number } {
  const recent = candles.slice(-50);
  const highs = recent.map(c => c.high).sort((a, b) => b - a);
  const lows  = recent.map(c => c.low).sort((a, b) => a - b);
  return {
    resistance: highs[Math.floor(highs.length * 0.1)],
    support:    lows[Math.floor(lows.length * 0.1)],
  };
}

// ── Signal generation ─────────────────────────────────────────────────────────

export async function analyzeGold(timeframe = '1h'): Promise<GoldSignal> {
  const candles = await getGoldCandles(timeframe, 200);
  if (candles.length < 50) throw new Error('Insufficient gold candle data');

  const closes = candles.map(c => c.close);
  const currentPrice = closes[closes.length - 1];

  const rsi = calcRSI(closes);
  const macd = calcMACD(closes);
  const atr = calcATR(candles);
  const ema20arr = calcEMA(closes, 20);
  const ema50arr = calcEMA(closes, 50);
  const ema20 = ema20arr[ema20arr.length - 1];
  const ema50 = ema50arr[ema50arr.length - 1];
  const bb = calcBollingerBands(closes);
  const { support, resistance } = findSupportResistance(candles);

  // Trend determination
  let trendScore = 0;
  if (currentPrice > ema20) trendScore++;
  if (currentPrice > ema50) trendScore++;
  if (ema20 > ema50) trendScore++;
  if (macd.histogram > 0) trendScore++;
  if (rsi > 50) trendScore++;

  const trend: GoldSignal['trend'] = trendScore >= 4 ? 'BULLISH' : trendScore <= 1 ? 'BEARISH' : 'SIDEWAYS';

  // Strength
  const rsiExtreme = rsi > 65 || rsi < 35;
  const macdStrong = Math.abs(macd.histogram) > atr * 0.3;
  const strength: GoldSignal['strength'] = (rsiExtreme && macdStrong) ? 'STRONG' : (rsiExtreme || macdStrong) ? 'MODERATE' : 'WEAK';

  // Signal type
  let signalType: 'BUY' | 'SELL' | 'NEUTRAL' = 'NEUTRAL';
  if (trend === 'BULLISH' && rsi < 70 && macd.histogram > 0) signalType = 'BUY';
  else if (trend === 'BEARISH' && rsi > 30 && macd.histogram < 0) signalType = 'SELL';

  // Levels with min 2.5 R:R
  const sl = signalType === 'BUY'
    ? currentPrice - atr * 1.5
    : signalType === 'SELL'
    ? currentPrice + atr * 1.5
    : currentPrice - atr * 1.5;

  const minTP = Math.abs(currentPrice - sl) * 2.5;
  const tp = signalType === 'BUY'
    ? currentPrice + Math.max(minTP, atr * 4.0)
    : signalType === 'SELL'
    ? currentPrice - Math.max(minTP, atr * 4.0)
    : currentPrice + minTP;

  const rrRatio = Math.abs(tp - currentPrice) / Math.max(Math.abs(currentPrice - sl), 0.0001);

  // Base confidence
  let confidence = 50;
  if (trend !== 'SIDEWAYS') confidence += 15;
  if (strength === 'STRONG') confidence += 20;
  else if (strength === 'MODERATE') confidence += 10;
  if (rsi > 30 && rsi < 70) confidence += 5; // not overbought/oversold
  if (rrRatio >= 2.5) confidence += 5;
  if (rrRatio >= 3.5) confidence += 5;
  if (signalType === 'NEUTRAL') confidence = Math.min(confidence, 45);
  confidence = Math.min(95, Math.max(30, confidence));

  // Build indicators summary for AI
  const indicatorSummary = `
Gold (XAUUSD) Technical Analysis — ${timeframe} timeframe
Current Price: $${currentPrice.toFixed(2)}
EMA20: $${ema20.toFixed(2)} | EMA50: $${ema50.toFixed(2)}
RSI(14): ${rsi.toFixed(1)}
MACD: value=${macd.value.toFixed(2)}, signal=${macd.signal.toFixed(2)}, histogram=${macd.histogram.toFixed(2)}
ATR(14): $${atr.toFixed(2)}
Bollinger Bands: upper=$${bb.upper.toFixed(2)}, middle=$${bb.middle.toFixed(2)}, lower=$${bb.lower.toFixed(2)}
Support: $${support.toFixed(2)} | Resistance: $${resistance.toFixed(2)}
Trend: ${trend} (score ${trendScore}/5) | Strength: ${strength}
Proposed Signal: ${signalType} @ $${currentPrice.toFixed(2)}
  Entry: $${currentPrice.toFixed(2)} | TP: $${tp.toFixed(2)} | SL: $${sl.toFixed(2)} | R:R=${rrRatio.toFixed(2)}`;

  // Ask Claude AI for reasoning and confidence adjustment
  let reasoning = `${trend} trend on ${timeframe}. RSI at ${rsi.toFixed(0)}, MACD histogram ${macd.histogram > 0 ? 'positive' : 'negative'}.`;
  let finalConfidence = confidence;

  try {
    const { text } = await callMultiAI([{
      role: 'user',
      content: `You are a gold trading expert. Analyze this technical setup and provide:
1. A confidence score (0-100) for the proposed signal
2. Brief reasoning (2-3 sentences)

${indicatorSummary}

Respond in JSON only:
{"confidence": <number>, "reasoning": "<string>", "verdict": "STRONG_${signalType}" or "${signalType}" or "NEUTRAL" or "AVOID"}`,
    }], 400);

    const match = text.match(/\{[\s\S]*\}/);
    if (match) {
      const parsed = JSON.parse(match[0]);
      finalConfidence = Math.min(95, Math.max(30, parsed.confidence ?? confidence));
      reasoning = parsed.reasoning ?? reasoning;
      if (parsed.verdict === 'AVOID' || parsed.verdict === 'NEUTRAL') {
        signalType = 'NEUTRAL';
        finalConfidence = Math.min(finalConfidence, 45);
      }
    }
  } catch {
    // Use technical-only confidence and reasoning
  }

  return {
    type: signalType,
    entry: currentPrice,
    tp,
    sl,
    rrRatio: parseFloat(rrRatio.toFixed(2)),
    confidence: finalConfidence,
    timeframe,
    reasoning,
    trend,
    strength,
    keyLevels: { support, resistance },
    indicators: {
      rsi: parseFloat(rsi.toFixed(1)),
      macd: {
        value:     parseFloat(macd.value.toFixed(2)),
        signal:    parseFloat(macd.signal.toFixed(2)),
        histogram: parseFloat(macd.histogram.toFixed(2)),
      },
      ema20: parseFloat(ema20.toFixed(2)),
      ema50: parseFloat(ema50.toFixed(2)),
      atr:   parseFloat(atr.toFixed(2)),
      bbUpper:  parseFloat(bb.upper.toFixed(2)),
      bbLower:  parseFloat(bb.lower.toFixed(2)),
      bbMiddle: parseFloat(bb.middle.toFixed(2)),
    },
    generatedAt: Date.now(),
  };
}
