import { useState, useEffect, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Sidebar } from '@/components/layout/Sidebar';
import { TradingChart } from '@/components/dashboard/TradingChart';
import { SignalFeed } from '@/components/dashboard/SignalFeed';
import { MarketOverview } from '@/components/dashboard/MarketOverview';
import { TradeEntry } from '@/components/dashboard/TradeEntry';
import { OrderBook } from '@/components/dashboard/OrderBook';
import { Button } from '@/components/ui/button';
import {
  Bell,
  User,
  Maximize2,
  Wifi,
  WifiOff,
  TrendingUp,
  TrendingDown,
  DollarSign,
  Activity,
  Brain,
  BarChart3,
  Target,
  Zap,
  Gauge,
  Shield,
  ArrowUpDown,
  PieChart as PieChartIcon,
  LineChart as LineChartIcon,
} from 'lucide-react';
import { fetch24hTicker } from '@/lib/binance';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ScrollArea } from '@/components/ui/scroll-area';
import { apiRequest } from '@/lib/queryClient';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import {
  PieChart, Pie, Cell, ResponsiveContainer, Tooltip,
  BarChart, Bar, XAxis, YAxis, CartesianGrid,
  RadialBarChart, RadialBar,
} from 'recharts';

const CHART_COLORS = ['#0ea5e9', '#8b5cf6', '#10b981', '#f59e0b', '#ef4444', '#ec4899', '#06b6d4', '#f97316'];

export default function Dashboard() {
  const [selectedCoin, setSelectedCoin] = useState('BTC');
  const [timeframe, setTimeframe] = useState('1h');
  const [currentPrice, setCurrentPrice] = useState<number>(0);
  const [change24h, setChange24h] = useState<number>(0);
  const [volume24h, setVolume24h] = useState<number>(0);
  const [high24h, setHigh24h] = useState<number>(0);
  const [low24h, setLow24h] = useState<number>(0);
  const [isConnected, setIsConnected] = useState(true);
  const [notifications, setNotifications] = useState<any[]>([]);
  const [aiInsight, setAiInsight] = useState<any>(null);
  const [aiInsightLoading, setAiInsightLoading] = useState(true);
  const [topMovers, setTopMovers] = useState<any[]>([]);
  const [fearGreed, setFearGreed] = useState(55);

  const { data: positions = [] } = useQuery<any[]>({
    queryKey: ['/api/positions'],
  });

  const { data: signals = [] } = useQuery<any[]>({
    queryKey: ['/api/signals'],
  });

  const { data: walletData } = useQuery<any>({
    queryKey: ['/api/wallet'],
  });

  const fetchInsight = async (moversData?: any[]) => {
    setAiInsightLoading(true);
    try {
      const marketDataPayload = moversData?.map(m => ({
        symbol: m.symbol,
        price: m.price,
        change: m.change,
        volume: m.volume,
      }));
      const res = await apiRequest('POST', '/api/ai/market-insight', {
        coins: ['BTC', 'ETH', 'SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'AVAX'],
        marketData: marketDataPayload,
      });
      const data = await res.json();
      setAiInsight(data);
    } catch (e) {
      setAiInsight(null);
    } finally {
      setAiInsightLoading(false);
    }
  };

  const [insightFetched, setInsightFetched] = useState(false);

  useEffect(() => {
    if (!insightFetched) {
      if (topMovers.length > 0) {
        fetchInsight(topMovers);
        setInsightFetched(true);
      } else {
        const timeout = setTimeout(() => {
          if (!insightFetched) {
            fetchInsight();
            setInsightFetched(true);
          }
        }, 5000);
        return () => clearTimeout(timeout);
      }
    }
  }, [topMovers, insightFetched]);

  useEffect(() => {
    const interval = setInterval(() => {
      fetchInsight(topMovers.length > 0 ? topMovers : undefined);
    }, 120000);
    return () => clearInterval(interval);
  }, [topMovers]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (Math.random() > 0.7) {
        const msgs = [
          { title: "BTC Liquidity Sweep", message: "Price swept key low. Watch for reversal." },
          { title: "ETH Order Block", message: "Major institutional order block detected." },
          { title: "SOL Break of Structure", message: "Bullish BOS confirmed on 1H." },
          { title: "Volatility Alert", message: "Volatility spiking. Tighten stops." },
        ];
        const pick = msgs[Math.floor(Math.random() * msgs.length)];
        setNotifications(prev => [{ id: Date.now(), ...pick, type: "urgent", time: "Just now" }, ...prev].slice(0, 5));
      }
    }, 45000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const updateHeader = async () => {
      try {
        const tickers = await fetch24hTicker();
        const t = tickers.find((t: any) => t.symbol === `${selectedCoin}USDT`);
        if (t) {
          setCurrentPrice(parseFloat(t.lastPrice));
          setChange24h(parseFloat(t.priceChangePercent));
          setVolume24h(parseFloat(t.quoteVolume));
          setHigh24h(parseFloat(t.highPrice));
          setLow24h(parseFloat(t.lowPrice));
          setIsConnected(true);
        }

        const movers = tickers
          .filter((t: any) => ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT', 'ADAUSDT', 'AVAXUSDT'].includes(t.symbol))
          .map((t: any) => ({
            symbol: t.symbol.replace('USDT', ''),
            price: parseFloat(t.lastPrice),
            change: parseFloat(t.priceChangePercent),
            volume: parseFloat(t.quoteVolume),
          }))
          .sort((a: any, b: any) => Math.abs(b.change) - Math.abs(a.change));
        setTopMovers(movers);

        const btcChange = parseFloat(tickers.find((t: any) => t.symbol === 'BTCUSDT')?.priceChangePercent || '0');
        const ethChange = parseFloat(tickers.find((t: any) => t.symbol === 'ETHUSDT')?.priceChangePercent || '0');
        setFearGreed(Math.max(10, Math.min(90, 50 + (btcChange + ethChange) / 2 * 3)));
      } catch (e) {
        setIsConnected(false);
      }
    };
    updateHeader();
    const interval = setInterval(updateHeader, 15000);
    return () => clearInterval(interval);
  }, [selectedCoin]);

  const totalPnl = positions.reduce((sum: number, p: any) => sum + (p.pnl || 0), 0);
  const openPositions = positions.filter((p: any) => p.status === 'open').length;
  const activeSignals = signals.filter((s: any) => s.status === 'ACTIVE').length;

  const formatVolume = (vol: number) => {
    if (vol >= 1e9) return `$${(vol / 1e9).toFixed(2)}B`;
    if (vol >= 1e6) return `$${(vol / 1e6).toFixed(1)}M`;
    return `$${vol.toLocaleString()}`;
  };

  const formatVolumeShort = (vol: number) => {
    if (vol >= 1e9) return `${(vol / 1e9).toFixed(1)}B`;
    if (vol >= 1e6) return `${(vol / 1e6).toFixed(0)}M`;
    return `${(vol / 1e3).toFixed(0)}K`;
  };

  const fg = useMemo(() => {
    if (fearGreed >= 75) return { label: 'Extreme Greed', color: 'text-green-500', bg: '#10b981' };
    if (fearGreed >= 55) return { label: 'Greed', color: 'text-green-400', bg: '#4ade80' };
    if (fearGreed >= 45) return { label: 'Neutral', color: 'text-yellow-500', bg: '#eab308' };
    if (fearGreed >= 25) return { label: 'Fear', color: 'text-orange-500', bg: '#f97316' };
    return { label: 'Extreme Fear', color: 'text-red-500', bg: '#ef4444' };
  }, [fearGreed]);

  const volumePieData = useMemo(() =>
    topMovers.slice(0, 6).map((m, i) => ({
      name: m.symbol,
      value: m.volume,
      fill: CHART_COLORS[i % CHART_COLORS.length],
    })), [topMovers]);

  const changeBarData = useMemo(() =>
    topMovers.slice(0, 8).map(m => ({
      name: m.symbol,
      change: parseFloat(m.change.toFixed(2)),
      fill: m.change >= 0 ? '#10b981' : '#ef4444',
    })), [topMovers]);

  const sentimentRadialData = useMemo(() => [{
    name: 'Sentiment',
    value: Math.round(fearGreed),
    fill: fg.bg,
  }], [fearGreed, fg]);

  const volumeBarData = useMemo(() =>
    topMovers.slice(0, 8).map((m, i) => ({
      name: m.symbol,
      volume: m.volume,
      fill: CHART_COLORS[i % CHART_COLORS.length],
    })), [topMovers]);

  const CustomPieTooltip = ({ active, payload }: any) => {
    if (active && payload?.length) {
      return (
        <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl">
          <p className="text-xs font-bold">{payload[0].name}</p>
          <p className="text-[10px] text-muted-foreground font-mono">{formatVolume(payload[0].value)}</p>
        </div>
      );
    }
    return null;
  };

  const CustomBarTooltip = ({ active, payload, label }: any) => {
    if (active && payload?.length) {
      return (
        <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl">
          <p className="text-xs font-bold">{label}</p>
          <p className={cn("text-xs font-mono font-bold", payload[0].value >= 0 ? 'text-green-500' : 'text-red-500')}>
            {payload[0].value >= 0 ? '+' : ''}{payload[0].value}%
          </p>
        </div>
      );
    }
    return null;
  };

  const CustomVolumeTooltip = ({ active, payload, label }: any) => {
    if (active && payload?.length) {
      return (
        <div className="bg-card border border-border rounded-lg px-3 py-2 shadow-xl">
          <p className="text-xs font-bold">{label}</p>
          <p className="text-xs font-mono text-primary">{formatVolume(payload[0].value)}</p>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans selection:bg-primary/30">
      <Sidebar />

      <main className="md:pl-64 h-screen flex flex-col">
        <header className="h-14 border-b border-border flex items-center justify-between px-3 md:px-6 bg-background/80 backdrop-blur z-20 sticky top-0">
          <div className="flex items-center gap-2 md:gap-4 overflow-x-auto">
            <div className="flex items-center gap-2 pl-10 md:pl-0">
              <span className="text-xl md:text-2xl font-display font-bold" data-testid="text-selected-coin">{selectedCoin}</span>
              <span className="text-sm font-mono text-muted-foreground">/USDT</span>
              <span className={cn("text-sm font-mono ml-2 font-bold", change24h >= 0 ? "text-green-500" : "text-red-500")} data-testid="text-price-change">
                {change24h > 0 ? '+' : ''}{change24h.toFixed(2)}%
              </span>
              <span className="text-lg font-mono ml-2 font-bold" data-testid="text-current-price">
                ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2 })}
              </span>
            </div>
            <div className="h-6 w-px bg-border mx-1" />
            <div className="flex gap-1">
              {['1m', '5m', '15m', '30m', '1h', '4h', '1d'].map(tf => (
                <button
                  key={tf}
                  onClick={() => setTimeframe(tf)}
                  className={cn(
                    "px-2 py-1 rounded text-xs font-mono transition-all",
                    timeframe === tf
                      ? 'bg-primary text-primary-foreground font-bold shadow-[0_0_12px_rgba(14,165,233,0.4)]'
                      : 'text-muted-foreground hover:bg-muted/50'
                  )}
                  data-testid={`button-timeframe-${tf}`}
                >
                  {tf}
                </button>
              ))}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 bg-muted/30 rounded-full border border-border">
              {isConnected ? <Wifi className="w-3 h-3 text-green-500" /> : <WifiOff className="w-3 h-3 text-red-500" />}
              <span className="text-xs font-medium text-muted-foreground">{isConnected ? 'Live' : 'Offline'}</span>
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button size="icon" variant="ghost" className="relative h-8 w-8" data-testid="button-notifications">
                  <Bell className="w-4 h-4" />
                  {notifications.length > 0 && <span className="absolute top-1 right-1 w-2 h-2 bg-red-500 rounded-full animate-pulse" />}
                </Button>
              </PopoverTrigger>
              <PopoverContent className="w-80 p-0 bg-card border-border" align="end">
                <div className="p-3 border-b border-border flex justify-between items-center">
                  <span className="font-semibold text-sm">Notifications</span>
                  <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => setNotifications([])}>Clear</Button>
                </div>
                <ScrollArea className="h-[300px]">
                  {notifications.length === 0 ? (
                    <div className="p-8 text-center text-muted-foreground text-xs">No new notifications</div>
                  ) : (
                    <div className="divide-y divide-border/50">
                      {notifications.map(n => (
                        <div key={n.id} className="p-3 hover:bg-muted/20 cursor-pointer">
                          <div className="flex justify-between items-start mb-1">
                            <span className="text-xs font-bold text-primary">{n.title}</span>
                            <span className="text-[10px] text-muted-foreground">{n.time}</span>
                          </div>
                          <p className="text-xs text-muted-foreground">{n.message}</p>
                        </div>
                      ))}
                    </div>
                  )}
                </ScrollArea>
              </PopoverContent>
            </Popover>
            <Button size="icon" variant="ghost" className="h-8 w-8" data-testid="button-user">
              <User className="w-4 h-4" />
            </Button>
          </div>
        </header>

        <div className="flex-1 overflow-auto p-2 md:p-3 space-y-2 md:space-y-3">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-2">
            {[
              { label: 'P&L', value: `${totalPnl >= 0 ? '+' : ''}$${totalPnl.toFixed(2)}`, color: totalPnl >= 0 ? 'green' : 'red', icon: DollarSign, id: 'stat-portfolio-pnl' },
              { label: 'Positions', value: openPositions, color: 'blue', icon: Target, id: 'stat-open-positions' },
              { label: 'Signals', value: activeSignals, color: 'orange', icon: Zap, id: 'stat-active-signals' },
              { label: 'Volume', value: formatVolume(volume24h), color: 'purple', icon: BarChart3, id: 'stat-24h-volume' },
              { label: 'Sentiment', value: `${Math.round(fearGreed)}`, extra: fg.label, color: 'cyan', icon: Gauge, id: 'stat-fear-greed', extraColor: fg.color },
              { label: 'Range', value: `$${low24h.toLocaleString(undefined, { maximumFractionDigits: 0 })} - $${high24h.toLocaleString(undefined, { maximumFractionDigits: 0 })}`, color: 'yellow', icon: ArrowUpDown, id: 'stat-24h-range' },
            ].map(stat => {
              const colorMap: Record<string, string> = { green: 'from-green-500/20 to-green-500/5 border-green-500/20', red: 'from-red-500/20 to-red-500/5 border-red-500/20', blue: 'from-primary/20 to-primary/5 border-primary/20', orange: 'from-orange-500/20 to-orange-500/5 border-orange-500/20', purple: 'from-purple-500/20 to-purple-500/5 border-purple-500/20', cyan: 'from-cyan-500/20 to-cyan-500/5 border-cyan-500/20', yellow: 'from-yellow-500/20 to-yellow-500/5 border-yellow-500/20' };
              const iconColorMap: Record<string, string> = { green: 'text-green-500', red: 'text-red-500', blue: 'text-primary', orange: 'text-orange-500', purple: 'text-purple-500', cyan: 'text-cyan-500', yellow: 'text-yellow-500' };
              const Icon = stat.icon;
              return (
                <div key={stat.id} className={cn("rounded-xl border p-3 flex items-center gap-2 bg-gradient-to-br", colorMap[stat.color])} data-testid={stat.id}>
                  <div className={cn("h-9 w-9 rounded-lg flex items-center justify-center shrink-0 bg-background/50 backdrop-blur-sm")}>
                    <Icon className={cn("w-4 h-4", iconColorMap[stat.color])} />
                  </div>
                  <div className="min-w-0">
                    <div className="text-[10px] text-muted-foreground uppercase font-mono">{stat.label}</div>
                    <div className={cn("text-sm font-bold font-mono", stat.color === 'green' ? 'text-green-500' : stat.color === 'red' ? 'text-red-500' : '')}>
                      {stat.value}
                    </div>
                    {stat.extra && <div className={cn("text-[8px] font-bold", stat.extraColor)}>{stat.extra}</div>}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="bg-gradient-to-r from-primary/10 via-purple-500/10 to-cyan-500/10 rounded-xl border border-primary/30 p-4 shadow-[0_0_40px_rgba(14,165,233,0.08)]" data-testid="card-ai-insight">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="h-9 w-9 rounded-xl bg-primary/20 border border-primary/40 flex items-center justify-center shadow-[0_0_16px_rgba(14,165,233,0.35)]">
                  <Brain className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="text-sm font-black text-primary uppercase font-mono tracking-widest">Claude AI Market Intelligence</span>
                    {aiInsight?.marketMood && (
                      <Badge variant="outline" className="text-[9px] font-mono bg-primary/10 border-primary/30">{aiInsight.marketMood}</Badge>
                    )}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono mt-0.5">
                    Real-time analysis across 8 assets · {aiInsight ? `Updated ${new Date(aiInsight.timestamp).toLocaleTimeString()}` : 'Initializing...'}
                  </div>
                </div>
              </div>
              <Button variant="ghost" size="sm" className="h-7 text-[10px] text-muted-foreground hover:text-primary border border-border/40 hover:border-primary/30 px-3" onClick={() => fetchInsight(topMovers)} disabled={aiInsightLoading} data-testid="button-refresh-insight">
                {aiInsightLoading ? <Activity className="w-3 h-3 animate-spin" /> : <Zap className="w-3 h-3" />}
                <span className="ml-1.5">{aiInsightLoading ? 'Analyzing...' : 'Refresh AI'}</span>
              </Button>
            </div>

            {aiInsightLoading && !aiInsight ? (
              <div className="flex items-center gap-2 py-2">
                <Activity className="w-4 h-4 text-primary animate-spin" />
                <span className="text-xs text-muted-foreground">AI is analyzing the market...</span>
              </div>
            ) : aiInsight ? (
              <div className="space-y-3">
                <p className="text-xs text-foreground/90 leading-relaxed bg-background/30 rounded-lg p-3 border border-border/40">{aiInsight.overview}</p>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
                  {(aiInsight.coins || []).map((c: any) => {
                    const sentColors: Record<string, string> = {
                      BULLISH: 'border-green-500/40 bg-green-500/5 hover:border-green-500/60 shadow-[0_2px_12px_rgba(16,185,129,0.06)]',
                      BEARISH: 'border-red-500/40 bg-red-500/5 hover:border-red-500/60 shadow-[0_2px_12px_rgba(239,68,68,0.06)]',
                      NEUTRAL: 'border-yellow-500/40 bg-yellow-500/5 hover:border-yellow-500/60',
                    };
                    const sentTextColors: Record<string, string> = {
                      BULLISH: 'text-green-400',
                      BEARISH: 'text-red-400',
                      NEUTRAL: 'text-yellow-400',
                    };
                    const sentBgColors: Record<string, string> = {
                      BULLISH: 'bg-green-500/15 text-green-400',
                      BEARISH: 'bg-red-500/15 text-red-400',
                      NEUTRAL: 'bg-yellow-500/15 text-yellow-400',
                    };
                    const actionColors: Record<string, string> = {
                      BUY: 'bg-green-500 text-white shadow-[0_0_8px_rgba(16,185,129,0.4)]',
                      SELL: 'bg-red-500 text-white shadow-[0_0_8px_rgba(239,68,68,0.4)]',
                      HOLD: 'bg-yellow-500/20 text-yellow-400 border border-yellow-500/30',
                      WATCH: 'bg-blue-500/20 text-blue-400 border border-blue-500/30',
                    };
                    const fomoColors: Record<string, string> = {
                      HIGH: 'text-red-400 bg-red-500/15',
                      MEDIUM: 'text-yellow-400 bg-yellow-500/15',
                      LOW: 'text-green-400 bg-green-500/15',
                    };
                    return (
                      <div key={c.coin} className={cn("rounded-xl border p-3 cursor-pointer hover:scale-[1.01] transition-all", sentColors[c.sentiment] || sentColors.NEUTRAL)} onClick={() => setSelectedCoin(c.coin)} data-testid={`insight-coin-${c.coin}`}>
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1.5">
                            <span className="text-sm font-black font-mono">{c.coin}</span>
                            <span className={cn("text-[8px] font-bold px-1.5 py-0.5 rounded-full uppercase", sentBgColors[c.sentiment] || sentBgColors.NEUTRAL)}>{c.sentiment}</span>
                          </div>
                          <span className={cn("text-[9px] font-bold px-2 py-0.5 rounded-full", actionColors[c.action] || actionColors.WATCH)}>{c.action}</span>
                        </div>
                        <p className="text-[10px] text-foreground/80 leading-relaxed mb-2 line-clamp-2">{c.shortAnalysis}</p>
                        <div className="space-y-1">
                          <div className="flex items-center gap-1 min-w-0">
                            <span className="text-[9px] text-muted-foreground/60 shrink-0">Key:</span>
                            <span className="text-[9px] font-mono text-primary/90 truncate">{c.keyLevel}</span>
                          </div>
                          {c.xSentiment && (
                            <div className="flex items-center gap-1 min-w-0">
                              <span className="text-[9px] text-muted-foreground/60 shrink-0">Social:</span>
                              <span className="text-[9px] text-foreground/70 truncate">{c.xSentiment}</span>
                            </div>
                          )}
                          <div className="flex items-center gap-1.5 flex-wrap mt-0.5">
                            {c.fomoLevel && (
                              <span className={cn("text-[8px] font-bold px-1.5 py-0.5 rounded", fomoColors[c.fomoLevel] || fomoColors.MEDIUM)}>
                                FOMO: {c.fomoLevel}
                              </span>
                            )}
                            {c.newsBias && (
                              <span className="text-[8px] text-muted-foreground/60 truncate">{c.newsBias}</span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {aiInsight.upcomingTrades?.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2">
                      <Target className="w-3.5 h-3.5 text-orange-500" />
                      <span className="text-xs font-black text-orange-500 uppercase font-mono tracking-widest">AI Trade Setups</span>
                      <span className="text-[9px] text-muted-foreground">— click to load chart</span>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      {(aiInsight.upcomingTrades || []).map((t: any, i: number) => (
                        <div key={i} className={cn(
                          "rounded-xl border p-3 cursor-pointer transition-all hover:scale-[1.01]",
                          t.direction === 'LONG'
                            ? 'border-green-500/30 bg-green-500/5 hover:border-green-500/50 hover:shadow-[0_0_12px_rgba(16,185,129,0.1)]'
                            : 'border-red-500/30 bg-red-500/5 hover:border-red-500/50 hover:shadow-[0_0_12px_rgba(239,68,68,0.1)]'
                        )} onClick={() => setSelectedCoin(t.coin)} data-testid={`upcoming-trade-${i}`}>
                          <div className="flex items-center justify-between mb-2">
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-black font-mono">{t.coin}</span>
                              <Badge variant={t.direction === 'LONG' ? 'default' : 'destructive'} className="text-[8px] h-4 px-1.5 font-bold">{t.direction}</Badge>
                            </div>
                            <span className="text-[9px] font-mono text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded">{t.timeframe}</span>
                          </div>
                          <p className="text-[10px] text-muted-foreground leading-relaxed mb-2">{t.reason}</p>
                          <div className="flex items-center gap-2">
                            <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                              <div className={cn("h-full rounded-full transition-all", t.direction === 'LONG' ? 'bg-green-500' : 'bg-red-500')} style={{ width: `${t.confidence}%` }} />
                            </div>
                            <span className={cn("text-[9px] font-mono font-bold", t.direction === 'LONG' ? 'text-green-500' : 'text-red-400')}>{t.confidence}%</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">Unable to load AI insights. Click refresh to try again.</p>
            )}
          </div>

          <div className="grid grid-cols-12 gap-2 md:gap-3" style={{ minHeight: '440px' }}>
            <div className="col-span-12 lg:col-span-7 bg-card rounded-xl border border-border overflow-hidden relative group">
              <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-green-500 via-primary to-purple-500 opacity-60" />
              <div className="absolute top-3 right-12 z-10">
                <Button size="icon" variant="ghost" className="h-7 w-7 hover:bg-background/50" data-testid="button-fullscreen">
                  <Maximize2 className="w-4 h-4" />
                </Button>
              </div>
              <TradingChart symbol={selectedCoin} timeframe={timeframe} />
            </div>

            <div className="col-span-12 lg:col-span-5 bg-card rounded-xl border border-primary/20 overflow-hidden flex flex-col shadow-[0_0_20px_rgba(14,165,233,0.06)]" style={{ minHeight: '540px' }} data-testid="card-signals">
              <div className="p-3 border-b border-border bg-gradient-to-r from-primary/10 to-purple-500/5 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-6 w-6 rounded-md bg-primary/20 flex items-center justify-center">
                    <Zap className="w-3.5 h-3.5 text-primary" />
                  </div>
                  <div>
                    <span className="text-xs font-black uppercase tracking-widest text-primary">Quantum Signals</span>
                    <div className="text-[9px] text-muted-foreground font-mono">AI-confirmed entries</div>
                  </div>
                </div>
                <Badge variant="outline" className="text-[10px] font-mono bg-primary/10 border-primary/30">{activeSignals} Active</Badge>
              </div>
              <div className="flex-1 overflow-hidden">
                <SignalFeed onSelectCoin={setSelectedCoin} />
              </div>
            </div>

            <div className="col-span-12 lg:col-span-8 bg-card rounded-xl border border-green-500/20 overflow-hidden shadow-[0_0_15px_rgba(16,185,129,0.05)]" data-testid="card-orderbook">
              <OrderBook symbol={selectedCoin} currentPrice={currentPrice} />
            </div>

            <div className="col-span-12 lg:col-span-4 bg-card rounded-xl border border-border overflow-hidden" data-testid="card-trade-entry">
              <TradeEntry symbol={selectedCoin} price={currentPrice} />
            </div>
          </div>

          <div className="grid grid-cols-12 gap-2 md:gap-3">
            <div className="col-span-12 md:col-span-6 lg:col-span-5 bg-card rounded-xl border border-border overflow-hidden" data-testid="card-positions">
              <div className="p-3 border-b border-border flex items-center justify-between bg-gradient-to-r from-primary/5 to-transparent">
                <div className="flex items-center gap-2">
                  <Activity className="w-4 h-4 text-primary" />
                  <h3 className="font-display font-semibold text-sm">Open Positions</h3>
                </div>
                <Badge variant="outline" className="text-[10px] font-mono bg-primary/5 border-primary/20">{openPositions} Active</Badge>
              </div>
              <ScrollArea className="h-[220px]">
                {positions.filter((p: any) => p.status === 'open').length === 0 ? (
                  <div className="flex items-center justify-center h-full text-xs text-muted-foreground py-16">
                    No open positions. Execute a signal to start.
                  </div>
                ) : (
                  <div className="divide-y divide-border/30">
                    {positions.filter((p: any) => p.status === 'open').map((pos: any) => (
                      <div key={pos.id} className="p-3 flex items-center justify-between hover:bg-muted/10 transition-colors" data-testid={`position-${pos.id}`}>
                        <div className="flex items-center gap-3">
                          <Badge variant={pos.type === 'LONG' ? 'default' : 'destructive'} className="text-[10px] font-bold h-5">{pos.type}</Badge>
                          <div>
                            <span className="font-bold text-sm">{pos.symbol}</span>
                            <div className="text-[10px] text-muted-foreground font-mono">
                              ${parseFloat(pos.entryPrice).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                              {pos.leverage && <span className="ml-1 text-primary">{pos.leverage}x</span>}
                            </div>
                          </div>
                        </div>
                        <div className={cn("font-bold font-mono text-sm", (pos.pnl || 0) >= 0 ? 'text-green-500' : 'text-red-500')}>
                          {(pos.pnl || 0) >= 0 ? '+' : ''}${(pos.pnl || 0).toFixed(2)}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>

            <div className="col-span-12 md:col-span-6 lg:col-span-4 bg-card rounded-xl border border-border overflow-hidden" style={{ maxHeight: '300px' }}>
              <MarketOverview onSelectCoin={setSelectedCoin} selectedCoin={selectedCoin} />
            </div>
          </div>

          <div className="grid grid-cols-12 gap-2 md:gap-3">

            <div className="col-span-12 md:col-span-6 lg:col-span-3 bg-card rounded-xl border border-border p-4" data-testid="chart-volume-pie">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-6 w-6 rounded-full bg-purple-500/20 flex items-center justify-center">
                  <PieChartIcon className="w-3 h-3 text-purple-500" />
                </div>
                <span className="text-xs font-bold font-display">Volume Distribution</span>
              </div>
              <div className="h-[180px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={volumePieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={45}
                      outerRadius={70}
                      paddingAngle={3}
                      dataKey="value"
                      stroke="none"
                    >
                      {volumePieData.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Pie>
                    <Tooltip content={<CustomPieTooltip />} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-1 justify-center mt-1">
                {volumePieData.map((d, i) => (
                  <div key={d.name} className="flex items-center gap-1">
                    <div className="w-2 h-2 rounded-full" style={{ backgroundColor: d.fill }} />
                    <span className="text-[9px] font-mono text-muted-foreground">{d.name}</span>
                  </div>
                ))}
              </div>
            </div>

            <div className="col-span-12 md:col-span-6 lg:col-span-3 bg-card rounded-xl border border-border p-4" data-testid="chart-daily-change">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-6 w-6 rounded-full bg-green-500/20 flex items-center justify-center">
                  <BarChart3 className="w-3 h-3 text-green-500" />
                </div>
                <span className="text-xs font-bold font-display">24h Price Change %</span>
              </div>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={changeBarData} layout="vertical" margin={{ left: 0, right: 10, top: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.08)" horizontal={false} />
                    <XAxis type="number" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10, fill: '#94a3b8', fontWeight: 600 }} width={40} axisLine={false} tickLine={false} />
                    <Tooltip content={<CustomBarTooltip />} cursor={{ fill: 'rgba(14,165,233,0.05)' }} />
                    <Bar dataKey="change" radius={[0, 4, 4, 0]} barSize={14}>
                      {changeBarData.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="col-span-12 md:col-span-6 lg:col-span-3 bg-card rounded-xl border border-border p-4" data-testid="chart-volume-bars">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-6 w-6 rounded-full bg-cyan-500/20 flex items-center justify-center">
                  <LineChartIcon className="w-3 h-3 text-cyan-500" />
                </div>
                <span className="text-xs font-bold font-display">24h Volume Comparison</span>
              </div>
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={volumeBarData} margin={{ left: -10, right: 5, top: 5, bottom: 5 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.08)" />
                    <XAxis dataKey="name" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                    <YAxis tick={{ fontSize: 8, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={(v) => formatVolumeShort(v)} />
                    <Tooltip content={<CustomVolumeTooltip />} cursor={{ fill: 'rgba(14,165,233,0.05)' }} />
                    <Bar dataKey="volume" radius={[4, 4, 0, 0]} barSize={20}>
                      {volumeBarData.map((entry, i) => (
                        <Cell key={i} fill={entry.fill} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="col-span-12 md:col-span-6 lg:col-span-3 bg-card rounded-xl border border-border p-4" data-testid="chart-sentiment-movers">
              <div className="flex items-center gap-2 mb-3">
                <div className="h-6 w-6 rounded-full bg-orange-500/20 flex items-center justify-center">
                  <Gauge className="w-3 h-3 text-orange-500" />
                </div>
                <span className="text-xs font-bold font-display">Market Sentiment</span>
              </div>
              <div className="h-[120px] flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <RadialBarChart
                    cx="50%"
                    cy="50%"
                    innerRadius="60%"
                    outerRadius="90%"
                    startAngle={180}
                    endAngle={0}
                    data={sentimentRadialData}
                  >
                    <RadialBar dataKey="value" cornerRadius={10} background={{ fill: 'rgba(148,163,184,0.1)' }} />
                  </RadialBarChart>
                </ResponsiveContainer>
              </div>
              <div className="text-center -mt-4">
                <div className={cn("text-2xl font-black font-mono", fg.color)}>{Math.round(fearGreed)}</div>
                <div className={cn("text-[10px] font-bold uppercase", fg.color)}>{fg.label}</div>
              </div>

              <div className="mt-3 space-y-1">
                <div className="text-[9px] text-muted-foreground uppercase font-mono mb-1 flex items-center gap-1">
                  <Shield className="w-3 h-3" /> Top Movers
                </div>
                {topMovers.slice(0, 4).map(m => (
                  <div key={m.symbol} className="flex items-center gap-2 cursor-pointer hover:bg-muted/20 rounded px-1 py-0.5" onClick={() => setSelectedCoin(m.symbol)} data-testid={`mover-${m.symbol}`}>
                    <span className="text-[10px] font-mono w-8 font-bold">{m.symbol}</span>
                    <div className="flex-1 h-1.5 bg-muted rounded-full overflow-hidden">
                      <div className={cn("h-full rounded-full transition-all", m.change >= 0 ? 'bg-green-500' : 'bg-red-500')} style={{ width: `${Math.min(100, Math.abs(m.change) * 8 + 20)}%` }} />
                    </div>
                    <span className={cn("text-[9px] font-mono font-bold w-12 text-right", m.change >= 0 ? 'text-green-500' : 'text-red-500')}>
                      {m.change >= 0 ? '+' : ''}{m.change.toFixed(1)}%
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>

        </div>
      </main>
    </div>
  );
}
