import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { apiRequest } from '@/lib/queryClient';
import { toast } from '@/hooks/use-toast';
import { Sidebar } from '@/components/layout/Sidebar';
import { GoldChart } from '@/components/dashboard/GoldChart';
import { NewsBar } from '@/components/dashboard/NewsBar';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import {
  TrendingUp, TrendingDown, Minus, Zap, Activity, BarChart3,
  RefreshCw, Play, Square, AlertTriangle, CheckCircle2, Loader2,
  ArrowUpRight, ArrowDownRight, Target, Shield, Info, Wifi, WifiOff,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Settings } from '@shared/schema';

// ── Types ─────────────────────────────────────────────────────────────────────

interface GoldSpot {
  price: number;
  change24h: number;
  changePct24h: number;
  high24h: number;
  low24h: number;
  timestamp: number;
}

interface GoldSignal {
  type: 'BUY' | 'SELL' | 'NEUTRAL';
  entry: number;
  tp: number;
  sl: number;
  rrRatio: number;
  confidence: number;
  timeframe: string;
  reasoning: string;
  trend: 'BULLISH' | 'BEARISH' | 'SIDEWAYS';
  strength: 'STRONG' | 'MODERATE' | 'WEAK';
  keyLevels: { support: number; resistance: number };
  indicators: {
    rsi: number;
    macd: { value: number; signal: number; histogram: number };
    ema20: number;
    ema50: number;
    atr: number;
    bbUpper: number;
    bbLower: number;
    bbMiddle: number;
  };
  generatedAt: number;
}

interface MT5Account {
  id?: string;
  name?: string;
  login?: string;
  server?: string;
  balance?: number;
  equity?: number;
  freeMargin?: number;
  leverage?: number;
  currency?: string;
  connected: boolean;
  message?: string;
}

const TIMEFRAMES = ['15m', '1h', '4h', '1d'] as const;

// ── Helper components ─────────────────────────────────────────────────────────

function PriceChange({ value, pct }: { value: number; pct: number }) {
  const pos = value >= 0;
  return (
    <span className={cn('flex items-center gap-1 text-sm font-semibold', pos ? 'text-green-600' : 'text-red-500')}>
      {pos ? <ArrowUpRight className="w-3.5 h-3.5" /> : <ArrowDownRight className="w-3.5 h-3.5" />}
      {pos ? '+' : ''}{value.toFixed(2)} ({pct.toFixed(2)}%)
    </span>
  );
}

function SignalBadge({ type }: { type: GoldSignal['type'] }) {
  return (
    <Badge className={cn(
      'text-xs font-bold px-2.5 py-1',
      type === 'BUY'  ? 'bg-green-100 text-green-700 border-green-200' :
      type === 'SELL' ? 'bg-red-100 text-red-600 border-red-200' :
      'bg-yellow-100 text-yellow-700 border-yellow-200'
    )}>
      {type === 'BUY' ? '▲ BUY' : type === 'SELL' ? '▼ SELL' : '— NEUTRAL'}
    </Badge>
  );
}

function ConfidenceMeter({ value }: { value: number }) {
  const color = value >= 75 ? 'bg-green-500' : value >= 60 ? 'bg-yellow-500' : 'bg-red-400';
  return (
    <div className="space-y-1">
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>AI Confidence</span>
        <span className={cn('font-bold', value >= 75 ? 'text-green-600' : value >= 60 ? 'text-yellow-600' : 'text-red-500')}>{value}%</span>
      </div>
      <div className="h-2 w-full bg-secondary rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all duration-700', color)} style={{ width: `${value}%` }} />
      </div>
    </div>
  );
}

// ── Main page ─────────────────────────────────────────────────────────────────

export default function GoldPage() {
  const qc = useQueryClient();
  const [activeTimeframe, setActiveTimeframe] = useState<string>('1h');
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [isPlacingTrade, setIsPlacingTrade] = useState(false);

  // Settings (for auto-trading config)
  const { data: settings } = useQuery<Settings>({ queryKey: ['/api/settings'] });

  // Live gold price — refetch every 30s
  const { data: spot, isLoading: spotLoading, refetch: refetchSpot } = useQuery<GoldSpot>({
    queryKey: ['/api/gold/price'],
    refetchInterval: autoRefresh ? 30000 : false,
  });

  // Gold signal for active timeframe
  const { data: signal, isLoading: signalLoading, refetch: refetchSignal, isFetching: signalFetching } = useQuery<GoldSignal>({
    queryKey: ['/api/gold/signal', activeTimeframe],
    queryFn: async () => {
      const res = await fetch(`/api/gold/signal/${activeTimeframe}`);
      if (!res.ok) throw new Error((await res.json()).message);
      return res.json();
    },
    refetchInterval: autoRefresh ? 120000 : false,
    staleTime: 60000,
  });

  // MT5 account status
  const { data: mt5, refetch: refetchMT5 } = useQuery<MT5Account>({
    queryKey: ['/api/mt5/account'],
    refetchInterval: autoRefresh ? 60000 : false,
  });

  // Auto-trading toggle mutation
  const autoTradeMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await apiRequest('PATCH', '/api/settings', { goldAutoTradingEnabled: enabled });
      return res.json();
    },
    onSuccess: (_, enabled) => {
      qc.invalidateQueries({ queryKey: ['/api/settings'] });
      toast({ title: enabled ? 'Auto Trading Enabled' : 'Auto Trading Disabled',
              description: enabled ? 'Bot will trade gold signals automatically via MT5.' : 'Manual mode — signals will not auto-execute.' });
    },
    onError: (e: Error) => toast({ title: 'Failed', description: e.message, variant: 'destructive' }),
  });

  // Manual trade execution
  const handlePlaceTrade = useCallback(async () => {
    if (!signal || signal.type === 'NEUTRAL') {
      toast({ title: 'No actionable signal', description: 'Wait for a BUY or SELL signal.', variant: 'destructive' });
      return;
    }
    setIsPlacingTrade(true);
    try {
      const res = await apiRequest('POST', '/api/gold/trade', {
        type: signal.type,
        entry: signal.entry,
        tp: signal.tp,
        sl: signal.sl,
        confidence: signal.confidence,
        lotSize: settings?.goldLotSize ?? 0.01,
      });
      const data = await res.json();
      if (data.status === 'success') {
        toast({ title: 'Trade Placed!', description: data.message });
        refetchMT5();
      } else {
        toast({ title: 'Trade Failed', description: data.message, variant: 'destructive' });
      }
    } catch (e: any) {
      toast({ title: 'Trade Error', description: e.message, variant: 'destructive' });
    } finally {
      setIsPlacingTrade(false);
    }
  }, [signal, settings, refetchMT5]);

  const handleRefreshAll = () => {
    refetchSpot();
    refetchSignal();
    refetchMT5();
  };

  const mt5Connected = mt5?.connected === true;
  const autoEnabled = settings?.goldAutoTradingEnabled ?? false;

  return (
    <div className="min-h-screen bg-background text-foreground font-sans flex">
      <Sidebar />
      <div className="flex-1 md:pl-64">

        {/* ── Header ─────────────────────────────────────────────────────── */}
        <div className="sticky top-0 z-20 bg-white/95 backdrop-blur-md border-b border-border/60 shadow-sm">
          <div className="flex items-center justify-between px-4 md:px-6 py-3">
            <div className="flex items-center gap-3">
              {/* Gold icon */}
              <div className="h-9 w-9 rounded-lg bg-amber-100 border border-amber-200 flex items-center justify-center">
                <span className="text-lg leading-none">🥇</span>
              </div>
              <div>
                <h1 className="text-base font-bold text-foreground">Gold Trading</h1>
                <p className="text-xs text-muted-foreground">XAUUSD · AI-Powered Signals · MT5 Auto-Trading</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                <div className={cn('w-2 h-2 rounded-full', autoRefresh ? 'bg-green-500 animate-pulse' : 'bg-muted')} />
                Live
              </div>
              <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={handleRefreshAll}>
                <RefreshCw className="w-3.5 h-3.5" /> Refresh
              </Button>
            </div>
          </div>
        </div>

        <div className="p-4 md:p-6 space-y-4 max-w-7xl">

          {/* ── Price Bar ──────────────────────────────────────────────────── */}
          <Card className="bg-gradient-to-r from-amber-50 to-yellow-50 border-amber-200">
            <CardContent className="py-4 px-5">
              {spotLoading ? (
                <div className="flex items-center gap-2 text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" /> Loading gold price...
                </div>
              ) : spot ? (
                <div className="flex flex-wrap items-center gap-4 md:gap-8">
                  <div>
                    <div className="text-[11px] text-amber-700 font-mono uppercase tracking-wider mb-0.5">XAU/USD · Spot</div>
                    <div className="text-3xl font-bold text-amber-900">${spot.price.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                    <PriceChange value={spot.change24h} pct={spot.changePct24h} />
                  </div>
                  <div className="flex gap-6 text-sm">
                    <div>
                      <div className="text-xs text-muted-foreground">24h High</div>
                      <div className="font-semibold text-green-700">${spot.high24h.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">24h Low</div>
                      <div className="font-semibold text-red-600">${spot.low24h.toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Updated</div>
                      <div className="font-semibold text-foreground">{new Date(spot.timestamp).toLocaleTimeString()}</div>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="text-muted-foreground text-sm">Price data unavailable</div>
              )}
            </CardContent>
          </Card>

          {/* ── Live Chart ─────────────────────────────────────────────────── */}
          <Card className="bg-white border-amber-200 shadow-sm overflow-hidden">
            <CardHeader className="pb-0 pt-3 px-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-black uppercase tracking-widest text-amber-700">XAU/USD Live Chart</span>
                  <span className="text-[10px] text-muted-foreground">· Yahoo Finance GC=F</span>
                </div>
                {/* Timeframe selector in chart header */}
                <div className="flex items-center gap-1">
                  {TIMEFRAMES.map(tf => (
                    <button
                      key={tf}
                      onClick={() => setActiveTimeframe(tf)}
                      className={cn(
                        'px-2.5 py-1 rounded text-[11px] font-mono font-bold transition-all',
                        activeTimeframe === tf
                          ? 'bg-amber-500 text-white shadow-sm'
                          : 'text-muted-foreground hover:bg-amber-50 hover:text-amber-700'
                      )}
                    >
                      {tf.toUpperCase()}
                    </button>
                  ))}
                  {signalFetching && <Loader2 className="w-3.5 h-3.5 animate-spin text-amber-500 ml-1" />}
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-0 pt-2">
              <GoldChart timeframe={activeTimeframe} />
            </CardContent>
          </Card>

          {/* ── News bar ───────────────────────────────────────────────────── */}
          <NewsBar coin="XAUUSD" />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">

            {/* ── Signal Panel ───────────────────────────────────────────── */}
            <div className="lg:col-span-2 space-y-4">

              {/* Signal card */}
              <Card className="bg-white border-border shadow-sm">
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center">
                        <Zap className="w-4 h-4 text-amber-600" />
                      </div>
                      <div>
                        <CardTitle className="text-sm">AI Signal · {activeTimeframe.toUpperCase()}</CardTitle>
                        <CardDescription className="text-[11px]">
                          {signal ? new Date(signal.generatedAt).toLocaleTimeString() : 'Generating...'}
                        </CardDescription>
                      </div>
                    </div>
                    {signal && <SignalBadge type={signal.type} />}
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  {signalLoading ? (
                    <div className="flex flex-col items-center justify-center py-10 gap-3 text-muted-foreground">
                      <Loader2 className="w-8 h-8 animate-spin text-primary" />
                      <span className="text-sm">Analyzing XAUUSD {activeTimeframe}...</span>
                    </div>
                  ) : signal ? (
                    <>
                      {/* Trend + Strength */}
                      <div className="flex items-center gap-3 flex-wrap">
                        <Badge variant="outline" className={cn('text-xs gap-1',
                          signal.trend === 'BULLISH' ? 'border-green-300 text-green-700 bg-green-50' :
                          signal.trend === 'BEARISH' ? 'border-red-300 text-red-600 bg-red-50' :
                          'border-yellow-300 text-yellow-700 bg-yellow-50')}>
                          {signal.trend === 'BULLISH' ? <TrendingUp className="w-3 h-3" /> : signal.trend === 'BEARISH' ? <TrendingDown className="w-3 h-3" /> : <Minus className="w-3 h-3" />}
                          {signal.trend}
                        </Badge>
                        <Badge variant="outline" className="text-xs gap-1 border-primary/30 text-primary bg-primary/5">
                          <Activity className="w-3 h-3" /> {signal.strength}
                        </Badge>
                        <Badge variant="outline" className="text-xs border-border text-muted-foreground">
                          R:R {signal.rrRatio.toFixed(2)}
                        </Badge>
                      </div>

                      {/* Trade levels */}
                      {signal.type !== 'NEUTRAL' && (
                        <div className={cn('rounded-xl border p-4 space-y-3', signal.type === 'BUY' ? 'bg-green-50/70 border-green-200' : 'bg-red-50/70 border-red-200')}>
                          <div className="grid grid-cols-3 gap-3">
                            {[
                              { label: 'Entry', value: signal.entry, icon: <BarChart3 className="w-3.5 h-3.5 text-blue-500" /> },
                              { label: 'Take Profit', value: signal.tp, icon: <Target className="w-3.5 h-3.5 text-green-600" /> },
                              { label: 'Stop Loss', value: signal.sl, icon: <Shield className="w-3.5 h-3.5 text-red-500" /> },
                            ].map(({ label, value, icon }) => (
                              <div key={label} className="bg-white/80 rounded-lg p-2.5 border border-white/60">
                                <div className="flex items-center gap-1 text-[10px] text-muted-foreground mb-1">
                                  {icon} {label}
                                </div>
                                <div className="text-sm font-bold text-foreground">${value.toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                              </div>
                            ))}
                          </div>
                          <div className="flex justify-between text-xs text-muted-foreground px-1">
                            <span>R:R ratio: <span className="font-bold text-foreground">{signal.rrRatio.toFixed(2)}</span></span>
                            <span>ATR: <span className="font-bold text-foreground">${signal.indicators.atr.toFixed(2)}</span></span>
                          </div>
                        </div>
                      )}

                      {signal.type === 'NEUTRAL' && (
                        <div className="rounded-xl border border-yellow-200 bg-yellow-50/60 p-4 text-sm text-yellow-800">
                          <div className="flex items-start gap-2">
                            <AlertTriangle className="w-4 h-4 mt-0.5 flex-shrink-0" />
                            <span>No clear signal at this timeframe. Market appears sideways — wait for a stronger setup.</span>
                          </div>
                        </div>
                      )}

                      {/* Confidence */}
                      <ConfidenceMeter value={signal.confidence} />

                      {/* AI Reasoning */}
                      <div className="rounded-lg bg-primary/5 border border-primary/15 p-3">
                        <div className="flex items-center gap-1.5 text-[11px] font-semibold text-primary mb-1.5">
                          <Info className="w-3 h-3" /> AI Analysis
                        </div>
                        <p className="text-xs text-foreground/80 leading-relaxed">{signal.reasoning}</p>
                      </div>

                      {/* Key levels */}
                      <div className="grid grid-cols-2 gap-2">
                        <div className="rounded-lg border border-green-200 bg-green-50/50 p-2.5">
                          <div className="text-[10px] text-muted-foreground uppercase font-mono mb-0.5">Support</div>
                          <div className="text-sm font-bold text-green-700">${signal.keyLevels.support.toLocaleString()}</div>
                        </div>
                        <div className="rounded-lg border border-red-200 bg-red-50/50 p-2.5">
                          <div className="text-[10px] text-muted-foreground uppercase font-mono mb-0.5">Resistance</div>
                          <div className="text-sm font-bold text-red-600">${signal.keyLevels.resistance.toLocaleString()}</div>
                        </div>
                      </div>
                    </>
                  ) : (
                    <div className="text-center py-8 text-muted-foreground text-sm">Failed to load signal. Try refreshing.</div>
                  )}
                </CardContent>
              </Card>

              {/* Indicators card */}
              {signal && (
                <Card className="bg-white border-border shadow-sm">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <Activity className="w-4 h-4 text-primary" /> Technical Indicators
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                      {[
                        { label: 'RSI (14)', value: signal.indicators.rsi.toFixed(1),
                          color: signal.indicators.rsi > 70 ? 'text-red-500' : signal.indicators.rsi < 30 ? 'text-green-600' : 'text-foreground',
                          badge: signal.indicators.rsi > 70 ? 'Overbought' : signal.indicators.rsi < 30 ? 'Oversold' : 'Neutral' },
                        { label: 'MACD Hist', value: signal.indicators.macd.histogram.toFixed(2),
                          color: signal.indicators.macd.histogram > 0 ? 'text-green-600' : 'text-red-500', badge: '' },
                        { label: 'EMA 20', value: `$${signal.indicators.ema20.toFixed(0)}`, color: 'text-foreground', badge: '' },
                        { label: 'EMA 50', value: `$${signal.indicators.ema50.toFixed(0)}`, color: 'text-foreground', badge: '' },
                        { label: 'BB Upper', value: `$${signal.indicators.bbUpper.toFixed(0)}`, color: 'text-foreground', badge: '' },
                        { label: 'BB Lower', value: `$${signal.indicators.bbLower.toFixed(0)}`, color: 'text-foreground', badge: '' },
                        { label: 'ATR (14)', value: `$${signal.indicators.atr.toFixed(2)}`, color: 'text-foreground', badge: '' },
                        { label: 'MACD Sig', value: signal.indicators.macd.signal.toFixed(2), color: 'text-foreground', badge: '' },
                      ].map(ind => (
                        <div key={ind.label} className="rounded-lg border border-border bg-secondary/30 p-2.5">
                          <div className="text-[10px] text-muted-foreground uppercase font-mono">{ind.label}</div>
                          <div className={cn('text-sm font-bold mt-0.5', ind.color)}>{ind.value}</div>
                          {ind.badge && <div className="text-[9px] text-muted-foreground mt-0.5">{ind.badge}</div>}
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* ── Right Panel: MT5 + Auto Trading ────────────────────────── */}
            <div className="space-y-4">

              {/* MT5 Connection */}
              <Card className={cn('border shadow-sm', mt5Connected ? 'bg-green-50/50 border-green-200' : 'bg-white border-border')}>
                <CardHeader className="pb-3">
                  <div className="flex items-center justify-between">
                    <CardTitle className="text-sm flex items-center gap-2">
                      {mt5Connected
                        ? <Wifi className="w-4 h-4 text-green-600" />
                        : <WifiOff className="w-4 h-4 text-muted-foreground" />}
                      MT5 Connection
                    </CardTitle>
                    <Badge className={cn('text-[10px]', mt5Connected ? 'bg-green-100 text-green-700 border-green-200' : 'bg-secondary text-muted-foreground border-border')} variant="outline">
                      {mt5Connected ? 'Connected' : 'Disconnected'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {mt5Connected && mt5 ? (
                    <>
                      <div className="grid grid-cols-2 gap-2">
                        {[
                          { label: 'Balance', value: `$${(mt5.balance ?? 0).toLocaleString()}` },
                          { label: 'Equity', value: `$${(mt5.equity ?? 0).toLocaleString()}` },
                          { label: 'Free Margin', value: `$${(mt5.freeMargin ?? 0).toLocaleString()}` },
                          { label: 'Leverage', value: `1:${mt5.leverage ?? 100}` },
                        ].map(({ label, value }) => (
                          <div key={label} className="rounded-md bg-white border border-green-200/60 p-2">
                            <div className="text-[10px] text-muted-foreground">{label}</div>
                            <div className="text-sm font-semibold text-foreground">{value}</div>
                          </div>
                        ))}
                      </div>
                      <div className="rounded-md bg-green-50 border border-green-200 p-2 text-xs text-green-800">
                        <CheckCircle2 className="w-3 h-3 inline mr-1" />
                        {mt5.name ?? 'MT5 Account'} · {mt5.server ?? 'Server'}
                      </div>
                    </>
                  ) : (
                    <div className="space-y-2">
                      <p className="text-xs text-muted-foreground leading-relaxed">
                        Connect your MT5 account via MetaApi to enable auto trading.
                      </p>
                      <ol className="text-xs text-muted-foreground space-y-1 list-decimal list-inside">
                        <li>Sign up at <span className="text-primary font-medium">metaapi.cloud</span></li>
                        <li>Install MetaApi EA on your MT5</li>
                        <li>Add your Token + Account ID in Settings</li>
                      </ol>
                      <Button variant="outline" size="sm" className="w-full h-8 text-xs" onClick={() => window.location.href = '/settings'}>
                        Configure in Settings →
                      </Button>
                    </div>
                  )}
                </CardContent>
              </Card>

              {/* Auto Trading Toggle */}
              <Card className={cn('border shadow-sm', autoEnabled && mt5Connected ? 'bg-primary/5 border-primary/30' : 'bg-white border-border')}>
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Play className={cn('w-4 h-4', autoEnabled && mt5Connected ? 'text-primary' : 'text-muted-foreground')} />
                    Auto Trading Bot
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <Label className="text-sm font-semibold">Auto Execute Signals</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">Bot trades XAUUSD automatically</p>
                    </div>
                    <Switch
                      checked={autoEnabled}
                      disabled={!mt5Connected || autoTradeMutation.isPending}
                      onCheckedChange={(v) => autoTradeMutation.mutate(v)}
                    />
                  </div>

                  {!mt5Connected && (
                    <div className="rounded-lg border border-yellow-200 bg-yellow-50 p-3 text-xs text-yellow-800 flex items-start gap-2">
                      <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
                      Connect MT5 first to enable auto trading.
                    </div>
                  )}

                  {autoEnabled && mt5Connected && (
                    <div className="space-y-2 rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Lot Size</span>
                        <span className="font-semibold">{settings?.goldLotSize ?? 0.01}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Max Daily Trades</span>
                        <span className="font-semibold">{settings?.goldMaxDailyTrades ?? 5}</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Min Confidence</span>
                        <span className="font-semibold">{settings?.goldMinConfidence ?? 75}%</span>
                      </div>
                    </div>
                  )}

                  {/* Manual Trade Button */}
                  {mt5Connected && signal && signal.type !== 'NEUTRAL' && (
                    <Button
                      className={cn('w-full h-9 gap-2 font-semibold text-sm', signal.type === 'BUY' ? 'bg-green-600 hover:bg-green-700 text-white' : 'bg-red-600 hover:bg-red-700 text-white')}
                      onClick={handlePlaceTrade}
                      disabled={isPlacingTrade}
                    >
                      {isPlacingTrade
                        ? <Loader2 className="w-4 h-4 animate-spin" />
                        : signal.type === 'BUY' ? <TrendingUp className="w-4 h-4" /> : <TrendingDown className="w-4 h-4" />}
                      {isPlacingTrade ? 'Placing...' : `Execute ${signal.type} Now`}
                    </Button>
                  )}

                  {(!mt5Connected || !signal || signal.type === 'NEUTRAL') && (
                    <Button className="w-full h-9 text-sm" variant="outline" disabled>
                      <Square className="w-4 h-4 mr-2" />
                      {!mt5Connected ? 'MT5 Not Connected' : 'No Signal to Execute'}
                    </Button>
                  )}
                </CardContent>
              </Card>

              {/* Trading config summary */}
              <Card className="bg-white border-border shadow-sm">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm">Trading Config</CardTitle>
                </CardHeader>
                <CardContent className="space-y-2">
                  {[
                    { label: 'Symbol', value: 'XAUUSD (Gold)' },
                    { label: 'Lot Size', value: `${settings?.goldLotSize ?? 0.01} lots` },
                    { label: 'Max Trades / Day', value: settings?.goldMaxDailyTrades ?? 5 },
                    { label: 'Min AI Confidence', value: `${settings?.goldMinConfidence ?? 75}%` },
                  ].map(({ label, value }) => (
                    <div key={label} className="flex justify-between text-xs py-1.5 border-b border-border/40 last:border-0">
                      <span className="text-muted-foreground">{label}</span>
                      <span className="font-semibold text-foreground">{value}</span>
                    </div>
                  ))}
                  <Button variant="ghost" size="sm" className="w-full text-xs h-7 text-primary" onClick={() => window.location.href = '/settings'}>
                    Edit in Settings →
                  </Button>
                </CardContent>
              </Card>
            </div>
          </div>

          {/* ── Bottom note ────────────────────────────────────────────────── */}
          <div className="rounded-lg border border-amber-200 bg-amber-50/50 p-3 flex items-start gap-2 text-xs text-amber-800">
            <AlertTriangle className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" />
            <span>
              <strong>Risk Disclaimer:</strong> Gold trading involves significant risk. AI signals are for informational purposes.
              Always configure appropriate stop-losses and never risk more than you can afford to lose.
              Past performance does not guarantee future results.
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
