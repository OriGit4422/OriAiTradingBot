/**
 * Market Intelligence Agent
 * Detects macro market regime, BTC dominance, Fear & Greed, and session timing.
 * Uses Gemini Flash for fast bulk data analysis.
 */
import { callAIProvider, getActiveProviders, extractJson, type AIMessage } from '../ai-providers';
import { storage } from '../storage';

export type MarketRegime = 'STRONG_BULL' | 'BULL' | 'RANGING' | 'BEAR' | 'STRONG_BEAR' | 'VOLATILE';
export type TradingSession = 'ASIA' | 'LONDON' | 'NEW_YORK' | 'OVERLAP' | 'OFF_HOURS';

export interface FearGreedData {
  value: number;       // 0-100
  label: string;       // Extreme Fear / Fear / Neutral / Greed / Extreme Greed
  available: boolean;
}

export interface MacroMetrics {
  btcDominance: number;       // BTC.D %
  btcDominanceTrend: 'RISING' | 'FALLING' | 'FLAT';
  totalMarketCapBillion: number;
  btc24hChange: number;
  eth24hChange: number;
  altcoinSeason: boolean;     // true if ETH/alts outperforming BTC
  available: boolean;
}

export interface MarketRegimeResult {
  regime: MarketRegime;
  confidence: number;         // 0-100 how confident in regime classification
  fearGreed: FearGreedData;
  macro: MacroMetrics;
  session: TradingSession;
  sessionScore: number;       // 0-100, quality of current trading session
  macroScore: number;         // 0-100, overall macro favorability
  tradeableSide: 'LONG' | 'SHORT' | 'BOTH' | 'AVOID';
  narrative: string;          // 1-2 sentence macro summary
  warnings: string[];         // active macro warnings
  timestamp: string;
  available: boolean;
}

// Cache regime for 15 minutes to avoid hammering free APIs
let regimeCache: { result: MarketRegimeResult; expires: number } | null = null;
const CACHE_TTL = 15 * 60 * 1000;

async function fetchFearGreed(): Promise<FearGreedData> {
  try {
    const res = await fetch('https://api.alternative.me/fng/?limit=1', {
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error(`Fear & Greed API ${res.status}`);
    const json = await res.json();
    const item = json?.data?.[0];
    if (!item) throw new Error('No F&G data');
    return {
      value: parseInt(item.value, 10),
      label: item.value_classification,
      available: true,
    };
  } catch {
    return { value: 50, label: 'Neutral', available: false };
  }
}

async function fetchMacroMetrics(): Promise<MacroMetrics> {
  try {
    const res = await fetch(
      'https://api.coingecko.com/api/v3/global',
      { signal: AbortSignal.timeout(10000) },
    );
    if (!res.ok) throw new Error(`CoinGecko ${res.status}`);
    const json = await res.json();
    const d = json?.data;
    if (!d) throw new Error('No global data');

    const btcDom = d.market_cap_percentage?.btc ?? 50;
    const ethDom = d.market_cap_percentage?.eth ?? 15;
    const totalCap = (d.total_market_cap?.usd ?? 0) / 1e9;
    const btcChange = d.market_cap_change_percentage_24h_usd ?? 0;

    // ETH dominance rising vs BTC dominance = altcoin season signal
    const altcoinSeason = ethDom > 18 || btcDom < 42;

    return {
      btcDominance: btcDom,
      btcDominanceTrend: btcDom > 52 ? 'RISING' : btcDom < 44 ? 'FALLING' : 'FLAT',
      totalMarketCapBillion: totalCap,
      btc24hChange: btcChange,
      eth24hChange: 0, // coingecko global doesn't break this out per coin
      altcoinSeason,
      available: true,
    };
  } catch {
    return {
      btcDominance: 50, btcDominanceTrend: 'FLAT', totalMarketCapBillion: 0,
      btc24hChange: 0, eth24hChange: 0, altcoinSeason: false, available: false,
    };
  }
}

function getCurrentSession(): { session: TradingSession; score: number } {
  const now = new Date();
  const utcH = now.getUTCHours();

  // London: 07:00-16:00 UTC | NY: 13:00-22:00 UTC | Asia: 00:00-09:00 UTC
  const inLondon = utcH >= 7 && utcH < 16;
  const inNY = utcH >= 13 && utcH < 22;
  const inAsia = utcH < 9 || utcH >= 22;
  const overlap = inLondon && inNY; // 13:00-16:00 UTC — highest volume

  if (overlap) return { session: 'OVERLAP', score: 95 };
  if (inNY) return { session: 'NEW_YORK', score: 85 };
  if (inLondon) return { session: 'LONDON', score: 80 };
  if (inAsia) return { session: 'ASIA', score: 55 };
  return { session: 'OFF_HOURS', score: 30 };
}

function classifyRegime(fearGreed: FearGreedData, macro: MacroMetrics): {
  regime: MarketRegime;
  confidence: number;
  macroScore: number;
  tradeableSide: 'LONG' | 'SHORT' | 'BOTH' | 'AVOID';
  warnings: string[];
} {
  const warnings: string[] = [];
  const fg = fearGreed.value;
  const btcChange = macro.btc24hChange;

  let macroScore = 50;
  let regime: MarketRegime = 'RANGING';
  let confidence = 60;

  // Fear & Greed scoring
  if (fg <= 20) { macroScore -= 25; warnings.push('Extreme Fear — potential capitulation or accumulation zone'); }
  else if (fg <= 35) { macroScore -= 10; warnings.push('Fear in market — reduce position sizes'); }
  else if (fg >= 80) { macroScore -= 20; warnings.push('Extreme Greed — high reversal risk, tighten stops'); }
  else if (fg >= 65) { macroScore += 10; }
  else { macroScore += 5; } // neutral zone

  // BTC dominance impact
  if (macro.btcDominance > 58) {
    warnings.push('High BTC Dominance (>58%) — altcoins underperforming, prefer BTC/ETH');
    macroScore -= 5;
  } else if (macro.btcDominance < 40) {
    warnings.push('Low BTC Dominance — altcoin season conditions');
    macroScore += 10;
  }

  // Market cap change
  if (btcChange < -5) { macroScore -= 20; warnings.push('BTC down >5% in 24h — bearish macro'); }
  else if (btcChange < -2) { macroScore -= 10; }
  else if (btcChange > 5) { macroScore += 20; }
  else if (btcChange > 2) { macroScore += 10; }

  macroScore = Math.min(100, Math.max(0, macroScore));

  // Classify regime
  if (macroScore >= 75 && fg >= 55) { regime = 'STRONG_BULL'; confidence = 85; }
  else if (macroScore >= 60) { regime = 'BULL'; confidence = 75; }
  else if (macroScore <= 25 && fg <= 35) { regime = 'STRONG_BEAR'; confidence = 85; }
  else if (macroScore <= 40) { regime = 'BEAR'; confidence = 75; }
  else if (Math.abs(btcChange) > 8) { regime = 'VOLATILE'; confidence = 70; }
  else { regime = 'RANGING'; confidence = 60; }

  // Determine tradeable side
  let tradeableSide: 'LONG' | 'SHORT' | 'BOTH' | 'AVOID' = 'BOTH';
  if (regime === 'STRONG_BULL') tradeableSide = 'LONG';
  else if (regime === 'BULL') tradeableSide = 'LONG';
  else if (regime === 'STRONG_BEAR') tradeableSide = 'SHORT';
  else if (regime === 'BEAR') tradeableSide = 'SHORT';
  else if (regime === 'VOLATILE') tradeableSide = 'AVOID';

  return { regime, confidence, macroScore, tradeableSide, warnings };
}

async function enrichWithAI(
  regime: MarketRegime,
  fearGreed: FearGreedData,
  macro: MacroMetrics,
  session: TradingSession,
): Promise<string> {
  try {
    const providers = await getActiveProviders();
    // Prefer Gemini for speed, else first available
    const gemini = providers.find(p => p.type === 'gemini') ?? providers[0];
    if (!gemini) return '';

    const messages: AIMessage[] = [
      {
        role: 'system',
        content: 'You are a macro crypto market analyst. Provide a concise 1-2 sentence market narrative based on the data provided. Be specific and actionable.',
      },
      {
        role: 'user',
        content: `Market regime: ${regime}. Fear & Greed: ${fearGreed.value} (${fearGreed.label}). BTC Dominance: ${macro.btcDominance.toFixed(1)}%. BTC 24h change: ${macro.btc24hChange.toFixed(2)}%. Total market cap: $${macro.totalMarketCapBillion.toFixed(0)}B. Session: ${session}. Altcoin season: ${macro.altcoinSeason}. Write a 1-2 sentence narrative for traders.`,
      },
    ];

    // Display-only narrative: nothing downstream reads it, so it is the first
    // thing dropped when the daily AI budget tightens.
    const res = await callAIProvider(gemini, messages, {
      maxTokens: 90, tier: 'cosmetic', cacheTtlMs: 60 * 60 * 1000, label: 'regime-narrative',
    });
    return res.text.trim();
  } catch {
    return `${regime} market with Fear & Greed at ${fearGreed.value}. Trade with the trend, manage risk carefully.`;
  }
}

export async function getMarketRegime(forceRefresh = false): Promise<MarketRegimeResult> {
  if (!forceRefresh && regimeCache && Date.now() < regimeCache.expires) {
    return regimeCache.result;
  }

  const [fearGreed, macro] = await Promise.all([fetchFearGreed(), fetchMacroMetrics()]);
  const { session, score: sessionScore } = getCurrentSession();
  const { regime, confidence, macroScore, tradeableSide, warnings } = classifyRegime(fearGreed, macro);
  const narrative = await enrichWithAI(regime, fearGreed, macro, session);

  const result: MarketRegimeResult = {
    regime, confidence, fearGreed, macro, session, sessionScore,
    macroScore, tradeableSide, narrative, warnings,
    timestamp: new Date().toISOString(),
    available: fearGreed.available || macro.available,
  };

  regimeCache = { result, expires: Date.now() + CACHE_TTL };
  return result;
}

export function macroScoreToSignalDelta(
  regime: MarketRegime,
  tradeDirection: 'LONG' | 'SHORT',
  sessionScore: number,
): { delta: number; reason: string } {
  let delta = 0;
  const reasons: string[] = [];

  // Regime alignment
  if (regime === 'STRONG_BULL' && tradeDirection === 'LONG') { delta += 12; reasons.push('Macro strongly bullish'); }
  else if (regime === 'BULL' && tradeDirection === 'LONG') { delta += 7; reasons.push('Macro bullish'); }
  else if (regime === 'STRONG_BEAR' && tradeDirection === 'SHORT') { delta += 12; reasons.push('Macro strongly bearish'); }
  else if (regime === 'BEAR' && tradeDirection === 'SHORT') { delta += 7; reasons.push('Macro bearish'); }
  else if (regime === 'STRONG_BULL' && tradeDirection === 'SHORT') { delta -= 15; reasons.push('Trading against strong bull macro'); }
  else if (regime === 'STRONG_BEAR' && tradeDirection === 'LONG') { delta -= 15; reasons.push('Trading against strong bear macro'); }
  else if (regime === 'BULL' && tradeDirection === 'SHORT') { delta -= 8; reasons.push('Shorting in bull market'); }
  else if (regime === 'BEAR' && tradeDirection === 'LONG') { delta -= 8; reasons.push('Longing in bear market'); }
  else if (regime === 'VOLATILE') { delta -= 10; reasons.push('High volatility regime — avoid'); }

  // Session quality
  if (sessionScore >= 90) { delta += 5; reasons.push('Optimal trading session (Overlap)'); }
  else if (sessionScore <= 35) { delta -= 8; reasons.push('Low liquidity off-hours session'); }

  return { delta, reason: reasons.join('; ') || 'Macro neutral' };
}
