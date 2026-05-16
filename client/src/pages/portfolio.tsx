import { useEffect, useState, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Sidebar } from '@/components/layout/Sidebar';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  PieChart,
  Wallet,
  ArrowUpRight,
  ArrowDownRight,
  History,
  Download,
  Loader2,
  Plus,
  DollarSign,
  TrendingUp,
  BarChart3,
  Shield,
  Activity,
} from 'lucide-react';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, ReferenceLine,
} from 'recharts';
import { fetch24hTicker } from '@/lib/binance';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { Position } from '@shared/schema';

export default function Portfolio() {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [pricesLoading, setPricesLoading] = useState(true);
  const [depositOpen, setDepositOpen] = useState(false);
  const [depositAmount, setDepositAmount] = useState('');

  const { data: positions = [], isLoading: positionsLoading } = useQuery<Position[]>({
    queryKey: ['/api/positions'],
  });

  const { data: walletData, isLoading: walletLoading } = useQuery<any>({
    queryKey: ['/api/wallet'],
  });

  const closePositionMutation = useMutation({
    mutationFn: async ({ id, pnl }: { id: string; pnl: number }) => {
      await apiRequest('PATCH', `/api/positions/${id}/close`, { pnl });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/positions'] });
      toast({ title: 'Position closed', description: 'Your position has been closed successfully.' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const depositMutation = useMutation({
    mutationFn: async (amount: number) => {
      const res = await apiRequest('POST', '/api/wallet/deposit', { amount });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/wallet'] });
      toast({ title: 'Deposit successful', description: `$${depositAmount} has been added to your wallet.` });
      setDepositOpen(false);
      setDepositAmount('');
    },
    onError: (error: Error) => {
      toast({ title: 'Deposit failed', description: error.message, variant: 'destructive' });
    },
  });

  useEffect(() => {
    const loadPrices = async () => {
      try {
        const tickers = await fetch24hTicker();
        const priceMap: Record<string, number> = {};
        tickers.forEach(t => {
          priceMap[t.symbol] = parseFloat(t.lastPrice);
        });
        setPrices(priceMap);
        setPricesLoading(false);
      } catch (e) { console.error(e); }
    };
    loadPrices();
    const interval = setInterval(loadPrices, 15000);
    return () => clearInterval(interval);
  }, []);

  const isLoading = positionsLoading || pricesLoading;

  const calculatePnL = (position: Position) => {
    const currentPrice = prices[position.symbol];
    if (!currentPrice) return 0;
    
    const diff = position.type === 'LONG' 
      ? currentPrice - position.entryPrice 
      : position.entryPrice - currentPrice;
      
    return diff * position.amount * position.leverage;
  };

  const totalPnL = positions.reduce((acc, p) => acc + calculatePnL(p), 0);
  const totalBalance = (walletData?.balance || 0) + totalPnL;

  const closedPositions = positions.filter(p => p.pnl !== null);
  const winningTrades = closedPositions.filter(p => (p.pnl ?? 0) > 0).length;
  const winRate = closedPositions.length > 0 ? (winningTrades / closedPositions.length) * 100 : 0;

  const advancedMetrics = useMemo(() => {
    if (closedPositions.length === 0) return { profitFactor: 0, maxDrawdown: 0, avgWin: 0, avgLoss: 0 };
    const wins = closedPositions.filter(p => (p.pnl ?? 0) > 0);
    const losses = closedPositions.filter(p => (p.pnl ?? 0) < 0);
    const grossProfit = wins.reduce((s, p) => s + (p.pnl ?? 0), 0);
    const grossLoss = Math.abs(losses.reduce((s, p) => s + (p.pnl ?? 0), 0));
    const sorted = [...closedPositions].sort(
      (a, b) => new Date(a.closedAt!).getTime() - new Date(b.closedAt!).getTime()
    );
    let cum = 0, peak = 0, maxDD = 0;
    for (const p of sorted) {
      cum += p.pnl ?? 0;
      if (cum > peak) peak = cum;
      const dd = peak > 0 ? (peak - cum) / peak * 100 : 0;
      if (dd > maxDD) maxDD = dd;
    }
    return {
      profitFactor: grossLoss > 0 ? grossProfit / grossLoss : 0,
      maxDrawdown: maxDD,
      avgWin: wins.length > 0 ? grossProfit / wins.length : 0,
      avgLoss: losses.length > 0 ? grossLoss / losses.length : 0,
    };
  }, [closedPositions]);

  const equityCurve = useMemo(() => {
    const base = walletData?.balance || 10000;
    const sorted = [...closedPositions].sort(
      (a, b) => new Date(a.closedAt!).getTime() - new Date(b.closedAt!).getTime()
    );
    let cum = 0;
    return [
      { date: 'Start', equity: base },
      ...sorted.map(p => {
        cum += p.pnl ?? 0;
        return { date: new Date(p.closedAt!).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }), equity: base + cum };
      }),
    ];
  }, [closedPositions, walletData]);

  const handleClose = (position: Position) => {
    const pnl = calculatePnL(position);
    closePositionMutation.mutate({ id: position.id, pnl });
  };

  const handleDeposit = () => {
    const amount = parseFloat(depositAmount);
    if (isNaN(amount) || amount <= 0) {
      toast({ title: 'Invalid amount', description: 'Please enter a valid positive number.', variant: 'destructive' });
      return;
    }
    depositMutation.mutate(amount);
  };

  return (
    <div className="min-h-screen bg-background text-foreground font-sans flex">
      <Sidebar />
      <div className="flex-1 md:pl-64">
        <div className="p-8 space-y-8">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-display font-bold text-primary mb-2">Portfolio Overview</h1>
              <p className="text-muted-foreground">Track your performance and asset allocation.</p>
            </div>
            <div className="flex gap-2">
              <Button className="gap-2" onClick={() => setDepositOpen(true)} data-testid="button-deposit">
                <Plus className="w-4 h-4" /> Deposit
              </Button>
              <Button variant="outline" className="gap-2" data-testid="button-download-report">
                <Download className="w-4 h-4" /> Report
              </Button>
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <Card className="bg-card border-border col-span-2 md:col-span-1" data-testid="card-total-balance">
               <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Total Balance</CardTitle>
                  <Wallet className="h-4 w-4 text-primary" />
               </CardHeader>
               <CardContent>
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                    <div className="text-2xl font-bold font-mono" data-testid="text-total-balance">${totalBalance.toLocaleString(undefined, { maximumFractionDigits: 2 })}</div>
                  )}
                  <p className="text-xs text-muted-foreground mt-1">
                    Wallet: ${(walletData?.balance || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </p>
               </CardContent>
            </Card>
            <Card className="bg-card border-border" data-testid="card-unrealized-pnl">
               <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Unrealized PnL</CardTitle>
                  <Activity className="h-4 w-4 text-primary" />
               </CardHeader>
               <CardContent>
                  {isLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : (
                    <div className={`text-2xl font-bold font-mono ${totalPnL >= 0 ? 'text-green-500' : 'text-red-500'}`} data-testid="text-unrealized-pnl">
                        {totalPnL >= 0 ? '+' : ''}${totalPnL.toLocaleString(undefined, { maximumFractionDigits: 2 })}
                    </div>
                  )}
                  <p className="text-xs text-muted-foreground mt-1" data-testid="text-positions-count">
                     {positions.length} open positions
                  </p>
               </CardContent>
            </Card>
            <Card className="bg-card border-border" data-testid="card-win-rate">
               <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Win Rate</CardTitle>
                  <History className="h-4 w-4 text-primary" />
               </CardHeader>
               <CardContent>
                  <div className="text-2xl font-bold font-mono" data-testid="text-win-rate">{winRate.toFixed(1)}%</div>
                  <Progress value={winRate} className="h-2 mt-2" />
                  <p className="text-xs text-muted-foreground mt-1">{closedPositions.length} closed trades</p>
               </CardContent>
            </Card>
            <Card className="bg-card border-border">
               <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Profit Factor</CardTitle>
                  <BarChart3 className="h-4 w-4 text-green-500" />
               </CardHeader>
               <CardContent>
                  <div className={cn('text-2xl font-bold font-mono', advancedMetrics.profitFactor >= 1.5 ? 'text-green-500' : advancedMetrics.profitFactor >= 1 ? 'text-yellow-500' : 'text-red-500')}>
                    {advancedMetrics.profitFactor.toFixed(2)}
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Gross profit / loss</p>
               </CardContent>
            </Card>
            <Card className="bg-card border-border">
               <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Max Drawdown</CardTitle>
                  <Shield className="h-4 w-4 text-orange-500" />
               </CardHeader>
               <CardContent>
                  <div className={cn('text-2xl font-bold font-mono', advancedMetrics.maxDrawdown < 10 ? 'text-green-500' : advancedMetrics.maxDrawdown < 20 ? 'text-yellow-500' : 'text-red-500')}>
                    {advancedMetrics.maxDrawdown.toFixed(1)}%
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Peak-to-trough</p>
               </CardContent>
            </Card>
            <Card className="bg-card border-border">
               <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">Avg Win / Loss</CardTitle>
                  <TrendingUp className="h-4 w-4 text-blue-500" />
               </CardHeader>
               <CardContent>
                  <div className="text-lg font-bold font-mono">
                    <span className="text-green-500">${advancedMetrics.avgWin.toFixed(0)}</span>
                    <span className="text-muted-foreground mx-1">/</span>
                    <span className="text-red-500">${advancedMetrics.avgLoss.toFixed(0)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground mt-1">Per trade average</p>
               </CardContent>
            </Card>
          </div>

          {/* Equity Curve */}
          {equityCurve.length > 1 && (
            <Card className="bg-card border-border">
              <CardHeader className="pb-2">
                <div className="flex items-center gap-2">
                  <TrendingUp className="h-4 w-4 text-primary" />
                  <CardTitle className="text-sm font-medium">Equity Curve</CardTitle>
                  <Badge variant="outline" className={cn('text-[10px] ml-auto', totalPnL >= 0 ? 'text-green-600 border-green-200 bg-green-50' : 'text-red-500 border-red-200 bg-red-50')}>
                    {totalPnL >= 0 ? '+' : ''}${totalPnL.toFixed(2)} realized
                  </Badge>
                </div>
              </CardHeader>
              <CardContent>
                <div className="h-40">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={equityCurve} margin={{ left: -10, right: 10, top: 5, bottom: 5 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="rgba(148,163,184,0.1)" />
                      <XAxis dataKey="date" tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 9, fill: '#94a3b8' }} axisLine={false} tickLine={false}
                        tickFormatter={v => `$${(v / 1000).toFixed(1)}k`} />
                      <Tooltip formatter={(v: any) => [`$${parseFloat(v).toLocaleString(undefined, { maximumFractionDigits: 2 })}`, 'Equity']}
                        labelStyle={{ fontSize: '11px' }} contentStyle={{ fontSize: '11px', border: '1px solid #e2e8f0', borderRadius: '8px' }} />
                      <ReferenceLine y={walletData?.balance || 10000} stroke="#94a3b8" strokeDasharray="4 4" />
                      <Line type="monotone" dataKey="equity" stroke={totalPnL >= 0 ? '#10b981' : '#ef4444'}
                        strokeWidth={2} dot={false} activeDot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
             <div className="lg:col-span-2 bg-card border border-border rounded-lg overflow-hidden" data-testid="table-open-positions">
                <div className="p-4 border-b border-border flex justify-between items-center">
                   <h3 className="font-display font-bold">Open Positions</h3>
                </div>
                {positionsLoading ? (
                  <div className="flex items-center justify-center p-12">
                    <Loader2 className="h-8 w-8 animate-spin text-primary" />
                  </div>
                ) : positions.length === 0 ? (
                  <div className="flex items-center justify-center p-12 text-muted-foreground">
                    No open positions
                  </div>
                ) : (
                <table className="w-full text-sm">
                   <thead className="bg-muted/30 text-muted-foreground">
                      <tr>
                         <th className="px-4 py-3 text-left font-medium">Asset</th>
                         <th className="px-4 py-3 text-right font-medium">Size</th>
                         <th className="px-4 py-3 text-right font-medium">Entry</th>
                         <th className="px-4 py-3 text-right font-medium">Mark</th>
                         <th className="px-4 py-3 text-right font-medium">PnL</th>
                         <th className="px-4 py-3 text-right font-medium">Action</th>
                      </tr>
                   </thead>
                   <tbody className="divide-y divide-border/50">
                      {positions.map((p) => {
                          const pnl = calculatePnL(p);
                          const currentPrice = prices[p.symbol] || 0;
                          return (
                            <tr key={p.id} data-testid={`row-position-${p.id}`}>
                                <td className="px-4 py-4">
                                    <div className="font-bold" data-testid={`text-symbol-${p.id}`}>{p.symbol.replace('USDT', '')}/USDT</div>
                                    <div className={`text-xs ${p.type === 'LONG' ? 'text-green-500' : 'text-red-500'}`}>
                                        {p.type} {p.leverage}x
                                    </div>
                                </td>
                                <td className="px-4 py-4 text-right font-mono">{p.amount}</td>
                                <td className="px-4 py-4 text-right font-mono">${p.entryPrice.toLocaleString()}</td>
                                <td className="px-4 py-4 text-right font-mono" data-testid={`text-mark-price-${p.id}`}>
                                    {pricesLoading ? '...' : `$${currentPrice.toLocaleString()}`}
                                </td>
                                <td className={`px-4 py-4 text-right font-mono ${pnl >= 0 ? 'text-green-500' : 'text-red-500'}`} data-testid={`text-pnl-${p.id}`}>
                                    {pricesLoading ? '...' : `${pnl >= 0 ? '+' : ''}$${pnl.toLocaleString(undefined, { maximumFractionDigits: 2 })}`}
                                </td>
                                <td className="px-4 py-4 text-right">
                                    <Button
                                      size="sm"
                                      variant="destructive"
                                      onClick={() => handleClose(p)}
                                      disabled={closePositionMutation.isPending}
                                      data-testid={`button-close-position-${p.id}`}
                                    >
                                      {closePositionMutation.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : 'Close'}
                                    </Button>
                                </td>
                            </tr>
                          );
                      })}
                   </tbody>
                </table>
                )}
             </div>

             <div className="bg-card border border-border rounded-lg p-6" data-testid="card-allocation">
                <h3 className="font-display font-bold mb-4">Allocation</h3>
                <div className="space-y-4">
                   <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                         <span>USDT (Cash)</span>
                         <span className="font-mono">45%</span>
                      </div>
                      <Progress value={45} className="h-2 bg-muted [&>div]:bg-green-500" />
                   </div>
                   <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                         <span>BTC</span>
                         <span className="font-mono">30%</span>
                      </div>
                      <Progress value={30} className="h-2 bg-muted [&>div]:bg-orange-500" />
                   </div>
                   <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                         <span>ETH</span>
                         <span className="font-mono">15%</span>
                      </div>
                      <Progress value={15} className="h-2 bg-muted [&>div]:bg-blue-500" />
                   </div>
                   <div className="space-y-2">
                      <div className="flex justify-between text-sm">
                         <span>Alts</span>
                         <span className="font-mono">10%</span>
                      </div>
                      <Progress value={10} className="h-2 bg-muted [&>div]:bg-purple-500" />
                   </div>
                </div>
             </div>
          </div>
        </div>
      </div>

      <Dialog open={depositOpen} onOpenChange={setDepositOpen}>
        <DialogContent className="sm:max-w-sm bg-card border-border" data-testid="dialog-deposit">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-primary" />
              Deposit Funds
            </DialogTitle>
            <DialogDescription>
              Add funds to your trading wallet.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="text-sm text-muted-foreground">
              Current Balance: <span className="font-mono font-bold text-foreground">${(walletData?.balance || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}</span>
            </div>
            <div className="space-y-2">
              <Label htmlFor="deposit-amount">Amount (USD)</Label>
              <Input
                id="deposit-amount"
                data-testid="input-deposit-amount"
                type="number"
                min="0"
                step="0.01"
                placeholder="Enter amount"
                value={depositAmount}
                onChange={(e) => setDepositAmount(e.target.value)}
                className="bg-muted/20 font-mono"
              />
            </div>
            <div className="flex gap-2">
              {[100, 500, 1000, 5000].map(amt => (
                <Button
                  key={amt}
                  variant="outline"
                  size="sm"
                  className="flex-1 text-xs font-mono"
                  onClick={() => setDepositAmount(String(amt))}
                  data-testid={`button-preset-${amt}`}
                >
                  ${amt.toLocaleString()}
                </Button>
              ))}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDepositOpen(false)} data-testid="button-cancel-deposit">Cancel</Button>
            <Button
              onClick={handleDeposit}
              disabled={depositMutation.isPending || !depositAmount}
              data-testid="button-confirm-deposit"
            >
              {depositMutation.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : null}
              Deposit
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
