import { apiRequest } from '@/lib/queryClient';

interface AISignalConfirmation {
  verdict: 'STRONG_BUY' | 'BUY' | 'NEUTRAL' | 'SELL' | 'STRONG_SELL';
  adjustedConfidence: number;
  reasoning: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  keyLevels: { support: number; resistance: number };
  marketSentiment: string;
}

const AI_CLIENT_COOLDOWN_MS = 5 * 60 * 1000;
const AI_RESULT_CACHE_TTL_MS = 5 * 60 * 1000;
let aiClientDisabledUntil = 0;
let lastAIError: string | null = null;
const aiResultCache = new Map<string, { at: number; data: AISignalConfirmation }>();

export function getAIClientStatus(): { available: boolean; disabledUntil: number; lastError: string | null } {
  return {
    available: Date.now() >= aiClientDisabledUntil,
    disabledUntil: aiClientDisabledUntil,
    lastError: lastAIError,
  };
}

export function resetAIClientCooldown() {
  aiClientDisabledUntil = 0;
  lastAIError = null;
}

function verdictBias(verdict: AISignalConfirmation['verdict']): 'LONG' | 'SHORT' | 'NEUTRAL' {
  if (verdict === 'STRONG_BUY' || verdict === 'BUY') return 'LONG';
  if (verdict === 'STRONG_SELL' || verdict === 'SELL') return 'SHORT';
  return 'NEUTRAL';
}

function isDirectConflict(verdict: AISignalConfirmation['verdict'], signalType: string): boolean {
  const dir = signalType?.toUpperCase();
  if (dir === 'LONG' && (verdict === 'STRONG_SELL' || verdict === 'SELL')) return true;
  if (dir === 'SHORT' && (verdict === 'STRONG_BUY' || verdict === 'BUY')) return true;
  return false;
}

export async function enhanceSignalsWithAI(signals: any[], limit = 12): Promise<any[]> {
  if (!signals.length) return signals;

  const aiUnavailable = Date.now() < aiClientDisabledUntil;
  if (aiUnavailable) {
    // Mark all signals as pending AI validation — do NOT auto-approve
    return signals.map(s => ({
      ...s,
      aiValidated: false,
      aiCooldownActive: true,
      aiCooldownUntil: aiClientDisabledUntil,
      status: 'PENDING',
      aiConfirmation: {
        verdict: 'NEUTRAL' as const,
        reasoning: `AI validation on cooldown until ${new Date(aiClientDisabledUntil).toLocaleTimeString()}. Configure API keys in Settings.`,
        riskLevel: 'MEDIUM' as const,
        adjustedConfidence: s.confidence,
        marketSentiment: 'Pending AI validation',
        keyLevels: { support: s.sl, resistance: s.tp },
        isAligned: true,
      },
    }));
  }

  const sortedIndexes = signals
    .map((signal, index) => ({ signal, index }))
    .sort((a, b) => b.signal.confidence - a.signal.confidence)
    .slice(0, Math.min(limit, signals.length));

  const enhancedSignals = signals.map(s => ({
    ...s,
    aiValidated: false,
    status: 'PENDING',
  }));

  const buildKey = (s: any) =>
    `${s.coin}|${s.type}|${s.timeframe}|${Number(s.entry).toFixed(6)}|${Number(s.tp).toFixed(6)}|${Number(s.sl).toFixed(6)}|${s.strategy}`;

  for (const { signal, index } of sortedIndexes) {
    if (Date.now() < aiClientDisabledUntil) break;

    try {
      const key = buildKey(signal);
      const cached = aiResultCache.get(key);
      let ai: AISignalConfirmation;

      if (cached && Date.now() - cached.at < AI_RESULT_CACHE_TTL_MS) {
        ai = cached.data;
      } else {
        const ind = signal.indicators || {};
        const sd = ind.strategyDepth || {};
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
          agentContext: {
            smcStructure: ind.marketStructure,
            rsiDivergence: ind.rsiDivergence,
            ichimokuSignal: ind.ichimokuSignal,
            volumeProfile: ind.volumeProfile,
            volumeForecast: ind.volumeForecast,
            whaleActivity: ind.whaleActivity,
            marketPhase: ind.marketPhase,
            liquidityClusters: ind.liquidityClusters,
            ensembleDirection: ind.ensembleDirection,
            ensembleConfidence: ind.ensembleConfidence,
            smcScore: sd.smc,
            ictScore: sd.ict,
            quantumLiquidityScore: sd.quantum,
            liquidityDepthScore: sd.liquidity,
            crtScore: sd.crt,
          },
        });

        const data = await response.json();
        // If API returns an error (isValid: false + aiUnavailable), trigger cooldown
        if (data.aiUnavailable) {
          lastAIError = data.validation || 'AI unavailable';
          aiClientDisabledUntil = Date.now() + AI_CLIENT_COOLDOWN_MS;
          break;
        }
        ai = data as AISignalConfirmation;
        aiResultCache.set(key, { at: Date.now(), data: ai });
      }

      // Filter out direct conflicts — AI says opposite direction
      if (isDirectConflict(ai.verdict, signal.type)) {
        enhancedSignals[index] = {
          ...signal,
          confidence: Math.max(30, signal.confidence - 25),
          aiValidated: true,
          aiFiltered: true,
          status: 'FILTERED',
          aiConfirmation: {
            verdict: ai.verdict,
            reasoning: ai.reasoning,
            riskLevel: ai.riskLevel,
            adjustedConfidence: ai.adjustedConfidence,
            marketSentiment: ai.marketSentiment,
            keyLevels: ai.keyLevels,
            isAligned: false,
            filtered: true,
          },
        };
        continue;
      }

      const bias = verdictBias(ai.verdict);
      const riskPenalty = ai.riskLevel === 'HIGH' ? 8 : ai.riskLevel === 'MEDIUM' ? 3 : 0;
      const verdictBonus = ai.verdict === 'STRONG_BUY' || ai.verdict === 'STRONG_SELL' ? 5 : 0;

      const blended = Math.round(signal.confidence * 0.50 + ai.adjustedConfidence * 0.50);
      const adjusted = Math.max(40, Math.min(98, blended - riskPenalty + verdictBonus));

      const isActive = adjusted >= 68 && ai.riskLevel !== 'HIGH' && bias !== 'NEUTRAL';
      const isAligned = bias === 'NEUTRAL' || bias === signal.type;

      enhancedSignals[index] = {
        ...signal,
        confidence: adjusted,
        aiValidated: true,
        aiFiltered: false,
        status: isActive ? 'ACTIVE' : 'PENDING',
        aiConfirmation: {
          verdict: ai.verdict,
          reasoning: ai.reasoning,
          riskLevel: ai.riskLevel,
          adjustedConfidence: ai.adjustedConfidence,
          marketSentiment: ai.marketSentiment,
          keyLevels: ai.keyLevels,
          isAligned,
          filtered: false,
        },
      };
    } catch (_error) {
      continue;
    }
  }

  return enhancedSignals;
}
