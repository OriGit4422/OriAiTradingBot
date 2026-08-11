/**
 * Learning Core — the pure math behind self-calibration.
 *
 * Deliberately free of storage, network and scheduler imports so it can be
 * unit-tested without a database. `learning-engine.ts` wraps it with the
 * persistence and scheduling layer.
 * ─────────────────────────────────────────────────────────────────────────────
 * Runs entirely on closed-trade history. ZERO AI calls, zero API cost.
 *
 * Two things are learned, both bounded and both requiring evidence:
 *
 *   1. CONFIDENCE CALIBRATION
 *      The engine's raw confidence is a score, not a probability. This maps it
 *      onto the win rate actually observed at that score, using isotonic
 *      regression (pool-adjacent-violators) so the mapping stays monotonic —
 *      a higher raw score can never map to a lower calibrated probability.
 *      Each bucket is shrunk toward the raw score by its sample size
 *      (Bayesian shrinkage, k = SHRINKAGE_STRENGTH), so three lucky trades
 *      cannot move the curve.
 *
 *   2. CONTEXT MULTIPLIERS
 *      Per strategy / timeframe / direction, expectancy in R is compared with
 *      the book-wide baseline. Contexts that persistently underperform get a
 *      confidence multiplier below 1.0, outperformers slightly above. Bounded
 *      to ±MAX_CONTEXT_ADJUST so no single context can dominate, and only
 *      applied once that context has MIN_CONTEXT_SAMPLES closed trades.
 *
 * Safety properties (deliberate, do not relax without a Phase 0 backtest):
 *   • Learning can only ever REDUCE confidence below the raw score, or raise it
 *     by at most MAX_UPWARD_ADJUST. The deterministic TA engine stays the driver.
 *   • With fewer than MIN_SAMPLES closed trades the engine is a no-op identity.
 *   • Nothing here can change a stop-loss, a position size, or a risk limit.
 */

import type { BotTrade } from '@shared/schema';

// ─── Tunables ─────────────────────────────────────────────────────────────────

/** Below this many closed trades the engine returns identity — no adjustments. */
export const MIN_SAMPLES = 20;
/** Per-context sample floor before a multiplier is applied. */
export const MIN_CONTEXT_SAMPLES = 12;
/** Bayesian shrinkage strength: a bucket needs ~k trades to move halfway to its realized rate. */
export const SHRINKAGE_STRENGTH = 15;
/** Hard bound on any context multiplier. */
export const MAX_CONTEXT_ADJUST = 0.15;
/** Calibration may never add more than this many points to the raw score. */
export const MAX_UPWARD_ADJUST = 5;

const BUCKET_EDGES = [0, 50, 60, 65, 70, 75, 80, 85, 90, 101];

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CalibrationBucket {
  min: number;
  max: number;
  label: string;
  trades: number;
  wins: number;
  /** Raw observed win rate, null when the bucket is empty. */
  rawWinRate: number | null;
  /** Win rate after shrinkage toward the predicted rate and isotonic smoothing. */
  calibratedWinRate: number | null;
  predictedWinRate: number;
  /** calibrated − predicted, in percentage points. */
  divergencePts: number | null;
  avgPnlR: number | null;
}

export interface ContextStat {
  key: string;
  kind: 'strategy' | 'timeframe' | 'direction';
  trades: number;
  wins: number;
  winRate: number;
  expectancyR: number;
  /** Bounded confidence multiplier, 1.0 = no change. */
  multiplier: number;
  applied: boolean;
}

export interface LearningSnapshot {
  generatedAt: string;
  sampleSize: number;
  active: boolean;
  /** Mean squared error of predicted probability vs outcome. Lower is better; 0.25 = coin flip. */
  brierScore: number | null;
  overallWinRate: number | null;
  expectancyR: number | null;
  calibration: CalibrationBucket[];
  contexts: ContextStat[];
  notes: string[];
}

export interface TradeOutcome {
  confidence: number;
  win: boolean;
  pnlR: number;
  strategy: string;
  timeframe: string;
  direction: string;
}

// ─── Isotonic regression (pool-adjacent-violators) ────────────────────────────

/**
 * Enforce a non-decreasing sequence with weighted averaging of violations.
 * Returns a new array; inputs with weight 0 are carried through untouched.
 */
export function isotonic(values: number[], weights: number[]): number[] {
  const n = values.length;
  if (n === 0) return [];

  // Blocks of pooled adjacent values.
  const val: number[] = [];
  const wt: number[] = [];
  const len: number[] = [];

  for (let i = 0; i < n; i++) {
    val.push(values[i]);
    wt.push(weights[i]);
    len.push(1);

    // Merge backwards while the sequence decreases.
    while (val.length > 1 && val[val.length - 2] > val[val.length - 1]) {
      const v2 = val.pop()!, w2 = wt.pop()!, l2 = len.pop()!;
      const v1 = val.pop()!, w1 = wt.pop()!, l1 = len.pop()!;
      const w = w1 + w2;
      val.push(w > 0 ? (v1 * w1 + v2 * w2) / w : (v1 + v2) / 2);
      wt.push(w);
      len.push(l1 + l2);
    }
  }

  const out: number[] = [];
  for (let b = 0; b < val.length; b++) {
    for (let j = 0; j < len[b]; j++) out.push(val[b]);
  }
  return out;
}

// ─── Snapshot construction ────────────────────────────────────────────────────

function bucketLabel(min: number, max: number): string {
  return max >= 100 ? `${min}%+` : `${min}-${max - 1}%`;
}

export function buildSnapshot(outcomes: TradeOutcome[]): LearningSnapshot {
  const notes: string[] = [];
  const n = outcomes.length;

  const buckets: CalibrationBucket[] = [];
  for (let i = 0; i < BUCKET_EDGES.length - 1; i++) {
    const min = BUCKET_EDGES[i];
    const max = BUCKET_EDGES[i + 1];
    const inBucket = outcomes.filter(o => o.confidence >= min && o.confidence < max);
    const wins = inBucket.filter(o => o.win).length;
    const predicted = Math.min(99, (min + Math.min(max, 100)) / 2) / 100;
    const rawWinRate = inBucket.length ? wins / inBucket.length : null;

    // Bayesian shrinkage toward the predicted rate — small samples barely move.
    const calibrated =
      inBucket.length > 0
        ? (wins + SHRINKAGE_STRENGTH * predicted) / (inBucket.length + SHRINKAGE_STRENGTH)
        : null;

    buckets.push({
      min,
      max: Math.min(max - 1, 100),
      label: bucketLabel(min, max),
      trades: inBucket.length,
      wins,
      rawWinRate,
      calibratedWinRate: calibrated,
      predictedWinRate: predicted,
      divergencePts: calibrated !== null ? Math.round((calibrated - predicted) * 1000) / 10 : null,
      avgPnlR: inBucket.length
        ? Math.round((inBucket.reduce((s, o) => s + o.pnlR, 0) / inBucket.length) * 100) / 100
        : null,
    });
  }

  // Monotonicity: a higher confidence bucket must not calibrate below a lower one.
  const filled = buckets.map(b => b.calibratedWinRate ?? b.predictedWinRate);
  const weights = buckets.map(b => b.trades);
  const smoothed = isotonic(filled, weights);
  buckets.forEach((b, i) => {
    b.calibratedWinRate = Math.round(smoothed[i] * 1000) / 1000;
    b.divergencePts = Math.round((smoothed[i] - b.predictedWinRate) * 1000) / 10;
  });

  // Context stats.
  const baselineExpectancy = n ? outcomes.reduce((s, o) => s + o.pnlR, 0) / n : 0;
  const contexts: ContextStat[] = [];

  const group = (kind: ContextStat['kind'], keyOf: (o: TradeOutcome) => string) => {
    const map = new Map<string, TradeOutcome[]>();
    for (const o of outcomes) {
      const k = (keyOf(o) || 'unknown').trim() || 'unknown';
      const list = map.get(k) ?? [];
      list.push(o);
      map.set(k, list);
    }
    for (const [key, list] of map) {
      const wins = list.filter(o => o.win).length;
      const expectancyR = list.reduce((s, o) => s + o.pnlR, 0) / list.length;
      // Difference in expectancy, scaled and clamped. 1R of edge ≈ full adjustment.
      const rawDelta = Math.max(-1, Math.min(1, expectancyR - baselineExpectancy));
      // Shrink by sample size so a 12-trade context moves less than a 100-trade one.
      const confidenceWeight = list.length / (list.length + SHRINKAGE_STRENGTH);
      const multiplier = 1 + rawDelta * MAX_CONTEXT_ADJUST * confidenceWeight;
      contexts.push({
        key,
        kind,
        trades: list.length,
        wins,
        winRate: Math.round((wins / list.length) * 1000) / 1000,
        expectancyR: Math.round(expectancyR * 100) / 100,
        multiplier: Math.round(multiplier * 1000) / 1000,
        applied: list.length >= MIN_CONTEXT_SAMPLES && n >= MIN_SAMPLES,
      });
    }
  };

  group('strategy', o => o.strategy);
  group('timeframe', o => o.timeframe);
  group('direction', o => o.direction);

  // Brier score against the raw predicted probability.
  const brier = n
    ? outcomes.reduce((s, o) => {
        const p = Math.min(1, Math.max(0, o.confidence / 100));
        return s + Math.pow(p - (o.win ? 1 : 0), 2);
      }, 0) / n
    : null;

  const active = n >= MIN_SAMPLES;
  if (!active) {
    notes.push(`Learning inactive — ${n}/${MIN_SAMPLES} closed trades. Confidence is passed through unchanged.`);
  } else {
    const worst = [...buckets]
      .filter(b => b.trades >= MIN_CONTEXT_SAMPLES && b.divergencePts !== null)
      .sort((a, b) => (a.divergencePts ?? 0) - (b.divergencePts ?? 0))[0];
    if (worst && (worst.divergencePts ?? 0) < -10) {
      notes.push(`${worst.label} bucket is overconfident by ${Math.abs(worst.divergencePts ?? 0).toFixed(1)} pts over ${worst.trades} trades — calibration is discounting it.`);
    }
    const weakest = contexts.filter(c => c.applied).sort((a, b) => a.multiplier - b.multiplier)[0];
    if (weakest && weakest.multiplier < 0.95) {
      notes.push(`Weakest context: ${weakest.kind} "${weakest.key}" (${weakest.trades} trades, ${weakest.expectancyR}R) — confidence ×${weakest.multiplier}.`);
    }
  }

  return {
    generatedAt: new Date().toISOString(),
    sampleSize: n,
    active,
    brierScore: brier !== null ? Math.round(brier * 10000) / 10000 : null,
    overallWinRate: n ? Math.round((outcomes.filter(o => o.win).length / n) * 1000) / 1000 : null,
    expectancyR: n ? Math.round(baselineExpectancy * 100) / 100 : null,
    calibration: buckets,
    contexts: contexts.sort((a, b) => b.trades - a.trades),
    notes,
  };
}

// ─── Applying what was learned ────────────────────────────────────────────────

export interface LearningAdjustment {
  rawConfidence: number;
  calibratedConfidence: number;
  delta: number;
  reasons: string[];
  active: boolean;
}

/**
 * Map a raw confidence score onto the calibrated scale and apply context
 * multipliers. Pure function of the snapshot — safe to call on every signal.
 */
export function applyLearning(
  rawConfidence: number,
  ctx: { strategy?: string; timeframe?: string; direction?: string },
  snapshot: LearningSnapshot | null,
): LearningAdjustment {
  const raw = Math.max(0, Math.min(100, rawConfidence));
  if (!snapshot?.active) {
    return { rawConfidence: raw, calibratedConfidence: raw, delta: 0, reasons: [], active: false };
  }

  const reasons: string[] = [];

  // 1. Calibration curve — only trust buckets that carry real evidence.
  const bucket = snapshot.calibration.find(b => raw >= b.min && raw <= b.max);
  let calibrated = raw;
  if (bucket && bucket.trades >= MIN_CONTEXT_SAMPLES && bucket.calibratedWinRate !== null) {
    calibrated = bucket.calibratedWinRate * 100;
    const shift = calibrated - raw;
    if (Math.abs(shift) >= 1) {
      reasons.push(
        `Calibration: ${bucket.label} bucket realized ${(bucket.calibratedWinRate * 100).toFixed(0)}% over ${bucket.trades} trades (${shift > 0 ? '+' : ''}${shift.toFixed(0)} pts)`,
      );
    }
  }

  // 2. Context multipliers — strongest (furthest from 1.0) per kind.
  for (const kind of ['strategy', 'timeframe', 'direction'] as const) {
    const key = ctx[kind];
    if (!key) continue;
    const stat = snapshot.contexts.find(c => c.kind === kind && c.key.toLowerCase() === String(key).toLowerCase() && c.applied);
    if (!stat || Math.abs(stat.multiplier - 1) < 0.01) continue;
    calibrated *= stat.multiplier;
    reasons.push(`${kind} "${stat.key}": ${stat.expectancyR}R over ${stat.trades} trades → ×${stat.multiplier}`);
  }

  // 3. Bound the result. Learning may cut freely but can only add a few points —
  //    the deterministic engine remains the driver of upside confidence.
  calibrated = Math.min(calibrated, raw + MAX_UPWARD_ADJUST);
  calibrated = Math.max(0, Math.min(100, Math.round(calibrated)));

  return {
    rawConfidence: raw,
    calibratedConfidence: calibrated,
    delta: calibrated - raw,
    reasons,
    active: true,
  };
}

// ─── Trade → outcome mapping ──────────────────────────────────────────────────

/** Turn closed bot trades into the outcome records the engine consumes. */
export function tradesToOutcomes(trades: BotTrade[]): TradeOutcome[] {
  return trades
    .filter(t => t.status === 'closed' && t.pnl !== null && t.pnl !== undefined)
    .map(t => {
      const win = (t.pnl ?? 0) >= 0;
      // R-multiple: a win pays the planned R:R, a loss costs 1R.
      const pnlR = win ? (t.rr ?? 1) : -1;
      return {
        confidence: t.confidence ?? 0,
        win,
        pnlR,
        strategy: t.strategy ?? 'unknown',
        timeframe: t.timeframe ?? 'unknown',
        direction: t.direction ?? 'unknown',
      };
    });
}
