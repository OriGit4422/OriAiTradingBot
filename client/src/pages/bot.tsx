import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { toast } from '@/hooks/use-toast';
import { Sidebar } from '@/components/layout/Sidebar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from '@/components/ui/dialog';
import {
  Bot, Play, Pause, Square, ShieldAlert, Lock, Unlock, RefreshCw, Wallet,
  TrendingUp, TrendingDown, Activity, Gauge, AlertTriangle, CheckCircle2,
  XCircle, Zap, Wifi, Database, Clock, Beaker, FlaskConical, Rocket, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { BotSettings, BotTrade, BotLog, Signal } from '@shared/schema';

// ── Types from /api/bot/state ───────────────────────────────────────────────
interface BotMetrics {
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
interface BotState {
  settings: BotSettings;
  metrics: BotMetrics;
  effectiveState: 'active' | 'paused' | 'stopped' | 'locked';
  canTrade: boolean;
  blockReasons: string[];
  openTrades: BotTrade[];
  lastExecuted: BotTrade | null;
  lastRejected: BotLog | null;
  liveReadiness: { unlocked: boolean; disclaimerAccepted: boolean; paperTradeCount: number; paperTradesRequired: number };
  apiStatus: string;
  marketDataStatus: string;
  dataFreshness: string;
}

const fmtUsd = (n: number | null | undefined) =>
  `$${(n ?? 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const MODES = [
  { id: 'paper', label: 'Paper', icon: FlaskConical, hint: 'Simulated — no real funds' },
  { id: 'testnet', label: 'Testnet', icon: Beaker, hint: 'Not wired yet' },
  { id: 'live', label: 'Live', icon: Rocket, hint: 'Requires unlock' },
] as const;

// ── Helper components ────────────────────────────────────────────────────────
function StatePill({ state }: { state: BotState['effectiveState'] }) {
  const map = {
    active: { label: 'ACTIVE', cls: 'bg-green-100 text-green-700 border-green-200', dot: 'bg-green-500' },
    paused: { label: 'PAUSED', cls: 'bg-amber-100 text-amber-700 border-amber-200', dot: 'bg-amber-500' },
    stopped: { label: 'STOPPED', cls: 'bg-red-100 text-red-600 border-red-200', dot: 'bg-red-500' },
    locked: { label: 'LOCKED', cls: 'bg-red-100 text-red-600 border-red-200', dot: 'bg-red-500' },
  }[state];
  return (
    <Badge className={cn('text-xs font-bold px-2.5 py-1 gap-1.5 border', map.cls)} data-testid="badge-bot-state">
      <span className={cn('w-2 h-2 rounded-full', map.dot, state === 'active' && 'animate-pulse')} />
      {map.label}
    </Badge>
  );
}

function Metric({ label, value, icon: Icon, tone, sub, testId }: {
  label: string; value: string; icon: any; tone?: 'pos' | 'neg' | 'muted'; sub?: string; testId?: string;
}) {
  const toneCls = tone === 'pos' ? 'text-green-600' : tone === 'neg' ? 'text-red-500' : 'text-foreground';
  return (
    <Card className="border-border/60">
      <CardContent className="p-4">
        <div className="flex items-center gap-2 text-muted-foreground mb-1.5">
          <Icon className="w-3.5 h-3.5" />
          <span className="text-[11px] uppercase font-mono tracking-wider">{label}</span>
        </div>
        <div className={cn('text-xl font-display font-bold', toneCls)} data-testid={testId}>{value}</div>
        {sub && <div className="text-[11px] text-muted-foreground mt-0.5">{sub}</div>}
      </CardContent>
    </Card>
  );
}

function StatusRow({ icon: Icon, label, value, ok }: { icon: any; label: string; value: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between text-sm py-1.5">
      <span className="flex items-center gap-2 text-muted-foreground"><Icon className="w-3.5 h-3.5" />{label}</span>
      <span className={cn('font-medium flex items-center gap-1.5', ok ? 'text-green-600' : 'text-amber-600')}>
        <span className={cn('w-1.5 h-1.5 rounded-full', ok ? 'bg-green-500' : 'bg-amber-500')} />{value}
      </span>
    </div>
  );
}

// ── Main page ────────────────────────────────────────────────────────────────
export default function BotPage() {
  const [disclaimerOpen, setDisclaimerOpen] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const [exitPrices, setExitPrices] = useState<Record<string, string>>({});
  const [selectedSignal, setSelectedSignal] = useState<string>('');

  const { data: state, isLoading } = useQuery<BotState>({
    queryKey: ['/api/bot/state'],
    refetchInterval: 15000,
  });
  const { data: trades = [] } = useQuery<BotTrade[]>({ queryKey: ['/api/bot/trades'], refetchInterval: 30000 });
  const { data: logs = [] } = useQuery<BotLog[]>({ queryKey: ['/api/bot/logs'], refetchInterval: 30000 });
  const { data: signals = [] } = useQuery<Signal[]>({ queryKey: ['/api/signals'] });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['/api/bot/state'] });
    queryClient.invalidateQueries({ queryKey: ['/api/bot/trades'] });
    queryClient.invalidateQueries({ queryKey: ['/api/bot/logs'] });
  };

  const control = useMutation({
    mutationFn: (action: string) => apiRequest('POST', '/api/bot/control', { action }),
    onSuccess: () => { invalidate(); },
    onError: (e: any) => toast({ title: 'Action failed', description: e.message, variant: 'destructive' }),
  });

  const setMode = useMutation({
    mutationFn: (mode: string) => apiRequest('POST', '/api/bot/mode', { mode }),
    onSuccess: async (res) => {
      const data = await res.json();
      if (!data.ok) toast({ title: 'Mode change blocked', description: data.message, variant: 'destructive' });
      invalidate();
    },
    onError: (e: any) => toast({ title: 'Mode change failed', description: e.message, variant: 'destructive' }),
  });

  const unlock = useMutation({
    mutationFn: () => apiRequest('POST', '/api/bot/unlock-live', { accepted: true }),
    onSuccess: async (res) => {
      const data = await res.json();
      if (data.ok) { toast({ title: 'Live trading unlocked' }); setDisclaimerOpen(false); }
      else toast({ title: 'Cannot unlock yet', description: data.message, variant: 'destructive' });
      invalidate();
    },
    onError: (e: any) => toast({ title: 'Unlock failed', description: e.message, variant: 'destructive' }),
  });

  const preset = useMutation({
    mutationFn: () => apiRequest('POST', '/api/bot/preset/safe-mode'),
    onSuccess: () => { toast({ title: '$100 Safe Mode applied' }); invalidate(); },
  });

  const execute = useMutation({
    mutationFn: (signalId: string) => apiRequest('POST', '/api/bot/execute', { signalId }),
    onSuccess: async (res) => {
      const data = await res.json();
      if (data.ok) toast({ title: 'Paper trade opened', description: data.message });
      else if (data.notWired) toast({ title: data.code, description: data.message, variant: 'destructive' });
      else toast({ title: 'Signal rejected', description: data.message, variant: 'destructive' });
      invalidate();
    },
    onError: async (e: any) => {
      // 400 responses also land here via throwIfResNotOk
      toast({ title: 'Not executed', description: String(e.message).replace(/^\d+:\s*/, ''), variant: 'destructive' });
      invalidate();
    },
  });

  const closeTrade = useMutation({
    mutationFn: ({ id, exitPrice }: { id: string; exitPrice: number }) =>
      apiRequest('POST', `/api/bot/trades/${id}/close`, { exitPrice }),
    onSuccess: () => { toast({ title: 'Trade closed' }); invalidate(); },
    onError: (e: any) => toast({ title: 'Close failed', description: e.message, variant: 'destructive' }),
  });

  const s = state?.settings;
  const m = state?.metrics;
  const eff = state?.effectiveState ?? 'paused';
  const dailyPnl = m?.dailyPnl ?? 0;

  return (
    <div className="min-h-screen bg-background text-foreground font-sans flex">
      <Sidebar />
      <div className="flex-1 md:pl-64">
        <div className="max-w-7xl mx-auto p-4 md:p-6 space-y-5">
          {/* Header */}
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                <Bot className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-display font-bold flex items-center gap-2">
                  Auto Trading Bot
                  {state && <StatePill state={eff} />}
                </h1>
                <p className="text-xs text-muted-foreground">
                  Risk-managed paper engine · {s ? `${s.connectedExchange.toUpperCase()}` : '—'}
                </p>
              </div>
            </div>
            <Button variant="outline" size="sm" onClick={invalidate} data-testid="button-refresh">
              <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
            </Button>
          </div>

          {/* Safety banner */}
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-xs text-amber-800 flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
            <span>
              Educational, risk-managed bot. It never promises profit. Only <b>Paper</b> mode executes today —
              Testnet &amp; Live validate the order but place nothing until exchange routing ships.
            </span>
          </div>

          {isLoading || !state || !s || !m ? (
            <div className="flex items-center justify-center py-24 text-muted-foreground">
              <Loader2 className="w-5 h-5 animate-spin mr-2" /> Loading bot state…
            </div>
          ) : (
            <>
              {/* Mode + Controls */}
              <Card>
                <CardContent className="p-4 flex flex-wrap items-center justify-between gap-4">
                  <div className="space-y-2">
                    <Label className="text-[11px] uppercase font-mono tracking-wider text-muted-foreground">Trading Mode</Label>
                    <div className="flex gap-2">
                      {MODES.map((mode) => {
                        const active = s.mode === mode.id;
                        const locked = mode.id === 'live' && !s.liveUnlocked;
                        return (
                          <button
                            key={mode.id}
                            onClick={() => {
                              if (locked) { setDisclaimerOpen(true); return; }
                              setMode.mutate(mode.id);
                            }}
                            data-testid={`button-mode-${mode.id}`}
                            className={cn(
                              'relative px-3.5 py-2 rounded-lg border text-sm font-medium transition-all flex items-center gap-2',
                              active ? 'border-primary bg-primary/8 text-primary' : 'border-border text-muted-foreground hover:bg-secondary/70',
                            )}
                          >
                            <mode.icon className="w-3.5 h-3.5" />
                            {mode.label}
                            {locked && <Lock className="w-3 h-3" />}
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-[11px] uppercase font-mono tracking-wider text-muted-foreground">Controls</Label>
                    <div className="flex gap-2">
                      {eff === 'active' ? (
                        <Button size="sm" variant="outline" onClick={() => control.mutate('pause')} disabled={control.isPending} data-testid="button-pause">
                          <Pause className="w-3.5 h-3.5 mr-1.5" /> Pause
                        </Button>
                      ) : (
                        <Button size="sm" onClick={() => control.mutate('start')} disabled={control.isPending || eff === 'locked'} data-testid="button-start">
                          <Play className="w-3.5 h-3.5 mr-1.5" /> {s.status === 'stopped' ? 'Resume' : 'Start'}
                        </Button>
                      )}
                      <Button
                        size="sm" variant="destructive"
                        onClick={() => control.mutate('emergency-stop')}
                        disabled={control.isPending}
                        data-testid="button-emergency-stop"
                      >
                        <ShieldAlert className="w-3.5 h-3.5 mr-1.5" /> Emergency Stop
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label className="text-[11px] uppercase font-mono tracking-wider text-muted-foreground">Preset</Label>
                    <Button size="sm" variant="outline" onClick={() => preset.mutate()} disabled={preset.isPending} data-testid="button-safe-mode">
                      <Zap className="w-3.5 h-3.5 mr-1.5" /> $100 Safe Mode
                    </Button>
                  </div>
                </CardContent>
              </Card>

              {/* Block reasons */}
              {state.blockReasons.length > 0 && (
                <div className="rounded-lg border border-border bg-secondary/40 px-4 py-2.5 text-xs flex flex-wrap items-center gap-2" data-testid="block-reasons">
                  <span className="text-muted-foreground font-medium">Not trading because:</span>
                  {state.blockReasons.map((r, i) => (
                    <Badge key={i} variant="outline" className="text-[11px] font-normal border-amber-200 text-amber-700 bg-amber-50">{r}</Badge>
                  ))}
                </div>
              )}

              {/* Metrics grid */}
              <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
                <Metric label="Paper Balance" value={fmtUsd(s.paperBalance)} icon={Wallet} testId="metric-balance"
                  sub={`Start ${fmtUsd(s.paperStartingBalance)}`} />
                <Metric label="Available" value={fmtUsd(m.availableBalance)} icon={Gauge} testId="metric-available"
                  sub={`${fmtUsd(m.marginInUse)} in use`} />
                <Metric label="Risk / Trade" value={fmtUsd(m.currentRiskPerTradeUsd)} icon={ShieldAlert} testId="metric-risk"
                  sub={`${s.riskPerTradePercent}% of balance`} />
                <Metric label="Daily PnL" value={`${dailyPnl >= 0 ? '+' : ''}${fmtUsd(dailyPnl)}`} icon={dailyPnl >= 0 ? TrendingUp : TrendingDown}
                  tone={dailyPnl > 0 ? 'pos' : dailyPnl < 0 ? 'neg' : 'muted'} testId="metric-daily-pnl" sub={`${m.closedToday} closed today`} />
                <Metric label="Daily Loss Used" value={`${m.dailyLossUsedPct.toFixed(0)}%`} icon={AlertTriangle}
                  tone={m.dailyLossUsedPct >= 100 ? 'neg' : 'muted'} testId="metric-loss-used"
                  sub={`${fmtUsd(m.dailyLossUsedUsd)} / ${fmtUsd(m.dailyLossLimitUsd)}`} />
                <Metric label="Open / Day" value={`${m.openTrades} / ${m.tradesToday}`} icon={Activity} testId="metric-counts"
                  sub={`max ${s.maxOpenTrades} open · ${s.maxTradesPerDay}/day`} />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                {/* Connection & status */}
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">System Status</CardTitle></CardHeader>
                  <CardContent className="pt-0 divide-y divide-border/50">
                    <StatusRow icon={Wifi} label="API Connection" value={state.apiStatus} ok />
                    <StatusRow icon={Database} label="Market Data" value={state.marketDataStatus} ok={state.marketDataStatus === 'live'} />
                    <StatusRow icon={Clock} label="Data Freshness" value={state.dataFreshness} ok={state.dataFreshness === 'fresh'} />
                    <StatusRow icon={Activity} label="Pending Orders" value="0" ok />
                    <StatusRow icon={ShieldAlert} label="Consecutive Losses" value={`${m.consecutiveLosses} / ${s.stopAfterLosses}`} ok={m.consecutiveLosses < s.stopAfterLosses} />
                  </CardContent>
                </Card>

                {/* Live trading lock */}
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      {s.liveUnlocked ? <Unlock className="w-4 h-4 text-green-600" /> : <Lock className="w-4 h-4 text-amber-600" />}
                      Live Trading Lock
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-muted-foreground">Status</span>
                      <Badge className={cn(s.liveUnlocked ? 'bg-green-100 text-green-700 border-green-200' : 'bg-amber-100 text-amber-700 border-amber-200')}>
                        {s.liveUnlocked ? 'UNLOCKED' : 'LOCKED'}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      {state.liveReadiness.disclaimerAccepted ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600" /> : <XCircle className="w-3.5 h-3.5 text-muted-foreground" />}
                      Risk disclaimer accepted
                    </div>
                    <div className="flex items-center gap-2 text-xs">
                      {state.liveReadiness.paperTradeCount >= state.liveReadiness.paperTradesRequired ? <CheckCircle2 className="w-3.5 h-3.5 text-green-600" /> : <XCircle className="w-3.5 h-3.5 text-muted-foreground" />}
                      {state.liveReadiness.paperTradeCount} / {state.liveReadiness.paperTradesRequired} paper trades
                    </div>
                    {!s.liveUnlocked && (
                      <Button size="sm" variant="outline" className="w-full mt-1" onClick={() => setDisclaimerOpen(true)} data-testid="button-open-unlock">
                        <Unlock className="w-3.5 h-3.5 mr-1.5" /> Review Live Unlock
                      </Button>
                    )}
                  </CardContent>
                </Card>

                {/* Manual execute */}
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Execute a Signal</CardTitle>
                    <CardDescription className="text-xs">Run a stored signal through the risk engine.</CardDescription>
                  </CardHeader>
                  <CardContent className="pt-0 space-y-2">
                    <select
                      className="w-full text-sm rounded-md border border-border bg-background px-2.5 py-2"
                      value={selectedSignal}
                      onChange={(e) => setSelectedSignal(e.target.value)}
                      data-testid="select-signal"
                    >
                      <option value="">Select a signal…</option>
                      {signals.slice(0, 30).map((sig) => (
                        <option key={sig.id} value={sig.id}>
                          {sig.coin} {sig.type} · {sig.confidence}% · entry {sig.entry}
                        </option>
                      ))}
                    </select>
                    <Button
                      size="sm" className="w-full"
                      disabled={!selectedSignal || execute.isPending}
                      onClick={() => execute.mutate(selectedSignal)}
                      data-testid="button-execute-signal"
                    >
                      {execute.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Play className="w-3.5 h-3.5 mr-1.5" />}
                      Execute ({s.mode})
                    </Button>
                    {state.lastRejected && (
                      <p className="text-[11px] text-muted-foreground pt-1">
                        Last rejected: {state.lastRejected.message}
                      </p>
                    )}
                  </CardContent>
                </Card>
              </div>

              {/* Open trades */}
              <Card>
                <CardHeader className="pb-2"><CardTitle className="text-sm">Open Positions ({state.openTrades.length})</CardTitle></CardHeader>
                <CardContent className="pt-0">
                  {state.openTrades.length === 0 ? (
                    <p className="text-sm text-muted-foreground py-6 text-center">No open paper positions.</p>
                  ) : (
                    <div className="space-y-2">
                      {state.openTrades.map((t) => (
                        <div key={t.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-border/60 p-3" data-testid={`trade-${t.id}`}>
                          <Badge className={cn('text-xs font-bold', t.direction === 'LONG' ? 'bg-green-100 text-green-700 border-green-200' : 'bg-red-100 text-red-600 border-red-200')}>
                            {t.direction === 'LONG' ? '▲' : '▼'} {t.symbol}
                          </Badge>
                          <span className="text-xs text-muted-foreground">Entry {t.entry} · SL {t.stopLoss} {t.tp1 ? `· TP ${t.tp1}` : ''}</span>
                          <span className="text-xs text-muted-foreground">Size {t.positionSize.toFixed(4)} · {t.leverage}x · margin {fmtUsd(t.marginUsed)}</span>
                          {t.grade && <Badge variant="outline" className="text-[11px]">{t.grade}</Badge>}
                          <div className="ml-auto flex items-center gap-1.5">
                            <Input
                              type="number" placeholder="exit price"
                              className="h-8 w-28 text-xs"
                              value={exitPrices[t.id] ?? ''}
                              onChange={(e) => setExitPrices((p) => ({ ...p, [t.id]: e.target.value }))}
                              data-testid={`input-exit-${t.id}`}
                            />
                            <Button
                              size="sm" variant="outline" className="h-8"
                              disabled={!exitPrices[t.id] || closeTrade.isPending}
                              onClick={() => closeTrade.mutate({ id: t.id, exitPrice: Number(exitPrices[t.id]) })}
                              data-testid={`button-close-${t.id}`}
                            >
                              <Square className="w-3 h-3 mr-1" /> Close
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {/* Trade journal */}
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Trade Journal</CardTitle></CardHeader>
                  <CardContent className="pt-0">
                    {trades.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-6 text-center">No trades yet.</p>
                    ) : (
                      <div className="space-y-1.5 max-h-80 overflow-y-auto">
                        {trades.map((t) => (
                          <div key={t.id} className="flex items-center justify-between text-xs border-b border-border/40 py-1.5" data-testid={`journal-${t.id}`}>
                            <span className="flex items-center gap-2">
                              <span className={cn('font-semibold', t.direction === 'LONG' ? 'text-green-600' : 'text-red-500')}>{t.symbol}</span>
                              <span className="text-muted-foreground">{t.direction}</span>
                              <Badge variant="outline" className="text-[10px] py-0">{t.status}</Badge>
                            </span>
                            <span className={cn('font-mono', (t.pnl ?? 0) > 0 ? 'text-green-600' : (t.pnl ?? 0) < 0 ? 'text-red-500' : 'text-muted-foreground')}>
                              {t.status === 'closed' ? `${(t.pnl ?? 0) >= 0 ? '+' : ''}${fmtUsd(t.pnl)}` : '—'}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>

                {/* Bot logs */}
                <Card>
                  <CardHeader className="pb-2"><CardTitle className="text-sm">Bot Logs</CardTitle></CardHeader>
                  <CardContent className="pt-0">
                    {logs.length === 0 ? (
                      <p className="text-sm text-muted-foreground py-6 text-center">No activity yet.</p>
                    ) : (
                      <div className="space-y-1 max-h-80 overflow-y-auto font-mono text-[11px]">
                        {logs.map((l) => (
                          <div key={l.id} className="flex items-start gap-2 py-0.5" data-testid={`log-${l.id}`}>
                            <span className={cn('mt-1 w-1.5 h-1.5 rounded-full flex-shrink-0',
                              l.level === 'error' ? 'bg-red-500' : l.level === 'warn' ? 'bg-amber-500' : l.level === 'success' ? 'bg-green-500' : 'bg-slate-400')} />
                            <span className="text-muted-foreground">{l.message}</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Live unlock disclaimer dialog */}
      <Dialog open={disclaimerOpen} onOpenChange={(o) => { setDisclaimerOpen(o); if (!o) setAccepted(false); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><ShieldAlert className="w-5 h-5 text-amber-600" /> Enable Live Trading</DialogTitle>
            <DialogDescription>Live trading risks real capital. Read and accept before unlocking.</DialogDescription>
          </DialogHeader>
          <div className="space-y-3 text-sm">
            <ul className="list-disc pl-5 space-y-1 text-muted-foreground text-xs">
              <li>This bot is educational and risk-managed. It does <b>not</b> guarantee profit.</li>
              <li>Trading crypto futures with leverage can lose your entire balance.</li>
              <li>You need at least <b>{state?.liveReadiness.paperTradesRequired ?? 20} paper trades</b> first (currently {state?.liveReadiness.paperTradeCount ?? 0}).</li>
              <li>Even after unlocking, live order routing is not connected in this phase — live mode validates orders but places nothing yet.</li>
            </ul>
            <label className="flex items-start gap-2 cursor-pointer">
              <Checkbox checked={accepted} onCheckedChange={(c) => setAccepted(!!c)} data-testid="checkbox-disclaimer" />
              <span className="text-xs">I understand the risks and accept full responsibility for any losses.</span>
            </label>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDisclaimerOpen(false)} data-testid="button-cancel-unlock">Cancel</Button>
            <Button disabled={!accepted || unlock.isPending} onClick={() => unlock.mutate()} data-testid="button-confirm-unlock">
              {unlock.isPending ? <Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Unlock className="w-3.5 h-3.5 mr-1.5" />}
              Unlock Live Trading
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
