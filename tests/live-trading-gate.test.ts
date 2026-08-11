/**
 * The environment half of the live-trading gate.
 *
 * CLAUDE.md: live trading requires BOTH the in-app unlock AND
 * LIVE_TRADING_CONFIRMED=true — "never just one". These tests pin the parsing
 * down hard, because the failure mode is not a broken feature, it is real money
 * moving on a deployment nobody armed.
 *
 * Run: npm test
 */
import { test, describe, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { isLiveTradingConfirmed, LIVE_TRADING_BLOCKED_MESSAGE } from '../server/live-trading-gate';

const original = process.env.LIVE_TRADING_CONFIRMED;

afterEach(() => {
  if (original === undefined) delete process.env.LIVE_TRADING_CONFIRMED;
  else process.env.LIVE_TRADING_CONFIRMED = original;
});

describe('isLiveTradingConfirmed', () => {
  test('only an explicit "true" arms live trading', () => {
    process.env.LIVE_TRADING_CONFIRMED = 'true';
    assert.equal(isLiveTradingConfirmed(), true);
  });

  test('accepts the usual capitalisations and stray whitespace', () => {
    for (const v of ['TRUE', 'True', ' true ', 'tRuE\n']) {
      process.env.LIVE_TRADING_CONFIRMED = v;
      assert.equal(isLiveTradingConfirmed(), true, `expected ${JSON.stringify(v)} to arm`);
    }
  });

  test('everything else leaves live trading disarmed', () => {
    // '1' and 'yes' are deliberately NOT accepted: the variable is a conscious
    // confirmation, so it should require the exact word.
    for (const v of ['false', '', '   ', '0', '1', 'yes', 'no', 'TRUE!', 'truthy', 'null', 'undefined']) {
      process.env.LIVE_TRADING_CONFIRMED = v;
      assert.equal(isLiveTradingConfirmed(), false, `expected ${JSON.stringify(v)} to stay disarmed`);
    }
  });

  test('an unset variable leaves live trading disarmed', () => {
    delete process.env.LIVE_TRADING_CONFIRMED;
    assert.equal(isLiveTradingConfirmed(), false);
  });

  test('the block message names the variable an operator has to set', () => {
    assert.match(LIVE_TRADING_BLOCKED_MESSAGE, /LIVE_TRADING_CONFIRMED=true/);
  });
});
