import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sidebar } from '@/components/layout/Sidebar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { cn } from '@/lib/utils';
import {
  TrendingUp, TrendingDown, BarChart3, Activity, Target, Award,
  ArrowUpRight, ArrowDownRight, Download, Calendar, Zap, Shield,
  ChevronUp, ChevronDown, Trophy, AlertTriangle
} from 'lucide-react';
import {
  LineChart, Line, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Cell, PieChart, Pie, Legend
} from 'recharts';

const COLORS = ['#0ea5e9', '#10b981', '#8b5cf6', '#f59e0b', '#ef4444', '#ec4899'];

function StatCard({
  label, value, sub, color = 'default', icon: Icon, trend
}: {
  label: string;
  value: string;
  sub?: string;
  color?: 'green' | 'red' | 'blue' | 'orange' | 'purple' | 'default';
  icon: any;
  trend?: number;
}) {
  const colorMap: Record<string, string> = {
    green: 'border-green-200 bg-green-50',
    red: 'border-red-200 bg-red-50',
    blue: 'border-blue-200 bg-blue-50',
    orange: 'border-orange-200 bg-orange-50',
    purple: 'border-purple-200 bg-purple-50',
    default: 'border-border bg-white',
  };
  const iconMap: Record<string, string> = {
    green: 'bg-green-100 text-green-600',
    red: 'bg-red-100 text-red-600',
    blue: 'bg-blue-100 text-blue-600',
    orange: 'bg-orange-100 text-orange-600',
    purple: 'bg-purple-100 text-purple-600',
    default: 'bg-muted text-muted-foreground',
  };
  const valColor: Record<string, string> = {
    green: 'text-green-600',
    red: 'text-red-500',
    blue: 'text-blue-600',
    orange: 'text-orange-500',
    purple: 'text-purple-600',
    default: 'text-foreground',
  };

  return (
    <div className={cn('rounded-xl border p-4 shadow-sm flex items-center gap-4', colorMap[color])}>
      <div className={cn('h-11 w-11 rounded-xl flex items-center justify-center shrink-0', iconMap[color])}>
        <Icon className="w-5 h-5" />
      </div>
      <div className="min-w-0">
        <div className="text-[10px] uppercase font-mono text-muted-foreground tracking-wider">{label}</div>
        <div className={cn('text-xl font-black font-mono leading-tight', valColor[color])}>{value}</div>
        {sub && <div className="text-[10px] text-muted-foreground mt-0.5">{sub}</div>}
      </div>
      {trend !== undefined && (
        <div className={cn('ml-auto text-xs font-bold flex items-center gap-0.5', trend >= 0 ? 'text-green-500' : 'text-red-500')}>
          {trend >= 0 ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          {Math.abs(trend).toFixed(1)}%
        </div>
      )}
    </div>
  );
}

export default function Analytics() {
  const [tradeFilter, setTradeFilter] = useState<'all' | 'win' | 'loss'>('all');
  const [sortField, setSortField] = useState<'closedAt' | 'pnl' | 'symbol'>('closedAt');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');

  const { data: positions = [] } = useQuery<any[]>({ queryKey: ['/api/positions'] });
  const { data: signals = [] } = useQuery<any[]>({ queryKey: ['/api/signals'] });
  const { data: strategies = [] } = useQuery<any[]>({ queryKey: ['/api/strategies'] });
  const { data: walletData } = useQuery<any>({ queryKey: ['/api/wallet'] });

  const closedPositions = useMemo(
    () => positions.filter((p: any) => p.status === 'closed' && p.pnl !== null),
    [positions]
  );

  const metrics = useMemo(() => {
    if (closedPositions.length === 0) {
      return {
        totalPnL: 0, winRate: 0, profitFactor: 0, maxDrawdown: 0,
        avgWin: 0, avgLoss: 0, totalTrades: 0, bestTrade: 0, worstTrade: 0,
        sharpeRatio: 0, consecutiveWins: 0, consecutiveLosses: 0,
      };
    }

    const wins = closedPositions.filter((p: any) => (p.pnl || 0) > 0);
    const losses = closedPositions.filter((p: any) => (p.pnl || 0) < 0);
    const totalPnL = closedPositions.reduce((s: number, p: any) => s + (p.pnl || 0), 0);
    const grossProfit = wins.reduce((s: number, p: any) => s + (p.pnl || 0), 0);
    const grossLoss = Math.abs(losses.reduce((s: number, p: any) => s + (p.pnl || 0), 0));
    const avgWin = wins.length > 0 ? grossProfit / wins.length : 0;
    const avgLoss = losses.length > 0 ? grossLoss / losses.length : 0;

    const sorted = [...closedPositions].sort(
      (a: any, b: any) => new Date(a.closedAt).getTime() - new Date(b.closedAt).getTime()
    );
    let cumPnL = 0;
    let peak = 0;
    let maxDrawdown = 0;
    const pnlValues: number[] = [];
    for (const p of sorted) {
      cumPnL += p.pnl || 0;
      pnlValues.push(p.pnl || 0);
      if (cumPnL > peak) peak = cumPnL;
      const dd = peak > 0 ? (peak - cumPnL) / peak * 100 : 0;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    const avgPnL = pnlValues.reduce((a, b) => a + b, 0) / pnlValues.length;
    const variance = pnlValues.reduce((s, v) => s + (v - avgPnL) ** 2, 0) / pnlValues.length;
    const stdDev = Math.sqrt(variance);
    const sharpeRatio = stdDev > 0 ? (avgPnL / stdDev) * Math.sqrt(252) : 0;

    let consWins = 0, maxConsWins = 0, curWins = 0;
    let consLosses = 0, maxConsLosses = 0, curLosses = 0;
    for (const p of sorted) {
      if ((p.pnl || 0) > 0) { curWins++; curLosses = 0; }
      else { curLosses++; curWins = 0; }
      maxConsWins = Math.max(maxConsWins, curWins);
      maxConsLosses = Math.max(maxConsLosses, curLosses);
    }
    consWins = maxConsWins;
    consLosses = maxConsLosses;

    return {
      totalPnL,
      winRate: closedPositions.length > 0 ? (wins.length / closedPositions.length) * 100 : 0,
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? 99 : 0,
      maxDrawdown,
      avgWin,
      avgLoss,
      totalTrades: closedPositions.length,
      bestTrade: Math.max(0, ...closedPositions.map((p: any) => p.pnl || 0)),
      worstTrade: Math.min(0, ...closedPositions.map((p: any) => p.pnl || 0)),
      sharpeRatio,
      consecutiveWins: consWins,
      consecutiveLosses: consLosses,
    };
  }, [closedPositions]);

  const equityCurve = useMemo(() => {
    const sorted = [...closedPositions].sort(
      (a: any, b: any) => new Date(a.closedAt).getTime() - new Date(b.closedAt).getTime()
    );
    let cumPnL = 0;
    const base = walletData?.balance || 10000;
    return [{ date: 'Start', equity: base, pnl: 0 }, ...sorted.map((p: any) => {
      cumPnL += p.pnl || 0;
      return {
        date: new Date(p.closedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
        equity: base + cumPnL,
        pnl: cumPnL,
      };
    })];
  }, [closedPositions, walletData]);

  const pnlByCoin = useMemo(() => {
    const map: Record<string, { pnl: number; trades: number }> = {};
    closedPositions.forEach((p: any) => {
      const coin = p.symbol.replace('USDT', '');
      if (!map[coin]) map[coin] = { pnl: 0, trades: 0 };
      map[coin].pnl += p.pnl || 0;
      map[coin].trades++;
    });
    return Object.entries(map)
      .map(([coin, d]) => ({ coin, ...d }))
      .sort((a, b) => b.pnl - a.pnl);
  }, [closedPositions]);

  const directionStats = useMemo(() => {
    const longs = closedPositions.filter((p: any) => p.type === 'LONG');
    const shorts = closedPositions.filter((p: any) => p.type === 'SHORT');
    const longWins = longs.filter((p: any) => (p.pnl || 0) > 0).length;
    const shortWins = shorts.filter((p: any) => (p.pnl || 0) > 0).length;
    return [
      { name: 'LONG Wins', value: longWins, fill: '#10b981' },
      { name: 'LONG Loss', value: longs.length - longWins, fill: '#d1fae5' },
      { name: 'SHORT Wins', value: shortWins, fill: '#0ea5e9' },
      { name: 'SHORT Loss', value: shorts.length - shortWins, fill: '#dbeafe' },
    ].filter(d => d.value > 0);
  }, [closedPositions]);

  const strategyPerformance = useMemo(() => {
    return strategies.map((s: any) => ({
      name: s.name,
      winRate: s.winRate || 0,
      pnl: s.totalPnl || 0,
      trades: s.totalTrades || 0,
    })).filter((s: any) => s.trades > 0);
  }, [strategies]);

  const filteredTrades = useMemo(() => {
    let trades = [...closedPositions];
    if (tradeFilter === 'win') trades = trades.filter((p: any) => (p.pnl || 0) > 0);
    if (tradeFilter === 'loss') trades = trades.filter((p: any) => (p.pnl || 0) < 0);
    trades.sort((a: any, b: any) => {
      let va: any = a[sortField], vb: any = b[sortField];
      if (sortField === 'closedAt') { va = new Date(va).getTime(); vb = new Date(vb).getTime(); }
      if (sortField === 'pnl') { va = va || 0; vb = vb || 0; }
      return sortDir === 'desc' ? vb - va : va - vb;
    });
    return trades;
  }, [closedPositions, tradeFilter, sortField, sortDir]);

  const handleSort = (field: typeof sortField) => {
    if (sortField === field) setSortDir(d => d === 'desc' ? 'asc' : 'desc');
    else { setSortField(field); setSortDir('desc'); }
  };

  const handleExportCSV = () => {
    const headers = ['Date', 'Symbol', 'Type', 'Leverage', 'Entry', 'PnL'];
    const rows = filteredTrades.map((p: any) => [
      new Date(p.closedAt).toLocaleDateString(),
      p.symbol,
      p.type,
      p.leverage,
      p.entryPrice,
      (p.pnl || 0).toFixed(2),
    ]);
    const csv = [headers, ...rows].map(r => r.join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `trade-journal-${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (!active || !payload?.length) return null;
    return (
      <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl text-xs">
        <p className="font-bold text-muted-foreground mb-1">{label}</p>
        {payload.map((p: any) => (
          <p key={p.name} className="font-mono" style={{ color: p.color }}>
            {p.name}: ${parseFloat(p.value).toLocaleString(undefined, { maximumFractionDigits: 2 })}
          </p>
        ))}
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans">
      <Sidebar />
      <main className="md:pl-64 min-h-screen">
        <div className="p-4 md:p-6 space-y-4 md:space-y-6 max-w-[1600px]">

          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-display font-black text-foreground">Trade Analytics</h1>
              <p className="text-xs text-muted-foreground font-mono mt-0.5">
                {metrics.totalTrades} closed trades · Account ${(walletData?.balance || 10000).toLocaleString(undefined, { maximumFractionDigits: 0 })}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={handleExportCSV} className="gap-2 text-xs">
              <Download className="w-3.5 h-3.5" /> Export CSV
            </Button>
          </div>

          {/* KPI Grid */}
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
            <StatCard
              label="Total P&L"
              value={`${metrics.totalPnL >= 0 ? '+' : ''}$${metrics.totalPnL.toFixed(2)}`}
              sub={`${metrics.totalTrades} closed trades`}
              color={metrics.totalPnL >= 0 ? 'green' : 'red'}
              icon={metrics.totalPnL >= 0 ? TrendingUp : TrendingDown}
            />
            <StatCard
              label="Win Rate"
              value={`${metrics.winRate.toFixed(1)}%`}
              sub={`${closedPositions.filter((p: any) => (p.pnl || 0) > 0).length}W / ${closedPositions.filter((p: any) => (p.pnl || 0) < 0).length}L`}
              color={metrics.winRate >= 50 ? 'green' : 'orange'}
              icon={Trophy}
            />
            <StatCard
              label="Profit Factor"
              value={metrics.profitFactor >= 99 ? '∞' : metrics.profitFactor.toFixed(2)}
              sub="Gross profit / Gross loss"
              color={metrics.profitFactor >= 1.5 ? 'green' : metrics.profitFactor >= 1 ? 'orange' : 'red'}
              icon={BarChart3}
            />
            <StatCard
              label="Max Drawdown"
              value={`${metrics.maxDrawdown.toFixed(1)}%`}
              sub="Peak-to-trough decline"
              color={metrics.maxDrawdown < 10 ? 'green' : metrics.maxDrawdown < 20 ? 'orange' : 'red'}
              icon={AlertTriangle}
            />
            <StatCard
              label="Sharpe Ratio"
              value={metrics.sharpeRatio.toFixed(2)}
              sub="Risk-adjusted return"
              color={metrics.sharpeRatio >= 1.5 ? 'green' : metrics.sharpeRatio >= 0.5 ? 'blue' : 'orange'}
              icon={Activity}
            />
            <StatCard
              label="Avg Win"
              value={`$${metrics.avgWin.toFixed(2)}`}
              sub="Per winning trade"
              color="green"
              icon={ArrowUpRight}
            />
            <StatCard
              label="Avg Loss"
              value={`$${metrics.avgLoss.toFixed(2)}`}
              sub="Per losing trade"
              color="red"
              icon={ArrowDownRight}
            />
            <StatCard
              label="Best Trade"
              value={`+$${metrics.bestTrade.toFixed(2)}`}
              color="green"
              icon={Award}
            />
            <StatCard
              label="Worst Trade"
              value={`-$${Math.abs(metrics.worstTrade).toFixed(2)}`}
              color="red"
              icon={Shield}
            />
            <StatCard
              label="Win Streak"
              value={`${metrics.consecutiveWins}`}
              sub={`Max ${metrics.consecutiveLosses} loss streak`}
              color="purple"
              icon={Zap}
            />
          </div>

          {/* Equity Curve */}
          <div className="bg-white rounded-xl border border-border shadow-sm p-4">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-2">
                <div className="h-7 w-7 rounded-lg bg-primary/10 flex items-center justify-center">
                  <TrendingUp className="w-4 h-4 text-primary" />
                </div>
                <div>
                  <span className="text-sm font-bold">Equity Curve</span>
                  <p className="text-[10px] text-muted-foreground font-mono">Cumulative portfolio value over time</p>
                </div>
              </div>
              <Badge variant="outline" className={cn('text-[10px] font-mono', metrics.totalPnL >= 0 ? 'text-green-600 border-green-200 bg-green-50' : 'text-red-500 border-red-200 bg-red-50')}>
                {metrics.totalPnL >= 0 ? '+' : ''}${metrics.totalPnL.toFixed(2)}
              </Badge>
            </div>
            {equityCurve.length < 2 ? (
              <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">
                No closed trades yet. Close positions to see your equity curve.
              </div>
            ) : (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={equityCurve} margin={{ left: -10, right: 10, top: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" />
                    <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false}
                      tickFormatter={v => `$${(v / 1000).toFixed(1)}k`} />
                    <Tooltip content={<CustomTooltip />} />
                    <ReferenceLine y={walletData?.balance || 10000} stroke="#94a3b8" strokeDasharray="4 4" />
                    <Line type="monotone" dataKey="equity" name="Equity"
                      stroke={metrics.totalPnL >= 0 ? '#10b981' : '#ef4444'}
                      strokeWidth={2} dot={false} activeDot={{ r: 4 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </div>

          {/* Charts Row */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

            {/* PnL by Coin */}
            <div className="lg:col-span-2 bg-white rounded-xl border border-border shadow-sm p-4">
              <div className="flex items-center gap-2 mb-4">
                <BarChart3 className="w-4 h-4 text-primary" />
                <span className="text-sm font-bold">P&L by Asset</span>
              </div>
              {pnlByCoin.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">No data</div>
              ) : (
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={pnlByCoin} layout="vertical" margin={{ left: 0, right: 20, top: 5, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" horizontal={false} />
                      <XAxis type="number" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false}
                        tickFormatter={v => `$${v.toFixed(0)}`} />
                      <YAxis type="category" dataKey="coin" tick={{ fontSize: 10, fill: '#64748b', fontWeight: 600 }} width={36} axisLine={false} tickLine={false} />
                      <Tooltip content={({ active, payload, label }) => active && payload?.length ? (
                        <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl text-xs">
                          <p className="font-bold mb-1">{label}</p>
                          <p className={cn('font-mono font-bold', (payload[0].value as number) >= 0 ? 'text-green-500' : 'text-red-500')}>
                            P&L: {(payload[0].value as number) >= 0 ? '+' : ''}${(payload[0].value as number).toFixed(2)}
                          </p>
                          <p className="text-muted-foreground">{payload[0].payload.trades} trades</p>
                        </div>
                      ) : null} />
                      <Bar dataKey="pnl" radius={[0, 4, 4, 0]} barSize={16}>
                        {pnlByCoin.map((entry, i) => (
                          <Cell key={i} fill={entry.pnl >= 0 ? '#10b981' : '#ef4444'} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>

            {/* Direction Distribution */}
            <div className="bg-white rounded-xl border border-border shadow-sm p-4">
              <div className="flex items-center gap-2 mb-4">
                <Target className="w-4 h-4 text-purple-500" />
                <span className="text-sm font-bold">Trade Distribution</span>
              </div>
              {directionStats.length === 0 ? (
                <div className="h-48 flex items-center justify-center text-sm text-muted-foreground">No data</div>
              ) : (
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie data={directionStats} cx="50%" cy="45%" innerRadius={45} outerRadius={70}
                        dataKey="value" paddingAngle={2} stroke="none">
                        {directionStats.map((entry, i) => (
                          <Cell key={i} fill={entry.fill} />
                        ))}
                      </Pie>
                      <Tooltip formatter={(v: any) => [v, 'Trades']} />
                      <Legend iconSize={8} wrapperStyle={{ fontSize: '10px' }} />
                    </PieChart>
                  </ResponsiveContainer>
                </div>
              )}
            </div>
          </div>

          {/* Strategy Performance */}
          {strategyPerformance.length > 0 && (
            <div className="bg-white rounded-xl border border-border shadow-sm p-4">
              <div className="flex items-center gap-2 mb-4">
                <Activity className="w-4 h-4 text-orange-500" />
                <span className="text-sm font-bold">Strategy Performance</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                {strategyPerformance.map((s: any) => (
                  <div key={s.name} className="rounded-lg border border-border/60 p-3 bg-secondary/20">
                    <div className="font-bold text-sm truncate">{s.name}</div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className={cn('text-xs font-mono font-bold', s.pnl >= 0 ? 'text-green-500' : 'text-red-500')}>
                        {s.pnl >= 0 ? '+' : ''}${s.pnl.toFixed(0)}
                      </span>
                      <span className="text-[10px] text-muted-foreground">{s.trades} trades</span>
                    </div>
                    <div className="mt-2 w-full bg-muted rounded-full h-1.5 overflow-hidden">
                      <div className={cn('h-full rounded-full', s.winRate >= 50 ? 'bg-green-500' : 'bg-red-400')}
                        style={{ width: `${s.winRate}%` }} />
                    </div>
                    <div className="text-[10px] text-muted-foreground mt-0.5">{s.winRate.toFixed(0)}% win rate</div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Trade History Table */}
          <div className="bg-white rounded-xl border border-border shadow-sm">
            <div className="p-4 border-b border-border flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Calendar className="w-4 h-4 text-primary" />
                <span className="text-sm font-bold">Trade Journal</span>
                <Badge variant="outline" className="text-[10px]">{filteredTrades.length}</Badge>
              </div>
              <div className="flex gap-1">
                {(['all', 'win', 'loss'] as const).map(f => (
                  <Button key={f} variant={tradeFilter === f ? 'default' : 'ghost'} size="sm"
                    className="h-7 text-[10px] px-3 capitalize" onClick={() => setTradeFilter(f)}>
                    {f === 'all' ? 'All' : f === 'win' ? 'Winners' : 'Losers'}
                  </Button>
                ))}
              </div>
            </div>

            {filteredTrades.length === 0 ? (
              <div className="h-32 flex items-center justify-center text-sm text-muted-foreground">
                No {tradeFilter !== 'all' ? tradeFilter + 'ning ' : ''}trades recorded yet.
              </div>
            ) : (
              <ScrollArea className="h-72">
                <table className="w-full text-xs">
                  <thead className="bg-muted/30 text-muted-foreground sticky top-0">
                    <tr>
                      <th className="px-4 py-2 text-left font-medium cursor-pointer hover:text-foreground" onClick={() => handleSort('closedAt')}>
                        Date {sortField === 'closedAt' && (sortDir === 'desc' ? '↓' : '↑')}
                      </th>
                      <th className="px-4 py-2 text-left font-medium cursor-pointer hover:text-foreground" onClick={() => handleSort('symbol')}>
                        Asset {sortField === 'symbol' && (sortDir === 'desc' ? '↓' : '↑')}
                      </th>
                      <th className="px-4 py-2 text-left font-medium">Dir</th>
                      <th className="px-4 py-2 text-right font-medium">Lev</th>
                      <th className="px-4 py-2 text-right font-medium">Entry</th>
                      <th className="px-4 py-2 text-right font-medium cursor-pointer hover:text-foreground" onClick={() => handleSort('pnl')}>
                        P&L {sortField === 'pnl' && (sortDir === 'desc' ? '↓' : '↑')}
                      </th>
                      <th className="px-4 py-2 text-right font-medium">Result</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border/30">
                    {filteredTrades.map((p: any) => (
                      <tr key={p.id} className="hover:bg-muted/10 transition-colors">
                        <td className="px-4 py-2.5 font-mono text-muted-foreground">
                          {new Date(p.closedAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                        </td>
                        <td className="px-4 py-2.5 font-bold">{p.symbol.replace('USDT', '')}</td>
                        <td className="px-4 py-2.5">
                          <Badge variant={p.type === 'LONG' ? 'default' : 'destructive'} className="text-[9px] h-4 px-1.5">
                            {p.type}
                          </Badge>
                        </td>
                        <td className="px-4 py-2.5 text-right font-mono text-primary">{p.leverage}x</td>
                        <td className="px-4 py-2.5 text-right font-mono">${p.entryPrice.toLocaleString(undefined, { maximumFractionDigits: 2 })}</td>
                        <td className={cn('px-4 py-2.5 text-right font-mono font-bold', (p.pnl || 0) >= 0 ? 'text-green-500' : 'text-red-500')}>
                          {(p.pnl || 0) >= 0 ? '+' : ''}${(p.pnl || 0).toFixed(2)}
                        </td>
                        <td className="px-4 py-2.5 text-right">
                          <span className={cn('text-[9px] font-bold px-2 py-0.5 rounded-full', (p.pnl || 0) >= 0 ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-600')}>
                            {(p.pnl || 0) >= 0 ? 'WIN' : 'LOSS'}
                          </span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </ScrollArea>
            )}
          </div>

        </div>
      </main>
    </div>
  );
}
