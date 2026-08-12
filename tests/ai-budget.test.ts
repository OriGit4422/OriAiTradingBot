/**
 * Boundary tests for the AI budget governor.
 * Run: npm test
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  admit, commit, priceFor, estimateCostUsd, estimateTokens, extractUsage,
  getBudgetStatus, setDailyBudget, resetLedger, clearCache,
  cacheGet, cacheSet, makeCacheKey, recordCacheHit,
  serializeLedger, restoreLedger, parseDailyBudget, getDailyBudget,
  getMaxCallCostUsd, setMaxCallCostUsd, parsePerCallCap, tierHeadroomUsd,
  recordDowngrade,
} from '../server/ai-budget';

describe('pricing', () => {
  test('matches the longest model prefix, not the first', () => {
    // "gemini-2.0-flash-lite" must not be priced as "gemini-2.0-flash".
    assert.equal(priceFor('gemini-2.0-flash-lite').inPer1M, 0.075);
    assert.equal(priceFor('gemini-2.0-flash').inPer1M, 0.10);
  });

  test('unknown models fall back to the pessimistic default', () => {
    const p = priceFor('some-model-nobody-has-heard-of');
    assert.equal(p.inPer1M, 3.00);
    assert.equal(p.outPer1M, 15.00);
  });

  test('empty model id does not throw', () => {
    assert.ok(priceFor('').inPer1M > 0);
  });

  test('cost is linear in both token directions', () => {
    // 1M in + 1M out on gpt-4o = 2.50 + 10.00
    assert.equal(Math.round(estimateCostUsd('gpt-4o', 1e6, 1e6) * 100) / 100, 12.5);
    assert.equal(estimateCostUsd('gpt-4o', 0, 0), 0);
  });

  test('token estimate handles empty and undefined text', () => {
    assert.equal(estimateTokens(''), 0);
    assert.equal(estimateTokens(undefined as unknown as string), 0);
    assert.equal(estimateTokens('abcd'), 1);
  });
});

describe('admission control', () => {
  beforeEach(() => {
    resetLedger();
    clearCache();
    setDailyBudget(0.05);
  });

  test('admits a cheap call against an empty ledger', () => {
    const v = admit({ provider: 'Gemini', model: 'gemini-2.0-flash', tier: 'critical', promptChars: 400, maxOutTokens: 120 });
    assert.equal(v.allowed, true);
    assert.ok(v.estCostUsd > 0);
  });

  test('cosmetic calls are cut off at 35% while critical still passes', () => {
    // Spend just past 35% of the $0.05 budget: $0.0175.
    // gpt-4o output is $10/1M, so 2000 output tokens = $0.02.
    commit({ provider: 'X', model: 'gpt-4o', tokensIn: 0, tokensOut: 2000 });

    const cosmetic = admit({ provider: 'X', model: 'gpt-4o', tier: 'cosmetic', promptChars: 40, maxOutTokens: 10 });
    const critical = admit({ provider: 'X', model: 'gpt-4o', tier: 'critical', promptChars: 40, maxOutTokens: 10 });

    assert.equal(cosmetic.allowed, false, 'cosmetic must be blocked past its ceiling');
    assert.match(cosmetic.reason ?? '', /budget guard/i);
    assert.equal(critical.allowed, true, 'critical must still get through');
  });

  test('blocks every tier once the full budget is consumed', () => {
    commit({ provider: 'X', model: 'gpt-4o', tokensIn: 0, tokensOut: 6000 }); // $0.06 > $0.05
    for (const tier of ['cosmetic', 'normal', 'critical'] as const) {
      assert.equal(admit({ provider: 'X', model: 'gpt-4o', tier, promptChars: 10, maxOutTokens: 5 }).allowed, false);
    }
  });

  test('budgets are tracked per provider, not globally', () => {
    commit({ provider: 'Expensive', model: 'gpt-4o', tokensIn: 0, tokensOut: 6000 });
    assert.equal(admit({ provider: 'Expensive', model: 'gpt-4o', tier: 'critical', promptChars: 10, maxOutTokens: 5 }).allowed, false);
    assert.equal(admit({ provider: 'Fresh', model: 'gpt-4o', tier: 'critical', promptChars: 10, maxOutTokens: 5 }).allowed, true);
  });

  test('admission prices the worst case, not the expected case', () => {
    // Both calls below sit under the per-call cap, so the tier ceiling is what
    // decides them — and it decides on maxOutTokens, not on what the model would
    // most likely return. gemini-2.0-flash output is $0.40/1M.
    commit({ provider: 'Y', model: 'gemini-2.0-flash', tokensIn: 0, tokensOut: 112500 }); // $0.045

    const small = admit({ provider: 'Y', model: 'gemini-2.0-flash', tier: 'critical', promptChars: 0, maxOutTokens: 2000 });
    assert.equal(small.allowed, true, '$0.0008 on top of $0.045 still fits the $0.05 day');

    const large = admit({ provider: 'Y', model: 'gemini-2.0-flash', tier: 'critical', promptChars: 0, maxOutTokens: 20000 });
    assert.equal(large.allowed, false, 'a call that *could* exceed the cap must be refused up front');
  });

  test('no single call may reserve more than the per-call cap', () => {
    // The regression this guards: deep-coin-analysis asked for 1,100 output
    // tokens on a premium model — ~$0.018, more than the whole cosmetic ceiling.
    // It was refused on a completely fresh ledger, so the feature could never
    // work at any hour of any day, and the refusal surfaced to the user as a 500.
    const cap = getMaxCallCostUsd();
    assert.ok(cap > 0 && cap < getDailyBudget(), `per-call cap $${cap} must sit under the daily budget`);

    const tooBig = admit({ provider: 'Fresh', model: 'claude-sonnet-4-6', tier: 'critical', promptChars: 2000, maxOutTokens: 1100 });
    assert.equal(tooBig.allowed, false, 'an oversized call must be refused even on an empty ledger');
    assert.match(tooBig.reason ?? '', /per-call cap/i);

    // The same call on the economy model is ~30x cheaper and sails through.
    const economy = admit({ provider: 'Fresh', model: 'gemini-2.0-flash-lite', tier: 'normal', promptChars: 2000, maxOutTokens: 1100 });
    assert.equal(economy.allowed, true, 'the cheap model must fit comfortably inside the cap');
  });

  test('blocked calls are counted', () => {
    commit({ provider: 'Z', model: 'gpt-4o', tokensIn: 0, tokensOut: 6000 });
    admit({ provider: 'Z', model: 'gpt-4o', tier: 'normal', promptChars: 10, maxOutTokens: 5 });
    admit({ provider: 'Z', model: 'gpt-4o', tier: 'normal', promptChars: 10, maxOutTokens: 5 });
    const p = getBudgetStatus().providers.find(p => p.provider === 'Z');
    assert.equal(p?.blocked, 2);
  });

  test('a zero-token response still counts as a call', () => {
    commit({ provider: 'W', model: 'gemini-2.0-flash', tokensIn: 0, tokensOut: 0 });
    const p = getBudgetStatus().providers.find(p => p.provider === 'W');
    assert.equal(p?.calls, 1);
    assert.equal(p?.spendUsd, 0);
  });
});

describe('response cache', () => {
  beforeEach(() => { resetLedger(); clearCache(); });

  test('identical inputs produce the same key, different inputs do not', () => {
    const a = makeCacheKey(['Gemini', 'm', 100, 0.1, [{ role: 'user', content: 'hi' }]]);
    const b = makeCacheKey(['Gemini', 'm', 100, 0.1, [{ role: 'user', content: 'hi' }]]);
    const c = makeCacheKey(['Gemini', 'm', 100, 0.1, [{ role: 'user', content: 'ho' }]]);
    assert.equal(a, b);
    assert.notEqual(a, c);
  });

  test('entries expire', () => {
    const k = makeCacheKey(['x']);
    cacheSet(k, { text: 'v', provider: 'P', model: 'm', estCostUsd: 0.001 }, 1);
    assert.ok(cacheGet(k));
    // Expire by moving past the TTL.
    const realNow = Date.now;
    Date.now = () => realNow() + 50;
    try {
      assert.equal(cacheGet(k), null);
    } finally {
      Date.now = realNow;
    }
  });

  test('a zero TTL stores nothing', () => {
    const k = makeCacheKey(['zero']);
    cacheSet(k, { text: 'v', provider: 'P', model: 'm', estCostUsd: 0 }, 0);
    assert.equal(cacheGet(k), null);
  });

  test('cache hits accumulate the money they saved', () => {
    recordCacheHit('Gemini', 0.002);
    recordCacheHit('Gemini', 0.003);
    const s = getBudgetStatus();
    assert.equal(s.providers.find(p => p.provider === 'Gemini')?.cacheHits, 2);
    assert.equal(s.savedByCacheUsd, 0.005);
  });
});

describe('usage extraction', () => {
  test('reads Gemini usageMetadata', () => {
    const u = extractUsage({ usageMetadata: { promptTokenCount: 120, candidatesTokenCount: 40 } }, 0, '');
    assert.deepEqual(u, { tokensIn: 120, tokensOut: 40, measured: true });
  });

  test('reads OpenAI usage', () => {
    const u = extractUsage({ usage: { prompt_tokens: 10, completion_tokens: 3 } }, 0, '');
    assert.deepEqual(u, { tokensIn: 10, tokensOut: 3, measured: true });
  });

  test('reads Anthropic usage', () => {
    const u = extractUsage({ usage: { input_tokens: 7, output_tokens: 2 } }, 0, '');
    assert.deepEqual(u, { tokensIn: 7, tokensOut: 2, measured: true });
  });

  test('falls back to estimation and says so', () => {
    const u = extractUsage({}, 400, 'abcd');
    assert.equal(u.measured, false);
    assert.equal(u.tokensIn, 100);
    assert.equal(u.tokensOut, 1);
  });
});

describe('ledger persistence', () => {
  beforeEach(() => { resetLedger(); });

  test('round-trips a same-day snapshot', () => {
    commit({ provider: 'Gemini', model: 'gemini-2.0-flash', tokensIn: 1000, tokensOut: 100 });
    const snap = serializeLedger();
    resetLedger();
    assert.equal(getBudgetStatus().totalSpendUsd, 0);
    assert.equal(restoreLedger(snap), true);
    assert.ok(getBudgetStatus().totalSpendUsd > 0);
  });

  test('refuses a snapshot from a previous day', () => {
    commit({ provider: 'Gemini', model: 'gemini-2.0-flash', tokensIn: 1000, tokensOut: 100 });
    const snap = serializeLedger();
    resetLedger();
    assert.equal(restoreLedger({ ...snap, day: '2000-01-01' }), false);
    assert.equal(getBudgetStatus().totalSpendUsd, 0);
  });

  test('refuses null or malformed snapshots', () => {
    assert.equal(restoreLedger(null), false);
    assert.equal(restoreLedger({ day: new Date().toISOString().slice(0, 10) }), false);
  });
});

describe('budget cap fails closed', () => {
  test('a malformed AI_DAILY_BUDGET_USD falls back to the default', () => {
    // Number('abc') is NaN, and `spend + cost > NaN` is false — a typo here used
    // to switch the daily cap off entirely rather than tightening it.
    for (const bad of ['abc', '', '   ', 'null', '-1', '0', 'NaN', undefined]) {
      const v = parseDailyBudget(bad as string | undefined);
      assert.ok(Number.isFinite(v) && v > 0, `parseDailyBudget(${JSON.stringify(bad)}) = ${v}`);
    }
  });

  test('a valid value is used as given', () => {
    assert.equal(parseDailyBudget('0.02'), 0.02);
    assert.equal(parseDailyBudget('1'), 1);
  });

  test('a non-finite ceiling refuses the call instead of admitting it', () => {
    resetLedger();
    setDailyBudget(0.05);
    // Drive the cost estimate itself non-finite.
    const verdict = admit({
      provider: 'X', model: 'gpt-4o', tier: 'critical',
      promptChars: Number.POSITIVE_INFINITY, maxOutTokens: 10,
    });
    assert.equal(verdict.allowed, false);
  });

  test('setDailyBudget rejects values that would disable the cap', () => {
    resetLedger();
    setDailyBudget(0.03);
    setDailyBudget(NaN);
    setDailyBudget(-5);
    setDailyBudget(0);
    assert.equal(getBudgetStatus().dailyBudgetUsd, 0.03, 'a bad value overwrote a good cap');
  });
});
