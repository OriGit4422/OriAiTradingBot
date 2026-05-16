import { callMultiAI, streamChatResponse, type AIMessage } from './ai-providers';

export interface AISignalResult {
  pair: string;
  type: string;
  entry: number;
  target: number;
  stopLoss: number;
  confidence: number;
  aiAnalysis: string;
  aiValidation: string;
  aiRiskScore: number;
  riskReward: string;
  marketContext: string;
}

export interface AIValidationResult {
  isValid: boolean;
  riskScore: number;
  validation: string;
  suggestions: string;
}

export interface AIStrategyReview {
  score: number;
  review: string;
}

export async function generateAISignal(pair: string, _marketData?: any): Promise<AISignalResult> {
  const prompt = `You are an expert cryptocurrency trading analyst AI. Generate a detailed trading signal for ${pair}.

Consider the following in your analysis:
- Current market conditions and trends
- Technical indicators (RSI, MACD, Bollinger Bands, Volume, EMA, Fibonacci)
- Support and resistance levels
- Market sentiment and momentum
- Risk-reward ratio optimization

Respond in this exact JSON format only, no other text:
{
  "type": "long" or "short",
  "entry": <realistic current price as number>,
  "target": <target price as number>,
  "stopLoss": <stop loss price as number>,
  "confidence": <0.50 to 0.95 as number>,
  "aiAnalysis": "<2-3 sentences of detailed technical analysis explaining the signal>",
  "aiValidation": "<1-2 sentences validating the signal quality and reliability>",
  "aiRiskScore": <1.0 to 10.0 risk score where 1=lowest risk, 10=highest risk>,
  "riskReward": "<risk:reward ratio like 1:2.5>",
  "marketContext": "<1-2 sentences about broader market context affecting this trade>"
}

Use realistic current approximate prices for ${pair}. BTC around 65000-70000, ETH around 3200-3500, SOL around 140-175, BNB around 580-620, XRP around 0.50-0.70, ADA around 0.40-0.55, DOGE around 0.07-0.12, AVAX around 30-42.`;

  try {
    const { text } = await callMultiAI([{ role: 'user', content: prompt }], 1024);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Could not parse AI response');
    const parsed = JSON.parse(jsonMatch[0]);

    return {
      pair,
      type: parsed.type || 'long',
      entry: Number(parsed.entry) || 0,
      target: Number(parsed.target) || 0,
      stopLoss: Number(parsed.stopLoss) || 0,
      confidence: Math.min(0.95, Math.max(0.5, Number(parsed.confidence) || 0.7)),
      aiAnalysis: parsed.aiAnalysis || 'AI analysis completed.',
      aiValidation: parsed.aiValidation || 'Signal validated by AI.',
      aiRiskScore: Math.min(10, Math.max(1, Number(parsed.aiRiskScore) || 5)),
      riskReward: parsed.riskReward || '1:2',
      marketContext: parsed.marketContext || 'Market conditions analyzed.',
    };
  } catch (error: any) {
    console.error('AI Signal generation error:', error.message);
    throw new Error('Failed to generate AI signal: ' + error.message);
  }
}

export async function validateSignal(signal: {
  pair: string;
  type: string;
  entry: number;
  target: number;
  stopLoss: number;
}): Promise<AIValidationResult> {
  const prompt = `You are an expert crypto trading risk analyst. Validate this trading signal:

Pair: ${signal.pair}
Direction: ${signal.type.toUpperCase()}
Entry Price: $${signal.entry}
Target Price: $${signal.target}
Stop Loss: $${signal.stopLoss}

Analyze:
1. Is the risk-reward ratio acceptable (minimum 1:1.5)?
2. Are the entry, target, and stop-loss levels realistic?
3. Does the trade direction make sense given typical market patterns?
4. What is the overall risk level?

Respond in this exact JSON format only:
{
  "isValid": true/false,
  "riskScore": <1.0 to 10.0>,
  "validation": "<2-3 sentences of validation analysis>",
  "suggestions": "<1-2 sentences of improvement suggestions>"
}`;

  try {
    const { text } = await callMultiAI([{ role: 'user', content: prompt }], 512);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Could not parse AI response');
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      isValid: parsed.isValid ?? true,
      riskScore: Math.min(10, Math.max(1, Number(parsed.riskScore) || 5)),
      validation: parsed.validation || 'Validation complete.',
      suggestions: parsed.suggestions || 'No additional suggestions.',
    };
  } catch (error: any) {
    console.error('AI Validation error:', error.message);
    return {
      isValid: true,
      riskScore: 5,
      validation: 'AI validation temporarily unavailable. Signal generated with standard parameters.',
      suggestions: 'Please review signal manually.',
    };
  }
}

export async function reviewStrategy(strategy: {
  name: string;
  type: string;
  pairs: string[];
  indicators: string[];
  timeframe: string;
  riskLevel: string;
  takeProfit: number;
  stopLoss: number;
  maxPositionSize: number;
  winRate: number;
  totalTrades: number;
  profitLoss: number;
}): Promise<AIStrategyReview> {
  const prompt = `You are an expert crypto trading strategy analyst. Review this trading strategy:

Strategy Name: ${strategy.name}
Type: ${strategy.type}
Trading Pairs: ${strategy.pairs.join(', ')}
Indicators: ${strategy.indicators.join(', ')}
Timeframe: ${strategy.timeframe}
Risk Level: ${strategy.riskLevel}
Take Profit: ${strategy.takeProfit}%
Stop Loss: ${strategy.stopLoss}%
Max Position Size: ${strategy.maxPositionSize}%
Current Win Rate: ${strategy.winRate}%
Total Trades: ${strategy.totalTrades}
Profit/Loss: $${strategy.profitLoss}

Evaluate:
1. Strategy coherence (do the indicators and timeframe match the strategy type?)
2. Risk management adequacy
3. Performance metrics assessment
4. Optimization suggestions

Respond in this exact JSON format only:
{
  "score": <1.0 to 10.0 overall strategy quality score>,
  "review": "<3-5 sentences of detailed strategy review with specific actionable insights>"
}`;

  try {
    const { text } = await callMultiAI([{ role: 'user', content: prompt }], 512);
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Could not parse AI response');
    const parsed = JSON.parse(jsonMatch[0]);
    return {
      score: Math.min(10, Math.max(1, Number(parsed.score) || 5)),
      review: parsed.review || 'Strategy review complete.',
    };
  } catch (error: any) {
    console.error('AI Strategy review error:', error.message);
    return { score: 5, review: 'AI review temporarily unavailable. Please try again later.' };
  }
}

export async function chatWithAI(
  messages: Array<{ role: 'user' | 'assistant'; content: string }>,
  _userId: string,
): Promise<string> {
  const system = `You are WINM AI, an expert cryptocurrency trading assistant. You help traders with:
- Market analysis and technical analysis
- Trading strategy recommendations
- Risk management advice
- Cryptocurrency market insights and education
- Portfolio optimization suggestions
- Understanding technical indicators (RSI, MACD, Bollinger Bands, etc.)
- Explaining trading concepts and patterns

Be concise, data-driven, and practical. Always emphasize risk management. Never provide financial advice, instead frame responses as educational analysis. Use specific numbers and examples when possible.

Important: You are part of the WINM AI Trading Bot platform. The user is a crypto trader looking for insights.`;

  const fullMessages: AIMessage[] = [
    { role: 'system', content: system },
    ...messages,
  ];

  try {
    const { text } = await callMultiAI(fullMessages, 2048);
    return text;
  } catch (error: any) {
    console.error('AI Chat error:', error.message);
    throw new Error('AI assistant temporarily unavailable: ' + error.message);
  }
}

export { streamChatResponse };
