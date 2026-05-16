import { useEffect, useState, useCallback } from 'react';
import { fetch24hTicker } from '@/lib/binance';
import { cn } from '@/lib/utils';
import { Grid3X3, RefreshCw } from 'lucide-react';

const COINS = [
  'BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'AVAX', 'DOGE',
  'DOT', 'LINK', 'MATIC', 'UNI', 'ATOM', 'LTC', 'BCH',
  'NEAR', 'FIL', 'APT', 'ARB', 'OP',
];

interface CoinData {
  symbol: string;
  price: number;
  change: number;
  volume: number;
}

function getHeatColor(change: number): string {
  if (change >= 10) return 'bg-green-600 text-white';
  if (change >= 5) return 'bg-green-500 text-white';
  if (change >= 3) return 'bg-green-400 text-white';
  if (change >= 1) return 'bg-green-300 text-green-900';
  if (change >= 0) return 'bg-green-100 text-green-800';
  if (change >= -1) return 'bg-red-100 text-red-800';
  if (change >= -3) return 'bg-red-300 text-red-900';
  if (change >= -5) return 'bg-red-400 text-white';
  if (change >= -10) return 'bg-red-500 text-white';
  return 'bg-red-600 text-white';
}

interface MarketHeatmapProps {
  onSelectCoin?: (coin: string) => void;
}

export function MarketHeatmap({ onSelectCoin }: MarketHeatmapProps) {
  const [coins, setCoins] = useState<CoinData[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const loadData = useCallback(async () => {
    try {
      const tickers = await fetch24hTicker();
      const data: CoinData[] = COINS.map(coin => {
        const t = tickers.find((t: any) => t.symbol === `${coin}USDT`);
        if (!t) return null;
        return {
          symbol: coin,
          price: parseFloat(t.lastPrice),
          change: parseFloat(t.priceChangePercent),
          volume: parseFloat(t.quoteVolume),
        };
      }).filter(Boolean) as CoinData[];

      setCoins(data.sort((a, b) => b.volume - a.volume));
      setLastUpdate(new Date());
      setLoading(false);
    } catch (e) {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 30000);
    return () => clearInterval(interval);
  }, [loadData]);

  const positiveCount = coins.filter(c => c.change >= 0).length;
  const negativeCount = coins.filter(c => c.change < 0).length;

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-border flex items-center justify-between bg-gradient-to-r from-purple-500/10 to-primary/5">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-md bg-purple-500/20 flex items-center justify-center">
            <Grid3X3 className="w-3.5 h-3.5 text-purple-500" />
          </div>
          <div>
            <span className="text-xs font-black uppercase tracking-widest text-purple-600">Market Heatmap</span>
            <div className="text-[9px] text-muted-foreground font-mono">24h price change · click to chart</div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-[9px] font-mono">
            <span className="w-2.5 h-2.5 rounded-sm bg-green-400 inline-block" />
            <span className="text-green-600 font-bold">{positiveCount}</span>
            <span className="w-2.5 h-2.5 rounded-sm bg-red-400 inline-block ml-1" />
            <span className="text-red-500 font-bold">{negativeCount}</span>
          </div>
          <button onClick={loadData} className="p-1 hover:bg-muted/40 rounded">
            <RefreshCw className={cn('w-3 h-3 text-muted-foreground', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      <div className="flex-1 p-2 overflow-hidden">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-xs text-muted-foreground animate-pulse">Loading market data...</div>
          </div>
        ) : (
          <div className="grid grid-cols-4 sm:grid-cols-5 gap-1 h-full auto-rows-fr">
            {coins.map(coin => (
              <button
                key={coin.symbol}
                onClick={() => onSelectCoin?.(coin.symbol)}
                className={cn(
                  'rounded-lg p-1.5 flex flex-col items-center justify-center gap-0.5 transition-all',
                  'hover:scale-105 hover:shadow-md active:scale-95 cursor-pointer border border-black/5',
                  getHeatColor(coin.change)
                )}
                title={`${coin.symbol}: ${coin.change >= 0 ? '+' : ''}${coin.change.toFixed(2)}%`}
              >
                <span className="text-[10px] font-black leading-none">{coin.symbol}</span>
                <span className={cn('text-[9px] font-bold font-mono leading-none', coin.change >= 0 ? '' : '')}>
                  {coin.change >= 0 ? '+' : ''}{coin.change.toFixed(2)}%
                </span>
              </button>
            ))}
          </div>
        )}
      </div>

      {lastUpdate && (
        <div className="px-3 py-1 border-t border-border/40 text-[9px] text-muted-foreground font-mono">
          Updated {lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
        </div>
      )}
    </div>
  );
}
