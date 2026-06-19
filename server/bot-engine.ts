import { storage } from './storage';
import type { BotSettings, BotTrade, Signal } from '@shared/schema';
import { placeBinanceOrder, placeBybitOrder, placeMexcOrder, getBinanceBalance, getBybitBalance, getMexcBalance, getExchangePositions, type ExchangeName } from './exchanges';

const GRADE_RANK: Record<string, number> = { 'A+': 4, A: 3, B: 2, C: 1, 'No Trade': 0 };

export type ExecMode = 'paper' | 'testnet' | 'live';

function utcDayStart(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export function normalizeSymbol(coin: string): string {
  const c = (coin || '').toUpperCase().trim();
  if (!c) return '';
  if (c.endsWith('USDT') || c.endsWith('USD')) return c;
  return `${c}USDT`;
}

/**
 * Phase 1 placeholder grading. The full confluence engine (Phase 2) will
 * replace this with the 17-factor confluence score. Until then we derive a
 * grade from confidence + realised R:R so the eligibility flow is meaningful.
 */
export function deriveGrade(confidence: number, rr: number): string {
  if (confidence >= 85 && rr >= 2) return 'A+';
  if (confidence >= 75 && rr >= 1.5) return 'A';
  if (confidence >= 65) return 'B';
  if (confidence >= 50) return 'C';
  return 'No Trade';
}

export interface PositionSizing {
  ok: boolean;
  reason?: string;
  riskAmount: number;
  stopDistance: number;
  positionSize: number;
  notionalValue: number;
  requiredMargin: number;
}

/**
 * 2%-risk position sizing (spec formula).
 *   riskAmount   = walletBalance * riskPercent/100
 *   stopDistance = |entry - stopLoss|
 *   positionSize = riskAmount / stopDistance
 *   notional     = positionSize * entry
 *   margin       = notional / leverage
 */
export function computePositionSize(params: {
  walletBalance: number;
  riskPercent: number;
  entry: number;
  stopLoss: number;
  leverage: number;
}): PositionSizing {
  const { walletBalance, riskPercent, entry, stopLoss, leverage } = params;
  const empty = { riskAmount: 0, stopDistance: 0, positionSize: 0, notionalValue: 0, requiredMargin: 0 };

  if (!(walletBalance > 0)) return { ok: false, reason: 'Wallet balance is zero', ...empty };
  if (!(entry > 0)) return { ok: false, reason: 'Entry price missing', ...empty };
  if (!(stopLoss > 0)) return { ok: false, reason: 'Stop-loss missing', ...empty };
  if (!(leverage > 0)) return { ok: false, reason: 'Invalid leverage', ...empty };

  const stopDistance = Math.abs(entry - stopLoss);
  if (!(stopDistance > 0)) return { ok: false, reason: 'Stop distance is zero', ...empty };

  const riskAmount = walletBalance * (riskPercent / 100);
  const positionSize = riskAmount / stopDistance;
  const notionalValue = positionSize * entry;
  const requiredMargin = notionalValue / leverage;

  return { ok: true, riskAmount, stopDistance, positionSize, notionalValue, requiredMargin };
}

function safeLeverage(s: BotSettings): number {
  return Math.max(1, Math.min(s.defaultLeverage, s.maxLeverage, s.hardLeverageCap));
}

// ---- Computed daily / lock metrics (compute-on-read, UTC, no cron) ----

export interface BotMetrics {
  dayStart: string;
  openTrades: number;
  tradesToday: number;
  closedToday: number;
  dailyPnl: number;
  dailyLossLimitUsd: number;
  dailyLossUsedUsd: number;
  dailyLossUsedPct: number;
  consecutiveLosses: number;
  marginInUse: number;
  availableBalance: number;
  currentRiskPerTradeUsd: number;
}

export async function computeMetrics(s: BotSettings, trades: BotTrade[]): Promise<BotMetrics> {
  const dayStart = utcDayStart();
  const open = trades.filter((t) => t.status === 'open');
  const closed = trades.filter((t) => t.status === 'closed' && t.closedAt);
  const closedToday = closed.filter((t) => t.closedAt! >= dayStart);
  const tradesToday = trades.filter((t) => t.createdAt >= dayStart && t.status !== 'cancelled').length;

  const dailyPnl = closedToday.reduce((sum, t) => sum + (t.pnl || 0), 0);
  const dailyLossLimitUsd = s.paperBalance * (s.maxDailyLossPercent / 100);
  const dailyLossUsedUsd = Math.max(0, -dailyPnl);
  const dailyLossUsedPct = dailyLossLimitUsd > 0 ? (dailyLossUsedUsd / dailyLossLimitUsd) * 100 : 0;

  // Consecutive losses: scan most-recently-closed trades until a win breaks the streak.
  const byClose = [...closed].sort((a, b) => b.closedAt!.getTime() - a.closedAt!.getTime());
  let consecutiveLosses = 0;
  for (const t of byClose) {
    if ((t.pnl || 0) < 0) consecutiveLosses++;
    else break;
  }

  const marginInUse = open.reduce((sum, t) => sum + (t.marginUsed || 0), 0);
  const availableBalance = Math.max(0, s.paperBalance - marginInUse);
  const currentRiskPerTradeUsd = s.paperBalance * (s.riskPerTradePercent / 100);

  return {
    dayStart: dayStart.toISOString(),
    openTrades: open.length,
    tradesToday,
    closedToday: closedToday.length,
    dailyPnl,
    dailyLossLimitUsd,
    dailyLossUsedUsd,
    dailyLossUsedPct,
    consecutiveLosses,
    marginInUse,
    availableBalance,
    currentRiskPerTradeUsd,
  };
}

/** Reasons a NEW trade cannot open right now (independent of any one signal). */
export function stateBlockReasons(s: BotSettings, m: BotMetrics): string[] {
  const reasons: string[] = [];
  if (s.status === 'stopped') reasons.push(s.lockReason || 'Bot is stopped');
  if (s.status === 'paused') reasons.push('Bot is paused');
  if (m.dailyLossUsedUsd >= m.dailyLossLimitUsd && m.dailyLossLimitUsd > 0)
    reasons.push('Daily loss limit reached');
  if (m.consecutiveLosses >= s.stopAfterLosses)
    reasons.push(`Stopped after ${s.stopAfterLosses} consecutive losses`);
  if (m.tradesToday >= s.maxTradesPerDay) reasons.push('Max trades per day reached');
  if (m.openTrades >= s.maxOpenTrades) reasons.push('Max open trades reached');
  return reasons;
}

export function effectiveState(s: BotSettings, m: BotMetrics): 'active' | 'paused' | 'stopped' | 'locked' {
  if (s.status === 'stopped') return 'stopped';
  const hardLock =
    (m.dailyLossUsedUsd >= m.dailyLossLimitUsd && m.dailyLossLimitUsd > 0) ||
    m.consecutiveLosses >= s.stopAfterLosses;
  if (hardLock) return 'locked';
  return s.status as 'active' | 'paused';
}

// ---- Dashboard state ----

export async function getBotState() {
  const s = await storage.getBotSettings();
  const trades = await storage.getBotTrades(200);
  const metrics = await computeMetrics(s, trades);
  const reasons = stateBlockReasons(s, metrics);
  const eff = effectiveState(s, metrics);

  const open = trades.filter((t) => t.status === 'open');
  const lastExecuted = trades.find((t) => t.status === 'open' || t.status === 'closed') || null;

  const logs = await storage.getBotLogs(50);
  const lastRejectedLog = logs.find((l) => l.event === 'SIGNAL_REJECTED') || null;

  const paperTradeCount = trades.filter((t) => t.mode === 'paper').length;

  return {
    settings: s,
    metrics,
    effectiveState: eff,
    canTrade: eff === 'active' && reasons.length === 0,
    blockReasons: reasons,
    openTrades: open,
    lastExecuted,
    lastRejected: lastRejectedLog,
    liveReadiness: {
      unlocked: s.liveUnlocked,
      disclaimerAccepted: s.riskDisclaimerAccepted,
      paperTradeCount,
      paperTradesRequired: 5,
    },
    // Phase-1 connectivity stubs (no live exchange wiring yet)
    apiStatus: 'paper',
    marketDataStatus: 'live',
    dataFreshness: 'fresh',
  };
}

// ---- Execution ----

export interface ExecResult {
  ok: boolean;
  rejected?: boolean;
  notWired?: boolean;
  code?: string;
  message: string;
  reasons?: string[];
  grade?: string;
  rr?: number;
  sizing?: PositionSizing;
  trade?: BotTrade;
}

async function dispatchOrder(
  s: BotSettings,
  intent: {
    signalId: string;
    symbol: string;
    exchange: string;
    direction: string;
    timeframe: string | null;
    strategy: string | null;
    entry: number;
    stopLoss: number;
    tp1: number | null;
    positionSize: number;
    leverage: number;
    marginUsed: number;
    riskAmount: number;
    grade: string;
    confidence: number;
    rr: number;
  },
): Promise<ExecResult> {
  // Live / Testnet execution — route to real exchange
  if (s.mode === 'live' || s.mode === 'testnet') {
    const ss = s as any;
    const exchange = (intent.exchange || s.connectedExchange || 'bybit') as ExchangeName;

    // Resolve API keys based on exchange and mode
    let apiKey = '';
    let apiSecret = '';
    if (exchange === 'binance') {
      apiKey = ss.binanceApiKey || '';
      apiSecret = ss.binanceApiSecret || '';
    } else if (exchange === 'bybit') {
      apiKey = ss.bybitApiKey || '';
      apiSecret = ss.bybitApiSecret || '';
    } else if (exchange === 'mexc') {
      apiKey = ss.mexcApiKey || '';
      apiSecret = ss.mexcApiSecret || '';
    }

    if (!apiKey || !apiSecret) {
      return { ok: false, rejected: true, message: `No API keys configured for ${exchange}. Add them in Settings → Exchange.` };
    }

    // Verify real-time balance before placing order
    let balance = { ok: false, availableBalance: 0 };
    try {
      if (exchange === 'binance') balance = await getBinanceBalance(apiKey, apiSecret);
      else if (exchange === 'bybit') balance = await getBybitBalance(apiKey, apiSecret);
      else balance = await getMexcBalance(apiKey, apiSecret);
    } catch { /* non-fatal — proceed with sizing check */ }

    if (balance.ok && balance.availableBalance < intent.marginUsed) {
      return { ok: false, rejected: true, message: `Insufficient balance: need $${intent.marginUsed.toFixed(2)}, available $${balance.availableBalance.toFixed(2)}` };
    }

    const side = intent.direction === 'LONG' ? 'BUY' : 'SELL';
    let result;
    if (exchange === 'binance') {
      result = await placeBinanceOrder(apiKey, apiSecret, {
        symbol: intent.symbol, side, quantity: intent.positionSize,
        orderType: 'MARKET', leverage: intent.leverage,
        marginType: ss.defaultMarginType || 'ISOLATED',
        stopLoss: intent.stopLoss, takeProfit: intent.tp1 ?? undefined,
      });
    } else if (exchange === 'bybit') {
      result = await placeBybitOrder(apiKey, apiSecret, {
        symbol: intent.symbol, side, quantity: intent.positionSize,
        orderType: 'MARKET', leverage: intent.leverage,
        marginType: ss.defaultMarginType || 'ISOLATED',
        stopLoss: intent.stopLoss, takeProfit: intent.tp1 ?? undefined,
      });
    } else {
      result = await placeMexcOrder(apiKey, apiSecret, {
        symbol: intent.symbol, side, quantity: intent.positionSize,
        orderType: 'MARKET', leverage: intent.leverage,
        marginType: ss.defaultMarginType || 'ISOLATED',
        stopLoss: intent.stopLoss, takeProfit: intent.tp1 ?? undefined,
      });
    }

    if (!result.ok) {
      await storage.createBotLog({
        level: 'error',
        event: 'ORDER_REJECTED_BY_EXCHANGE',
        message: `${s.mode.toUpperCase()} order rejected by ${exchange}: ${result.message}`,
        meta: { intent, error: result.message },
      });
      return { ok: false, rejected: true, message: `Exchange rejected order: ${result.message}` };
    }

    const trade = await storage.createBotTrade({
      signalId: intent.signalId,
      exchange: intent.exchange,
      mode: s.mode,
      symbol: intent.symbol,
      direction: intent.direction,
      timeframe: intent.timeframe,
      strategy: intent.strategy,
      entry: intent.entry,
      stopLoss: intent.stopLoss,
      tp1: intent.tp1,
      tp2: null, tp3: null,
      positionSize: intent.positionSize,
      leverage: intent.leverage,
      marginUsed: intent.marginUsed,
      riskAmount: intent.riskAmount,
      walletBefore: balance.ok ? balance.totalWalletBalance : s.paperBalance,
      grade: intent.grade,
      confidence: intent.confidence,
      rr: intent.rr,
      status: 'open',
      exchangeOrderId: result.orderId,
    } as any);

    await storage.createBotLog({
      level: 'success',
      event: 'ORDER_SUBMITTED',
      message: `${s.mode.toUpperCase()} order placed on ${exchange}: ${intent.symbol} ${intent.direction} @ ${intent.entry} (orderId: ${result.orderId})`,
      meta: { tradeId: trade.id, orderId: result.orderId, grade: intent.grade, rr: intent.rr },
    });
    await storage.updateSignalStatus(intent.signalId, 'EXECUTED');
    return { ok: true, message: `${s.mode.toUpperCase()} order placed on ${exchange}: ${intent.symbol}`, trade, grade: intent.grade, rr: intent.rr };
  }

  const trade = await storage.createBotTrade({
    signalId: intent.signalId,
    exchange: intent.exchange,
    mode: 'paper',
    symbol: intent.symbol,
    direction: intent.direction,
    timeframe: intent.timeframe,
    strategy: intent.strategy,
    entry: intent.entry,
    stopLoss: intent.stopLoss,
    tp1: intent.tp1,
    tp2: null,
    tp3: null,
    positionSize: intent.positionSize,
    leverage: intent.leverage,
    marginUsed: intent.marginUsed,
    riskAmount: intent.riskAmount,
    walletBefore: s.paperBalance,
    grade: intent.grade,
    confidence: intent.confidence,
    rr: intent.rr,
    status: 'open',
  });

  await storage.createBotLog({
    level: 'success',
    event: 'ORDER_SUBMITTED',
    message: `Paper trade opened: ${intent.symbol} ${intent.direction} @ ${intent.entry} (size ${intent.positionSize.toFixed(4)}, ${intent.leverage}x)`,
    meta: { tradeId: trade.id, grade: intent.grade, rr: intent.rr },
  });
  await storage.createBotLog({
    level: 'info',
    event: 'STOP_LOSS_CONFIRMED',
    message: `Stop-loss attached @ ${intent.stopLoss} — risk ${intent.riskAmount.toFixed(2)} USDT`,
    meta: { tradeId: trade.id },
  });

  await storage.updateSignalStatus(intent.signalId, 'EXECUTED');

  return { ok: true, message: `Paper trade opened for ${intent.symbol}`, trade, grade: intent.grade, rr: intent.rr };
}

export async function executeSignal(signalId: string): Promise<ExecResult> {
  const s = await storage.getBotSettings();
  const signal: Signal | undefined = await storage.getSignal(signalId);
  if (!signal) return { ok: false, rejected: true, message: 'Signal not found', reasons: ['Signal not found'] };

  const symbol = normalizeSymbol(signal.coin);
  const direction = signal.type;
  const entry = signal.entry;
  const sl = signal.sl;
  const tp1 = signal.tp;

  // Basic completeness
  const reasons: string[] = [];
  if (!entry) reasons.push('Entry is missing');
  if (!sl) reasons.push('Stop-loss is missing');
  if (!tp1) reasons.push('Take-profit is missing');

  const rr = entry && sl && tp1 ? Math.abs(tp1 - entry) / Math.abs(entry - sl) : 0;
  const grade = deriveGrade(signal.confidence, rr);

  // Current state / lock reasons (re-evaluated at write time)
  const trades = await storage.getBotTrades(200);
  const metrics = await computeMetrics(s, trades);
  reasons.push(...stateBlockReasons(s, metrics));
  if (s.status !== 'active') {
    // already captured by stateBlockReasons for paused/stopped; guard for safety
    if (!reasons.length) reasons.push('Bot is not active');
  }

  // Signal gating
  if (!s.allowedSymbols.includes(symbol)) reasons.push(`Symbol ${symbol} is not in the allowed list`);
  if (GRADE_RANK[grade] < (GRADE_RANK[s.minGrade] ?? 4)) reasons.push(`Grade ${grade} is below minimum ${s.minGrade}`);
  if (signal.confidence < s.minConfidence) reasons.push(`Confidence ${signal.confidence}% is below ${s.minConfidence}%`);
  if (rr < s.minRr) reasons.push(`R:R ${rr.toFixed(2)} is below minimum ${s.minRr}`);

  // Risk sizing
  const leverage = safeLeverage(s);
  const sizing = computePositionSize({
    walletBalance: s.paperBalance,
    riskPercent: s.riskPerTradePercent,
    entry,
    stopLoss: sl,
    leverage,
  });
  if (!sizing.ok) reasons.push(sizing.reason || 'Position size calculation failed');
  else if (sizing.requiredMargin > metrics.availableBalance)
    reasons.push('Required margin exceeds available balance');

  if (reasons.length > 0) {
    await storage.createBotLog({
      level: 'warn',
      event: 'SIGNAL_REJECTED',
      message: `Signal ${symbol} ${direction} rejected — ${reasons[0]}`,
      meta: { signalId, reasons, grade, rr, confidence: signal.confidence },
    });
    return { ok: false, rejected: true, message: reasons[0], reasons, grade, rr, sizing };
  }

  await storage.createBotLog({
    level: 'success',
    event: 'SIGNAL_APPROVED',
    message: `Signal ${symbol} ${direction} approved (grade ${grade}, R:R ${rr.toFixed(2)})`,
    meta: { signalId, grade, rr },
  });

  const exchange = s.connectedExchange === 'both' ? 'bybit' : s.connectedExchange;
  return dispatchOrder(s, {
    signalId,
    symbol,
    exchange,
    direction,
    timeframe: signal.timeframe,
    strategy: signal.strategy,
    entry,
    stopLoss: sl,
    tp1,
    positionSize: sizing.positionSize,
    leverage,
    marginUsed: sizing.requiredMargin,
    riskAmount: sizing.riskAmount,
    grade,
    confidence: signal.confidence,
    rr,
  });
}

export async function closeBotTrade(id: string, exitPrice: number, exitReason = 'manual') {
  const trade = await storage.getBotTrade(id);
  if (!trade) return { ok: false, message: 'Trade not found' };
  if (trade.status !== 'open') return { ok: false, message: 'Trade is not open' };
  if (!(exitPrice > 0)) return { ok: false, message: 'Invalid exit price' };

  const s = await storage.getBotSettings();
  const dir = trade.direction === 'LONG' ? 1 : -1;
  const pnl = (exitPrice - trade.entry) * trade.positionSize * dir;
  const newBalance = s.paperBalance + pnl;

  await storage.upsertBotSettings({ paperBalance: newBalance });
  const updated = await storage.updateBotTrade(id, {
    status: 'closed',
    exitPrice,
    pnl,
    walletAfter: newBalance,
    exitReason,
    closedAt: new Date(),
  });

  await storage.createBotLog({
    level: pnl >= 0 ? 'success' : 'warn',
    event: pnl >= 0 ? 'TRADE_CLOSED_WIN' : 'TRADE_CLOSED_LOSS',
    message: `Paper trade closed: ${trade.symbol} ${trade.direction} ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)} USDT`,
    meta: { tradeId: id, pnl, exitPrice },
  });

  return { ok: true, message: 'Trade closed', trade: updated, pnl };
}

// ---- Controls ----

export async function botControl(action: 'start' | 'pause' | 'resume' | 'emergency-stop') {
  let update: Partial<BotSettings> = {};
  let level: 'info' | 'warn' | 'error' = 'info';

  if (action === 'start' || action === 'resume') {
    update = { status: 'active', lockReason: null };
  } else if (action === 'pause') {
    update = { status: 'paused' };
  } else if (action === 'emergency-stop') {
    update = { status: 'stopped', lockReason: 'Emergency stop activated' };
    level = 'error';
    const open = await storage.getOpenBotTrades();
    for (const t of open) {
      await storage.updateBotTrade(t.id, { status: 'cancelled', exitReason: 'emergency-stop', closedAt: new Date() });
    }
  } else {
    return { ok: false, message: 'Unknown action' };
  }

  const updated = await storage.upsertBotSettings(update);
  await storage.createBotLog({
    level,
    event: `BOT_${action.toUpperCase().replace(/-/g, '_')}`,
    message: action === 'emergency-stop' ? 'Emergency stop triggered — all open paper trades cancelled' : `Bot ${action}`,
  });
  return { ok: true, settings: updated };
}

export async function setBotMode(mode: ExecMode) {
  if (!['paper', 'testnet', 'live'].includes(mode)) return { ok: false, message: 'Invalid mode' };
  const s = await storage.getBotSettings();
  if (mode === 'live' && !s.liveUnlocked) {
    return { ok: false, message: 'Live trading is locked. Complete the unlock requirements first.' };
  }
  const updated = await storage.upsertBotSettings({ mode });
  await storage.createBotLog({ level: 'info', event: 'MODE_CHANGED', message: `Trading mode changed to ${mode}` });
  return { ok: true, settings: updated };
}

export async function unlockLive(accepted: boolean) {
  const s = await storage.getBotSettings();
  if (!accepted) return { ok: false, message: 'You must accept the risk disclaimer to unlock live trading.' };

  const trades = await storage.getBotTrades(1000);
  const paperCount = trades.filter((t) => t.mode === 'paper').length;
  if (paperCount < 5) {
    return {
      ok: false,
      message: `Complete at least 5 paper trades before enabling live trading (currently ${paperCount}).`,
      paperTradeCount: paperCount,
      required: 5,
    };
  }

  const updated = await storage.upsertBotSettings({ liveUnlocked: true, riskDisclaimerAccepted: true });
  await storage.createBotLog({ level: 'warn', event: 'LIVE_UNLOCKED', message: 'Live trading unlocked by user' });
  return { ok: true, settings: updated };
}

export async function applySafeModePreset() {
  const update: Partial<BotSettings> = {
    paperBalance: 100,
    paperStartingBalance: 100,
    riskPerTradePercent: 2,
    maxDailyLossPercent: 4,
    maxOpenTrades: 1,
    maxTradesPerDay: 2,
    stopAfterLosses: 2,
    defaultLeverage: 3,
    maxLeverage: 5,
    hardLeverageCap: 10,
    minGrade: 'A+',
    minConfidence: 85,
    minRr: 2,
    allowedSymbols: ['BTCUSDT', 'ETHUSDT'],
    manualApproval: true,
    autoExecute: false,
    newsFilter: true,
    macroFilter: true,
    dataStaleFilter: true,
    liquidityFilter: true,
    spreadFilter: true,
  };
  const updated = await storage.upsertBotSettings(update);
  await storage.createBotLog({ level: 'info', event: 'PRESET_APPLIED', message: '$100 Small Account Safe Mode preset applied' });
  return updated;
}
