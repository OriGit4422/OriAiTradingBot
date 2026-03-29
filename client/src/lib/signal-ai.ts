import { apiRequest } from '@/lib/queryClient';

interface AISignalConfirmation {
  verdict: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
  adjustedConfidence: number;
  reasoning: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  keyLevels: { support: number; resistance: number };
  marketSentiment: string;
}

const AI_CLIENT_COOLDOWN_MS = 10 * 60 * 1000;
const AI_RESULT_CACHE_TTL_MS = 5 * 60 * 1000;
let aiClientDisabledUntil = 0;
const aiResultCache = new Map<string, { at: number; data: AISignalConfirmation }>();

function verdictBias(verdict: AISignalConfirmation['verdict']): 'LONG' | 'SHORT' | 'NEUTRAL' {
  if (verdict === 'STRONG_BUY' || verdict === 'BUY') return 'LONG';
  if (verdict === 'STRONG_SELL' || verdict === 'SELL') return 'SHORT';
  return 'NEUTRAL';
}

export async function enhanceSignalsWithAI(signals: any[], limit = 12): Promise<any[]> {
  if (!signals.length) return signals;
  if (Date.now() < aiClientDisabledUntil) return signals;

  const sortedIndexes = signals
    .map((signal, index) => ({ signal, index }))
    .sort((a, b) => b.signal.confidence - a.signal.confidence)
    .slice(0, Math.min(limit, signals.length));

  const enhancedSignals = [...signals];

  const buildKey = (s: any) =>
    `${s.coin}|${s.type}|${s.timeframe}|${Number(s.entry).toFixed(6)}|${Number(s.tp).toFixed(6)}|${Number(s.sl).toFixed(6)}|${s.strategy}`;

  for (const { signal, index } of sortedIndexes) {
    try {
      const key = buildKey(signal);
      const cached = aiResultCache.get(key);
      let ai: AISignalConfirmation;

      if (cached && Date.now() - cached.at < AI_RESULT_CACHE_TTL_MS) {
        ai = cached.data;
      } else {
        const response = await apiRequest('POST', '/api/ai/analyze-signal', {
          coin: signal.coin,
          type: signal.type,
          entry: signal.entry,
          tp: signal.tp,
          sl: signal.sl,
          marketPrice: signal.marketPrice,
          timeframe: signal.timeframe,
          confidence: signal.confidence,
          strategy: signal.strategy,
        });

        ai = (await response.json()) as AISignalConfirmation;
        aiResultCache.set(key, { at: Date.now(), data: ai });
      }

      if ((ai.reasoning || '').toLowerCase().includes('temporarily unavailable')) {
        aiClientDisabledUntil = Date.now() + AI_CLIENT_COOLDOWN_MS;
      }

      const bias = verdictBias(ai.verdict);
      const directionPenalty =
        bias !== 'NEUTRAL' && bias !== signal.type ? 12 : 0;
      const riskPenalty = ai.riskLevel === 'HIGH' ? 6 : ai.riskLevel === 'MEDIUM' ? 2 : 0;

      const blended = Math.round(signal.confidence * 0.55 + ai.adjustedConfidence * 0.45);
      const adjusted = Math.max(45, Math.min(98, blended - directionPenalty - riskPenalty));

      enhancedSignals[index] = {
        ...signal,
        confidence: adjusted,
        aiConfirmation: {
          verdict: ai.verdict,
          reasoning: ai.reasoning,
          riskLevel: ai.riskLevel,
          adjustedConfidence: ai.adjustedConfidence,
          marketSentiment: ai.marketSentiment,
          keyLevels: ai.keyLevels,
          isAligned: bias === 'NEUTRAL' || bias === signal.type,
        },
        status: adjusted >= 72 ? 'ACTIVE' : 'PENDING',
      };

      if (Date.now() < aiClientDisabledUntil) break;
    } catch (_error) {
      continue;
    }
  }

  return enhancedSignals;
}
