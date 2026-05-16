import { useEffect, useState, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Percent, RefreshCw, TrendingUp, TrendingDown } from 'lucide-react';

const FUTURES_BASE = 'https://fapi.binance.com/fapi/v1';

const TRACKED_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT',
  'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'LINKUSDT', 'DOTUSDT',
];

interface FundingData {
  symbol: string;
  fundingRate: number;
  nextFundingTime: number;
  markPrice: number;
  indexPrice: number;
  premiumIndex: number;
}

function formatFundingRate(rate: number): string {
  return `${(rate * 100).toFixed(4)}%`;
}

function getRateColor(rate: number): string {
  if (rate > 0.0005) return 'text-green-600 font-bold';
  if (rate > 0.0002) return 'text-green-500';
  if (rate > 0) return 'text-green-400';
  if (rate < -0.0005) return 'text-red-600 font-bold';
  if (rate < -0.0002) return 'text-red-500';
  if (rate < 0) return 'text-red-400';
  return 'text-muted-foreground';
}

function getRateBg(rate: number): string {
  if (rate > 0.0003) return 'bg-green-50 border-green-200';
  if (rate < -0.0003) return 'bg-red-50 border-red-200';
  return 'bg-muted/20 border-border/40';
}

function getTimeRemaining(nextFundingTime: number): string {
  const diff = nextFundingTime - Date.now();
  if (diff <= 0) return 'Settling...';
  const h = Math.floor(diff / 3600000);
  const m = Math.floor((diff % 3600000) / 60000);
  return `${h}h ${m}m`;
}

export function FundingRatesPanel() {
  const [data, setData] = useState<FundingData[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);

  const loadData = useCallback(async () => {
    try {
      const results = await Promise.allSettled(
        TRACKED_SYMBOLS.map(sym =>
          fetch(`${FUTURES_BASE}/premiumIndex?symbol=${sym}`)
            .then(r => r.ok ? r.json() : null)
        )
      );

      const parsed: FundingData[] = results
        .filter(r => r.status === 'fulfilled' && r.value)
        .map((r: any) => ({
          symbol: r.value.symbol.replace('USDT', ''),
          fundingRate: parseFloat(r.value.lastFundingRate || r.value.fundingRate || '0'),
          nextFundingTime: r.value.nextFundingTime || 0,
          markPrice: parseFloat(r.value.markPrice || '0'),
          indexPrice: parseFloat(r.value.indexPrice || '0'),
          premiumIndex: parseFloat(r.value.lastFundingRate || '0'),
        }))
        .sort((a, b) => Math.abs(b.fundingRate) - Math.abs(a.fundingRate));

      setData(parsed);
      setLastUpdate(new Date());
      setLoading(false);
    } catch {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadData();
    const interval = setInterval(loadData, 60000);
    return () => clearInterval(interval);
  }, [loadData]);

  const avgRate = data.length > 0 ? data.reduce((s, d) => s + d.fundingRate, 0) / data.length : 0;
  const bullishCount = data.filter(d => d.fundingRate > 0).length;
  const bearishCount = data.filter(d => d.fundingRate < 0).length;

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-border flex items-center justify-between bg-gradient-to-r from-blue-500/10 to-cyan-500/5">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-md bg-blue-500/20 flex items-center justify-center">
            <Percent className="w-3.5 h-3.5 text-blue-500" />
          </div>
          <div>
            <span className="text-xs font-black uppercase tracking-widest text-blue-600">Funding Rates</span>
            <div className="text-[9px] text-muted-foreground font-mono">
              Avg: <span className={cn('font-bold', avgRate >= 0 ? 'text-green-500' : 'text-red-500')}>
                {formatFundingRate(avgRate)}
              </span>
              &nbsp;·&nbsp;
              <span className="text-green-500">{bullishCount}↑</span>
              &nbsp;<span className="text-red-500">{bearishCount}↓</span>
            </div>
          </div>
        </div>
        <button onClick={loadData} className="p-1 hover:bg-muted/40 rounded">
          <RefreshCw className={cn('w-3 h-3 text-muted-foreground', loading && 'animate-spin')} />
        </button>
      </div>

      <div className="flex-1 overflow-auto p-2 space-y-1">
        {loading ? (
          <div className="h-full flex items-center justify-center">
            <div className="text-xs text-muted-foreground animate-pulse">Fetching funding rates...</div>
          </div>
        ) : data.length === 0 ? (
          <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
            Funding data unavailable (requires Binance Futures)
          </div>
        ) : (
          data.map(d => (
            <div key={d.symbol} className={cn('rounded-lg border px-3 py-2 flex items-center gap-2', getRateBg(d.fundingRate))}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-1.5">
                  <span className="text-xs font-black">{d.symbol}</span>
                  {d.fundingRate > 0
                    ? <TrendingUp className="w-3 h-3 text-green-500" />
                    : <TrendingDown className="w-3 h-3 text-red-500" />}
                </div>
                <div className="text-[9px] text-muted-foreground font-mono mt-0.5">
                  Mark: ${d.markPrice.toLocaleString(undefined, { maximumFractionDigits: d.markPrice > 100 ? 0 : 2 })}
                  &nbsp;·&nbsp;Next: {d.nextFundingTime > 0 ? getTimeRemaining(d.nextFundingTime) : '--'}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className={cn('text-sm font-black font-mono', getRateColor(d.fundingRate))}>
                  {formatFundingRate(d.fundingRate)}
                </div>
                <div className="text-[8px] text-muted-foreground font-mono">
                  {d.fundingRate > 0 ? 'Longs pay' : 'Shorts pay'}
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {lastUpdate && (
        <div className="px-3 py-1 border-t border-border/40 text-[9px] text-muted-foreground font-mono">
          Updated {lastUpdate.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · 8h cycle
        </div>
      )}
    </div>
  );
}
