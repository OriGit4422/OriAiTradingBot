import { useEffect, useState, useCallback } from 'react';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { getQuantumSignal, calculateMultiTFConfluence } from '@/lib/strategies';
import { fetchKlines } from '@/lib/binance';
import { cn } from '@/lib/utils';
import { Clock, Loader2, BrainCircuit, Zap, Flame, Send, TrendingUp, TrendingDown, BarChart3, RefreshCw, ChevronDown, ChevronRight, Activity } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';
import { apiRequest, queryClient } from '@/lib/queryClient';
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger
} from '@/components/ui/tabs';

const SIGNAL_COINS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX'];
const TIMEFRAMES = ['5m', '15m', '1h', '4h'];

interface SignalFeedProps {
  compact?: boolean;
  onSelectCoin?: (coin: string) => void;
}

export function SignalFeed({ compact = false, onSelectCoin }: SignalFeedProps) {
  const [allSignals, setAllSignals] = useState<any[]>([]);
  const [confluenceData, setConfluenceData] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedTF, setSelectedTF] = useState('ALL');
  const [expandedCoin, setExpandedCoin] = useState<string | null>(null);

  const generateAllSignals = useCallback(async () => {
    setIsLoading(true);

    const tasks = SIGNAL_COINS.flatMap(coin =>
      TIMEFRAMES.map(tf => ({ coin, tf }))
    );

    const results = await Promise.allSettled(
      tasks.map(async ({ coin, tf }) => {
        const data = await fetchKlines(coin, tf, 200);
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

    setAllSignals(newSignals);
    const confluence = calculateMultiTFConfluence(newSignals);
    setConfluenceData(confluence);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    generateAllSignals();
    const interval = setInterval(generateAllSignals, 90000);
    return () => clearInterval(interval);
  }, [generateAllSignals]);

  const filteredSignals = selectedTF === 'ALL'
    ? allSignals.sort((a, b) => b.confidence - a.confidence)
    : allSignals.filter(s => s.timeframe === selectedTF).sort((a, b) => b.confidence - a.confidence);

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
      <div className="p-3 border-b border-border flex justify-between items-center bg-muted/10">
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
        <TabsList className="grid grid-cols-5 mx-2 mt-2 mb-1 h-7 bg-muted/30">
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
                  className="flex items-center justify-between text-[10px] px-1 py-0.5 rounded hover:bg-muted/20 cursor-pointer"
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
              filteredSignals.map((signal) => (
                <div
                  key={`${signal.coin}-${signal.timeframe}-${signal.id}`}
                  className="px-3 py-2.5 hover:bg-primary/5 transition-all cursor-pointer group relative overflow-hidden"
                  onClick={() => {
                    onSelectCoin?.(signal.coin);
                    setExpandedCoin(expandedCoin === `${signal.coin}-${signal.timeframe}` ? null : `${signal.coin}-${signal.timeframe}`);
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
                    <Badge variant="outline" className="text-[8px] h-4 px-1 border-primary/30 bg-primary/5 text-primary font-bold">
                      {signal.strategy}
                    </Badge>
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

                  <div className="grid grid-cols-3 gap-1 text-[10px] font-mono bg-muted/20 p-1.5 rounded">
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

                  {expandedCoin === `${signal.coin}-${signal.timeframe}` && (
                    <div className="mt-2 space-y-1.5">
                      <div className="grid grid-cols-2 gap-1 text-[9px]">
                        <div className="bg-muted/20 rounded p-1.5">
                          <span className="text-muted-foreground">RSI</span>
                          <span className={cn("ml-1 font-bold font-mono", signal.indicators?.rsi > 70 ? 'text-red-400' : signal.indicators?.rsi < 30 ? 'text-green-400' : 'text-foreground')}>
                            {signal.indicators?.rsi}
                          </span>
                        </div>
                        <div className="bg-muted/20 rounded p-1.5">
                          <span className="text-muted-foreground">MACD</span>
                          <span className={cn("ml-1 font-bold", signal.indicators?.macdSignal === 'BULLISH' ? 'text-green-400' : 'text-red-400')}>
                            {signal.indicators?.macdSignal}
                          </span>
                        </div>
                        <div className="bg-muted/20 rounded p-1.5">
                          <span className="text-muted-foreground">EMA</span>
                          <span className={cn("ml-1 font-bold", signal.indicators?.emaTrend === 'ABOVE' ? 'text-green-400' : 'text-red-400')}>
                            {signal.indicators?.emaTrend}
                          </span>
                        </div>
                        <div className="bg-muted/20 rounded p-1.5">
                          <span className="text-muted-foreground">Vol</span>
                          <span className={cn("ml-1 font-bold", signal.indicators?.volumeProfile === 'HIGH' ? 'text-green-400' : signal.indicators?.volumeProfile === 'LOW' ? 'text-red-400' : 'text-foreground')}>
                            {signal.indicators?.volumeProfile}
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <div className="flex-1 text-[9px] text-muted-foreground">
                          Trend: <span className="font-bold text-foreground">{signal.indicators?.trendStrength}%</span>
                        </div>
                        <div className="w-16 h-1 bg-muted rounded-full overflow-hidden">
                          <div className={cn("h-full rounded-full", getConfidenceBg(signal.indicators?.trendStrength || 0))} style={{ width: `${signal.indicators?.trendStrength || 0}%` }} />
                        </div>
                      </div>
                      <div className="flex gap-1">
                        <Button
                          size="sm"
                          className="h-6 text-[10px] flex-1 gap-1"
                          onClick={(e) => { e.stopPropagation(); handleExecuteTrade(signal); }}
                          data-testid={`button-trade-${signal.coin}-${signal.timeframe}`}
                        >
                          Execute
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 text-[10px] px-2"
                          onClick={(e) => {
                            e.stopPropagation();
                            toast({ title: "Sent to Telegram", description: `${signal.coin} signal forwarded.`, duration: 2000 });
                          }}
                        >
                          <Send className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  )}

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
    </div>
  );
}
