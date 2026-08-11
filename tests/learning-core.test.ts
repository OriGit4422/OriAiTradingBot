/**
 * Boundary tests for the learning engine.
 *
 * The safety properties matter more than the happy path here: this code adjusts
 * the confidence attached to real money, so the tests pin down that it cannot
 * run away upward, cannot act on a tiny sample, and cannot invert the ordering
 * of confidence buckets.
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  isotonic, buildSnapshot, applyLearning, tradesToOutcomes,
  MIN_SAMPLES, MIN_CONTEXT_SAMPLES, MAX_UPWARD_ADJUST, MAX_CONTEXT_ADJUST,
  type TradeOutcome,
} from '../server/agents/learning-core';

function makeOutcomes(spec: Array<Partial<TradeOutcome> & { n: number; win: boolean }>): TradeOutcome[] {
  const out: TradeOutcome[] = [];
  for (const s of spec) {
    for (let i = 0; i < s.n; i++) {
      out.push({
        confidence: s.confidence ?? 70,
        win: s.win,
        pnlR: s.pnlR ?? (s.win ? 2 : -1),
        strategy: s.strategy ?? 'SMC',
        timeframe: s.timeframe ?? '1h',
        direction: s.direction ?? 'LONG',
      });
    }
  }
  return out;
}

describe('isotonic regression', () => {
  test('leaves an already-increasing sequence alone', () => {
    assert.deepEqual(isotonic([1, 2, 3], [1, 1, 1]), [1, 2, 3]);
  });

  test('pools a violation into its weighted average', () => {
    const r = isotonic([1, 3, 2], [1, 1, 1]);
    assert.deepEqual(r, [1, 2.5, 2.5]);
  });

  test('output is never decreasing, whatever the input', () => {
    const vals = [0.9, 0.2, 0.7, 0.1, 0.5, 0.4];
    const r = isotonic(vals, vals.map(() => 1));
    for (let i = 1; i < r.length; i++) {
      assert.ok(r[i] >= r[i - 1] - 1e-9, `index ${i} decreased: ${r}`);
    }
  });

  test('weights bias the pooled value toward the heavier bucket', () => {
    const r = isotonic([1, 0], [1, 99]);
    assert.ok(r[0] < 0.05, `expected the heavy 0 to dominate, got ${r[0]}`);
  });

  test('handles the empty and single-element cases', () => {
    assert.deepEqual(isotonic([], []), []);
    assert.deepEqual(isotonic([0.5], [3]), [0.5]);
  });

  test('zero weights do not produce NaN', () => {
    const r = isotonic([1, 0], [0, 0]);
    assert.ok(r.every(Number.isFinite), `got ${r}`);
  });
});

describe('snapshot construction', () => {
  test('an empty book is inactive and reports no metrics', () => {
    const s = buildSnapshot([]);
    assert.equal(s.active, false);
    assert.equal(s.sampleSize, 0);
    assert.equal(s.brierScore, null);
    assert.equal(s.overallWinRate, null);
    assert.match(s.notes.join(' '), /Learning inactive/);
  });

  test('stays inactive one trade below the threshold', () => {
    const s = buildSnapshot(makeOutcomes([{ n: MIN_SAMPLES - 1, win: true }]));
    assert.equal(s.active, false);
  });

  test('activates exactly at the threshold', () => {
    const s = buildSnapshot(makeOutcomes([{ n: MIN_SAMPLES, win: true }]));
    assert.equal(s.active, true);
  });

  test('calibrated win rates never decrease across buckets', () => {
    // Deliberately inverted reality: the high bucket loses, the low bucket wins.
    const s = buildSnapshot(makeOutcomes([
      { n: 30, win: true, confidence: 55 },
      { n: 30, win: false, confidence: 90 },
    ]));
    const rates = s.calibration.map(b => b.calibratedWinRate ?? 0);
    for (let i = 1; i < rates.length; i++) {
      assert.ok(rates[i] >= rates[i - 1] - 1e-9, `bucket ${i} inverted: ${rates}`);
    }
  });

  test('shrinkage keeps a tiny bucket close to its predicted rate', () => {
    // Two wins at 70% should not push the bucket to 100%.
    const s = buildSnapshot(makeOutcomes([
      { n: 2, win: true, confidence: 70 },
      { n: MIN_SAMPLES, win: false, confidence: 55 },
    ]));
    const b = s.calibration.find(b => b.min === 70)!;
    assert.ok((b.calibratedWinRate ?? 0) < 0.85, `expected shrinkage, got ${b.calibratedWinRate}`);
  });

  test('a perfect predictor scores a near-zero Brier', () => {
    const s = buildSnapshot(makeOutcomes([
      { n: 25, win: true, confidence: 100 },
      { n: 25, win: false, confidence: 0 },
    ]));
    assert.equal(s.brierScore, 0);
  });

  test('an always-wrong predictor scores the worst Brier', () => {
    const s = buildSnapshot(makeOutcomes([{ n: 25, win: false, confidence: 100 }]));
    assert.equal(s.brierScore, 1);
  });

  test('context multipliers stay inside the hard bound', () => {
    const s = buildSnapshot(makeOutcomes([
      { n: 60, win: true, pnlR: 5, strategy: 'Great' },
      { n: 60, win: false, pnlR: -1, strategy: 'Awful' },
    ]));
    for (const c of s.contexts) {
      assert.ok(
        c.multiplier >= 1 - MAX_CONTEXT_ADJUST - 1e-9 && c.multiplier <= 1 + MAX_CONTEXT_ADJUST + 1e-9,
        `${c.kind}/${c.key} multiplier out of bounds: ${c.multiplier}`,
      );
    }
  });

  test('a context below the sample floor is not applied', () => {
    const s = buildSnapshot(makeOutcomes([
      { n: MIN_SAMPLES, win: true, strategy: 'Main' },
      { n: MIN_CONTEXT_SAMPLES - 1, win: false, strategy: 'Rare' },
    ]));
    const rare = s.contexts.find(c => c.key === 'Rare')!;
    assert.equal(rare.applied, false);
  });
});

describe('applyLearning', () => {
  test('is the identity when the engine is inactive', () => {
    const snap = buildSnapshot(makeOutcomes([{ n: 3, win: true }]));
    const r = applyLearning(75, { strategy: 'SMC', timeframe: '1h', direction: 'LONG' }, snap);
    assert.equal(r.calibratedConfidence, 75);
    assert.equal(r.delta, 0);
    assert.equal(r.active, false);
  });

  test('is the identity when there is no snapshot at all', () => {
    const r = applyLearning(75, {}, null);
    assert.equal(r.calibratedConfidence, 75);
    assert.equal(r.active, false);
  });

  test('cuts confidence hard when the bucket has been losing', () => {
    const snap = buildSnapshot(makeOutcomes([{ n: 60, win: false, confidence: 78, pnlR: -1 }]));
    const r = applyLearning(78, { strategy: 'SMC', timeframe: '1h', direction: 'LONG' }, snap);
    assert.ok(r.delta < 0, `expected a cut, got ${r.delta}`);
    assert.ok(r.reasons.length > 0);
  });

  test('never adds more than MAX_UPWARD_ADJUST, even when everything is winning', () => {
    const snap = buildSnapshot(makeOutcomes([{ n: 200, win: true, confidence: 52, pnlR: 5 }]));
    const r = applyLearning(52, { strategy: 'SMC', timeframe: '1h', direction: 'LONG' }, snap);
    assert.ok(r.delta <= MAX_UPWARD_ADJUST, `delta ${r.delta} exceeded the upward cap`);
  });

  test('output is always a valid confidence', () => {
    const snap = buildSnapshot(makeOutcomes([{ n: 60, win: false, confidence: 90, pnlR: -1 }]));
    for (const raw of [-50, 0, 1, 50, 99, 100, 150]) {
      const r = applyLearning(raw, { strategy: 'SMC' }, snap);
      assert.ok(r.calibratedConfidence >= 0 && r.calibratedConfidence <= 100, `raw ${raw} → ${r.calibratedConfidence}`);
      assert.ok(Number.isInteger(r.calibratedConfidence));
    }
  });

  test('an unknown context is ignored rather than throwing', () => {
    const snap = buildSnapshot(makeOutcomes([{ n: 60, win: true, confidence: 70 }]));
    const r = applyLearning(70, { strategy: 'NeverSeenBefore', timeframe: '9h', direction: 'SIDEWAYS' }, snap);
    assert.ok(Number.isFinite(r.calibratedConfidence));
  });

  test('context matching is case-insensitive', () => {
    const snap = buildSnapshot(makeOutcomes([
      { n: 60, win: false, confidence: 70, strategy: 'SMC Breakout', pnlR: -1 },
      { n: 60, win: true, confidence: 70, strategy: 'Other', pnlR: 3 },
    ]));
    const lower = applyLearning(70, { strategy: 'smc breakout' }, snap);
    const exact = applyLearning(70, { strategy: 'SMC Breakout' }, snap);
    assert.equal(lower.calibratedConfidence, exact.calibratedConfidence);
  });
});

describe('tradesToOutcomes', () => {
  const base = {
    id: 'x', signalId: null, exchange: 'bybit', mode: 'paper', symbol: 'BTCUSDT',
    direction: 'LONG', timeframe: '1h', strategy: 'SMC', entry: 100, stopLoss: 99,
    tp1: null, tp2: null, tp3: null, positionSize: 1, leverage: 1, marginUsed: 0,
    riskAmount: 0, walletBefore: 0, walletAfter: 0, grade: 'A', confidence: 75,
    rr: 2, exitPrice: 101, exitReason: 'tp', createdAt: new Date(), closedAt: new Date(),
  } as any;

  test('ignores open trades', () => {
    assert.equal(tradesToOutcomes([{ ...base, status: 'open', pnl: null }]).length, 0);
  });

  test('a win pays the planned R and a loss costs exactly 1R', () => {
    const [win] = tradesToOutcomes([{ ...base, status: 'closed', pnl: 10 }]);
    const [loss] = tradesToOutcomes([{ ...base, status: 'closed', pnl: -10 }]);
    assert.equal(win.pnlR, 2);
    assert.equal(loss.pnlR, -1);
  });

  test('break-even counts as a win, not a loss', () => {
    const [flat] = tradesToOutcomes([{ ...base, status: 'closed', pnl: 0 }]);
    assert.equal(flat.win, true);
  });

  test('missing rr defaults to 1R rather than NaN', () => {
    const [o] = tradesToOutcomes([{ ...base, status: 'closed', pnl: 5, rr: null }]);
    assert.equal(o.pnlR, 1);
  });

  test('missing metadata becomes "unknown" instead of undefined', () => {
    const [o] = tradesToOutcomes([{ ...base, status: 'closed', pnl: 5, strategy: null, timeframe: null }]);
    assert.equal(o.strategy, 'unknown');
    assert.equal(o.timeframe, 'unknown');
  });
});
