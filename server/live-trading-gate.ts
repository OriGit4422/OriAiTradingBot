/**
 * Live-trading gate — the deployment-level confirmation.
 *
 * CLAUDE.md requires two independent confirmations before real money moves:
 * the in-app unlock (`liveUnlocked`, earned through paper trades and an accepted
 * risk disclaimer) and this environment variable. "Never just one."
 *
 * Only the in-app half was implemented, which left a single database flag as the
 * whole barrier between paper and live. Keeping the second gate in the
 * environment means a restored backup, a stray settings write or a cloned
 * deployment cannot inherit live trading — someone has to arm it on the host on
 * purpose. Testnet and paper are unaffected.
 *
 * Kept free of storage/db imports so it is unit-testable without a DATABASE_URL.
 */

export const LIVE_TRADING_BLOCKED_MESSAGE =
  'Live trading is not confirmed for this deployment. Set LIVE_TRADING_CONFIRMED=true in the ' +
  'environment to arm it; the in-app unlock alone is deliberately not sufficient.';

/**
 * True only when the operator has explicitly written `true`.
 *
 * '1' and 'yes' are deliberately rejected: this variable exists to be a
 * conscious act, so it requires the exact word. Anything unset, empty or
 * unrecognised leaves live trading disarmed — the gate fails closed.
 */
export function isLiveTradingConfirmed(): boolean {
  return String(process.env.LIVE_TRADING_CONFIRMED ?? '').trim().toLowerCase() === 'true';
}
