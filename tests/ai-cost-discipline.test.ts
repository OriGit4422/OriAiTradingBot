/**
 * Cost-discipline guard.
 *
 * CLAUDE.md sets a hard target of $0.01–$0.05 per provider per day and requires
 * every AI call to declare a tier. An untagged call silently defaults to
 * 'normal', which lets decorative prose compete with the AI veto on a live
 * signal for the same 75% ceiling — and an oversized maxTokens is what the
 * budget governor prices the call at, so it also shrinks how many calls fit in
 * a day even when the model answers briefly.
 *
 * This test reads the source rather than executing it: the failure mode it
 * guards against is a new call site being added without a tier, which no
 * runtime test would catch.
 *
 * Run: npm test
 */
import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { estimateCostUsd, getDailyBudget } from '../server/ai-budget';
import { GEMINI_FALLBACK_MODEL } from '../server/ai-providers-core';

const SERVER_DIR = join(import.meta.dirname, '..', 'server');

/** Call sites exempt from the tier requirement, with the reason. */
const ALLOWLIST: Array<{ file: string; reason: string }> = [
  {
    file: 'routes.ts',
    reason: '/api/ai/test-connection probes each provider with a 20-token ping',
  },
];

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (name.endsWith('.ts')) out.push(full);
  }
  return out;
}

interface CallSite { file: string; line: number; body: string }

const CALL_RE = /\b(callMultiAI|callConsensusAI|callAIProvider)\s*\(/;

function isCallLine(line: string): boolean {
  if (!CALL_RE.test(line)) return false;
  if (/^\s*(import|export)\b/.test(line)) return false;
  if (/^\s*(\/\/|\*)/.test(line)) return false;
  return true;
}

/**
 * Find every call into the provider layer, together with its argument list.
 *
 * The window runs to the next call site or 40 lines, whichever comes first —
 * a long inline prompt template can push the options object well past a fixed
 * short window, while a fixed long one would read the *next* call's tier and
 * pass an untagged site by mistake.
 */
function findCallSites(): CallSite[] {
  const sites: CallSite[] = [];
  for (const path of walk(SERVER_DIR)) {
    // The provider layer itself defines these functions; it is not a caller.
    if (path.endsWith('ai-providers.ts') || path.endsWith('ai-providers-core.ts')) continue;

    const lines = readFileSync(path, 'utf8').split('\n');
    const starts = lines.map((l, i) => (isCallLine(l) ? i : -1)).filter(i => i >= 0);

    starts.forEach((start, n) => {
      const nextStart = starts[n + 1] ?? lines.length;
      const end = Math.min(start + 40, nextStart);
      sites.push({
        file: path.slice(SERVER_DIR.length + 1),
        line: start + 1,
        body: lines.slice(start, end).join('\n'),
      });
    });
  }
  return sites;
}

describe('AI call sites', () => {
  const sites = findCallSites();

  test('there is at least one call site to check', () => {
    // Guards against the scanner silently matching nothing after a refactor.
    assert.ok(sites.length >= 8, `only found ${sites.length} call sites — scanner may be broken`);
  });

  test('every call declares a budget tier', () => {
    const untagged = sites.filter(s => {
      if (ALLOWLIST.some(a => s.file.endsWith(a.file))) return false;
      return !/\btier:\s*'(critical|normal|cosmetic)'/.test(s.body);
    });
    assert.deepEqual(
      untagged.map(s => `${s.file}:${s.line}`),
      [],
      'untagged AI calls default to the normal tier and compete with the live-signal veto',
    );
  });

  test('no call site requests an oversized output budget', () => {
    // The governor prices admission at maxTokens, so a 4096 ceiling reserves
    // ~$0.0016 of a $0.05 day on gemini-2.0-flash whether or not it is used.
    const MAX_ALLOWED = 1500;
    const oversized: string[] = [];
    for (const s of sites) {
      const m = s.body.match(/maxTokens:\s*(\d+)/);
      if (m && Number(m[1]) > MAX_ALLOWED) oversized.push(`${s.file}:${s.line} (${m[1]})`);
    }
    assert.deepEqual(oversized, [], `call sites above ${MAX_ALLOWED} output tokens`);
  });

  test('the veto on a tradeable signal is the tier that survives longest', () => {
    // If this ever stops being 'critical', a budget squeeze silently strips the
    // AI layer off live signals before it drops decorative prose.
    const orchestrator = sites.find(s => s.file.endsWith('agent-orchestrator.ts'));
    assert.ok(orchestrator, 'the orchestrator AI veto call site disappeared');
    assert.match(orchestrator!.body, /tier:\s*'critical'/);
  });
});

describe('daily budget headroom', () => {
  test('the default cap sits inside the documented $0.01-$0.05 band', () => {
    const budget = getDailyBudget();
    assert.ok(budget >= 0.01 && budget <= 0.05, `daily budget is $${budget}`);
  });

  test('a full day of AI vetoes fits inside the cap', () => {
    // The veto prompt is ~450 chars in and capped at 120 tokens out. At one
    // scan every 15 minutes across the trading day this must not exhaust the
    // budget on its own, or signals lose their AI layer by mid-afternoon.
    const perCall = estimateCostUsd(GEMINI_FALLBACK_MODEL, Math.ceil(450 / 4), 120);
    const callsPerDay = 96;
    assert.ok(
      perCall * callsPerDay < getDailyBudget(),
      `96 vetoes cost $${(perCall * callsPerDay).toFixed(5)} against a $${getDailyBudget()} cap`,
    );
  });

  test('the retired-model fallback is a cheap model, not a premium one', () => {
    // Downgrading a bad model id onto an expensive one would quietly multiply
    // the day's spend instead of just keeping the app alive.
    const cost = estimateCostUsd(GEMINI_FALLBACK_MODEL, 1e6, 1e6);
    assert.ok(cost < 1.0, `${GEMINI_FALLBACK_MODEL} costs $${cost} per 1M+1M tokens`);
  });
});
