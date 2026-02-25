import { useEffect, useState } from 'react';
import { cn } from '@/lib/utils';
import { TrendingUp, TrendingDown, Search, Loader2 } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { fetch24hTicker, subscribeToTicker } from '@/lib/binance';

interface MarketOverviewProps {
  onSelectCoin: (coin: string) => void;
  selectedCoin: string;
}

interface TickerData {
  symbol: string;
  price: number;
  change24h: number;
  volume: number;
}

const WS_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
  'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'LINKUSDT',
  'MATICUSDT', 'UNIUSDT', 'LTCUSDT', 'ATOMUSDT'
];

export function MarketOverview({ onSelectCoin, selectedCoin }: MarketOverviewProps) {
  const [tickers, setTickers] = useState<TickerData[]>([]);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const loadTickers = async () => {
      const data = await fetch24hTicker();
      const mapped = data
        .map((t: any) => ({
          symbol: t.symbol.replace('USDT', ''),
          price: parseFloat(t.lastPrice),
          change24h: parseFloat(t.priceChangePercent),
          volume: parseFloat(t.quoteVolume),
        }))
        .sort((a: any, b: any) => b.volume - a.volume);

      setTickers(mapped);
      setIsLoading(false);
    };

    loadTickers();

    const unsubscribe = subscribeToTicker(WS_SYMBOLS, (data: any[]) => {
      setTickers(prev => {
        const updated = [...prev];
        for (const update of data) {
          const sym = update.s?.replace('USDT', '');
          const idx = updated.findIndex(t => t.symbol === sym);
          if (idx >= 0) {
            updated[idx] = {
              ...updated[idx],
              price: parseFloat(update.c),
              change24h: parseFloat(update.P),
            };
          }
        }
        return updated;
      });
    });

    return () => unsubscribe();
  }, []);

  const filtered = tickers.filter(t =>
    t.symbol.toLowerCase().includes(search.toLowerCase())
  );

  return (
    <div className="h-full flex flex-col">
       <div className="p-4 border-b border-border space-y-3">
        <h3 className="font-display font-semibold text-lg flex items-center justify-between">
          Market Watch
          {isLoading && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />}
        </h3>
        <div className="relative">
          <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search USDT pairs..."
            className="pl-8 h-9 bg-muted/30 border-none"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            data-testid="input-search-market"
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto custom-scrollbar">
        <table className="w-full text-sm text-left">
          <thead className="text-xs text-muted-foreground bg-muted/30 sticky top-0 z-10 backdrop-blur">
            <tr>
              <th className="px-4 py-2 font-medium">Coin</th>
              <th className="px-4 py-2 font-medium text-right">Price</th>
              <th className="px-4 py-2 font-medium text-right">24h</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {filtered.map((coin) => (
              <tr
                key={coin.symbol}
                onClick={() => onSelectCoin(coin.symbol)}
                className={cn(
                  "hover:bg-muted/20 cursor-pointer transition-colors",
                  selectedCoin === coin.symbol && "bg-primary/10 border-l-2 border-primary"
                )}
                data-testid={`market-row-${coin.symbol}`}
              >
                <td className="px-4 py-3">
                  <div className="font-bold">{coin.symbol}</div>
                  <div className="text-xs text-muted-foreground">USDT</div>
                </td>
                <td className="px-4 py-3 text-right font-mono">
                  ${coin.price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 6 })}
                </td>
                <td className={cn(
                  "px-4 py-3 text-right font-mono",
                  coin.change24h >= 0 ? "text-green-500" : "text-red-500"
                )}>
                  <div className="flex items-center justify-end gap-1">
                    {coin.change24h >= 0 ? <TrendingUp className="w-3 h-3" /> : <TrendingDown className="w-3 h-3" />}
                    {Math.abs(coin.change24h).toFixed(2)}%
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
