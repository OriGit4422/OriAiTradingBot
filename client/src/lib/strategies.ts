import { BinanceKline } from './binance';

export interface SMCAnalysis {
  orderBlocks: { price: number; type: 'BULLISH' | 'BEARISH'; strength: number }[];
  fvg: { top: number; bottom: number; type: 'BULLISH' | 'BEARISH' }[];
  bos: { price: number; type: 'BULLISH' | 'BEARISH' }[];
  choch: { price: number; type: 'BULLISH' | 'BEARISH' }[];
  liquidity: { price: number; label: string; strength: number }[];
  quantumZones: { price: number; strength: number; type: string }[];
  liquidityClusters: { priceLevel: number; density: number; type: 'SUPPORT' | 'RESISTANCE' }[];
  marketPhase: 'ACCUMULATION' | 'MANIPULATION' | 'DISTRIBUTION' | 'TRENDING';
  volumeForecast: { expectedSpike: boolean; direction: 'UP' | 'DOWN' | 'NEUTRAL'; magnitude: number };
  volatilityForecast: { expansion: boolean; currentVol: number; avgVol: number; ratio: number };
  whaleActivity: { detected: boolean; direction: 'BUYING' | 'SELLING' | 'NEUTRAL'; intensity: number };
  adaptiveRisk: { kellyFraction: number; optimalSize: number; dynamicSL: number; dynamicTP: number; riskReward: number };
  ensembleScore: { direction: 'LONG' | 'SHORT' | 'NEUTRAL'; confidence: number; models: ModelScore[] };
  indicators: {
    rsi: number;
    macd: { macd: number; signal: number; histogram: number };
    ema: { ema9: number; ema21: number; ema50: number; ema200: number };
    adx: number;
    atr: number;
    volumeProfile: 'HIGH' | 'NORMAL' | 'LOW';
    trendStrength: number;
    rsiDivergence: 'BULLISH' | 'BEARISH' | 'NONE';
    marketStructure: 'BULLISH' | 'BEARISH' | 'RANGING';
    bollingerWidth: number;
    stochRsi: { k: number; d: number };
    obv: number;
    vwap: number;
    ichimoku: { tenkan: number; kijun: number; signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' };
  };
}

interface ModelScore {
  name: string;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  confidence: number;
  weight: number;
}

export function analyzeMarket(data: BinanceKline[]): SMCAnalysis {
  const emptyIndicators = {
    rsi: 50, macd: { macd: 0, signal: 0, histogram: 0 },
    ema: { ema9: 0, ema21: 0, ema50: 0, ema200: 0 },
    adx: 25, atr: 0, volumeProfile: 'NORMAL' as const,
    trendStrength: 50, rsiDivergence: 'NONE' as const,
    marketStructure: 'RANGING' as const,
    bollingerWidth: 0, stochRsi: { k: 50, d: 50 }, obv: 0, vwap: 0,
    ichimoku: { tenkan: 0, kijun: 0, signal: 'NEUTRAL' as const },
  };

  const emptyResult: SMCAnalysis = {
    orderBlocks: [], fvg: [], bos: [], choch: [], liquidity: [],
    quantumZones: [], liquidityClusters: [], marketPhase: 'TRENDING',
    volumeForecast: { expectedSpike: false, direction: 'NEUTRAL', magnitude: 0 },
    volatilityForecast: { expansion: false, currentVol: 0, avgVol: 0, ratio: 1 },
    whaleActivity: { detected: false, direction: 'NEUTRAL', intensity: 0 },
    adaptiveRisk: { kellyFraction: 0.02, optimalSize: 1, dynamicSL: 0, dynamicTP: 0, riskReward: 2 },
    ensembleScore: { direction: 'NEUTRAL', confidence: 50, models: [] },
    indicators: emptyIndicators,
  };

  if (data.length < 50) return emptyResult;

  const highs = data.map(d => d.high);
  const lows = data.map(d => d.low);
  const closes = data.map(d => d.close);
  const volumes = data.map(d => d.volume);
  const price = closes[closes.length - 1];

  const maxHigh = Math.max(...highs.slice(-100));
  const minLow = Math.min(...lows.slice(-100));

  const rsi = calculateRSI(data);
  const macd = calculateMACD(data);
  const ema = calculateEMAs(data);
  const adx = calculateADX(data);
  const atr = calculateATR(data);
  const volumeProfile = getVolumeProfile(data);
  const trendStrength = calculateTrendStrength(data, ema, adx, rsi);
  const rsiDivergence = detectRSIDivergence(data);
  const marketStructure = detectMarketStructure(data);
  const bollingerWidth = calculateBollingerWidth(data);
  const stochRsi = calculateStochRSI(data);
  const obv = calculateOBV(data);
  const vwap = calculateVWAP(data);
  const ichimoku = calculateIchimoku(data);

  const quantumZones = calculateQuantumZones(data, maxHigh, minLow);
  const liquidityClusters = calculateLiquidityClusters(data);
  const volumeForecast = forecastVolume(data);
  const volatilityForecast = forecastVolatility(data, atr);
  const whaleActivity = detectWhaleActivity(data);

  const recentVol = data.slice(-20).reduce((acc, d) => acc + d.volume, 0);
  const avgVol = data.slice(-100, -20).reduce((acc, d) => acc + d.volume, 0) / 4;
  let phase: SMCAnalysis['marketPhase'] = 'TRENDING';
  if (recentVol < avgVol * 0.8) phase = 'ACCUMULATION';
  else if (recentVol > avgVol * 1.5) phase = 'MANIPULATION';

  const fvg: SMCAnalysis['fvg'] = [];
  for (let i = data.length - 20; i < data.length - 1; i++) {
    if (i > 0 && i + 1 < data.length) {
      if (data[i+1].low > data[i-1].high) fvg.push({ top: data[i+1].low, bottom: data[i-1].high, type: 'BULLISH' });
      if (data[i+1].high < data[i-1].low) fvg.push({ top: data[i-1].low, bottom: data[i+1].high, type: 'BEARISH' });
    }
  }

  const orderBlocks = detectOrderBlocks(data);
  const bos = detectBOS(data);
  const choch = detectCHoCH(data);
  const liquidity = detectLiquidityZones(data);

  const adaptiveRisk = calculateAdaptiveRisk(data, atr, rsi, adx, price);

  const ensembleScore = runMultiModelEnsemble(data, {
    rsi, macd, ema, adx, atr, volumeProfile, trendStrength,
    rsiDivergence, marketStructure, bollingerWidth, stochRsi, obv, vwap, ichimoku
  }, phase, whaleActivity, volumeForecast);

  return {
    orderBlocks,
    fvg: fvg.slice(-5),
    bos,
    choch,
    liquidity,
    quantumZones,
    liquidityClusters,
    marketPhase: phase,
    volumeForecast,
    volatilityForecast,
    whaleActivity,
    adaptiveRisk,
    ensembleScore,
    indicators: {
      rsi, macd, ema, adx, atr, volumeProfile, trendStrength,
      rsiDivergence, marketStructure, bollingerWidth, stochRsi, obv, vwap, ichimoku
    },
  };
}

function runMultiModelEnsemble(
  data: BinanceKline[],
  indicators: any,
  phase: string,
  whale: any,
  volForecast: any
): SMCAnalysis['ensembleScore'] {
  const models: ModelScore[] = [];

  const trendModel = (): ModelScore => {
    let score = 0;
    const { ema, macd, adx } = indicators;
    const price = data[data.length - 1].close;
    if (price > ema.ema21) score += 2;
    if (price > ema.ema50) score += 2;
    if (ema.ema9 > ema.ema21) score += 1.5;
    if (ema.ema21 > ema.ema50) score += 1.5;
    if (macd.histogram > 0) score += 1.5;
    if (adx > 25) score += 1;
    if (price < ema.ema21) score -= 2;
    if (price < ema.ema50) score -= 2;
    if (ema.ema9 < ema.ema21) score -= 1.5;
    if (macd.histogram < 0) score -= 1.5;
    const direction = score > 2 ? 'LONG' : score < -2 ? 'SHORT' : 'NEUTRAL';
    return { name: 'Trend Following', direction, confidence: Math.min(95, 50 + Math.abs(score) * 5), weight: 0.25 };
  };

  const meanReversionModel = (): ModelScore => {
    const { rsi, bollingerWidth, stochRsi } = indicators;
    let score = 0;
    if (rsi < 30) score += 3;
    else if (rsi < 40) score += 1;
    else if (rsi > 70) score -= 3;
    else if (rsi > 60) score -= 1;
    if (stochRsi.k < 20) score += 2;
    else if (stochRsi.k > 80) score -= 2;
    if (bollingerWidth > 3) { score += (rsi < 50 ? 1 : -1); }
    const direction = score > 2 ? 'LONG' : score < -2 ? 'SHORT' : 'NEUTRAL';
    return { name: 'Mean Reversion', direction, confidence: Math.min(95, 50 + Math.abs(score) * 6), weight: 0.15 };
  };

  const momentumModel = (): ModelScore => {
    const { macd, obv, rsi } = indicators;
    let score = 0;
    if (macd.macd > macd.signal && macd.histogram > 0) score += 3;
    if (macd.macd < macd.signal && macd.histogram < 0) score -= 3;
    const recentOBV = data.slice(-5).reduce((s, d) => s + (d.close > data[data.indexOf(d) - 1]?.close ? d.volume : -d.volume), 0);
    if (recentOBV > 0) score += 1.5;
    else score -= 1.5;
    if (rsi > 50 && rsi < 70) score += 1;
    if (rsi < 50 && rsi > 30) score -= 1;
    const direction = score > 2 ? 'LONG' : score < -2 ? 'SHORT' : 'NEUTRAL';
    return { name: 'Momentum', direction, confidence: Math.min(95, 50 + Math.abs(score) * 5), weight: 0.2 };
  };

  const structureModel = (): ModelScore => {
    const { marketStructure, rsiDivergence } = indicators;
    let score = 0;
    if (marketStructure === 'BULLISH') score += 3;
    if (marketStructure === 'BEARISH') score -= 3;
    if (rsiDivergence === 'BULLISH') score += 2;
    if (rsiDivergence === 'BEARISH') score -= 2;
    if (phase === 'ACCUMULATION') score += 1;
    if (phase === 'DISTRIBUTION') score -= 1;
    const direction = score > 2 ? 'LONG' : score < -2 ? 'SHORT' : 'NEUTRAL';
    return { name: 'Market Structure', direction, confidence: Math.min(95, 50 + Math.abs(score) * 5), weight: 0.2 };
  };

  const bayesianModel = (): ModelScore => {
    const { rsi, macd, ema, vwap } = indicators;
    const price = data[data.length - 1].close;
    let priorBull = 0.5;
    if (price > vwap) priorBull += 0.1;
    if (rsi > 50) priorBull += 0.05;
    if (macd.histogram > 0) priorBull += 0.1;
    if (price > ema.ema21) priorBull += 0.1;
    if (whale.detected) {
      if (whale.direction === 'BUYING') priorBull += 0.15;
      if (whale.direction === 'SELLING') priorBull -= 0.15;
    }
    priorBull = Math.max(0.1, Math.min(0.9, priorBull));
    const direction = priorBull > 0.6 ? 'LONG' : priorBull < 0.4 ? 'SHORT' : 'NEUTRAL';
    return { name: 'Bayesian Inference', direction, confidence: Math.round(Math.max(priorBull, 1 - priorBull) * 100), weight: 0.2 };
  };

  models.push(trendModel(), meanReversionModel(), momentumModel(), structureModel(), bayesianModel());

  let weightedLong = 0, weightedShort = 0, totalWeight = 0;
  for (const m of models) {
    if (m.direction === 'LONG') weightedLong += m.confidence * m.weight;
    else if (m.direction === 'SHORT') weightedShort += m.confidence * m.weight;
    totalWeight += m.weight;
  }

  const longScore = weightedLong / totalWeight;
  const shortScore = weightedShort / totalWeight;
  const direction = longScore > shortScore + 10 ? 'LONG' : shortScore > longScore + 10 ? 'SHORT' : 'NEUTRAL';
  const confidence = Math.round(Math.max(longScore, shortScore));

  return { direction, confidence: Math.min(98, confidence), models };
}

function calculateQuantumZones(data: BinanceKline[], maxHigh: number, minLow: number): SMCAnalysis['quantumZones'] {
  const range = maxHigh - minLow;
  const zones: SMCAnalysis['quantumZones']  = [];
  const fibLevels = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1];

  for (const fib of fibLevels) {
    const priceLevel = minLow + range * fib;
    const closes = data.slice(-50).map(d => d.close);
    const touches = closes.filter(c => Math.abs(c - priceLevel) / priceLevel < 0.005).length;
    const volumeAtLevel = data.slice(-50)
      .filter(d => d.low <= priceLevel && d.high >= priceLevel)
      .reduce((sum, d) => sum + d.volume, 0);
    const avgVol = data.slice(-50).reduce((s, d) => s + d.volume, 0) / 50;
    const strength = Math.min(1, (touches / 10) + (volumeAtLevel / (avgVol * 5)));

    zones.push({
      price: priceLevel,
      strength,
      type: fib < 0.5 ? 'SUPPORT' : fib > 0.5 ? 'RESISTANCE' : 'PIVOT',
    });
  }

  return zones.sort((a, b) => b.strength - a.strength);
}

function calculateLiquidityClusters(data: BinanceKline[]): SMCAnalysis['liquidityClusters'] {
  const clusters: SMCAnalysis['liquidityClusters'] = [];
  const recent = data.slice(-100);
  const priceRange = Math.max(...recent.map(d => d.high)) - Math.min(...recent.map(d => d.low));
  const bucketSize = priceRange / 20;
  const minPrice = Math.min(...recent.map(d => d.low));

  const volumeProfile: Record<number, number> = {};
  for (const candle of recent) {
    const bucket = Math.floor((candle.close - minPrice) / bucketSize);
    volumeProfile[bucket] = (volumeProfile[bucket] || 0) + candle.volume;
  }

  const maxVol = Math.max(...Object.values(volumeProfile));

  for (const [bucket, vol] of Object.entries(volumeProfile)) {
    const density = vol / maxVol;
    if (density > 0.3) {
      const priceLevel = minPrice + parseInt(bucket) * bucketSize + bucketSize / 2;
      const currentPrice = data[data.length - 1].close;
      clusters.push({
        priceLevel,
        density,
        type: priceLevel < currentPrice ? 'SUPPORT' : 'RESISTANCE',
      });
    }
  }

  return clusters.sort((a, b) => b.density - a.density).slice(0, 8);
}

function forecastVolume(data: BinanceKline[]): SMCAnalysis['volumeForecast'] {
  const recent = data.slice(-10);
  const older = data.slice(-30, -10);
  const recentAvg = recent.reduce((s, d) => s + d.volume, 0) / recent.length;
  const olderAvg = older.reduce((s, d) => s + d.volume, 0) / Math.max(1, older.length);

  const volumeTrend = recent.map((d, i) => i > 0 ? d.volume / recent[i - 1].volume : 1);
  const avgTrend = volumeTrend.reduce((s, v) => s + v, 0) / volumeTrend.length;
  const isAccelerating = avgTrend > 1.1;
  const priceTrend = recent[recent.length - 1].close > recent[0].close ? 'UP' : 'DOWN';

  return {
    expectedSpike: recentAvg > olderAvg * 1.3 || isAccelerating,
    direction: recentAvg > olderAvg * 1.2 ? (priceTrend as 'UP' | 'DOWN') : 'NEUTRAL',
    magnitude: Math.round((recentAvg / Math.max(1, olderAvg)) * 100) / 100,
  };
}

function forecastVolatility(data: BinanceKline[], atr: number): SMCAnalysis['volatilityForecast'] {
  const recent = data.slice(-10);
  const older = data.slice(-30, -10);
  const recentVol = recent.reduce((s, d) => s + (d.high - d.low), 0) / recent.length;
  const olderVol = older.reduce((s, d) => s + (d.high - d.low), 0) / Math.max(1, older.length);
  const ratio = recentVol / Math.max(0.0001, olderVol);

  return {
    expansion: ratio > 1.3,
    currentVol: recentVol,
    avgVol: olderVol,
    ratio: Math.round(ratio * 100) / 100,
  };
}

function detectWhaleActivity(data: BinanceKline[]): SMCAnalysis['whaleActivity'] {
  const recent = data.slice(-5);
  const avgVol = data.slice(-50).reduce((s, d) => s + d.volume, 0) / 50;
  const whaleCandles = recent.filter(d => d.volume > avgVol * 2.5);

  if (whaleCandles.length === 0) return { detected: false, direction: 'NEUTRAL', intensity: 0 };

  const buyingPressure = whaleCandles.filter(d => d.close > d.open).reduce((s, d) => s + d.volume, 0);
  const sellingPressure = whaleCandles.filter(d => d.close <= d.open).reduce((s, d) => s + d.volume, 0);
  const total = buyingPressure + sellingPressure;
  const direction = buyingPressure > sellingPressure * 1.3 ? 'BUYING' : sellingPressure > buyingPressure * 1.3 ? 'SELLING' : 'NEUTRAL';
  const intensity = Math.min(100, Math.round((Math.max(buyingPressure, sellingPressure) / Math.max(1, total)) * 100));

  return { detected: true, direction, intensity };
}

function calculateAdaptiveRisk(data: BinanceKline[], atr: number, rsi: number, adx: number, price: number): SMCAnalysis['adaptiveRisk'] {
  const winRate = 0.55 + (adx > 25 ? 0.05 : -0.05) + (rsi > 30 && rsi < 70 ? 0.03 : -0.03);
  const avgWin = atr * 3;
  const avgLoss = atr * 1.5;
  const kellyFraction = Math.max(0.01, Math.min(0.25, (winRate - (1 - winRate) / (avgWin / avgLoss))));

  const volatilityAdj = atr / price;
  const sizeFactor = volatilityAdj > 0.03 ? 0.5 : volatilityAdj > 0.02 ? 0.75 : 1;
  const optimalSize = kellyFraction * sizeFactor;

  const trendStrength = adx > 30 ? 1.2 : adx > 20 ? 1 : 0.8;
  const dynamicSL = atr * 1.5 * (1 / trendStrength);
  const dynamicTP = atr * 3 * trendStrength;
  const riskReward = dynamicTP / Math.max(0.0001, dynamicSL);

  return { kellyFraction, optimalSize, dynamicSL, dynamicTP, riskReward: Math.round(riskReward * 100) / 100 };
}

function detectOrderBlocks(data: BinanceKline[]): SMCAnalysis['orderBlocks'] {
  const blocks: SMCAnalysis['orderBlocks'] = [];
  const recent = data.slice(-50);

  for (let i = 2; i < recent.length - 2; i++) {
    const prevCandles = recent.slice(i - 2, i);
    const current = recent[i];
    const nextCandles = recent.slice(i + 1, i + 3);

    const isBullishOB = prevCandles.every(c => c.close < c.open) &&
      current.close > current.open &&
      nextCandles.some(c => c.close > current.high);

    const isBearishOB = prevCandles.every(c => c.close > c.open) &&
      current.close < current.open &&
      nextCandles.some(c => c.close < current.low);

    if (isBullishOB) {
      const vol = current.volume / (data.slice(-50).reduce((s, d) => s + d.volume, 0) / 50);
      blocks.push({ price: current.low, type: 'BULLISH', strength: Math.min(1, vol / 2) });
    }
    if (isBearishOB) {
      const vol = current.volume / (data.slice(-50).reduce((s, d) => s + d.volume, 0) / 50);
      blocks.push({ price: current.high, type: 'BEARISH', strength: Math.min(1, vol / 2) });
    }
  }

  if (blocks.length === 0) {
    const minLow = Math.min(...recent.map(d => d.low));
    const maxHigh = Math.max(...recent.map(d => d.high));
    blocks.push({ price: minLow, type: 'BULLISH', strength: 0.5 });
    blocks.push({ price: maxHigh, type: 'BEARISH', strength: 0.5 });
  }

  return blocks.slice(-6);
}

function detectCHoCH(data: BinanceKline[]): SMCAnalysis['choch'] {
  if (data.length < 30) return [];
  const choch: SMCAnalysis['choch'] = [];
  const recent = data.slice(-30);

  const swingHighs: { price: number; index: number }[] = [];
  const swingLows: { price: number; index: number }[] = [];

  for (let i = 2; i < recent.length - 2; i++) {
    if (recent[i].high > recent[i-1].high && recent[i].high > recent[i+1].high) {
      swingHighs.push({ price: recent[i].high, index: i });
    }
    if (recent[i].low < recent[i-1].low && recent[i].low < recent[i+1].low) {
      swingLows.push({ price: recent[i].low, index: i });
    }
  }

  for (let i = 1; i < swingHighs.length; i++) {
    if (swingHighs[i].price < swingHighs[i-1].price &&
        swingLows.some(l => l.index > swingHighs[i-1].index && l.index < swingHighs[i].index && l.price < swingLows.filter(sl => sl.index < swingHighs[i-1].index).pop()?.price!)) {
      choch.push({ price: swingHighs[i].price, type: 'BEARISH' });
    }
  }

  for (let i = 1; i < swingLows.length; i++) {
    if (swingLows[i].price > swingLows[i-1].price &&
        swingHighs.some(h => h.index > swingLows[i-1].index && h.index < swingLows[i].index && h.price > swingHighs.filter(sh => sh.index < swingLows[i-1].index).pop()?.price!)) {
      choch.push({ price: swingLows[i].price, type: 'BULLISH' });
    }
  }

  return choch.slice(-3);
}

function detectLiquidityZones(data: BinanceKline[]): SMCAnalysis['liquidity'] {
  const recent = data.slice(-100);
  const zones: SMCAnalysis['liquidity'] = [];

  const swingHighs = [];
  const swingLows = [];
  for (let i = 3; i < recent.length - 3; i++) {
    if (recent[i].high >= recent[i-1].high && recent[i].high >= recent[i-2].high &&
        recent[i].high >= recent[i+1].high && recent[i].high >= recent[i+2].high) {
      swingHighs.push(recent[i].high);
    }
    if (recent[i].low <= recent[i-1].low && recent[i].low <= recent[i-2].low &&
        recent[i].low <= recent[i+1].low && recent[i].low <= recent[i+2].low) {
      swingLows.push(recent[i].low);
    }
  }

  const highClusters = clusterPrices(swingHighs);
  const lowClusters = clusterPrices(swingLows);

  for (const h of highClusters) {
    zones.push({ price: h.price, label: 'BSL', strength: h.count / Math.max(1, swingHighs.length) });
  }
  for (const l of lowClusters) {
    zones.push({ price: l.price, label: 'SSL', strength: l.count / Math.max(1, swingLows.length) });
  }

  if (zones.length === 0) {
    zones.push({ price: Math.max(...recent.map(d => d.high)), label: 'BSL', strength: 0.5 });
    zones.push({ price: Math.min(...recent.map(d => d.low)), label: 'SSL', strength: 0.5 });
  }

  return zones.slice(0, 6);
}

function clusterPrices(prices: number[]): { price: number; count: number }[] {
  if (prices.length === 0) return [];
  const sorted = [...prices].sort((a, b) => a - b);
  const clusters: { price: number; count: number }[] = [];
  let clusterStart = sorted[0];
  let clusterPrices = [sorted[0]];
  const threshold = sorted[0] * 0.003;

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i] - clusterStart < threshold) {
      clusterPrices.push(sorted[i]);
    } else {
      clusters.push({
        price: clusterPrices.reduce((s, p) => s + p, 0) / clusterPrices.length,
        count: clusterPrices.length,
      });
      clusterStart = sorted[i];
      clusterPrices = [sorted[i]];
    }
  }
  clusters.push({
    price: clusterPrices.reduce((s, p) => s + p, 0) / clusterPrices.length,
    count: clusterPrices.length,
  });

  return clusters.sort((a, b) => b.count - a.count).slice(0, 5);
}

function calculateBollingerWidth(data: BinanceKline[], period = 20): number {
  if (data.length < period) return 0;
  const closes = data.slice(-period).map(d => d.close);
  const sma = closes.reduce((a, b) => a + b, 0) / period;
  const variance = closes.reduce((sum, c) => sum + Math.pow(c - sma, 2), 0) / period;
  const stdDev = Math.sqrt(variance);
  return (stdDev * 4 / sma) * 100;
}

function calculateStochRSI(data: BinanceKline[], period = 14): { k: number; d: number } {
  if (data.length < period * 2) return { k: 50, d: 50 };
  const rsiValues: number[] = [];
  for (let i = period; i <= data.length; i++) {
    rsiValues.push(calculateRSI(data.slice(0, i), period));
  }
  const recent = rsiValues.slice(-period);
  const minRsi = Math.min(...recent);
  const maxRsi = Math.max(...recent);
  const k = maxRsi === minRsi ? 50 : ((rsiValues[rsiValues.length - 1] - minRsi) / (maxRsi - minRsi)) * 100;
  const dPeriod = Math.min(3, recent.length);
  const d = recent.slice(-dPeriod).reduce((s, v) => s + v, 0) / dPeriod;
  return { k: Math.round(k), d: Math.round(((d - minRsi) / Math.max(1, maxRsi - minRsi)) * 100) };
}

function calculateOBV(data: BinanceKline[]): number {
  let obv = 0;
  for (let i = 1; i < data.length; i++) {
    if (data[i].close > data[i-1].close) obv += data[i].volume;
    else if (data[i].close < data[i-1].close) obv -= data[i].volume;
  }
  return obv;
}

function calculateVWAP(data: BinanceKline[]): number {
  const recent = data.slice(-50);
  let cumulativeVP = 0, cumulativeVol = 0;
  for (const d of recent) {
    const typicalPrice = (d.high + d.low + d.close) / 3;
    cumulativeVP += typicalPrice * d.volume;
    cumulativeVol += d.volume;
  }
  return cumulativeVol > 0 ? cumulativeVP / cumulativeVol : data[data.length - 1].close;
}

function calculateIchimoku(data: BinanceKline[]): { tenkan: number; kijun: number; signal: 'BULLISH' | 'BEARISH' | 'NEUTRAL' } {
  const tenkanPeriod = Math.min(9, data.length);
  const kijunPeriod = Math.min(26, data.length);
  const tenkanData = data.slice(-tenkanPeriod);
  const kijunData = data.slice(-kijunPeriod);
  const tenkan = (Math.max(...tenkanData.map(d => d.high)) + Math.min(...tenkanData.map(d => d.low))) / 2;
  const kijun = (Math.max(...kijunData.map(d => d.high)) + Math.min(...kijunData.map(d => d.low))) / 2;
  const price = data[data.length - 1].close;
  const signal = price > tenkan && price > kijun && tenkan > kijun ? 'BULLISH'
    : price < tenkan && price < kijun && tenkan < kijun ? 'BEARISH' : 'NEUTRAL';
  return { tenkan, kijun, signal };
}

export function getQuantumSignal(symbol: string, price: number, data: BinanceKline[]) {
  const analysis = analyzeMarket(data);
  const { rsi, macd, ema, adx, atr, volumeProfile, trendStrength, rsiDivergence, marketStructure, stochRsi, ichimoku } = analysis.indicators;

  let type: 'LONG' | 'SHORT' = 'LONG';
  let strategy: 'SMC' | 'ICT' | 'MMC' | 'CRT' | 'QL' | 'SNR' = 'SMC';
  const MAJOR_COINS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP'];
  let confidence = MAJOR_COINS.includes(symbol.toUpperCase()) ? 78 : 70;
  let entryPrice = price;

  if (analysis.ensembleScore.direction !== 'NEUTRAL' && analysis.ensembleScore.confidence > 75) {
    type = analysis.ensembleScore.direction as 'LONG' | 'SHORT';
    confidence = analysis.ensembleScore.confidence;
    strategy = 'QL';
  } else {
    const bullishOB = analysis.orderBlocks.find(ob => ob.type === 'BULLISH');
    const bearishOB = analysis.orderBlocks.find(ob => ob.type === 'BEARISH');
    const nearQuantum = analysis.quantumZones.find(z => Math.abs(z.price - price) / price < 0.01);

    if (nearQuantum && analysis.marketPhase === 'ACCUMULATION') {
      strategy = 'QL';
      if (price < nearQuantum.price * 1.01) {
        type = 'LONG'; entryPrice = nearQuantum.price; confidence = 92;
      } else {
        type = 'SHORT'; entryPrice = nearQuantum.price; confidence = 85;
      }
    } else if (analysis.choch.length > 0) {
      strategy = 'ICT';
      const latestChoch = analysis.choch[analysis.choch.length - 1];
      type = latestChoch.type === 'BULLISH' ? 'LONG' : 'SHORT';
      entryPrice = latestChoch.price;
      confidence = 86;
    } else if (rsi > 70 || (rsi > 60 && adx < 20)) {
      strategy = 'CRT'; type = 'SHORT';
      entryPrice = bearishOB ? bearishOB.price : price * 1.005;
      confidence = 88;
    } else if (rsi < 30) {
      strategy = 'MMC'; type = 'LONG';
      entryPrice = bullishOB ? bullishOB.price : price * 0.995;
      confidence = 89;
    } else if (analysis.fvg.length > 0) {
      strategy = 'ICT';
      if (analysis.fvg[0].type === 'BULLISH') {
        type = 'LONG'; entryPrice = analysis.fvg[0].top; confidence = 82;
      } else {
        type = 'SHORT'; entryPrice = analysis.fvg[0].bottom; confidence = 82;
      }
    } else if (analysis.orderBlocks.length > 0) {
      strategy = 'SNR';
      const liqHigh = analysis.liquidity[0]?.price ?? price * 1.02;
      const liqLow = analysis.liquidity[1]?.price ?? price * 0.98;
      const midPrice = (liqHigh + liqLow) / 2;
      if (price < midPrice) {
        type = 'LONG'; entryPrice = bullishOB ? bullishOB.price * 1.002 : price;
        confidence = MAJOR_COINS.includes(symbol.toUpperCase()) ? 83 : 78;
      } else {
        type = 'SHORT'; entryPrice = bearishOB ? bearishOB.price * 0.998 : price;
        confidence = MAJOR_COINS.includes(symbol.toUpperCase()) ? 81 : 76;
      }
    }
  }

  let confluenceBonus = 0;
  if (type === 'LONG') {
    if (macd.histogram > 0) confluenceBonus += 3;
    if (macd.macd > macd.signal) confluenceBonus += 2;
    if (price > ema.ema9 && ema.ema9 > ema.ema21) confluenceBonus += 3;
    if (price > ema.ema50) confluenceBonus += 2;
    if (rsiDivergence === 'BULLISH') confluenceBonus += 5;
    if (marketStructure === 'BULLISH') confluenceBonus += 3;
    if (volumeProfile === 'HIGH') confluenceBonus += 2;
    if (analysis.bos.some(b => b.type === 'BULLISH')) confluenceBonus += 3;
    if (analysis.whaleActivity.detected && analysis.whaleActivity.direction === 'BUYING') confluenceBonus += 4;
    if (analysis.volumeForecast.expectedSpike && analysis.volumeForecast.direction === 'UP') confluenceBonus += 3;
    if (ichimoku.signal === 'BULLISH') confluenceBonus += 2;
    if (stochRsi.k < 20) confluenceBonus += 3;
  } else {
    if (macd.histogram < 0) confluenceBonus += 3;
    if (macd.macd < macd.signal) confluenceBonus += 2;
    if (price < ema.ema9 && ema.ema9 < ema.ema21) confluenceBonus += 3;
    if (price < ema.ema50) confluenceBonus += 2;
    if (rsiDivergence === 'BEARISH') confluenceBonus += 5;
    if (marketStructure === 'BEARISH') confluenceBonus += 3;
    if (volumeProfile === 'HIGH') confluenceBonus += 2;
    if (analysis.bos.some(b => b.type === 'BEARISH')) confluenceBonus += 3;
    if (analysis.whaleActivity.detected && analysis.whaleActivity.direction === 'SELLING') confluenceBonus += 4;
    if (analysis.volumeForecast.expectedSpike && analysis.volumeForecast.direction === 'DOWN') confluenceBonus += 3;
    if (ichimoku.signal === 'BEARISH') confluenceBonus += 2;
    if (stochRsi.k > 80) confluenceBonus += 3;
  }

  confidence = Math.min(98, confidence + confluenceBonus);

  const marketPrice = data[data.length - 1].close;
  if (Math.abs(entryPrice - marketPrice) / marketPrice > 0.1) entryPrice = marketPrice;

  const { dynamicSL, dynamicTP, riskReward, kellyFraction } = analysis.adaptiveRisk;
  const tp = type === 'LONG' ? entryPrice + dynamicTP : entryPrice - dynamicTP;
  const sl = type === 'LONG' ? entryPrice - dynamicSL : entryPrice + dynamicSL;

  return {
    id: Math.random().toString(36).substr(2, 9),
    coin: symbol,
    strategy,
    type,
    entry: entryPrice,
    marketPrice,
    tp, sl,
    timeframe: '15m',
    confidence,
    timestamp: 'Just now',
    status: 'PENDING',
    indicators: {
      rsi: Math.round(rsi),
      macdSignal: macd.histogram > 0 ? 'BULLISH' : 'BEARISH',
      emaTrend: price > ema.ema21 ? 'ABOVE' : 'BELOW',
      volumeProfile,
      trendStrength: Math.round(trendStrength),
      rsiDivergence,
      marketStructure,
      marketPhase: analysis.marketPhase,
      confluenceScore: confluenceBonus,
      whaleActivity: analysis.whaleActivity.detected ? analysis.whaleActivity.direction : 'NONE',
      volumeForecast: analysis.volumeForecast.expectedSpike ? analysis.volumeForecast.direction : 'STABLE',
      riskReward,
      kellyFraction: Math.round(kellyFraction * 1000) / 10,
      ensembleDirection: analysis.ensembleScore.direction,
      ensembleConfidence: analysis.ensembleScore.confidence,
      ichimokuSignal: ichimoku.signal,
      stochRsi: stochRsi.k,
      liquidityClusters: analysis.liquidityClusters.length,
    },
  };
}

export interface MultiTFConfluence {
  coin: string;
  signals: Record<string, any>;
  overallDirection: 'LONG' | 'SHORT' | 'NEUTRAL';
  confluenceScore: number;
  alignedTimeframes: number;
  totalTimeframes: number;
  bestEntry: any;
}

export function calculateMultiTFConfluence(signals: any[]): MultiTFConfluence[] {
  const coinGroups: Record<string, any[]> = {};
  for (const s of signals) {
    if (!coinGroups[s.coin]) coinGroups[s.coin] = [];
    coinGroups[s.coin].push(s);
  }

  return Object.entries(coinGroups).map(([coin, sigs]) => {
    const tfMap: Record<string, any> = {};
    for (const s of sigs) tfMap[s.timeframe] = s;

    const longCount = sigs.filter(s => s.type === 'LONG').length;
    const shortCount = sigs.filter(s => s.type === 'SHORT').length;
    const total = sigs.length;

    let overallDirection: 'LONG' | 'SHORT' | 'NEUTRAL' = 'NEUTRAL';
    if (longCount > shortCount && longCount / total >= 0.6) overallDirection = 'LONG';
    else if (shortCount > longCount && shortCount / total >= 0.6) overallDirection = 'SHORT';

    const aligned = overallDirection === 'LONG' ? longCount : overallDirection === 'SHORT' ? shortCount : 0;
    const confluenceScore = total > 0 ? Math.round((aligned / total) * 100) : 0;

    const bestEntry = sigs.reduce((best, s) => s.confidence > (best?.confidence || 0) ? s : best, sigs[0]);

    if (confluenceScore >= 80) bestEntry.confidence = Math.min(98, bestEntry.confidence + 5);
    else if (confluenceScore >= 60) bestEntry.confidence = Math.min(98, bestEntry.confidence + 2);

    return { coin, signals: tfMap, overallDirection, confluenceScore, alignedTimeframes: aligned, totalTimeframes: total, bestEntry };
  }).sort((a, b) => b.confluenceScore - a.confluenceScore);
}

function calculateRSI(data: BinanceKline[], period = 14) {
  if (data.length <= period) return 50;
  let gains = 0, losses = 0;
  for (let i = data.length - period; i < data.length; i++) {
    const diff = data[i].close - data[i-1].close;
    if (diff > 0) gains += diff; else losses -= diff;
  }
  const avgGain = gains / period;
  const avgLoss = losses / period;
  if (avgLoss === 0) return 100;
  return 100 - (100 / (1 + (avgGain / avgLoss)));
}

function calculateMACD(data: BinanceKline[]) {
  const closes = data.map(d => d.close);
  const ema12 = getEMA(closes, 12);
  const ema26 = getEMA(closes, 26);
  const macdLine = ema12 - ema26;
  const signalCloses = closes.slice(-9);
  const signal = signalCloses.length >= 9 ? getEMA(signalCloses, 9) : macdLine;
  return { macd: macdLine, signal, histogram: macdLine - signal };
}

function calculateEMAs(data: BinanceKline[]) {
  const closes = data.map(d => d.close);
  return {
    ema9: getEMA(closes, 9),
    ema21: getEMA(closes, 21),
    ema50: getEMA(closes, Math.min(50, closes.length)),
    ema200: getEMA(closes, Math.min(200, closes.length)),
  };
}

function getEMA(data: number[], period: number): number {
  if (data.length === 0) return 0;
  if (data.length < period) return data[data.length - 1];
  const k = 2 / (period + 1);
  let ema = data.slice(0, period).reduce((a, b) => a + b, 0) / period;
  for (let i = period; i < data.length; i++) ema = data[i] * k + ema * (1 - k);
  return ema;
}

function calculateADX(data: BinanceKline[], period = 14) {
  if (data.length < period * 2) return 25;
  const tr = data.slice(-period).map((d, i, arr) => {
    if (i === 0) return d.high - d.low;
    return Math.max(d.high - d.low, Math.abs(d.high - arr[i-1].close), Math.abs(d.low - arr[i-1].close));
  });
  return (tr.reduce((a, b) => a + b, 0) / period / data[data.length-1].close) * 1000;
}

function calculateATR(data: BinanceKline[], period = 14): number {
  if (data.length < period + 1) return 0;
  const trs: number[] = [];
  for (let i = data.length - period; i < data.length; i++) {
    const tr = Math.max(
      data[i].high - data[i].low,
      Math.abs(data[i].high - data[i-1].close),
      Math.abs(data[i].low - data[i-1].close)
    );
    trs.push(tr);
  }
  return trs.reduce((a, b) => a + b, 0) / trs.length;
}

function getVolumeProfile(data: BinanceKline[]): 'HIGH' | 'NORMAL' | 'LOW' {
  const recent = data.slice(-10).reduce((a, d) => a + d.volume, 0) / 10;
  const avg = data.slice(-50, -10).reduce((a, d) => a + d.volume, 0) / Math.max(1, data.slice(-50, -10).length);
  if (avg === 0) return 'NORMAL';
  const ratio = recent / avg;
  if (ratio > 1.5) return 'HIGH';
  if (ratio < 0.6) return 'LOW';
  return 'NORMAL';
}

function calculateTrendStrength(data: BinanceKline[], ema: ReturnType<typeof calculateEMAs>, adx: number, rsi: number): number {
  let score = 50;
  const price = data[data.length - 1].close;
  if (price > ema.ema9) score += 5; else score -= 5;
  if (price > ema.ema21) score += 5; else score -= 5;
  if (price > ema.ema50) score += 10; else score -= 10;
  if (ema.ema9 > ema.ema21) score += 5; else score -= 5;
  if (ema.ema21 > ema.ema50) score += 5; else score -= 5;
  if (adx > 30) score += 10; else if (adx < 15) score -= 10;
  if (rsi > 50 && rsi < 70) score += 5; else if (rsi < 50 && rsi > 30) score -= 5;
  return Math.max(0, Math.min(100, score));
}

function detectRSIDivergence(data: BinanceKline[]): 'BULLISH' | 'BEARISH' | 'NONE' {
  if (data.length < 30) return 'NONE';
  const recent = data.slice(-30);
  const rsiValues: number[] = [];
  for (let i = 14; i < recent.length; i++) {
    rsiValues.push(calculateRSI(recent.slice(i - 14, i + 1)));
  }
  if (rsiValues.length < 10) return 'NONE';
  const priceRecent = recent.slice(-10).map(d => d.close);
  const rsiRecent = rsiValues.slice(-10);
  const priceTrend = priceRecent[priceRecent.length - 1] - priceRecent[0];
  const rsiTrend = rsiRecent[rsiRecent.length - 1] - rsiRecent[0];
  if (priceTrend < 0 && rsiTrend > 5) return 'BULLISH';
  if (priceTrend > 0 && rsiTrend < -5) return 'BEARISH';
  return 'NONE';
}

function detectMarketStructure(data: BinanceKline[]): 'BULLISH' | 'BEARISH' | 'RANGING' {
  if (data.length < 20) return 'RANGING';
  const recent = data.slice(-20);
  const swingHighs: number[] = [];
  const swingLows: number[] = [];
  for (let i = 2; i < recent.length - 2; i++) {
    if (recent[i].high > recent[i-1].high && recent[i].high > recent[i-2].high &&
        recent[i].high > recent[i+1].high && recent[i].high > recent[i+2].high) {
      swingHighs.push(recent[i].high);
    }
    if (recent[i].low < recent[i-1].low && recent[i].low < recent[i-2].low &&
        recent[i].low < recent[i+1].low && recent[i].low < recent[i+2].low) {
      swingLows.push(recent[i].low);
    }
  }
  if (swingHighs.length >= 2 && swingLows.length >= 2) {
    const hh = swingHighs[swingHighs.length - 1] > swingHighs[swingHighs.length - 2];
    const hl = swingLows[swingLows.length - 1] > swingLows[swingLows.length - 2];
    const lh = swingHighs[swingHighs.length - 1] < swingHighs[swingHighs.length - 2];
    const ll = swingLows[swingLows.length - 1] < swingLows[swingLows.length - 2];
    if (hh && hl) return 'BULLISH';
    if (lh && ll) return 'BEARISH';
  }
  return 'RANGING';
}

function detectBOS(data: BinanceKline[]): SMCAnalysis['bos'] {
  if (data.length < 20) return [];
  const bos: SMCAnalysis['bos'] = [];
  const recent = data.slice(-20);
  let lastSwingHigh = recent[0].high;
  let lastSwingLow = recent[0].low;
  for (let i = 2; i < recent.length; i++) {
    if (recent[i].close > lastSwingHigh) {
      bos.push({ price: recent[i].close, type: 'BULLISH' });
      lastSwingHigh = recent[i].high;
    }
    if (recent[i].close < lastSwingLow) {
      bos.push({ price: recent[i].close, type: 'BEARISH' });
      lastSwingLow = recent[i].low;
    }
    if (recent[i].high > lastSwingHigh) lastSwingHigh = recent[i].high;
    if (recent[i].low < lastSwingLow) lastSwingLow = recent[i].low;
  }
  return bos.slice(-3);
}
