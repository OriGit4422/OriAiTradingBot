import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Label } from '@/components/ui/label';
import { Slider } from '@/components/ui/slider';
import { Separator } from '@/components/ui/separator';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { toast } from '@/hooks/use-toast';
import { Loader2, Wallet } from 'lucide-react';

export function TradeEntry({ symbol, price }: { symbol: string, price: number }) {
  const [leverage, setLeverage] = useState([20]);
  const [amount, setAmount] = useState('');
  const [limitPrice, setLimitPrice] = useState('');
  const [tp, setTp] = useState('');
  const [sl, setSl] = useState('');
  const [loading, setLoading] = useState(false);

  const { data: walletData } = useQuery<any>({
    queryKey: ['/api/wallet'],
  });

  const handleTrade = async (type: 'LONG' | 'SHORT') => {
    const qty = parseFloat(amount);
    if (!qty || qty <= 0) {
      toast({ title: 'Enter a valid amount', variant: 'destructive' });
      return;
    }

    setLoading(true);
    try {
      const entryPrice = limitPrice && !isNaN(parseFloat(limitPrice)) ? parseFloat(limitPrice) : price;
      if (!entryPrice || entryPrice <= 0) {
        toast({ title: 'Invalid price', variant: 'destructive' });
        setLoading(false);
        return;
      }
      await apiRequest('POST', '/api/positions', {
        symbol: `${symbol}USDT`,
        amount: qty,
        entryPrice,
        type,
        leverage: leverage[0],
        status: 'open',
      });
      queryClient.invalidateQueries({ queryKey: ['/api/positions'] });
      toast({ title: `${type} position opened`, description: `${qty} ${symbol} at $${entryPrice.toLocaleString()}` });
      setAmount('');
      setLimitPrice('');
      setTp('');
      setSl('');
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="h-full flex flex-col p-4">
      <div className="mb-4">
        <h3 className="font-display font-semibold text-lg mb-1">Trade {symbol}</h3>
        <p className="text-xs text-muted-foreground font-mono">Mark: ${price.toLocaleString()}</p>
      </div>

      <Tabs defaultValue="limit" className="w-full">
        <TabsList className="grid w-full grid-cols-2 mb-4 bg-muted/30">
          <TabsTrigger value="limit" data-testid="tab-limit">Limit</TabsTrigger>
          <TabsTrigger value="market" data-testid="tab-market">Market</TabsTrigger>
        </TabsList>

        <div className="space-y-4">
          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Leverage {leverage}x</Label>
            <Slider 
              value={leverage} 
              onValueChange={setLeverage} 
              max={100} 
              step={1} 
              className="[&>.relative>.absolute]:bg-primary"
              data-testid="slider-leverage"
            />
          </div>

          <div className="space-y-2">
            <Label className="text-xs text-muted-foreground">Price (USDT)</Label>
            <Input
              className="font-mono bg-muted/20 border-border"
              value={limitPrice}
              onChange={(e) => setLimitPrice(e.target.value)}
              placeholder={price.toString()}
              data-testid="input-price"
            />
          </div>

          <div className="space-y-2">
             <Label className="text-xs text-muted-foreground">Amount ({symbol})</Label>
             <Input
               className="font-mono bg-muted/20 border-border"
               value={amount}
               onChange={(e) => setAmount(e.target.value)}
               placeholder="0.00"
               data-testid="input-amount"
             />
          </div>

          <div className="grid grid-cols-2 gap-2 pt-2">
             <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Take Profit</Label>
                <Input
                  className="h-8 text-xs font-mono bg-green-500/5 border-green-500/20 text-green-500"
                  value={tp}
                  onChange={(e) => setTp(e.target.value)}
                  placeholder="Target"
                  data-testid="input-tp"
                />
             </div>
             <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Stop Loss</Label>
                <Input
                  className="h-8 text-xs font-mono bg-red-500/5 border-red-500/20 text-red-500"
                  value={sl}
                  onChange={(e) => setSl(e.target.value)}
                  placeholder="Stop"
                  data-testid="input-sl"
                />
             </div>
          </div>

          <div className="grid grid-cols-2 gap-3 pt-4">
            <Button
              className="bg-green-500 hover:bg-green-600 text-white font-bold"
              onClick={() => handleTrade('LONG')}
              disabled={loading}
              data-testid="button-long"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Long'}
            </Button>
            <Button
              className="bg-red-500 hover:bg-red-600 text-white font-bold"
              onClick={() => handleTrade('SHORT')}
              disabled={loading}
              data-testid="button-short"
            >
              {loading ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Short'}
            </Button>
          </div>
        </div>
      </Tabs>
      
      <Separator className="my-6" />
      
      <div className="space-y-2">
         <div className="flex justify-between text-xs">
            <span className="text-muted-foreground flex items-center gap-1">
              <Wallet className="w-3 h-3" /> Avail Bal
            </span>
            <span className="font-mono font-bold text-primary">
              ${walletData?.balance?.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) || '0.00'}
            </span>
         </div>
         <Button 
           variant="outline" 
           size="sm" 
           className="w-full h-7 text-[10px] mt-2 border-primary/20 hover:bg-primary/5"
           onClick={async () => {
             await apiRequest('POST', '/api/wallet/deposit', { amount: 1000 });
             queryClient.invalidateQueries({ queryKey: ['/api/wallet'] });
             toast({ title: 'Deposit Successful', description: '$1,000.00 added to demo wallet' });
           }}
         >
           + $1,000 Demo Deposit
         </Button>
      </div>
    </div>
  );
}
