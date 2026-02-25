import { useEffect, useState } from 'react';
import { Sidebar } from '@/components/layout/Sidebar';
import { fetch24hTicker, BinanceTicker, subscribeToTicker } from '@/lib/binance';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Search, Filter, ArrowUpRight, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';

const WS_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
  'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT',
  'MATICUSDT', 'UNIUSDT', 'LTCUSDT', 'ATOMUSDT'
];

export default function Markets() {
  const [markets, setMarkets] = useState<BinanceTicker[]>([]);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState('ALL');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadData = async () => {
      try {
        const data = await fetch24hTicker();
        const sorted = data.sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
        setMarkets(sorted);
        setIsLoading(false);
      } catch (e) {
        console.error("Failed to load initial market data", e);
        setIsLoading(false);
      }
    };
    loadData();

    const unsubscribe = subscribeToTicker(WS_SYMBOLS, (data) => {
        setMarkets(prevMarkets => {
            const marketMap = new Map(prevMarkets.map(m => [m.symbol, m]));
            data.forEach((update: any) => {
                const symbol = update.s;
                const existing = marketMap.get(symbol);
                if (existing) {
                    marketMap.set(symbol, {
                        ...existing,
                        lastPrice: update.c,
                        priceChangePercent: update.P,
                        quoteVolume: update.q || existing.quoteVolume
                    });
                }
            });
            return Array.from(marketMap.values()).sort((a, b) => parseFloat(b.quoteVolume) - parseFloat(a.quoteVolume));
        });
    });

    return () => unsubscribe();
  }, []);

  const filtered = markets.filter(m =>
    m.symbol.includes(search.toUpperCase()) &&
    (filter === 'ALL' || (filter === 'GAINERS' && parseFloat(m.priceChangePercent) > 0) || (filter === 'LOSERS' && parseFloat(m.priceChangePercent) < 0))
  );

  return (
    <div className="min-h-screen bg-background text-foreground font-sans flex">
      <Sidebar />
      <div className="flex-1 md:pl-64">
        <div className="p-4 md:p-8 space-y-6">
          <div className="flex flex-col md:flex-row justify-between md:items-end gap-4">
            <div>
              <h1 className="text-2xl md:text-3xl font-display font-bold text-primary mb-2" data-testid="text-page-title">Market Overview</h1>
              <p className="text-muted-foreground text-sm">Real-time analysis of top crypto assets.</p>
            </div>

            <div className="flex gap-3">
              <div className="bg-card border border-border p-3 rounded-lg w-40">
                <div className="text-xs text-muted-foreground mb-1">Global Market Cap</div>
                <div className="text-lg font-mono font-bold">$2.45T</div>
                <div className="text-xs text-green-500 flex items-center gap-1">
                  <TrendingUp className="w-3 h-3" /> +1.2%
                </div>
              </div>
              <div className="bg-card border border-border p-3 rounded-lg w-40">
                <div className="text-xs text-muted-foreground mb-1">24h Volume</div>
                <div className="text-lg font-mono font-bold">$89.2B</div>
                <div className="text-xs text-red-500 flex items-center gap-1">
                  <TrendingDown className="w-3 h-3" /> -5.4%
                </div>
              </div>
            </div>
          </div>

          <div className="flex flex-col md:flex-row gap-3 items-stretch md:items-center bg-card p-3 rounded-lg border border-border">
            <div className="relative flex-1 md:max-w-xs">
              <Search className="absolute left-3 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search assets..."
                className="pl-9 bg-background border-border"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                data-testid="input-search"
              />
            </div>
            <div className="flex gap-2">
              {['ALL', 'GAINERS', 'LOSERS'].map(f => (
                <Button
                  key={f}
                  variant={filter === f ? 'default' : 'outline'}
                  onClick={() => setFilter(f)}
                  className="flex-1 md:w-24"
                  data-testid={`button-filter-${f.toLowerCase()}`}
                >
                  {f}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
            {isLoading ? (
                <div className="col-span-full flex justify-center py-20">
                    <Loader2 className="w-8 h-8 animate-spin text-primary" />
                </div>
            ) : filtered.slice(0, 24).map((coin) => {
              const change = parseFloat(coin.priceChangePercent);
              return (
                <div key={coin.symbol} className="bg-card border border-border rounded-lg p-5 hover:border-primary/50 transition-all cursor-pointer group" data-testid={`card-market-${coin.symbol}`}>
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center text-primary font-bold text-sm">
                        {coin.symbol.replace('USDT', '').substring(0, 2)}
                      </div>
                      <div>
                        <div className="font-bold">{coin.symbol.replace('USDT', '')}</div>
                        <div className="text-xs text-muted-foreground">Perpetual</div>
                      </div>
                    </div>
                    <Badge variant={change >= 0 ? 'default' : 'destructive'} className={cn("font-mono", change >= 0 ? "bg-green-500/20 text-green-500 hover:bg-green-500/30" : "bg-red-500/20 text-red-500 hover:bg-red-500/30")}>
                      {change > 0 ? '+' : ''}{change.toFixed(2)}%
                    </Badge>
                  </div>

                  <div className="space-y-1 mb-4">
                    <div className="text-2xl font-mono font-bold">
                      ${parseFloat(coin.lastPrice).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                    </div>
                    <div className="text-xs text-muted-foreground flex justify-between">
                      <span>Vol: ${(parseFloat(coin.quoteVolume) / 1000000).toFixed(2)}M</span>
                      <span>H: {parseFloat(coin.highPrice).toLocaleString()}</span>
                    </div>
                  </div>

                  <div className="h-12 w-full flex items-end gap-1 opacity-50 group-hover:opacity-100 transition-opacity">
                    {[...Array(20)].map((_, i) => (
                      <div
                        key={i}
                        className={cn("flex-1 rounded-t-sm", change >= 0 ? "bg-green-500" : "bg-red-500")}
                        style={{ height: `${20 + Math.random() * 80}%` }}
                      />
                    ))}
                  </div>

                  <div className="mt-4 pt-4 border-t border-border flex justify-between items-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="text-xs text-primary font-medium">View Analysis</span>
                    <ArrowUpRight className="w-4 h-4 text-primary" />
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
