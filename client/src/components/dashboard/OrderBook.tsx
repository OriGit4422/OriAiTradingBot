import { useState, useEffect, useCallback } from 'react';
import { fetchOrderBook, type OrderBookData } from '@/lib/binance';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Activity, ArrowUpDown, RefreshCw, TrendingUp, TrendingDown, BarChart3 } from 'lucide-react';

interface OrderBookProps {
  symbol: string;
  currentPrice?: number;
}

export function OrderBook({ symbol, currentPrice }: OrderBookProps) {
  const [orderBook, setOrderBook] = useState<OrderBookData | null>(null);
  const [loading, setLoading] = useState(true);
  const [depth, setDepth] = useState<20 | 50 | 100>(20);

  const loadOrderBook = useCallback(async () => {
    setLoading(true);
    const data = await fetchOrderBook(symbol, depth);
    setOrderBook(data);
    setLoading(false);
  }, [symbol, depth]);

  useEffect(() => {
    loadOrderBook();
    const interval = setInterval(loadOrderBook, 3000);
    return () => clearInterval(interval);
  }, [loadOrderBook]);

  const formatPrice = (price: number) => {
    if (price >= 1000) return price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (price >= 1) return price.toFixed(4);
    return price.toFixed(6);
  };

  const formatQty = (qty: number) => {
    if (qty >= 1000) return `${(qty / 1000).toFixed(1)}K`;
    if (qty >= 1) return qty.toFixed(3);
    return qty.toFixed(4);
  };

  const formatUSD = (val: number) => {
    if (val >= 1e6) return `$${(val / 1e6).toFixed(1)}M`;
    if (val >= 1e3) return `$${(val / 1e3).toFixed(1)}K`;
    return `$${val.toFixed(0)}`;
  };

  if (!orderBook || orderBook.bids.length === 0) {
    return (
      <div className="h-full flex items-center justify-center">
        <div className="text-center space-y-2">
          <Activity className="w-5 h-5 text-primary mx-auto animate-spin" />
          <p className="text-xs text-muted-foreground">Loading order book...</p>
        </div>
      </div>
    );
  }

  const maxBidTotal = Math.max(...orderBook.bids.map(b => b.total));
  const maxAskTotal = Math.max(...orderBook.asks.map(a => a.total));
  const maxTotal = Math.max(maxBidTotal, maxAskTotal);

  const pressureLabel = orderBook.imbalance > 15 ? 'Strong Buy Pressure' :
    orderBook.imbalance > 5 ? 'Buy Pressure' :
    orderBook.imbalance < -15 ? 'Strong Sell Pressure' :
    orderBook.imbalance < -5 ? 'Sell Pressure' : 'Balanced';

  const pressureColor = orderBook.imbalance > 5 ? 'text-green-500' :
    orderBook.imbalance < -5 ? 'text-red-500' : 'text-yellow-500';

  const displayBids = orderBook.bids.slice(0, 10);
  const displayAsks = orderBook.asks.slice(0, 10).reverse();

  return (
    <div className="h-full flex flex-col">
      <div className="p-2.5 border-b border-border flex items-center justify-between bg-gradient-to-r from-primary/5 to-transparent">
        <div className="flex items-center gap-2">
          <ArrowUpDown className="w-3.5 h-3.5 text-primary" />
          <span className="text-xs font-bold font-display">{symbol}/USDT Order Book</span>
        </div>
        <div className="flex items-center gap-1">
          {([20, 50, 100] as const).map(d => (
            <button
              key={d}
              onClick={() => setDepth(d)}
              className={cn("px-1.5 py-0.5 rounded text-[9px] font-mono transition-all", depth === d ? 'bg-primary text-primary-foreground font-bold' : 'text-muted-foreground hover:bg-muted/50')}
              data-testid={`button-depth-${d}`}
            >
              {d}
            </button>
          ))}
          <Button variant="ghost" size="sm" className="h-5 w-5 p-0 ml-1" onClick={loadOrderBook} data-testid="button-refresh-orderbook">
            <RefreshCw className={cn("w-3 h-3", loading && "animate-spin")} />
          </Button>
        </div>
      </div>

      <div className="px-2 py-1.5 flex items-center justify-between border-b border-border/50 bg-muted/10">
        <div className="flex items-center gap-2">
          {orderBook.imbalance > 5 ? <TrendingUp className="w-3 h-3 text-green-500" /> : orderBook.imbalance < -5 ? <TrendingDown className="w-3 h-3 text-red-500" /> : <BarChart3 className="w-3 h-3 text-yellow-500" />}
          <span className={cn("text-[9px] font-bold", pressureColor)}>{pressureLabel}</span>
        </div>
        <Badge variant="outline" className={cn("text-[8px] font-mono h-4", pressureColor)}>
          {orderBook.imbalance > 0 ? '+' : ''}{orderBook.imbalance.toFixed(1)}%
        </Badge>
      </div>

      <div className="px-2 py-1 grid grid-cols-3 text-[8px] text-muted-foreground font-mono uppercase border-b border-border/30">
        <span>Price</span>
        <span className="text-right">Qty</span>
        <span className="text-right">Total</span>
      </div>

      <ScrollArea className="flex-1">
        <div>
          {displayAsks.map((ask, i) => (
            <div key={`ask-${i}`} className="relative px-2 py-[3px] grid grid-cols-3 text-[10px] font-mono hover:bg-red-500/5 group" data-testid={`orderbook-ask-${i}`}>
              <div className="absolute right-0 top-0 bottom-0 bg-red-500/8 transition-all" style={{ width: `${(ask.total / maxTotal) * 100}%` }} />
              <span className="text-red-400 relative z-10">{formatPrice(ask.price)}</span>
              <span className="text-right text-muted-foreground relative z-10">{formatQty(ask.quantity)}</span>
              <span className="text-right text-muted-foreground/70 relative z-10">{formatUSD(ask.total)}</span>
            </div>
          ))}

          <div className="px-2 py-1.5 flex items-center justify-between bg-gradient-to-r from-green-500/10 via-transparent to-red-500/10 border-y border-border/30">
            <span className="text-xs font-bold font-mono text-foreground">{currentPrice ? `$${formatPrice(currentPrice)}` : '--'}</span>
            <div className="flex items-center gap-2">
              <span className="text-[8px] text-muted-foreground">Spread:</span>
              <span className="text-[9px] font-mono font-bold text-primary">${formatPrice(orderBook.spread)} ({orderBook.spreadPercent.toFixed(3)}%)</span>
            </div>
          </div>

          {displayBids.map((bid, i) => (
            <div key={`bid-${i}`} className="relative px-2 py-[3px] grid grid-cols-3 text-[10px] font-mono hover:bg-green-500/5 group" data-testid={`orderbook-bid-${i}`}>
              <div className="absolute right-0 top-0 bottom-0 bg-green-500/8 transition-all" style={{ width: `${(bid.total / maxTotal) * 100}%` }} />
              <span className="text-green-400 relative z-10">{formatPrice(bid.price)}</span>
              <span className="text-right text-muted-foreground relative z-10">{formatQty(bid.quantity)}</span>
              <span className="text-right text-muted-foreground/70 relative z-10">{formatUSD(bid.total)}</span>
            </div>
          ))}
        </div>
      </ScrollArea>

      <div className="p-2 border-t border-border/50 bg-muted/5">
        <div className="grid grid-cols-2 gap-2">
          <div className="text-center">
            <div className="text-[8px] text-muted-foreground uppercase mb-0.5">Buy Volume</div>
            <div className="text-[10px] font-mono font-bold text-green-500">{formatUSD(orderBook.bidTotal)}</div>
          </div>
          <div className="text-center">
            <div className="text-[8px] text-muted-foreground uppercase mb-0.5">Sell Volume</div>
            <div className="text-[10px] font-mono font-bold text-red-500">{formatUSD(orderBook.askTotal)}</div>
          </div>
        </div>
        <div className="mt-1.5 h-2 bg-muted rounded-full overflow-hidden flex">
          <div className="bg-green-500/70 h-full transition-all" style={{ width: `${(orderBook.bidTotal / (orderBook.bidTotal + orderBook.askTotal)) * 100}%` }} />
          <div className="bg-red-500/70 h-full transition-all" style={{ width: `${(orderBook.askTotal / (orderBook.bidTotal + orderBook.askTotal)) * 100}%` }} />
        </div>
      </div>
    </div>
  );
}
