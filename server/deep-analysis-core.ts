/**
 * Deep Coin Analysis — the deterministic half.
 *
 * Two jobs, both pure (no storage, no network, no AI), so both are unit-testable
 * without a DATABASE_URL — the same split as learning-core/learning-engine and
 * ai-providers-core/ai-providers.
 *
 *   1. `buildDeepAnalysisPrompt` — the smallest prompt that still carries every
 *      value the model needs. Fields that were never computed are omitted rather
 *      than sent as "undefined": a dozen `undefined` lines cost real input tokens
 *      and actively mislead the model into hedging about data it was never given.
 *
 *   2. `deterministicDeepAnalysis` — a complete trade plan derived from the
 *      indicators alone. This is what the endpoint returns when the AI layer is
 *      unavailable, whether the budget is spent, a key is missing, or every
 *      provider is down.
 *
 * Point 2 is the important one. The indicators are computed deterministically
 * before any AI call is made (CLAUDE.md: the model weighs pre-computed values, it
 * never produces them), so an unavailable model costs the user the *narration*,
 * not the analysis. Returning a 500 in that situation threw away a complete,
 * already-computed answer because the optional commentary on top of it could not
 * be paid for.
 */

// ─── Types ────────────────────────────────────────────────────────────────────

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
  /** Where the narrative came from. The levels are deterministic either way. */
  source: 'ai' | 'deterministic';
  /** True when the AI layer could not be reached and this is the fallback. */
  degraded: boolean;
  /** Human-readable reason for a degraded result — shown in the UI, not hidden. */
  notice?: string;
}

export interface DeepAnalysisInput {
  coin: string;
  timeframe: string;
  marketPrice: number;
  indicators?: any;
  recentNews?: string[];
  xSentiment?: string;
}

// ─── Prompt construction ──────────────────────────────────────────────────────

/** `k=v`, but only when v was actually computed. */
function kv(key: string, value: unknown): string | null {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value === 'number' && !Number.isFinite(value)) return null;
  return `${key}=${value}`;
}

function joinFacts(facts: Array<string | null>): string {
  return facts.filter((f): f is string => f !== null).join(' ');
}

/**
 * Build the deep-analysis prompt.
 *
 * Every value here was computed by the deterministic engine, so the prompt
 * carries values and nothing else — no methodology, no scoring rubric, no
 * worked examples. Restating a rubric the model cannot apply (it receives
 * summary scores, never candles) was ~1,150 input tokens on every call and
 * changed no output.
 *
 * Output length is capped per field for the same reason: the long-form prose was
 * the dominant cost of this call, and a four-sentence paragraph about RSI is not
 * four times as useful as one sentence.
 */
export function buildDeepAnalysisPrompt(input: DeepAnalysisInput): string {
  const { coin, timeframe, marketPrice, indicators = {}, recentNews = [], xSentiment } = input;
  const sd = indicators.strategyDepth || {};
  const px = fmtPrice(marketPrice);

  const tech = joinFacts([
    kv('rsi', indicators.rsi),
    kv('macd', indicators.macdSignal),
    kv('ema', indicators.emaTrend),
    kv('struct', indicators.marketStructure),
    kv('div', indicators.rsiDivergence),
    kv('phase', indicators.marketPhase),
    kv('vol', indicators.volumeProfile),
    kv('volFcst', indicators.volumeForecast),
    kv('whale', indicators.whaleActivity),
    kv('liqClusters', indicators.liquidityClusters),
    kv('ichimoku', indicators.ichimokuSignal),
    kv('trend', indicators.trendStrength),
    kv('rr', indicators.riskReward),
    kv('atr', indicators.atr ? fmtPrice(indicators.atr) : undefined),
  ]);

  const scores = joinFacts([
    kv('SMC', sd.smc), kv('ICT', sd.ict), kv('QL', sd.quantum),
    kv('LD', sd.liquidity), kv('CRT', sd.crt),
    kv('v4', indicators.smcV4Score !== undefined ? `${indicators.smcV4Score}/10 ${indicators.smcV4Grade ?? ''}`.trim() : undefined),
    kv('zone', indicators.premiumDiscount),
    kv('OTE', indicators.inOTEZone === undefined ? undefined : indicators.inOTEZone ? 'Y' : 'N'),
    kv('PO3', indicators.powerOf3Phase),
    kv('ens', indicators.ensembleDirection ? `${indicators.ensembleDirection}@${indicators.ensembleConfidence ?? '?'}%` : undefined),
  ]);

  // Three headlines, truncated. A news feed is unbounded and each headline is
  // ~15 input tokens; five full-length ones were a fifth of the whole prompt.
  const news = recentNews.length
    ? `\nNews: ${recentNews.slice(0, 3).map(h => h.slice(0, 90)).join(' / ')}`
    : '';
  const social = xSentiment ? `\nSocial: ${String(xSentiment).slice(0, 120)}` : '';

  return `Crypto analyst. Values below are already computed — interpret, do not recompute.
${coin}/USDT ${timeframe} @ $${px}
TA: ${tech}
Scores: ${scores}${news}${social}

Rules: SL beyond structure invalidation. Min R:R 1:2. Levels within +/-12% of $${px}.
Each prose field: ONE sentence citing the numbers above. No boilerplate, no hedging.

JSON only:
{"direction":"LONG|SHORT|NEUTRAL","confidence":<0-100>,"entry":<n>,"stopLoss":<n>,"takeProfit1":<n>,"takeProfit2":<n>,"takeProfit3":<n>,"riskReward":"1:X","smcAnalysis":"","ictAnalysis":"","quantumLiquidityAnalysis":"","technicalAnalysis":"","multiTimeframeAnalysis":"","newsImpact":"","socialSentiment":"","tradeRationale":"","confluenceScore":<0-100>,"confluenceFactors":["<=5, each '<factor>: aligned|conflicting'"],"analysisLogs":["<=6, 'AREA: one line'"],"riskAssessment":"LOW|MEDIUM|HIGH + key risk","keyLevels":{"support":[<n>,<n>],"resistance":[<n>,<n>]},"invalidation":"","summary":"","warnings":["<=2"]}`;
}

// ─── Deterministic analysis ───────────────────────────────────────────────────

/**
 * Risk unit as a fraction of price when no ATR is available.
 *
 * A stop is a volatility question, so ATR is used whenever the client sent it.
 * These are the fallback: a 15m stop and a weekly stop cannot be the same
 * percentage, and a single hard-coded "3%" is wrong on both.
 */
const TIMEFRAME_RISK_PCT: Record<string, number> = {
  '1m': 0.003, '3m': 0.004, '5m': 0.005, '15m': 0.007, '30m': 0.009,
  '1h': 0.012, '2h': 0.015, '4h': 0.020, '6h': 0.024, '12h': 0.028,
  '1d': 0.035, '3d': 0.045, '1w': 0.060,
};
const DEFAULT_RISK_PCT = 0.02;

/** Levels are never placed further than this from spot — a stop 30% away is not a stop. */
const MAX_LEVEL_DEVIATION = 0.12;

/**
 * Confidence ceiling for a deterministic result.
 *
 * The AI veto can only ever cut confidence (CLAUDE.md), so a plan that was never
 * reviewed has not passed the check a reviewed one passed. Capping it below the
 * AI-path ceiling keeps that difference visible in the number itself instead of
 * presenting an unreviewed plan as though it had cleared the same bar.
 */
const DETERMINISTIC_CONFIDENCE_CAP = 78;

interface Vote { factor: string; weight: number; aligned: 'LONG' | 'SHORT' }

/**
 * Weighted directional vote across every computed indicator.
 *
 * Weights follow the same ordering the live engine uses: the multi-model
 * ensemble and market structure dominate, single oscillators contribute least.
 * Overbought/oversold RSI is deliberately counter-trend — at the extremes it is
 * a mean-reversion signal, not a continuation one.
 */
export function directionalVotes(indicators: any = {}): Vote[] {
  const votes: Vote[] = [];
  const push = (factor: string, weight: number, aligned: 'LONG' | 'SHORT') => {
    if (weight > 0) votes.push({ factor, weight, aligned });
  };

  const ens = String(indicators.ensembleDirection ?? '').toUpperCase();
  if (ens === 'LONG' || ens === 'SHORT') {
    const conf = Number(indicators.ensembleConfidence);
    const scale = Number.isFinite(conf) ? Math.max(0.3, Math.min(1, conf / 100)) : 0.6;
    push(`Ensemble ${ens}${Number.isFinite(conf) ? ` @${conf}%` : ''}`, 3 * scale, ens as 'LONG' | 'SHORT');
  }

  const struct = String(indicators.marketStructure ?? '').toUpperCase();
  if (struct === 'BULLISH') push('Market structure bullish', 2, 'LONG');
  if (struct === 'BEARISH') push('Market structure bearish', 2, 'SHORT');

  const ema = String(indicators.emaTrend ?? '').toUpperCase();
  if (ema === 'ABOVE') push('Price above EMA21', 1.5, 'LONG');
  if (ema === 'BELOW') push('Price below EMA21', 1.5, 'SHORT');

  const macd = String(indicators.macdSignal ?? '').toUpperCase();
  if (macd === 'BULLISH') push('MACD histogram positive', 1, 'LONG');
  if (macd === 'BEARISH') push('MACD histogram negative', 1, 'SHORT');

  const ichi = String(indicators.ichimokuSignal ?? '').toUpperCase();
  if (ichi === 'BULLISH') push('Ichimoku bullish', 1, 'LONG');
  if (ichi === 'BEARISH') push('Ichimoku bearish', 1, 'SHORT');

  const div = String(indicators.rsiDivergence ?? '').toUpperCase();
  if (div === 'BULLISH') push('Bullish RSI divergence', 1.5, 'LONG');
  if (div === 'BEARISH') push('Bearish RSI divergence', 1.5, 'SHORT');

  const po3 = String(indicators.powerOf3Direction ?? '').toUpperCase();
  if (po3 === 'LONG' || po3 === 'BULLISH') push('Power-of-3 accumulation', 1, 'LONG');
  if (po3 === 'SHORT' || po3 === 'BEARISH') push('Power-of-3 distribution', 1, 'SHORT');

  const whale = String(indicators.whaleActivity ?? '').toUpperCase();
  if (whale === 'BUY' || whale === 'LONG' || whale === 'BULLISH') push('Whale accumulation', 1, 'LONG');
  if (whale === 'SELL' || whale === 'SHORT' || whale === 'BEARISH') push('Whale distribution', 1, 'SHORT');

  // Discount/premium is a location read: buying a discount and selling a premium.
  const zone = String(indicators.premiumDiscount ?? '').toUpperCase();
  if (zone === 'DISCOUNT') push('Price in discount zone', 1, 'LONG');
  if (zone === 'PREMIUM') push('Price in premium zone', 1, 'SHORT');

  const rsi = Number(indicators.rsi);
  if (Number.isFinite(rsi)) {
    if (rsi >= 70) push(`RSI ${Math.round(rsi)} overbought`, 0.75, 'SHORT');
    else if (rsi <= 30) push(`RSI ${Math.round(rsi)} oversold`, 0.75, 'LONG');
  }

  return votes;
}

function fmtPrice(n: number): string {
  if (!Number.isFinite(n)) return '0';
  if (Math.abs(n) >= 1000) return n.toFixed(2);
  if (Math.abs(n) >= 1) return n.toFixed(4);
  return n.toFixed(6);
}

function round(n: number, price: number): number {
  const dp = price >= 1000 ? 2 : price >= 1 ? 4 : 8;
  return Number(n.toFixed(dp));
}

/** Keep a level inside the band around spot, so a bad input cannot produce a silly target. */
function clampToBand(level: number, price: number): number {
  const lo = price * (1 - MAX_LEVEL_DEVIATION);
  const hi = price * (1 + MAX_LEVEL_DEVIATION);
  return Math.min(hi, Math.max(lo, level));
}

/** The per-trade risk distance in price terms. */
export function riskUnit(input: DeepAnalysisInput): number {
  const { marketPrice, timeframe, indicators = {} } = input;

  // The client already computed an adaptive stop distance; prefer it.
  const dynamic = Number(indicators.dynamicSL);
  if (Number.isFinite(dynamic) && dynamic > 0 && dynamic < marketPrice * MAX_LEVEL_DEVIATION) return dynamic;

  // Otherwise size the stop off ATR, which is what volatility actually is.
  const atr = Number(indicators.atr);
  if (Number.isFinite(atr) && atr > 0) {
    const fromAtr = atr * 1.5;
    if (fromAtr < marketPrice * MAX_LEVEL_DEVIATION) return fromAtr;
  }

  return marketPrice * (TIMEFRAME_RISK_PCT[timeframe] ?? DEFAULT_RISK_PCT);
}

/**
 * A complete trade plan from the indicators alone — no AI, no network, no cost.
 *
 * `notice` explains why the AI narrative is missing. It is carried through to the
 * UI rather than swallowed: a user looking at a degraded result is entitled to
 * know it is degraded and why, which is the whole reason this returns a result
 * instead of an error.
 */
export function deterministicDeepAnalysis(
  input: DeepAnalysisInput,
  notice = 'AI narration unavailable — this plan was computed from the deterministic engine.',
): DeepCoinAnalysis {
  const { coin, timeframe, marketPrice, indicators = {}, recentNews = [], xSentiment } = input;
  const sd = indicators.strategyDepth || {};

  const votes = directionalVotes(indicators);
  const longScore = votes.filter(v => v.aligned === 'LONG').reduce((s, v) => s + v.weight, 0);
  const shortScore = votes.filter(v => v.aligned === 'SHORT').reduce((s, v) => s + v.weight, 0);
  const total = longScore + shortScore;
  const net = longScore - shortScore;

  // Below this the indicators disagree enough that there is no directional read
  // worth trading. Saying NEUTRAL is the honest output, not a coin flip.
  const NEUTRAL_BAND = 1.5;
  const direction: DeepCoinAnalysis['direction'] =
    net > NEUTRAL_BAND ? 'LONG' : net < -NEUTRAL_BAND ? 'SHORT' : 'NEUTRAL';

  // Agreement among the indicators that voted, not raw count: 8 weak signals all
  // pointing one way is a stronger read than 2 strong ones that contradict.
  const agreement = total > 0 ? Math.abs(net) / total : 0;
  const v4 = Number(indicators.smcV4Score);
  const v4Bonus = Number.isFinite(v4) ? Math.min(10, v4) : 0;
  const confluenceScore = Math.round(Math.min(100, agreement * 70 + v4Bonus * 2 + Math.min(10, votes.length)));

  const rawConfidence = 35 + agreement * 45 + v4Bonus;
  const confidence = direction === 'NEUTRAL'
    ? Math.min(45, Math.round(rawConfidence))
    : Math.max(10, Math.min(DETERMINISTIC_CONFIDENCE_CAP, Math.round(rawConfidence)));

  const R = riskUnit(input);
  const entry = marketPrice;
  const sign = direction === 'SHORT' ? -1 : 1;

  // 1.5R / 2.5R / 4R keeps the primary target at the 1:2 floor CLAUDE.md sets,
  // with runners beyond it.
  const stopLoss = round(clampToBand(entry - sign * R, marketPrice), marketPrice);
  const takeProfit1 = round(clampToBand(entry + sign * R * 1.5, marketPrice), marketPrice);
  const takeProfit2 = round(clampToBand(entry + sign * R * 2.5, marketPrice), marketPrice);
  const takeProfit3 = round(clampToBand(entry + sign * R * 4.0, marketPrice), marketPrice);

  const rrValue = Math.abs(takeProfit2 - entry) / Math.max(1e-12, Math.abs(entry - stopLoss));
  const riskReward = `1:${rrValue.toFixed(1)}`;

  const supports = [entry - R, entry - R * 2, entry - R * 3.5]
    .map(l => round(clampToBand(l, marketPrice), marketPrice));
  const resistances = [entry + R, entry + R * 2, entry + R * 3.5]
    .map(l => round(clampToBand(l, marketPrice), marketPrice));

  const aligned = votes.filter(v => v.aligned === direction);
  const conflicting = votes.filter(v => direction !== 'NEUTRAL' && v.aligned !== direction);
  const confluenceFactors = [
    ...aligned.slice(0, 5).map(v => `${v.factor}: aligned`),
    ...conflicting.slice(0, 3).map(v => `${v.factor}: conflicting`),
  ];

  const px = fmtPrice(marketPrice);
  const structure = indicators.marketStructure ?? 'unclassified';
  const zone = indicators.premiumDiscount ?? 'unknown';
  const phase = indicators.marketPhase ?? 'unclassified';

  const smcAnalysis =
    `Structure is ${structure} with SMC depth ${sd.smc ?? 'n/a'}/100 and SMC/ICT v4 at ` +
    `${indicators.smcV4Score ?? 'n/a'}/10${indicators.smcV4Grade ? ` (${indicators.smcV4Grade})` : ''}; ` +
    `price sits in the ${zone} zone with ${indicators.breakerBlocks ?? 0} breaker block(s) mapped.`;

  const ictAnalysis =
    `ICT depth ${sd.ict ?? 'n/a'}/100, OTE ${indicators.inOTEZone ? 'engaged' : 'not engaged'}, ` +
    `Power-of-3 phase ${indicators.powerOf3Phase ?? 'unclassified'}` +
    `${indicators.powerOf3Direction ? ` leaning ${indicators.powerOf3Direction}` : ''}.`;

  const quantumLiquidityAnalysis =
    `Quantum-liquidity ${sd.quantum ?? 'n/a'}/100 and liquidity depth ${sd.liquidity ?? 'n/a'}/100 across ` +
    `${indicators.liquidityClusters ?? 0} mapped cluster(s); ` +
    `${direction === 'SHORT' ? 'sell-side' : 'buy-side'} liquidity near $${fmtPrice(direction === 'SHORT' ? supports[1] : resistances[1])} is the nearer draw.`;

  const technicalAnalysis =
    `RSI ${indicators.rsi ?? 'n/a'}, MACD ${indicators.macdSignal ?? 'n/a'}, price ${indicators.emaTrend ?? 'n/a'} EMA21, ` +
    `Ichimoku ${indicators.ichimokuSignal ?? 'n/a'}, volume ${indicators.volumeProfile ?? 'n/a'} ` +
    `(forecast ${indicators.volumeForecast ?? 'n/a'}), trend strength ${indicators.trendStrength ?? 'n/a'}%.`;

  const multiTimeframeAnalysis =
    `Single-timeframe read on ${timeframe}: market phase ${phase} with the ensemble at ` +
    `${indicators.ensembleDirection ?? 'no call'}${indicators.ensembleConfidence !== undefined ? ` (${indicators.ensembleConfidence}%)` : ''}. ` +
    `Confirm against the higher timeframe before sizing up.`;

  const newsImpact = recentNews.length
    ? `${recentNews.length} recent headline(s) collected; leading item: "${String(recentNews[0]).slice(0, 110)}". Not scored without the AI layer — read manually before entry.`
    : 'No headlines were retrieved for this asset in the current window.';

  const socialSentiment = xSentiment
    ? `Feed reports: ${String(xSentiment).slice(0, 140)}.`
    : 'No social sentiment sample available for this window.';

  const tradeRationale = direction === 'NEUTRAL'
    ? `Indicators split ${longScore.toFixed(1)} long against ${shortScore.toFixed(1)} short — inside the neutral band, so there is no edge to take here.`
    : `${aligned.length} of ${votes.length} indicators point ${direction} (${(agreement * 100).toFixed(0)}% agreement), entry at spot $${px} with the stop past structure at $${fmtPrice(stopLoss)}.`;

  const riskAssessment = (() => {
    const level = agreement >= 0.7 && votes.length >= 5 ? 'LOW' : agreement >= 0.45 ? 'MEDIUM' : 'HIGH';
    return `${level} — ${conflicting.length} conflicting signal(s); risk ${((R / marketPrice) * 100).toFixed(2)}% of price per unit, size at the standard 0.75% account risk or below.`;
  })();

  const analysisLogs = [
    `SMC: structure ${structure}, depth ${sd.smc ?? 'n/a'}/100, zone ${zone}`,
    `ICT: depth ${sd.ict ?? 'n/a'}/100, OTE ${indicators.inOTEZone ? 'Y' : 'N'}, PO3 ${indicators.powerOf3Phase ?? 'n/a'}`,
    `LIQUIDITY: ${indicators.liquidityClusters ?? 0} clusters, QL ${sd.quantum ?? 'n/a'}/100, depth ${sd.liquidity ?? 'n/a'}/100`,
    `TECHNICALS: RSI ${indicators.rsi ?? 'n/a'}, MACD ${indicators.macdSignal ?? 'n/a'}, EMA ${indicators.emaTrend ?? 'n/a'}`,
    `VOTE: ${longScore.toFixed(1)} long vs ${shortScore.toFixed(1)} short → ${direction} @ ${confidence}%`,
    `LEVELS: entry ${fmtPrice(entry)} SL ${fmtPrice(stopLoss)} TP ${fmtPrice(takeProfit1)}/${fmtPrice(takeProfit2)}/${fmtPrice(takeProfit3)} RR ${riskReward}`,
    `CONFLUENCE: ${confluenceScore}/100 from ${votes.length} indicator votes`,
  ];

  const invalidation = direction === 'NEUTRAL'
    ? `No position, so nothing to invalidate. A decisive close beyond $${fmtPrice(resistances[0])} or $${fmtPrice(supports[0])} would create a directional read.`
    : `A ${direction === 'LONG' ? 'close below' : 'close above'} $${fmtPrice(stopLoss)} breaks the ${structure} structure this plan depends on.`;

  const summary = direction === 'NEUTRAL'
    ? `${coin}/USDT on ${timeframe} has no directional edge right now — indicators are split and the setup does not qualify.`
    : `${direction} ${coin}/USDT on ${timeframe} from $${px}, stop $${fmtPrice(stopLoss)}, targets $${fmtPrice(takeProfit1)}/$${fmtPrice(takeProfit2)}/$${fmtPrice(takeProfit3)} at ${riskReward}. Confidence ${confidence}% from ${(agreement * 100).toFixed(0)}% indicator agreement.`;

  const warnings = [
    notice,
    ...(conflicting.length >= 3 ? [`${conflicting.length} indicators disagree with the ${direction} read — treat position size accordingly.`] : []),
    ...(votes.length < 4 ? ['Fewer than four indicators produced a reading; the sample behind this direction is thin.'] : []),
  ].slice(0, 4);

  return {
    coin,
    timeframe,
    direction,
    confidence,
    entry: round(entry, marketPrice),
    stopLoss,
    takeProfit1,
    takeProfit2,
    takeProfit3,
    riskReward,
    smcAnalysis,
    ictAnalysis,
    quantumLiquidityAnalysis,
    newsImpact,
    socialSentiment,
    technicalAnalysis,
    multiTimeframeAnalysis,
    tradeRationale,
    confluenceScore,
    confluenceFactors,
    analysisLogs,
    riskAssessment,
    keyLevels: { support: supports, resistance: resistances },
    invalidation,
    summary,
    warnings,
    timestamp: new Date().toISOString(),
    source: 'deterministic',
    degraded: true,
    notice,
  };
}
