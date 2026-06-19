/**
 * Agent Orchestrator — Master Coordinator
 * Runs all 6 agents in parallel and produces the final composite signal decision.
 * Weighted formula: TA(40%) + Sentiment(30%) + Macro(30%)
 */
import { getMarketRegime, macroScoreToSignalDelta, type MarketRegimeResult } from './market-intelligence-agent';
import { runPhase2Confluence, type PhaseTwo, type OHLCVCandle } from './technical-analysis-agent';
import { assessTradeRisk, type RiskAssessment } from './risk-management-agent';
import { getQuickStats } from './trade-journal-agent';
import { getCoinglassData, type CoinglassData } from '../coinglass';
import { getNewsSentiment, type NewsSentiment } from '../perplexity';
import { getWhaleActivity, type WhaleActivity } from '../arkham';
import { analyzeSignalWithAI, type AISignalAnalysis, type AgentContext } from '../ai-analysis';
import { storage } from '../storage';
import type { BotTrade } from '@shared/schema';

export interface OrchestratorInput {
  coin: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  sl: number;
  tp: number;
  confidence: number;     // base confidence from TA engine
  strategy: string;
  timeframe: string;
  marketPrice: number;
  candles?: OHLCVCandle[]; // optional OHLCV for phase2
  // Optional pre-computed context
  agentContext?: AgentContext;
}

export interface AgentScores {
  macro: number;          // 0-100
  sentiment: number;      // 0-100 (Coinglass + News + Whale blended)
  technical: number;      // 0-100 (Phase 2 confluence)
  primaryAI: number;      // 0-100 (AI signal analysis)
  composite: number;      // final weighted score
}

export interface OrchestratorResult {
  // Final decision
  approved: boolean;
  finalConfidence: number;        // 0-100
  finalVerdict: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
  shouldTrade: boolean;
  grade: 'A+' | 'A' | 'B+' | 'B' | 'C' | 'No Trade';

  // Agent outputs
  scores: AgentScores;
  marketRegime: MarketRegimeResult;
  phase2: PhaseTwo | null;
  riskAssessment: RiskAssessment;
  coinglass: CoinglassData;
  news: NewsSentiment;
  whale: WhaleActivity;
  primaryAI: AISignalAnalysis;

  // Adjustments log
  adjustments: Array<{ agent: string; delta: number; reason: string }>;

  // Human-readable
  summary: string;
  tradeRationale: string;
  warnings: string[];
  timestamp: string;

  // Performance context
  quickStats: { todayPnl: number; weekPnl: number; winRate7d: number };
}

function sentimentBlend(cg: CoinglassData, news: NewsSentiment, whale: WhaleActivity, direction: 'LONG' | 'SHORT'): number {
  let score = 50;
  const isLong = direction === 'LONG';

  // Coinglass (40% of sentiment)
  if (cg.available) {
    if (cg.bias === 'BULLISH') score += isLong ? 16 : -16;
    else if (cg.bias === 'BEARISH') score += isLong ? -16 : 16;
    if (Math.abs(cg.fundingRate) > 0.0005) score -= 8; // extreme funding = reversal risk
    if (cg.longPercent > 75) score += isLong ? -12 : 12; // crowded longs = contrarian short
    if (cg.longPercent < 25) score += isLong ? 12 : -12; // crowded shorts = contrarian long
  }

  // News (35% of sentiment)
  if (news.available) {
    if (news.sentiment === 'BULLISH') score += isLong ? 14 : -14;
    else if (news.sentiment === 'BEARISH') score += isLong ? -14 : 14;
    if (news.riskLevel === 'HIGH') score -= 18;
    else if (news.riskLevel === 'MEDIUM') score -= 6;
  }

  // Whale (25% of sentiment)
  if (whale.available) {
    if (whale.flowBias === 'BULLISH') score += isLong ? 10 : -10;
    else if (whale.flowBias === 'BEARISH') score += isLong ? -10 : 10;
  }

  return Math.min(100, Math.max(0, score));
}

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

export async function runOrchestrator(input: OrchestratorInput): Promise<OrchestratorResult> {
  const { coin, direction, entry, sl, tp, confidence, strategy, timeframe, marketPrice } = input;
  const rr = Math.abs(tp - entry) / Math.abs(entry - sl);

  // ── 1. Fire all agents in parallel ──────────────────────────────────────────
  const [
    regimeRes, cgRes, newsRes, whaleRes, aiRes, statsRes,
  ] = await Promise.allSettled([
    getMarketRegime(),
    getCoinglassData(coin),
    getNewsSentiment(coin),
    getWhaleActivity(coin),
    analyzeSignalWithAI({
      coin, type: direction, entry, tp, sl, marketPrice, timeframe, confidence, strategy,
      agentContext: input.agentContext,
    }),
    getQuickStats(),
  ]);

  const marketRegime = regimeRes.status === 'fulfilled' ? regimeRes.value : fallbackRegime();
  const coinglass = cgRes.status === 'fulfilled' ? cgRes.value : fallbackCG(coin);
  const news = newsRes.status === 'fulfilled' ? newsRes.value : fallbackNews(coin);
  const whale = whaleRes.status === 'fulfilled' ? whaleRes.value : fallbackWhale(coin);
  const primaryAI = aiRes.status === 'fulfilled' ? aiRes.value : fallbackAI(confidence, sl, tp);
  const quickStats = statsRes.status === 'fulfilled' ? statsRes.value : { todayPnl: 0, weekPnl: 0, winRate7d: 0 };

  // ── 2. Phase 2 technical confluence ─────────────────────────────────────────
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
    } catch { /* phase2 remains null */ }
  }

  // ── 3. Risk assessment ───────────────────────────────────────────────────────
  const allTrades = await storage.getBotTrades();
  const openTrades = allTrades.filter(t => t.status === 'open');
  const botSettings = await storage.getBotSettings();
  const bs = botSettings as any;

  const riskAssessment = await assessTradeRisk({
    coin, direction, entry, sl, tp, confidence, timeframe,
    walletBalance: bs?.paperBalance ?? 1000,
    openTrades, allTrades,
    baseRiskPct: bs?.riskPerTradePercent ?? 2,
    baseLeverage: bs?.defaultLeverage ?? 10,
    startingBalance: bs?.paperStartingBalance ?? 1000,
  });

  // ── 4. Compute weighted composite score ──────────────────────────────────────
  const adjustments: OrchestratorResult['adjustments'] = [];
  const warnings: string[] = [...marketRegime.warnings, ...riskAssessment.warnings];

  // Technical score (40% weight)
  const technicalScore = phase2 ? phase2.compositeScore : primaryAI.adjustedConfidence;

  // Sentiment score (30% weight)
  const sentimentScore = sentimentBlend(coinglass, news, whale, direction);

  // Macro score (30% weight)
  const macroScore = marketRegime.macroScore;

  const scores: AgentScores = {
    macro: macroScore,
    sentiment: sentimentScore,
    technical: technicalScore,
    primaryAI: primaryAI.adjustedConfidence,
    composite: 0, // computed below
  };

  // Weighted composite
  const composite = (technicalScore * 0.40) + (sentimentScore * 0.30) + (macroScore * 0.30);
  scores.composite = Math.round(composite);

  // ── 5. Apply individual deltas ───────────────────────────────────────────────
  let finalConf = composite;

  // Macro alignment delta
  const { delta: macroDelta, reason: macroReason } = macroScoreToSignalDelta(
    marketRegime.regime, direction, marketRegime.sessionScore,
  );
  if (macroDelta !== 0) {
    finalConf += macroDelta;
    adjustments.push({ agent: 'Market Intelligence', delta: macroDelta, reason: macroReason });
  }

  // Extreme funding rate
  if (coinglass.available && Math.abs(coinglass.fundingRate) > 0.0005) {
    finalConf -= 6;
    adjustments.push({ agent: 'Coinglass', delta: -6, reason: `Extreme funding ${coinglass.fundingRatePercent}%` });
  }

  // High-risk news
  if (news.available && news.riskLevel === 'HIGH') {
    finalConf -= 15;
    adjustments.push({ agent: 'News', delta: -15, reason: 'HIGH-risk news event detected' });
    warnings.push('HIGH-risk news: ' + news.headline);
  }

  // Phase 2 grade bonus/penalty
  if (phase2) {
    if (phase2.grade === 'A+') { finalConf += 8; adjustments.push({ agent: 'Phase2 TA', delta: 8, reason: 'A+ confluence grade' }); }
    else if (phase2.grade === 'A') { finalConf += 4; adjustments.push({ agent: 'Phase2 TA', delta: 4, reason: 'A confluence grade' }); }
    else if (phase2.grade === 'B+') { finalConf += 2; adjustments.push({ agent: 'Phase2 TA', delta: 2, reason: 'B+ confluence grade' }); }
    else if (phase2.grade === 'No Trade') { finalConf -= 20; adjustments.push({ agent: 'Phase2 TA', delta: -20, reason: 'No Trade grade — confluence insufficient' }); }
    else if (phase2.grade === 'C') { finalConf -= 10; adjustments.push({ agent: 'Phase2 TA', delta: -10, reason: 'C grade — marginal confluence' }); }
  }

  // R:R bonus
  if (rr >= 3.0) { finalConf += 5; adjustments.push({ agent: 'R:R', delta: 5, reason: `Excellent R:R ${rr.toFixed(2)}` }); }
  else if (rr < 1.5) { finalConf -= 15; adjustments.push({ agent: 'R:R', delta: -15, reason: `Poor R:R ${rr.toFixed(2)}` }); }

  // Risk block
  if (riskAssessment.blocked) {
    finalConf = Math.min(finalConf, 40); // force below threshold
    warnings.push(`RISK BLOCKED: ${riskAssessment.blockReason}`);
  }

  // Weekly loss streak penalty
  if (quickStats.winRate7d < 0.3 && quickStats.weekPnl < 0) {
    finalConf -= 8;
    adjustments.push({ agent: 'Journal', delta: -8, reason: `Poor 7d win rate (${(quickStats.winRate7d * 100).toFixed(0)}%)` });
    warnings.push('Low 7-day win rate — consider strategy review');
  }

  finalConf = Math.min(80, Math.max(5, Math.round(finalConf)));

  const finalVerdict = deriveVerdict(finalConf, direction);
  const grade = phase2?.grade ?? deriveGrade(finalConf, rr);
  const shouldTrade = finalConf >= 68 && finalVerdict !== 'NEUTRAL' && !riskAssessment.blocked;
  const approved = shouldTrade && riskAssessment.approved;

  // ── 6. Build human-readable summary ─────────────────────────────────────────
  const summary = [
    `[${grade}] ${direction} ${coin} | Confidence: ${finalConf}% → ${finalVerdict}`,
    `Macro: ${marketRegime.regime} | Session: ${marketRegime.session} (${marketRegime.sessionScore}/100)`,
    `TA: ${technicalScore.toFixed(0)}/100 | Sentiment: ${sentimentScore.toFixed(0)}/100 | Macro: ${macroScore.toFixed(0)}/100`,
    approved ? '✅ APPROVED TO TRADE' : `⛔ ${riskAssessment.blockReason ?? 'Below threshold — skip'}`,
  ].join('\n');

  const tradeRationale = phase2?.summary ??
    `${direction} ${coin}: ${primaryAI.reasoning?.slice(0, 200) ?? 'No reasoning available'}`;

  return {
    approved, finalConfidence: finalConf, finalVerdict, shouldTrade, grade,
    scores, marketRegime, phase2, riskAssessment,
    coinglass, news, whale, primaryAI,
    adjustments, summary, tradeRationale, warnings,
    timestamp: new Date().toISOString(),
    quickStats,
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
function fallbackAI(confidence: number, sl: number, tp: number): AISignalAnalysis {
  return { verdict: 'NEUTRAL', adjustedConfidence: confidence, reasoning: 'AI unavailable', riskLevel: 'MEDIUM', keyLevels: { support: sl, resistance: tp }, marketSentiment: 'Unknown' };
}
