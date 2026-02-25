import { useQuery, useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Form, FormField, FormItem, FormLabel, FormControl, FormDescription } from "@/components/ui/form";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { Slider } from "@/components/ui/slider";
import { Settings, Shield, Bell, Zap, Server, Save, AlertTriangle } from "lucide-react";
import { motion } from "framer-motion";
import type { BotSettings } from "@shared/schema";

export default function SettingsPage() {
  const { toast } = useToast();
  const { data: settings, isLoading } = useQuery<BotSettings>({ queryKey: ["/api/settings"] });

  const form = useForm({
    values: settings ? {
      exchangeName: settings.exchangeName || "binance",
      apiKey: settings.apiKey || "",
      apiSecret: settings.apiSecret || "",
      isLive: settings.isLive,
      maxDailyTrades: settings.maxDailyTrades || 10,
      maxRiskPerTrade: settings.maxRiskPerTrade || 2,
      dailyLossLimit: settings.dailyLossLimit || 5,
      notificationsEnabled: settings.notificationsEnabled ?? true,
      emailAlerts: settings.emailAlerts ?? true,
      autoTrade: settings.autoTrade ?? false,
      trailingStop: settings.trailingStop ?? false,
      defaultLeverage: settings.defaultLeverage || 1,
    } : undefined,
  });

  const saveMutation = useMutation({
    mutationFn: (data: any) => apiRequest("PUT", "/api/settings", data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
      toast({ title: "Settings saved", description: "Your bot settings have been updated." });
    },
    onError: (e: Error) => toast({ title: "Error", description: e.message, variant: "destructive" }),
  });

  if (isLoading) {
    return (
      <div className="p-4 lg:p-6 space-y-4">
        <Skeleton className="h-10 w-48" />
        {Array.from({ length: 4 }).map((_, i) => <Card key={i}><CardContent className="p-6"><Skeleton className="h-24 w-full" /></CardContent></Card>)}
      </div>
    );
  }

  return (
    <div className="p-4 lg:p-6 space-y-6 max-w-3xl mx-auto">
      <div>
        <h1 className="text-2xl lg:text-3xl font-bold tracking-tight" data-testid="text-settings-title">Settings</h1>
        <p className="text-muted-foreground mt-1">Configure your trading bot parameters</p>
      </div>

      <Form {...form}>
        <form onSubmit={form.handleSubmit((data) => saveMutation.mutate(data))} className="space-y-6">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}>
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Server className="w-4 h-4 text-primary" />Exchange Configuration
                </CardTitle>
                <CardDescription>Connect your exchange API for live trading</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField control={form.control} name="exchangeName" render={({ field }) => (
                  <FormItem>
                    <FormLabel>Exchange</FormLabel>
                    <Select onValueChange={field.onChange} value={field.value}>
                      <FormControl><SelectTrigger data-testid="select-exchange"><SelectValue /></SelectTrigger></FormControl>
                      <SelectContent>
                        <SelectItem value="binance">Binance</SelectItem>
                        <SelectItem value="bybit">Bybit</SelectItem>
                        <SelectItem value="okx">OKX</SelectItem>
                        <SelectItem value="coinbase">Coinbase</SelectItem>
                        <SelectItem value="kraken">Kraken</SelectItem>
                        <SelectItem value="kucoin">KuCoin</SelectItem>
                      </SelectContent>
                    </Select>
                  </FormItem>
                )} />
                <FormField control={form.control} name="apiKey" render={({ field }) => (
                  <FormItem>
                    <FormLabel>API Key</FormLabel>
                    <FormControl><Input data-testid="input-api-key" type="password" placeholder="Enter your API key" {...field} /></FormControl>
                    <FormDescription>Your exchange API key (stored securely)</FormDescription>
                  </FormItem>
                )} />
                <FormField control={form.control} name="apiSecret" render={({ field }) => (
                  <FormItem>
                    <FormLabel>API Secret</FormLabel>
                    <FormControl><Input data-testid="input-api-secret" type="password" placeholder="Enter your API secret" {...field} /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="isLive" render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-2 rounded-md border p-3">
                    <div>
                      <FormLabel className="mb-0">Live Trading Mode</FormLabel>
                      <FormDescription className="text-xs">Enable to execute real trades on your exchange</FormDescription>
                    </div>
                    <FormControl><Switch data-testid="switch-live-mode" checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  </FormItem>
                )} />
                {form.watch("isLive") && (
                  <div className="flex items-center gap-2 p-3 rounded-md bg-destructive/10 text-destructive text-sm">
                    <AlertTriangle className="w-4 h-4 shrink-0" />
                    <p>Live trading is enabled. Real funds will be used for trades.</p>
                  </div>
                )}
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.1 }}>
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Shield className="w-4 h-4 text-primary" />Risk Management
                </CardTitle>
                <CardDescription>Control your risk exposure and limits</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <FormField control={form.control} name="maxDailyTrades" render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between gap-2">
                      <FormLabel>Max Daily Trades</FormLabel>
                      <span className="text-sm font-bold text-primary">{field.value}</span>
                    </div>
                    <FormControl>
                      <Slider data-testid="slider-max-trades" min={1} max={50} step={1} value={[field.value || 10]} onValueChange={([v]) => field.onChange(v)} />
                    </FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="maxRiskPerTrade" render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between gap-2">
                      <FormLabel>Max Risk Per Trade (%)</FormLabel>
                      <span className="text-sm font-bold text-primary">{field.value}%</span>
                    </div>
                    <FormControl>
                      <Slider data-testid="slider-risk-per-trade" min={0.5} max={10} step={0.5} value={[field.value || 2]} onValueChange={([v]) => field.onChange(v)} />
                    </FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="dailyLossLimit" render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between gap-2">
                      <FormLabel>Daily Loss Limit (%)</FormLabel>
                      <span className="text-sm font-bold text-red-500">{field.value}%</span>
                    </div>
                    <FormControl>
                      <Slider data-testid="slider-daily-loss" min={1} max={20} step={0.5} value={[field.value || 5]} onValueChange={([v]) => field.onChange(v)} />
                    </FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="defaultLeverage" render={({ field }) => (
                  <FormItem>
                    <div className="flex items-center justify-between gap-2">
                      <FormLabel>Default Leverage</FormLabel>
                      <span className="text-sm font-bold text-amber-500">{field.value}x</span>
                    </div>
                    <FormControl>
                      <Slider data-testid="slider-leverage" min={1} max={20} step={1} value={[field.value || 1]} onValueChange={([v]) => field.onChange(v)} />
                    </FormControl>
                    <FormDescription>Higher leverage increases both potential gains and losses</FormDescription>
                  </FormItem>
                )} />
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.2 }}>
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Zap className="w-4 h-4 text-primary" />Trading Automation
                </CardTitle>
                <CardDescription>Configure automated trading features</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField control={form.control} name="autoTrade" render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-2 rounded-md border p-3">
                    <div>
                      <FormLabel className="mb-0">Auto-Trade</FormLabel>
                      <FormDescription className="text-xs">Automatically execute trades based on signals</FormDescription>
                    </div>
                    <FormControl><Switch data-testid="switch-auto-trade" checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="trailingStop" render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-2 rounded-md border p-3">
                    <div>
                      <FormLabel className="mb-0">Trailing Stop-Loss</FormLabel>
                      <FormDescription className="text-xs">Dynamically adjust stop-loss as price moves favorably</FormDescription>
                    </div>
                    <FormControl><Switch data-testid="switch-trailing-stop" checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  </FormItem>
                )} />
              </CardContent>
            </Card>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 }}>
            <Card>
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2">
                  <Bell className="w-4 h-4 text-primary" />Notifications
                </CardTitle>
                <CardDescription>Configure alert preferences</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <FormField control={form.control} name="notificationsEnabled" render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-2 rounded-md border p-3">
                    <div>
                      <FormLabel className="mb-0">Push Notifications</FormLabel>
                      <FormDescription className="text-xs">Receive in-app notifications for signals and trades</FormDescription>
                    </div>
                    <FormControl><Switch data-testid="switch-notifications" checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  </FormItem>
                )} />
                <FormField control={form.control} name="emailAlerts" render={({ field }) => (
                  <FormItem className="flex items-center justify-between gap-2 rounded-md border p-3">
                    <div>
                      <FormLabel className="mb-0">Email Alerts</FormLabel>
                      <FormDescription className="text-xs">Receive email notifications for important events</FormDescription>
                    </div>
                    <FormControl><Switch data-testid="switch-email-alerts" checked={field.value} onCheckedChange={field.onChange} /></FormControl>
                  </FormItem>
                )} />
              </CardContent>
            </Card>
          </motion.div>

          <Button data-testid="button-save-settings" type="submit" className="w-full" size="lg" disabled={saveMutation.isPending}>
            <Save className="w-4 h-4 mr-2" />
            {saveMutation.isPending ? "Saving..." : "Save Settings"}
          </Button>
        </form>
      </Form>
    </div>
  );
}
