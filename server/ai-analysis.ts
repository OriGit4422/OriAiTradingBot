import { callMultiAI, extractJson, type AIMessage } from './ai-providers';
import {
  buildDeepAnalysisPrompt, deterministicDeepAnalysis,
  type DeepAnalysisInput, type DeepCoinAnalysis,
} from './deep-analysis-core';

export type { DeepCoinAnalysis } from './deep-analysis-core';

const AI_PROVIDER_COOLDOWN_MS = 5 * 60 * 1000;
/** When the daily budget guard trips, back off for an hour rather than 5 min. */
const AI_BUDGET_COOLDOWN_MS = 60 * 60 * 1000;
let aiProviderDisabledUntil = 0;

// ── Response caches to avoid redundant AI calls ──────────────────────────────
const signalAnalysisCache = new Map<string, { result: any; expiresAt: number }>();
const marketInsightCache = new Map<string, { result: any; expiresAt: number }>();
// A signal's inputs are candle-derived; on a 15m+ timeframe they cannot
// meaningfully change inside a quarter hour, so re-asking the model inside that
// window buys nothing but spend.
const SIGNAL_CACHE_TTL_MS = 15 * 60 * 1000;
const MARKET_INSIGHT_CACHE_TTL_MS = 30 * 60 * 1000;

export interface AISignalAnalysis {
  verdict: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
  adjustedConfidence: number;
  reasoning: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  keyLevels: { support: number; resistance: number };
  marketSentiment: string;
}

export interface AgentContext {
  coinglassBias?:    string;
  coinglassSignal?:  string;
  fundingRate?:      number;
  longPercent?:      number;
  newsSentiment?:    string;
  newsHeadline?:     string;
  newsRiskLevel?:    string;
  newsImpact?:       string;
  newsTopHeadlines?: string[];
  whaleBias?:        string;
  whaleSignal?:      string;
  xSentiment?:       string;
  // SMC / ICT / Quantum context from client-side analysis
  smcStructure?:           'BULLISH' | 'BEARISH' | 'RANGING' | string;
  rsiDivergence?:          'BULLISH' | 'BEARISH' | 'NONE' | string;
  ichimokuSignal?:         string;
  volumeProfile?:          string;
  volumeForecast?:         string;
  whaleActivity?:          string;
  marketPhase?:            string;
  liquidityClusters?:      number;
  ensembleDirection?:      string;
  ensembleConfidence?:     number;
  smcScore?:               number;
  ictScore?:               number;
  quantumLiquidityScore?:  number;
  liquidityDepthScore?:    number;
  crtScore?:               number;
  // SMC/ICT Engine v4 context
  smcV4Score?:             number;
  smcV4Grade?:             string;
  smcV4Label?:             string;
  premiumDiscount?:        string;
  inOTEZone?:              boolean;
  breakerBlocks?:          number;
  cisdCount?:              number;
  powerOf3Phase?:          string;
  powerOf3Direction?:      string;
}

function getAIFallback(signalData: {
  type: string;
  confidence: number;
  sl: number;
  tp: number;
}): AISignalAnalysis {
  const isLong = signalData.type?.toUpperCase() === 'LONG';
  const isShort = signalData.type?.toUpperCase() === 'SHORT';
  return {
    verdict: isLong ? 'BUY' : isShort ? 'SELL' : signalData.confidence >= 85 ? 'BUY' : 'NEUTRAL',
    adjustedConfidence: signalData.confidence,
    reasoning: 'AI analysis temporarily unavailable - using base signal data',
    riskLevel: 'MEDIUM',
    keyLevels: { support: signalData.sl, resistance: signalData.tp },
    marketSentiment: 'Calculating...',
  };
}

export async function analyzeSignalWithAI(signalData: {
  coin: string;
  type: string;
  entry: number;
  tp: number;
  sl: number;
  marketPrice: number;
  timeframe: string;
  confidence: number;
  strategy: string;
  agentContext?: AgentContext;
}): Promise<AISignalAnalysis> {
  if (Date.now() < aiProviderDisabledUntil) {
    return getAIFallback(signalData);
  }

  // Check cache: same coin+type+timeframe+confidence bucket within 5 min
  const cacheKey = `${signalData.coin}:${signalData.type}:${signalData.timeframe}:${Math.round(signalData.confidence / 5) * 5}`;
  const cached = signalAnalysisCache.get(cacheKey);
  if (cached && Date.now() < cached.expiresAt) {
    return cached.result as AISignalAnalysis;
  }

  try {
    const rr = (Math.abs(signalData.tp - signalData.entry) / Math.abs(signalData.entry - signalData.sl)).toFixed(2);
    const ctx = signalData.agentContext;

    // Token-minimal context. Every value below was already computed
    // deterministically — the model is asked to weigh them, not to be taught
    // the methodology. Restating the ICT scoring rubric on every call cost
    // ~900 input tokens per signal and never changed the verdict distribution.
    const parts: string[] = [];
    if (ctx?.coinglassBias) parts.push(`deriv=${ctx.coinglassBias}/fund${ctx.fundingRate?.toFixed(3)}/L${ctx.longPercent?.toFixed(0)}`);
    if (ctx?.newsSentiment) parts.push(`news=${ctx.newsSentiment}/${ctx.newsRiskLevel}`);
    if (ctx?.xSentiment) parts.push(`social=${ctx.xSentiment}`);
    if (ctx?.whaleBias) parts.push(`whale=${ctx.whaleBias}`);
    if (ctx?.smcStructure) parts.push(`smc=${ctx.smcStructure}/div${ctx.rsiDivergence}/phase${ctx.marketPhase}`);
    if (ctx?.quantumLiquidityScore !== undefined) parts.push(`scores SMC${ctx.smcScore}/ICT${ctx.ictScore}/QL${ctx.quantumLiquidityScore}/LD${ctx.liquidityDepthScore}`);
    if (ctx?.smcV4Score !== undefined) parts.push(`v4=${ctx.smcV4Score}/10 ${ctx.smcV4Grade} zone${ctx.premiumDiscount} OTE${ctx.inOTEZone ? 'Y' : 'N'} brk${ctx.breakerBlocks} PO3${ctx.powerOf3Phase}`);
    if (ctx?.ensembleDirection) parts.push(`ens=${ctx.ensembleDirection}@${ctx.ensembleConfidence}%`);
    const agentBlock = parts.length ? `\nContext: ${parts.join(' | ')}` : '';

    const prompt = `Crypto signal review. Indicators are already computed — weigh them, do not recompute.
${signalData.type} ${signalData.coin} ${signalData.timeframe} | entry ${signalData.entry.toFixed(4)} tp ${signalData.tp.toFixed(4)} sl ${signalData.sl.toFixed(4)} | R:R 1:${rr} | base ${signalData.confidence}% | ${signalData.strategy}${agentBlock}
Rules: R:R<1.5 → cut hard. Context conflicting with direction → cut. Aligned SMC/v4 + sweep + OTE → support. Range 10-95.
JSON only: {"verdict":"STRONG_BUY|BUY|NEUTRAL|SELL|STRONG_SELL","adjustedConfidence":<int>,"reasoning":"<max 25 words>","riskLevel":"LOW|MEDIUM|HIGH","keyLevels":{"support":<num>,"resistance":<num>},"marketSentiment":"<max 8 words>"}`;

    const messages: AIMessage[] = [{ role: 'user', content: prompt }];
    const { text } = await callMultiAI(messages, {
      maxTokens: 220,
      tier: 'normal',
      cacheTtlMs: SIGNAL_CACHE_TTL_MS,
      label: 'signal-analysis',
    });

    const jsonMatch = extractJson(text);
    if (!jsonMatch) throw new Error('Could not parse AI response');

    const parsed = JSON.parse(jsonMatch);
    const result: AISignalAnalysis = {
      verdict: parsed.verdict || 'NEUTRAL',
      adjustedConfidence: Math.min(100, Math.max(0, parsed.adjustedConfidence || signalData.confidence)),
      reasoning: parsed.reasoning || 'Analysis unavailable',
      riskLevel: parsed.riskLevel || 'MEDIUM',
      keyLevels: parsed.keyLevels || { support: signalData.sl, resistance: signalData.tp },
      marketSentiment: parsed.marketSentiment || 'Neutral',
    };
    signalAnalysisCache.set(cacheKey, { result, expiresAt: Date.now() + SIGNAL_CACHE_TTL_MS });
    return result;
  } catch (error: any) {
    if (error.message?.includes('No AI providers configured')) {
      aiProviderDisabledUntil = Date.now() + AI_PROVIDER_COOLDOWN_MS;
    }
    // Budget guard tripped: stop hammering the endpoint for the rest of the hour.
    // The deterministic fallback is used and the signal is still tradeable.
    if (error?.budgetExceeded) {
      aiProviderDisabledUntil = Date.now() + AI_BUDGET_COOLDOWN_MS;
      console.warn('[ai-analysis] AI budget reached — deterministic fallback for 1h:', error.message);
    } else {
      console.error('AI analysis error:', error?.message || error);
    }
    return getAIFallback(signalData);
  }
}

/**
 * Deep analysis of one asset.
 *
 * The deterministic plan is built first and always. The AI pass is an overlay on
 * top of it: when it succeeds its narrative and levels are used, and when it does
 * not — spent budget, missing key, provider outage, unparseable answer — the
 * deterministic plan is returned with `degraded: true` and the reason attached.
 *
 * This function does not throw. Every failure mode it has still leaves a usable,
 * fully-populated analysis, because the numbers never depended on the AI in the
 * first place. Throwing here surfaced as a 500 that told the user their analysis
 * had failed when in fact only the commentary on it had.
 */
export async function getDeepCoinAnalysis(input: DeepAnalysisInput): Promise<DeepCoinAnalysis> {
  const { coin, timeframe, marketPrice } = input;

  if (Date.now() < aiProviderDisabledUntil) {
    return deterministicDeepAnalysis(
      input,
      'AI layer is in cooldown after a recent budget or provider failure — deterministic plan shown.',
    );
  }

  const prompt = buildDeepAnalysisPrompt(input);

  try {
    const { text } = await callMultiAI([{ role: 'user', content: prompt }], {
      // User-initiated and trade-facing, so it belongs in 'normal' rather than
      // with the decorative prose — but it still yields to the AI veto on a live
      // signal, which is the only tier allowed to reach 100% of the budget.
      //
      // 650 output tokens is enough for every field at the one-sentence cap the
      // prompt sets, and is what the governor prices admission at. The old 1,100
      // was more than a third of a $0.05 day on a premium model, so the call
      // could never be admitted at all.
      maxTokens: 650,
      tier: 'normal',
      cacheTtlMs: 15 * 60 * 1000,
      label: 'deep-coin-analysis',
    });
    const jsonMatch = extractJson(text);
    if (!jsonMatch) throw new Error('Could not parse AI response');
    const p = JSON.parse(jsonMatch);
    const dir = ['LONG', 'SHORT', 'NEUTRAL'].includes(p.direction) ? p.direction : 'NEUTRAL';

    // Fall back field by field to the deterministic plan rather than to filler
    // like "analysis unavailable": a truncated answer should lose the fields it
    // truncated, not the whole result.
    const base = deterministicDeepAnalysis(input);
    const num = (v: unknown, fallback: number) => (Number.isFinite(Number(v)) ? Number(v) : fallback);

    return {
      coin,
      timeframe,
      direction: dir,
      confidence: Math.min(95, Math.max(10, num(p.confidence, base.confidence))),
      entry: num(p.entry, marketPrice),
      stopLoss: num(p.stopLoss, base.stopLoss),
      takeProfit1: num(p.takeProfit1, base.takeProfit1),
      takeProfit2: num(p.takeProfit2, base.takeProfit2),
      takeProfit3: num(p.takeProfit3, base.takeProfit3),
      riskReward: p.riskReward || base.riskReward,
      smcAnalysis: p.smcAnalysis || base.smcAnalysis,
      ictAnalysis: p.ictAnalysis || base.ictAnalysis,
      quantumLiquidityAnalysis: p.quantumLiquidityAnalysis || base.quantumLiquidityAnalysis,
      newsImpact: p.newsImpact || base.newsImpact,
      socialSentiment: p.socialSentiment || base.socialSentiment,
      technicalAnalysis: p.technicalAnalysis || base.technicalAnalysis,
      multiTimeframeAnalysis: p.multiTimeframeAnalysis || base.multiTimeframeAnalysis,
      tradeRationale: p.tradeRationale || base.tradeRationale,
      confluenceScore: Math.min(100, Math.max(0, num(p.confluenceScore, base.confluenceScore))),
      confluenceFactors: Array.isArray(p.confluenceFactors) && p.confluenceFactors.length
        ? p.confluenceFactors.slice(0, 10)
        : base.confluenceFactors,
      analysisLogs: Array.isArray(p.analysisLogs) && p.analysisLogs.length
        ? p.analysisLogs.slice(0, 10)
        : base.analysisLogs,
      riskAssessment: p.riskAssessment || base.riskAssessment,
      keyLevels: {
        support: Array.isArray(p.keyLevels?.support) && p.keyLevels.support.length
          ? p.keyLevels.support.map(Number).filter(Boolean)
          : base.keyLevels.support,
        resistance: Array.isArray(p.keyLevels?.resistance) && p.keyLevels.resistance.length
          ? p.keyLevels.resistance.map(Number).filter(Boolean)
          : base.keyLevels.resistance,
      },
      invalidation: p.invalidation || base.invalidation,
      summary: p.summary || base.summary,
      warnings: Array.isArray(p.warnings) ? p.warnings.slice(0, 4) : [],
      timestamp: new Date().toISOString(),
      source: 'ai',
      degraded: false,
    };
  } catch (error: any) {
    const message = error?.message || String(error);

    if (message.includes('No AI providers configured')) {
      aiProviderDisabledUntil = Date.now() + AI_PROVIDER_COOLDOWN_MS;
      return deterministicDeepAnalysis(
        input,
        'No AI provider is configured — add a key in Settings → AI Agents for the narrative layer. Levels below are from the deterministic engine.',
      );
    }

    if (error?.budgetExceeded || /budget guard/i.test(message)) {
      aiProviderDisabledUntil = Date.now() + AI_BUDGET_COOLDOWN_MS;
      console.warn('[ai-analysis] Deep analysis hit the AI budget — deterministic plan returned:', message);
      return deterministicDeepAnalysis(
        input,
        "Today's AI budget is spent, so this plan comes from the deterministic engine. Raise the cap in Settings or wait for the 00:00 UTC reset.",
      );
    }

    console.error('[ai-analysis] Deep analysis failed, returning deterministic plan:', message);
    return deterministicDeepAnalysis(
      input,
      `AI providers are unreachable (${message.slice(0, 160)}) — deterministic plan shown.`,
    );
  }
}

export interface CoinInsight {
  coin: string;
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  shortAnalysis: string;
  keyLevel: string;
  action: 'BUY' | 'SELL' | 'HOLD' | 'WATCH';
  xSentiment?: string;
  fomoLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
  liquidityView?: string;
  psychologicalLevels?: string;
  newsBias?: string;
}

export interface UpcomingTrade {
  coin: string;
  direction: 'LONG' | 'SHORT';
  reason: string;
  confidence: number;
  timeframe: string;
}

export interface MarketInsightResult {
  overview: string;
  coins: CoinInsight[];
  upcomingTrades: UpcomingTrade[];
  marketMood: string;
  timestamp: string;
}

export async function getMarketInsight(coins: string[], marketData?: any[]): Promise<MarketInsightResult> {
  // Cache keyed by sorted coin list — reuse result for 10 min
  const insightKey = [...coins].sort().join(',');
  const cachedInsight = marketInsightCache.get(insightKey);
  if (cachedInsight && Date.now() < cachedInsight.expiresAt) {
    return cachedInsight.result as MarketInsightResult;
  }

  const fallbackResult: MarketInsightResult = {
    overview: 'Crypto markets are showing mixed signals. Monitor key support and resistance levels across major pairs for breakout opportunities.',
    coins: coins.map(c => ({
      coin: c,
      sentiment: 'NEUTRAL' as const,
      shortAnalysis: 'Consolidating near key levels. Watch for volume confirmation.',
      keyLevel: 'Support/Resistance zone active',
      action: 'WATCH' as const,
      xSentiment: 'Neutral social sentiment',
      fomoLevel: 'MEDIUM' as const,
      liquidityView: 'Balanced',
      psychologicalLevels: 'Near round-number pivots',
      newsBias: 'No strong catalyst',
    })),
    upcomingTrades: [
      { coin: 'BTC', direction: 'LONG', reason: 'Holding above key support with increasing volume', confidence: 75, timeframe: '4h' },
      { coin: 'ETH', direction: 'LONG', reason: 'Bullish divergence on RSI with accumulation signs', confidence: 70, timeframe: '1h' },
      { coin: 'SOL', direction: 'SHORT', reason: 'Rejection at resistance with declining momentum', confidence: 68, timeframe: '15m' },
    ],
    marketMood: 'Cautiously Optimistic',
    timestamp: new Date().toISOString(),
  };

  if (Date.now() < aiProviderDisabledUntil) return fallbackResult;

  try {
    // `sym price chg% vol` per line. The old form spelled out "Current Price",
    // "24h Change" and "24h Volume" on every line — ~20 wasted input tokens per
    // coin, repeated on every refresh for the life of the app.
    const marketContext = marketData?.length
      ? marketData.map(d => `${d.symbol} ${d.price} ${d.change > 0 ? '+' : ''}${d.change.toFixed(2)}% ${(d.volume / 1e6).toFixed(0)}M`).join('\n')
      : coins.map(c => `${c} -`).join('\n');

    // Rules that the parser below enforces anyway are not restated here.
    // Sentiment/action agreement and trade-direction agreement are both corrected
    // deterministically after the response lands, so paying tokens to ask for
    // them bought nothing — the code was already the authority.
    const userMsg = `Crypto market read. JSON only, no markdown.
Data (sym price chg24h vol24h):
${marketContext}

Key levels within 5% of the price shown. Sentiment follows chg24h: >+1% BULLISH, <-1% BEARISH, else NEUTRAL.
3-5 upcomingTrades, only from non-NEUTRAL coins. Every prose field: one short sentence.

{"overview":"<2 sentences citing real prices>","coins":[{"coin":"","sentiment":"BULLISH|BEARISH|NEUTRAL","shortAnalysis":"","keyLevel":"","action":"BUY|SELL|HOLD|WATCH","xSentiment":"","fomoLevel":"LOW|MEDIUM|HIGH","liquidityView":"","psychologicalLevels":"","newsBias":""}],"upcomingTrades":[{"coin":"","direction":"LONG|SHORT","reason":"","confidence":<60-95>,"timeframe":"15m|1h|4h"}],"marketMood":"<1-3 words>"}
All ${coins.length} coins required.`;

    const messages: AIMessage[] = [{ role: 'user', content: userMsg }];

    const { text } = await callMultiAI(messages, {
      // Dashboard overview prose — cosmetic tier, and cached for as long as the
      // panel's own cache so the two never disagree.
      maxTokens: 700,
      tier: 'cosmetic',
      cacheTtlMs: 10 * 60 * 1000,
      label: 'market-insight',
    });
    const jsonMatch = extractJson(text);
    if (!jsonMatch) return fallbackResult;

    const parsed = JSON.parse(jsonMatch);

    const coins_result = (parsed.coins || []).map((c: any) => {
      const sentiment = (['BULLISH', 'BEARISH', 'NEUTRAL'].includes(c.sentiment) ? c.sentiment : 'NEUTRAL') as 'BULLISH' | 'BEARISH' | 'NEUTRAL';
      // Enforce action consistency with sentiment
      let action = (['BUY', 'SELL', 'HOLD', 'WATCH'].includes(c.action) ? c.action : 'WATCH') as 'BUY' | 'SELL' | 'HOLD' | 'WATCH';
      if (sentiment === 'BULLISH' && action === 'SELL') action = 'BUY';
      if (sentiment === 'BEARISH' && action === 'BUY') action = 'SELL';
      if (sentiment === 'NEUTRAL' && (action === 'BUY' || action === 'SELL')) action = 'WATCH';
      return {
        coin: c.coin || 'BTC',
        sentiment,
        shortAnalysis: c.shortAnalysis || 'Analysis pending',
        keyLevel: c.keyLevel || 'Key levels being calculated',
        action,
        xSentiment: c.xSentiment || 'Neutral social sentiment',
        fomoLevel: (['LOW', 'MEDIUM', 'HIGH'].includes(c.fomoLevel) ? c.fomoLevel : 'MEDIUM') as 'LOW' | 'MEDIUM' | 'HIGH',
        liquidityView: c.liquidityView || 'Liquidity balanced near VWAP',
        psychologicalLevels: c.psychologicalLevels || 'Round numbers and weekly pivots',
        newsBias: c.newsBias || 'No strong catalyst',
      };
    });

    // Build sentiment map for trade direction enforcement
    const sentimentMap = new Map(coins_result.map((c: any) => [c.coin, c.sentiment]));

    const upcomingTrades = (parsed.upcomingTrades || [])
      .filter((t: any) => {
        const s = sentimentMap.get(t.coin);
        // Drop trades for NEUTRAL coins — no clear directional edge
        return s === 'BULLISH' || s === 'BEARISH';
      })
      .map((t: any) => {
        const s = sentimentMap.get(t.coin);
        // Force direction to match sentiment regardless of what AI returned
        const direction = s === 'BULLISH' ? 'LONG' as const : 'SHORT' as const;
        return {
          coin: t.coin || 'BTC',
          direction,
          reason: t.reason || 'Technical setup forming',
          confidence: Math.min(100, Math.max(0, t.confidence || 70)),
          timeframe: t.timeframe || '1h',
        };
      });

    const insightResult: MarketInsightResult = {
      overview: parsed.overview || fallbackResult.overview,
      coins: coins_result,
      upcomingTrades,
      marketMood: parsed.marketMood || 'Neutral',
      timestamp: new Date().toISOString(),
    };
    marketInsightCache.set(insightKey, { result: insightResult, expiresAt: Date.now() + MARKET_INSIGHT_CACHE_TTL_MS });
    return insightResult;
  } catch (error: any) {
    if (error.message?.includes('No AI providers configured')) {
      aiProviderDisabledUntil = Date.now() + AI_PROVIDER_COOLDOWN_MS;
    }
    console.error('Market insight error:', error?.message || error);
    return fallbackResult;
  }
}
