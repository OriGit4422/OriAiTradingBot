/**
 * Boundary tests for the AI provider layer.
 *
 * The property that matters most here is the one that took the app down: a
 * failing provider must surface its error to the caller and MUST NOT leave an
 * unhandled rejection behind. Node's default --unhandled-rejections=throw turns
 * a stray one into a process exit, which for a trading bot means dropping the
 * engine while positions are open.
 *
 * Run: npm test
 */
import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';

import {
  resolveGeminiModel, isModelNotFound, noteRetiredModel, clearRetiredModels,
  isRetryableError, resolveOptions, GEMINI_FALLBACK_MODEL, parseJson, extractJson,
  chooseModel, economyModelFor, ECONOMY_MODELS, parseEconomyMode,
} from '../server/ai-providers-core';
import { setInFlight, getInFlight, clearCache, estimateCostUsd } from '../server/ai-budget';

describe('economy model routing', () => {
  const gemini = { type: 'gemini' as const };
  const anthropic = { type: 'anthropic' as const };
  const openai = { type: 'custom' as const, baseUrl: 'https://api.openai.com/v1' };

  test('the default mode prefers the cheap model even when the budget is untouched', () => {
    // This is the setting that turns ~7 analyses a day into ~215. The prompts
    // are short and structured, so the premium model buys nothing here.
    const choice = chooseModel({
      config: gemini,
      requested: 'gemini-2.5-pro',
      promptChars: 2000,
      maxOutTokens: 650,
      capUsd: 999,
    });
    assert.equal(choice.model, ECONOMY_MODELS.gemini);
    assert.equal(choice.downgradedFrom, 'gemini-2.5-pro');
  });

  test('economy mode "off" honours the configured model whatever it costs', () => {
    const choice = chooseModel({
      config: anthropic,
      requested: 'claude-opus-4',
      promptChars: 5000,
      maxOutTokens: 4000,
      capUsd: 0.0001,
      mode: 'off',
    });
    assert.equal(choice.model, 'claude-opus-4');
    assert.equal(choice.downgradedFrom, undefined);
  });

  test('economy mode "auto" leaves an affordable configured model alone', () => {
    // Under 'auto' nothing is swapped while there is room, so a user who chose a
    // specific model keeps it until the budget genuinely binds.
    const choice = chooseModel({
      config: anthropic,
      requested: 'claude-sonnet-4-6',
      promptChars: 400,
      maxOutTokens: 100,
      capUsd: 0.01,
      mode: 'auto',
    });
    assert.equal(choice.model, 'claude-sonnet-4-6');
    assert.equal(choice.downgradedFrom, undefined);
  });

  test('the mode parsed from the environment defaults to "always"', () => {
    assert.equal(parseEconomyMode(undefined), 'always');
    assert.equal(parseEconomyMode(''), 'always');
    assert.equal(parseEconomyMode('nonsense'), 'always', 'an unusable value must not disable cost control');
    assert.equal(parseEconomyMode('AUTO'), 'auto');
    assert.equal(parseEconomyMode(' off '), 'off');
  });

  test('a call too expensive for the remaining budget moves to the cheap model', () => {
    // The exact shape of the reported bug: ~1,100 output tokens on a premium
    // model against a $0.0175 tier ceiling.
    const choice = chooseModel({
      config: anthropic,
      requested: 'claude-sonnet-4-6',
      promptChars: 2000,
      maxOutTokens: 1100,
      capUsd: 0.01,
    });
    assert.equal(choice.model, ECONOMY_MODELS.anthropic);
    assert.equal(choice.downgradedFrom, 'claude-sonnet-4-6');
    assert.ok(choice.estCostUsd < 0.01, `downgraded call still costs $${choice.estCostUsd}`);
  });

  test('a downgrade lands on a model that affords a real working day', () => {
    // A downgrade that only just squeezed under the cap would still leave one or
    // two calls a day. These are the numbers that decide whether the app is
    // usable at $0.05/day, so they are asserted rather than assumed.
    const promptChars = 2000;
    const maxOut = 650;
    for (const [config, requested] of [
      [openai, 'gpt-4o'],
      [anthropic, 'claude-sonnet-4-6'],
      [gemini, 'gemini-2.5-pro'],
    ] as const) {
      // Pinned to 'auto' so the downgrade below is driven by the budget not
      // fitting, rather than by the default mode swapping unconditionally —
      // otherwise this would assert nothing.
      const choice = chooseModel({ config, requested, promptChars, maxOutTokens: maxOut, capUsd: 0.005, mode: 'auto' });
      assert.ok(choice.downgradedFrom, `${requested} should not fit a $0.005 budget`);
      const callsPerDay = 0.05 / choice.estCostUsd;
      assert.ok(callsPerDay >= 10, `${choice.model} only affords ${callsPerDay.toFixed(1)} calls/day`);
    }
  });

  test('a day of deep analyses fits the $0.05 cap on every economy model', () => {
    // The headline claim of this mechanism. A deep analysis is ~2,000 prompt
    // chars in and 650 tokens out.
    //
    // The floor is 15/day rather than something larger because the providers are
    // not comparable: Anthropic's cheapest model is roughly 15x the price of
    // Google's, so $0.05 buys ~16 analyses there against ~250 on Gemini. That is
    // Anthropic's pricing, not a defect — and it is exactly why
    // getActiveProviders puts Gemini first and treats the rest as fallbacks.
    const DAILY_CAP = 0.05;
    const perCall = (model: string) => estimateCostUsd(model, Math.ceil(2000 / 4), 650);

    for (const model of Object.values(ECONOMY_MODELS)) {
      const perDay = DAILY_CAP / perCall(model);
      assert.ok(perDay >= 15, `${model} only affords ${perDay.toFixed(1)} analyses/day`);
    }

    // The primary provider has to afford heavy use, not merely survive.
    const geminiPerDay = DAILY_CAP / perCall(ECONOMY_MODELS.gemini);
    assert.ok(geminiPerDay >= 100, `primary provider affords only ${geminiPerDay.toFixed(0)} analyses/day`);
  });

  test('routing tightens as the day fills, instead of failing at the end of it', () => {
    // capUsd is the *smaller* of the per-call cap and what is left at this tier,
    // so a mid-priced model that fits early stops fitting once headroom shrinks —
    // and the feature keeps working on the cheap model rather than going dark.
    const args = { config: gemini, requested: 'gemini-2.5-pro', promptChars: 2000, maxOutTokens: 650, mode: 'auto' as const };

    const earlyInDay = chooseModel({ ...args, capUsd: 0.01 });
    assert.equal(earlyInDay.model, 'gemini-2.5-pro', 'an affordable model is used while there is room');

    const nearlySpent = chooseModel({ ...args, capUsd: 0.001 });
    assert.equal(nearlySpent.model, ECONOMY_MODELS.gemini, 'a tight budget must downgrade, not refuse');
    assert.ok(nearlySpent.estCostUsd <= 0.001, `still over budget at $${nearlySpent.estCostUsd}`);
  });

  test('an unknown custom endpoint is never rewritten', () => {
    // A self-hosted OpenAI-compatible server exposes its own model names.
    // Substituting gpt-4o-mini there turns a budget problem into a 404, which
    // is strictly worse than refusing the call.
    const selfHosted = { type: 'custom' as const, baseUrl: 'https://llm.internal.example/v1' };
    assert.equal(economyModelFor(selfHosted), null);

    const choice = chooseModel({
      config: selfHosted,
      requested: 'some-local-70b',
      promptChars: 5000,
      maxOutTokens: 1500,
      capUsd: 0.0001,
    });
    assert.equal(choice.model, 'some-local-70b', 'must keep the configured model');
    assert.equal(choice.downgradedFrom, undefined);
  });

  test('a lookalike host does not pass for OpenAI', () => {
    assert.equal(economyModelFor({ type: 'custom', baseUrl: 'https://api.openai.com.evil.test/v1' }), null);
    assert.equal(economyModelFor({ type: 'custom', baseUrl: 'https://api.openai.com/v1' }), ECONOMY_MODELS.openai);
  });

  test('a missing baseUrl is treated as OpenAI, matching the call layer default', () => {
    assert.equal(economyModelFor({ type: 'custom' }), ECONOMY_MODELS.openai);
  });

  test('the configured model is kept when downgrading would not help', () => {
    // Already on the cheap model and still over the cap: keep it so admission
    // refuses with an accurate reason instead of pretending a fix was applied.
    const choice = chooseModel({
      config: gemini,
      requested: ECONOMY_MODELS.gemini,
      promptChars: 100,
      maxOutTokens: 1_000_000,
      capUsd: 0.000001,
    });
    assert.equal(choice.model, ECONOMY_MODELS.gemini);
    assert.equal(choice.downgradedFrom, undefined);
  });

  test('every economy model is priced — none falls through to the pessimistic default', () => {
    // An unpriced model is charged at the $3/$15 default, so a "cheap" target
    // missing from the pricing table would be costed as premium and never
    // selected. That would disable the whole mechanism silently.
    const DEFAULT_OUT_PER_1M = 15.0;
    for (const model of Object.values(ECONOMY_MODELS)) {
      const outCost = estimateCostUsd(model, 0, 1_000_000);
      assert.ok(
        outCost < DEFAULT_OUT_PER_1M,
        `${model} is priced at the unknown-model default — add it to the pricing table`,
      );
    }
  });
});

describe('Gemini model resolution', () => {
  beforeEach(() => clearRetiredModels());

  test('rewrites the retired 1.5 line that produced the 404 crash', () => {
    // The exact id the deployed app was configured with.
    assert.equal(resolveGeminiModel('gemini-1.5-pro-latest'), GEMINI_FALLBACK_MODEL);
    assert.equal(resolveGeminiModel('gemini-1.5-pro'), GEMINI_FALLBACK_MODEL);
    assert.equal(resolveGeminiModel('gemini-1.5-flash'), GEMINI_FALLBACK_MODEL);
    assert.equal(resolveGeminiModel('gemini-1.0-pro'), GEMINI_FALLBACK_MODEL);
    assert.equal(resolveGeminiModel('gemini-pro'), GEMINI_FALLBACK_MODEL);
  });

  test('leaves current models untouched', () => {
    assert.equal(resolveGeminiModel('gemini-2.0-flash'), 'gemini-2.0-flash');
    assert.equal(resolveGeminiModel('gemini-2.5-flash-lite'), 'gemini-2.5-flash-lite');
    assert.equal(resolveGeminiModel('gemini-2.5-pro'), 'gemini-2.5-pro');
  });

  test('empty, null and whitespace ids land on the safe default', () => {
    assert.equal(resolveGeminiModel(''), GEMINI_FALLBACK_MODEL);
    assert.equal(resolveGeminiModel(null), GEMINI_FALLBACK_MODEL);
    assert.equal(resolveGeminiModel(undefined), GEMINI_FALLBACK_MODEL);
    assert.equal(resolveGeminiModel('   '), GEMINI_FALLBACK_MODEL);
  });

  test('an unrecognised id is passed through rather than silently swapped', () => {
    // Pricing falls back to the pessimistic default for these, so they are
    // budget-safe; guessing a replacement would be worse than trying it.
    assert.equal(resolveGeminiModel('gemini-9.9-experimental'), 'gemini-9.9-experimental');
  });
});

describe('model-not-found detection', () => {
  test('recognises the exact payload Google returned', () => {
    const body = JSON.stringify({
      error: {
        code: 404,
        message: 'models/gemini-1.5-pro-latest is not found for API version v1beta, ' +
                 'or is not supported for generateContent.',
        status: 'NOT_FOUND',
      },
    });
    assert.equal(isModelNotFound(404, body), true);
  });

  test('does not treat other failures as a missing model', () => {
    assert.equal(isModelNotFound(429, 'RESOURCE_EXHAUSTED'), false);
    assert.equal(isModelNotFound(500, 'NOT_FOUND'), false);   // wrong status
    assert.equal(isModelNotFound(404, 'some unrelated body'), false);
  });
});

describe('runtime downgrade after a 404', () => {
  beforeEach(() => clearRetiredModels());

  test('a model that 404s is not tried again by later calls', () => {
    assert.equal(resolveGeminiModel('gemini-3.0-imaginary'), 'gemini-3.0-imaginary');
    assert.equal(noteRetiredModel('gemini-3.0-imaginary'), GEMINI_FALLBACK_MODEL);
    assert.equal(resolveGeminiModel('gemini-3.0-imaginary'), GEMINI_FALLBACK_MODEL);
  });

  test('there is no downgrade loop when the fallback itself is what failed', () => {
    // Returning the fallback here would recurse forever; it must give up instead.
    assert.equal(noteRetiredModel(GEMINI_FALLBACK_MODEL), null);
  });
});

describe('retry classification', () => {
  test('deterministic failures are not retried', () => {
    assert.equal(isRetryableError('Gemini API 404: NOT_FOUND'), false);
    assert.equal(isRetryableError('OpenAI API 401: invalid_api_key'), false);
    assert.equal(isRetryableError('API 403: forbidden'), false);
    assert.equal(isRetryableError('API 400: invalid_request'), false);
  });

  test('transient failures still get their retries', () => {
    assert.equal(isRetryableError('API 429: rate limited'), true);
    assert.equal(isRetryableError('API 503: upstream unavailable'), true);
    assert.equal(isRetryableError('The operation was aborted due to timeout'), true);
    assert.equal(isRetryableError(undefined), true);
  });
});

describe('single-flight rejection handling', () => {
  beforeEach(() => clearCache());

  test('a rejected in-flight promise does not become an unhandled rejection', async () => {
    const seen: unknown[] = [];
    const onUnhandled = (reason: unknown) => seen.push(reason);
    process.on('unhandledRejection', onUnhandled);

    try {
      // Exactly the shape callAIProvider builds: the shared promise rejects and
      // only the original caller awaits it.
      const run = Promise.reject(new Error('Gemini API 404: NOT_FOUND'));
      const caller = run.catch(e => e);          // the awaiting caller
      setInFlight('k', run.then(r => r as any)); // the derived promise

      const err = await caller;
      assert.match((err as Error).message, /404/);

      // Give the microtask queue and one macrotask turn to fire the event.
      await new Promise(r => setTimeout(r, 50));
      assert.deepEqual(seen, [], 'a derived promise leaked an unhandled rejection');
    } finally {
      process.off('unhandledRejection', onUnhandled);
    }
  });

  test('the in-flight entry is cleaned up after a rejection', async () => {
    const run = Promise.reject(new Error('boom'));
    void run.catch(() => {});
    setInFlight('cleanup-key', run.then(r => r as any));

    await new Promise(r => setTimeout(r, 20));
    assert.equal(getInFlight('cleanup-key'), null);
  });

  test('the in-flight entry is cleaned up after a success', async () => {
    const value = { text: 'ok', provider: 'Gemini', model: 'gemini-2.0-flash' };
    setInFlight('ok-key', Promise.resolve(value));

    await new Promise(r => setTimeout(r, 20));
    assert.equal(getInFlight('ok-key'), null);
  });
});

describe('call option resolution', () => {
  test('a bare number still means maxTokens', () => {
    const o = resolveOptions(512, 1024);
    assert.equal(o.maxTokens, 512);
    assert.equal(o.tier, 'normal');
  });

  test('undefined options fall back to the declared default', () => {
    assert.equal(resolveOptions(undefined, 256).maxTokens, 256);
  });

  test('cache TTL is derived from the tier when not given', () => {
    assert.ok(resolveOptions({ tier: 'cosmetic' }, 100).cacheTtlMs
            > resolveOptions({ tier: 'critical' }, 100).cacheTtlMs);
  });

  test('an explicit zero TTL is honoured rather than replaced by the tier default', () => {
    assert.equal(resolveOptions({ tier: 'cosmetic', cacheTtlMs: 0 }, 100).cacheTtlMs, 0);
  });
});

describe('JSON extraction from model output', () => {
  test('reads a fenced block, bare object and bare array', () => {
    assert.deepEqual(parseJson('```json\n{"a":1}\n```'), { a: 1 });
    assert.deepEqual(parseJson('sure! {"a":2} hope that helps'), { a: 2 });
    assert.deepEqual(parseJson('[1,2,3]'), [1, 2, 3]);
  });

  test('returns null instead of throwing on prose or malformed JSON', () => {
    assert.equal(parseJson('no json here at all'), null);
    assert.equal(parseJson('{"a": }'), null);
    assert.equal(parseJson(''), null);
    assert.equal(extractJson(''), null);
  });
});
