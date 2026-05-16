import { useEffect, useState, useCallback } from 'react';
import { fetch24hTicker } from '@/lib/binance';
import { cn } from '@/lib/utils';
import { Star, Plus, X, TrendingUp, TrendingDown, Bell, BellOff } from 'lucide-react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { toast } from '@/hooks/use-toast';

const DEFAULT_WATCHLIST = ['BTC', 'ETH', 'SOL', 'BNB', 'XRP'];
const STORAGE_KEY = 'winm_watchlist';
const ALERTS_KEY = 'winm_price_alerts';

interface CoinPrice {
  symbol: string;
  price: number;
  change: number;
  high: number;
  low: number;
}

interface PriceAlert {
  id: string;
  coin: string;
  price: number;
  direction: 'above' | 'below';
  triggered: boolean;
}

interface WatchlistPanelProps {
  onSelectCoin?: (coin: string) => void;
  currentPrices?: Record<string, number>;
}

export function WatchlistPanel({ onSelectCoin, currentPrices }: WatchlistPanelProps) {
  const [watchlist, setWatchlist] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      return stored ? JSON.parse(stored) : DEFAULT_WATCHLIST;
    } catch { return DEFAULT_WATCHLIST; }
  });

  const [alerts, setAlerts] = useState<PriceAlert[]>(() => {
    try {
      const stored = localStorage.getItem(ALERTS_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });

  const [prices, setPrices] = useState<Record<string, CoinPrice>>({});
  const [addInput, setAddInput] = useState('');
  const [showAddAlert, setShowAddAlert] = useState<string | null>(null);
  const [alertPrice, setAlertPrice] = useState('');
  const [alertDir, setAlertDir] = useState<'above' | 'below'>('above');

  const saveWatchlist = (list: string[]) => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
    setWatchlist(list);
  };

  const saveAlerts = (a: PriceAlert[]) => {
    localStorage.setItem(ALERTS_KEY, JSON.stringify(a));
    setAlerts(a);
  };

  const loadPrices = useCallback(async () => {
    try {
      const tickers = await fetch24hTicker();
      const map: Record<string, CoinPrice> = {};
      tickers.forEach((t: any) => {
        const sym = t.symbol.replace('USDT', '');
        if (watchlist.includes(sym)) {
          map[sym] = {
            symbol: sym,
            price: parseFloat(t.lastPrice),
            change: parseFloat(t.priceChangePercent),
            high: parseFloat(t.highPrice),
            low: parseFloat(t.lowPrice),
          };
        }
      });
      setPrices(map);

      // Check alerts
      const newAlerts = alerts.map(a => {
        if (a.triggered) return a;
        const coinData = map[a.coin];
        if (!coinData) return a;
        const triggered =
          (a.direction === 'above' && coinData.price >= a.price) ||
          (a.direction === 'below' && coinData.price <= a.price);
        if (triggered) {
          toast({
            title: `Price Alert: ${a.coin}`,
            description: `${a.coin} is ${a.direction} $${a.price.toLocaleString()}! Current: $${coinData.price.toLocaleString()}`,
          });
          return { ...a, triggered: true };
        }
        return a;
      });
      if (JSON.stringify(newAlerts) !== JSON.stringify(alerts)) {
        saveAlerts(newAlerts);
      }
    } catch (e) { /* silent */ }
  }, [watchlist, alerts]);

  useEffect(() => {
    loadPrices();
    const interval = setInterval(loadPrices, 15000);
    return () => clearInterval(interval);
  }, [loadPrices]);

  const handleAdd = () => {
    const coin = addInput.toUpperCase().replace('USDT', '').trim();
    if (!coin) return;
    if (watchlist.includes(coin)) {
      toast({ title: 'Already in watchlist', description: `${coin} is already being watched.` });
    } else {
      saveWatchlist([...watchlist, coin]);
    }
    setAddInput('');
  };

  const handleRemove = (coin: string) => {
    saveWatchlist(watchlist.filter(c => c !== coin));
  };

  const handleAddAlert = (coin: string) => {
    const price = parseFloat(alertPrice);
    if (!price || price <= 0) return;
    const newAlert: PriceAlert = {
      id: Date.now().toString(),
      coin,
      price,
      direction: alertDir,
      triggered: false,
    };
    saveAlerts([...alerts, newAlert]);
    setShowAddAlert(null);
    setAlertPrice('');
    toast({ title: 'Alert set', description: `Alert when ${coin} goes ${alertDir} $${price.toLocaleString()}` });
  };

  const handleRemoveAlert = (id: string) => {
    saveAlerts(alerts.filter(a => a.id !== id));
  };

  const activeAlerts = alerts.filter(a => !a.triggered);

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-border flex items-center gap-2 bg-gradient-to-r from-yellow-500/10 to-amber-500/5">
        <div className="h-6 w-6 rounded-md bg-yellow-500/20 flex items-center justify-center">
          <Star className="w-3.5 h-3.5 text-yellow-500" />
        </div>
        <div className="flex-1">
          <span className="text-xs font-black uppercase tracking-widest text-yellow-600">Watchlist</span>
          <div className="text-[9px] text-muted-foreground font-mono">Price alerts · {activeAlerts.length} active</div>
        </div>
      </div>

      {/* Add coin */}
      <div className="p-2 border-b border-border/40 flex gap-1.5">
        <Input
          value={addInput}
          onChange={e => setAddInput(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && handleAdd()}
          placeholder="Add coin (e.g. AVAX)"
          className="h-7 text-xs font-mono bg-muted/20 flex-1"
        />
        <Button onClick={handleAdd} size="sm" variant="outline" className="h-7 w-7 p-0">
          <Plus className="w-3.5 h-3.5" />
        </Button>
      </div>

      {/* Watchlist coins */}
      <div className="flex-1 overflow-auto divide-y divide-border/30">
        {watchlist.map(coin => {
          const d = prices[coin];
          const coinAlerts = alerts.filter(a => a.coin === coin && !a.triggered);
          return (
            <div key={coin} className="group">
              <div
                className="flex items-center gap-2 p-2.5 hover:bg-muted/20 cursor-pointer transition-colors"
                onClick={() => onSelectCoin?.(coin)}
              >
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <span className="text-xs font-black">{coin}</span>
                    <span className="text-[9px] text-muted-foreground font-mono">/USDT</span>
                    {coinAlerts.length > 0 && (
                      <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" title={`${coinAlerts.length} alert(s)`} />
                    )}
                  </div>
                  {d ? (
                    <div className="flex items-center gap-1.5 mt-0.5">
                      <span className="text-xs font-mono font-bold">${d.price.toLocaleString(undefined, { maximumFractionDigits: d.price > 100 ? 0 : d.price > 1 ? 2 : 4 })}</span>
                      <span className={cn('text-[9px] font-bold font-mono', d.change >= 0 ? 'text-green-500' : 'text-red-500')}>
                        {d.change >= 0 ? '+' : ''}{d.change.toFixed(2)}%
                      </span>
                    </div>
                  ) : (
                    <span className="text-[9px] text-muted-foreground font-mono">Loading...</span>
                  )}
                </div>

                {d && (
                  <div className="flex items-center">
                    {d.change >= 0
                      ? <TrendingUp className="w-3.5 h-3.5 text-green-500" />
                      : <TrendingDown className="w-3.5 h-3.5 text-red-500" />}
                  </div>
                )}

                <div className="opacity-0 group-hover:opacity-100 flex gap-0.5 transition-opacity">
                  <button
                    className="p-1 hover:bg-yellow-100 rounded"
                    onClick={e => { e.stopPropagation(); setShowAddAlert(showAddAlert === coin ? null : coin); }}
                    title="Set price alert"
                  >
                    <Bell className="w-3 h-3 text-yellow-500" />
                  </button>
                  <button
                    className="p-1 hover:bg-red-100 rounded"
                    onClick={e => { e.stopPropagation(); handleRemove(coin); }}
                    title="Remove"
                  >
                    <X className="w-3 h-3 text-red-400" />
                  </button>
                </div>
              </div>

              {/* Alert config panel */}
              {showAddAlert === coin && (
                <div className="px-2.5 pb-2.5 bg-yellow-50 border-b border-yellow-100">
                  <div className="text-[9px] font-bold text-yellow-700 mb-1.5 uppercase">Set Alert for {coin}</div>
                  <div className="flex gap-1.5">
                    <div className="flex rounded-md overflow-hidden border border-border/60">
                      <button
                        className={cn('px-2 py-1 text-[9px] font-bold', alertDir === 'above' ? 'bg-green-500 text-white' : 'bg-white text-muted-foreground')}
                        onClick={() => setAlertDir('above')}
                      >Above</button>
                      <button
                        className={cn('px-2 py-1 text-[9px] font-bold', alertDir === 'below' ? 'bg-red-500 text-white' : 'bg-white text-muted-foreground')}
                        onClick={() => setAlertDir('below')}
                      >Below</button>
                    </div>
                    <Input
                      value={alertPrice}
                      onChange={e => setAlertPrice(e.target.value)}
                      placeholder="Price"
                      className="h-6 text-[10px] font-mono bg-white flex-1 min-w-0"
                      type="number"
                    />
                    <Button size="sm" onClick={() => handleAddAlert(coin)} className="h-6 text-[9px] px-2">Set</Button>
                  </div>
                </div>
              )}

              {/* Active alerts for this coin */}
              {coinAlerts.map(alert => (
                <div key={alert.id} className="flex items-center justify-between px-3 py-1 bg-yellow-50/50 text-[9px]">
                  <span className="text-yellow-700 font-mono">
                    Alert: {alert.direction} ${alert.price.toLocaleString()}
                  </span>
                  <button onClick={() => handleRemoveAlert(alert.id)}>
                    <BellOff className="w-3 h-3 text-muted-foreground hover:text-red-400" />
                  </button>
                </div>
              ))}
            </div>
          );
        })}

        {watchlist.length === 0 && (
          <div className="p-6 text-center text-xs text-muted-foreground">
            No coins in watchlist. Add coins above.
          </div>
        )}
      </div>
    </div>
  );
}
