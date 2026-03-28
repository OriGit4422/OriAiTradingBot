import { useEffect, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { getQuantumSignal } from '@/lib/strategies';
import { fetchKlines } from '@/lib/binance';
import { enhanceSignalsWithAI } from '@/lib/signal-ai';
import { cn } from '@/lib/utils';
import {
  Flame, TrendingUp, TrendingDown, RefreshCw, Loader2,
  Trophy, Target, Shield, Zap, Activity,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { toast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';

const SIGNAL_COINS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX'];
const TIMEFRAMES = ['5m', '15m', '1h', '4h'];

interface TopSignalsPanelProps {
  onSelectCoin?: (coin: string) => void;
}

export function TopSignalsPanel({ onSelectCoin }: TopSignalsPanelProps) {
  const [allSignals, setAllSignals] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('1h');
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);

  const fetchSignals = useCallback(async () => {
    setIsLoading(true);
    const tasks = SIGNAL_COINS.flatMap(coin => TIMEFRAMES.map(tf => ({ coin, tf })));

    const results = await Promise.allSettled(
      tasks.map(async ({ coin, tf }) => {
        const data = await fetchKlines(coin, tf, 150);
        if (data.length > 50) {
          const signal = getQuantumSignal(coin, data[data.length - 1].close, data);
          signal.timeframe = tf;
          return signal;
        }
        return null;
      })
    );

    const signals = results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && r.value !== null)
      .map(r => r.value);

    const enhanced = await enhanceSignalsWithAI(signals, 12);
    setAllSignals(enhanced);
    setLastUpdated(new Date());
    setIsLoading(false);
  }, []);

  useEffect(() => {
    fetchSignals();
    const interval = setInterval(fetchSignals, 120000);
    return () => clearInterval(interval);
  }, [fetchSignals]);

  const calcRR = (s: any) =>
    Math.abs(s.tp - s.entry) / (Math.abs(s.entry - s.sl) || 1);

  const getTop10 = (tf: string) =>
    allSignals
      .filter(s => s.timeframe === tf)
      .filter(s => calcRR(s) >= 1.8)           // drop poor R:R signals
      .sort((a, b) => {
        const sa = a.signalScore ?? a.confidence;
        const sb = b.signalScore ?? b.confidence;
        return sb - sa;                          // highest composite score first
      })
      .slice(0, 10);

  const getConfidenceColor = (conf: number) => {
    if (conf >= 90) return 'text-orange-500';
    if (conf >= 80) return 'text-green-400';
    if (conf >= 70) return 'text-primary';
    return 'text-muted-foreground';
  };

  const getConfidenceBg = (conf: number) => {
    if (conf >= 90) return 'bg-orange-500';
    if (conf >= 80) return 'bg-green-500';
    if (conf >= 70) return 'bg-primary';
    return 'bg-muted-foreground';
  };

  const getRRColor = (rr: number) => {
    if (rr >= 3.0) return 'text-emerald-400 font-black';
    if (rr >= 2.5) return 'text-green-400 font-bold';
    if (rr >= 2.0) return 'text-primary font-semibold';
    return 'text-yellow-500';
  };

  const getRRBadge = (rr: number) => {
    if (rr >= 3.0) return 'bg-emerald-500/15 border-emerald-500/30 text-emerald-400';
    if (rr >= 2.5) return 'bg-green-500/15 border-green-500/30 text-green-400';
    if (rr >= 2.0) return 'bg-primary/10 border-primary/30 text-primary';
    return 'bg-yellow-500/10 border-yellow-500/30 text-yellow-400';
  };

  const handleExecute = async (signal: any, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await apiRequest('POST', '/api/positions', {
        symbol: `${signal.coin}USDT`,
        amount: 1,
        entryPrice: signal.entry,
        type: signal.type,
        leverage: 10,
        status: 'open',
      });
      queryClient.invalidateQueries({ queryKey: ['/api/positions'] });
      toast({
        title: 'Position Opened',
        description: `${signal.type} ${signal.coin}/USDT at $${signal.entry.toLocaleString(undefined, { maximumFractionDigits: 4 })}`,
        duration: 3000,
      });
    } catch (err: any) {
      toast({ title: 'Error', description: err.message, variant: 'destructive' });
    }
  };

  const rankEmoji = (i: number) => {
    if (i === 0) return '🥇';
    if (i === 1) return '🥈';
    if (i === 2) return '🥉';
    return `${i + 1}`;
  };

  return (
    <div className="bg-card rounded-xl border border-orange-500/20 overflow-hidden shadow-[0_0_20px_rgba(249,115,22,0.06)]">
      {/* Header */}
      <div className="p-3 border-b border-border bg-gradient-to-r from-orange-500/10 via-yellow-500/5 to-transparent flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <div className="h-8 w-8 rounded-xl bg-orange-500/20 border border-orange-500/30 flex items-center justify-center shadow-[0_0_10px_rgba(249,115,22,0.3)]">
            <Trophy className="w-4 h-4 text-orange-500" />
          </div>
          <div>
            <span className="text-xs font-black uppercase tracking-widest text-orange-500">Top 10 Priority Signals</span>
            <div className="flex items-center gap-2 mt-0.5">
              <span className="text-[9px] text-muted-foreground font-mono">Per timeframe · ranked by AI confidence</span>
              {lastUpdated && (
                <span className="text-[9px] text-muted-foreground/60 font-mono">
                  · {lastUpdated.toLocaleTimeString()}
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isLoading && (
            <div className="flex items-center gap-1">
              <Activity className="w-3 h-3 text-primary animate-pulse" />
              <span className="text-[9px] text-muted-foreground font-mono">Scanning...</span>
            </div>
          )}
          <Button
            size="icon"
            variant="ghost"
            className="h-7 w-7 hover:text-orange-500"
            onClick={fetchSignals}
            disabled={isLoading}
            data-testid="button-refresh-top-signals"
          >
            <RefreshCw className={cn('w-3.5 h-3.5', isLoading && 'animate-spin')} />
          </Button>
        </div>
      </div>

      {/* Tabs */}
      <Tabs value={activeTab} onValueChange={setActiveTab}>
        <div className="flex items-center gap-2 px-3 pt-2">
          <TabsList className="grid grid-cols-4 h-7 bg-muted/30 flex-1">
            {TIMEFRAMES.map(tf => {
              const top = getTop10(tf);
              const longs = top.filter(s => s.type === 'LONG').length;
              const shorts = top.filter(s => s.type === 'SHORT').length;
              return (
                <TabsTrigger
                  key={tf}
                  value={tf}
                  className="text-[10px] h-5 px-2 data-[state=active]:text-orange-500 gap-1"
                  data-testid={`tab-topsignals-${tf}`}
                >
                  {tf}
                  {top.length > 0 && !isLoading && (
                    <span className="flex gap-0.5 ml-1">
                      {longs > 0 && <span className="text-[7px] text-green-500 font-bold">▲{longs}</span>}
                      {shorts > 0 && <span className="text-[7px] text-red-500 font-bold">▼{shorts}</span>}
                    </span>
                  )}
                </TabsTrigger>
              );
            })}
          </TabsList>
        </div>

        {TIMEFRAMES.map(tf => {
          const top10 = getTop10(tf);
          return (
            <TabsContent key={tf} value={tf} className="mt-0 p-3 pt-2">
              {isLoading ? (
                <div className="flex flex-col items-center justify-center py-10 gap-3">
                  <div className="relative">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                    <Trophy className="w-3 h-3 text-orange-500 absolute -top-0.5 -right-0.5" />
                  </div>
                  <div className="text-center">
                    <p className="text-xs font-medium text-foreground">Scanning {tf} charts...</p>
                    <p className="text-[10px] text-muted-foreground mt-0.5">Ranking {SIGNAL_COINS.length} assets by AI confidence</p>
                  </div>
                </div>
              ) : top10.length === 0 ? (
                <div className="text-center py-8 text-xs text-muted-foreground">No signals found for {tf} timeframe</div>
              ) : (
                <div className="space-y-1">
                  {/* Table header */}
                  <div className="hidden md:grid grid-cols-12 gap-1 text-[9px] text-muted-foreground/60 uppercase font-mono px-2 pb-1 border-b border-border/30">
                    <div className="col-span-1 text-center">#</div>
                    <div className="col-span-2">Asset</div>
                    <div className="col-span-1">Dir</div>
                    <div className="col-span-2">Entry</div>
                    <div className="col-span-2">TP</div>
                    <div className="col-span-1">SL</div>
                    <div className="col-span-1">R:R</div>
                    <div className="col-span-1 text-right">AI%</div>
                    <div className="col-span-1 text-right">Score</div>
                  </div>

                  {top10.map((signal, idx) => {
                    const rr = calcRR(signal);
                    const rrLabel = rr.toFixed(2);
                    const score = signal.signalScore ?? signal.confidence;
                    const isHot = score >= 90;
                    const isGood = score >= 80;

                    return (
                      <div
                        key={`${signal.coin}-${tf}-${idx}`}
                        className={cn(
                          'group relative rounded-lg cursor-pointer transition-all hover:scale-[1.003]',
                          'border',
                          signal.type === 'LONG'
                            ? 'bg-green-500/4 border-green-500/20 hover:border-green-500/40 hover:bg-green-500/8'
                            : 'bg-red-500/4 border-red-500/20 hover:border-red-500/40 hover:bg-red-500/8',
                          isHot && 'shadow-[0_0_8px_rgba(249,115,22,0.15)]'
                        )}
                        onClick={() => onSelectCoin?.(signal.coin)}
                        data-testid={`top-signal-${tf}-${idx}`}
                      >
                        {/* hot glow left bar */}
                        <div className={cn(
                          'absolute left-0 top-0 h-full w-0.5 rounded-l-lg',
                          isHot ? 'bg-orange-500' : signal.type === 'LONG' ? 'bg-green-500' : 'bg-red-500'
                        )} />

                        {/* Mobile layout */}
                        <div className="md:hidden p-2 pl-3">
                          <div className="flex items-center justify-between mb-1.5">
                            <div className="flex items-center gap-1.5">
                              <span className="text-[10px] text-muted-foreground/60 font-mono w-5">{rankEmoji(idx)}</span>
                              <span className="text-sm font-black">{signal.coin}</span>
                              <Badge
                                variant={signal.type === 'LONG' ? 'default' : 'destructive'}
                                className="text-[8px] h-4 px-1 font-bold"
                              >
                                {signal.type === 'LONG' ? <TrendingUp className="w-2.5 h-2.5 mr-0.5" /> : <TrendingDown className="w-2.5 h-2.5 mr-0.5" />}
                                {signal.type}
                              </Badge>
                              {isHot && <Flame className="w-3 h-3 text-orange-500 fill-orange-500/40" />}
                            </div>
                            <div className="flex items-center gap-1.5">
                              <span className={cn('text-[9px] font-bold font-mono border rounded px-1', getRRBadge(rr))}>
                                1:{rrLabel}
                              </span>
                              <span className={cn('text-sm font-black font-mono', getConfidenceColor(score))}>
                                {score}
                              </span>
                            </div>
                          </div>
                          <div className="grid grid-cols-3 gap-1 text-[9px] font-mono">
                            <div><span className="text-muted-foreground">E </span><span className="font-bold">{signal.entry.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
                            <div><span className="text-green-500">TP </span><span className="text-green-400 font-bold">{signal.tp.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
                            <div><span className="text-red-500">SL </span><span className="text-red-400 font-bold">{signal.sl.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span></div>
                          </div>
                          <div className="mt-1 flex items-center gap-2">
                            <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                              <div className={cn('h-full rounded-full', getConfidenceBg(score))} style={{ width: `${score}%` }} />
                            </div>
                            <span className="text-[8px] text-muted-foreground font-mono">AI: {signal.confidence}%</span>
                          </div>
                        </div>

                        {/* Desktop layout */}
                        <div className="hidden md:grid grid-cols-12 gap-1 items-center pl-3 pr-2 py-2">
                          <div className="col-span-1 text-[10px] font-mono text-center text-muted-foreground/80">
                            {rankEmoji(idx)}
                          </div>
                          <div className="col-span-2 flex items-center gap-1">
                            <span className="text-xs font-black">{signal.coin}</span>
                            {isHot && <Flame className="w-2.5 h-2.5 text-orange-500 fill-orange-500/40 shrink-0" />}
                          </div>
                          <div className="col-span-1">
                            <span className={cn(
                              'text-[9px] font-black',
                              signal.type === 'LONG' ? 'text-green-400' : 'text-red-400'
                            )}>
                              {signal.type === 'LONG' ? '▲ L' : '▼ S'}
                            </span>
                          </div>
                          <div className="col-span-2 text-[10px] font-mono font-semibold">
                            {signal.entry.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </div>
                          <div className="col-span-2 text-[10px] font-mono text-green-400 font-semibold">
                            {signal.tp.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </div>
                          <div className="col-span-1 text-[10px] font-mono text-red-400 font-semibold">
                            {signal.sl.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                          </div>
                          {/* R:R — color coded */}
                          <div className={cn('col-span-1 text-[9px] font-mono px-1 py-0.5 rounded border text-center', getRRBadge(rr))}>
                            1:{rrLabel}
                          </div>
                          <div className="col-span-1 flex items-center justify-end">
                            <span className={cn('text-[10px] font-bold font-mono', getConfidenceColor(signal.confidence))}>
                              {signal.confidence}%
                            </span>
                          </div>
                          {/* Composite score */}
                          <div className="col-span-1 flex items-center justify-end">
                            <span className={cn('text-[10px] font-black font-mono', getConfidenceColor(score))}>
                              {score}
                            </span>
                          </div>
                        </div>

                        {/* Execute button on hover */}
                        <button
                          className={cn(
                            'absolute right-2 top-1/2 -translate-y-1/2 opacity-0 group-hover:opacity-100 transition-opacity',
                            'text-[8px] font-bold px-1.5 py-0.5 rounded border',
                            signal.type === 'LONG'
                              ? 'border-green-500/40 text-green-400 hover:bg-green-500/20'
                              : 'border-red-500/40 text-red-400 hover:bg-red-500/20',
                            'hidden md:block'
                          )}
                          onClick={(e) => handleExecute(signal, e)}
                        >
                          <Target className="w-2.5 h-2.5 inline mr-0.5" />
                          Execute
                        </button>
                      </div>
                    );
                  })}

                  {/* Summary footer */}
                  <div className="flex items-center justify-between pt-2 border-t border-border/30 mt-1">
                    <div className="flex items-center gap-3 text-[9px] font-mono text-muted-foreground">
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-green-500 inline-block" />
                        {top10.filter(s => s.type === 'LONG').length} Longs
                      </span>
                      <span className="flex items-center gap-1">
                        <span className="w-2 h-2 rounded-full bg-red-500 inline-block" />
                        {top10.filter(s => s.type === 'SHORT').length} Shorts
                      </span>
                      <span className="flex items-center gap-1">
                        <Flame className="w-2.5 h-2.5 text-orange-500" />
                        {top10.filter(s => s.confidence >= 90).length} Hot
                      </span>
                    </div>
                    <div className="text-[9px] font-mono text-muted-foreground">
                      Avg conf: <span className="font-bold text-primary">
                        {top10.length > 0 ? Math.round(top10.reduce((s, x) => s + x.confidence, 0) / top10.length) : 0}%
                      </span>
                    </div>
                  </div>
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>
    </div>
  );
}
