import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Zap, TrendingUp, TrendingDown, Target, Brain, Trash2, Clock, CheckCircle, XCircle, AlertTriangle } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import type { Signal } from "@shared/schema";

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  const color = pct >= 80 ? "bg-emerald-500" : pct >= 60 ? "bg-amber-500" : "bg-red-500";
  return (
    <div className="flex items-center gap-2">
      <div className="flex-1 h-2 rounded-full bg-muted">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-bold min-w-[2.5rem] text-right">{pct}%</span>
    </div>
  );
}

export default function SignalsPage() {
  const { toast } = useToast();
  const { data: signals, isLoading } = useQuery<Signal[]>({ queryKey: ["/api/signals"] });

  const generateMutation = useMutation({
    mutationFn: () => apiRequest("POST", "/api/signals/generate", {}),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/signals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "AI Signal Generated", description: "New trading signal has been analyzed and created." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => apiRequest("PATCH", `/api/signals/${id}`, { status }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/signals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => apiRequest("DELETE", `/api/signals/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/signals"] });
      queryClient.invalidateQueries({ queryKey: ["/api/dashboard/stats"] });
      toast({ title: "Signal deleted" });
    },
  });

  const activeSignals = signals?.filter(s => s.status === "active") || [];
  const closedSignals = signals?.filter(s => s.status === "closed") || [];
  const expiredSignals = signals?.filter(s => s.status === "expired") || [];

  const statusIcon = (status: string) => {
    switch (status) {
      case "active": return <Clock className="w-3 h-3" />;
      case "closed": return <CheckCircle className="w-3 h-3" />;
      case "expired": return <XCircle className="w-3 h-3" />;
      default: return <AlertTriangle className="w-3 h-3" />;
    }
  };

  const renderSignals = (list: Signal[]) => {
    if (list.length === 0) {
      return (
        <div className="text-center py-12 text-muted-foreground">
          <Target className="w-10 h-10 mx-auto mb-3 opacity-50" />
          <p className="text-sm">No signals in this category</p>
        </div>
      );
    }
    return (
      <div className="space-y-3">
        <AnimatePresence>
          {list.map((sig, i) => (
            <motion.div key={sig.id} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} transition={{ delay: i * 0.03 }}>
              <Card className="hover-elevate" data-testid={`card-signal-${sig.id}`}>
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3 mb-3">
                    <div className="flex items-center gap-2 flex-wrap">
                      <div className={`w-8 h-8 rounded-md flex items-center justify-center ${sig.type === "long" ? "bg-emerald-500/10" : "bg-red-500/10"}`}>
                        {sig.type === "long" ? <TrendingUp className="w-4 h-4 text-emerald-500" /> : <TrendingDown className="w-4 h-4 text-red-500" />}
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="font-semibold text-sm">{sig.pair}</h3>
                          <Badge variant={sig.type === "long" ? "default" : "destructive"} className="text-xs">
                            {sig.type.toUpperCase()}
                          </Badge>
                        </div>
                        <p className="text-xs text-muted-foreground">
                          {sig.createdAt ? new Date(sig.createdAt).toLocaleString() : "Just now"}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Badge variant="outline" className="text-xs gap-1">
                        {statusIcon(sig.status)}{sig.status}
                      </Badge>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 p-3 rounded-md bg-muted/30 mb-3">
                    <div>
                      <p className="text-xs text-muted-foreground">Entry</p>
                      <p className="font-bold text-sm">${sig.entry}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Target</p>
                      <p className="font-bold text-sm text-emerald-500">${sig.target}</p>
                    </div>
                    <div>
                      <p className="text-xs text-muted-foreground">Stop Loss</p>
                      <p className="font-bold text-sm text-red-500">${sig.stopLoss}</p>
                    </div>
                  </div>

                  <div className="mb-3">
                    <p className="text-xs text-muted-foreground mb-1">AI Confidence</p>
                    <ConfidenceBar value={sig.confidence} />
                  </div>

                  {sig.aiAnalysis && (
                    <div className="p-3 rounded-md bg-primary/5 border border-primary/10 mb-3">
                      <div className="flex items-center gap-1.5 mb-1">
                        <Brain className="w-3 h-3 text-primary" />
                        <p className="text-xs font-semibold text-primary">AI Analysis</p>
                      </div>
                      <p className="text-xs text-muted-foreground leading-relaxed">{sig.aiAnalysis}</p>
                    </div>
                  )}

                  <div className="flex gap-2">
                    {sig.status === "active" && (
                      <Button data-testid={`button-close-signal-${sig.id}`} variant="secondary" size="sm" className="flex-1"
                        onClick={() => updateMutation.mutate({ id: sig.id, status: "closed" })}>
                        <CheckCircle className="w-3 h-3 mr-1" />Close
                      </Button>
                    )}
                    <Button data-testid={`button-delete-signal-${sig.id}`} variant="destructive" size="sm"
                      onClick={() => deleteMutation.mutate(sig.id)}>
                      <Trash2 className="w-3 h-3" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    );
  };

  if (isLoading) {
    return (
      <div className="p-4 lg:p-6 space-y-4">
        <Skeleton className="h-10 w-48" />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => <Card key={i}><CardContent className="p-6"><Skeleton className="h-40 w-full" /></CardContent></Card>)}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-4xl mx-auto">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold tracking-tight" data-testid="text-signals-title">Trading Signals</h1>
          <p className="text-muted-foreground mt-1">AI-powered trading signals and analysis</p>
        </div>
        <Button data-testid="button-generate-signal" onClick={() => generateMutation.mutate()} disabled={generateMutation.isPending}>
          <Zap className="w-4 h-4 mr-2" />
          {generateMutation.isPending ? "Generating..." : "Generate AI Signal"}
        </Button>
      </div>

      <Tabs defaultValue="active">
        <TabsList className="grid grid-cols-3 w-full max-w-sm">
          <TabsTrigger data-testid="tab-signals-active" value="active">Active ({activeSignals.length})</TabsTrigger>
          <TabsTrigger data-testid="tab-signals-closed" value="closed">Closed ({closedSignals.length})</TabsTrigger>
          <TabsTrigger data-testid="tab-signals-expired" value="expired">Expired ({expiredSignals.length})</TabsTrigger>
        </TabsList>
        <TabsContent value="active" className="mt-4">{renderSignals(activeSignals)}</TabsContent>
        <TabsContent value="closed" className="mt-4">{renderSignals(closedSignals)}</TabsContent>
        <TabsContent value="expired" className="mt-4">{renderSignals(expiredSignals)}</TabsContent>
      </Tabs>
    </div>
  );
}
