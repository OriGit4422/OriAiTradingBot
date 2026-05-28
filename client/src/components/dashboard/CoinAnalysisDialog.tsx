import { useState, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Loader2, BrainCircuit, TrendingUp, TrendingDown, Target, Shield, AlertTriangle, Activity, Newspaper, MessageCircle, Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { fetchKlines } from '@/lib/binance';
import { getQuantumSignal } from '@/lib/strategies';
import { toast } from '@/hooks/use-toast';

interface CoinAnalysisDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  defaultCoin?: string;
  defaultTimeframe?: string;
}

const COINS = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX', 'DOT', 'LINK', 'MATIC', 'AVAX', 'NEAR', 'APT', 'ARB', 'OP', 'SUI', 'TIA', 'INJ'];
const TIMEFRAMES = ['15m', '1h', '4h', '1d', '1w'];

export function CoinAnalysisDialog({ open, onOpenChange, defaultCoin = 'BTC', defaultTimeframe = '1d' }: CoinAnalysisDialogProps) {
  const [coin, setCoin] = useState(defaultCoin);
  const [timeframe, setTimeframe] = useState(defaultTimeframe);
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<any | null>(null);

  // Resync local selectors with new defaults each time the dialog is opened.
  useEffect(() => {
    if (open) {
      setCoin(defaultCoin);
      setTimeframe(defaultTimeframe);
    }
  }, [open, defaultCoin, defaultTimeframe]);

  // Clear stale result when the user changes coin or timeframe.
  useEffect(() => {
    setResult(null);
  }, [coin, timeframe]);

  const runAnalysis = async () => {
    setLoading(true);
    setResult(null);
    try {
      const klines = await fetchKlines(coin, timeframe, 250);
      if (klines.length < 50) {
        toast({ title: 'Not enough data', description: 'Try a lower timeframe.', variant: 'destructive' });
        setLoading(false);
        return;
      }
      const marketPrice = klines[klines.length - 1].close;
      const signal = getQuantumSignal(coin, marketPrice, klines);

      const resp = await apiRequest('POST', '/api/ai/coin-analysis', {
        coin,
        timeframe,
        marketPrice,
        indicators: signal.indicators,
      });
      const data = await resp.json();
      setResult(data);
    } catch (e: any) {
      toast({ title: 'Analysis failed', description: e.message || 'AI service unavailable', variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  const executeTrade = async () => {
    if (!result) return;
    // Always execute against the asset the analysis was run for (not current selector state).
    const tradedCoin = result.coin || coin;
    try {
      await apiRequest('POST', '/api/positions', {
        symbol: `${tradedCoin}USDT`,
        amount: 1,
        entryPrice: result.entry,
        type: result.direction,
        leverage: 10,
        status: 'open',
      });
      queryClient.invalidateQueries({ queryKey: ['/api/positions'] });
      toast({ title: 'Position Opened', description: `${result.direction} ${tradedCoin}/USDT at $${Number(result.entry).toLocaleString(undefined, { maximumFractionDigits: 4 })}` });
      onOpenChange(false);
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const dirColor = result?.direction === 'LONG' ? 'text-green-500' : result?.direction === 'SHORT' ? 'text-red-500' : 'text-yellow-500';
  const dirBg = result?.direction === 'LONG' ? 'bg-green-500/10 border-green-500/30' : result?.direction === 'SHORT' ? 'bg-red-500/10 border-red-500/30' : 'bg-yellow-500/10 border-yellow-500/30';

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col bg-white" data-testid="dialog-coin-analysis">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <BrainCircuit className="w-5 h-5 text-primary" />
            <span className="font-display">Deep AI Coin Analysis</span>
          </DialogTitle>
          <DialogDescription>
            World-class SMC + ICT + Quantum-Liquidity + News + X-sentiment analysis with entry, SL and 3-tier TP.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-end gap-2 pb-2">
          <div className="flex-1">
            <label className="text-[10px] uppercase font-mono text-muted-foreground mb-1 block">Coin</label>
            <Select value={coin} onValueChange={setCoin}>
              <SelectTrigger className="h-9" data-testid="select-analysis-coin"><SelectValue /></SelectTrigger>
              <SelectContent>
                {COINS.map(c => <SelectItem key={c} value={c}>{c}/USDT</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="w-28">
            <label className="text-[10px] uppercase font-mono text-muted-foreground mb-1 block">Timeframe</label>
            <Select value={timeframe} onValueChange={setTimeframe}>
              <SelectTrigger className="h-9" data-testid="select-analysis-timeframe"><SelectValue /></SelectTrigger>
              <SelectContent>
                {TIMEFRAMES.map(tf => <SelectItem key={tf} value={tf}>{tf}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Button onClick={runAnalysis} disabled={loading} className="gap-1 h-9" data-testid="button-run-analysis">
            {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
            {loading ? 'Analyzing...' : 'Analyze'}
          </Button>
        </div>

        <ScrollArea className="flex-1 -mx-6 px-6">
          {!result && !loading && (
            <div className="flex flex-col items-center justify-center py-12 text-center text-muted-foreground gap-2">
              <BrainCircuit className="w-10 h-10 text-primary/40" />
              <div className="text-sm">Pick a coin + timeframe and hit Analyze to get an institutional-grade trade plan.</div>
            </div>
          )}

          {loading && (
            <div className="flex flex-col items-center justify-center py-12 gap-3">
              <Loader2 className="w-8 h-8 animate-spin text-primary" />
              <div className="text-xs text-muted-foreground">Fetching klines, computing SMC/ICT/Quantum, gathering news + sentiment...</div>
            </div>
          )}

          {result && (
            <div className="space-y-3 py-2">
              <div className={cn("rounded-lg border-2 p-3 flex items-center justify-between", dirBg)}>
                <div className="flex items-center gap-2">
                  <Badge variant={result.direction === 'LONG' ? 'default' : result.direction === 'SHORT' ? 'destructive' : 'secondary'} className="text-sm h-7 px-2 font-black">
                    {result.direction === 'LONG' ? <TrendingUp className="w-3.5 h-3.5 mr-1" /> : result.direction === 'SHORT' ? <TrendingDown className="w-3.5 h-3.5 mr-1" /> : <Activity className="w-3.5 h-3.5 mr-1" />}
                    {result.direction}
                  </Badge>
                  <span className="font-bold text-lg">{coin}/USDT</span>
                  <Badge variant="outline" className="font-mono">{result.timeframe}</Badge>
                </div>
                <div className="text-right">
                  <div className="text-[10px] uppercase font-mono text-muted-foreground">AI Confidence</div>
                  <div className={cn("text-2xl font-black font-mono", dirColor)} data-testid="text-analysis-confidence">{result.confidence}%</div>
                </div>
              </div>

              <div className="grid grid-cols-5 gap-2">
                <div className="bg-secondary/60 rounded-lg p-2 text-center">
                  <div className="text-[9px] text-muted-foreground uppercase font-mono">Entry</div>
                  <div className="text-xs font-bold font-mono" data-testid="text-analysis-entry">${Number(result.entry).toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
                </div>
                <div className="bg-red-500/10 rounded-lg p-2 text-center border border-red-500/20">
                  <div className="text-[9px] text-red-500 uppercase font-mono">SL</div>
                  <div className="text-xs font-bold text-red-400 font-mono" data-testid="text-analysis-sl">${Number(result.stopLoss).toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
                </div>
                <div className="bg-green-500/10 rounded-lg p-2 text-center border border-green-500/20">
                  <div className="text-[9px] text-green-500 uppercase font-mono">TP1</div>
                  <div className="text-xs font-bold text-green-400 font-mono" data-testid="text-analysis-tp1">${Number(result.takeProfit1).toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
                </div>
                <div className="bg-green-500/10 rounded-lg p-2 text-center border border-green-500/20">
                  <div className="text-[9px] text-green-500 uppercase font-mono">TP2</div>
                  <div className="text-xs font-bold text-green-400 font-mono" data-testid="text-analysis-tp2">${Number(result.takeProfit2).toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
                </div>
                <div className="bg-green-500/10 rounded-lg p-2 text-center border border-green-500/20">
                  <div className="text-[9px] text-green-500 uppercase font-mono">TP3</div>
                  <div className="text-xs font-bold text-green-400 font-mono" data-testid="text-analysis-tp3">${Number(result.takeProfit3).toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
                </div>
              </div>

              <div className="bg-primary/5 border border-primary/20 rounded-lg p-2.5 text-xs flex items-center gap-2">
                <Shield className="w-3.5 h-3.5 text-primary" />
                <span className="font-mono">Risk/Reward: <b>{result.riskReward}</b></span>
                <span className="text-muted-foreground ml-auto">{new Date(result.timestamp).toLocaleTimeString()}</span>
              </div>

              <Section icon={<Target className="w-3.5 h-3.5 text-primary" />} title="SMC Analysis" body={result.smcAnalysis} testid="text-smc-analysis" />
              <Section icon={<Activity className="w-3.5 h-3.5 text-primary" />} title="ICT Analysis" body={result.ictAnalysis} testid="text-ict-analysis" />
              <Section icon={<Sparkles className="w-3.5 h-3.5 text-purple-500" />} title="Quantum Liquidity" body={result.quantumLiquidityAnalysis} testid="text-quantum-analysis" />
              <Section icon={<Newspaper className="w-3.5 h-3.5 text-amber-500" />} title="News Impact" body={result.newsImpact} testid="text-news-impact" />
              <Section icon={<MessageCircle className="w-3.5 h-3.5 text-blue-500" />} title="X / Social Sentiment" body={result.socialSentiment} testid="text-social-sentiment" />

              {(result.keyLevels?.support?.length > 0 || result.keyLevels?.resistance?.length > 0) && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="bg-green-500/5 border border-green-500/20 rounded-lg p-2.5">
                    <div className="text-[10px] uppercase font-mono text-green-500 mb-1">Support</div>
                    <div className="space-y-0.5">
                      {result.keyLevels.support.map((s: number, i: number) => (
                        <div key={i} className="text-xs font-mono font-bold">${Number(s).toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
                      ))}
                    </div>
                  </div>
                  <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-2.5">
                    <div className="text-[10px] uppercase font-mono text-red-500 mb-1">Resistance</div>
                    <div className="space-y-0.5">
                      {result.keyLevels.resistance.map((s: number, i: number) => (
                        <div key={i} className="text-xs font-mono font-bold">${Number(s).toLocaleString(undefined, { maximumFractionDigits: 4 })}</div>
                      ))}
                    </div>
                  </div>
                </div>
              )}

              <div className="bg-secondary/40 border border-border rounded-lg p-2.5">
                <div className="text-[10px] uppercase font-mono text-muted-foreground mb-1">Invalidation</div>
                <div className="text-xs">{result.invalidation}</div>
              </div>

              <div className="bg-primary/5 border-2 border-primary/30 rounded-lg p-3">
                <div className="text-[10px] uppercase font-mono text-primary font-bold mb-1">AI Summary</div>
                <div className="text-sm font-medium" data-testid="text-analysis-summary">{result.summary}</div>
              </div>

              {result.warnings?.length > 0 && (
                <div className="bg-amber-500/5 border border-amber-500/30 rounded-lg p-2.5">
                  <div className="text-[10px] uppercase font-mono text-amber-500 mb-1 flex items-center gap-1">
                    <AlertTriangle className="w-3 h-3" /> Warnings
                  </div>
                  <ul className="text-xs space-y-0.5">
                    {result.warnings.map((w: string, i: number) => (
                      <li key={i} className="flex gap-1.5"><span className="text-amber-500">•</span><span>{w}</span></li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </ScrollArea>

        {result && (
          <DialogFooter className="gap-2 pt-2 border-t">
            <Button variant="outline" onClick={() => setResult(null)} data-testid="button-clear-analysis">Clear</Button>
            <Button onClick={executeTrade} disabled={result.direction === 'NEUTRAL'} className="gap-1" data-testid="button-execute-analysis">
              <Target className="w-3.5 h-3.5" /> Execute {result.direction}
            </Button>
          </DialogFooter>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Section({ icon, title, body, testid }: { icon: React.ReactNode; title: string; body: string; testid?: string }) {
  return (
    <div className="bg-secondary/40 border border-border/50 rounded-lg p-2.5">
      <div className="flex items-center gap-1.5 text-[10px] uppercase font-mono text-muted-foreground mb-1">
        {icon}
        <span className="font-bold">{title}</span>
      </div>
      <div className="text-xs leading-relaxed" data-testid={testid}>{body}</div>
    </div>
  );
}
