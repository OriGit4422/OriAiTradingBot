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
} from '../server/ai-providers-core';
import { setInFlight, getInFlight, clearCache } from '../server/ai-budget';

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
