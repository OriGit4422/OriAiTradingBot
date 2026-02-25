import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { TrendingUp, TrendingDown, Activity, Target, BarChart3, Wallet, Percent, Zap } from "lucide-react";
import { motion } from "framer-motion";
import type { Signal, TradeHistory } from "@shared/schema";

export default function Dashboard() {
  const { data: stats, isLoading } = useQuery<any>({ queryKey: ["/api/dashboard/stats"] });
  const { data: signals } = useQuery<Signal[]>({ queryKey: ["/api/signals"] });
  const { data: trades } = useQuery<TradeHistory[]>({ queryKey: ["/api/trades"] });

  const recentSignals = signals?.slice(0, 4) || [];
  const recentTrades = trades?.slice(0, 5) || [];

  const statCards = [
    { title: "Portfolio Value", value: stats ? `$${stats.portfolioValue.toLocaleString()}` : "-", icon: Wallet, color: "text-primary", bg: "bg-primary/10" },
    { title: "Total P&L", value: stats ? `${stats.totalProfitLoss >= 0 ? "+" : ""}$${stats.totalProfitLoss.toLocaleString()}` : "-", icon: stats?.totalProfitLoss >= 0 ? TrendingUp : TrendingDown, color: stats?.totalProfitLoss >= 0 ? "text-emerald-500" : "text-red-500", bg: stats?.totalProfitLoss >= 0 ? "bg-emerald-500/10" : "bg-red-500/10" },
    { title: "Win Rate", value: stats ? `${stats.winRate}%` : "-", icon: Percent, color: "text-amber-500", bg: "bg-amber-500/10" },
    { title: "Active Strategies", value: stats ? `${stats.activeStrategies}/${stats.totalStrategies}` : "-", icon: Zap, color: "text-violet-500", bg: "bg-violet-500/10" },
    { title: "Active Signals", value: stats ? `${stats.activeSignals}` : "-", icon: Target, color: "text-cyan-500", bg: "bg-cyan-500/10" },
    { title: "Total Trades", value: stats ? `${stats.totalTrades}` : "-", icon: BarChart3, color: "text-orange-500", bg: "bg-orange-500/10" },
  ];

  if (isLoading) {
    return (
      <div className="p-4 lg:p-6 space-y-6">
        <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <Card key={i}><CardContent className="p-4"><Skeleton className="h-16 w-full" /></CardContent></Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-7xl mx-auto">
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold tracking-tight" data-testid="text-dashboard-title">Dashboard</h1>
        <p className="text-muted-foreground mt-1">Overview of your trading performance</p>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3 lg:gap-4">
        {statCards.map((card, i) => (
          <motion.div key={card.title} initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.05 }}>
            <Card className="hover-elevate">
              <CardContent className="p-4">
                <div className="flex items-center justify-between gap-1 mb-3">
                  <p className="text-xs lg:text-sm text-muted-foreground font-medium truncate">{card.title}</p>
                  <div className={`w-8 h-8 rounded-md ${card.bg} flex items-center justify-center shrink-0`}>
                    <card.icon className={`w-4 h-4 ${card.color}`} />
                  </div>
                </div>
                <p className={`text-lg lg:text-2xl font-bold ${card.color}`} data-testid={`text-stat-${card.title.toLowerCase().replace(/\s/g, "-")}`}>
                  {card.value}
                </p>
              </CardContent>
            </Card>
          </motion.div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4 lg:gap-6">
        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Target className="w-4 h-4 text-primary" />
                Recent Signals
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recentSignals.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <Activity className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No signals yet. Generate your first AI signal!</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {recentSignals.map((sig) => (
                    <div key={sig.id} className="flex items-center justify-between gap-2 p-3 rounded-md bg-muted/30" data-testid={`signal-card-${sig.id}`}>
                      <div className="flex items-center gap-3 min-w-0">
                        <Badge variant={sig.type === "long" ? "default" : "destructive"} className="text-xs shrink-0">
                          {sig.type === "long" ? "LONG" : "SHORT"}
                        </Badge>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm truncate">{sig.pair}</p>
                          <p className="text-xs text-muted-foreground">Entry: ${sig.entry}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        <p className="text-sm font-medium">{Math.round(sig.confidence * 100)}%</p>
                        <Badge variant="outline" className="text-xs">{sig.status}</Badge>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.4 }}>
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary" />
                Recent Trades
              </CardTitle>
            </CardHeader>
            <CardContent>
              {recentTrades.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <BarChart3 className="w-8 h-8 mx-auto mb-2 opacity-50" />
                  <p className="text-sm">No trades yet. Start trading with your strategies!</p>
                </div>
              ) : (
                <div className="space-y-3">
                  {recentTrades.map((trade) => (
                    <div key={trade.id} className="flex items-center justify-between gap-2 p-3 rounded-md bg-muted/30" data-testid={`trade-card-${trade.id}`}>
                      <div className="flex items-center gap-3 min-w-0">
                        <Badge variant={trade.type === "long" ? "default" : "destructive"} className="text-xs shrink-0">
                          {trade.type.toUpperCase()}
                        </Badge>
                        <div className="min-w-0">
                          <p className="font-semibold text-sm truncate">{trade.pair}</p>
                          <p className="text-xs text-muted-foreground">Entry: ${trade.entryPrice}</p>
                        </div>
                      </div>
                      <div className="text-right shrink-0">
                        {trade.status === "open" ? (
                          <Badge variant="outline" className="text-xs">Open</Badge>
                        ) : (
                          <p className={`text-sm font-bold ${(trade.profitLoss || 0) >= 0 ? "text-emerald-500" : "text-red-500"}`}>
                            {(trade.profitLoss || 0) >= 0 ? "+" : ""}${trade.profitLoss?.toFixed(2)}
                          </p>
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </motion.div>
      </div>
    </div>
  );
}
