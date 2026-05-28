import { callMultiAI, type AIMessage } from './ai-providers';

const AI_PROVIDER_COOLDOWN_MS = 5 * 60 * 1000;
let aiProviderDisabledUntil = 0;

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

  try {
    const rr = (Math.abs(signalData.tp - signalData.entry) / Math.abs(signalData.entry - signalData.sl)).toFixed(2);
    const ctx = signalData.agentContext;

    const agentBlock = ctx ? `
Multi-Agent Intelligence (already gathered — use this to sharpen your assessment):
${ctx.coinglassBias    ? `- Derivatives (Coinglass):   Bias=${ctx.coinglassBias}, Signal="${ctx.coinglassSignal}", Funding=${ctx.fundingRate?.toFixed(5)}%, Longs=${ctx.longPercent?.toFixed(0)}%` : ''}
${ctx.newsSentiment    ? `- News (Perplexity):         Sentiment=${ctx.newsSentiment}, RiskLevel=${ctx.newsRiskLevel}, Headline="${ctx.newsHeadline}"` : ''}
${ctx.newsImpact       ? `- News (NewsAPI):            Overall=${ctx.newsImpact}${ctx.newsTopHeadlines?.length ? `, Top headlines: ${ctx.newsTopHeadlines.slice(0,3).map((h,i) => `[${i+1}] ${h}`).join(' | ')}` : ''}` : ''}
${ctx.xSentiment       ? `- X/Social Sentiment:        ${ctx.xSentiment}` : ''}
${ctx.whaleBias        ? `- Whale Flow (Arkham):       Bias=${ctx.whaleBias}, Signal="${ctx.whaleSignal}"` : ''}
${ctx.smcStructure     ? `- SMC Market Structure:      ${ctx.smcStructure} (RSI Div=${ctx.rsiDivergence}, Phase=${ctx.marketPhase})` : ''}
${ctx.quantumLiquidityScore !== undefined ? `- Strategy Scores (0-100):   SMC=${ctx.smcScore}, ICT=${ctx.ictScore}, Quantum-Liquidity=${ctx.quantumLiquidityScore}, Liquidity-Depth=${ctx.liquidityDepthScore}, CRT=${ctx.crtScore}` : ''}
${ctx.liquidityClusters !== undefined ? `- Liquidity Clusters:        ${ctx.liquidityClusters} active clusters, Whale=${ctx.whaleActivity}, Volume=${ctx.volumeProfile}/${ctx.volumeForecast}` : ''}
${ctx.ensembleDirection ? `- Ensemble Model:            Direction=${ctx.ensembleDirection}, Confidence=${ctx.ensembleConfidence}%, Ichimoku=${ctx.ichimokuSignal}` : ''}
` : '';

    const prompt = `You are a senior crypto trading analyst AI with access to multi-source intelligence. Analyze this trading signal and provide a calibrated assessment.

Signal Data:
- Coin: ${signalData.coin}/USDT
- Direction: ${signalData.type}
- Strategy: ${signalData.strategy}
- Entry: $${signalData.entry.toFixed(4)} | TP: $${signalData.tp.toFixed(4)} | SL: $${signalData.sl.toFixed(4)}
- Market Price: $${signalData.marketPrice.toFixed(4)}
- Timeframe: ${signalData.timeframe}
- Base Confidence: ${signalData.confidence}%
- Risk/Reward: 1:${rr}
${agentBlock}
Instructions — apply world-best-practice methodology:
1. Evaluate the technical merit of Entry/TP/SL placement against SMC/ICT/Quantum-Liquidity concepts (order blocks, FVG, BOS/CHoCH, liquidity sweeps, equilibrium).
2. R:R quality is critical: R:R < 1.5 = deduct 20 pts; 1.5-2.0 = deduct 10 pts; 2.0-2.5 = neutral; ≥2.5 = add 5 pts; ≥3.0 = add 10 pts.
3. Multi-Agent Intelligence weighting (when provided):
   - SMC structure alignment with signal direction: ±10 pts
   - Quantum-Liquidity score ≥70 in signal direction: +8 pts; conflicting: -8 pts
   - News sentiment / X-social sentiment aligned: +5 pts; conflicting: -8 pts
   - Whale flow + funding rate alignment: +5 pts; opposing: -5 pts
   - Ensemble model direction conflict: -10 pts
4. Higher-timeframe signals (1D, 1W) deserve more weight — only confirm if SMC structure + liquidity context truly support the bias.
5. Never exceed 95% or go below 10% for adjustedConfidence.
6. Be concise and precise — reference the specific agent data points you used.

Respond in JSON only:
{
  "verdict": "STRONG_BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG_SELL",
  "adjustedConfidence": <number 0-100>,
  "reasoning": "<2-3 sentence analysis referencing the multi-agent data if present>",
  "riskLevel": "LOW" | "MEDIUM" | "HIGH",
  "keyLevels": { "support": <number>, "resistance": <number> },
  "marketSentiment": "<brief 1-sentence sentiment>"
}`;

    const messages: AIMessage[] = [{ role: 'user', content: prompt }];
    const { text } = await callMultiAI(messages, 400);

    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Could not parse AI response');

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      verdict: parsed.verdict || 'NEUTRAL',
      adjustedConfidence: Math.min(100, Math.max(0, parsed.adjustedConfidence || signalData.confidence)),
      reasoning: parsed.reasoning || 'Analysis unavailable',
      riskLevel: parsed.riskLevel || 'MEDIUM',
      keyLevels: parsed.keyLevels || { support: signalData.sl, resistance: signalData.tp },
      marketSentiment: parsed.marketSentiment || 'Neutral',
    };
  } catch (error: any) {
    if (error.message?.includes('No AI providers configured')) {
      aiProviderDisabledUntil = Date.now() + AI_PROVIDER_COOLDOWN_MS;
    }
    console.error('AI analysis error:', error?.message || error);
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

  const prompt = `You are a world-class crypto trading analyst combining SMC (Smart Money Concepts), ICT (Inner Circle Trader), Quantum Liquidity theory, on-chain whale flow, news catalysts and X/social sentiment. Produce an institutional-grade trade plan for ${coin}/USDT on the ${timeframe} timeframe.
${techBlock}${newsBlock}${socialBlock}

Apply world-best-practice methodology:
1. Identify the dominant SMC narrative (order blocks, BOS/CHoCH, equilibrium).
2. Map the ICT premium/discount zones and FVG (fair value gaps) relative to current price.
3. Identify Quantum Liquidity pools and where smart-money is likely to sweep.
4. Weight news + X-sentiment as catalysts that can confirm or invalidate the technical bias.
5. Construct an entry that gives institutional R:R (target 1:2 minimum, ideally 1:3+).
6. SL must sit beyond the most recent liquidity/structure invalidation — NOT a fixed %.
7. Provide three TP ladders (TP1 = next liquidity, TP2 = structural target, TP3 = extension target).
8. All price levels must be realistic and within ±10% of current price ($${marketPrice}) for ${timeframe}.

Respond in JSON only, no markdown:
{
  "direction": "LONG" | "SHORT" | "NEUTRAL",
  "confidence": <0-100>,
  "entry": <number>,
  "stopLoss": <number>,
  "takeProfit1": <number>,
  "takeProfit2": <number>,
  "takeProfit3": <number>,
  "riskReward": "1:X",
  "smcAnalysis": "<2-3 sentences on order blocks, BOS/CHoCH and structure>",
  "ictAnalysis": "<2-3 sentences on premium/discount, FVG, killzones>",
  "quantumLiquidityAnalysis": "<2-3 sentences on liquidity pools, sweeps and whale flow>",
  "newsImpact": "<1-2 sentences on how news affects this trade>",
  "socialSentiment": "<1 sentence on X/social sentiment alignment>",
  "keyLevels": { "support": [<num>, <num>], "resistance": [<num>, <num>] },
  "invalidation": "<1 sentence on what invalidates the setup>",
  "summary": "<2 sentence final verdict combining everything>",
  "warnings": ["<warning 1>", "<warning 2>"]
}`;

  try {
    const { text } = await callMultiAI([{ role: 'user', content: prompt }], 1400);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Could not parse AI response');
    const p = JSON.parse(jsonMatch[0]);
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
- Key levels MUST be within 5% of the current price shown above
- Generate 3-5 upcoming trade ideas with realistic entry/exit levels
- Confidence should reflect how strong the setup is (60-95 range)
- Be specific about prices, not generic`;

    const messages: AIMessage[] = [
      { role: 'system', content: system },
      { role: 'user', content: userMsg },
    ];

    const { text } = await callMultiAI(messages, 8192);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return fallbackResult;

    const parsed = JSON.parse(jsonMatch[0]);
    return {
      overview: parsed.overview || fallbackResult.overview,
      coins: (parsed.coins || []).map((c: any) => ({
        coin: c.coin || 'BTC',
        sentiment: (['BULLISH', 'BEARISH', 'NEUTRAL'].includes(c.sentiment) ? c.sentiment : 'NEUTRAL') as 'BULLISH' | 'BEARISH' | 'NEUTRAL',
        shortAnalysis: c.shortAnalysis || 'Analysis pending',
        keyLevel: c.keyLevel || 'Key levels being calculated',
        action: (['BUY', 'SELL', 'HOLD', 'WATCH'].includes(c.action) ? c.action : 'WATCH') as 'BUY' | 'SELL' | 'HOLD' | 'WATCH',
        xSentiment: c.xSentiment || 'Neutral social sentiment',
        fomoLevel: (['LOW', 'MEDIUM', 'HIGH'].includes(c.fomoLevel) ? c.fomoLevel : 'MEDIUM') as 'LOW' | 'MEDIUM' | 'HIGH',
        liquidityView: c.liquidityView || 'Liquidity balanced near VWAP',
        psychologicalLevels: c.psychologicalLevels || 'Round numbers and weekly pivots',
        newsBias: c.newsBias || 'No strong catalyst',
      })),
      upcomingTrades: (parsed.upcomingTrades || []).map((t: any) => ({
        coin: t.coin || 'BTC',
        direction: t.direction === 'SHORT' ? 'SHORT' as const : 'LONG' as const,
        reason: t.reason || 'Technical setup forming',
        confidence: Math.min(100, Math.max(0, t.confidence || 70)),
        timeframe: t.timeframe || '1h',
      })),
      marketMood: parsed.marketMood || 'Neutral',
      timestamp: new Date().toISOString(),
    };
  } catch (error: any) {
    if (error.message?.includes('No AI providers configured')) {
      aiProviderDisabledUntil = Date.now() + AI_PROVIDER_COOLDOWN_MS;
    }
    console.error('Market insight error:', error?.message || error);
    return fallbackResult;
  }
}
