/**
 * Trade Journal & Learning Agent
 * Analyzes closed trades, finds winning patterns, adjusts weights,
 * and generates performance reports. Uses GPT-4o for data analysis.
 */
import { callAIProvider, getActiveProviders, extractJson, type AIMessage } from '../ai-providers';
import { storage } from '../storage';
import type { BotTrade } from '@shared/schema';

export interface TradePattern {
  factor: string;
  winRate: number;          // 0-1
  avgPnl: number;           // average P&L when this factor present
  sampleSize: number;
  recommendation: string;
}

export interface PerformanceReport {
  period: string;           // 'daily' | 'weekly' | 'monthly'
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;          // 0-1
  totalPnl: number;         // USD
  avgWin: number;           // USD
  avgLoss: number;          // USD
  profitFactor: number;     // total wins / total losses (ratio)
  maxDrawdown: number;      // %
  sharpeRatio: number;
  bestCoin: string;
  worstCoin: string;
  bestSession: string;
  bestTimeframe: string;
  bestStrategy: string;
  patterns: TradePattern[];
  weightAdjustments: WeightAdjustment[];
  aiInsights: string;
  generatedAt: string;
}

export interface WeightAdjustment {
  factor: string;
  currentWeight: number;
  suggestedWeight: number;
  reason: string;
}

// Cache to avoid re-analysis on every call
let reportCache: { report: PerformanceReport; expires: number } | null = null;
const CACHE_TTL = 60 * 60 * 1000; // 1 hour

function groupBy<T>(arr: T[], key: (item: T) => string): Record<string, T[]> {
  return arr.reduce((acc, item) => {
    const k = key(item);
    if (!acc[k]) acc[k] = [];
    acc[k].push(item);
    return acc;
  }, {} as Record<string, T[]>);
}

function computeWinRateByGroup(trades: BotTrade[], key: (t: BotTrade) => string): Record<string, { winRate: number; avgPnl: number; count: number }> {
  const groups = groupBy(trades, key);
  const result: Record<string, { winRate: number; avgPnl: number; count: number }> = {};
  for (const [k, group] of Object.entries(groups)) {
    const wins = group.filter(t => (t.pnl ?? 0) > 0).length;
    const avgPnl = group.reduce((s, t) => s + (t.pnl ?? 0), 0) / group.length;
    result[k] = { winRate: wins / group.length, avgPnl, count: group.length };
  }
  return result;
}

function getBestByWinRate(groups: Record<string, { winRate: number; count: number }>): string {
  return Object.entries(groups)
    .filter(([_, v]) => v.count >= 3) // min 3 samples
    .sort((a, b) => b[1].winRate - a[1].winRate)[0]?.[0] ?? 'Unknown';
}

function computeSharpe(pnls: number[]): number {
  if (pnls.length < 2) return 0;
  const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length;
  const variance = pnls.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / pnls.length;
  return variance > 0 ? mean / Math.sqrt(variance) : 0;
}

function computeMaxDrawdown(trades: BotTrade[], startBalance: number): number {
  let balance = startBalance;
  let peak = startBalance;
  let maxDD = 0;
  for (const t of trades.sort((a, b) => new Date(a.createdAt ?? 0).getTime() - new Date(b.createdAt ?? 0).getTime())) {
    balance += t.pnl ?? 0;
    if (balance > peak) peak = balance;
    const dd = peak > 0 ? ((peak - balance) / peak) * 100 : 0;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

async function getAIInsights(
  trades: BotTrade[],
  report: Omit<PerformanceReport, 'aiInsights' | 'patterns' | 'weightAdjustments'>,
): Promise<{ insights: string; weightAdjustments: WeightAdjustment[] }> {
  try {
    const providers = await getActiveProviders();
    const provider = providers.find(p => p.name.toLowerCase().includes('gpt') || p.type === 'custom')
      ?? providers.find(p => p.type === 'anthropic')
      ?? providers[0];
    if (!provider) return { insights: '', weightAdjustments: [] };

    const tradesSummary = trades.slice(-50).map(t =>
      `${t.direction} ${t.symbol} | ${t.strategy} | ${t.timeframe} | conf:${t.confidence}% | pnl:$${(t.pnl ?? 0).toFixed(2)} | grade:${t.grade}`
    ).join('\n');

    const messages: AIMessage[] = [
      {
        role: 'system',
        content: `You are a professional trading performance analyst. Analyze trade data and provide:
1. Key insights about what's working and what's not (3-4 bullet points)
2. Suggested weight adjustments for confluence factors

Respond ONLY in JSON format:
{
  "insights": "bullet point insights as string",
  "adjustments": [
    {"factor": "string", "currentWeight": number, "suggestedWeight": number, "reason": "string"}
  ]
}`,
      },
      {
        role: 'user',
        content: `Performance Summary:
- Win Rate: ${(report.winRate * 100).toFixed(1)}%
- Profit Factor: ${report.profitFactor.toFixed(2)}
- Total P&L: $${report.totalPnl.toFixed(2)}
- Best Coin: ${report.bestCoin} | Worst: ${report.worstCoin}
- Best Session: ${report.bestSession} | Best TF: ${report.bestTimeframe}
- Sharpe: ${report.sharpeRatio.toFixed(2)}

Recent trades (last 50):
${tradesSummary}

Current confluence factor weights (default): SMC=8, OB=7, FVG=6, LiqSweep=7, RSI=6, RSIDiv=6, MACD=6, StochRSI=5, EMA=7, ADX=5, Ichimoku=5, Volume=6, VP=5, ATR=5, MTF=7, Candle=4, Session=4

Analyze and provide insights + weight adjustments.`,
      },
    ];

    const res = await callAIProvider(provider, messages, 800);
    const json = extractJson(res.text);
    if (json) {
      const parsed = JSON.parse(json);
      return {
        insights: parsed.insights ?? '',
        weightAdjustments: (parsed.adjustments ?? []).map((a: any) => ({
          factor: a.factor,
          currentWeight: a.currentWeight,
          suggestedWeight: a.suggestedWeight,
          reason: a.reason,
        })),
      };
    }
  } catch { /* fall through */ }
  return { insights: 'AI analysis unavailable. Review trades manually.', weightAdjustments: [] };
}

export async function generatePerformanceReport(
  period: 'daily' | 'weekly' | 'monthly' = 'weekly',
  forceRefresh = false,
): Promise<PerformanceReport> {
  if (!forceRefresh && reportCache && Date.now() < reportCache.expires) {
    return reportCache.result;
  }

  const allTrades = await storage.getBotTrades();
  const closed = allTrades.filter(t => t.status === 'closed' && t.pnl !== null);

  // Filter by period
  const cutoff = new Date();
  if (period === 'daily') cutoff.setUTCDate(cutoff.getUTCDate() - 1);
  else if (period === 'weekly') cutoff.setUTCDate(cutoff.getUTCDate() - 7);
  else cutoff.setUTCMonth(cutoff.getUTCMonth() - 1);
  const periodTrades = closed.filter(t => new Date(t.closedAt ?? 0) >= cutoff);

  if (periodTrades.length === 0) {
    const empty: PerformanceReport = {
      period, totalTrades: 0, wins: 0, losses: 0, winRate: 0, totalPnl: 0,
      avgWin: 0, avgLoss: 0, profitFactor: 0, maxDrawdown: 0, sharpeRatio: 0,
      bestCoin: 'N/A', worstCoin: 'N/A', bestSession: 'N/A', bestTimeframe: 'N/A',
      bestStrategy: 'N/A', patterns: [], weightAdjustments: [],
      aiInsights: 'No closed trades in this period yet. Keep trading!',
      generatedAt: new Date().toISOString(),
    };
    return empty;
  }

  const wins = periodTrades.filter(t => (t.pnl ?? 0) > 0);
  const losses = periodTrades.filter(t => (t.pnl ?? 0) <= 0);
  const pnls = periodTrades.map(t => t.pnl ?? 0);
  const totalPnl = pnls.reduce((a, b) => a + b, 0);
  const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + (t.pnl ?? 0), 0) / wins.length : 0;
  const avgLoss = losses.length > 0 ? Math.abs(losses.reduce((s, t) => s + (t.pnl ?? 0), 0) / losses.length) : 0;
  const profitFactor = avgLoss > 0 ? (avgWin * wins.length) / (avgLoss * losses.length) : wins.length > 0 ? 999 : 0;

  // Group analysis
  const byCoin = computeWinRateByGroup(periodTrades, t => t.symbol.replace('USDT', ''));
  const byTimeframe = computeWinRateByGroup(periodTrades, t => t.timeframe ?? '1h');
  const byStrategy = computeWinRateByGroup(periodTrades, t => t.strategy ?? 'Unknown');

  const bestCoin = getBestByWinRate(byCoin);
  const worstCoin = Object.entries(byCoin)
    .filter(([_, v]) => v.count >= 3)
    .sort((a, b) => a[1].winRate - b[1].winRate)[0]?.[0] ?? 'Unknown';
  const bestTimeframe = getBestByWinRate(byTimeframe);
  const bestStrategy = getBestByWinRate(byStrategy);

  // Simple session heuristic from trade creation time
  const bySession: Record<string, BotTrade[]> = { LONDON: [], NEW_YORK: [], ASIA: [] };
  for (const t of periodTrades) {
    const h = new Date(t.createdAt ?? 0).getUTCHours();
    if (h >= 7 && h < 16) bySession['LONDON'].push(t);
    else if (h >= 13 && h < 22) bySession['NEW_YORK'].push(t);
    else bySession['ASIA'].push(t);
  }
  const sessionStats = computeWinRateByGroup(periodTrades, t => {
    const h = new Date(t.createdAt ?? 0).getUTCHours();
    return h >= 13 && h < 16 ? 'OVERLAP' : h >= 7 && h < 16 ? 'LONDON' : h >= 13 && h < 22 ? 'NEW_YORK' : 'ASIA';
  });
  const bestSession = getBestByWinRate(sessionStats);

  const settings = await storage.getSettings();
  const botSettings = await storage.getBotSettings();
  const startBalance = (botSettings as any)?.paperStartingBalance ?? 1000;
  const maxDrawdown = computeMaxDrawdown(closed, startBalance);
  const sharpeRatio = computeSharpe(pnls);

  // Pattern analysis
  const patterns: TradePattern[] = [];
  for (const [strategy, data] of Object.entries(computeWinRateByGroup(periodTrades, t => t.strategy ?? 'Unknown'))) {
    if (data.count >= 2) {
      patterns.push({
        factor: `Strategy: ${strategy}`,
        winRate: data.winRate,
        avgPnl: data.avgPnl,
        sampleSize: data.count,
        recommendation: data.winRate >= 0.6 ? `Keep using ${strategy}` : `Review or reduce ${strategy} trades`,
      });
    }
  }
  for (const [grade, data] of Object.entries(computeWinRateByGroup(periodTrades, t => t.grade ?? 'C'))) {
    if (data.count >= 2) {
      patterns.push({
        factor: `Grade: ${grade}`,
        winRate: data.winRate,
        avgPnl: data.avgPnl,
        sampleSize: data.count,
        recommendation: data.winRate >= 0.65 ? `${grade} trades performing well` : `Raise minimum grade above ${grade}`,
      });
    }
  }

  const baseReport = {
    period, totalTrades: periodTrades.length, wins: wins.length, losses: losses.length,
    winRate: wins.length / periodTrades.length, totalPnl, avgWin, avgLoss, profitFactor,
    maxDrawdown, sharpeRatio, bestCoin, worstCoin, bestSession, bestTimeframe, bestStrategy,
  };

  const { insights, weightAdjustments } = await getAIInsights(periodTrades, baseReport);

  const report: PerformanceReport = {
    ...baseReport, patterns, weightAdjustments,
    aiInsights: insights,
    generatedAt: new Date().toISOString(),
  };

  reportCache = { report, expires: Date.now() + CACHE_TTL };
  return report;
}

export async function getQuickStats(): Promise<{
  todayPnl: number; weekPnl: number; winRate7d: number; totalTrades: number; openTrades: number;
}> {
  const all = await storage.getBotTrades();
  const now = new Date();
  const todayStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
  const weekStart = new Date(todayStart.getTime() - 7 * 24 * 60 * 60 * 1000);

  const todayTrades = all.filter(t => t.status === 'closed' && new Date(t.closedAt ?? 0) >= todayStart);
  const weekTrades = all.filter(t => t.status === 'closed' && new Date(t.closedAt ?? 0) >= weekStart);
  const openTrades = all.filter(t => t.status === 'open').length;

  const todayPnl = todayTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const weekPnl = weekTrades.reduce((s, t) => s + (t.pnl ?? 0), 0);
  const weekWins = weekTrades.filter(t => (t.pnl ?? 0) > 0).length;
  const winRate7d = weekTrades.length > 0 ? weekWins / weekTrades.length : 0;

  return { todayPnl, weekPnl, winRate7d, totalTrades: all.length, openTrades };
}
