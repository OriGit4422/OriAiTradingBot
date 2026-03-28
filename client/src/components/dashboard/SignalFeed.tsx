import { useEffect, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getQuantumSignal, calculateMultiTFConfluence } from '@/lib/strategies';
import { fetchKlines } from '@/lib/binance';
import { enhanceSignalsWithAI } from '@/lib/signal-ai';
import { cn } from '@/lib/utils';
import { Clock, Loader2, BrainCircuit, Zap, Flame, Send, TrendingUp, TrendingDown, BarChart3, RefreshCw, ChevronDown, ChevronRight, Activity, X, Target, Shield } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  DialogClose,
} from '@/components/ui/dialog';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '@/components/ui/tabs';
import { useIsMobile } from '@/hooks/use-mobile';

const SIGNAL_COINS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX'];
const TIMEFRAMES = ['5m', '15m', '1h', '4h'];

interface SignalFeedProps {
  compact?: boolean;
  onSelectCoin?: (coin: string) => void;
}

export function SignalFeed({ compact = false, onSelectCoin }: SignalFeedProps) {
  const isMobile = useIsMobile();
  const [allSignals, setAllSignals] = useState<any[]>([]);
  const [confluenceData, setConfluenceData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTF, setSelectedTF] = useState('ALL');
  const [selectedSignal, setSelectedSignal] = useState<any | null>(null);

  const generateAllSignals = useCallback(async () => {
    setIsLoading(true);
    const coins = isMobile ? SIGNAL_COINS.slice(0, 6) : SIGNAL_COINS;
    const tfs = isMobile ? ['15m', '1h', '4h'] : TIMEFRAMES;
    const candleLimit = isMobile ? 120 : 180;

    const tasks = coins.flatMap(coin =>
      tfs.map(tf => ({ coin, tf }))
    );

    const results = await Promise.allSettled(
      tasks.map(async ({ coin, tf }) => {
        const data = await fetchKlines(coin, tf, candleLimit);
        if (data.length > 50) {
          const signal = getQuantumSignal(coin, data[data.length - 1].close, data);
          signal.timeframe = tf;
          return signal;
        }
        return null;
      })
    );

    const newSignals = results
      .filter((r): r is PromiseFulfilledResult<any> => r.status === 'fulfilled' && r.value !== null)
      .map(r => r.value);

    const aiConfirmed = await enhanceSignalsWithAI(newSignals, isMobile ? 6 : 10);
    setAllSignals(aiConfirmed);
    const confluence = calculateMultiTFConfluence(aiConfirmed);
    setConfluenceData(confluence);
    setIsLoading(false);
  }, [isMobile]);

  useEffect(() => {
    generateAllSignals();
    const interval = setInterval(generateAllSignals, 90000);
    return () => clearInterval(interval);
  }, [generateAllSignals]);

  const filteredSignals = selectedTF === 'ALL'
    ? allSignals.sort((a, b) => b.confidence - a.confidence)
    : allSignals.filter(s => s.timeframe === selectedTF).sort((a, b) => b.confidence - a.confidence);
  const visibleSignals = isMobile ? filteredSignals.slice(0, 12) : filteredSignals;

  const handleExecuteTrade = async (signal: any) => {
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
        title: "Position Opened",
        description: `${signal.type} ${signal.coin}/USDT at $${signal.entry.toLocaleString(undefined, { maximumFractionDigits: 4 })}`,
        duration: 3000,
      });
    } catch (e: any) {
      toast({ title: "Error", description: e.message, variant: "destructive" });
    }
  };

  const getConfidenceColor = (conf: number) => {
    if (conf >= 90) return "text-orange-500";
    if (conf >= 80) return "text-green-500";
    if (conf >= 70) return "text-primary";
    return "text-muted-foreground";
  };

  const getConfidenceBg = (conf: number) => {
    if (conf >= 90) return "bg-orange-500";
    if (conf >= 80) return "bg-green-500";
    if (conf >= 70) return "bg-primary";
    return "bg-muted-foreground";
  };

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-border flex justify-between items-center bg-secondary/40">
        <div className="flex items-center gap-2">
          <BrainCircuit className="w-4 h-4 text-primary" />
          <h3 className="font-display font-semibold text-sm">Quantum Signals</h3>
        </div>
        <div className="flex items-center gap-1">
          <Button size="icon" variant="ghost" className="h-6 w-6" onClick={generateAllSignals} disabled={isLoading} data-testid="button-refresh-signals">
            <RefreshCw className={cn("w-3 h-3", isLoading && "animate-spin")} />
          </Button>
        </div>
      </div>

      <Tabs value={selectedTF} onValueChange={setSelectedTF} className="flex flex-col flex-1 min-h-0">
        <TabsList className="grid grid-cols-5 mx-2 mt-2 mb-1 h-7 bg-secondary">
          <TabsTrigger value="ALL" className="text-[10px] h-5 px-1 data-[state=active]:text-primary">ALL</TabsTrigger>
          {TIMEFRAMES.map(tf => (
            <TabsTrigger key={tf} value={tf} className="text-[10px] h-5 px-1 data-[state=active]:text-primary">{tf}</TabsTrigger>
          ))}
        </TabsList>

        {selectedTF === 'ALL' && confluenceData.length > 0 && (
          <div className="px-2 py-1 border-b border-border/50">
            <div className="text-[9px] text-muted-foreground uppercase font-mono mb-1 flex items-center gap-1">
              <Activity className="w-3 h-3" /> Multi-TF Confluence
            </div>
            <div className="space-y-0.5">
              {confluenceData.slice(0, 3).map(c => (
                <div
                  key={c.coin}
                  className="flex items-center justify-between text-[10px] px-1 py-0.5 rounded hover:bg-secondary/60 cursor-pointer"
                  onClick={() => onSelectCoin?.(c.coin)}
                  data-testid={`confluence-${c.coin}`}
                >
                  <div className="flex items-center gap-1.5">
                    <span className="font-bold">{c.coin}</span>
                    <Badge variant="outline" className={cn("h-4 text-[8px] px-1", c.overallDirection === 'LONG' ? 'text-green-500 border-green-500/30' : c.overallDirection === 'SHORT' ? 'text-red-500 border-red-500/30' : 'text-muted-foreground')}>
                      {c.overallDirection}
                    </Badge>
                  </div>
                  <div className="flex items-center gap-1">
                    <span className="font-mono text-[9px] text-muted-foreground">{c.alignedTimeframes}/{c.totalTimeframes}</span>
                    <div className="w-12 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className={cn("h-full rounded-full", c.confluenceScore >= 80 ? 'bg-green-500' : c.confluenceScore >= 60 ? 'bg-yellow-500' : 'bg-red-500')} style={{ width: `${c.confluenceScore}%` }} />
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        <ScrollArea className="flex-1">
          <div className="divide-y divide-border/30">
            {isLoading ? (
              <div className="flex flex-col items-center justify-center py-12 gap-2">
                <Loader2 className="w-6 h-6 animate-spin text-primary" />
                <span className="text-[10px] text-muted-foreground">Scanning markets...</span>
              </div>
            ) : filteredSignals.length === 0 ? (
              <div className="flex justify-center py-12 text-muted-foreground text-xs">No signals found</div>
            ) : (
              visibleSignals.map((signal) => (
                <div
                  key={`${signal.coin}-${signal.timeframe}-${signal.id}`}
                  className="px-3 py-2.5 hover:bg-primary/5 transition-all cursor-pointer group relative overflow-hidden"
                  onClick={() => {
                    onSelectCoin?.(signal.coin);
                    setSelectedSignal(signal);
                  }}
                  data-testid={`signal-${signal.coin}-${signal.timeframe}`}
                >
                  <div className={cn(
                    "absolute left-0 top-0 h-full w-0.5",
                    signal.type === 'LONG' ? "bg-green-500" : "bg-red-500"
                  )} />

                  <div className="flex justify-between items-start mb-1.5">
                    <div className="flex items-center gap-1.5">
                      <span className="font-bold text-sm">{signal.coin}</span>
                      <Badge variant={signal.type === 'LONG' ? 'default' : 'destructive'} className="text-[8px] h-4 px-1 font-bold">
                        {signal.type === 'LONG' ? <TrendingUp className="w-2.5 h-2.5 mr-0.5" /> : <TrendingDown className="w-2.5 h-2.5 mr-0.5" />}
                        {signal.type}
                      </Badge>
                      <Badge variant="outline" className="text-[8px] h-4 px-1 font-mono">{signal.timeframe}</Badge>
                      {signal.confidence >= 90 && <Flame className="w-3 h-3 text-orange-500 fill-orange-500/50" />}
                    </div>
                    <div className={cn("text-sm font-black font-mono", getConfidenceColor(signal.confidence))}>
                      {signal.confidence}%
                    </div>
                  </div>

                    <div className="flex items-center gap-1 mb-1.5">
                      <Badge variant="outline" className="text-[8px] h-4 px-1 border-primary/20 bg-primary/8 text-primary font-bold">
                        {signal.strategy}
                      </Badge>
                      {signal.aiConfirmation?.verdict && (
                        <Badge
                          variant="outline"
                          className={cn(
                            "text-[8px] h-4 px-1",
                            signal.aiConfirmation.verdict.includes('BUY')
                              ? 'text-green-500 border-green-500/30'
                              : signal.aiConfirmation.verdict.includes('SELL')
                                ? 'text-red-500 border-red-500/30'
                                : 'text-yellow-500 border-yellow-500/30'
                          )}
                        >
                          AI {signal.aiConfirmation.verdict.replace('STRONG_', 'S_')}
                        </Badge>
                      )}
                      {signal.indicators?.rsiDivergence !== 'NONE' && (
                        <Badge variant="outline" className={cn("text-[8px] h-4 px-1", signal.indicators.rsiDivergence === 'BULLISH' ? 'text-green-500 border-green-500/30' : 'text-red-500 border-red-500/30')}>
                          RSI DIV
                        </Badge>
                      )}
                    {signal.indicators?.marketStructure !== 'RANGING' && (
                      <Badge variant="outline" className={cn("text-[8px] h-4 px-1", signal.indicators.marketStructure === 'BULLISH' ? 'text-green-500 border-green-500/30' : 'text-red-500 border-red-500/30')}>
                        {signal.indicators.marketStructure === 'BULLISH' ? 'HH/HL' : 'LH/LL'}
                      </Badge>
                    )}
                  </div>

                  <div className="grid grid-cols-3 gap-1 text-[10px] font-mono bg-secondary/60 p-1.5 rounded">
                    <div>
                      <span className="text-muted-foreground">Entry </span>
                      <span className="font-bold">{signal.entry.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">TP </span>
                      <span className="text-green-400 font-bold">{signal.tp.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                    </div>
                    <div>
                      <span className="text-muted-foreground">SL </span>
                      <span className="text-red-400 font-bold">{signal.sl.toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
                    </div>
                  </div>

                  <div className="mt-1.5 flex items-center gap-1">
                    <div className="flex-1 h-1 bg-muted rounded-full overflow-hidden">
                      <div className={cn("h-full rounded-full transition-all", getConfidenceBg(signal.confidence))} style={{ width: `${signal.confidence}%` }} />
                    </div>
                    <span className="text-[8px] text-muted-foreground font-mono">{signal.confidence >= 85 ? 'HIGH' : 'STD'}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        </ScrollArea>
      </Tabs>

      <Dialog open={!!selectedSignal} onOpenChange={(open) => { if (!open) setSelectedSignal(null); }}>
        <DialogContent className="sm:max-w-md bg-white border-border" data-testid="dialog-signal-detail">
          {selectedSignal && (
            <>
              <DialogHeader>
                <DialogTitle className="flex items-center gap-2">
                  <Zap className="w-5 h-5 text-primary" />
                  <span className="font-display">{selectedSignal.coin}/USDT Signal</span>
                  <Badge variant={selectedSignal.type === 'LONG' ? 'default' : 'destructive'} className="text-xs font-bold">
                    {selectedSignal.type === 'LONG' ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                    {selectedSignal.type}
                  </Badge>
                </DialogTitle>
                <DialogDescription className="flex items-center gap-2">
                  <Badge variant="outline" className="font-mono text-xs">{selectedSignal.timeframe}</Badge>
                  <Badge variant="outline" className="text-xs border-primary/20 bg-primary/8 text-primary">{selectedSignal.strategy}</Badge>
                  {selectedSignal.confidence >= 90 && <Flame className="w-4 h-4 text-orange-500 fill-orange-500/50" />}
                </DialogDescription>
              </DialogHeader>

              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Confidence</span>
                  <div className="flex items-center gap-2">
                    <div className="w-32 h-2 bg-muted rounded-full overflow-hidden">
                      <div className={cn("h-full rounded-full", getConfidenceBg(selectedSignal.confidence))} style={{ width: `${selectedSignal.confidence}%` }} />
                    </div>
                    <span className={cn("text-lg font-black font-mono", getConfidenceColor(selectedSignal.confidence))} data-testid="text-signal-confidence">
                      {selectedSignal.confidence}%
                    </span>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-3">
                  <div className="bg-secondary/60 rounded-lg p-3 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase font-mono mb-1">Entry</div>
                    <div className="text-sm font-bold font-mono" data-testid="text-signal-entry">${selectedSignal.entry.toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
                  </div>
                  <div className="bg-green-500/10 rounded-lg p-3 text-center border border-green-500/20">
                    <div className="text-[10px] text-green-500 uppercase font-mono mb-1">Take Profit</div>
                    <div className="text-sm font-bold font-mono text-green-400" data-testid="text-signal-tp">${selectedSignal.tp.toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
                  </div>
                  <div className="bg-red-500/10 rounded-lg p-3 text-center border border-red-500/20">
                    <div className="text-[10px] text-red-500 uppercase font-mono mb-1">Stop Loss</div>
                    <div className="text-sm font-bold font-mono text-red-400" data-testid="text-signal-sl">${selectedSignal.sl.toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-secondary/60 rounded-lg p-2.5">
                    <div className="text-[10px] text-muted-foreground uppercase font-mono mb-1">RSI</div>
                    <div className={cn("text-sm font-bold font-mono", selectedSignal.indicators?.rsi > 70 ? 'text-red-400' : selectedSignal.indicators?.rsi < 30 ? 'text-green-400' : 'text-foreground')}>
                      {selectedSignal.indicators?.rsi ?? '-'}
                    </div>
                  </div>
                  <div className="bg-secondary/60 rounded-lg p-2.5">
                    <div className="text-[10px] text-muted-foreground uppercase font-mono mb-1">MACD</div>
                    <div className={cn("text-sm font-bold", selectedSignal.indicators?.macdSignal === 'BULLISH' ? 'text-green-400' : 'text-red-400')}>
                      {selectedSignal.indicators?.macdSignal ?? '-'}
                    </div>
                  </div>
                  <div className="bg-secondary/60 rounded-lg p-2.5">
                    <div className="text-[10px] text-muted-foreground uppercase font-mono mb-1">EMA Trend</div>
                    <div className={cn("text-sm font-bold", selectedSignal.indicators?.emaTrend === 'ABOVE' ? 'text-green-400' : 'text-red-400')}>
                      {selectedSignal.indicators?.emaTrend ?? '-'}
                    </div>
                  </div>
                  <div className="bg-secondary/60 rounded-lg p-2.5">
                    <div className="text-[10px] text-muted-foreground uppercase font-mono mb-1">Volume</div>
                    <div className={cn("text-sm font-bold", selectedSignal.indicators?.volumeProfile === 'HIGH' ? 'text-green-400' : selectedSignal.indicators?.volumeProfile === 'LOW' ? 'text-red-400' : 'text-foreground')}>
                      {selectedSignal.indicators?.volumeProfile ?? '-'}
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-secondary/60 rounded-lg p-2.5">
                    <div className="text-[10px] text-muted-foreground uppercase font-mono mb-1">RSI Divergence</div>
                    <div className={cn("text-sm font-bold", selectedSignal.indicators?.rsiDivergence === 'BULLISH' ? 'text-green-400' : selectedSignal.indicators?.rsiDivergence === 'BEARISH' ? 'text-red-400' : 'text-muted-foreground')}>
                      {selectedSignal.indicators?.rsiDivergence || 'NONE'}
                    </div>
                  </div>
                  <div className="bg-secondary/60 rounded-lg p-2.5">
                    <div className="text-[10px] text-muted-foreground uppercase font-mono mb-1">Market Structure</div>
                    <div className={cn("text-sm font-bold", selectedSignal.indicators?.marketStructure === 'BULLISH' ? 'text-green-400' : selectedSignal.indicators?.marketStructure === 'BEARISH' ? 'text-red-400' : 'text-muted-foreground')}>
                      {selectedSignal.indicators?.marketStructure || 'RANGING'}
                    </div>
                  </div>
                </div>

                <div className="bg-secondary/60 rounded-lg p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] text-muted-foreground uppercase font-mono">Trend Strength</span>
                    <span className="text-sm font-bold font-mono">{selectedSignal.indicators?.trendStrength ?? 0}%</span>
                  </div>
                  <div className="w-full h-2 bg-muted rounded-full overflow-hidden mt-1.5">
                    <div className={cn("h-full rounded-full", getConfidenceBg(selectedSignal.indicators?.trendStrength || 0))} style={{ width: `${selectedSignal.indicators?.trendStrength || 0}%` }} />
                  </div>
                </div>

                <div className="text-[10px] text-muted-foreground bg-secondary/40 rounded-lg p-2.5 border border-border/50">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Shield className="w-3 h-3 text-primary" />
                    <span className="uppercase font-mono font-bold text-primary">Risk/Reward</span>
                  </div>
                  <div className="font-mono">
                    R:R = 1 : {((Math.abs(selectedSignal.tp - selectedSignal.entry)) / (Math.abs(selectedSignal.entry - selectedSignal.sl) || 1)).toFixed(2)}
                  </div>
                </div>
              </div>

              <DialogFooter className="gap-2 sm:gap-0">
                <Button
                  variant="outline"
                  className="gap-1"
                  onClick={async () => {
                    try {
                      await apiRequest('POST', '/api/notifications/test', {});
                      toast({ title: "Test notification sent", description: "Check your Telegram / Discord channel.", duration: 3000 });
                    } catch {
                      toast({ title: "Notification failed", description: "Configure Telegram or Discord in Settings first.", variant: "destructive", duration: 3000 });
                    }
                  }}
                  data-testid="button-dialog-send"
                >
                  <Send className="w-3.5 h-3.5" /> Test Notify
                </Button>
                <Button
                  className="gap-1"
                  onClick={() => { handleExecuteTrade(selectedSignal); setSelectedSignal(null); }}
                  data-testid="button-dialog-execute"
                >
                  <Target className="w-3.5 h-3.5" /> Execute Trade
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
