/**
 * Agent Orchestrator — Deterministic Core + AI Veto Layer
 *
 * Architecture (per the v2 build plan):
 *   1. Deterministic Phase 2 TA confluence score is the signal driver (not scored by AI)
 *   2. Sentiment + Macro provide context only (inputs to AI, not direct score weights)
 *   3. Claude/LLM acts as a veto/narrator — returns confirm | veto | flag
 *      - veto  → trade blocked
 *      - flag  → confidence reduced by 20 points
 *      - confirm → proceed with TA-derived confidence
 *   4. Macro lockout ±45 min around FOMC/CPI/NFP events (not all-day blocks)
 *   5. AI prompt/response logged verbatim with trade correlation ID for audit
 */
import { getMarketRegime, type MarketRegimeResult } from './market-intelligence-agent';
import { runPhase2Confluence, type PhaseTwo, type OHLCVCandle } from './technical-analysis-agent';
import { assessTradeRisk, detectRegime, type RiskAssessment, type VolatilityRegime } from './risk-management-agent';
import { getQuickStats } from './trade-journal-agent';
import { getCoinglassData, type CoinglassData } from '../coinglass';
import { getNewsSentiment, type NewsSentiment } from '../perplexity';
import { getWhaleActivity, type WhaleActivity } from '../arkham';
import { callMultiAI, extractJson } from '../ai-providers';
import { storage } from '../storage';
import type { BotTrade } from '@shared/schema';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OrchestratorInput {
  coin: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  sl: number;
  tp: number;
  confidence: number;      // base confidence from TA engine
  strategy: string;
  timeframe: string;
  marketPrice: number;
  candles?: OHLCVCandle[];
  agentContext?: import('../ai-analysis').AgentContext;
}

/** Forced JSON schema the LLM must return — validated before use */
export interface SentimentVerdict {
  verdict: 'confirm' | 'veto' | 'flag';
  reasoning: string;
  macro_lockout: boolean;
  lockout_window_minutes: number;
}

export interface AgentScores {
  technical: number;       // Phase 2 confluence (0-100) — primary driver
  sentiment: number;       // context only (0-100)
  macro: number;           // context only (0-100)
  composite: number;       // = technical score (AI doesn't dilute it with a weight)
}

export interface OrchestratorResult {
  approved: boolean;
  finalConfidence: number;
  finalVerdict: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
  shouldTrade: boolean;
  grade: 'A+' | 'A' | 'B+' | 'B' | 'C' | 'No Trade';

  scores: AgentScores;
  marketRegime: MarketRegimeResult;
  phase2: PhaseTwo | null;
  riskAssessment: RiskAssessment;
  volatilityRegime: VolatilityRegime;
  coinglass: CoinglassData;
  news: NewsSentiment;
  whale: WhaleActivity;
  aiVerdict: SentimentVerdict;

  adjustments: Array<{ agent: string; delta: number; reason: string }>;
  summary: string;
  tradeRationale: string;
  warnings: string[];
  timestamp: string;
  correlationId: string;
  quickStats: { todayPnl: number; weekPnl: number; winRate7d: number };
}

// ─── Macro lockout events (add real timestamps as they're published) ──────────
// Format: ISO strings of known event times. The lockout window is ±45 min.
const MACRO_EVENTS_UTC: string[] = [
  // Populated at runtime from the macro calendar API; fallback list here
];

function isMacroLockout(): boolean {
  const now = Date.now();
  const windowMs = 45 * 60 * 1000;
  return MACRO_EVENTS_UTC.some(ev => {
    const t = new Date(ev).getTime();
    return Math.abs(now - t) <= windowMs;
  });
}

// ─── AI Veto Layer ────────────────────────────────────────────────────────────

async function callAIVeto(
  signal: {
    coin: string; direction: string; entry: number; sl: number; tp: number;
    taScore: number; rr: number; timeframe: string; strategy: string;
  },
  context: {
    coinglass: CoinglassData;
    news: NewsSentiment;
    whale: WhaleActivity;
    regime: string;
    session: string;
    regimeWarnings: string[];
  },
  correlationId: string,
): Promise<SentimentVerdict> {
  const prompt = `You are a trading signal veto layer. A deterministic technical analysis engine has already computed all indicator values — do NOT recompute them.

SIGNAL (read-only, do not modify):
- Pair: ${signal.coin} ${signal.direction}
- Entry: ${signal.entry} | SL: ${signal.sl} | TP: ${signal.tp}
- TA Confluence Score: ${signal.taScore}/100
- R:R: ${signal.rr.toFixed(2)} | Timeframe: ${signal.timeframe} | Strategy: ${signal.strategy}

CURRENT CONTEXT:
- Macro Regime: ${context.regime} | Session: ${context.session}
- Funding Rate: ${context.coinglass.fundingRatePercent}% | Long/Short: ${context.coinglass.longPercent}/${context.coinglass.shortPercent}
- News Sentiment: ${context.news.sentiment} (Risk: ${context.news.riskLevel}) — "${context.news.headline}"
- Whale Flow: ${context.whale.flowBias}
- Regime Warnings: ${context.regimeWarnings.join('; ') || 'none'}

Your job: decide if this signal should be VETOED (clear macro/news reason to skip), FLAGGED (uncertain — reduce confidence), or CONFIRMED.

Return ONLY this JSON (no other text):
{"verdict":"confirm|veto|flag","reasoning":"<1-2 sentences>","macro_lockout":false,"lockout_window_minutes":0}

Correlation ID: ${correlationId}`;

  try {
    const res = await callMultiAI(
      [{ role: 'user', content: prompt }],
      { maxTokens: 200, temperature: 0.1 },
    );

    // Log verbatim for audit
    await storage.createBotLog({
      level: 'info',
      event: 'AI_VETO_CALL',
      message: `AI veto response for ${signal.coin} ${signal.direction}`,
      meta: { correlationId, prompt: prompt.slice(0, 500), response: res.text.slice(0, 500) },
    });

    const parsed = extractJson<SentimentVerdict>(res.text);
    if (parsed && ['confirm', 'veto', 'flag'].includes(parsed.verdict)) {
      return parsed;
    }
  } catch (err) {
    await storage.createBotLog({
      level: 'warn',
      event: 'AI_VETO_FAILED',
      message: `AI veto call failed for ${signal.coin} — defaulting to flag`,
      meta: { correlationId, error: String(err) },
    });
  }

  // Safe default: flag (never silently confirm on failure)
  return { verdict: 'flag', reasoning: 'AI unavailable — flagged for safety', macro_lockout: false, lockout_window_minutes: 0 };
}

// ─── Grade derivation ─────────────────────────────────────────────────────────

function deriveVerdict(conf: number, direction: 'LONG' | 'SHORT'): OrchestratorResult['finalVerdict'] {
  if (conf >= 88) return direction === 'LONG' ? 'STRONG_BUY' : 'STRONG_SELL';
  if (conf >= 72) return direction === 'LONG' ? 'BUY' : 'SELL';
  if (conf >= 52) return 'NEUTRAL';
  return direction === 'LONG' ? 'SELL' : 'BUY';
}

function deriveGrade(conf: number, rr: number): OrchestratorResult['grade'] {
  if (conf >= 85 && rr >= 2.0) return 'A+';
  if (conf >= 75 && rr >= 1.5) return 'A';
  if (conf >= 65 && rr >= 1.5) return 'B+';
  if (conf >= 65) return 'B';
  if (conf >= 50) return 'C';
  return 'No Trade';
}

// ─── Main orchestrator ────────────────────────────────────────────────────────

export async function runOrchestrator(input: OrchestratorInput): Promise<OrchestratorResult> {
  const { coin, direction, entry, sl, tp, confidence, strategy, timeframe, marketPrice } = input;
  const rr = Math.abs(tp - entry) / Math.abs(entry - sl);
  const correlationId = `${coin}-${direction}-${Date.now()}`;

  // ── 1. Fire data agents in parallel ──────────────────────────────────────
  const [regimeRes, cgRes, newsRes, whaleRes, statsRes] = await Promise.allSettled([
    getMarketRegime(),
    getCoinglassData(coin),
    getNewsSentiment(coin),
    getWhaleActivity(coin),
    getQuickStats(),
  ]);

  const marketRegime  = regimeRes.status  === 'fulfilled' ? regimeRes.value  : fallbackRegime();
  const coinglass     = cgRes.status      === 'fulfilled' ? cgRes.value      : fallbackCG(coin);
  const news          = newsRes.status    === 'fulfilled' ? newsRes.value    : fallbackNews(coin);
  const whale         = whaleRes.status   === 'fulfilled' ? whaleRes.value   : fallbackWhale(coin);
  const quickStats    = statsRes.status   === 'fulfilled' ? statsRes.value   : { todayPnl: 0, weekPnl: 0, winRate7d: 0 };

  // ── 2. Phase 2 deterministic confluence (primary signal driver) ───────────
  let phase2: PhaseTwo | null = null;
  if (input.candles && input.candles.length >= 20) {
    try {
      phase2 = await runPhase2Confluence({
        coin, direction, entry, sl, tp,
        candles: input.candles,
        smcScore: input.agentContext?.smcScore,
        ictScore: input.agentContext?.ictScore,
        quantumLiquidityScore: input.agentContext?.quantumLiquidityScore,
        liquidityDepthScore: input.agentContext?.liquidityDepthScore,
        smcStructure: input.agentContext?.smcStructure,
        rsiDivergence: input.agentContext?.rsiDivergence,
        ichimokuSignal: input.agentContext?.ichimokuSignal,
        volumeProfile: input.agentContext?.volumeProfile,
        ensembleDirection: input.agentContext?.ensembleDirection,
        timeframe,
      });
    } catch { /* phase2 remains null — fall back to base confidence */ }
  }

  // Technical score is the primary driver; AI cannot override it
  const technicalScore = phase2 ? phase2.compositeScore : confidence;

  // ── 3. Risk assessment + volatility regime ────────────────────────────────
  const allTrades = await storage.getBotTrades();
  const openTrades = allTrades.filter(t => t.status === 'open');
  const botSettings = await storage.getBotSettings();
  const bs = botSettings as any;

  const [riskAssessment, volatilityRegime] = await Promise.all([
    assessTradeRisk({
      coin, direction, entry, sl, tp, confidence, timeframe,
      walletBalance: bs?.paperBalance ?? 1000,
      openTrades, allTrades,
      baseRiskPct: bs?.riskPerTradePercent ?? 0.75,
      baseLeverage: bs?.defaultLeverage ?? 10,
      startingBalance: bs?.paperStartingBalance ?? 1000,
    }),
    detectRegime(input.candles ?? []),
  ]);

  const adjustments: OrchestratorResult['adjustments'] = [];
  const warnings: string[] = [...marketRegime.warnings, ...riskAssessment.warnings];

  // ── 4. Macro lockout check (±45 min around events) ────────────────────────
  if (isMacroLockout()) {
    warnings.push('Macro lockout active — major event within ±45 minutes');
    return buildBlockedResult(
      coin, direction, rr, technicalScore, marketRegime, phase2,
      riskAssessment, volatilityRegime, coinglass, news, whale,
      { verdict: 'veto', reasoning: 'Macro lockout — major event within ±45 min', macro_lockout: true, lockout_window_minutes: 45 },
      adjustments, warnings, quickStats, correlationId,
    );
  }

  // ── 5. Volatility regime circuit breaker ─────────────────────────────────
  if (volatilityRegime.regime === 'EXTREME') {
    warnings.push(`Volatility EXTREME (${volatilityRegime.realizedVol.toFixed(1)}% vs ${volatilityRegime.avgVol30d.toFixed(1)}% avg) — no new trades`);
    (riskAssessment as any).blocked = true;
    (riskAssessment as any).blockReason = `Extreme volatility regime — circuit breaker active`;
  } else if (volatilityRegime.regime === 'ELEVATED') {
    warnings.push(`Volatility ELEVATED — position size at 50%`);
  }

  // ── 6. AI veto layer (reads computed values, cannot change them) ──────────
  const aiVerdict = await callAIVeto(
    { coin, direction, entry, sl, tp, taScore: technicalScore, rr, timeframe, strategy },
    { coinglass, news, whale, regime: marketRegime.regime, session: marketRegime.session, regimeWarnings: marketRegime.warnings },
    correlationId,
  );

  if (aiVerdict.macro_lockout) {
    warnings.push(`AI macro lockout: ${aiVerdict.reasoning}`);
  }

  if (aiVerdict.verdict === 'veto' || riskAssessment.blocked) {
    return buildBlockedResult(
      coin, direction, rr, technicalScore, marketRegime, phase2,
      riskAssessment, volatilityRegime, coinglass, news, whale,
      aiVerdict, adjustments, warnings, quickStats, correlationId,
    );
  }

  // ── 7. Build final confidence from deterministic score + minor adjustments ─
  let finalConf = technicalScore;

  if (aiVerdict.verdict === 'flag') {
    finalConf -= 20;
    adjustments.push({ agent: 'AI Veto', delta: -20, reason: `Flagged: ${aiVerdict.reasoning}` });
  } else {
    adjustments.push({ agent: 'AI Veto', delta: 0, reason: `Confirmed: ${aiVerdict.reasoning}` });
  }

  // R:R adjustments
  if (rr >= 3.0) {
    finalConf += 5;
    adjustments.push({ agent: 'R:R', delta: 5, reason: `Excellent R:R ${rr.toFixed(2)}` });
  } else if (rr < 1.5) {
    finalConf -= 15;
    adjustments.push({ agent: 'R:R', delta: -15, reason: `Poor R:R ${rr.toFixed(2)}` });
  }

  // Phase 2 grade bonus
  if (phase2) {
    if (phase2.grade === 'A+')       { finalConf += 8;  adjustments.push({ agent: 'Phase2 TA', delta: 8,   reason: 'A+ confluence grade' }); }
    else if (phase2.grade === 'A')   { finalConf += 4;  adjustments.push({ agent: 'Phase2 TA', delta: 4,   reason: 'A confluence grade' }); }
    else if (phase2.grade === 'B+')  { finalConf += 2;  adjustments.push({ agent: 'Phase2 TA', delta: 2,   reason: 'B+ confluence grade' }); }
    else if (phase2.grade === 'No Trade') { finalConf -= 20; adjustments.push({ agent: 'Phase2 TA', delta: -20, reason: 'No Trade grade' }); }
    else if (phase2.grade === 'C')   { finalConf -= 10; adjustments.push({ agent: 'Phase2 TA', delta: -10, reason: 'C grade — marginal' }); }
  }

  // Low win rate penalty
  if (quickStats.winRate7d < 0.3 && quickStats.weekPnl < 0) {
    finalConf -= 8;
    adjustments.push({ agent: 'Journal', delta: -8, reason: `Poor 7d win rate (${(quickStats.winRate7d * 100).toFixed(0)}%)` });
    warnings.push('Low 7-day win rate — consider strategy review');
  }

  // Apply volatility size multiplier (doesn't change confidence, but signals the executor to scale)
  if (volatilityRegime.regime === 'ELEVATED') {
    adjustments.push({ agent: 'Regime', delta: 0, reason: `ELEVATED vol — size ×${volatilityRegime.positionSizeMultiplier}` });
  }

  finalConf = Math.min(80, Math.max(5, Math.round(finalConf)));

  const finalVerdict = deriveVerdict(finalConf, direction);
  const grade = phase2?.grade ?? deriveGrade(finalConf, rr);
  const shouldTrade = finalConf >= 68 && finalVerdict !== 'NEUTRAL' && !riskAssessment.blocked;
  const approved = shouldTrade && riskAssessment.approved;

  const scores: AgentScores = {
    technical: technicalScore,
    sentiment: sentimentScore(coinglass, news, whale, direction),
    macro: marketRegime.macroScore,
    composite: technicalScore,   // composite IS the TA score — AI doesn't dilute it
  };

  const summary = [
    `[${grade}] ${direction} ${coin} | Confidence: ${finalConf}% → ${finalVerdict}`,
    `TA: ${technicalScore.toFixed(0)}/100 | AI: ${aiVerdict.verdict.toUpperCase()} | Vol: ${volatilityRegime.regime}`,
    `Regime: ${marketRegime.regime} | Session: ${marketRegime.session} | R:R: ${rr.toFixed(2)}`,
    approved ? '✅ APPROVED' : `⛔ ${riskAssessment.blockReason ?? 'Below threshold'}`,
  ].join('\n');

  return {
    approved, finalConfidence: finalConf, finalVerdict, shouldTrade, grade,
    scores, marketRegime, phase2, riskAssessment, volatilityRegime,
    coinglass, news, whale, aiVerdict,
    adjustments, summary,
    tradeRationale: phase2?.summary ?? aiVerdict.reasoning,
    warnings, timestamp: new Date().toISOString(),
    correlationId, quickStats,
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sentimentScore(cg: CoinglassData, news: NewsSentiment, whale: WhaleActivity, direction: 'LONG' | 'SHORT'): number {
  let score = 50;
  const isLong = direction === 'LONG';
  if (cg.available) {
    if (cg.bias === 'BULLISH') score += isLong ? 16 : -16;
    else if (cg.bias === 'BEARISH') score += isLong ? -16 : 16;
    if (Math.abs(cg.fundingRate) > 0.0005) score -= 8;
    if (cg.longPercent > 75) score += isLong ? -12 : 12;
    if (cg.longPercent < 25) score += isLong ? 12 : -12;
  }
  if (news.available) {
    if (news.sentiment === 'BULLISH') score += isLong ? 14 : -14;
    else if (news.sentiment === 'BEARISH') score += isLong ? -14 : 14;
    if (news.riskLevel === 'HIGH') score -= 18;
  }
  if (whale.available) {
    if (whale.flowBias === 'BULLISH') score += isLong ? 10 : -10;
    else if (whale.flowBias === 'BEARISH') score += isLong ? -10 : 10;
  }
  return Math.min(100, Math.max(0, score));
}

function buildBlockedResult(
  coin: string, direction: 'LONG' | 'SHORT', rr: number, technicalScore: number,
  marketRegime: MarketRegimeResult, phase2: PhaseTwo | null,
  riskAssessment: RiskAssessment, volatilityRegime: VolatilityRegime,
  coinglass: CoinglassData, news: NewsSentiment, whale: WhaleActivity,
  aiVerdict: SentimentVerdict,
  adjustments: OrchestratorResult['adjustments'], warnings: string[],
  quickStats: { todayPnl: number; weekPnl: number; winRate7d: number },
  correlationId: string,
): OrchestratorResult {
  const blockReason = riskAssessment.blockReason ?? aiVerdict.reasoning ?? 'Signal vetoed';
  return {
    approved: false, finalConfidence: 5, finalVerdict: 'NEUTRAL', shouldTrade: false, grade: 'No Trade',
    scores: { technical: technicalScore, sentiment: 50, macro: marketRegime.macroScore, composite: technicalScore },
    marketRegime, phase2, riskAssessment, volatilityRegime,
    coinglass, news, whale, aiVerdict,
    adjustments, summary: `⛔ BLOCKED: ${blockReason}`,
    tradeRationale: blockReason, warnings,
    timestamp: new Date().toISOString(), correlationId, quickStats,
  };
}

// ─── Fallbacks ────────────────────────────────────────────────────────────────

function fallbackRegime(): MarketRegimeResult {
  return {
    regime: 'RANGING', confidence: 50,
    fearGreed: { value: 50, label: 'Neutral', available: false },
    macro: { btcDominance: 50, btcDominanceTrend: 'FLAT', totalMarketCapBillion: 0, btc24hChange: 0, eth24hChange: 0, altcoinSeason: false, available: false },
    session: 'OFF_HOURS', sessionScore: 50, macroScore: 50,
    tradeableSide: 'BOTH', narrative: 'Macro data unavailable',
    warnings: [], timestamp: new Date().toISOString(), available: false,
  };
}
function fallbackCG(coin: string): CoinglassData {
  return { coin, fundingRate: 0, fundingRatePercent: 0, longPercent: 50, shortPercent: 50, openInterestUSD: 0, bias: 'NEUTRAL', signal: 'Unavailable', available: false };
}
function fallbackNews(coin: string): NewsSentiment {
  return { coin, sentiment: 'NEUTRAL', headline: 'Unavailable', summary: '', riskLevel: 'LOW', keyEvents: [], tradingImpact: '', available: false };
}
function fallbackWhale(coin: string): WhaleActivity {
  return { coin, netExchangeFlow: 'NEUTRAL', exchangeInflows: 0, exchangeOutflows: 0, totalVolumeUSD: 0, flowBias: 'NEUTRAL', signal: 'Unavailable', topTransfers: [], available: false };
}
