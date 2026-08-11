/**
 * Risk Management Agent
 * Dynamic position sizing, correlation detection, drawdown management,
 * Kelly Criterion, and volatility-adjusted stops.
 */
import { callAIProvider, getActiveProviders, extractJson, type AIMessage } from '../ai-providers';
import { storage } from '../storage';
import type { BotTrade } from '@shared/schema';

export interface RiskAssessment {
  approved: boolean;
  riskScore: number;          // 0-100, higher = more risky
  recommendedRiskPct: number; // adjusted risk per trade (0.5 - 5.0%)
  recommendedLeverage: number;
  recommendedSize: number;    // position size in base currency
  adjustedSL: number;         // volatility-adjusted stop loss
  maxLossUSD: number;
  portfolioHeat: number;      // 0-100, how much portfolio is at risk
  correlationWarning: boolean;
  correlatedCoins: string[];
  kellyFraction: number;      // 0-1
  reasons: string[];
  warnings: string[];
  blocked: boolean;
  blockReason?: string;
}

export interface DrawdownState {
  currentDrawdown: number;     // % from peak
  peakBalance: number;
  currentBalance: number;
  consecutiveLosses: number;
  dailyLoss: number;           // USD
  dailyLossPct: number;        // % of starting balance
  riskReductionFactor: number; // 1.0 = normal, 0.5 = 50% reduced size
}

// Correlation map — coins that move together
const CORRELATION_GROUPS: string[][] = [
  ['BTC', 'ETH'],                          // Blue chips (highly correlated)
  ['SOL', 'AVAX', 'NEAR', 'APT', 'SUI'],  // L1 alts
  ['BNB', 'CAKE'],                          // BSC ecosystem
  ['LINK', 'BAND', 'API3'],               // Oracle tokens
  ['UNI', 'SUSHI', 'CAKE', 'CRV'],       // DEX tokens
  ['DOGE', 'SHIB', 'PEPE', 'FLOKI'],     // Meme coins
  ['ADA', 'XRP', 'XLM'],                 // Legacy alts
  ['MATIC', 'ARB', 'OP', 'BASE'],        // L2 tokens
];

function getCorrelatedCoins(coin: string): string[] {
  const c = coin.toUpperCase().replace('USDT', '').replace('USD', '');
  for (const group of CORRELATION_GROUPS) {
    if (group.includes(c)) return group.filter(x => x !== c);
  }
  return [];
}

function detectCorrelationRisk(
  coin: string,
  direction: 'LONG' | 'SHORT',
  openTrades: BotTrade[],
): { hasCorrelation: boolean; correlatedCoins: string[] } {
  const correlated = getCorrelatedCoins(coin);
  const openLongs = openTrades.filter(t => t.status === 'open' && t.direction === 'LONG');
  const openShorts = openTrades.filter(t => t.status === 'open' && t.direction === 'SHORT');

  const conflictingTrades = direction === 'LONG'
    ? openLongs.filter(t => correlated.includes(t.symbol.replace('USDT', '')))
    : openShorts.filter(t => correlated.includes(t.symbol.replace('USDT', '')));

  const conflictingCoins = conflictingTrades.map(t => t.symbol.replace('USDT', ''));
  return { hasCorrelation: conflictingCoins.length > 0, correlatedCoins: conflictingCoins };
}

function computeKelly(winRate: number, avgWin: number, avgLoss: number): number {
  // Kelly Criterion: f* = (bp - q) / b
  // b = avg win / avg loss, p = win rate, q = 1 - p
  if (avgLoss <= 0 || winRate <= 0) return 0.02; // default 2%
  const b = avgWin / avgLoss;
  const p = winRate;
  const q = 1 - p;
  const kelly = (b * p - q) / b;
  // Use half-Kelly for safety
  return Math.min(0.05, Math.max(0.005, kelly * 0.5));
}

async function computeHistoricalStats(trades: BotTrade[]): Promise<{
  winRate: number; avgWin: number; avgLoss: number; sharpe: number
}> {
  const closed = trades.filter(t => t.status === 'closed' && t.pnl !== null);
  if (closed.length < 5) return { winRate: 0.5, avgWin: 2, avgLoss: 1, sharpe: 1 };

  const pnls = closed.map(t => t.pnl ?? 0);
  const wins = pnls.filter(p => p > 0);
  const losses = pnls.filter(p => p < 0);
  const winRate = wins.length / pnls.length;
  const avgWin = wins.length > 0 ? wins.reduce((a, b) => a + b, 0) / wins.length : 1;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((a, b) => a + b, 0) / losses.length) : 1;

  // Simplified Sharpe (daily returns approximation)
  const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length;
  const variance = pnls.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / pnls.length;
  const sharpe = variance > 0 ? mean / Math.sqrt(variance) : 1;

  return { winRate, avgWin, avgLoss, sharpe: Math.max(0, sharpe) };
}

export async function computeDrawdownState(trades: BotTrade[], startingBalance: number): Promise<DrawdownState> {
  const closed = trades.filter(t => t.status === 'closed').sort(
    (a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime()
  );

  let balance = startingBalance;
  let peak = startingBalance;
  for (const t of closed) {
    balance += t.pnl ?? 0;
    if (balance > peak) peak = balance;
  }

  const currentDrawdown = peak > 0 ? ((peak - balance) / peak) * 100 : 0;

  // Daily metrics
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);
  const todayTrades = closed.filter(t => new Date(t.closedAt ?? 0) >= today);
  const dailyLoss = Math.abs(Math.min(0, todayTrades.reduce((s, t) => s + (t.pnl ?? 0), 0)));
  const dailyLossPct = startingBalance > 0 ? (dailyLoss / startingBalance) * 100 : 0;

  // Consecutive losses
  const recent = closed.slice(-10).reverse();
  let consecutiveLosses = 0;
  for (const t of recent) {
    if ((t.pnl ?? 0) < 0) consecutiveLosses++;
    else break;
  }

  // Risk reduction based on drawdown
  let riskReductionFactor = 1.0;
  if (currentDrawdown >= 20) riskReductionFactor = 0.25;
  else if (currentDrawdown >= 15) riskReductionFactor = 0.5;
  else if (currentDrawdown >= 10) riskReductionFactor = 0.75;
  else if (consecutiveLosses >= 3) riskReductionFactor = 0.75;

  return {
    currentDrawdown, peakBalance: peak, currentBalance: balance,
    consecutiveLosses, dailyLoss, dailyLossPct, riskReductionFactor,
  };
}

// ─── Volatility Regime Detection ─────────────────────────────────────────────

export interface VolatilityRegime {
  regime: 'NORMAL' | 'ELEVATED' | 'EXTREME';
  realizedVol: number;    // annualized %, last 24h
  avgVol30d: number;      // annualized %, 30-day average
  positionSizeMultiplier: number; // 1.0 | 0.5 | 0.25
}

export async function detectRegime(candles: { close: number }[]): Promise<VolatilityRegime> {
  const fallback: VolatilityRegime = { regime: 'NORMAL', realizedVol: 0, avgVol30d: 0, positionSizeMultiplier: 1.0 };
  if (candles.length < 30) return fallback;

  const closes = candles.map(c => c.close).filter(v => v > 0);
  if (closes.length < 30) return fallback;

  const logReturns = closes.slice(1).map((c, i) => Math.log(c / closes[i]));

  // Realized vol of last 24 bars (annualized)
  const recent = logReturns.slice(-24);
  const recentMean = recent.reduce((a, b) => a + b, 0) / recent.length;
  const recentVar = recent.reduce((a, b) => a + Math.pow(b - recentMean, 2), 0) / recent.length;
  const realizedVol = Math.sqrt(recentVar * 365 * 24) * 100;

  // 30-day average vol
  const all = logReturns.slice(-720); // 30d × 24h
  const allMean = all.reduce((a, b) => a + b, 0) / all.length;
  const allVar = all.reduce((a, b) => a + Math.pow(b - allMean, 2), 0) / all.length;
  const avgVol30d = Math.sqrt(allVar * 365 * 24) * 100;

  const ratio = avgVol30d > 0 ? realizedVol / avgVol30d : 1;
  let regime: VolatilityRegime['regime'] = 'NORMAL';
  let positionSizeMultiplier = 1.0;
  if (ratio >= 2.5) { regime = 'EXTREME'; positionSizeMultiplier = 0.25; }
  else if (ratio >= 1.5) { regime = 'ELEVATED'; positionSizeMultiplier = 0.5; }

  return { regime, realizedVol, avgVol30d, positionSizeMultiplier };
}

// ─── Weekly loss limit check ──────────────────────────────────────────────────

export function checkWeeklyLossLimit(trades: BotTrade[], startingBalance: number, weeklyLimitPct = 6.0): boolean {
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const weekTrades = trades.filter(t => t.status === 'closed' && t.closedAt && new Date(t.closedAt) >= weekAgo);
  const weekPnl = weekTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const weekLossPct = startingBalance > 0 ? (-weekPnl / startingBalance) * 100 : 0;
  return weekLossPct >= weeklyLimitPct;
}

export async function assessTradeRisk(params: {
  coin: string;
  direction: 'LONG' | 'SHORT';
  entry: number;
  sl: number;
  tp: number;
  confidence: number;
  timeframe: string;
  walletBalance: number;
  openTrades: BotTrade[];
  allTrades: BotTrade[];
  baseRiskPct: number;
  baseLeverage: number;
  startingBalance: number;
}): Promise<RiskAssessment> {
  const {
    coin, direction, entry, sl, tp, confidence,
    walletBalance, openTrades, allTrades, baseRiskPct, baseLeverage, startingBalance,
  } = params;

  const reasons: string[] = [];
  const warnings: string[] = [];
  let riskScore = 0;
  let blocked = false;
  let blockReason: string | undefined;

  // 1. Drawdown state
  const ddState = await computeDrawdownState(allTrades, startingBalance);
  const riskReductionFactor = ddState.riskReductionFactor;

  if (ddState.currentDrawdown >= 20) {
    blocked = true;
    blockReason = `Drawdown ${ddState.currentDrawdown.toFixed(1)}% — bot locked until manual reset`;
  } else if (ddState.currentDrawdown >= 15) {
    warnings.push(`Drawdown ${ddState.currentDrawdown.toFixed(1)}% — trading at 50% size`);
    riskScore += 30;
  } else if (ddState.dailyLossPct >= 5) {
    warnings.push(`Daily loss ${ddState.dailyLossPct.toFixed(1)}% — approaching limit`);
    riskScore += 20;
  }

  if (ddState.consecutiveLosses >= 5) {
    blocked = true;
    blockReason = `${ddState.consecutiveLosses} consecutive losses — manual review required`;
  } else if (ddState.consecutiveLosses >= 3) {
    warnings.push(`${ddState.consecutiveLosses} consecutive losses — size reduced`);
    riskScore += 15;
  }

  // 1b. Weekly loss limit (-6% weekly)
  if (checkWeeklyLossLimit(allTrades, startingBalance)) {
    blocked = true;
    blockReason = 'Weekly loss limit (-6%) reached — trading paused until next week';
  }

  // 2. Correlation check
  const { hasCorrelation, correlatedCoins } = detectCorrelationRisk(coin, direction, openTrades);
  if (hasCorrelation) {
    if (correlatedCoins.length >= 3) {
      blocked = true;
      blockReason = `Too many correlated ${direction} positions: ${correlatedCoins.join(', ')}`;
    } else {
      warnings.push(`Correlated positions open: ${correlatedCoins.join(', ')} — portfolio concentration risk`);
      riskScore += 20;
    }
  }

  // 3. Portfolio heat (total margin at risk)
  const totalMarginUsed = openTrades
    .filter(t => t.status === 'open')
    .reduce((s, t) => s + (t.marginUsed ?? 0), 0);
  const portfolioHeat = walletBalance > 0 ? (totalMarginUsed / walletBalance) * 100 : 0;

  if (portfolioHeat >= 80) {
    blocked = true;
    blockReason = `Portfolio heat ${portfolioHeat.toFixed(0)}% — too much capital at risk`;
  } else if (portfolioHeat >= 60) {
    warnings.push(`Portfolio heat ${portfolioHeat.toFixed(0)}% — reduce new positions`);
    riskScore += 20;
  }

  // 4. Kelly Criterion
  const { winRate, avgWin, avgLoss, sharpe } = await computeHistoricalStats(allTrades);
  const kellyFraction = computeKelly(winRate, avgWin, avgLoss);

  // 5. Compute final risk %
  // Hard cap: 0.5-1.0% per trade (plan constraint — not config-overridable below this floor)
  const adjustedRiskPct = Math.min(
    baseRiskPct * riskReductionFactor,
    kellyFraction * 100,
    1.0,  // hard cap at 1%
  );
  const clampedRiskPct = Math.max(0.5, adjustedRiskPct); // floor at 0.5%

  // 6. R:R check
  const rr = Math.abs(tp - entry) / Math.abs(entry - sl);
  if (rr < 1.0) {
    // Risking more than the potential reward — never tradeable, regardless of confidence
    blocked = true;
    blockReason = `R:R ${rr.toFixed(2)} — risk exceeds reward, signal rejected`;
  } else if (rr < 1.5) {
    riskScore += 25;
    warnings.push(`Low R:R ratio (${rr.toFixed(2)}) — minimum 1.5 recommended`);
  } else if (rr >= 3.0) {
    riskScore -= 10; // bonus for excellent R:R
    reasons.push(`Excellent R:R ${rr.toFixed(2)}`);
  }

  // 6b. Stop-loss distance sanity check — catch structurally-derived stops that
  // are unreasonably far from entry (data error or bad swing-point selection)
  const slDistancePct = entry > 0 ? (Math.abs(entry - sl) / entry) * 100 : 0;
  const MAX_SL_DISTANCE_PCT = 8; // beyond this, a "swing" stop is no longer a risk-managed stop
  if (slDistancePct > MAX_SL_DISTANCE_PCT) {
    blocked = true;
    blockReason = `Stop-loss ${slDistancePct.toFixed(1)}% from entry exceeds ${MAX_SL_DISTANCE_PCT}% max — signal rejected`;
  } else if (slDistancePct > MAX_SL_DISTANCE_PCT * 0.6) {
    riskScore += 15;
    warnings.push(`Wide stop-loss (${slDistancePct.toFixed(1)}% from entry) — verify structure before sizing`);
  }

  // 7. Confidence-based risk scaling
  const confFactor = confidence / 100;
  const finalRiskPct = Math.max(0.5, clampedRiskPct * Math.max(0.5, confFactor));

  // 8. Position sizing
  const stopDistance = Math.abs(entry - sl);
  const riskAmount = walletBalance * (finalRiskPct / 100);
  const recommendedSize = stopDistance > 0 ? riskAmount / stopDistance : 0;
  const maxLossUSD = riskAmount;

  // 9. Leverage recommendation
  const notional = recommendedSize * entry;
  const recommendedLeverage = Math.min(
    baseLeverage,
    walletBalance > 0 ? Math.floor(notional / (walletBalance * 0.1)) : baseLeverage, // max 10% margin per trade
    20, // hard cap
  );

  // 10. Volatility-adjusted SL (widen SL in high-ATR environments)
  const adjustedSL = sl; // ATR adjustment handled in Phase 2 — SL as-is from signal

  riskScore = Math.min(100, Math.max(0, riskScore));
  const approved = !blocked && riskScore < 80;

  return {
    approved, riskScore, recommendedRiskPct: finalRiskPct,
    recommendedLeverage: Math.max(1, recommendedLeverage),
    recommendedSize: Math.max(0, recommendedSize),
    adjustedSL, maxLossUSD, portfolioHeat,
    correlationWarning: hasCorrelation, correlatedCoins,
    kellyFraction, reasons, warnings,
    blocked, blockReason,
  };
}

export async function getRiskAIAnalysis(
  assessment: RiskAssessment,
  coin: string,
  direction: 'LONG' | 'SHORT',
  confidence: number,
): Promise<string> {
  try {
    const providers = await getActiveProviders();
    const provider = providers.find(p => p.type === 'anthropic') ?? providers[0];
    if (!provider) return '';

    const messages: AIMessage[] = [
      {
        role: 'system',
        content: 'You are a risk management specialist. Provide a 1-sentence risk assessment verdict and one actionable recommendation. Be direct.',
      },
      {
        role: 'user',
        content: `Trade: ${direction} ${coin} | Confidence: ${confidence}% | Risk Score: ${assessment.riskScore}/100 | Portfolio Heat: ${assessment.portfolioHeat.toFixed(0)}% | Kelly: ${(assessment.kellyFraction * 100).toFixed(1)}% | Drawdown warnings: ${assessment.warnings.join(', ') || 'none'}. Verdict + 1 recommendation:`,
      },
    ];

    // Prose only — every risk number was computed deterministically above.
    const res = await callAIProvider(provider, messages, {
      maxTokens: 80, tier: 'cosmetic', cacheTtlMs: 30 * 60 * 1000, label: 'risk-narrative',
    });
    return res.text.trim();
  } catch {
    return assessment.approved
      ? `Risk approved at ${assessment.recommendedRiskPct.toFixed(1)}% position size.`
      : `Risk too high — ${assessment.blockReason ?? 'review before trading'}`;
  }
}
