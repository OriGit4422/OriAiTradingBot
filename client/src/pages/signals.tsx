import { useState, useEffect, useCallback } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Sidebar } from '@/components/layout/Sidebar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Search, Filter, ArrowRight, Clock, Zap, Flame, Send, Loader2, RefreshCw, TrendingUp, TrendingDown, Activity, BarChart3, Brain, Gauge, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import { fetchKlines } from '@/lib/binance';
import { getQuantumSignal, calculateMultiTFConfluence } from '@/lib/strategies';
import { enhanceSignalsWithAI } from '@/lib/signal-ai';
import { toast } from '@/hooks/use-toast';
import type { Signal } from '@shared/schema';
import { ScrollArea } from '@/components/ui/scroll-area';

export default function Signals() {
  const [liveSignals, setLiveSignals] = useState<any[]>([]);
  const [confluenceData, setConfluenceData] = useState<any[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(true);
  const [filter, setFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  const { data: dbSignals = [], isLoading: isLoadingDb } = useQuery<Signal[]>({
    queryKey: ['/api/signals'],
  });

  const bulkSaveMutation = useMutation({
    mutationFn: async (signals: any[]) => {
      const payload = signals.map(s => ({
        coin: s.coin,
        strategy: s.strategy,
        type: s.type,
        entry: s.entry,
        tp: s.tp,
        sl: s.sl,
        marketPrice: s.marketPrice,
        timeframe: s.timeframe,
        confidence: s.confidence,
        status: s.status || 'ACTIVE',
      }));
      const res = await apiRequest('POST', '/api/signals/bulk', payload);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/signals'] });
    },
  });

  const generateSignals = useCallback(async () => {
    setIsAnalyzing(true);
    const coins = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'DOT', 'LINK'];
    const timeframes = ['5m', '15m', '1h', '4h'];

    const tasks = coins.flatMap(coin =>
      timeframes.map(tf => ({ coin, tf }))
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
      .map(r => r.value)
      .filter(s => {
        const ALWAYS_INCLUDE = ['BTC', 'ETH', 'SOL'];
        return s.confidence > 75 || ALWAYS_INCLUDE.includes(s.coin);
      });

    const aiConfirmed = await enhanceSignalsWithAI(newSignals, 14);
    const sorted = aiConfirmed.sort((a, b) => b.confidence - a.confidence);
    setLiveSignals(sorted);

    const confluence = calculateMultiTFConfluence(sorted);
    setConfluenceData(confluence);
    setIsAnalyzing(false);

    if (sorted.length > 0) {
      bulkSaveMutation.mutate(sorted);
    }
  }, []);

  useEffect(() => {
    generateSignals();
  }, [generateSignals]);

  const mergedSignals = (() => {
    const liveKeys = new Set(liveSignals.map(s => `${s.coin}-${s.timeframe}`));
    const dbOnly = dbSignals.filter(s => !liveKeys.has(`${s.coin}-${s.timeframe}`));
    const merged = [
      ...liveSignals.map(s => ({ ...s, source: 'live' as const })),
      ...dbOnly.map(s => ({ ...s, source: 'db' as const })),
    ];
    return merged.sort((a, b) => b.confidence - a.confidence);
  })();

  const filteredSignals = mergedSignals.filter(signal => {
    if (searchQuery && !signal.coin.toLowerCase().includes(searchQuery.toLowerCase()) && !signal.strategy?.toLowerCase().includes(searchQuery.toLowerCase())) return false;
    if (filter === 'ALL') return true;
    if (filter === 'SCALP') return ['1m', '5m', '15m'].includes(signal.timeframe);
    if (filter === 'SWING') return ['1h', '4h', '1d'].includes(signal.timeframe);
    if (filter === 'HIGH CONF') return signal.confidence >= 85;
    if (filter === 'LONG') return signal.type === 'LONG';
    if (filter === 'SHORT') return signal.type === 'SHORT';
    return true;
  });

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

  const handleSendToTelegram = (signal: any) => {
    toast({
      title: "Sent to Telegram",
      description: `Signal for ${signal.coin} forwarded to channel.`,
      duration: 2000,
    });
  };

  const getConfidenceColor = (conf: number) => {
    if (conf >= 90) return "text-orange-500";
    if (conf >= 80) return "text-green-500";
    if (conf >= 70) return "text-primary";
    return "text-muted-foreground";
  };

  const formatTimestamp = (signal: any) => {
    if (signal.source === 'db' && signal.createdAt) {
      const date = new Date(signal.createdAt);
      const now = new Date();
      const diffMs = now.getTime() - date.getTime();
      const diffMin = Math.floor(diffMs / 60000);
      if (diffMin < 1) return 'Just now';
      if (diffMin < 60) return `${diffMin}m ago`;
      const diffHr = Math.floor(diffMin / 60);
      if (diffHr < 24) return `${diffHr}h ago`;
      return date.toLocaleDateString();
    }
    return 'Just now';
  };

  const isLoading = isAnalyzing && isLoadingDb;

  return (
    <div className="min-h-screen bg-background text-foreground font-sans flex">
      <Sidebar />
      <div className="flex-1 md:pl-64">
        <div className="p-4 md:p-8 pt-16 md:pt-8 space-y-4 md:space-y-6">
          <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-3">
            <div>
              <h1 className="text-2xl md:text-3xl font-display font-bold text-primary mb-1" data-testid="text-page-title">Signal Feed</h1>
              <p className="text-sm text-muted-foreground">AI-generated trading opportunities with multi-timeframe confluence analysis.</p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => generateSignals()}
                disabled={isAnalyzing}
                data-testid="button-refresh"
              >
                <RefreshCw className={cn("w-4 h-4 mr-2", isAnalyzing && "animate-spin")} />
                Refresh
              </Button>
              <Button size="sm" data-testid="button-configure-alerts">
                <Filter className="w-4 h-4 mr-2" />
                Alerts
              </Button>
            </div>
          </div>

          {confluenceData.length > 0 && (
            <div className="bg-gradient-to-r from-primary/5 via-purple-500/5 to-cyan-500/5 rounded-lg border border-primary/20 p-4" data-testid="card-confluence-overview">
              <div className="flex items-center gap-2 mb-3">
                <Brain className="w-4 h-4 text-primary" />
                <span className="text-xs font-bold text-primary uppercase font-mono">Multi-Timeframe Confluence</span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
                {confluenceData.slice(0, 6).map(c => (
                  <div key={c.coin} className="bg-card/50 rounded-lg border border-border/50 p-3 text-center" data-testid={`confluence-card-${c.coin}`}>
                    <div className="font-bold text-lg mb-1">{c.coin}</div>
                    <Badge variant={c.overallDirection === 'LONG' ? 'default' : c.overallDirection === 'SHORT' ? 'destructive' : 'outline'} className="text-[10px] mb-2">
                      {c.overallDirection === 'LONG' && <TrendingUp className="w-3 h-3 mr-1" />}
                      {c.overallDirection === 'SHORT' && <TrendingDown className="w-3 h-3 mr-1" />}
                      {c.overallDirection}
                    </Badge>
                    <div className="text-[10px] text-muted-foreground font-mono">
                      {c.alignedTimeframes}/{c.totalTimeframes} aligned
                    </div>
                    <div className="w-full h-1.5 bg-muted rounded-full mt-1 overflow-hidden">
                      <div
                        className={cn("h-full rounded-full", c.confluenceScore >= 80 ? 'bg-green-500' : c.confluenceScore >= 60 ? 'bg-yellow-500' : 'bg-red-500')}
                        style={{ width: `${c.confluenceScore}%` }}
                      />
                    </div>
                    <div className={cn("text-xs font-bold mt-1", c.confluenceScore >= 80 ? 'text-green-500' : c.confluenceScore >= 60 ? 'text-yellow-500' : 'text-red-500')}>
                      {c.confluenceScore}%
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="flex flex-col md:flex-row gap-3 items-start md:items-center bg-card p-3 rounded-lg border border-border">
            <div className="relative flex-1 w-full md:w-auto">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search by coin or strategy..."
                className="pl-9 bg-background border-border"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                data-testid="input-search"
              />
            </div>
            <div className="flex gap-1 flex-wrap">
              {['ALL', 'SCALP', 'SWING', 'HIGH CONF', 'LONG', 'SHORT'].map(status => (
                <Button
                  key={status}
                  variant={filter === status ? 'default' : 'outline'}
                  className="text-[10px] h-8 px-2"
                  onClick={() => setFilter(status)}
                  data-testid={`button-filter-${status.toLowerCase().replace(' ', '-')}`}
                >
                  {status}
                </Button>
              ))}
            </div>
          </div>

          {isLoading ? (
            <div className="flex justify-center py-20" data-testid="status-loading">
              <div className="flex flex-col items-center gap-2">
                <Loader2 className="w-8 h-8 animate-spin text-primary" />
                <span className="text-sm text-muted-foreground">Scanning markets with AI across multiple timeframes...</span>
              </div>
            </div>
          ) : (
            <div className="space-y-3" data-testid="signal-list">
              {filteredSignals.length === 0 ? (
                <div className="flex justify-center py-20 text-muted-foreground" data-testid="status-empty">
                  No signals match the current filter.
                </div>
              ) : (
                filteredSignals.map((signal, index) => (
                  <div
                    key={signal.id || `signal-${index}`}
                    className="bg-card border border-border rounded-lg p-4 md:p-5 hover:border-primary/50 transition-all group relative overflow-hidden"
                    data-testid={`card-signal-${signal.coin}-${signal.timeframe}`}
                  >
                    <div className={cn(
                      "absolute left-0 top-0 w-1 h-full",
                      signal.type === 'LONG' ? "bg-green-500" : "bg-red-500"
                    )} />

                    <div className="flex items-start justify-between">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-muted/30 rounded-lg flex items-center justify-center font-bold text-lg">
                          {signal.coin.substring(0, 1)}
                        </div>
                        <div>
                          <div className="flex items-center gap-2 flex-wrap">
                            <h3 className="font-display font-bold text-lg" data-testid={`text-coin-${signal.coin}`}>{signal.coin}/USDT</h3>
                            <Badge variant={signal.type === 'LONG' ? 'default' : 'destructive'} className="text-[10px] font-bold" data-testid={`badge-type-${signal.coin}`}>
                              {signal.type === 'LONG' ? <TrendingUp className="w-3 h-3 mr-1" /> : <TrendingDown className="w-3 h-3 mr-1" />}
                              {signal.type}
                            </Badge>
                            <Badge variant="outline" className="text-[10px] font-mono uppercase bg-background" data-testid={`badge-timeframe-${signal.coin}`}>
                              {signal.timeframe}
                            </Badge>
                            {signal.confidence >= 90 && (
                              <Badge className="bg-orange-500/10 text-orange-500 border-orange-500/20 gap-1">
                                <Flame className="w-3 h-3" /> ULTRA
                              </Badge>
                            )}
                          </div>
                          <div className="text-xs text-muted-foreground flex items-center gap-2 mt-1 flex-wrap">
                            <span className="text-primary font-medium">{signal.strategy} Strategy</span>
                            {signal.aiConfirmation?.verdict && (
                              <>
                                <span>|</span>
                                <span
                                  className={cn(
                                    "font-semibold",
                                    signal.aiConfirmation.verdict.includes('BUY')
                                      ? 'text-green-500'
                                      : signal.aiConfirmation.verdict.includes('SELL')
                                        ? 'text-red-500'
                                        : 'text-yellow-500'
                                  )}
                                >
                                  AI {signal.aiConfirmation.verdict}
                                </span>
                              </>
                            )}
                            <span>|</span>
                            <span className="flex items-center gap-1" data-testid={`text-timestamp-${signal.coin}`}>
                              <Clock className="w-3 h-3" /> {formatTimestamp(signal)}
                            </span>
                          </div>
                        </div>
                      </div>

                      <div className="text-right">
                        <div className="text-xs text-muted-foreground mb-1">AI Confidence</div>
                        <div className={cn("text-xl font-black font-mono", getConfidenceColor(signal.confidence))} data-testid={`text-confidence-${signal.coin}`}>
                          {signal.confidence}%
                        </div>
                      </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mt-4 bg-muted/20 p-3 rounded-lg font-mono">
                      <div>
                        <div className="text-[10px] text-muted-foreground mb-1 uppercase">Entry Zone</div>
                        <div className="font-bold text-sm">{signal.entry.toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground mb-1 uppercase">Take Profit</div>
                        <div className="font-bold text-green-500 text-sm">{signal.tp.toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground mb-1 uppercase">Stop Loss</div>
                        <div className="font-bold text-red-500 text-sm">{signal.sl.toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
                      </div>
                      <div>
                        <div className="text-[10px] text-muted-foreground mb-1 uppercase">Risk/Reward</div>
                        <div className="font-bold text-sm">1:{(Math.abs(signal.tp - signal.entry) / Math.max(0.0001, Math.abs(signal.entry - signal.sl))).toFixed(1)}</div>
                      </div>
                    </div>

                    {signal.indicators && (
                      <div className="grid grid-cols-3 md:grid-cols-6 gap-2 mt-3">
                        <div className="bg-muted/20 rounded p-2 text-center">
                          <div className="text-[9px] text-muted-foreground uppercase">RSI</div>
                          <div className={cn("text-sm font-bold font-mono", signal.indicators.rsi > 70 ? 'text-red-400' : signal.indicators.rsi < 30 ? 'text-green-400' : 'text-foreground')}>
                            {signal.indicators.rsi}
                          </div>
                        </div>
                        <div className="bg-muted/20 rounded p-2 text-center">
                          <div className="text-[9px] text-muted-foreground uppercase">MACD</div>
                          <div className={cn("text-sm font-bold", signal.indicators.macdSignal === 'BULLISH' ? 'text-green-400' : 'text-red-400')}>
                            {signal.indicators.macdSignal}
                          </div>
                        </div>
                        <div className="bg-muted/20 rounded p-2 text-center">
                          <div className="text-[9px] text-muted-foreground uppercase">EMA</div>
                          <div className={cn("text-sm font-bold", signal.indicators.emaTrend === 'ABOVE' ? 'text-green-400' : 'text-red-400')}>
                            {signal.indicators.emaTrend}
                          </div>
                        </div>
                        <div className="bg-muted/20 rounded p-2 text-center">
                          <div className="text-[9px] text-muted-foreground uppercase">Volume</div>
                          <div className={cn("text-sm font-bold", signal.indicators.volumeProfile === 'HIGH' ? 'text-green-400' : signal.indicators.volumeProfile === 'LOW' ? 'text-red-400' : 'text-foreground')}>
                            {signal.indicators.volumeProfile}
                          </div>
                        </div>
                        <div className="bg-muted/20 rounded p-2 text-center">
                          <div className="text-[9px] text-muted-foreground uppercase">AI Risk</div>
                          <div className={cn("text-sm font-bold", signal.aiConfirmation?.riskLevel === 'LOW' ? 'text-green-400' : signal.aiConfirmation?.riskLevel === 'HIGH' ? 'text-red-400' : 'text-yellow-400')}>
                            {signal.aiConfirmation?.riskLevel || 'N/A'}
                          </div>
                        </div>
                        <div className="bg-muted/20 rounded p-2 text-center">
                          <div className="text-[9px] text-muted-foreground uppercase">Structure</div>
                          <div className={cn("text-sm font-bold", signal.indicators.marketStructure === 'BULLISH' ? 'text-green-400' : signal.indicators.marketStructure === 'BEARISH' ? 'text-red-400' : 'text-muted-foreground')}>
                            {signal.indicators.marketStructure === 'BULLISH' ? 'HH/HL' : signal.indicators.marketStructure === 'BEARISH' ? 'LH/LL' : 'RANGE'}
                          </div>
                        </div>
                        <div className="bg-muted/20 rounded p-2 text-center">
                          <div className="text-[9px] text-muted-foreground uppercase">Trend</div>
                          <div className="text-sm font-bold font-mono">{signal.indicators.trendStrength}%</div>
                        </div>
                      </div>
                    )}

                    {signal.indicators?.rsiDivergence && signal.indicators.rsiDivergence !== 'NONE' && (
                      <div className={cn("mt-2 px-3 py-1.5 rounded text-[10px] font-bold flex items-center gap-1",
                        signal.indicators.rsiDivergence === 'BULLISH' ? 'bg-green-500/10 text-green-500 border border-green-500/20' : 'bg-red-500/10 text-red-500 border border-red-500/20'
                      )}>
                        <Activity className="w-3 h-3" />
                        RSI Divergence Detected: {signal.indicators.rsiDivergence}
                      </div>
                    )}

                    <div className="mt-3 flex flex-col md:flex-row justify-between items-start md:items-center gap-2">
                      <div className="flex items-center gap-2 text-xs text-muted-foreground">
                        <div className="h-1.5 w-32 bg-muted rounded-full overflow-hidden">
                          <div className={cn("h-full rounded-full", getConfidenceColor(signal.confidence).replace('text-', 'bg-'))} style={{ width: `${signal.confidence}%` }} />
                        </div>
                        <span className="text-[10px]">
                          {signal.confidence >= 90 ? "Ultra High Probability" : signal.confidence >= 85 ? "High Probability Setup" : signal.confidence >= 75 ? "Standard Setup" : "Low Confidence"}
                        </span>
                        {signal.indicators?.confluenceScore > 0 && (
                          <Badge variant="outline" className="text-[9px] h-4 px-1 text-primary border-primary/30">
                            +{signal.indicators.confluenceScore} confluence
                          </Badge>
                        )}
                      </div>
                      <div className="flex gap-2">
                        <Button size="sm" variant="outline" onClick={() => handleSendToTelegram(signal)} data-testid={`button-telegram-${signal.coin}`}>
                          <Send className="w-3 h-3 mr-1" /> Telegram
                        </Button>
                        <Button size="sm" className="gap-1" onClick={() => handleExecuteTrade(signal)} data-testid={`button-execute-${signal.coin}`}>
                          Execute <ArrowRight className="w-3 h-3" />
                        </Button>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
