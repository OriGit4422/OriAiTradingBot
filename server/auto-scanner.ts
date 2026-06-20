/**
 * Auto-Scanner: polls pending signals every SCAN_INTERVAL_MS and
 * auto-executes any that pass the confidence gate while the bot is
 * in "live" (or "paper") mode with autoExecute=true.
 *
 * Rules enforced here (in addition to executeSignal's own guards):
 *   - Bot status must be "active"
 *   - autoExecute must be true
 *   - Signal status must be "OPEN" (not already EXECUTED/INVALIDATED)
 *   - Signal confidence >= settings.minConfidence (default 95)
 *   - Open trades < settings.maxOpenTrades (default 3)
 *   - One signal processed per tick to avoid burst ordering
 */

import { storage } from './storage';
import { executeSignal } from './bot-engine';
import { runMultiAgentValidation } from './signal-validator';
import { runOrchestrator } from './agents/agent-orchestrator';

const SCAN_INTERVAL_MS = 5 * 60 * 1000; // 5 minutes

let _timer: ReturnType<typeof setInterval> | null = null;
let _scanLock: Promise<void> | null = null;

async function scanAndExecute(): Promise<void> {
  if (_scanLock) return;
  let resolve!: () => void;
  _scanLock = new Promise<void>(r => { resolve = r; });
  try {
    const s = await storage.getBotSettings();

    // Only run when bot is active and autoExecute is enabled
    if (!s.autoExecute || s.status !== 'active') return;

    // Check open trade count
    const trades = await storage.getBotTrades(200);
    const openCount = trades.filter((t) => t.status === 'open').length;
    if (openCount >= s.maxOpenTrades) {
      await storage.createBotLog({
        level: 'info',
        event: 'SCANNER_SKIP',
        message: `Auto-scanner: ${openCount}/${s.maxOpenTrades} trades open — waiting for slot`,
      });
      return;
    }

    // Fetch all signals, filter to OPEN + high confidence
    const allSignals = await storage.getSignals();
    const candidates = allSignals
      .filter((sig) => sig.status === 'OPEN' && sig.confidence >= s.minConfidence)
      .sort((a, b) => b.confidence - a.confidence); // highest confidence first

    if (candidates.length === 0) {
      await storage.createBotLog({
        level: 'info',
        event: 'SCANNER_NO_CANDIDATES',
        message: `Auto-scanner: no signals with confidence >= ${s.minConfidence}% found`,
      });
      return;
    }

    // Try each candidate in order until one executes successfully
    for (const sig of candidates) {
      // Skip if symbol not in allowed list
      const symbol = sig.coin.toUpperCase().endsWith('USDT') ? sig.coin.toUpperCase() : `${sig.coin.toUpperCase()}USDT`;
      if (!s.allowedSymbols.includes(symbol)) continue;

      // Full 6-agent orchestrator validation (non-blocking on failure)
      let shouldTrade = true;
      let orchestratorResult: any = null;
      try {
        orchestratorResult = await runOrchestrator({
          coin: sig.coin,
          direction: sig.type as 'LONG' | 'SHORT',
          entry: sig.entry,
          tp: sig.tp,
          sl: sig.sl,
          confidence: sig.confidence,
          strategy: sig.strategy || 'Auto',
          timeframe: sig.timeframe || '1h',
          marketPrice: sig.marketPrice || sig.entry,
        });
        shouldTrade = orchestratorResult.shouldTrade;
        if (!shouldTrade) {
          await storage.createBotLog({
            level: 'warn',
            event: 'SCANNER_ORCHESTRATOR_BLOCK',
            message: `Auto-scanner: ${sig.coin} blocked by orchestrator (${orchestratorResult.finalVerdict}, ${orchestratorResult.finalConfidence}%) — ${orchestratorResult.warnings.slice(0,2).join('; ')}`,
            meta: { signalId: sig.id, verdict: orchestratorResult.finalVerdict, scores: orchestratorResult.scores },
          });
          continue;
        }
      } catch {
        // Non-fatal: fall back to legacy validation if orchestrator fails
        try {
          const validation = await runMultiAgentValidation({
            coin: sig.coin, type: sig.type, entry: sig.entry,
            tp: sig.tp, sl: sig.sl, confidence: sig.confidence,
            strategy: sig.strategy || 'Auto', timeframe: sig.timeframe || '1h',
            marketPrice: sig.marketPrice || sig.entry,
          });
          shouldTrade = validation.shouldTrade;
          if (!shouldTrade) {
            await storage.createBotLog({
              level: 'warn', event: 'SCANNER_MULTI_AGENT_BLOCK',
              message: `Auto-scanner: ${sig.coin} blocked by multi-agent (${validation.finalVerdict}, ${validation.adjustedConfidence}%)`,
              meta: { signalId: sig.id, verdict: validation.finalVerdict },
            });
            continue;
          }
        } catch { /* proceed if all validation fails */ }
      }

      await storage.createBotLog({
        level: 'info',
        event: 'SCANNER_ATTEMPTING',
        message: `Auto-scanner: attempting ${sig.coin} ${sig.type} (confidence ${sig.confidence}%, mode: ${s.mode})`,
        meta: { signalId: sig.id },
      });

      const result = await executeSignal(sig.id);
      if (result.ok) {
        await storage.createBotLog({
          level: 'success',
          event: 'SCANNER_EXECUTED',
          message: `Auto-scanner: executed ${sig.coin} ${sig.type} — ${result.message}`,
          meta: { signalId: sig.id, grade: result.grade, rr: result.rr },
        });
        // Only execute one trade per scan tick
        break;
      } else {
        await storage.createBotLog({
          level: 'warn',
          event: 'SCANNER_EXEC_FAILED',
          message: `Auto-scanner: ${sig.coin} execution failed — ${result.message}`,
          meta: { signalId: sig.id, reasons: result.reasons },
        });
      }
    }
  } catch (err: any) {
    console.error('[auto-scanner] tick error:', err?.message);
  } finally {
    _scanLock = null;
    resolve();
  }
}

export function startAutoScanner(): void {
  if (_timer) return; // already running
  console.log(`[auto-scanner] started — scanning every ${SCAN_INTERVAL_MS / 1000}s`);
  // Run immediately on start, then on interval
  scanAndExecute().catch(console.error);
  _timer = setInterval(() => scanAndExecute().catch(console.error), SCAN_INTERVAL_MS);
}

export function stopAutoScanner(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
    console.log('[auto-scanner] stopped');
  }
}

export function triggerScanNow(): Promise<void> {
  return scanAndExecute();
}
