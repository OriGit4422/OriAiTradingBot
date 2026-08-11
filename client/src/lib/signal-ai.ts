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
/**
 * A signal's AI verdict is keyed on its exact levels, which only move when the
 * underlying candles move. 30 min of reuse costs nothing in accuracy and cuts
 * upstream calls by roughly 20× versus the old 5-minute window.
 */
const AI_RESULT_CACHE_TTL_MS = 30 * 60 * 1000;
/**
 * Only the strongest handful of setups are worth an AI opinion. Everything else
 * ships with its deterministic score. This is the single biggest lever on daily
 * spend: the old default asked for 12 verdicts every 90 s per open tab.
 */
const DEFAULT_AI_LIMIT = 3;
/** Below this deterministic confidence a signal is not worth an AI call at all. */
const AI_MIN_CONFIDENCE = 70;

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

export async function enhanceSignalsWithAI(signals: any[], limit = DEFAULT_AI_LIMIT): Promise<any[]> {
  if (!signals.length) return signals;

  const aiUnavailable = Date.now() < aiClientDisabledUntil;
  if (aiUnavailable) {
    // The AI layer is a veto, so its absence is not evidence against a setup.
    // Signals keep their deterministic score and are clearly badged as
    // un-reviewed rather than being forced to PENDING across the board.
    return signals.map(s => ({
      ...s,
      aiValidated: false,
      aiCooldownActive: true,
      aiCooldownUntil: aiClientDisabledUntil,
      status: s.confidence >= 68 ? 'ACTIVE' : 'PENDING',
      aiConfirmation: {
        verdict: 'NEUTRAL' as const,
        reasoning: `AI review unavailable until ${new Date(aiClientDisabledUntil).toLocaleTimeString()} (daily budget or missing key). Score is deterministic TA only.`,
        riskLevel: 'MEDIUM' as const,
        adjustedConfidence: s.confidence,
        marketSentiment: 'Deterministic TA only',
        keyLevels: { support: s.sl, resistance: s.tp },
        isAligned: true,
      },
    }));
  }

  // Candidates worth an opinion: strongest first, and only above the floor.
  const candidates = signals
    .map((signal, index) => ({ signal, index }))
    .filter(({ signal }) => signal.confidence >= AI_MIN_CONFIDENCE)
    .sort((a, b) => b.signal.confidence - a.signal.confidence);

  // Deterministic baseline. A signal that never reaches the AI layer is still a
  // real signal — the TA engine is the driver, the AI is only a veto — so its
  // status comes from its own score rather than defaulting to PENDING.
  const enhancedSignals = signals.map(s => ({
    ...s,
    aiValidated: false,
    status: s.confidence >= 68 ? 'ACTIVE' : 'PENDING',
  }));

  const buildKey = (s: any) =>
    `${s.coin}|${s.type}|${s.timeframe}|${Number(s.entry).toFixed(6)}|${Number(s.tp).toFixed(6)}|${Number(s.sl).toFixed(6)}|${s.strategy}`;

  // Cache hits are free, so they do not consume the call budget — only real
  // network round-trips are counted against `limit`.
  let networkCalls = 0;

  for (const { signal, index } of candidates) {
    if (Date.now() < aiClientDisabledUntil) break;

    try {
      const key = buildKey(signal);
      const cached = aiResultCache.get(key);
      let ai: AISignalConfirmation;

      if (cached && Date.now() - cached.at < AI_RESULT_CACHE_TTL_MS) {
        ai = cached.data;
      } else {
        if (networkCalls >= limit) continue;
        networkCalls++;
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

      // AI is a VETO LAYER, not a co-scorer (see CLAUDE.md). It may subtract
      // confidence when it sees risk or hesitation, but it can never add any:
      // blending its number 50/50 with the deterministic score let a talkative
      // model inflate weak setups, which is exactly what the architecture
      // forbids. The TA score is the ceiling.
      const riskPenalty = ai.riskLevel === 'HIGH' ? 12 : ai.riskLevel === 'MEDIUM' ? 3 : 0;
      const hesitationPenalty = bias === 'NEUTRAL' ? 8 : 0;
      const adjusted = Math.max(30, Math.min(signal.confidence, signal.confidence - riskPenalty - hesitationPenalty));

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
