import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Form, FormField, FormItem, FormLabel, FormControl, FormMessage } from "@/components/ui/form";
import { Slider } from "@/components/ui/slider";
import { Skeleton } from "@/components/ui/skeleton";
import { useForm } from "react-hook-form";
import { Plus, Trash2, Edit2, Zap, TrendingUp, BarChart3, ArrowUpDown, Activity, Brain, Sparkles } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { Strategy, InsertStrategy } from "@shared/schema";

const strategyTypes = [
  { value: "scalping", label: "Scalping", desc: "Quick trades, small profits" },
  { value: "swing", label: "Swing Trading", desc: "Multi-day positions" },
  { value: "dca", label: "DCA", desc: "Dollar-cost averaging" },
  { value: "breakout", label: "Breakout", desc: "Breakout pattern trading" },
  { value: "grid", label: "Grid Trading", desc: "Grid-based strategies" },
  { value: "arbitrage", label: "Arbitrage", desc: "Cross-exchange arbitrage" },
];

const timeframes = ["1m", "5m", "15m", "30m", "1h", "4h", "1d", "1w"];
const riskLevels = [
  { value: "low", label: "Low", color: "text-emerald-500" },
  { value: "medium", label: "Medium", color: "text-amber-500" },
  { value: "high", label: "High", color: "text-red-500" },
];
const availableIndicators = ["RSI", "MACD", "Bollinger Bands", "EMA", "SMA", "Volume", "ATR", "Fibonacci", "Stochastic", "VWAP", "Ichimoku", "Support/Resistance"];
const availablePairs = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "XRP/USDT", "ADA/USDT", "DOGE/USDT", "AVAX/USDT", "DOT/USDT", "MATIC/USDT"];

export default function StrategiesPage() {
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const { toast } = useToast();
  const { data: strategies, isLoading } = useQuery<Strategy[]>({ queryKey: ["/api/strategies"] });

  const form = useForm<InsertStrategy>({
    defaultValues: {
      name: "", description: "", type: "scalping", pairs: [], indicators: [],
      timeframe: "1h", riskLevel: "medium", takeProfit: 2.0, stopLoss: 1.0, maxPositionSize: 10.0,
    },
  });

  const createMutation = useMutation({
    mutationFn: (data: InsertStrategy) => apiRequest("POST", "/api/strategies", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Strategy created" });
      setDialogOpen(false);
      form.reset();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, data }: { id: string; data: Partial<Strategy> }) => apiRequest("PATCH", `/api/strategies/${id}`, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Strategy updated" });
      setDialogOpen(false);
      setEditingId(null);
      form.reset();
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/strategies/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Strategy deleted" });
    },
  });

  const aiReviewMutation = useMutation({
    mutationFn: (id: string) => apiRequest("POST", `/api/strategies/${id}/ai-review`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategies"] });
      toast({ title: "AI Review Complete", description: "Claude AI has reviewed your strategy." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const toggleActive = useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => apiRequest("PATCH", `/api/strategies/${id}`, { isActive }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/strategies"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
  });

  const openEdit = (strat: Strategy) => {
    setEditingId(strat.id);
    form.reset({
      name: strat.name,
      description: strat.description || "",
      type: strat.type,
      pairs: strat.pairs || [],
      indicators: strat.indicators || [],
      timeframe: strat.timeframe,
      riskLevel: strat.riskLevel,
      takeProfit: strat.takeProfit || 2,
      stopLoss: strat.stopLoss || 1,
      maxPositionSize: strat.maxPositionSize || 10,
    });
    setDialogOpen(true);
  };

  const openCreate = () => {
    setEditingId(null);
    form.reset({
      name: "", description: "", type: "scalping", pairs: [], indicators: [],
      timeframe: "1h", riskLevel: "medium", takeProfit: 2.0, stopLoss: 1.0, maxPositionSize: 10.0,
    });
    setDialogOpen(true);
  };

  const handleSubmit = (data: InsertStrategy) => {
    if (editingId) {
      updateMutation.mutate({ id: editingId, data });
    } else {
      createMutation.mutate(data);
    }
  };

  const selectedPairs = form.watch("pairs") || [];
  const selectedIndicators = form.watch("indicators") || [];

  if (isLoading) {
    return (
      <div className="p-4 lg:p-6 space-y-4">
        <Skeleton className="h-10 w-48" />
        <div className="grid lg:grid-cols-2 gap-4">
          {Array.from({ length: 4 }).map((_, i) => <Card key={i}><CardContent className="p-6"><Skeleton className="h-32 w-full" /></CardContent></Card>)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-7xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold tracking-tight" data-testid="text-strategies-title">Strategies</h1>
          <p className="text-muted-foreground mt-1">Create and manage your trading strategies</p>
        </div>
        <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-create-strategy" onClick={openCreate}>
              <Plus className="w-4 h-4 mr-2" />New Strategy
            </Button>
          </DialogTrigger>
          <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>{editingId ? "Edit Strategy" : "Create Strategy"}</DialogTitle>
            </DialogHeader>
            <Form {...form}>
              <form onSubmit={form.handleSubmit(handleSubmit)} className="space-y-4">
                <FormField control={form.control} name="name" render={({ field }) => (
                  <FormItem><FormLabel>Name</FormLabel><FormControl><Input data-testid="input-strategy-name" placeholder="My Strategy" {...field} /></FormControl><FormMessage /></FormItem>
                )} />
                <FormField control={form.control} name="description" render={({ field }) => (
                  <FormItem><FormLabel>Description</FormLabel><FormControl><Textarea data-testid="input-strategy-desc" placeholder="Describe your strategy..." {...field} value={field.value || ""} /></FormControl><FormMessage /></FormItem>
                )} />
                <div className="grid grid-cols-2 gap-4">
                  <FormField control={form.control} name="type" render={({ field }) => (
                    <FormItem><FormLabel>Type</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger data-testid="select-strategy-type"><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          {strategyTypes.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}
                        </SelectContent>
                      </Select><FormMessage /></FormItem>
                  )} />
                  <FormField control={form.control} name="timeframe" render={({ field }) => (
                    <FormItem><FormLabel>Timeframe</FormLabel>
                      <Select onValueChange={field.onChange} value={field.value}>
                        <FormControl><SelectTrigger data-testid="select-strategy-timeframe"><SelectValue /></SelectTrigger></FormControl>
                        <SelectContent>
                          {timeframes.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                        </SelectContent>
                      </Select><FormMessage /></FormItem>
                  )} />
                </div>
                <FormField control={form.control} name="riskLevel" render={({ field }) => (
                  <FormItem><FormLabel>Risk Level</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger data-testid="select-strategy-risk"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        {riskLevels.map(r => <SelectItem key={r.value} value={r.value}>{r.label}</SelectItem>)}
                      </SelectContent>
                    </Select><FormMessage /></FormItem>
                )} />
                <FormItem>
                  <FormLabel>Trading Pairs</FormLabel>
                  <div className="flex flex-wrap gap-2">
                    {availablePairs.map(pair => (
                      <Badge key={pair}
                        variant={selectedPairs.includes(pair) ? "default" : "outline"}
                        className="cursor-pointer text-xs"
                        data-testid={`badge-pair-${pair}`}
                        onClick={() => {
                          const current = form.getValues("pairs") || [];
                          form.setValue("pairs", current.includes(pair) ? current.filter(p => p !== pair) : [...current, pair]);
                        }}>
                        {pair}
                      </Badge>
                    ))}
                  </div>
                </FormItem>
                <FormItem>
                  <FormLabel>Indicators</FormLabel>
                  <div className="flex flex-wrap gap-2">
                    {availableIndicators.map(ind => (
                      <Badge key={ind}
                        variant={selectedIndicators.includes(ind) ? "default" : "outline"}
                        className="cursor-pointer text-xs"
                        data-testid={`badge-indicator-${ind}`}
                        onClick={() => {
                          const current = form.getValues("indicators") || [];
                          form.setValue("indicators", current.includes(ind) ? current.filter(i => i !== ind) : [...current, ind]);
                        }}>
                        {ind}
                      </Badge>
                    ))}
                  </div>
                </FormItem>
                <div className="grid grid-cols-3 gap-4">
                  <FormField control={form.control} name="takeProfit" render={({ field }) => (
                    <FormItem><FormLabel>Take Profit %</FormLabel><FormControl><Input data-testid="input-strategy-tp" type="number" step="0.1" {...field} onChange={e => field.onChange(parseFloat(e.target.value))} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="stopLoss" render={({ field }) => (
                    <FormItem><FormLabel>Stop Loss %</FormLabel><FormControl><Input data-testid="input-strategy-sl" type="number" step="0.1" {...field} onChange={e => field.onChange(parseFloat(e.target.value))} /></FormControl></FormItem>
                  )} />
                  <FormField control={form.control} name="maxPositionSize" render={({ field }) => (
                    <FormItem><FormLabel>Max Position %</FormLabel><FormControl><Input data-testid="input-strategy-maxpos" type="number" step="0.5" {...field} onChange={e => field.onChange(parseFloat(e.target.value))} /></FormControl></FormItem>
                  )} />
                </div>
                <Button data-testid="button-save-strategy" type="submit" className="w-full" disabled={createMutation.isPending || updateMutation.isPending}>
                  {(createMutation.isPending || updateMutation.isPending) ? "Saving..." : editingId ? "Update Strategy" : "Create Strategy"}
                </Button>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {!strategies || strategies.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center">
            <Activity className="w-12 h-12 mx-auto mb-4 text-muted-foreground opacity-50" />
            <h3 className="text-lg font-semibold mb-2">No strategies yet</h3>
            <p className="text-muted-foreground mb-4 text-sm">Create your first AI trading strategy to get started</p>
            <Button data-testid="button-create-first-strategy" onClick={openCreate}><Plus className="w-4 h-4 mr-2" />Create Strategy</Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid lg:grid-cols-2 gap-4">
          <AnimatePresence>
            {strategies.map((strat, i) => (
              <motion.div key={strat.id} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: i * 0.05 }}>
                <Card className="hover-elevate" data-testid={`card-strategy-${strat.id}`}>
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-2 mb-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 flex-wrap mb-1">
                          <h3 className="font-semibold truncate">{strat.name}</h3>
                          <Badge variant={strat.isActive ? "default" : "outline"} className="text-xs shrink-0">
                            {strat.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground line-clamp-2">{strat.description}</p>
                      </div>
                      <Switch
                        data-testid={`switch-strategy-active-${strat.id}`}
                        checked={strat.isActive}
                        onCheckedChange={(checked) => toggleActive.mutate({ id: strat.id, isActive: checked })}
                      />
                    </div>

                    <div className="flex flex-wrap gap-1.5 mb-3">
                      <Badge variant="outline" className="text-xs">{strategyTypes.find(t => t.value === strat.type)?.label || strat.type}</Badge>
                      <Badge variant="outline" className="text-xs">{strat.timeframe}</Badge>
                      <Badge variant="outline" className={`text-xs ${riskLevels.find(r => r.value === strat.riskLevel)?.color}`}>{strat.riskLevel}</Badge>
                    </div>

                    {strat.pairs && strat.pairs.length > 0 && (
                      <div className="flex flex-wrap gap-1 mb-3">
                        {strat.pairs.map(p => <Badge key={p} variant="secondary" className="text-xs">{p}</Badge>)}
                      </div>
                    )}

                    <div className="grid grid-cols-3 gap-3 p-3 rounded-md bg-muted/30 mb-3">
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">Win Rate</p>
                        <p className="font-bold text-sm text-emerald-500">{strat.winRate}%</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">Trades</p>
                        <p className="font-bold text-sm">{strat.totalTrades}</p>
                      </div>
                      <div className="text-center">
                        <p className="text-xs text-muted-foreground">P&L</p>
                        <p className={`font-bold text-sm ${(strat.profitLoss || 0) >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                          {(strat.profitLoss || 0) >= 0 ? "+" : ""}${strat.profitLoss?.toFixed(2)}
                        </p>
                      </div>
                    </div>

                    {strat.aiReview && (
                      <div className="p-3 rounded-md bg-primary/5 border border-primary/10 mb-3">
                        <div className="flex items-center justify-between mb-1">
                          <div className="flex items-center gap-1.5">
                            <Brain className="w-3 h-3 text-primary" />
                            <p className="text-xs font-semibold text-primary">Claude AI Review</p>
                          </div>
                          {strat.aiScore && (
                            <Badge variant="secondary" className="text-xs">{strat.aiScore.toFixed(1)}/10</Badge>
                          )}
                        </div>
                        <p className="text-xs text-muted-foreground leading-relaxed">{strat.aiReview}</p>
                      </div>
                    )}

                    <div className="flex gap-2">
                      <Button data-testid={`button-ai-review-strategy-${strat.id}`} variant="secondary" size="sm"
                        onClick={() => aiReviewMutation.mutate(strat.id)} disabled={aiReviewMutation.isPending}>
                        <Sparkles className={`w-3 h-3 mr-1 ${aiReviewMutation.isPending ? "animate-spin" : ""}`} />AI Review
                      </Button>
                      <Button data-testid={`button-edit-strategy-${strat.id}`} variant="secondary" size="sm" className="flex-1" onClick={() => openEdit(strat)}>
                        <Edit2 className="w-3 h-3 mr-1" />Edit
                      </Button>
                      <Button data-testid={`button-delete-strategy-${strat.id}`} variant="destructive" size="sm" onClick={() => deleteMutation.mutate(strat.id)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </div>
  );
}
