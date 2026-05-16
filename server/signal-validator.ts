/**
 * Multi-Agent Signal Validator
 * Orchestrates Coinglass + Perplexity + Arkham + Claude to produce
 * a consensus-adjusted confidence score for any trading signal.
 */
import { getCoinglassData, type CoinglassData } from './coinglass';
import { getNewsSentiment,  type NewsSentiment  } from './perplexity';
import { getWhaleActivity,  type WhaleActivity  } from './arkham';
import { analyzeSignalWithAI, type AISignalAnalysis } from './ai-analysis';

export interface SignalInput {
  coin: string;
  type: string;          // 'LONG' | 'SHORT'
  entry: number;
  tp: number;
  sl: number;
  confidence: number;
  strategy: string;
  timeframe: string;
  marketPrice: number;
}

export interface AgentAdjustment {
  agent: string;
  delta: number;         // positive = boosted, negative = reduced
  reason: string;
}

export interface MultiAgentValidation {
  coin: string;
  direction: 'LONG' | 'SHORT';
  originalConfidence: number;
  adjustedConfidence: number;
  delta: number;                // net change
  finalVerdict: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
  shouldTrade: boolean;
  agentsActive: number;         // how many agents contributed data
  adjustments: AgentAdjustment[];
  summary: string;
  agents: {
    coinglass:  CoinglassData;
    news:       NewsSentiment;
    whale:      WhaleActivity;
    primaryAI:  AISignalAnalysis;
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function agreementDelta(
  direction: 'LONG' | 'SHORT',
  bias: 'BULLISH' | 'BEARISH' | 'NEUTRAL',
  weight: number,
): number {
  if (bias === 'NEUTRAL') return 0;
  const agrees = (direction === 'LONG' && bias === 'BULLISH') ||
                 (direction === 'SHORT' && bias === 'BEARISH');
  return agrees ? weight : -weight;
}

function toVerdict(
  direction: 'LONG' | 'SHORT',
  conf: number,
): MultiAgentValidation['finalVerdict'] {
  if (conf >= 88) return direction === 'LONG' ? 'STRONG_BUY'  : 'STRONG_SELL';
  if (conf >= 72) return direction === 'LONG' ? 'BUY'         : 'SELL';
  if (conf >= 52) return 'NEUTRAL';
  return                 direction === 'LONG' ? 'SELL'        : 'BUY';
}

// ─── Main Orchestrator ───────────────────────────────────────────────────────

export async function runMultiAgentValidation(
  signal: SignalInput,
): Promise<MultiAgentValidation> {
  const direction = signal.type as 'LONG' | 'SHORT';

  // Fire all agents in parallel — any single failure must NOT block the rest
  const [cgRes, newsRes, whaleRes, aiRes] = await Promise.allSettled([
    getCoinglassData(signal.coin),
    getNewsSentiment(signal.coin),
    getWhaleActivity(signal.coin),
    analyzeSignalWithAI(signal),
  ]);

  const coinglass = cgRes.status   === 'fulfilled' ? cgRes.value    : fallbackCoinglass(signal.coin);
  const news      = newsRes.status === 'fulfilled' ? newsRes.value  : fallbackNews(signal.coin);
  const whale     = whaleRes.status=== 'fulfilled' ? whaleRes.value : fallbackWhale(signal.coin);
  const primaryAI = aiRes.status   === 'fulfilled' ? aiRes.value    : fallbackClaude(signal);

  // Start from primaryAI's adjusted confidence (already incorporates TA)
  let conf = primaryAI.adjustedConfidence;
  const adjustments: AgentAdjustment[] = [];
  let agentsActive = 1; // primaryAI always counts

  // ── 1. Coinglass (weight ±8, bonus penalty for extreme funding) ──
  if (coinglass.available) {
    agentsActive++;
    const delta = agreementDelta(direction, coinglass.bias, 8);
    if (delta !== 0) {
      conf += delta;
      adjustments.push({ agent: 'Coinglass', delta, reason: coinglass.signal });
    }
    // Extra penalty when funding rate is dangerously extreme (>0.05% per 8h)
    if (Math.abs(coinglass.fundingRate) > 0.0005) {
      conf -= 6;
      adjustments.push({ agent: 'Coinglass', delta: -6, reason: `Extreme funding rate ${coinglass.fundingRatePercent}% — liquidation risk` });
    }
  }

  // ── 2. Perplexity news (weight ±10, risk penalty stacks) ──
  if (news.available) {
    agentsActive++;
    const delta = agreementDelta(direction, news.sentiment, 10);
    if (delta !== 0) {
      conf += delta;
      adjustments.push({ agent: 'Perplexity', delta, reason: news.headline });
    }
    if (news.riskLevel === 'HIGH') {
      conf -= 12;
      adjustments.push({ agent: 'Perplexity', delta: -12, reason: `HIGH-risk news event — regulatory/exploit/hack detected` });
    } else if (news.riskLevel === 'MEDIUM') {
      conf -= 4;
      adjustments.push({ agent: 'Perplexity', delta: -4, reason: 'Medium-risk news event detected' });
    }
  }

  // ── 3. Arkham whale (weight ±7) ──
  if (whale.available) {
    agentsActive++;
    const delta = agreementDelta(direction, whale.flowBias, 7);
    if (delta !== 0) {
      conf += delta;
      adjustments.push({ agent: 'Arkham', delta, reason: whale.signal });
    }
  }

  const adjustedConfidence = Math.min(100, Math.max(0, Math.round(conf)));
  const delta = adjustedConfidence - signal.confidence;
  const finalVerdict = toVerdict(direction, adjustedConfidence);
  const shouldTrade  = adjustedConfidence >= 68 && finalVerdict !== 'NEUTRAL';

  const summary = [
    `${agentsActive}/4 agents active.`,
    `Confidence ${signal.confidence}% → ${adjustedConfidence}% (${delta >= 0 ? '+' : ''}${delta}%).`,
    adjustments.length
      ? `${adjustments.length} adjustment(s) applied.`
      : 'No adjustments — all agents neutral.',
    shouldTrade ? `✅ Signal CONFIRMED to trade.` : `⛔ Signal FILTERED — below threshold.`,
  ].join(' ');

  return {
    coin: signal.coin, direction, originalConfidence: signal.confidence,
    adjustedConfidence, delta, finalVerdict, shouldTrade,
    agentsActive, adjustments, summary,
    agents: { coinglass, news, whale, primaryAI },
  };
}

// ─── Fallbacks ───────────────────────────────────────────────────────────────

function fallbackCoinglass(coin: string): CoinglassData {
  return { coin, fundingRate: 0, fundingRatePercent: 0, longPercent: 50, shortPercent: 50,
    openInterestUSD: 0, bias: 'NEUTRAL', signal: 'Coinglass data unavailable', available: false };
}
function fallbackNews(coin: string): NewsSentiment {
  return { coin, sentiment: 'NEUTRAL', headline: 'News unavailable', summary: '',
    riskLevel: 'LOW', keyEvents: [], tradingImpact: '', available: false };
}
function fallbackWhale(coin: string): WhaleActivity {
  return { coin, netExchangeFlow: 'NEUTRAL', exchangeInflows: 0, exchangeOutflows: 0,
    totalVolumeUSD: 0, flowBias: 'NEUTRAL', signal: 'Arkham data unavailable',
    topTransfers: [], available: false };
}
function fallbackClaude(signal: SignalInput): AISignalAnalysis {
  return { verdict: 'NEUTRAL', adjustedConfidence: signal.confidence,
    reasoning: 'Claude analysis unavailable', riskLevel: 'MEDIUM',
    keyLevels: { support: signal.sl, resistance: signal.tp }, marketSentiment: 'Unknown' };
}
