/**
 * Learning Engine — persistence and scheduling around the pure learning core.
 *
 * The math lives in ./learning-core (no storage imports, unit-testable). This
 * module loads closed trades, caches the snapshot, writes an audit record and
 * runs the refresh timer. Still zero AI calls and zero API cost.
 */

import { storage } from '../storage';
import { buildSnapshot, tradesToOutcomes, type LearningSnapshot, type TradeOutcome } from './learning-core';

export * from './learning-core';

// ─── Data loading + caching ───────────────────────────────────────────────────

export const LEARNING_SNAPSHOT_EVENT = 'LEARNING_SNAPSHOT';

let cached: { snapshot: LearningSnapshot; expiresAt: number } | null = null;
const SNAPSHOT_TTL_MS = 30 * 60 * 1000;

export async function getLearningSnapshot(forceRefresh = false): Promise<LearningSnapshot> {
  if (!forceRefresh && cached && Date.now() < cached.expiresAt) return cached.snapshot;

  let outcomes: TradeOutcome[] = [];
  try {
    const trades = await storage.getBotTrades(1000);
    outcomes = tradesToOutcomes(trades);
  } catch (err) {
    console.warn('[learning-engine] Could not load trades:', err instanceof Error ? err.message : err);
  }

  const snapshot = buildSnapshot(outcomes);
  cached = { snapshot, expiresAt: Date.now() + SNAPSHOT_TTL_MS };
  return snapshot;
}

/** Recompute and persist an audit record. Cheap — no AI, one DB read. */
export async function refreshLearning(): Promise<LearningSnapshot> {
  const snapshot = await getLearningSnapshot(true);
  try {
    await storage.createBotLog({
      level: 'info',
      event: LEARNING_SNAPSHOT_EVENT,
      message: `Learning refresh: ${snapshot.sampleSize} closed trades, active=${snapshot.active}, Brier=${snapshot.brierScore ?? 'n/a'}`,
      meta: {
        sampleSize: snapshot.sampleSize,
        active: snapshot.active,
        brierScore: snapshot.brierScore,
        overallWinRate: snapshot.overallWinRate,
        expectancyR: snapshot.expectancyR,
        appliedContexts: snapshot.contexts.filter(c => c.applied).map(c => ({ kind: c.kind, key: c.key, multiplier: c.multiplier })),
      },
    });
  } catch (err) {
    console.warn('[learning-engine] Could not persist snapshot:', err instanceof Error ? err.message : err);
  }
  return snapshot;
}

// ─── Scheduler ────────────────────────────────────────────────────────────────

const REFRESH_INTERVAL_MS = 6 * 60 * 60 * 1000; // every 6h — pure math, no cost
let timer: ReturnType<typeof setInterval> | null = null;

export function startLearningEngine(): void {
  if (timer) return;
  console.log('[learning-engine] started — recalibrating every 6h from closed trades (no AI cost)');
  refreshLearning().catch(e => console.error('[learning-engine] initial refresh failed:', e));
  timer = setInterval(() => {
    refreshLearning().catch(e => console.error('[learning-engine] refresh failed:', e));
  }, REFRESH_INTERVAL_MS);
}

export function stopLearningEngine(): void {
  if (timer) { clearInterval(timer); timer = null; }
}

/** Test hook. */
export function clearLearningCache(): void {
  cached = null;
}
