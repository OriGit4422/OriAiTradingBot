import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { toast } from '@/hooks/use-toast';
import { Sidebar } from '@/components/layout/Sidebar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Progress } from '@/components/ui/progress';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Play, Pause, Settings2, BarChart3, AlertTriangle, Trash2, Bot, RefreshCw, StopCircle, Activity, CheckCircle2, XCircle, Shield } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { Strategy } from '@shared/schema';

export default function Strategies() {
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState('');
  const [newDescription, setNewDescription] = useState('');
  const [newRisk, setNewRisk] = useState('Medium');
  const [newPairs, setNewPairs] = useState('');

  const { data: strategies = [], isLoading } = useQuery<Strategy[]>({
    queryKey: ['/api/strategies'],
  });

  const toggleMutation = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: string }) => {
      await apiRequest('PATCH', `/api/strategies/${id}`, { status });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/strategies'] });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const createMutation = useMutation({
    mutationFn: async (data: { name: string; description: string; risk: string; pairs: string[] }) => {
      await apiRequest('POST', '/api/strategies', data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/strategies'] });
      setCreateOpen(false);
      setNewName('');
      setNewDescription('');
      setNewRisk('Medium');
      setNewPairs('');
      toast({ title: 'Strategy created' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/strategies/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/strategies'] });
      toast({ title: 'Strategy deleted' });
    },
    onError: (error: Error) => {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    },
  });

  const handleStartAll = async () => {
    const pausedStrategies = strategies.filter(s => s.status !== 'active');
    if (pausedStrategies.length === 0) {
      toast({ title: 'All strategies are already active' });
      return;
    }
    try {
      await Promise.all(
        pausedStrategies.map(s => apiRequest('PATCH', `/api/strategies/${s.id}`, { status: 'active' }))
      );
      queryClient.invalidateQueries({ queryKey: ['/api/strategies'] });
      toast({ title: 'All strategies activated' });
    } catch (error: any) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    }
  };

  const handleCreate = () => {
    if (!newName.trim()) return;
    const pairs = newPairs.split(',').map(p => p.trim()).filter(Boolean);
    createMutation.mutate({
      name: newName.trim(),
      description: newDescription.trim(),
      risk: newRisk,
      pairs,
    });
  };

  const { data: botState } = useQuery<any>({
    queryKey: ['/api/bot/state'],
    refetchInterval: 10000,
  });

  const [reconcileResult, setReconcileResult] = useState<any>(null);
  const [reconciling, setReconciling] = useState(false);

  const handleBotControl = async (action: string) => {
    try {
      const res = await apiRequest('POST', '/api/bot/control', { action });
      const data = await res.json();
      if (data.ok) {
        queryClient.invalidateQueries({ queryKey: ['/api/bot/state'] });
        toast({ title: `Bot ${action}`, description: `Bot ${action} successful` });
      } else {
        toast({ title: 'Error', description: data.message, variant: 'destructive' });
      }
    } catch (e: any) {
      toast({ title: 'Error', description: e.message, variant: 'destructive' });
    }
  };

  const handleReconcile = async () => {
    setReconciling(true);
    try {
      const res = await apiRequest('POST', '/api/bot/reconcile', {});
      const data = await res.json();
      setReconcileResult(data);
      if (data.ok && data.divergences?.length === 0) {
        toast({ title: 'Reconciliation Complete', description: 'All positions in sync ✓' });
      } else if (data.divergences?.length > 0) {
        toast({ title: `${data.divergences.length} Divergence(s) Found`, description: 'Review reconciliation results', variant: 'destructive' });
      }
    } catch (e: any) {
      toast({ title: 'Reconciliation Failed', description: e.message, variant: 'destructive' });
    } finally {
      setReconciling(false);
    }
  };

  const botEff = botState?.effectiveState;
  const botMetrics = botState?.metrics;

  return (
    <div className="min-h-screen bg-background text-foreground font-sans flex">
      <Sidebar />
      <div className="flex-1 md:pl-64">
        <div className="p-8 space-y-8">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-display font-bold text-primary mb-2">Algorithmic Strategies</h1>
              <p className="text-muted-foreground">Manage and monitor your automated trading bots.</p>
            </div>
            <Button className="gap-2" data-testid="button-start-all" onClick={handleStartAll}>
              <Play className="w-4 h-4" /> Start All
            </Button>
          </div>

          {/* AI Bot Engine Control Panel */}
          <Card className={cn("border", botEff === 'active' ? "border-green-500/30 bg-green-500/[0.02]" : botEff === 'locked' ? "border-red-500/30 bg-red-500/[0.02]" : "border-border")}>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2">
                <Bot className="w-5 h-5 text-primary" />
                AI Auto-Trading Bot
                <Badge className={cn("ml-2 text-[10px]",
                  botEff === 'active' ? "bg-green-500/10 text-green-500 border-green-500/30" :
                  botEff === 'locked' ? "bg-red-500/10 text-red-500 border-red-500/30" :
                  botEff === 'paused' ? "bg-yellow-500/10 text-yellow-500 border-yellow-500/30" :
                  "bg-muted/50 text-muted-foreground"
                )}>
                  {botEff?.toUpperCase() || 'LOADING'}
                </Badge>
                {botState?.settings?.mode && (
                  <Badge variant="outline" className="text-[10px]">{botState.settings.mode.toUpperCase()} MODE</Badge>
                )}
              </CardTitle>
              <CardDescription>AI-driven signal execution with multi-agent validation gate</CardDescription>
            </CardHeader>
            <CardContent>
              {botMetrics && (
                <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-4">
                  <div className="bg-muted/20 rounded-lg p-3 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase mb-1">Open Trades</div>
                    <div className="text-xl font-bold font-mono">{botMetrics.openTrades}</div>
                  </div>
                  <div className="bg-muted/20 rounded-lg p-3 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase mb-1">Trades Today</div>
                    <div className="text-xl font-bold font-mono">{botMetrics.tradesToday}</div>
                  </div>
                  <div className="bg-muted/20 rounded-lg p-3 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase mb-1">Daily P&L</div>
                    <div className={cn("text-xl font-bold font-mono", botMetrics.dailyPnl >= 0 ? "text-green-500" : "text-red-500")}>
                      {botMetrics.dailyPnl >= 0 ? '+' : ''}{botMetrics.dailyPnl.toFixed(2)}
                    </div>
                  </div>
                  <div className="bg-muted/20 rounded-lg p-3 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase mb-1">Margin Used</div>
                    <div className="text-xl font-bold font-mono">${botMetrics.marginInUse.toFixed(2)}</div>
                  </div>
                  <div className="bg-muted/20 rounded-lg p-3 text-center">
                    <div className="text-[10px] text-muted-foreground uppercase mb-1">Daily Loss %</div>
                    <div className={cn("text-xl font-bold font-mono", botMetrics.dailyLossUsedPct > 75 ? "text-red-500" : botMetrics.dailyLossUsedPct > 50 ? "text-yellow-500" : "text-foreground")}>
                      {botMetrics.dailyLossUsedPct.toFixed(1)}%
                    </div>
                  </div>
                </div>
              )}

              {botState?.blockReasons?.length > 0 && (
                <div className="mb-4 p-3 rounded-lg bg-yellow-500/10 border border-yellow-500/20">
                  <div className="flex items-center gap-2 mb-1">
                    <AlertTriangle className="w-4 h-4 text-yellow-500" />
                    <span className="text-xs font-semibold text-yellow-500">Block Reasons</span>
                  </div>
                  {botState.blockReasons.map((r: string, i: number) => (
                    <div key={i} className="text-xs text-muted-foreground">• {r}</div>
                  ))}
                </div>
              )}

              <div className="flex flex-wrap gap-2">
                <Button size="sm" variant="default" disabled={botEff === 'active'} onClick={() => handleBotControl('start')} className="gap-1">
                  <Play className="w-3 h-3" /> Start
                </Button>
                <Button size="sm" variant="outline" disabled={botEff === 'paused'} onClick={() => handleBotControl('pause')} className="gap-1">
                  <Pause className="w-3 h-3" /> Pause
                </Button>
                <Button size="sm" variant="destructive" onClick={() => handleBotControl('emergency-stop')} className="gap-1">
                  <StopCircle className="w-3 h-3" /> Emergency Stop
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleReconcile}
                  disabled={reconciling || botState?.settings?.mode === 'paper'}
                  className="gap-1"
                  title={botState?.settings?.mode === 'paper' ? 'Not needed in paper mode' : 'Sync DB trades with exchange positions'}
                >
                  <RefreshCw className={cn("w-3 h-3", reconciling && "animate-spin")} />
                  Reconcile Positions
                </Button>
              </div>

              {reconcileResult && (
                <div className={cn("mt-3 p-3 rounded-lg border text-xs", reconcileResult.divergences?.length === 0 ? "bg-green-500/5 border-green-500/20" : "bg-red-500/5 border-red-500/20")}>
                  <div className="flex items-center gap-2 mb-1">
                    {reconcileResult.divergences?.length === 0
                      ? <><CheckCircle2 className="w-3.5 h-3.5 text-green-500" /><span className="font-semibold text-green-500">All positions in sync</span></>
                      : <><XCircle className="w-3.5 h-3.5 text-red-500" /><span className="font-semibold text-red-500">{reconcileResult.divergences?.length} divergence(s)</span></>
                    }
                  </div>
                  {reconcileResult.divergences?.map((d: any, i: number) => (
                    <div key={i} className="text-muted-foreground mt-0.5">• {d.message}</div>
                  ))}
                  {reconcileResult.mode === 'paper' && <div className="text-muted-foreground">Paper mode — reconciliation not applicable</div>}
                </div>
              )}

              {botState?.liveReadiness && !botState.liveReadiness.unlocked && (
                <div className="mt-3 flex items-center gap-2 text-[11px] text-muted-foreground">
                  <Shield className="w-3.5 h-3.5 text-primary" />
                  Live trading locked: {botState.liveReadiness.paperTradeCount}/{botState.liveReadiness.paperTradesRequired} paper trades completed
                </div>
              )}
            </CardContent>
          </Card>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6" data-testid="strategies-loading">
              {[1, 2, 3].map(i => (
                <Card key={i} className="border-border bg-card">
                  <CardHeader className="pb-2">
                    <Skeleton className="h-6 w-40" />
                    <Skeleton className="h-4 w-24 mt-1" />
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <Skeleton className="h-10 w-full" />
                    <Skeleton className="h-2 w-full" />
                    <div className="grid grid-cols-2 gap-4">
                      <Skeleton className="h-16 w-full" />
                      <Skeleton className="h-16 w-full" />
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
              {strategies.map((strategy) => (
                <Card key={strategy.id} className="border-border bg-card hover:border-primary/50 transition-all" data-testid={`card-strategy-${strategy.id}`}>
                  <CardHeader className="flex flex-row items-start justify-between pb-2">
                    <div className="space-y-1">
                      <CardTitle className="text-xl font-display" data-testid={`text-strategy-name-${strategy.id}`}>{strategy.name}</CardTitle>
                      <CardDescription className="text-xs">{strategy.id}</CardDescription>
                    </div>
                    <div className="flex items-center gap-2">
                      <Switch
                        checked={strategy.status === 'active'}
                        onCheckedChange={(checked) =>
                          toggleMutation.mutate({ id: strategy.id, status: checked ? 'active' : 'paused' })
                        }
                        data-testid={`switch-strategy-${strategy.id}`}
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                        onClick={() => deleteMutation.mutate(strategy.id)}
                        data-testid={`button-delete-strategy-${strategy.id}`}
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <p className="text-sm text-muted-foreground min-h-[40px]">
                      {strategy.description}
                    </p>

                    <div className="space-y-3 pt-2">
                      <div className="flex justify-between text-sm">
                        <span className="text-muted-foreground">Win Rate</span>
                        <span className="font-mono font-bold text-green-500" data-testid={`text-winrate-${strategy.id}`}>{strategy.winRate}%</span>
                      </div>
                      <Progress value={strategy.winRate} className="h-2" />

                      <div className="grid grid-cols-2 gap-4 pt-2">
                        <div className="bg-muted/30 p-2 rounded">
                          <div className="text-xs text-muted-foreground">Total PnL</div>
                          <div className="text-lg font-mono font-bold text-primary" data-testid={`text-pnl-${strategy.id}`}>
                            {(strategy.totalPnl ?? 0) >= 0 ? '+' : ''}${(strategy.totalPnl ?? 0).toLocaleString()}
                          </div>
                        </div>
                        <div className="bg-muted/30 p-2 rounded">
                          <div className="text-xs text-muted-foreground">Risk Level</div>
                          <div className="flex items-center gap-1 font-medium text-sm mt-1">
                            <AlertTriangle className="w-3 h-3 text-yellow-500" />
                            {strategy.risk}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-1 pt-2">
                      {(strategy.pairs ?? []).map(pair => (
                        <Badge key={pair} variant="outline" className="text-[10px] font-mono border-primary/20 bg-primary/5">
                          {pair}
                        </Badge>
                      ))}
                    </div>

                    <div className="flex gap-2 pt-2">
                      <Button variant="outline" className="flex-1 gap-2 text-xs" data-testid={`button-config-${strategy.id}`}>
                        <Settings2 className="w-3 h-3" /> Config
                      </Button>
                      <Button variant="outline" className="flex-1 gap-2 text-xs" data-testid={`button-backtest-${strategy.id}`}>
                        <BarChart3 className="w-3 h-3" /> Backtest
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              ))}

              <Card
                className="border-border border-dashed bg-transparent hover:bg-muted/10 transition-colors flex items-center justify-center cursor-pointer min-h-[300px]"
                onClick={() => setCreateOpen(true)}
                data-testid="card-create-strategy"
              >
                <div className="text-center space-y-2">
                  <div className="w-12 h-12 rounded-full bg-muted flex items-center justify-center mx-auto">
                    <Play className="w-6 h-6 text-muted-foreground ml-1" />
                  </div>
                  <h3 className="font-medium text-lg">Create Strategy</h3>
                  <p className="text-sm text-muted-foreground">Design a new algorithm</p>
                </div>
              </Card>
            </div>
          )}
        </div>
      </div>

      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Strategy</DialogTitle>
            <DialogDescription>Configure a new automated trading strategy.</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="strategy-name">Name</Label>
              <Input
                id="strategy-name"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Smart Money Concepts"
                data-testid="input-strategy-name"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="strategy-description">Description</Label>
              <Input
                id="strategy-description"
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Describe the strategy logic"
                data-testid="input-strategy-description"
              />
            </div>
            <div className="space-y-2">
              <Label>Risk Level</Label>
              <Select value={newRisk} onValueChange={setNewRisk}>
                <SelectTrigger data-testid="select-strategy-risk">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Low">Low</SelectItem>
                  <SelectItem value="Medium">Medium</SelectItem>
                  <SelectItem value="High">High</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="strategy-pairs">Trading Pairs</Label>
              <Input
                id="strategy-pairs"
                value={newPairs}
                onChange={(e) => setNewPairs(e.target.value)}
                placeholder="BTC/USDT, ETH/USDT"
                data-testid="input-strategy-pairs"
              />
              <p className="text-xs text-muted-foreground">Comma-separated list of pairs</p>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setCreateOpen(false)} data-testid="button-cancel-create">
              Cancel
            </Button>
            <Button
              onClick={handleCreate}
              disabled={!newName.trim() || createMutation.isPending}
              data-testid="button-submit-create"
            >
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
