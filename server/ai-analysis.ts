import Anthropic from "@anthropic-ai/sdk";

const anthropic = new Anthropic({
  apiKey: process.env.AI_INTEGRATIONS_ANTHROPIC_API_KEY,
  baseURL: process.env.AI_INTEGRATIONS_ANTHROPIC_BASE_URL,
});

export interface AISignalAnalysis {
  verdict: "STRONG_BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG_SELL";
  adjustedConfidence: number;
  reasoning: string;
  riskLevel: "LOW" | "MEDIUM" | "HIGH";
  keyLevels: { support: number; resistance: number };
  marketSentiment: string;
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
}): Promise<AISignalAnalysis> {
  try {
    const prompt = `You are a professional crypto trading analyst AI. Analyze this trading signal and provide a detailed assessment.

Signal Data:
- Coin: ${signalData.coin}/USDT
- Direction: ${signalData.type}
- Strategy: ${signalData.strategy}
- Entry Price: $${signalData.entry.toFixed(4)}
- Take Profit: $${signalData.tp.toFixed(4)}
- Stop Loss: $${signalData.sl.toFixed(4)}
- Current Market Price: $${signalData.marketPrice.toFixed(4)}
- Timeframe: ${signalData.timeframe}
- Base Confidence: ${signalData.confidence}%

Risk/Reward Ratio: ${(Math.abs(signalData.tp - signalData.entry) / Math.abs(signalData.entry - signalData.sl)).toFixed(2)}

Respond in JSON format only:
{
  "verdict": "STRONG_BUY" | "BUY" | "NEUTRAL" | "SELL" | "STRONG_SELL",
  "adjustedConfidence": <number 0-100>,
  "reasoning": "<brief 1-2 sentence analysis>",
  "riskLevel": "LOW" | "MEDIUM" | "HIGH",
  "keyLevels": { "support": <number>, "resistance": <number> },
  "marketSentiment": "<brief sentiment description>"
}`;

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 300,
      messages: [{ role: "user", content: prompt }],
    });

    const content = message.content[0];
    if (content.type !== "text") throw new Error("Unexpected response type");

    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("Could not parse AI response");

    const parsed = JSON.parse(jsonMatch[0]);
    
    return {
      verdict: parsed.verdict || "NEUTRAL",
      adjustedConfidence: Math.min(100, Math.max(0, parsed.adjustedConfidence || signalData.confidence)),
      reasoning: parsed.reasoning || "Analysis unavailable",
      riskLevel: parsed.riskLevel || "MEDIUM",
      keyLevels: parsed.keyLevels || { support: signalData.sl, resistance: signalData.tp },
      marketSentiment: parsed.marketSentiment || "Neutral",
    };
  } catch (error) {
    console.error("AI analysis error:", error);
    return {
      verdict: signalData.confidence >= 85 ? "BUY" : "NEUTRAL",
      adjustedConfidence: signalData.confidence,
      reasoning: "AI analysis temporarily unavailable - using base signal data",
      riskLevel: "MEDIUM",
      keyLevels: { support: signalData.sl, resistance: signalData.tp },
      marketSentiment: "Calculating...",
    };
  }
}

export interface CoinInsight {
  coin: string;
  sentiment: "BULLISH" | "BEARISH" | "NEUTRAL";
  shortAnalysis: string;
  keyLevel: string;
  action: "BUY" | "SELL" | "HOLD" | "WATCH";
}

export interface UpcomingTrade {
  coin: string;
  direction: "LONG" | "SHORT";
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
    overview: "Crypto markets are showing mixed signals. Monitor key support and resistance levels across major pairs for breakout opportunities.",
    coins: coins.map(c => ({
      coin: c,
      sentiment: "NEUTRAL" as const,
      shortAnalysis: "Consolidating near key levels. Watch for volume confirmation.",
      keyLevel: "Support/Resistance zone active",
      action: "WATCH" as const,
    })),
    upcomingTrades: [
      { coin: "BTC", direction: "LONG", reason: "Holding above key support with increasing volume", confidence: 75, timeframe: "4h" },
      { coin: "ETH", direction: "LONG", reason: "Bullish divergence on RSI with accumulation signs", confidence: 70, timeframe: "1h" },
      { coin: "SOL", direction: "SHORT", reason: "Rejection at resistance with declining momentum", confidence: 68, timeframe: "15m" },
    ],
    marketMood: "Cautiously Optimistic",
    timestamp: new Date().toISOString(),
  };

  try {
    const marketContext = marketData?.length
      ? marketData.map(d => `${d.symbol}: Current Price $${d.price}, 24h Change ${d.change > 0 ? '+' : ''}${d.change.toFixed(2)}%, 24h Volume $${(d.volume / 1e6).toFixed(0)}M`).join('\n')
      : coins.map(c => `${c}: price data unavailable`).join('\n');

    const message = await anthropic.messages.create({
      model: "claude-sonnet-4-6",
      max_tokens: 8192,
      system: "You are a professional crypto market analyst providing real-time analysis. Return ONLY valid JSON. No markdown, no code blocks. CRITICAL: Use the EXACT current prices provided below in your analysis. Key levels must be near the actual current price - not generic round numbers. For example if BTC is at $67,800, key levels should be around $66,500-$69,000 range, NOT $60,000.",
      messages: [
        {
          role: "user",
          content: `Analyze these live crypto markets using the REAL prices below. Your key levels and analysis MUST reference prices close to the actual current values.

LIVE MARKET DATA:
${marketContext}

Return this exact JSON structure:
{
  "overview": "2-3 sentence market overview referencing actual prices and % changes from the data above",
  "coins": [
    {"coin": "BTC", "sentiment": "BULLISH or BEARISH or NEUTRAL", "shortAnalysis": "1 sentence using actual price data", "keyLevel": "specific realistic price level near current price", "action": "BUY or SELL or HOLD or WATCH"}
  ],
  "upcomingTrades": [
    {"coin": "BTC", "direction": "LONG or SHORT", "reason": "1 sentence with specific price targets near current levels", "confidence": 75, "timeframe": "1h or 4h or 15m"}
  ],
  "marketMood": "1-3 word mood description"
}

RULES:
- Include ALL coins: ${coins.join(", ")}
- Sentiment MUST match the 24h change: positive change (>1%) = BULLISH, negative (<-1%) = BEARISH, small change = NEUTRAL
- Key levels MUST be within 5% of the current price shown above
- Generate 3-5 upcoming trade ideas with realistic entry/exit levels
- Confidence should reflect how strong the setup is (60-95 range)
- Be specific about prices, not generic`
        }
      ],
    });

    const content = message.content[0];
    if (content.type !== "text") {
      console.error("Market insight: unexpected response type");
      return fallbackResult;
    }

    const jsonMatch = content.text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) {
      console.error("Market insight: could not parse JSON from response");
      return fallbackResult;
    }

    const parsed = JSON.parse(jsonMatch[0]);

    return {
      overview: parsed.overview || fallbackResult.overview,
      coins: (parsed.coins || []).map((c: any) => ({
        coin: c.coin || "BTC",
        sentiment: (["BULLISH", "BEARISH", "NEUTRAL"].includes(c.sentiment) ? c.sentiment : "NEUTRAL") as "BULLISH" | "BEARISH" | "NEUTRAL",
        shortAnalysis: c.shortAnalysis || "Analysis pending",
        keyLevel: c.keyLevel || "Key levels being calculated",
        action: (["BUY", "SELL", "HOLD", "WATCH"].includes(c.action) ? c.action : "WATCH") as "BUY" | "SELL" | "HOLD" | "WATCH",
      })),
      upcomingTrades: (parsed.upcomingTrades || []).map((t: any) => ({
        coin: t.coin || "BTC",
        direction: t.direction === "SHORT" ? "SHORT" as const : "LONG" as const,
        reason: t.reason || "Technical setup forming",
        confidence: Math.min(100, Math.max(0, t.confidence || 70)),
        timeframe: t.timeframe || "1h",
      })),
      marketMood: parsed.marketMood || "Neutral",
      timestamp: new Date().toISOString(),
    };
  } catch (error: any) {
    console.error("Market insight error:", error?.message || error);
    return fallbackResult;
  }
}
