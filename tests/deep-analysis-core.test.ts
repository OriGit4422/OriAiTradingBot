/**
 * Boundary tests for the deterministic half of deep coin analysis.
 *
 * The property that matters most: this must always return a complete, usable
 * trade plan. It is the path taken when the AI layer is unavailable, so if it
 * can throw, produce NaN levels, or emit a stop on the wrong side of entry, the
 * user gets a broken plan at exactly the moment there is no model to catch it.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';

import {
  buildDeepAnalysisPrompt, deterministicDeepAnalysis, directionalVotes, riskUnit,
  type DeepAnalysisInput,
} from '../server/deep-analysis-core';

const bullish = {
  rsi: 58,
  macdSignal: 'BULLISH',
  emaTrend: 'ABOVE',
  marketStructure: 'BULLISH',
  rsiDivergence: 'BULLISH',
  ichimokuSignal: 'BULLISH',
  ensembleDirection: 'LONG',
  ensembleConfidence: 82,
  premiumDiscount: 'DISCOUNT',
  marketPhase: 'MARKUP',
  volumeProfile: 'HIGH',
  trendStrength: 71,
  smcV4Score: 7.5,
  smcV4Grade: 'A',
  liquidityClusters: 4,
  atr: 900,
  strategyDepth: { smc: 80, ict: 65, quantum: 70, liquidity: 60, crt: 55 },
};

const bearish = {
  ...bullish,
  macdSignal: 'BEARISH',
  emaTrend: 'BELOW',
  marketStructure: 'BEARISH',
  rsiDivergence: 'BEARISH',
  ichimokuSignal: 'BEARISH',
  ensembleDirection: 'SHORT',
  premiumDiscount: 'PREMIUM',
};

function input(over: Partial<DeepAnalysisInput> = {}): DeepAnalysisInput {
  return { coin: 'BTC', timeframe: '4h', marketPrice: 64000, indicators: bullish, ...over };
}

describe('directional read', () => {
  test('aligned bullish indicators produce a LONG', () => {
    const r = deterministicDeepAnalysis(input());
    assert.equal(r.direction, 'LONG');
    assert.ok(r.confidence > 50, `confidence ${r.confidence}`);
  });

  test('aligned bearish indicators produce a SHORT', () => {
    const r = deterministicDeepAnalysis(input({ indicators: bearish }));
    assert.equal(r.direction, 'SHORT');
  });

  test('genuinely split indicators produce NEUTRAL, not a coin flip', () => {
    // Saying "no edge" is the honest output. Forcing a direction out of
    // contradictory inputs is how a system manufactures losing trades.
    const split = {
      marketStructure: 'BULLISH',   // +2 long
      emaTrend: 'BELOW',            // -1.5 short
      macdSignal: 'BULLISH',        // +1 long
      ichimokuSignal: 'BEARISH',    // -1 short
      rsiDivergence: 'BEARISH',     // -1.5 short
    };
    const r = deterministicDeepAnalysis(input({ indicators: split }));
    assert.equal(r.direction, 'NEUTRAL');
    assert.ok(r.confidence <= 45, `a NEUTRAL read must not carry a tradeable confidence (${r.confidence})`);
  });

  test('the ensemble is weighted by its own stated confidence', () => {
    const weak = directionalVotes({ ensembleDirection: 'LONG', ensembleConfidence: 30 });
    const strong = directionalVotes({ ensembleDirection: 'LONG', ensembleConfidence: 95 });
    assert.ok(strong[0].weight > weak[0].weight);
  });

  test('RSI extremes vote counter-trend', () => {
    // At the extremes RSI is a mean-reversion signal. Treating 85 as bullish
    // confirmation is how a system buys the top of every move.
    assert.equal(directionalVotes({ rsi: 85 })[0].aligned, 'SHORT');
    assert.equal(directionalVotes({ rsi: 15 })[0].aligned, 'LONG');
    assert.equal(directionalVotes({ rsi: 50 }).length, 0, 'a mid-range RSI is not a vote');
  });

  test('no indicators at all is NEUTRAL, not a crash', () => {
    const r = deterministicDeepAnalysis(input({ indicators: {} }));
    assert.equal(r.direction, 'NEUTRAL');
    assert.ok(r.summary.length > 0);
  });

  test('undefined indicators object is handled', () => {
    const r = deterministicDeepAnalysis({ coin: 'ETH', timeframe: '1h', marketPrice: 3200 });
    assert.equal(r.direction, 'NEUTRAL');
    assert.ok(Number.isFinite(r.stopLoss));
  });
});

describe('levels', () => {
  test('a long puts the stop below entry and the targets above, in order', () => {
    const r = deterministicDeepAnalysis(input());
    assert.ok(r.stopLoss < r.entry, 'long stop must sit below entry');
    assert.ok(r.takeProfit1 > r.entry);
    assert.ok(r.takeProfit2 > r.takeProfit1);
    assert.ok(r.takeProfit3 > r.takeProfit2);
  });

  test('a short inverts every level', () => {
    const r = deterministicDeepAnalysis(input({ indicators: bearish }));
    assert.equal(r.direction, 'SHORT');
    assert.ok(r.stopLoss > r.entry, 'short stop must sit above entry');
    assert.ok(r.takeProfit1 < r.entry);
    assert.ok(r.takeProfit2 < r.takeProfit1);
    assert.ok(r.takeProfit3 < r.takeProfit2);
  });

  test('the primary target meets the 1:2 R:R floor CLAUDE.md sets', () => {
    for (const ind of [bullish, bearish]) {
      const r = deterministicDeepAnalysis(input({ indicators: ind }));
      const rr = Math.abs(r.takeProfit2 - r.entry) / Math.abs(r.entry - r.stopLoss);
      assert.ok(rr >= 2, `R:R came out at 1:${rr.toFixed(2)}`);
    }
  });

  test('every level is finite and positive for a range of prices', () => {
    // Sub-dollar alts and five-figure BTC go through the same rounding path.
    for (const marketPrice of [0.00004512, 0.62, 18.4, 3200, 64000, 118500]) {
      const r = deterministicDeepAnalysis(input({ marketPrice }));
      for (const [name, v] of Object.entries({
        entry: r.entry, stopLoss: r.stopLoss,
        tp1: r.takeProfit1, tp2: r.takeProfit2, tp3: r.takeProfit3,
      })) {
        assert.ok(Number.isFinite(v) && v > 0, `${name} was ${v} at price ${marketPrice}`);
      }
    }
  });

  test('no level is ever placed absurdly far from spot', () => {
    // A wildly oversized ATR must not produce a "stop" 40% away.
    const r = deterministicDeepAnalysis(input({
      indicators: { ...bullish, atr: 40000 },
      marketPrice: 64000,
    }));
    for (const v of [r.stopLoss, r.takeProfit1, r.takeProfit2, r.takeProfit3]) {
      assert.ok(Math.abs(v - 64000) / 64000 <= 0.1201, `level ${v} is outside the ±12% band`);
    }
  });

  test('the adaptive stop from the engine is preferred over a timeframe guess', () => {
    const withDynamic = riskUnit(input({ indicators: { ...bullish, dynamicSL: 512 } }));
    assert.equal(withDynamic, 512);
  });

  test('ATR drives the stop when no adaptive distance was sent', () => {
    const r = riskUnit(input({ indicators: { atr: 800 } }));
    assert.equal(r, 1200, 'expected 1.5x ATR');
  });

  test('timeframe scales the fallback stop when there is no volatility input', () => {
    // A 15m stop and a weekly stop cannot be the same percentage.
    const short = riskUnit(input({ timeframe: '15m', indicators: {} }));
    const long = riskUnit(input({ timeframe: '1w', indicators: {} }));
    assert.ok(long > short * 5, `1w risk ${long} vs 15m risk ${short}`);
  });

  test('an unknown timeframe still yields a sane stop', () => {
    const r = deterministicDeepAnalysis(input({ timeframe: '7h', indicators: {} }));
    assert.ok(Number.isFinite(r.stopLoss) && r.stopLoss > 0);
  });

  test('a zero or negative ATR does not collapse the stop onto entry', () => {
    for (const atr of [0, -5, NaN]) {
      const r = deterministicDeepAnalysis(input({ indicators: { ...bullish, atr } }));
      assert.notEqual(r.stopLoss, r.entry, `stop collapsed onto entry with atr=${atr}`);
    }
  });
});

describe('degraded-result contract', () => {
  test('a deterministic result is labelled as one, with a reason', () => {
    // The UI banner and the honesty of the whole fallback depend on these.
    const r = deterministicDeepAnalysis(input(), 'budget spent');
    assert.equal(r.source, 'deterministic');
    assert.equal(r.degraded, true);
    assert.equal(r.notice, 'budget spent');
    assert.ok(r.warnings.includes('budget spent'), 'the reason must also reach the warnings list');
  });

  test('confidence stays under the AI-reviewed ceiling', () => {
    // The AI veto can only cut confidence, so an unreviewed plan has not passed
    // the same bar and must not present as though it had.
    const r = deterministicDeepAnalysis(input());
    assert.ok(r.confidence <= 78, `unreviewed confidence reached ${r.confidence}`);
  });

  test('every prose field is populated — no empty panels in the UI', () => {
    const r = deterministicDeepAnalysis(input());
    const prose = [
      'smcAnalysis', 'ictAnalysis', 'quantumLiquidityAnalysis', 'newsImpact',
      'socialSentiment', 'technicalAnalysis', 'multiTimeframeAnalysis',
      'tradeRationale', 'riskAssessment', 'invalidation', 'summary',
    ] as const;
    for (const f of prose) {
      assert.ok(typeof r[f] === 'string' && r[f].length > 20, `${f} was "${r[f]}"`);
    }
    assert.ok(r.analysisLogs.length >= 5);
    assert.ok(r.keyLevels.support.length === 3 && r.keyLevels.resistance.length === 3);
  });

  test('conflicting indicators are reported, not hidden', () => {
    const r = deterministicDeepAnalysis(input({
      indicators: { ...bullish, ichimokuSignal: 'BEARISH', rsiDivergence: 'BEARISH' },
    }));
    assert.ok(
      r.confluenceFactors.some(f => f.endsWith(': conflicting')),
      'a plan that omits what disagrees with it is not an analysis',
    );
  });
});

describe('prompt construction', () => {
  test('fields that were never computed are omitted, not sent as undefined', () => {
    // The old prompt printed "RSI: undefined" for every missing value: paid-for
    // input tokens that also invited the model to hedge about absent data.
    const prompt = buildDeepAnalysisPrompt(input({ indicators: { rsi: 61 } }));
    assert.ok(!prompt.includes('undefined'), 'prompt leaked an undefined value');
    assert.ok(prompt.includes('rsi=61'));
    assert.ok(!prompt.includes('macd='), 'an uncomputed field must not appear at all');
  });

  test('the prompt stays small enough to be affordable at $0.05/day', () => {
    // Input tokens are priced on admission, so prompt size directly sets how
    // many analyses fit in a day. A full-context prompt must stay well under
    // the ~4,600 chars the pre-fix version reached.
    const prompt = buildDeepAnalysisPrompt(input({
      recentNews: Array.from({ length: 8 }, (_, i) => `Some fairly long crypto market headline number ${i} that goes on for a while`),
      xSentiment: 'Retail is heavily long with funding elevated across venues',
    }));
    assert.ok(prompt.length < 2200, `prompt is ${prompt.length} chars`);
  });

  test('the news block is bounded however many headlines arrive', () => {
    const many = Array.from({ length: 50 }, (_, i) => `Headline ${i} `.repeat(30));
    const prompt = buildDeepAnalysisPrompt(input({ recentNews: many }));
    assert.ok(prompt.length < 2500, `unbounded news pushed the prompt to ${prompt.length} chars`);
  });

  test('the price and pair the model must anchor to are always present', () => {
    const prompt = buildDeepAnalysisPrompt(input({ coin: 'SOL', marketPrice: 142.55 }));
    assert.ok(prompt.includes('SOL/USDT'));
    assert.ok(prompt.includes('142.55'));
  });
});
