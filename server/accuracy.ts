/**
 * Accuracy reporting — one honest view of how well the engine actually predicts.
 *
 * Everything here is derived from realized outcomes. No AI calls, no estimates,
 * no "projected" numbers. When there is not enough data to say something, the
 * field is null and `sampleSize` says why, rather than a confident-looking zero.
 *
 * Metrics:
 *   hitRate      — closed trades that finished in profit
 *   expectancyR  — average R per trade; the number that decides whether the
 *                  edge is real. A 70% hit rate at -0.3R expectancy is a losing
 *                  system, so hit rate alone is never shown without it.
 *   brierScore   — mean squared error of the confidence-as-probability claim.
 *                  0.0 perfect, 0.25 = a coin flip. This is the direct measure
 *                  of whether the confidence numbers mean anything.
 *   calibration  — predicted vs realized per confidence bucket.
 *   breakdowns   — the same metrics split by timeframe, strategy, direction and
 *                  coin, so a losing slice cannot hide inside a winning average.
 */

import { storage } from './storage';
import {
  getLearningSnapshot, MIN_CONTEXT_SAMPLES,
  type LearningSnapshot,
} from './agents/learning-engine';
import { getBudgetStatus } from './ai-budget';
import type { BotTrade } from '@shared/schema';

export interface AccuracySlice {
  key: string;
  trades: number;
  wins: number;
  hitRate: number;
  expectancyR: number;
  totalPnlUsd: number;
  /** False when the slice is too small to draw a conclusion from. */
  significant: boolean;
}

export interface AccuracyReport {
  generatedAt: string;
  sampleSize: number;
  /** Trades still open — excluded from every accuracy figure below. */
  openTrades: number;
  headline: {
    hitRate: number | null;
    expectancyR: number | null;
    brierScore: number | null;
    totalPnlUsd: number;
    profitFactor: number | null;
    avgWinR: number | null;
    avgLossR: number | null;
    maxConsecutiveLosses: number;
  };
  calibration: LearningSnapshot['calibration'];
  learning: {
    active: boolean;
    notes: string[];
    appliedContexts: Array<{ kind: string; key: string; multiplier: number; trades: number }>;
  };
  byTimeframe: AccuracySlice[];
  byStrategy: AccuracySlice[];
  byDirection: AccuracySlice[];
  byCoin: AccuracySlice[];
  aiSpend: ReturnType<typeof getBudgetStatus>;
  /** Plain-language read of the numbers above. */
  verdict: string;
}

function sliceStats(key: string, trades: BotTrade[]): AccuracySlice {
  const wins = trades.filter(t => (t.pnl ?? 0) >= 0).length;
  const rTotal = trades.reduce((s, t) => s + ((t.pnl ?? 0) >= 0 ? (t.rr ?? 1) : -1), 0);
  return {
    key,
    trades: trades.length,
    wins,
    hitRate: trades.length ? Math.round((wins / trades.length) * 1000) / 1000 : 0,
    expectancyR: trades.length ? Math.round((rTotal / trades.length) * 100) / 100 : 0,
    totalPnlUsd: Math.round(trades.reduce((s, t) => s + (t.pnl ?? 0), 0) * 100) / 100,
    significant: trades.length >= MIN_CONTEXT_SAMPLES,
  };
}

function groupBy(trades: BotTrade[], keyOf: (t: BotTrade) => string): AccuracySlice[] {
  const map = new Map<string, BotTrade[]>();
  for (const t of trades) {
    const k = (keyOf(t) || 'unknown').trim() || 'unknown';
    const list = map.get(k) ?? [];
    list.push(t);
    map.set(k, list);
  }
  return [...map.entries()]
    .map(([k, list]) => sliceStats(k, list))
    .sort((a, b) => b.trades - a.trades);
}

function maxConsecutiveLosses(trades: BotTrade[]): number {
  const chrono = [...trades].sort(
    (a, b) => new Date(a.closedAt ?? a.createdAt).getTime() - new Date(b.closedAt ?? b.createdAt).getTime(),
  );
  let run = 0;
  let worst = 0;
  for (const t of chrono) {
    if ((t.pnl ?? 0) < 0) { run++; worst = Math.max(worst, run); }
    else run = 0;
  }
  return worst;
}

function buildVerdict(r: Omit<AccuracyReport, 'verdict'>): string {
  if (r.sampleSize === 0) {
    return 'No closed trades yet. Every accuracy figure is empty until trades close — nothing here is projected or simulated.';
  }
  if (r.sampleSize < MIN_CONTEXT_SAMPLES) {
    return `Only ${r.sampleSize} closed trades. That is too few to measure an edge; treat these numbers as provisional and keep size small.`;
  }

  const parts: string[] = [];
  const exp = r.headline.expectancyR;
  const brier = r.headline.brierScore;

  if (exp !== null) {
    parts.push(
      exp > 0.1 ? `Positive expectancy at ${exp}R per trade over ${r.sampleSize} trades.`
      : exp < -0.1 ? `Negative expectancy at ${exp}R per trade — the edge is not there yet over ${r.sampleSize} trades.`
      : `Expectancy is flat (${exp}R) — currently a break-even system before costs.`,
    );
  }
  if (brier !== null) {
    parts.push(
      brier <= 0.18 ? `Confidence scores are well calibrated (Brier ${brier}).`
      : brier <= 0.25 ? `Confidence scores are weakly informative (Brier ${brier}; 0.25 is a coin flip).`
      : `Confidence scores are worse than a coin flip (Brier ${brier}) — the learning layer is discounting them.`,
    );
  }

  const worstSlice = [...r.byStrategy, ...r.byTimeframe]
    .filter(s => s.significant)
    .sort((a, b) => a.expectancyR - b.expectancyR)[0];
  if (worstSlice && worstSlice.expectancyR < -0.15) {
    parts.push(`Weakest slice: "${worstSlice.key}" at ${worstSlice.expectancyR}R over ${worstSlice.trades} trades — consider disabling it.`);
  }

  return parts.join(' ');
}

export async function buildAccuracyReport(): Promise<AccuracyReport> {
  const all = await storage.getBotTrades(1000);
  const closed = all.filter(t => t.status === 'closed' && t.pnl !== null && t.pnl !== undefined);
  const open = all.filter(t => t.status === 'open').length;

  const snapshot = await getLearningSnapshot();

  const wins = closed.filter(t => (t.pnl ?? 0) >= 0);
  const losses = closed.filter(t => (t.pnl ?? 0) < 0);
  const grossWin = wins.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const grossLoss = Math.abs(losses.reduce((s, t) => s + (t.pnl ?? 0), 0));

  const base: Omit<AccuracyReport, 'verdict'> = {
    generatedAt: new Date().toISOString(),
    sampleSize: closed.length,
    openTrades: open,
    headline: {
      hitRate: closed.length ? Math.round((wins.length / closed.length) * 1000) / 1000 : null,
      expectancyR: snapshot.expectancyR,
      brierScore: snapshot.brierScore,
      totalPnlUsd: Math.round(closed.reduce((s, t) => s + (t.pnl ?? 0), 0) * 100) / 100,
      profitFactor: grossLoss > 0 ? Math.round((grossWin / grossLoss) * 100) / 100 : null,
      avgWinR: wins.length ? Math.round((wins.reduce((s, t) => s + (t.rr ?? 1), 0) / wins.length) * 100) / 100 : null,
      avgLossR: losses.length ? -1 : null,
      maxConsecutiveLosses: maxConsecutiveLosses(closed),
    },
    calibration: snapshot.calibration,
    learning: {
      active: snapshot.active,
      notes: snapshot.notes,
      appliedContexts: snapshot.contexts
        .filter(c => c.applied && Math.abs(c.multiplier - 1) >= 0.01)
        .map(c => ({ kind: c.kind, key: c.key, multiplier: c.multiplier, trades: c.trades })),
    },
    byTimeframe: groupBy(closed, t => t.timeframe ?? 'unknown'),
    byStrategy: groupBy(closed, t => t.strategy ?? 'unknown'),
    byDirection: groupBy(closed, t => t.direction ?? 'unknown'),
    byCoin: groupBy(closed, t => t.symbol ?? 'unknown').slice(0, 15),
    aiSpend: getBudgetStatus(),
  };

  return { ...base, verdict: buildVerdict(base) };
}
