import { callMultiAI, extractJson, type AIMessage } from './ai-providers';

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

export interface DeepCoinAnalysis {
  coin: string;
  timeframe: string;
  direction: 'LONG' | 'SHORT' | 'NEUTRAL';
  confidence: number;
  entry: number;
  stopLoss: number;
  takeProfit1: number;
  takeProfit2: number;
  takeProfit3: number;
  riskReward: string;
  smcAnalysis: string;
  ictAnalysis: string;
  quantumLiquidityAnalysis: string;
  newsImpact: string;
  socialSentiment: string;
  technicalAnalysis: string;
  multiTimeframeAnalysis: string;
  tradeRationale: string;
  confluenceScore: number;
  confluenceFactors: string[];
  analysisLogs: string[];
  riskAssessment: string;
  keyLevels: { support: number[]; resistance: number[] };
  invalidation: string;
  summary: string;
  warnings: string[];
  timestamp: string;
}

export async function getDeepCoinAnalysis(input: {
  coin: string;
  timeframe: string;
  marketPrice: number;
  indicators?: any;
  recentNews?: string[];
  xSentiment?: string;
}): Promise<DeepCoinAnalysis> {
  const { coin, timeframe, marketPrice, indicators = {}, recentNews = [], xSentiment } = input;
  const sd = indicators.strategyDepth || {};

  const techBlock = `
Live Technical Snapshot (${coin}/USDT @ ${timeframe}, current price $${marketPrice}):
- RSI: ${indicators.rsi}, MACD: ${indicators.macdSignal}, EMA Trend: ${indicators.emaTrend}
- Market Structure: ${indicators.marketStructure}, RSI Divergence: ${indicators.rsiDivergence}
- Market Phase: ${indicators.marketPhase}, Volume: ${indicators.volumeProfile} (forecast: ${indicators.volumeForecast})
- Whale Activity: ${indicators.whaleActivity}, Liquidity Clusters: ${indicators.liquidityClusters}
- Ensemble: ${indicators.ensembleDirection} @ ${indicators.ensembleConfidence}%, Ichimoku: ${indicators.ichimokuSignal}
- Strategy Depth Scores (0-100): SMC=${sd.smc}, ICT=${sd.ict}, Quantum-Liquidity=${sd.quantum}, Liquidity-Depth=${sd.liquidity}, CRT=${sd.crt}
- Trend Strength: ${indicators.trendStrength}%, R:R: ${indicators.riskReward}`;

  const newsBlock = recentNews.length
    ? `\nRecent News Headlines:\n${recentNews.slice(0, 5).map((h, i) => `${i + 1}. ${h}`).join('\n')}`
    : '';
  const socialBlock = xSentiment ? `\nX/Social Sentiment: ${xSentiment}` : '';

  // Token-minimal. The methodology block that used to live here restated the
  // entire SMC/ICT v4 scoring rubric — ~1,150 input tokens on every call, teaching
  // the model a weighting scheme it cannot apply, because it receives the already
  // computed summary values below and no candles. Per CLAUDE.md the model weighs
  // pre-computed values; it does not recompute them. Output lengths are capped for
  // the same reason: the long-form field text was the dominant cost of this call.
  const prompt = `Institutional crypto analyst. Values below are already computed — interpret them, do not recompute.
${coin}/USDT ${timeframe} @ $${marketPrice}${techBlock}${newsBlock}${socialBlock}

Rules: SL beyond structure invalidation, not a fixed %. Min R:R 1:2. All levels within +/-12% of $${marketPrice}.
Every prose field: max 2 sentences, specific to the numbers above, no boilerplate.

JSON only, no markdown:
{"direction":"LONG|SHORT|NEUTRAL","confidence":<0-100>,"entry":<num>,"stopLoss":<num>,"takeProfit1":<num>,"takeProfit2":<num>,"takeProfit3":<num>,"riskReward":"1:X",
"smcAnalysis":"<structure grade, BOS/CHoCH, OB range, premium/discount>",
"ictAnalysis":"<FVG, OTE zone, killzone timing>",
"quantumLiquidityAnalysis":"<BSL/SSL levels, likely sweep target>",
"technicalAnalysis":"<RSI, MACD, EMA, volume, volatility>",
"multiTimeframeAnalysis":"<HTF bias vs ${timeframe} trigger>",
"newsImpact":"<catalyst and event risk>",
"socialSentiment":"<retail read, contrarian or confirmatory>",
"tradeRationale":"<why this direction, this entry, now>",
"confluenceScore":<0-100>,
"confluenceFactors":["<factor: aligned|conflicting>","<up to 6>"],
"analysisLogs":["SMC: <1 line>","ICT: <1 line>","LIQUIDITY: <1 line>","TECHNICALS: <1 line>","MTF: <1 line>","CATALYSTS: <1 line>","LEVELS: entry/SL/TP1-3/RR","CONFLUENCE: score + reason"],
"riskAssessment":"<LOW|MEDIUM|HIGH + key risk + sizing note>",
"keyLevels":{"support":[<num>,<num>,<num>],"resistance":[<num>,<num>,<num>]},
"invalidation":"<exact price/event that kills the setup>",
"summary":"<2 sentence actionable verdict>",
"warnings":["<warning>","<warning>"]}`;

  try {
    const { text } = await callMultiAI([{ role: 'user', content: prompt }], {
      // Display-only narrative around numbers the deterministic engine already
      // produced, so it is 'cosmetic': the first thing dropped when the daily
      // budget tightens, and never at the expense of the AI veto on a live signal.
      maxTokens: 1100,
      tier: 'cosmetic',
      cacheTtlMs: 15 * 60 * 1000,
      label: 'deep-coin-analysis',
    });
    const jsonMatch = extractJson(text);
    if (!jsonMatch) throw new Error('Could not parse AI response');
    const p = JSON.parse(jsonMatch);
    const dir = ['LONG', 'SHORT', 'NEUTRAL'].includes(p.direction) ? p.direction : 'NEUTRAL';
    return {
      coin,
      timeframe,
      direction: dir,
      confidence: Math.min(95, Math.max(10, Number(p.confidence) || 60)),
      entry: Number(p.entry) || marketPrice,
      stopLoss: Number(p.stopLoss) || marketPrice * (dir === 'LONG' ? 0.97 : 1.03),
      takeProfit1: Number(p.takeProfit1) || marketPrice * (dir === 'LONG' ? 1.02 : 0.98),
      takeProfit2: Number(p.takeProfit2) || marketPrice * (dir === 'LONG' ? 1.05 : 0.95),
      takeProfit3: Number(p.takeProfit3) || marketPrice * (dir === 'LONG' ? 1.08 : 0.92),
      riskReward: p.riskReward || '1:2',
      smcAnalysis: p.smcAnalysis || 'SMC analysis unavailable.',
      ictAnalysis: p.ictAnalysis || 'ICT analysis unavailable.',
      quantumLiquidityAnalysis: p.quantumLiquidityAnalysis || 'Quantum liquidity analysis unavailable.',
      newsImpact: p.newsImpact || 'No significant news impact identified.',
      socialSentiment: p.socialSentiment || 'Neutral social sentiment.',
      technicalAnalysis: p.technicalAnalysis || 'Technical analysis unavailable.',
      multiTimeframeAnalysis: p.multiTimeframeAnalysis || 'Multi-timeframe analysis unavailable.',
      tradeRationale: p.tradeRationale || 'Trade rationale unavailable.',
      confluenceScore: Math.min(100, Math.max(0, Number(p.confluenceScore) || 0)),
      confluenceFactors: Array.isArray(p.confluenceFactors) ? p.confluenceFactors.slice(0, 10) : [],
      analysisLogs: Array.isArray(p.analysisLogs) ? p.analysisLogs.slice(0, 10) : [],
      riskAssessment: p.riskAssessment || 'Risk assessment unavailable.',
      keyLevels: {
        support: Array.isArray(p.keyLevels?.support) ? p.keyLevels.support.map(Number).filter(Boolean) : [],
        resistance: Array.isArray(p.keyLevels?.resistance) ? p.keyLevels.resistance.map(Number).filter(Boolean) : [],
      },
      invalidation: p.invalidation || 'Setup invalidated on structure break.',
      summary: p.summary || 'Analysis complete.',
      warnings: Array.isArray(p.warnings) ? p.warnings.slice(0, 4) : [],
      timestamp: new Date().toISOString(),
    };
  } catch (error: any) {
    if (error.message?.includes('No AI providers configured')) {
      aiProviderDisabledUntil = Date.now() + AI_PROVIDER_COOLDOWN_MS;
    }
    throw new Error('Deep coin analysis failed: ' + (error?.message || error));
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
    const marketContext = marketData?.length
      ? marketData.map(d => `${d.symbol}: Current Price $${d.price}, 24h Change ${d.change > 0 ? '+' : ''}${d.change.toFixed(2)}%, 24h Volume $${(d.volume / 1e6).toFixed(0)}M`).join('\n')
      : coins.map(c => `${c}: price data unavailable`).join('\n');

    const system = 'You are a professional crypto market analyst providing real-time analysis. Return ONLY valid JSON. No markdown, no code blocks. CRITICAL: Use the EXACT current prices provided below in your analysis. Key levels must be near the actual current price - not generic round numbers. For example if BTC is at $67,800, key levels should be around $66,500-$69,000 range, NOT $60,000.';

    const userMsg = `Analyze these live crypto markets using the REAL prices below. Your key levels and analysis MUST reference prices close to the actual current values.

LIVE MARKET DATA:
${marketContext}

Return this exact JSON structure:
{
  "overview": "2-3 sentence market overview referencing actual prices and % changes from the data above",
  "coins": [
    {"coin": "BTC", "sentiment": "BULLISH or BEARISH or NEUTRAL", "shortAnalysis": "1 sentence using actual price data", "keyLevel": "specific realistic price level near current price", "action": "BUY or SELL or HOLD or WATCH", "xSentiment":"short social sentiment read", "fomoLevel":"LOW or MEDIUM or HIGH", "liquidityView":"where liquidity is clustered", "psychologicalLevels":"major round numbers", "newsBias":"bullish/bearish/neutral headline bias"}
  ],
  "upcomingTrades": [
    {"coin": "BTC", "direction": "LONG or SHORT", "reason": "1 sentence with specific price targets near current levels", "confidence": 75, "timeframe": "1h or 4h or 15m"}
  ],
  "marketMood": "1-3 word mood description"
}

RULES:
- Include ALL coins: ${coins.join(', ')}
- Sentiment MUST match the 24h change: positive change (>1%) = BULLISH, negative (<-1%) = BEARISH, small change = NEUTRAL
- Action MUST align with sentiment: BULLISH = BUY, BEARISH = SELL, NEUTRAL = HOLD or WATCH
- Key levels MUST be within 5% of the current price shown above
- Generate 3-5 upcoming trade ideas using only BULLISH or BEARISH coins (do NOT include NEUTRAL coins in upcomingTrades)
- CRITICAL: upcomingTrades direction MUST match the coin sentiment — BULLISH coins get LONG, BEARISH coins get SHORT. Never assign LONG to a BEARISH coin or SHORT to a BULLISH coin
- Confidence should reflect how strong the setup is (60-95 range)
- Be specific about prices, not generic`;

    const messages: AIMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: userMsg },
    ];

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
