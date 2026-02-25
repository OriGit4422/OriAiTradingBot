import { useState, useEffect } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { toast } from '@/hooks/use-toast';
import { Sidebar } from '@/components/layout/Sidebar';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Separator } from '@/components/ui/separator';
import { Bell, Lock, Key, Globe, Shield, Loader2 } from 'lucide-react';
import type { Settings } from '@shared/schema';

export default function SettingsPage() {
  const { data: settings, isLoading } = useQuery<Settings>({
    queryKey: ['/api/settings'],
  });

  const [displayName, setDisplayName] = useState('');
  const [maxRiskPercent, setMaxRiskPercent] = useState('2.0');
  const [binanceApiKey, setBinanceApiKey] = useState('');
  const [bybitApiKey, setBybitApiKey] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');

  useEffect(() => {
    if (settings) {
      setDisplayName(settings.displayName);
      setMaxRiskPercent(String(settings.maxRiskPercent));
      setBinanceApiKey(settings.binanceApiKey ?? '');
      setBybitApiKey(settings.bybitApiKey ?? '');
      setTelegramChatId(settings.telegramChatId ?? '');
    }
  }, [settings]);

  const updateMutation = useMutation({
    mutationFn: async (patch: Partial<Settings>) => {
      const res = await apiRequest('PATCH', '/api/settings', patch);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/settings'] });
      toast({ title: 'Settings updated' });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to update settings', description: error.message, variant: 'destructive' });
    },
  });

  if (isLoading || !settings) {
    return (
      <div className="min-h-screen bg-background text-foreground font-sans flex">
        <Sidebar />
        <div className="flex-1 md:pl-64 flex items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-primary" data-testid="loading-spinner" />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground font-sans flex">
      <Sidebar />
      <div className="flex-1 md:pl-64">
        <div className="p-4 md:p-8 max-w-4xl">
          <h1 className="text-3xl font-display font-bold text-primary mb-2">Settings</h1>
          <p className="text-muted-foreground mb-8">Manage your account, API connections, and preferences.</p>

          <Tabs defaultValue="general" className="w-full">
            <TabsList className="mb-6 bg-muted/30">
              <TabsTrigger value="general" data-testid="tab-general">General</TabsTrigger>
              <TabsTrigger value="api" data-testid="tab-api">API Keys</TabsTrigger>
              <TabsTrigger value="trading" data-testid="tab-trading">Trading</TabsTrigger>
              <TabsTrigger value="notifications" data-testid="tab-notifications">Notifications</TabsTrigger>
            </TabsList>

            <TabsContent value="general">
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle>Profile & Appearance</CardTitle>
                  <CardDescription>Update your personal information and UI preferences.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <Label>Display Name</Label>
                    <div className="flex gap-2">
                      <Input
                        data-testid="input-display-name"
                        value={displayName}
                        onChange={(e) => setDisplayName(e.target.value)}
                        className="bg-muted/20"
                      />
                      <Button
                        data-testid="button-save-display-name"
                        onClick={() => updateMutation.mutate({ displayName })}
                        disabled={updateMutation.isPending || displayName === settings.displayName}
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Compact Mode</Label>
                      <div className="text-xs text-muted-foreground">Reduce spacing in data tables</div>
                    </div>
                    <Switch
                      data-testid="switch-compact-mode"
                      checked={settings.compactMode}
                      onCheckedChange={(checked) => updateMutation.mutate({ compactMode: checked })}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Sound Effects</Label>
                      <div className="text-xs text-muted-foreground">Play sounds on trade execution</div>
                    </div>
                    <Switch
                      data-testid="switch-sound-effects"
                      checked={settings.soundEffects}
                      onCheckedChange={(checked) => updateMutation.mutate({ soundEffects: checked })}
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="api">
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle>Exchange Connections</CardTitle>
                  <CardDescription>Securely manage your API keys.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="p-4 border border-border rounded-lg bg-muted/10">
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-yellow-500/10 rounded flex items-center justify-center">
                          <Globe className="w-5 h-5 text-yellow-500" />
                        </div>
                        <div>
                          <div className="font-bold">Binance</div>
                          <div className={`text-xs flex items-center gap-1 ${settings.binanceConnected ? 'text-green-500' : 'text-muted-foreground'}`} data-testid="status-binance">
                            <Shield className="w-3 h-3" /> {settings.binanceConnected ? 'Connected' : 'Not Connected'}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <Label className="text-xs">API Key</Label>
                        <div className="flex gap-2">
                          <Input
                            data-testid="input-binance-api-key"
                            type="password"
                            value={binanceApiKey}
                            onChange={(e) => setBinanceApiKey(e.target.value)}
                            placeholder="Enter Binance API key"
                            className="bg-muted/30"
                          />
                          <Button
                            data-testid="button-save-binance"
                            size="sm"
                            onClick={() => updateMutation.mutate({ binanceApiKey, binanceConnected: !!binanceApiKey })}
                            disabled={updateMutation.isPending}
                          >
                            Save
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="p-4 border border-border rounded-lg bg-muted/10">
                    <div className="flex justify-between items-start mb-4">
                      <div className="flex items-center gap-3">
                        <div className="w-10 h-10 bg-orange-500/10 rounded flex items-center justify-center">
                          <Globe className="w-5 h-5 text-orange-500" />
                        </div>
                        <div>
                          <div className="font-bold">Bybit</div>
                          <div className={`text-xs flex items-center gap-1 ${settings.bybitConnected ? 'text-green-500' : 'text-muted-foreground'}`} data-testid="status-bybit">
                            <Shield className="w-3 h-3" /> {settings.bybitConnected ? 'Connected' : 'Not Connected'}
                          </div>
                        </div>
                      </div>
                    </div>
                    <div className="space-y-3">
                      <div className="space-y-1">
                        <Label className="text-xs">API Key</Label>
                        <div className="flex gap-2">
                          <Input
                            data-testid="input-bybit-api-key"
                            type="password"
                            value={bybitApiKey}
                            onChange={(e) => setBybitApiKey(e.target.value)}
                            placeholder="Enter Bybit API key"
                            className="bg-muted/30"
                          />
                          <Button
                            data-testid="button-save-bybit"
                            size="sm"
                            onClick={() => updateMutation.mutate({ bybitApiKey, bybitConnected: !!bybitApiKey })}
                            disabled={updateMutation.isPending}
                          >
                            Save
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="trading">
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle>Risk Management</CardTitle>
                  <CardDescription>Set global safety parameters for your strategies.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="space-y-2">
                    <Label>Max Leverage</Label>
                    <div className="flex gap-4">
                      {[10, 20, 50, 100].map(lev => (
                        <Button
                          key={lev}
                          data-testid={`button-leverage-${lev}`}
                          variant={settings.maxLeverage === lev ? 'default' : 'outline'}
                          className="flex-1"
                          onClick={() => updateMutation.mutate({ maxLeverage: lev })}
                          disabled={updateMutation.isPending}
                        >
                          {lev}x
                        </Button>
                      ))}
                    </div>
                  </div>
                  <Separator />
                  <div className="space-y-2">
                    <Label>Max Risk Per Trade (%)</Label>
                    <div className="flex gap-2">
                      <Input
                        data-testid="input-max-risk"
                        type="number"
                        value={maxRiskPercent}
                        onChange={(e) => setMaxRiskPercent(e.target.value)}
                        className="bg-muted/20"
                      />
                      <Button
                        data-testid="button-save-max-risk"
                        onClick={() => updateMutation.mutate({ maxRiskPercent: parseFloat(maxRiskPercent) })}
                        disabled={updateMutation.isPending || parseFloat(maxRiskPercent) === settings.maxRiskPercent}
                      >
                        Save
                      </Button>
                    </div>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Auto-Stop Loss</Label>
                      <div className="text-xs text-muted-foreground">Always attach SL to new orders</div>
                    </div>
                    <Switch
                      data-testid="switch-auto-stop-loss"
                      checked={settings.autoStopLoss}
                      onCheckedChange={(checked) => updateMutation.mutate({ autoStopLoss: checked })}
                    />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="notifications">
              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle>Notifications</CardTitle>
                  <CardDescription>Configure how you receive alerts and updates.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Telegram Notifications</Label>
                      <div className="text-xs text-muted-foreground">Receive trade alerts via Telegram</div>
                    </div>
                    <Switch
                      data-testid="switch-telegram-enabled"
                      checked={settings.telegramEnabled}
                      onCheckedChange={(checked) => updateMutation.mutate({ telegramEnabled: checked })}
                    />
                  </div>
                  {settings.telegramEnabled && (
                    <div className="space-y-2">
                      <Label>Telegram Chat ID</Label>
                      <div className="flex gap-2">
                        <Input
                          data-testid="input-telegram-chat-id"
                          value={telegramChatId}
                          onChange={(e) => setTelegramChatId(e.target.value)}
                          placeholder="Enter your Telegram chat ID"
                          className="bg-muted/20"
                        />
                        <Button
                          data-testid="button-save-telegram-chat-id"
                          onClick={() => updateMutation.mutate({ telegramChatId: telegramChatId || null })}
                          disabled={updateMutation.isPending || telegramChatId === (settings.telegramChatId ?? '')}
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>
    </div>
  );
}
