import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Sidebar } from '@/components/layout/Sidebar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Brain, Activity, TrendingUp, TrendingDown, Shield, BookOpen,
  Zap, Globe, BarChart3, AlertTriangle, CheckCircle, XCircle,
  RefreshCw, Target, Award, ArrowUpRight, ArrowDownRight,
  Eye, Cpu, Layers, Clock, DollarSign, Percent
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MarketRegime {
  regime: string;
  confidence: number;
  fearGreed: { value: number; label: string; available: boolean };
  macro: { btcDominance: number; btcDominanceTrend: string; btc24hChange: number; altcoinSeason: boolean; available: boolean };
  session: string;
  sessionScore: number;
  macroScore: number;
  tradeableSide: string;
  narrative: string;
  warnings: string[];
  timestamp: string;
  available: boolean;
}

interface PerformanceReport {
  period: string;
  totalTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnl: number;
  avgWin: number;
  avgLoss: number;
  profitFactor: number;
  maxDrawdown: number;
  sharpeRatio: number;
  bestCoin: string;
  worstCoin: string;
  bestSession: string;
  bestTimeframe: string;
  bestStrategy: string;
  patterns: Array<{ factor: string; winRate: number; avgPnl: number; sampleSize: number; recommendation: string }>;
  weightAdjustments: Array<{ factor: string; currentWeight: number; suggestedWeight: number; reason: string }>;
  aiInsights: string;
  generatedAt: string;
}

interface QuickStats {
  todayPnl: number;
  weekPnl: number;
  winRate7d: number;
  totalTrades: number;
  openTrades: number;
}

// ─── Components ───────────────────────────────────────────────────────────────

function RegimeChip({ regime }: { regime: string }) {
  const map: Record<string, string> = {
    STRONG_BULL: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
    BULL: 'bg-green-500/20 text-green-400 border-green-500/30',
    RANGING: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
    BEAR: 'bg-red-500/20 text-red-400 border-red-500/30',
    STRONG_BEAR: 'bg-rose-500/20 text-rose-400 border-rose-500/30',
    VOLATILE: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  };
  return (
    <span className={cn('px-3 py-1 rounded-full text-xs font-bold border', map[regime] ?? 'bg-slate-700 text-slate-300')}>
      {regime.replace('_', ' ')}
    </span>
  );
}

function FearGreedGauge({ value, label }: { value: number; label: string }) {
  const color =
    value <= 20 ? '#ef4444' :
    value <= 40 ? '#f97316' :
    value <= 60 ? '#eab308' :
    value <= 80 ? '#22c55e' : '#10b981';
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative w-20 h-10 overflow-hidden">
        <div className="absolute inset-0 rounded-t-full border-4 border-slate-600" />
        <div
          className="absolute bottom-0 left-1/2 w-0.5 h-8 origin-bottom rounded-full transition-transform duration-500"
          style={{
            backgroundColor: color,
            transform: `translateX(-50%) rotate(${(value / 100) * 180 - 90}deg)`,
          }}
        />
      </div>
      <span className="text-2xl font-bold" style={{ color }}>{value}</span>
      <span className="text-xs text-slate-400">{label}</span>
    </div>
  );
}

function ScoreBar({ label, score, color = '#0ea5e9' }: { label: string; score: number; color?: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className="font-bold" style={{ color }}>{score.toFixed(0)}/100</span>
      </div>
      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{ width: `${score}%`, backgroundColor: color }}
        />
      </div>
    </div>
  );
}

function AgentCard({
  icon: Icon, name, status, detail, color
}: { icon: any; name: string; status: 'active' | 'idle' | 'error'; detail: string; color: string }) {
  const statusColor = { active: 'text-emerald-400', idle: 'text-slate-500', error: 'text-red-400' }[status];
  const statusDot = { active: 'bg-emerald-400 animate-pulse', idle: 'bg-slate-600', error: 'bg-red-400 animate-pulse' }[status];
  return (
    <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4 flex items-start gap-3">
      <div className="p-2 rounded-lg" style={{ backgroundColor: `${color}22` }}>
        <Icon className="w-5 h-5" style={{ color }} />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="text-sm font-semibold text-white">{name}</span>
          <span className={cn('w-2 h-2 rounded-full', statusDot)} />
          <span className={cn('text-xs', statusColor)}>{status}</span>
        </div>
        <p className="text-xs text-slate-400 line-clamp-2">{detail}</p>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function AgentsPage() {
  const [perfPeriod, setPerfPeriod] = useState<'daily' | 'weekly' | 'monthly'>('weekly');

  const { data: regimeData, isLoading: regimeLoading, refetch: refetchRegime } = useQuery<{ ok: boolean; regime: MarketRegime }>({
    queryKey: ['/api/agents/market-regime'],
    refetchInterval: 15 * 60 * 1000,
  });

  const { data: perfData, isLoading: perfLoading, refetch: refetchPerf } = useQuery<{ ok: boolean; report: PerformanceReport }>({
    queryKey: ['/api/agents/performance', perfPeriod],
    queryFn: () => fetch(`/api/agents/performance?period=${perfPeriod}`).then(r => r.json()),
    refetchInterval: 60 * 60 * 1000,
  });

  const { data: statsData } = useQuery<{ ok: boolean; stats: QuickStats }>({
    queryKey: ['/api/agents/quick-stats'],
    refetchInterval: 2 * 60 * 1000,
  });

  const regime = regimeData?.regime;
  const report = perfData?.report;
  const stats = statsData?.stats;

  const agents = [
    { icon: Globe, name: 'Market Intelligence', status: regime?.available ? 'active' : 'idle', detail: regime ? `${regime.regime} | ${regime.session} session | Score: ${regime.macroScore}/100` : 'Fetching macro data...', color: '#0ea5e9' },
    { icon: Layers, name: 'Technical Analysis', status: 'active', detail: 'Phase 2 — 17-factor confluence engine (SMC + ICT + Momentum + Volume)', color: '#8b5cf6' },
    { icon: Eye, name: 'Sentiment & Whale', status: 'active', detail: 'Coinglass derivatives + Perplexity news + Arkham whale flows', color: '#f59e0b' },
    { icon: Brain, name: 'Signal Gate (AI)', status: 'active', detail: 'Claude + GPT-4o + Gemini consensus — structured output validation', color: '#10b981' },
    { icon: Shield, name: 'Risk Management', status: 'active', detail: 'Kelly Criterion + Correlation detection + Drawdown guardrails', color: '#ef4444' },
    { icon: BookOpen, name: 'Trade Journal', status: report ? 'active' : 'idle', detail: report ? `Win rate: ${(report.winRate * 100).toFixed(0)}% | P&L: $${report.totalPnl.toFixed(2)} | Best: ${report.bestCoin}` : 'Analyzing trade history...', color: '#ec4899' },
  ] as const;

  return (
    <div className="flex h-screen bg-slate-950 text-white overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-6 max-w-7xl mx-auto space-y-6">

          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Brain className="w-7 h-7 text-violet-400" />
                AI Agent Intelligence Hub
              </h1>
              <p className="text-slate-400 text-sm mt-1">6-agent trading system — real-time market understanding & prediction</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => { refetchRegime(); refetchPerf(); }}
              className="border-slate-700 text-slate-300 hover:text-white"
            >
              <RefreshCw className="w-4 h-4 mr-2" />
              Refresh All
            </Button>
          </div>

          {/* Quick Stats */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                { label: "Today P&L", value: `$${stats.todayPnl >= 0 ? '+' : ''}${stats.todayPnl.toFixed(2)}`, color: stats.todayPnl >= 0 ? 'text-emerald-400' : 'text-red-400', icon: DollarSign },
                { label: "7-Day P&L", value: `$${stats.weekPnl >= 0 ? '+' : ''}${stats.weekPnl.toFixed(2)}`, color: stats.weekPnl >= 0 ? 'text-emerald-400' : 'text-red-400', icon: TrendingUp },
                { label: "7D Win Rate", value: `${(stats.winRate7d * 100).toFixed(0)}%`, color: stats.winRate7d >= 0.6 ? 'text-emerald-400' : stats.winRate7d >= 0.4 ? 'text-yellow-400' : 'text-red-400', icon: Target },
                { label: "Total Trades", value: stats.totalTrades.toString(), color: 'text-blue-400', icon: Activity },
                { label: "Open Trades", value: stats.openTrades.toString(), color: stats.openTrades > 0 ? 'text-violet-400' : 'text-slate-500', icon: Zap },
              ].map(s => (
                <div key={s.label} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-1">
                    <s.icon className="w-4 h-4 text-slate-500" />
                    <span className="text-xs text-slate-400">{s.label}</span>
                  </div>
                  <div className={cn('text-xl font-bold', s.color)}>{s.value}</div>
                </div>
              ))}
            </div>
          )}

          {/* Agent Status Grid */}
          <div>
            <h2 className="text-sm font-semibold text-slate-400 uppercase tracking-wider mb-3 flex items-center gap-2">
              <Cpu className="w-4 h-4" /> Active Agents
            </h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {agents.map(a => (
                <AgentCard key={a.name} {...a} status={a.status as any} />
              ))}
            </div>
          </div>

          {/* Market Intelligence Panel */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
                <Globe className="w-4 h-4 text-sky-400" /> Market Intelligence Agent
              </h3>
              {regimeLoading ? (
                <div className="h-40 flex items-center justify-center text-slate-500">Analyzing macro...</div>
              ) : regime ? (
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-xs text-slate-400 mb-1">Market Regime</p>
                      <RegimeChip regime={regime.regime} />
                    </div>
                    <FearGreedGauge value={regime.fearGreed.value} label={regime.fearGreed.label} />
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center">
                    {[
                      { label: 'BTC.D', value: `${regime.macro.btcDominance.toFixed(1)}%` },
                      { label: 'Session', value: regime.session },
                      { label: 'Tradeable', value: regime.tradeableSide },
                    ].map(m => (
                      <div key={m.label} className="bg-slate-700/40 rounded-lg p-2">
                        <div className="text-xs text-slate-400">{m.label}</div>
                        <div className="text-sm font-bold text-white">{m.value}</div>
                      </div>
                    ))}
                  </div>
                  <ScoreBar label="Macro Score" score={regime.macroScore} color="#0ea5e9" />
                  <ScoreBar label="Session Quality" score={regime.sessionScore} color="#8b5cf6" />
                  <p className="text-xs text-slate-300 bg-slate-700/30 rounded-lg p-3 leading-relaxed">{regime.narrative}</p>
                  {regime.warnings.length > 0 && (
                    <div className="space-y-1">
                      {regime.warnings.map((w, i) => (
                        <div key={i} className="flex items-start gap-2 text-xs text-yellow-400 bg-yellow-400/10 rounded-lg p-2">
                          <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
                          {w}
                        </div>
                      ))}
                    </div>
                  )}
                  <p className="text-xs text-slate-600">Last updated: {new Date(regime.timestamp).toLocaleTimeString()}</p>
                </div>
              ) : (
                <div className="h-40 flex items-center justify-center text-slate-500">No data available</div>
              )}
            </div>

            {/* Phase 2 TA Explainer */}
            <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
                <Layers className="w-4 h-4 text-violet-400" /> Phase 2 — 17-Factor Confluence Engine
              </h3>
              <div className="space-y-2">
                {[
                  { group: 'SMC Factors', items: ['1. Market Structure (BOS/CHOCH)', '2. Order Block Quality', '3. Fair Value Gap', '4. Liquidity Sweep'], color: '#8b5cf6', weight: 28 },
                  { group: 'Momentum', items: ['5. RSI Position', '6. RSI Divergence', '7. MACD Cross', '8. StochRSI'], color: '#0ea5e9', weight: 23 },
                  { group: 'Trend', items: ['9. EMA Alignment (9/21/50)', '10. ADX Strength', '11. Ichimoku Cloud'], color: '#10b981', weight: 17 },
                  { group: 'Volume', items: ['12. Volume Confirmation', '13. Volume Profile POC'], color: '#f59e0b', weight: 11 },
                  { group: 'Context', items: ['14. ATR Volatility Regime', '15. Multi-Timeframe Bias', '16. Candle Pattern', '17. Session Timing'], color: '#ec4899', weight: 20 },
                ].map(g => (
                  <div key={g.group} className="bg-slate-700/30 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-xs font-semibold" style={{ color: g.color }}>{g.group}</span>
                      <span className="text-xs text-slate-500">{g.weight}% weight</span>
                    </div>
                    <div className="grid grid-cols-2 gap-0.5">
                      {g.items.map(item => (
                        <span key={item} className="text-xs text-slate-400">{item}</span>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Trade Journal Performance */}
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-pink-400" /> Trade Journal & Learning Agent
              </h3>
              <div className="flex gap-1">
                {(['daily', 'weekly', 'monthly'] as const).map(p => (
                  <Button
                    key={p}
                    size="sm"
                    variant={perfPeriod === p ? 'default' : 'outline'}
                    onClick={() => setPerfPeriod(p)}
                    className={cn('text-xs h-7', perfPeriod !== p && 'border-slate-700 text-slate-400')}
                  >
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </Button>
                ))}
              </div>
            </div>

            {perfLoading ? (
              <div className="h-32 flex items-center justify-center text-slate-500">Analyzing trades...</div>
            ) : report ? (
              <div className="space-y-4">
                <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                  {[
                    { label: 'Win Rate', value: `${(report.winRate * 100).toFixed(0)}%`, color: report.winRate >= 0.6 ? '#10b981' : report.winRate >= 0.4 ? '#eab308' : '#ef4444' },
                    { label: 'Profit Factor', value: report.profitFactor.toFixed(2), color: report.profitFactor >= 1.5 ? '#10b981' : '#ef4444' },
                    { label: 'Total P&L', value: `$${report.totalPnl.toFixed(2)}`, color: report.totalPnl >= 0 ? '#10b981' : '#ef4444' },
                    { label: 'Max Drawdown', value: `${report.maxDrawdown.toFixed(1)}%`, color: report.maxDrawdown <= 5 ? '#10b981' : report.maxDrawdown <= 15 ? '#eab308' : '#ef4444' },
                    { label: 'Sharpe Ratio', value: report.sharpeRatio.toFixed(2), color: report.sharpeRatio >= 1 ? '#10b981' : '#eab308' },
                    { label: 'Total Trades', value: `${report.wins}W / ${report.losses}L`, color: '#0ea5e9' },
                  ].map(s => (
                    <div key={s.label} className="bg-slate-700/40 rounded-lg p-3 text-center">
                      <div className="text-xs text-slate-400 mb-1">{s.label}</div>
                      <div className="text-lg font-bold" style={{ color: s.color }}>{s.value}</div>
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3 text-sm">
                  {[
                    { label: '🏆 Best Coin', value: report.bestCoin },
                    { label: '📉 Worst Coin', value: report.worstCoin },
                    { label: '⏰ Best Session', value: report.bestSession },
                    { label: '📊 Best Strategy', value: report.bestStrategy },
                  ].map(s => (
                    <div key={s.label} className="bg-slate-700/30 rounded-lg p-3">
                      <div className="text-xs text-slate-400 mb-1">{s.label}</div>
                      <div className="font-semibold text-white">{s.value}</div>
                    </div>
                  ))}
                </div>

                {report.aiInsights && (
                  <div className="bg-violet-500/10 border border-violet-500/20 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <Brain className="w-4 h-4 text-violet-400" />
                      <span className="text-xs font-semibold text-violet-400">AI Insights & Recommendations</span>
                    </div>
                    <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">{report.aiInsights}</p>
                  </div>
                )}

                {report.weightAdjustments.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-400 mb-2 flex items-center gap-1">
                      <Award className="w-3 h-3" /> Suggested Confluence Weight Adjustments
                    </h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {report.weightAdjustments.slice(0, 6).map((adj, i) => (
                        <div key={i} className="bg-slate-700/30 rounded-lg p-3 flex items-center justify-between">
                          <div>
                            <div className="text-xs font-medium text-white">{adj.factor}</div>
                            <div className="text-xs text-slate-400">{adj.reason}</div>
                          </div>
                          <div className="text-right ml-3">
                            <div className="text-xs text-slate-500">{adj.currentWeight} → </div>
                            <div className={cn('text-sm font-bold', adj.suggestedWeight > adj.currentWeight ? 'text-emerald-400' : 'text-red-400')}>
                              {adj.suggestedWeight}
                              {adj.suggestedWeight > adj.currentWeight ? <ArrowUpRight className="inline w-3 h-3" /> : <ArrowDownRight className="inline w-3 h-3" />}
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {report.patterns.length > 0 && (
                  <div>
                    <h4 className="text-xs font-semibold text-slate-400 mb-2">Detected Patterns</h4>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                      {report.patterns.slice(0, 4).map((p, i) => (
                        <div key={i} className="bg-slate-700/30 rounded-lg p-3">
                          <div className="flex items-center justify-between mb-1">
                            <span className="text-xs font-medium text-white">{p.factor}</span>
                            <span className={cn('text-xs font-bold', p.winRate >= 0.6 ? 'text-emerald-400' : 'text-red-400')}>
                              {(p.winRate * 100).toFixed(0)}% WR
                            </span>
                          </div>
                          <div className="text-xs text-slate-400">{p.recommendation}</div>
                          <div className="text-xs text-slate-500">{p.sampleSize} trades | Avg P&L: ${p.avgPnl.toFixed(2)}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <div className="h-32 flex items-center justify-center text-slate-500">No performance data yet</div>
            )}
          </div>

          {/* Risk Management Panel */}
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
              <Shield className="w-4 h-4 text-red-400" /> Risk Management Agent — Active Guardrails
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {[
                {
                  title: 'Drawdown Guard',
                  items: [
                    'Auto-reduce to 75% size at 10% DD',
                    'Auto-reduce to 50% size at 15% DD',
                    'Auto-reduce to 25% size at 20% DD',
                    'Hard lock at 20% DD — manual reset required',
                  ],
                  color: '#ef4444',
                  icon: AlertTriangle,
                },
                {
                  title: 'Correlation Filter',
                  items: [
                    'Detects correlated coin groups (L1, L2, DeFi, Meme)',
                    'Warns on 2+ correlated positions',
                    'Blocks on 3+ correlated same-direction trades',
                    'Prevents portfolio concentration risk',
                  ],
                  color: '#f59e0b',
                  icon: Layers,
                },
                {
                  title: 'Kelly Criterion Sizing',
                  items: [
                    'Computes optimal position size from win rate',
                    'Uses half-Kelly for conservative risk (max 5%)',
                    'Scales size with confidence level',
                    'Hard cap: 3% risk per trade',
                  ],
                  color: '#10b981',
                  icon: Target,
                },
              ].map(panel => (
                <div key={panel.title} className="bg-slate-700/30 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <panel.icon className="w-4 h-4" style={{ color: panel.color }} />
                    <span className="text-sm font-semibold text-white">{panel.title}</span>
                  </div>
                  <ul className="space-y-1.5">
                    {panel.items.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-xs text-slate-400">
                        <CheckCircle className="w-3 h-3 mt-0.5 shrink-0" style={{ color: panel.color }} />
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </div>

          {/* Signal Flow Diagram */}
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" /> Agent Signal Flow — How a Trade is Approved
            </h3>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              {[
                { label: 'TA Engine (40%)', color: '#8b5cf6', icon: Layers },
                { label: '→', color: '#475569', icon: null },
                { label: 'Sentiment (30%)', color: '#f59e0b', icon: Eye },
                { label: '→', color: '#475569', icon: null },
                { label: 'Macro (30%)', color: '#0ea5e9', icon: Globe },
                { label: '→', color: '#475569', icon: null },
                { label: 'Composite Score', color: '#10b981', icon: BarChart3 },
                { label: '→', color: '#475569', icon: null },
                { label: 'Risk Check', color: '#ef4444', icon: Shield },
                { label: '→', color: '#475569', icon: null },
                { label: '≥68% → TRADE', color: '#10b981', icon: CheckCircle },
              ].map((step, i) =>
                step.icon ? (
                  <div key={i} className="flex items-center gap-1 px-3 py-1.5 rounded-lg bg-slate-700/50" style={{ borderColor: step.color + '40', borderWidth: 1 }}>
                    <step.icon className="w-3 h-3" style={{ color: step.color }} />
                    <span style={{ color: step.color }}>{step.label}</span>
                  </div>
                ) : (
                  <span key={i} className="text-slate-500 font-bold text-base">{step.label}</span>
                )
              )}
            </div>
            <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-2 text-xs text-slate-400">
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2">
                <span className="text-emerald-400 font-semibold">✅ APPROVED</span> — Final confidence ≥68%, no risk blocks, verdict ≠ NEUTRAL
              </div>
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2">
                <span className="text-red-400 font-semibold">⛔ BLOCKED</span> — Below threshold, drawdown limit, correlation risk, or poor grade
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
