/**
 * Persistence for the AI budget ledger.
 *
 * Lives apart from ai-budget.ts so the governor itself stays a pure, storage-free
 * module that tests can exercise without a database.
 *
 * Without this, restarting the server would reset the day's spend to zero and
 * the daily cap would mean nothing on a process that restarts often.
 */

import { storage } from './storage';
import { BUDGET_LEDGER_EVENT, serializeLedger, restoreLedger } from './ai-budget';

const FLUSH_INTERVAL_MS = 5 * 60 * 1000;

let timer: ReturnType<typeof setInterval> | null = null;

export async function restoreBudgetLedger(): Promise<boolean> {
  try {
    const logs = await storage.getBotLogs(200);
    const latest = logs.find(l => l.event === BUDGET_LEDGER_EVENT);
    if (!latest?.meta) return false;
    const ok = restoreLedger(latest.meta as any);
    if (ok) {
      const snap = serializeLedger();
      const total = snap.providers.reduce((s, p) => s + p.spendUsd, 0);
      console.log(`[ai-budget] restored ledger for ${snap.day} — $${total.toFixed(5)} already spent today`);
    }
    return ok;
  } catch (err) {
    console.warn('[ai-budget] could not restore ledger:', err instanceof Error ? err.message : err);
    return false;
  }
}

export async function flushBudgetLedger(): Promise<void> {
  try {
    const snapshot = serializeLedger();
    if (!snapshot.providers.length) return;
    const total = snapshot.providers.reduce((s, p) => s + p.spendUsd, 0);
    await storage.createBotLog({
      level: 'info',
      event: BUDGET_LEDGER_EVENT,
      message: `AI spend ${snapshot.day}: $${total.toFixed(5)} across ${snapshot.providers.length} provider(s)`,
      meta: snapshot,
    });
  } catch (err) {
    console.warn('[ai-budget] could not persist ledger:', err instanceof Error ? err.message : err);
  }
}

export function startBudgetPersistence(): void {
  if (timer) return;
  timer = setInterval(() => { void flushBudgetLedger(); }, FLUSH_INTERVAL_MS);
  const stop = () => { void flushBudgetLedger(); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

export function stopBudgetPersistence(): void {
  if (timer) { clearInterval(timer); timer = null; }
}
