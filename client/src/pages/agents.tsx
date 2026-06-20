import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Sidebar } from '@/components/layout/Sidebar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import {
  Brain, Activity, TrendingUp, TrendingDown, Shield, BookOpen,
  Zap, Globe, BarChart3, AlertTriangle, CheckCircle, XCircle,
  RefreshCw, Target, Award, ArrowUpRight, ArrowDownRight,
  Eye, Cpu, Layers, Clock, DollarSign, Play, Square, Radar,
  Bell, Loader2, ChevronDown, ChevronUp, Settings2,
} from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface MarketRegime {
  regime: string; confidence: number;
  fearGreed: { value: number; label: string; available: boolean };
  macro: { btcDominance: number; btcDominanceTrend: string; btc24hChange: number; altcoinSeason: boolean; available: boolean };
  session: string; sessionScore: number; macroScore: number;
  tradeableSide: string; narrative: string; warnings: string[];
  timestamp: string; available: boolean;
}

interface ScanResult {
  coin: string; timeframe: string; direction: 'LONG' | 'SHORT';
  entry: number; sl: number; tp: number;
  confidence: number; grade: string; verdict: string; summary: string;
  scores: { macro: number; sentiment: number; technical: number; composite: number };
  signalId?: string; timestamp: string;
}

interface ScanSummary {
  timeframe: string; coinsScanned: number; passedMathFilter: number;
  filteredByMacro: number; filteredByGrade: number; signalsGenerated: number;
  scanDurationMs: number; macroRegime: string | null; timestamp: string;
}

interface ScannerStatus {
  running: boolean; lastScanAt: string | null; nextScanAt: string | null;
  signalsGenerated: number; signalsToday: number;
  lastResults: ScanResult[];
  lastScanSummary: ScanSummary | null;
  config: {
    enabled: boolean; timeframes: string[]; coins: string[];
    minConfidence: number; minGrade: string;
    notifyOnGenerate: boolean;
  };
}

interface PerformanceReport {
  period: string; totalTrades: number; wins: number; losses: number;
  winRate: number; totalPnl: number; avgWin: number; avgLoss: number;
  profitFactor: number; maxDrawdown: number; sharpeRatio: number;
  bestCoin: string; worstCoin: string; bestSession: string; bestTimeframe: string; bestStrategy: string;
  patterns: Array<{ factor: string; winRate: number; avgPnl: number; sampleSize: number; recommendation: string }>;
  weightAdjustments: Array<{ factor: string; currentWeight: number; suggestedWeight: number; reason: string }>;
  aiInsights: string; generatedAt: string;
}

interface QuickStats {
  todayPnl: number; weekPnl: number; winRate7d: number; totalTrades: number; openTrades: number;
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function RegimeChip({ regime }: { regime: string }) {
  const map: Record<string, string> = {
    STRONG_BULL: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40',
    BULL: 'bg-green-500/20 text-green-300 border-green-500/40',
    RANGING: 'bg-yellow-500/20 text-yellow-300 border-yellow-500/40',
    BEAR: 'bg-red-500/20 text-red-300 border-red-500/40',
    STRONG_BEAR: 'bg-rose-600/20 text-rose-300 border-rose-500/40',
    VOLATILE: 'bg-orange-500/20 text-orange-300 border-orange-500/40',
  };
  return <span className={cn('px-3 py-1 rounded-full text-xs font-bold border', map[regime] ?? 'bg-slate-700 text-slate-300')}>{regime.replace(/_/g, ' ')}</span>;
}

function FearGreedGauge({ value, label }: { value: number; label: string }) {
  const color = value <= 20 ? '#ef4444' : value <= 40 ? '#f97316' : value <= 60 ? '#eab308' : value <= 80 ? '#22c55e' : '#10b981';
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="text-3xl font-black" style={{ color }}>{value}</div>
      <div className="text-xs text-slate-400">{label}</div>
      <div className="w-24 h-2 bg-slate-700 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all" style={{ width: `${value}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function ScoreBar({ label, score, color }: { label: string; score: number; color: string }) {
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs">
        <span className="text-slate-400">{label}</span>
        <span className="font-bold" style={{ color }}>{score.toFixed(0)}/100</span>
      </div>
      <div className="h-1.5 bg-slate-700 rounded-full overflow-hidden">
        <div className="h-full rounded-full transition-all duration-700" style={{ width: `${score}%`, backgroundColor: color }} />
      </div>
    </div>
  );
}

function GradeBadge({ grade }: { grade: string }) {
  const colors: Record<string, string> = {
    'A+': 'bg-emerald-500 text-white', A: 'bg-green-500 text-white',
    B: 'bg-blue-500 text-white', C: 'bg-yellow-500 text-black', 'No Trade': 'bg-slate-600 text-slate-300',
  };
  return <span className={cn('px-2 py-0.5 rounded text-xs font-black', colors[grade] ?? 'bg-slate-700 text-slate-300')}>{grade}</span>;
}

function SignalCard({ r }: { r: ScanResult }) {
  const isLong = r.direction === 'LONG';
  return (
    <div className={cn('border rounded-xl p-4 space-y-3', isLong ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-red-500/30 bg-red-500/5')}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className={cn('text-base font-black', isLong ? 'text-emerald-400' : 'text-red-400')}>
            {isLong ? '▲' : '▼'} {r.direction}
          </span>
          <span className="text-white font-bold">{r.coin}/USDT</span>
          <span className="text-xs text-slate-400 bg-slate-700/60 px-2 py-0.5 rounded">{r.timeframe}</span>
        </div>
        <div className="flex items-center gap-2">
          <GradeBadge grade={r.grade} />
          <span className={cn('text-sm font-bold', r.confidence >= 80 ? 'text-emerald-400' : r.confidence >= 70 ? 'text-yellow-400' : 'text-orange-400')}>
            {r.confidence}%
          </span>
        </div>
      </div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="text-center bg-slate-700/40 rounded p-2">
          <div className="text-slate-400">Entry</div>
          <div className="font-bold text-white">${r.entry.toFixed(r.entry < 1 ? 6 : 2)}</div>
        </div>
        <div className="text-center bg-red-500/10 rounded p-2">
          <div className="text-slate-400">Stop Loss</div>
          <div className="font-bold text-red-400">${r.sl.toFixed(r.sl < 1 ? 6 : 2)}</div>
        </div>
        <div className="text-center bg-emerald-500/10 rounded p-2">
          <div className="text-slate-400">Take Profit</div>
          <div className="font-bold text-emerald-400">${r.tp.toFixed(r.tp < 1 ? 6 : 2)}</div>
        </div>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {[
          { label: 'TA', score: r.scores.technical, color: '#8b5cf6' },
          { label: 'Sent.', score: r.scores.sentiment, color: '#f59e0b' },
          { label: 'Macro', score: r.scores.macro, color: '#0ea5e9' },
          { label: 'Final', score: r.scores.composite, color: '#10b981' },
        ].map(s => (
          <div key={s.label} className="text-center bg-slate-700/30 rounded p-1.5">
            <div className="text-xs text-slate-500">{s.label}</div>
            <div className="text-xs font-bold" style={{ color: s.color }}>{s.score.toFixed(0)}</div>
          </div>
        ))}
      </div>
      <div className="text-xs text-slate-400">{new Date(r.timestamp).toLocaleTimeString()}</div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

const ALL_TIMEFRAMES = ['15m', '1h', '4h', '1d'] as const;
const TOP_COINS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'AVAX', 'DOGE', 'LINK', 'MATIC', 'ARB', 'OP', 'SUI', 'APT', 'INJ'];

export default function AgentsPage() {
  const qc = useQueryClient();
  const [perfPeriod, setPerfPeriod] = useState<'daily' | 'weekly' | 'monthly'>('weekly');
  const [selectedTFs, setSelectedTFs] = useState<string[]>(['1h']);
  const [selectedCoins, setSelectedCoins] = useState<string[]>(TOP_COINS);
  const [minConf, setMinConf] = useState(70);
  const [minGrade, setMinGrade] = useState('B');
  const [notify, setNotify] = useState(true);
  const [showConfig, setShowConfig] = useState(false);
  const [manualTF, setManualTF] = useState<'15m' | '1h' | '4h' | '1d'>('1h');

  const { data: scannerData, refetch: refetchScanner } = useQuery<{ ok: boolean; status: ScannerStatus }>({
    queryKey: ['/api/agents/scanner/status'],
    refetchInterval: 15000,
  });

  const { data: regimeData } = useQuery<{ ok: boolean; regime: MarketRegime }>({
    queryKey: ['/api/agents/market-regime'],
    refetchInterval: 15 * 60 * 1000,
  });

  const { data: perfData, isLoading: perfLoading } = useQuery<{ ok: boolean; report: PerformanceReport }>({
    queryKey: ['/api/agents/performance', perfPeriod],
    queryFn: () => fetch(`/api/agents/performance?period=${perfPeriod}`).then(r => r.json()),
  });

  const { data: statsData } = useQuery<{ ok: boolean; stats: QuickStats }>({
    queryKey: ['/api/agents/quick-stats'],
    refetchInterval: 60000,
  });

  const startMut = useMutation({
    mutationFn: () => fetch('/api/agents/scanner/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeframes: selectedTFs, coins: selectedCoins }),
    }).then(r => r.json()),
    onSuccess: () => refetchScanner(),
  });

  const stopMut = useMutation({
    mutationFn: () => fetch('/api/agents/scanner/stop', { method: 'POST' }).then(r => r.json()),
    onSuccess: () => refetchScanner(),
  });

  const configMut = useMutation({
    mutationFn: () => fetch('/api/agents/scanner/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeframes: selectedTFs, coins: selectedCoins, minConfidence: minConf, minGrade, notifyOnGenerate: notify }),
    }).then(r => r.json()),
    onSuccess: () => { refetchScanner(); setShowConfig(false); },
  });

  const scanNowMut = useMutation({
    mutationFn: (tf: string) => fetch('/api/agents/scanner/scan-now', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ timeframe: tf }),
    }).then(r => r.json()),
    onSuccess: () => refetchScanner(),
  });

  const scanner = scannerData?.status;
  const regime = regimeData?.regime;
  const report = perfData?.report;
  const stats = statsData?.stats;

  const toggleTF = (tf: string) => setSelectedTFs(prev => prev.includes(tf) ? prev.filter(x => x !== tf) : [...prev, tf]);
  const toggleCoin = (coin: string) => setSelectedCoins(prev => prev.includes(coin) ? prev.filter(x => x !== coin) : [...prev, coin]);

  return (
    <div className="flex h-screen bg-slate-950 text-white overflow-hidden">
      <Sidebar />
      <main className="flex-1 overflow-auto">
        <div className="p-6 max-w-7xl mx-auto space-y-5">

          {/* Header */}
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold flex items-center gap-2">
                <Brain className="w-7 h-7 text-violet-400" />
                AI Agent Intelligence Hub
              </h1>
              <p className="text-slate-400 text-sm mt-0.5">6 autonomous agents scanning markets, learning from trades, and generating real signals</p>
            </div>
          </div>

          {/* ── SCANNER CONTROL PANEL ─────────────────────────────────────── */}
          <div className={cn('rounded-2xl border-2 p-5', scanner?.config.enabled ? 'border-emerald-500/40 bg-emerald-500/5' : 'border-slate-700/60 bg-slate-800/40')}>
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className={cn('w-3 h-3 rounded-full', scanner?.running ? 'bg-emerald-400 animate-pulse' : scanner?.config.enabled ? 'bg-yellow-400' : 'bg-slate-600')} />
                <h2 className="text-base font-bold text-white">Autonomous Market Scanner</h2>
                {scanner?.config.enabled && (
                  <span className="text-xs bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full font-semibold">
                    {scanner.running ? 'SCANNING...' : 'ACTIVE'}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button size="sm" variant="outline" className="border-slate-600 text-slate-300 text-xs h-8" onClick={() => setShowConfig(!showConfig)}>
                  <Settings2 className="w-3 h-3 mr-1" />
                  Configure
                  {showConfig ? <ChevronUp className="w-3 h-3 ml-1" /> : <ChevronDown className="w-3 h-3 ml-1" />}
                </Button>
                {scanner?.config.enabled ? (
                  <Button size="sm" variant="destructive" className="h-8 text-xs" onClick={() => stopMut.mutate()} disabled={stopMut.isPending}>
                    <Square className="w-3 h-3 mr-1" /> Stop Scanner
                  </Button>
                ) : (
                  <Button size="sm" className="h-8 text-xs bg-emerald-600 hover:bg-emerald-500" onClick={() => startMut.mutate()} disabled={startMut.isPending}>
                    <Play className="w-3 h-3 mr-1" /> Start Scanner
                  </Button>
                )}
              </div>
            </div>

            {/* Stats row */}
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
              {[
                { label: 'Signals Today', value: scanner?.signalsToday ?? 0, color: 'text-emerald-400' },
                { label: 'Total Generated', value: scanner?.signalsGenerated ?? 0, color: 'text-blue-400' },
                { label: 'Coins Watched', value: scanner?.config.coins.length ?? 0, color: 'text-violet-400' },
                { label: 'Timeframes', value: scanner?.config.timeframes.join(', ') ?? '—', color: 'text-yellow-400' },
                { label: 'Last Scan', value: scanner?.lastScanAt ? new Date(scanner.lastScanAt).toLocaleTimeString() : '—', color: 'text-slate-300' },
              ].map(s => (
                <div key={s.label} className="bg-slate-800/60 rounded-lg p-3 text-center">
                  <div className="text-xs text-slate-500 mb-1">{s.label}</div>
                  <div className={cn('text-lg font-bold', s.color)}>{s.value}</div>
                </div>
              ))}
            </div>

            {/* Configuration panel */}
            {showConfig && (
              <div className="border border-slate-700/50 rounded-xl p-4 space-y-4 bg-slate-900/60">
                <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                  <Settings2 className="w-4 h-4" /> Scanner Configuration
                </h3>

                <div>
                  <label className="text-xs text-slate-400 mb-2 block">Timeframes to Scan</label>
                  <div className="flex gap-2">
                    {ALL_TIMEFRAMES.map(tf => (
                      <button
                        key={tf}
                        onClick={() => toggleTF(tf)}
                        className={cn('px-3 py-1.5 rounded-lg text-xs font-bold border transition-all', selectedTFs.includes(tf) ? 'bg-violet-600 border-violet-500 text-white' : 'border-slate-600 text-slate-400 hover:border-slate-500')}
                      >
                        {tf}
                      </button>
                    ))}
                  </div>
                  <p className="text-xs text-slate-500 mt-1">Selecting multiple timeframes runs a scan for each independently</p>
                </div>

                <div>
                  <label className="text-xs text-slate-400 mb-2 block">Coins to Watch ({selectedCoins.length} selected)</label>
                  <div className="flex flex-wrap gap-1.5">
                    {TOP_COINS.map(coin => (
                      <button
                        key={coin}
                        onClick={() => toggleCoin(coin)}
                        className={cn('px-2 py-1 rounded text-xs font-semibold border transition-all', selectedCoins.includes(coin) ? 'bg-blue-600/30 border-blue-500/50 text-blue-300' : 'border-slate-700 text-slate-500 hover:border-slate-600')}
                      >
                        {coin}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Min Confidence</label>
                    <div className="flex items-center gap-2">
                      <input type="range" min={60} max={95} value={minConf} onChange={e => setMinConf(+e.target.value)} className="flex-1 accent-violet-500" />
                      <span className="text-sm font-bold text-violet-400 w-10">{minConf}%</span>
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Min Grade</label>
                    <div className="flex gap-1">
                      {['A+', 'A', 'B', 'C'].map(g => (
                        <button key={g} onClick={() => setMinGrade(g)} className={cn('px-2 py-1 rounded text-xs font-bold border', minGrade === g ? 'bg-violet-600 border-violet-500 text-white' : 'border-slate-600 text-slate-400')}>
                          {g}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <label className="text-xs text-slate-400 block mb-1">Notifications</label>
                    <button onClick={() => setNotify(!notify)} className={cn('flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs border transition-all', notify ? 'bg-emerald-600/20 border-emerald-500/40 text-emerald-400' : 'border-slate-600 text-slate-400')}>
                      <Bell className="w-3 h-3" /> {notify ? 'On' : 'Off'}
                    </button>
                  </div>
                </div>

                <div className="flex gap-2 pt-2">
                  <Button size="sm" className="bg-violet-600 hover:bg-violet-500 text-xs h-8" onClick={() => configMut.mutate()} disabled={configMut.isPending}>
                    {configMut.isPending ? <Loader2 className="w-3 h-3 mr-1 animate-spin" /> : <CheckCircle className="w-3 h-3 mr-1" />}
                    Apply & Restart
                  </Button>
                  <Button size="sm" variant="outline" className="border-slate-600 text-slate-300 text-xs h-8" onClick={() => setShowConfig(false)}>Cancel</Button>
                </div>
              </div>
            )}

            {/* Manual scan trigger */}
            <div className="flex items-center gap-3 pt-2 border-t border-slate-700/40 mt-3">
              <span className="text-xs text-slate-400">Trigger immediate scan:</span>
              {ALL_TIMEFRAMES.map(tf => (
                <button
                  key={tf}
                  onClick={() => { setManualTF(tf); scanNowMut.mutate(tf); }}
                  disabled={scanNowMut.isPending}
                  className="px-3 py-1 rounded-lg text-xs font-semibold border border-slate-600 text-slate-300 hover:border-violet-500 hover:text-violet-400 transition-all disabled:opacity-50"
                >
                  {scanNowMut.isPending && manualTF === tf ? <Loader2 className="w-3 h-3 animate-spin inline mr-1" /> : null}
                  Scan {tf}
                </button>
              ))}
            </div>
          </div>

          {/* ── LATEST SIGNALS FROM SCANNER ─────────────────────────────────────── */}
          <div>
            <div className="flex items-center gap-3 mb-3">
              <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                <Radar className="w-4 h-4 text-emerald-400" />
                Latest Scanner Signals
              </h3>
              {/* Live scan activity summary */}
              {scanner?.lastScanSummary && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs bg-slate-800 border border-slate-700 rounded-full px-2 py-0.5 text-slate-400">
                    {scanner.lastScanSummary.coinsScanned} scanned
                  </span>
                  <span className="text-xs bg-slate-800 border border-violet-700/40 rounded-full px-2 py-0.5 text-violet-400">
                    {scanner.lastScanSummary.passedMathFilter} passed TA
                  </span>
                  {scanner.lastScanSummary.filteredByMacro > 0 && (
                    <span className="text-xs bg-slate-800 border border-yellow-700/40 rounded-full px-2 py-0.5 text-yellow-400">
                      {scanner.lastScanSummary.filteredByMacro} macro-filtered
                    </span>
                  )}
                  <span className="text-xs bg-slate-800 border border-emerald-700/40 rounded-full px-2 py-0.5 text-emerald-400">
                    {scanner.lastScanSummary.signalsGenerated} signals
                  </span>
                  <span className="text-xs text-slate-600">
                    {scanner.lastScanSummary.timeframe} · {(scanner.lastScanSummary.scanDurationMs / 1000).toFixed(1)}s
                  </span>
                </div>
              )}
            </div>

            {/* Manual scan results take priority over stored results */}
            {(() => {
              const displayResults: ScanResult[] =
                (scanNowMut.data as any)?.results?.length > 0
                  ? (scanNowMut.data as any).results
                  : (scanner?.lastResults ?? []);

              if (scanNowMut.isPending) {
                return (
                  <div className="border border-slate-700/50 rounded-xl p-8 flex flex-col items-center gap-3 bg-slate-800/30">
                    <Loader2 className="w-8 h-8 text-violet-400 animate-spin" />
                    <p className="text-sm text-slate-400">Scanning {selectedCoins.length} coins on {manualTF}...</p>
                    <p className="text-xs text-slate-600">Stage 1: math filter → Stage 2: sentiment → Stage 3: AI (only for top coins)</p>
                  </div>
                );
              }

              if (scanner?.running) {
                return (
                  <div className="border border-slate-700/50 rounded-xl p-6 flex items-center gap-3 bg-slate-800/30">
                    <Loader2 className="w-5 h-5 text-emerald-400 animate-spin" />
                    <div>
                      <p className="text-sm text-slate-300">Auto-scan in progress...</p>
                      <p className="text-xs text-slate-500">Results will appear here when complete</p>
                    </div>
                  </div>
                );
              }

              if (displayResults.length === 0) {
                return (
                  <div className="border border-slate-700/50 rounded-xl p-8 text-center bg-slate-800/30 space-y-2">
                    <Radar className="w-8 h-8 text-slate-600 mx-auto" />
                    <p className="text-sm text-slate-400">No signals met the quality threshold</p>
                    {scanner?.lastScanSummary ? (
                      <div className="text-xs text-slate-600 space-y-1">
                        <p>
                          {scanner.lastScanSummary.coinsScanned} coins scanned ·{' '}
                          {scanner.lastScanSummary.passedMathFilter} passed TA filter ·{' '}
                          {scanner.lastScanSummary.filteredByMacro > 0 && `${scanner.lastScanSummary.filteredByMacro} blocked by ${scanner.lastScanSummary.macroRegime ?? 'macro'} regime`}
                        </p>
                        <p>Try "Scan 1h" or lower Min Confidence in Configure to see more results</p>
                      </div>
                    ) : (
                      <p className="text-xs text-slate-600">Click one of the Scan buttons above to run an immediate scan</p>
                    )}
                  </div>
                );
              }

              return (
                <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
                  {displayResults.map((r, i) => <SignalCard key={i} r={r} />)}
                </div>
              );
            })()}
          </div>

          {/* ── QUICK STATS ────────────────────────────────────────────────── */}
          {stats && (
            <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
              {[
                { label: 'Today P&L', value: `$${stats.todayPnl >= 0 ? '+' : ''}${stats.todayPnl.toFixed(2)}`, color: stats.todayPnl >= 0 ? 'text-emerald-400' : 'text-red-400' },
                { label: '7-Day P&L', value: `$${stats.weekPnl >= 0 ? '+' : ''}${stats.weekPnl.toFixed(2)}`, color: stats.weekPnl >= 0 ? 'text-emerald-400' : 'text-red-400' },
                { label: '7D Win Rate', value: `${(stats.winRate7d * 100).toFixed(0)}%`, color: stats.winRate7d >= 0.6 ? 'text-emerald-400' : stats.winRate7d >= 0.4 ? 'text-yellow-400' : 'text-red-400' },
                { label: 'Total Trades', value: String(stats.totalTrades), color: 'text-blue-400' },
                { label: 'Open Trades', value: String(stats.openTrades), color: stats.openTrades > 0 ? 'text-violet-400' : 'text-slate-500' },
              ].map(s => (
                <div key={s.label} className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-4">
                  <div className="text-xs text-slate-400 mb-1">{s.label}</div>
                  <div className={cn('text-xl font-bold', s.color)}>{s.value}</div>
                </div>
              ))}
            </div>
          )}

          {/* ── MARKET REGIME ──────────────────────────────────────────────── */}
          {regime && (
            <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5">
              <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
                <Globe className="w-4 h-4 text-sky-400" /> Live Market Regime
                <span className="text-xs text-slate-500">updated {new Date(regime.timestamp).toLocaleTimeString()}</span>
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="space-y-3">
                  <div className="flex items-center gap-3">
                    <RegimeChip regime={regime.regime} />
                    <span className="text-xs text-slate-400">{regime.confidence}% confident</span>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs">
                    {[
                      { label: 'BTC.D', value: `${regime.macro.btcDominance.toFixed(1)}%` },
                      { label: 'Session', value: regime.session },
                      { label: 'Trade', value: regime.tradeableSide },
                    ].map(m => (
                      <div key={m.label} className="bg-slate-700/40 rounded p-2">
                        <div className="text-slate-500">{m.label}</div>
                        <div className="font-bold text-white">{m.value}</div>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-slate-300 bg-slate-700/30 rounded-lg p-3 leading-relaxed">{regime.narrative}</p>
                </div>
                <div className="space-y-2">
                  <ScoreBar label="Macro Score" score={regime.macroScore} color="#0ea5e9" />
                  <ScoreBar label="Session Quality" score={regime.sessionScore} color="#8b5cf6" />
                  <div className="flex items-center justify-center pt-2">
                    <FearGreedGauge value={regime.fearGreed.value} label={regime.fearGreed.label} />
                  </div>
                </div>
                <div className="space-y-2">
                  {regime.warnings.length > 0 ? regime.warnings.map((w, i) => (
                    <div key={i} className="flex items-start gap-2 text-xs text-yellow-400 bg-yellow-400/10 rounded-lg p-2.5">
                      <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />{w}
                    </div>
                  )) : (
                    <div className="flex items-center gap-2 text-xs text-emerald-400 bg-emerald-400/10 rounded-lg p-2.5">
                      <CheckCircle className="w-3 h-3" /> No macro warnings — clean conditions
                    </div>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* ── PERFORMANCE REPORT ──────────────────────────────────────────── */}
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-sm font-semibold text-slate-300 flex items-center gap-2">
                <BookOpen className="w-4 h-4 text-pink-400" /> Learning Agent — Performance Report
              </h3>
              <div className="flex gap-1">
                {(['daily', 'weekly', 'monthly'] as const).map(p => (
                  <Button key={p} size="sm" variant={perfPeriod === p ? 'default' : 'outline'}
                    onClick={() => setPerfPeriod(p)}
                    className={cn('text-xs h-7', perfPeriod !== p && 'border-slate-700 text-slate-400')}>
                    {p.charAt(0).toUpperCase() + p.slice(1)}
                  </Button>
                ))}
              </div>
            </div>
            {perfLoading ? (
              <div className="h-24 flex items-center justify-center gap-2 text-slate-500">
                <Loader2 className="w-4 h-4 animate-spin" /> Analyzing trade history...
              </div>
            ) : report && report.totalTrades > 0 ? (
              <div className="space-y-4">
                <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
                  {[
                    { label: 'Win Rate', value: `${(report.winRate * 100).toFixed(0)}%`, color: report.winRate >= 0.6 ? '#10b981' : report.winRate >= 0.4 ? '#eab308' : '#ef4444' },
                    { label: 'Profit Factor', value: report.profitFactor.toFixed(2), color: report.profitFactor >= 1.5 ? '#10b981' : '#ef4444' },
                    { label: 'Total P&L', value: `$${report.totalPnl.toFixed(2)}`, color: report.totalPnl >= 0 ? '#10b981' : '#ef4444' },
                    { label: 'Max DD', value: `${report.maxDrawdown.toFixed(1)}%`, color: report.maxDrawdown <= 5 ? '#10b981' : report.maxDrawdown <= 15 ? '#eab308' : '#ef4444' },
                    { label: 'Sharpe', value: report.sharpeRatio.toFixed(2), color: report.sharpeRatio >= 1 ? '#10b981' : '#eab308' },
                    { label: 'W/L', value: `${report.wins}/${report.losses}`, color: '#0ea5e9' },
                  ].map(s => (
                    <div key={s.label} className="bg-slate-700/40 rounded-lg p-3 text-center">
                      <div className="text-xs text-slate-400 mb-1">{s.label}</div>
                      <div className="text-lg font-bold" style={{ color: s.color }}>{s.value}</div>
                    </div>
                  ))}
                </div>
                {report.aiInsights && (
                  <div className="bg-violet-500/10 border border-violet-500/20 rounded-lg p-4">
                    <div className="flex items-center gap-2 mb-2"><Brain className="w-4 h-4 text-violet-400" /><span className="text-xs font-semibold text-violet-400">AI Learning Insights</span></div>
                    <p className="text-xs text-slate-300 leading-relaxed whitespace-pre-line">{report.aiInsights}</p>
                  </div>
                )}
                {report.patterns.length > 0 && (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                    {report.patterns.slice(0, 4).map((p, i) => (
                      <div key={i} className="bg-slate-700/30 rounded-lg p-3">
                        <div className="flex justify-between mb-1">
                          <span className="text-xs font-medium text-white">{p.factor}</span>
                          <span className={cn('text-xs font-bold', p.winRate >= 0.6 ? 'text-emerald-400' : 'text-red-400')}>{(p.winRate * 100).toFixed(0)}% WR</span>
                        </div>
                        <div className="text-xs text-slate-400">{p.recommendation}</div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : (
              <div className="h-24 flex items-center justify-center text-slate-500 text-sm">
                No closed trades yet — start the scanner to generate signals and track performance
              </div>
            )}
          </div>

          {/* ── HOW IT WORKS ──────────────────────────────────────────────── */}
          <div className="bg-slate-800/60 border border-slate-700/50 rounded-xl p-5">
            <h3 className="text-sm font-semibold text-slate-300 mb-4 flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" /> How the Autonomous Loop Works
            </h3>
            <div className="grid grid-cols-1 md:grid-cols-5 gap-3 text-xs">
              {[
                { step: '1', icon: Radar, label: 'Scanner Fires', desc: 'Every 15m/1h/4h/1d — fetches live Binance candles for all watched coins', color: '#0ea5e9' },
                { step: '2', icon: Layers, label: '17-Factor TA', desc: 'Phase 2 confluence engine scores RSI, MACD, EMA, SMC, volume, session timing', color: '#8b5cf6' },
                { step: '3', icon: Eye, label: 'Sentiment Check', desc: 'Coinglass funding + Perplexity news + Arkham whale flows — all in parallel', color: '#f59e0b' },
                { step: '4', icon: Globe, label: 'Macro Filter', desc: 'Fear & Greed + BTC Dominance — skips scans in VOLATILE/AVOID regimes', color: '#10b981' },
                { step: '5', icon: Bell, label: 'Signal + Alert', desc: 'Approved signals saved to DB + Telegram/Discord notification sent instantly', color: '#ec4899' },
              ].map(s => (
                <div key={s.step} className="bg-slate-700/30 rounded-xl p-4">
                  <div className="flex items-center gap-2 mb-2">
                    <span className="w-6 h-6 rounded-full text-xs font-black flex items-center justify-center text-white" style={{ backgroundColor: s.color + '66' }}>{s.step}</span>
                    <s.icon className="w-4 h-4" style={{ color: s.color }} />
                    <span className="font-semibold text-white">{s.label}</span>
                  </div>
                  <p className="text-slate-400 text-xs leading-relaxed">{s.desc}</p>
                </div>
              ))}
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
