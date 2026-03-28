import { apiRequest } from '@/lib/queryClient';

interface AISignalConfirmation {
  verdict: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
  adjustedConfidence: number;
  reasoning: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  keyLevels: { support: number; resistance: number };
  marketSentiment: string;
}

function verdictBias(verdict: AISignalConfirmation['verdict']): 'LONG' | 'SHORT' | 'NEUTRAL' {
  if (verdict === 'STRONG_BUY' || verdict === 'BUY') return 'LONG';
  if (verdict === 'STRONG_SELL' || verdict === 'SELL') return 'SHORT';
  return 'NEUTRAL';
}

export async function enhanceSignalsWithAI(signals: any[], limit = 12): Promise<any[]> {
  if (!signals.length) return signals;

  const sortedIndexes = signals
    .map((signal, index) => ({ signal, index }))
    .sort((a, b) => b.signal.confidence - a.signal.confidence)
    .slice(0, Math.min(limit, signals.length));

  const enhancedSignals = [...signals];

  await Promise.allSettled(
    sortedIndexes.map(async ({ signal, index }) => {
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

      const ai = (await response.json()) as AISignalConfirmation;

      const bias = verdictBias(ai.verdict);
      const directionPenalty =
        bias !== 'NEUTRAL' && bias !== signal.type ? 12 : 0;
      const riskPenalty = ai.riskLevel === 'HIGH' ? 6 : ai.riskLevel === 'MEDIUM' ? 2 : 0;

      const blended = Math.round(signal.confidence * 0.55 + ai.adjustedConfidence * 0.45);
      const adjusted = Math.max(45, Math.min(98, blended - directionPenalty - riskPenalty));

      // Recalculate composite signalScore with updated confidence
      const rrRatio = Math.abs(signal.tp - signal.entry) / Math.max(0.0001, Math.abs(signal.entry - signal.sl));
      const rrQuality = Math.min(100, Math.max(0, ((rrRatio - 1.5) / 2.5) * 100));
      const signalScore = Math.round(adjusted * 0.65 + rrQuality * 0.35);

      enhancedSignals[index] = {
        ...signal,
        confidence: adjusted,
        signalScore,
        rrRatio: Math.round(rrRatio * 100) / 100,
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
    })
  );

  return enhancedSignals;
}
