import { callMultiAI, extractJson, type AIMessage } from './ai-providers';

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
    const { text } = await callMultiAI(messages, 1200);

    const jsonMatch = extractJson(text);
    if (!jsonMatch) throw new Error('Could not parse AI response');

    const parsed = JSON.parse(jsonMatch);
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

  const prompt = `You are a world-class institutional crypto trading analyst combining SMC (Smart Money Concepts), ICT (Inner Circle Trader), Quantum Liquidity theory, technical indicators, multi-timeframe analysis, on-chain whale flow, news catalysts and X/social sentiment. Produce a COMPLETE institutional-grade trade analysis for ${coin}/USDT on the ${timeframe} timeframe.
${techBlock}${newsBlock}${socialBlock}

ANALYSIS METHODOLOGY — work through each step sequentially and log your reasoning:

STEP 1 — MARKET STRUCTURE (SMC):
- Identify BOS (Break of Structure) and CHoCH (Change of Character) points with price levels
- Map bullish/bearish order blocks — note the OB range (high/low) and freshness
- Determine equilibrium (50% of the last swing) and whether price is in premium or discount
- Grade market structure: STRONGLY BULLISH / BULLISH / RANGING / BEARISH / STRONGLY BEARISH

STEP 2 — ICT CONCEPTS:
- Identify Fair Value Gaps (FVG) — bullish gaps (price dropped through) and bearish gaps
- Map the optimal trade entry (OTE) zone using 61.8%-78.6% Fibonacci of last swing
- Identify kill zones (London 3-4am EST, NY 9-10am EST) relative to current time
- Note any NWOG (New Week Opening Gap) or NDOG (New Day Opening Gap)

STEP 3 — QUANTUM LIQUIDITY:
- Locate buy-side liquidity (BSL) above swing highs and sell-side liquidity (SSL) below swing lows
- Identify where equal highs/lows are acting as liquidity magnets
- Assess whale activity signals: abnormal volume, large wick rejections, absorption candles
- Determine the most probable liquidity sweep target before the main move

STEP 4 — TECHNICAL INDICATORS DEEP DIVE:
- RSI: current value, divergence, overbought/oversold context
- MACD: histogram direction, signal cross, momentum acceleration/deceleration
- EMA 9/21/50 stack: alignment, dynamic S/R, price position relative to EMAs
- Volume: above/below average, climactic volume, volume trend
- ATR: current volatility context, SL placement guidance
- Bollinger Bands: squeeze or expansion, price relative to bands

STEP 5 — MULTI-TIMEFRAME CONFLUENCE:
- Higher timeframe bias (1W / 1D): trending direction and key levels
- Intermediate timeframe (4h): structure and momentum
- Lower timeframe (${timeframe}): entry precision and trigger
- Note any HTF/LTF alignment or divergence

STEP 6 — NEWS & SENTIMENT CATALYSTS:
- Assess how current news headlines impact the directional bias
- X/social sentiment: retail sentiment (contrarian or confirmatory)
- Upcoming economic events or protocol-level catalysts

STEP 7 — TRADE CONSTRUCTION:
- Entry: precise level with reason (OB retest / FVG fill / BOS confirmation / liquidity sweep)
- Stop Loss: beyond structure invalidation (not fixed %) — specify the exact reason
- TP1: next liquidity target (near-term)
- TP2: structural / measured-move target
- TP3: extension / premium/discount zone target
- Minimum R:R must be 1:2; target 1:3+

STEP 8 — CONFLUENCE SCORE (0-100):
Count how many of these factors align with your direction:
SMC structure (+15), Order block quality (+12), FVG present (+10), Liquidity sweep completed (+12), RSI alignment (+8), MACD momentum (+8), EMA stack aligned (+10), Volume confirmation (+8), HTF bias aligned (+10), News/sentiment aligned (+7) — max 100

All price levels must be realistic and within ±12% of current price ($${marketPrice}) for the ${timeframe} timeframe.

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
  "smcAnalysis": "<4-5 sentences: market structure grade, BOS/CHoCH levels, order block range, equilibrium position, structure narrative>",
  "ictAnalysis": "<4-5 sentences: FVG levels, OTE zone, premium/discount position, killzone timing, NWOG/NDOG if relevant>",
  "quantumLiquidityAnalysis": "<4-5 sentences: BSL/SSL levels, equal highs/lows, whale signals, most probable sweep target>",
  "technicalAnalysis": "<4-5 sentences: RSI value + divergence, MACD state, EMA alignment, volume context, ATR/BB volatility read>",
  "multiTimeframeAnalysis": "<3-4 sentences: 1W/1D bias, 4h structure, ${timeframe} trigger, HTF/LTF alignment grade>",
  "newsImpact": "<2-3 sentences: specific headline impact, event risk, catalyst strength>",
  "socialSentiment": "<2-3 sentences: retail X sentiment, contrarian or confirmatory read, FOMO/fear index>",
  "tradeRationale": "<4-5 sentences: WHY this direction, WHY this entry level, WHY now — the complete thesis>",
  "confluenceScore": <0-100>,
  "confluenceFactors": ["<factor 1: name + aligned/conflicting>", "<factor 2>", "<factor 3>", "<factor 4>", "<factor 5>", "<factor 6>"],
  "analysisLogs": [
    "STEP 1 SMC: <1-line log>",
    "STEP 2 ICT: <1-line log>",
    "STEP 3 QUANTUM: <1-line log>",
    "STEP 4 TECHNICALS: <1-line log>",
    "STEP 5 MTF: <1-line log>",
    "STEP 6 CATALYSTS: <1-line log>",
    "STEP 7 LEVELS: Entry=$X, SL=$X, TP1=$X, TP2=$X, TP3=$X, R:R=1:X",
    "STEP 8 CONFLUENCE: Score=XX/100 — <reason for final direction decision>"
  ],
  "riskAssessment": "<2-3 sentences: overall risk level (LOW/MEDIUM/HIGH), key risks to the thesis, position sizing guidance>",
  "keyLevels": { "support": [<num>, <num>, <num>], "resistance": [<num>, <num>, <num>] },
  "invalidation": "<2 sentences: exact price/event that invalidates the setup and why>",
  "summary": "<3-4 sentence final verdict combining all 8 analysis steps into a clear actionable conclusion>",
  "warnings": ["<specific warning 1>", "<specific warning 2>", "<specific warning 3>"]
}`;

  try {
    const { text } = await callMultiAI([{ role: 'user', content: prompt }], 4096);
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

    const { text } = await callMultiAI(messages, 8192);
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

    return {
      overview: parsed.overview || fallbackResult.overview,
      coins: coins_result,
      upcomingTrades,
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
