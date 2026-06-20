/**
 * Autonomous Market Intelligence Scanner
 * ─────────────────────────────────────────────────────────────────────────────
 * COST-OPTIMISED DESIGN — most coins never hit an AI API:
 *
 * Stage 1 — Math pre-filter (FREE, pure calculations):
 *   • Fetch Binance candles (public endpoint, no key)
 *   • Run RSI + EMA + MACD + volume + ATR checks in-process
 *   • Only coins scoring ≥ mathThreshold (default 60) pass to Stage 2
 *   • Typically filters out 70-85% of coins per scan
 *
 * Stage 2 — Sentiment check (Coinglass / Perplexity / Arkham — optional):
 *   • These are DATA APIs, not LLM calls
 *   • Only runs if API keys are configured in Settings
 *   • Coinglass has a free tier (no cost per call)
 *   • Skipped if keys not set — no cost
 *
 * Stage 3 — Single AI call (ONLY if Stage 1 + 2 pass):
 *   • One call to ONE cheapest provider (Gemini Flash preferred)
 *   • Max 80 output tokens — very short prompt
 *   • Only for coins that already look good on math
 *   • Typical cost: $0.0001-0.001 per signal generated
 *
 * Market Regime (cached 15min):
 *   • 1 AI call per 15 minutes to generate a narrative — ~$0.001/day
 *
 * Estimated total cost for 15 coins on 1h scanner:
 *   • Without AI keys: $0/day (pure math)
 *   • With Gemini Flash only: ~$0.01-0.05/day
 *   • With GPT-4o: ~$0.10-0.30/day (only for approved signals)
 */

import { storage } from '../storage';
import { runOrchestrator } from './agent-orchestrator';
import { getMarketRegime } from './market-intelligence-agent';
import { runPhase2Confluence, type OHLCVCandle } from './technical-analysis-agent';
import { getActiveProviders } from '../ai-providers';
import { notifySignal } from '../notifications';
import type { Signal } from '@shared/schema';

// ─── Configuration ────────────────────────────────────────────────────────────

export type ScanTimeframe = '15m' | '1h' | '4h' | '1d';

export interface ScannerConfig {
  enabled: boolean;
  timeframes: ScanTimeframe[];   // which TFs to scan
  coins: string[];               // coin list to scan
  minConfidence: number;         // minimum to generate signal (default 70)
  minGrade: string;              // min grade to save (default 'B')
  scanIntervalMs: number;        // how often to run (default 60min)
  maxSignalsPerScan: number;     // cap per run (default 5)
  notifyOnGenerate: boolean;     // send Telegram/Discord on new signal
  autoExecute: boolean;          // auto-execute approved signals
}

export interface ScanResult {
  coin: string;
  timeframe: ScanTimeframe;
  direction: 'LONG' | 'SHORT';
  entry: number;
  sl: number;
  tp: number;
  confidence: number;
  grade: string;
  verdict: string;
  summary: string;
  scores: { macro: number; sentiment: number; technical: number; composite: number };
  signalId?: string;
  timestamp: string;
}

export interface ScanSummary {
  timeframe: string;
  coinsScanned: number;
  passedMathFilter: number;
  filteredByMacro: number;
  filteredByGrade: number;
  signalsGenerated: number;
  scanDurationMs: number;
  timestamp: string;
  macroRegime: string | null;
}

export interface ScannerStatus {
  running: boolean;
  lastScanAt: string | null;
  nextScanAt: string | null;
  signalsGenerated: number;
  signalsToday: number;
  lastResults: ScanResult[];
  lastScanSummary: ScanSummary | null;
  config: ScannerConfig;
}

// ─── Default watched coins ────────────────────────────────────────────────────

const DEFAULT_COINS = [
  'BTC', 'ETH', 'SOL', 'BNB', 'XRP',
  'ADA', 'AVAX', 'DOGE', 'LINK', 'MATIC',
  'ARB', 'OP', 'SUI', 'APT', 'INJ',
];

const TIMEFRAME_CANDLES: Record<ScanTimeframe, number> = {
  '15m': 100,
  '1h': 100,
  '4h': 100,
  '1d': 60,
};

const TIMEFRAME_INTERVAL_MS: Record<ScanTimeframe, number> = {
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '4h': 4 * 60 * 60 * 1000,
  '1d': 24 * 60 * 60 * 1000,
};

// ─── Binance public klines (no API key needed) ────────────────────────────────

async function fetchBinanceKlines(symbol: string, interval: ScanTimeframe, limit: number): Promise<OHLCVCandle[]> {
  const intervalMap: Record<ScanTimeframe, string> = {
    '15m': '15m', '1h': '1h', '4h': '4h', '1d': '1d',
  };
  const binanceInterval = intervalMap[interval];
  const sym = symbol.toUpperCase().endsWith('USDT') ? symbol.toUpperCase() : `${symbol.toUpperCase()}USDT`;

  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${binanceInterval}&limit=${limit}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
  if (!res.ok) throw new Error(`Binance klines ${res.status} for ${sym}`);

  const data: any[] = await res.json();
  return data.map(k => ({
    timestamp: k[0],
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }));
}

// ─── Fetch current price ──────────────────────────────────────────────────────

async function fetchPrice(coin: string): Promise<number> {
  const sym = coin.toUpperCase().endsWith('USDT') ? coin.toUpperCase() : `${coin.toUpperCase()}USDT`;
  try {
    const res = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${sym}`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return 0;
    const d = await res.json();
    return parseFloat(d.price ?? '0');
  } catch { return 0; }
}

// ─── Compute entry / SL / TP from candle data ────────────────────────────────

function computeLevels(candles: OHLCVCandle[], direction: 'LONG' | 'SHORT'): {
  entry: number; sl: number; tp1: number; tp2: number; tp3: number
} {
  const last = candles[candles.length - 1];
  const price = last.close;

  // ATR-based levels
  const atrs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i], p = candles[i - 1];
    atrs.push(Math.max(c.high - c.low, Math.abs(c.high - p.close), Math.abs(c.low - p.close)));
  }
  const atr = atrs.slice(-14).reduce((a, b) => a + b, 0) / 14;

  if (direction === 'LONG') {
    // SL below recent swing low - 0.5 ATR
    const swingLow = Math.min(...candles.slice(-10).map(c => c.low));
    const sl = Math.max(swingLow - atr * 0.5, price * 0.95); // max 5% below
    const slDist = price - sl;
    return {
      entry: price,
      sl,
      tp1: price + slDist * 1.5,
      tp2: price + slDist * 2.5,
      tp3: price + slDist * 4.0,
    };
  } else {
    // SL above recent swing high + 0.5 ATR
    const swingHigh = Math.max(...candles.slice(-10).map(c => c.high));
    const sl = Math.min(swingHigh + atr * 0.5, price * 1.05); // max 5% above
    const slDist = sl - price;
    return {
      entry: price,
      sl,
      tp1: price - slDist * 1.5,
      tp2: price - slDist * 2.5,
      tp3: price - slDist * 4.0,
    };
  }
}

// ─── Determine bias direction from candle data ────────────────────────────────

function detectDirection(candles: OHLCVCandle[]): 'LONG' | 'SHORT' | null {
  if (candles.length < 20) return null;
  const closes = candles.map(c => c.close);
  const last = closes[closes.length - 1];

  // EMA20 direction
  const k = 2 / 21;
  let ema = closes[0];
  for (let i = 1; i < closes.length; i++) ema = closes[i] * k + ema * (1 - k);
  const emaDir = last > ema ? 'LONG' : 'SHORT';

  // Recent momentum: last 5 candles net direction
  const recentCloses = closes.slice(-5);
  const momentum = recentCloses[4] - recentCloses[0];
  const momentumDir = momentum > 0 ? 'LONG' : 'SHORT';

  // Only return if both agree
  return emaDir === momentumDir ? emaDir : null;
}

// ─── Grade ordering ───────────────────────────────────────────────────────────

const GRADE_RANK: Record<string, number> = { 'A+': 4, 'A': 3, 'B': 2, 'C': 1, 'No Trade': 0 };

// ─── State ────────────────────────────────────────────────────────────────────

let _config: ScannerConfig = {
  enabled: false,
  timeframes: ['1h'],
  coins: DEFAULT_COINS,
  minConfidence: 70,
  minGrade: 'B',
  scanIntervalMs: 60 * 60 * 1000,
  maxSignalsPerScan: 5,
  notifyOnGenerate: true,
  autoExecute: false,
};

let _timers: Map<ScanTimeframe, ReturnType<typeof setInterval>> = new Map();
let _running = false;
let _lastScanAt: string | null = null;
let _nextScanAt: string | null = null;
let _signalsGenerated = 0;
let _signalsToday = 0;
let _lastResults: ScanResult[] = [];
let _lastScanSummary: ScanSummary | null = null;
let _todayStart = new Date();

// Math pre-filter threshold — coins below this skip AI entirely (saves 80-90% of costs)
const MATH_PREFILTER_THRESHOLD = 55;

// ─── Core scan logic ──────────────────────────────────────────────────────────

async function scanCoin(coin: string, timeframe: ScanTimeframe): Promise<ScanResult | null> {
  try {
    const limit = TIMEFRAME_CANDLES[timeframe];
    const candles = await fetchBinanceKlines(coin, timeframe, limit);
    if (candles.length < 20) return null;

    const price = candles[candles.length - 1].close;
    if (price <= 0) return null;

    // Detect direction from price action
    const direction = detectDirection(candles);
    if (!direction) return null; // conflicting signals — skip

    // Compute ATR-based levels
    const levels = computeLevels(candles, direction);

    // ── Stage 1: Math pre-filter (FREE — no API calls) ──────────────────────
    // Run the 17-factor confluence engine with AI disabled.
    // Only coins scoring ≥ MATH_PREFILTER_THRESHOLD proceed to Stage 2/3.
    const mathResult = await runPhase2Confluence({
      coin,
      direction,
      entry: levels.entry,
      sl: levels.sl,
      tp: levels.tp2,
      candles,
      aiEnabled: false,
    });

    if (mathResult.compositeScore < MATH_PREFILTER_THRESHOLD) {
      return null; // filtered out — save AI cost
    }

    // ── Stage 2 + 3: Full orchestrator (AI only for promising coins) ────────
    // Determine if any AI providers are configured
    const hasAI = (await getActiveProviders()).length > 0;

    const result = await runOrchestrator({
      coin,
      direction,
      entry: levels.entry,
      sl: levels.sl,
      tp: levels.tp2,   // use TP2 (2.5R) as primary target
      confidence: mathResult.compositeScore,   // seed with math score
      strategy: 'AI-Scanner',
      timeframe,
      marketPrice: price,
      candles,
    });

    // Filter by minimum grade and confidence
    const gradeRank = GRADE_RANK[result.grade] ?? 0;
    const minRank = GRADE_RANK[_config.minGrade] ?? 1;
    if (gradeRank < minRank) return null;
    if (result.finalConfidence < _config.minConfidence) return null;
    if (!result.shouldTrade) return null;

    return {
      coin,
      timeframe,
      direction,
      entry: levels.entry,
      sl: levels.sl,
      tp: levels.tp2,
      confidence: result.finalConfidence,
      grade: result.grade,
      verdict: result.finalVerdict,
      summary: result.summary,
      scores: result.scores,
      timestamp: new Date().toISOString(),
    };
  } catch (err: any) {
    console.warn(`[market-scanner] ${coin}/${timeframe} error: ${err?.message}`);
    return null;
  }
}

async function runScan(timeframe: ScanTimeframe): Promise<void> {
  if (_running) {
    console.log(`[market-scanner] scan already running, skipping ${timeframe} tick`);
    return;
  }
  _running = true;
  const scanStart = Date.now();

  // Reset daily counter
  const now = new Date();
  if (now.toDateString() !== _todayStart.toDateString()) {
    _signalsToday = 0;
    _todayStart = now;
  }

  console.log(`[market-scanner] ⟳ Starting ${timeframe} scan of ${_config.coins.length} coins...`);

  // Activity tracking
  let coinsScanned = 0;
  let passedMathFilter = 0;
  let filteredByMacro = 0;
  let filteredByGrade = 0;

  try {
    await storage.createBotLog({
      level: 'info',
      event: 'MARKET_SCAN_START',
      message: `Market scanner: starting ${timeframe} scan of ${_config.coins.length} coins`,
      meta: { timeframe, coinCount: _config.coins.length },
    });

    // Get macro regime first (cached, fast)
    let regime: any = null;
    try { regime = await getMarketRegime(); } catch { /* non-fatal */ }

    if (regime?.tradeableSide === 'AVOID') {
      console.log(`[market-scanner] Macro regime AVOID (${regime.regime}) — skipping scan`);
      await storage.createBotLog({
        level: 'warn',
        event: 'MARKET_SCAN_SKIPPED',
        message: `Macro regime is ${regime.regime} — scan skipped to protect capital`,
      });
      _running = false;
      _nextScanAt = new Date(Date.now() + _config.scanIntervalMs).toISOString();
      return;
    }

    const results: ScanResult[] = [];
    let generated = 0;

    // Scan coins sequentially to avoid rate limits
    for (const coin of _config.coins) {
      if (generated >= _config.maxSignalsPerScan) break;

      coinsScanned++;
      const scanResult = await scanCoin(coin, timeframe);
      if (!scanResult) continue;

      passedMathFilter++;

      // Macro soft-filter: in strongly directional regimes, deprioritise counter-trend
      // signals — but don't hard-block them so the user always sees output.
      const isCounterTrend =
        (regime?.tradeableSide === 'LONG' && scanResult.direction === 'SHORT') ||
        (regime?.tradeableSide === 'SHORT' && scanResult.direction === 'LONG');

      if (isCounterTrend) {
        filteredByMacro++;
        // Include counter-trend only if confidence is very high (≥ 80)
        if (scanResult.confidence < 80) continue;
      }

      results.push(scanResult);
      generated++;

      // Save signal to DB
      try {
        const signal = await storage.createSignal({
          coin: scanResult.coin,
          strategy: `AI-Scanner-${timeframe}`,
          type: scanResult.direction,
          entry: scanResult.entry,
          tp: scanResult.tp,
          sl: scanResult.sl,
          marketPrice: scanResult.entry,
          timeframe: scanResult.timeframe,
          confidence: scanResult.confidence,
          status: 'OPEN',
        });
        scanResult.signalId = signal.id;

        if (_config.notifyOnGenerate) {
          try { await notifySignal(signal as Signal); } catch { /* non-fatal */ }
        }

        _signalsGenerated++;
        _signalsToday++;

        await storage.createBotLog({
          level: 'success',
          event: 'MARKET_SCAN_SIGNAL',
          message: `[${scanResult.grade}] ${scanResult.direction} ${scanResult.coin}/${timeframe} — ${scanResult.confidence}% confidence | TP: $${scanResult.tp.toFixed(2)} SL: $${scanResult.sl.toFixed(2)}`,
          meta: {
            coin: scanResult.coin, timeframe, direction: scanResult.direction,
            confidence: scanResult.confidence, grade: scanResult.grade,
            scores: scanResult.scores, signalId: signal.id,
          },
        });

        console.log(`[market-scanner] ✅ [${scanResult.grade}] ${scanResult.direction} ${scanResult.coin}/${timeframe} ${scanResult.confidence}%`);
      } catch (e: any) {
        console.warn(`[market-scanner] failed to save signal for ${coin}: ${e.message}`);
      }

      // Small delay between coins to respect rate limits
      await new Promise(r => setTimeout(r, 300));
    }

    // Keep previous results if this scan found nothing — avoids blank UI
    if (results.length > 0) {
      _lastResults = results;
    }

    _lastScanAt = new Date().toISOString();
    _nextScanAt = new Date(Date.now() + _config.scanIntervalMs).toISOString();
    const scanDurationMs = Date.now() - scanStart;

    _lastScanSummary = {
      timeframe,
      coinsScanned,
      passedMathFilter,
      filteredByMacro,
      filteredByGrade,
      signalsGenerated: results.length,
      scanDurationMs,
      macroRegime: regime?.regime ?? null,
      timestamp: _lastScanAt,
    };

    await storage.createBotLog({
      level: 'info',
      event: 'MARKET_SCAN_COMPLETE',
      message: `Market scanner: ${timeframe} scan complete in ${(scanDurationMs / 1000).toFixed(1)}s — ${results.length} signal(s) | ${coinsScanned} scanned, ${passedMathFilter} passed TA, ${filteredByMacro} filtered by macro`,
      meta: { timeframe, signalsGenerated: results.length, scanDurationMs, totalToday: _signalsToday, coinsScanned, passedMathFilter, filteredByMacro },
    });

    console.log(`[market-scanner] ✓ ${timeframe} scan done in ${(scanDurationMs / 1000).toFixed(1)}s — ${results.length} signals (${coinsScanned} scanned, ${passedMathFilter} passed TA, ${filteredByMacro} macro-filtered)`);
  } catch (err: any) {
    console.error(`[market-scanner] scan error: ${err?.message}`);
    await storage.createBotLog({
      level: 'error',
      event: 'MARKET_SCAN_ERROR',
      message: `Market scanner error: ${err?.message}`,
    });
  } finally {
    _running = false;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

export function configureScanner(config: Partial<ScannerConfig>): void {
  _config = { ..._config, ...config };
}

export function getConfig(): ScannerConfig {
  return { ..._config };
}

export function getStatus(): ScannerStatus {
  return {
    running: _running,
    lastScanAt: _lastScanAt,
    nextScanAt: _nextScanAt,
    signalsGenerated: _signalsGenerated,
    signalsToday: _signalsToday,
    lastResults: _lastResults,
    lastScanSummary: _lastScanSummary,
    config: { ..._config },
  };
}

export function startMarketScanner(config?: Partial<ScannerConfig>): void {
  if (config) _config = { ..._config, ...config };
  if (!_config.enabled) {
    console.log('[market-scanner] disabled — set enabled=true to activate');
    return;
  }

  stopMarketScanner(); // clear any existing timers

  for (const tf of _config.timeframes) {
    const intervalMs = TIMEFRAME_INTERVAL_MS[tf];
    console.log(`[market-scanner] scheduling ${tf} scan every ${intervalMs / 60000}min`);

    // Run immediately then on interval
    runScan(tf).catch(console.error);

    const timer = setInterval(() => {
      runScan(tf).catch(console.error);
    }, intervalMs);

    _timers.set(tf, timer);
  }

  _nextScanAt = new Date(Date.now() + (_config.scanIntervalMs)).toISOString();
  console.log(`[market-scanner] ✅ Started — watching ${_config.coins.length} coins on [${_config.timeframes.join(', ')}]`);
}

export function stopMarketScanner(): void {
  for (const [tf, timer] of _timers) {
    clearInterval(timer);
    console.log(`[market-scanner] stopped ${tf} timer`);
  }
  _timers.clear();
}

export async function triggerManualScan(timeframe: ScanTimeframe = '1h'): Promise<ScanResult[]> {
  await runScan(timeframe);
  return _lastResults;
}

export const DEFAULT_SCAN_COINS = DEFAULT_COINS;
