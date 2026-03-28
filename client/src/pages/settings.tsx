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
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Bell, Lock, Key, Globe, Shield, Loader2, Users, UserPlus, Trash2, Edit, Mail, Check, X, Brain, Activity, Zap } from 'lucide-react';
import type { Settings, UserAccess } from '@shared/schema';

const ROLES = [
  { value: 'admin', label: 'Admin', description: 'Full access to all features' },
  { value: 'trader', label: 'Trader', description: 'Can view signals, execute trades' },
  { value: 'viewer', label: 'Viewer', description: 'Read-only access to dashboard' },
];

const PERMISSIONS = [
  { value: 'view_dashboard', label: 'View Dashboard' },
  { value: 'view_signals', label: 'View Signals' },
  { value: 'execute_trades', label: 'Execute Trades' },
  { value: 'manage_wallet', label: 'Manage Wallet' },
  { value: 'view_portfolio', label: 'View Portfolio' },
  { value: 'manage_settings', label: 'Manage Settings' },
  { value: 'manage_strategies', label: 'Manage Strategies' },
];

export default function SettingsPage() {
  const { data: settings, isLoading } = useQuery<Settings>({
    queryKey: ['/api/settings'],
  });

  const { data: userAccessList = [], isLoading: accessLoading } = useQuery<UserAccess[]>({
    queryKey: ['/api/user-access'],
  });

  const [displayName, setDisplayName] = useState('');
  const [maxRiskPercent, setMaxRiskPercent] = useState('2.0');
  const [binanceApiKey, setBinanceApiKey] = useState('');
  const [bybitApiKey, setBybitApiKey] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState('');
  const [coinglassApiKey, setCoinglassApiKey] = useState('');
  const [perplexityApiKey, setPerplexityApiKey] = useState('');
  const [arkhamApiKey, setArkhamApiKey] = useState('');

  const [addUserOpen, setAddUserOpen] = useState(false);
  const [editUser, setEditUser] = useState<UserAccess | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('viewer');
  const [newPermissions, setNewPermissions] = useState<string[]>([]);

  useEffect(() => {
    if (settings) {
      setDisplayName(settings.displayName);
      setMaxRiskPercent(String(settings.maxRiskPercent));
      setBinanceApiKey(settings.binanceApiKey ?? '');
      setBybitApiKey(settings.bybitApiKey ?? '');
      setTelegramChatId(settings.telegramChatId ?? '');
      setDiscordWebhookUrl(settings.discordWebhookUrl ?? '');
      setCoinglassApiKey(settings.coinglassApiKey ?? '');
      setPerplexityApiKey(settings.perplexityApiKey ?? '');
      setArkhamApiKey(settings.arkhamApiKey ?? '');
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

  const addUserMutation = useMutation({
    mutationFn: async (data: { email: string; role: string; permissions: string[]; active: boolean }) => {
      const res = await apiRequest('POST', '/api/user-access', data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/user-access'] });
      toast({ title: 'User added', description: `Access granted to ${newEmail}` });
      resetUserForm();
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to add user', description: error.message, variant: 'destructive' });
    },
  });

  const updateUserMutation = useMutation({
    mutationFn: async ({ id, data }: { id: string; data: Partial<UserAccess> }) => {
      const res = await apiRequest('PATCH', `/api/user-access/${id}`, data);
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/user-access'] });
      toast({ title: 'User updated' });
      resetUserForm();
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to update user', description: error.message, variant: 'destructive' });
    },
  });

  const deleteUserMutation = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('DELETE', `/api/user-access/${id}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/user-access'] });
      toast({ title: 'User removed' });
    },
    onError: (error: Error) => {
      toast({ title: 'Failed to remove user', description: error.message, variant: 'destructive' });
    },
  });

  const resetUserForm = () => {
    setAddUserOpen(false);
    setEditUser(null);
    setNewEmail('');
    setNewRole('viewer');
    setNewPermissions([]);
  };

  const openEditUser = (user: UserAccess) => {
    setEditUser(user);
    setNewEmail(user.email);
    setNewRole(user.role);
    setNewPermissions(user.permissions || []);
    setAddUserOpen(true);
  };

  const handleSaveUser = () => {
    if (!newEmail.trim()) {
      toast({ title: 'Email required', variant: 'destructive' });
      return;
    }
    if (editUser) {
      updateUserMutation.mutate({ id: editUser.id, data: { email: newEmail, role: newRole, permissions: newPermissions } });
    } else {
      addUserMutation.mutate({ email: newEmail, role: newRole, permissions: newPermissions, active: true });
    }
  };

  const togglePermission = (perm: string) => {
    setNewPermissions(prev => prev.includes(perm) ? prev.filter(p => p !== perm) : [...prev, perm]);
  };

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
            <TabsList className="mb-6 bg-secondary">
              <TabsTrigger value="general" data-testid="tab-general">General</TabsTrigger>
              <TabsTrigger value="api" data-testid="tab-api">API Keys</TabsTrigger>
              <TabsTrigger value="trading" data-testid="tab-trading">Trading</TabsTrigger>
              <TabsTrigger value="notifications" data-testid="tab-notifications">Notifications</TabsTrigger>
              <TabsTrigger value="ai-agents" data-testid="tab-ai-agents">
                <Brain className="w-3.5 h-3.5 mr-1.5" />
                AI Agents
              </TabsTrigger>
              <TabsTrigger value="users" data-testid="tab-users">
                <Users className="w-3.5 h-3.5 mr-1.5" />
                User Access
              </TabsTrigger>
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
                        className="bg-secondary/50"
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
                  <div className="p-4 border border-border rounded-lg bg-secondary/40">
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
                            className="bg-secondary"
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

                  <div className="p-4 border border-border rounded-lg bg-secondary/40">
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
                            className="bg-secondary"
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
                        className="bg-secondary/50"
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
                          className="bg-secondary/50"
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

                  <Separator />

                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 text-indigo-400" viewBox="0 0 24 24" fill="currentColor"><path d="M20.317 4.37a19.791 19.791 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 4.37a.07.07 0 0 0-.032.027C.533 9.046-.32 13.58.099 18.057c.002.022.015.043.033.056a19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028 14.09 14.09 0 0 0 1.226-1.994.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z"/></svg>
                        <Label>Discord Notifications</Label>
                      </div>
                      <div className="text-xs text-muted-foreground">Send trade alerts to your Discord channel via webhook</div>
                    </div>
                    <Switch
                      data-testid="switch-discord-enabled"
                      checked={settings.discordEnabled}
                      onCheckedChange={(checked) => updateMutation.mutate({ discordEnabled: checked })}
                    />
                  </div>

                  {settings.discordEnabled && (
                    <div className="space-y-3">
                      <div className="space-y-2">
                        <Label>Discord Webhook URL</Label>
                        <div className="flex gap-2">
                          <Input
                            data-testid="input-discord-webhook"
                            value={discordWebhookUrl}
                            onChange={(e) => setDiscordWebhookUrl(e.target.value)}
                            placeholder="https://discord.com/api/webhooks/..."
                            className="bg-secondary/50 font-mono text-xs"
                          />
                          <Button
                            data-testid="button-save-discord"
                            size="sm"
                            onClick={() => updateMutation.mutate({ discordWebhookUrl: discordWebhookUrl || null })}
                            disabled={updateMutation.isPending || discordWebhookUrl === (settings.discordWebhookUrl ?? '')}
                          >
                            Save
                          </Button>
                        </div>
                        <div className="rounded-lg bg-indigo-500/5 border border-indigo-500/20 p-3 space-y-1">
                          <p className="text-[11px] font-semibold text-indigo-400">How to get your webhook URL:</p>
                          <ol className="text-[11px] text-muted-foreground space-y-0.5 list-decimal list-inside">
                            <li>Open Discord → go to your server</li>
                            <li>Server Settings → Integrations → Webhooks</li>
                            <li>Click <span className="font-semibold">New Webhook</span></li>
                            <li>Choose channel, name it (e.g. "WINM Signals"), click <span className="font-semibold">Copy Webhook URL</span></li>
                            <li>Paste the URL above and Save</li>
                          </ol>
                        </div>
                      </div>
                      {settings.discordWebhookUrl && (
                        <div className={`flex items-center gap-2 text-xs ${settings.discordEnabled ? 'text-green-500' : 'text-muted-foreground'}`}>
                          <Shield className="w-3 h-3" />
                          <span>Webhook configured — signals will be posted to Discord when enabled</span>
                        </div>
                      )}
                    </div>
                  )}

                  <Separator />

                  <div className="space-y-2">
                    <Label>Notification Preferences</Label>
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <div className="text-sm">High Confidence Only</div>
                        <div className="text-xs text-muted-foreground">Only notify for signals above confidence threshold</div>
                      </div>
                      <Switch
                        data-testid="switch-high-confidence"
                        checked={settings.notifyOnHighConfidence}
                        onCheckedChange={(checked) => updateMutation.mutate({ notifyOnHighConfidence: checked })}
                      />
                    </div>
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="ai-agents">
              <div className="space-y-4">
                {/* Overview card */}
                <Card className="bg-card border-border">
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-violet-500/10 rounded-lg flex items-center justify-center">
                        <Brain className="w-5 h-5 text-violet-400" />
                      </div>
                      <div>
                        <CardTitle>AI Intelligence Agents</CardTitle>
                        <CardDescription>Add API keys to activate agents that sharpen signal accuracy through multi-source validation.</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-2">
                      {[
                        { label: 'Claude AI', desc: 'Always active — primary analysis', color: 'text-violet-400', bg: 'bg-violet-500/10', Icon: Brain, active: true },
                        { label: 'Coinglass', desc: 'Funding rates & long/short data', color: 'text-orange-400', bg: 'bg-orange-500/10', Icon: Activity, active: !!settings.coinglassApiKey },
                        { label: 'Perplexity', desc: 'Real-time news sentiment', color: 'text-sky-400', bg: 'bg-sky-500/10', Icon: Globe, active: !!settings.perplexityApiKey },
                        { label: 'Arkham', desc: 'Whale & smart money tracking', color: 'text-cyan-400', bg: 'bg-cyan-500/10', Icon: Zap, active: !!settings.arkhamApiKey },
                      ].map(({ label, desc, color, bg, Icon, active }) => (
                        <div key={label} className={`flex items-center gap-3 p-3 rounded-lg border ${active ? 'border-green-500/30 bg-green-500/5' : 'border-border bg-secondary/40'}`}>
                          <div className={`w-8 h-8 rounded ${bg} flex items-center justify-center flex-shrink-0`}>
                            <Icon className={`w-4 h-4 ${color}`} />
                          </div>
                          <div className="min-w-0">
                            <div className="text-sm font-medium">{label}</div>
                            <div className="text-[11px] text-muted-foreground">{desc}</div>
                          </div>
                          <div className={`ml-auto text-[10px] font-semibold flex-shrink-0 ${active ? 'text-green-500' : 'text-muted-foreground'}`}>
                            {active ? '● ON' : '○ OFF'}
                          </div>
                        </div>
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Coinglass */}
                <Card className="bg-card border-border">
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-orange-500/10 rounded-lg flex items-center justify-center">
                        <Activity className="w-5 h-5 text-orange-400" />
                      </div>
                      <div>
                        <CardTitle className="text-base">Coinglass</CardTitle>
                        <CardDescription>Derivatives data: funding rates, long/short ratios, open interest. Adds ±8% confidence weight.</CardDescription>
                      </div>
                      <div className={`ml-auto text-xs font-semibold px-2 py-1 rounded-full ${settings.coinglassApiKey ? 'bg-green-500/10 text-green-500' : 'bg-secondary text-muted-foreground'}`}>
                        {settings.coinglassApiKey ? 'Active' : 'Inactive'}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-1">
                      <Label className="text-xs">API Key (coinglassSecret)</Label>
                      <div className="flex gap-2">
                        <Input
                          type="password"
                          value={coinglassApiKey}
                          onChange={(e) => setCoinglassApiKey(e.target.value)}
                          placeholder="Enter Coinglass API key"
                          className="bg-secondary font-mono text-xs"
                        />
                        <Button
                          size="sm"
                          onClick={() => updateMutation.mutate({ coinglassApiKey: coinglassApiKey || null } as any)}
                          disabled={updateMutation.isPending || coinglassApiKey === (settings.coinglassApiKey ?? '')}
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                    <div className="rounded-lg bg-orange-500/5 border border-orange-500/20 p-3 space-y-1">
                      <p className="text-[11px] font-semibold text-orange-400">How to get your Coinglass API key:</p>
                      <ol className="text-[11px] text-muted-foreground space-y-0.5 list-decimal list-inside">
                        <li>Sign up at coinglass.com and go to your account settings</li>
                        <li>Navigate to API section and generate a key</li>
                        <li>Copy the key labeled "coinglassSecret" and paste above</li>
                      </ol>
                    </div>
                  </CardContent>
                </Card>

                {/* Perplexity */}
                <Card className="bg-card border-border">
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-sky-500/10 rounded-lg flex items-center justify-center">
                        <Globe className="w-5 h-5 text-sky-400" />
                      </div>
                      <div>
                        <CardTitle className="text-base">Perplexity AI</CardTitle>
                        <CardDescription>Real-time news sentiment filter. Detects regulatory/hack risk events. Adds ±10% confidence weight.</CardDescription>
                      </div>
                      <div className={`ml-auto text-xs font-semibold px-2 py-1 rounded-full ${settings.perplexityApiKey ? 'bg-green-500/10 text-green-500' : 'bg-secondary text-muted-foreground'}`}>
                        {settings.perplexityApiKey ? 'Active' : 'Inactive'}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-1">
                      <Label className="text-xs">API Key</Label>
                      <div className="flex gap-2">
                        <Input
                          type="password"
                          value={perplexityApiKey}
                          onChange={(e) => setPerplexityApiKey(e.target.value)}
                          placeholder="pplx-..."
                          className="bg-secondary font-mono text-xs"
                        />
                        <Button
                          size="sm"
                          onClick={() => updateMutation.mutate({ perplexityApiKey: perplexityApiKey || null } as any)}
                          disabled={updateMutation.isPending || perplexityApiKey === (settings.perplexityApiKey ?? '')}
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                    <div className="rounded-lg bg-sky-500/5 border border-sky-500/20 p-3 space-y-1">
                      <p className="text-[11px] font-semibold text-sky-400">How to get your Perplexity API key:</p>
                      <ol className="text-[11px] text-muted-foreground space-y-0.5 list-decimal list-inside">
                        <li>Go to perplexity.ai and create an account</li>
                        <li>Navigate to Settings → API</li>
                        <li>Generate a new API key (starts with "pplx-")</li>
                        <li>Paste above and Save</li>
                      </ol>
                    </div>
                  </CardContent>
                </Card>

                {/* Arkham */}
                <Card className="bg-card border-border">
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-cyan-500/10 rounded-lg flex items-center justify-center">
                        <Zap className="w-5 h-5 text-cyan-400" />
                      </div>
                      <div>
                        <CardTitle className="text-base">Arkham Intelligence</CardTitle>
                        <CardDescription>On-chain whale tracking. Detects large exchange inflows/outflows from smart money. Adds ±7% confidence weight.</CardDescription>
                      </div>
                      <div className={`ml-auto text-xs font-semibold px-2 py-1 rounded-full ${settings.arkhamApiKey ? 'bg-green-500/10 text-green-500' : 'bg-secondary text-muted-foreground'}`}>
                        {settings.arkhamApiKey ? 'Active' : 'Inactive'}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-1">
                      <Label className="text-xs">API Key</Label>
                      <div className="flex gap-2">
                        <Input
                          type="password"
                          value={arkhamApiKey}
                          onChange={(e) => setArkhamApiKey(e.target.value)}
                          placeholder="Enter Arkham API key"
                          className="bg-secondary font-mono text-xs"
                        />
                        <Button
                          size="sm"
                          onClick={() => updateMutation.mutate({ arkhamApiKey: arkhamApiKey || null } as any)}
                          disabled={updateMutation.isPending || arkhamApiKey === (settings.arkhamApiKey ?? '')}
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                    <div className="rounded-lg bg-cyan-500/5 border border-cyan-500/20 p-3 space-y-1">
                      <p className="text-[11px] font-semibold text-cyan-400">How to get your Arkham API key:</p>
                      <ol className="text-[11px] text-muted-foreground space-y-0.5 list-decimal list-inside">
                        <li>Sign up at arkhamintelligence.com</li>
                        <li>Go to your profile → API Keys</li>
                        <li>Create a new key and copy it</li>
                        <li>Paste above and Save</li>
                      </ol>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            <TabsContent value="users">
              <Card className="bg-card border-border">
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div>
                      <CardTitle>User Access & Rights</CardTitle>
                      <CardDescription>Manage who can access the platform and their permissions.</CardDescription>
                    </div>
                    <Button onClick={() => { resetUserForm(); setAddUserOpen(true); }} className="gap-2" data-testid="button-add-user">
                      <UserPlus className="w-4 h-4" /> Add User
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  {accessLoading ? (
                    <div className="flex items-center justify-center p-8">
                      <Loader2 className="h-6 w-6 animate-spin text-primary" />
                    </div>
                  ) : userAccessList.length === 0 ? (
                    <div className="text-center py-12 text-muted-foreground">
                      <Users className="w-12 h-12 mx-auto mb-3 opacity-30" />
                      <p className="text-sm">No users added yet. Click "Add User" to grant access.</p>
                    </div>
                  ) : (
                    <div className="space-y-3">
                      {userAccessList.map(user => (
                        <div
                          key={user.id}
                          className="flex items-center justify-between p-4 rounded-lg border border-border bg-secondary/40 hover:bg-secondary/50 transition-colors"
                          data-testid={`user-row-${user.id}`}
                        >
                          <div className="flex items-center gap-3">
                            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                              <Mail className="w-4 h-4 text-primary" />
                            </div>
                            <div>
                              <div className="font-medium text-sm" data-testid={`text-user-email-${user.id}`}>{user.email}</div>
                              <div className="flex items-center gap-2 mt-0.5">
                                <Badge
                                  variant={user.role === 'admin' ? 'default' : user.role === 'trader' ? 'secondary' : 'outline'}
                                  className="text-[10px] h-5"
                                  data-testid={`badge-role-${user.id}`}
                                >
                                  {user.role}
                                </Badge>
                                <Badge
                                  variant={user.active ? 'outline' : 'destructive'}
                                  className="text-[10px] h-5"
                                >
                                  {user.active ? 'Active' : 'Disabled'}
                                </Badge>
                                {(user.permissions || []).length > 0 && (
                                  <span className="text-[10px] text-muted-foreground">
                                    {(user.permissions || []).length} permissions
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                          <div className="flex items-center gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0"
                              onClick={() => updateUserMutation.mutate({ id: user.id, data: { active: !user.active } })}
                              data-testid={`button-toggle-${user.id}`}
                            >
                              {user.active ? <X className="w-3.5 h-3.5 text-red-500" /> : <Check className="w-3.5 h-3.5 text-green-500" />}
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0"
                              onClick={() => openEditUser(user)}
                              data-testid={`button-edit-${user.id}`}
                            >
                              <Edit className="w-3.5 h-3.5" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              className="h-8 w-8 p-0 text-red-500 hover:text-red-400"
                              onClick={() => deleteUserMutation.mutate(user.id)}
                              disabled={deleteUserMutation.isPending}
                              data-testid={`button-delete-${user.id}`}
                            >
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        </div>
      </div>

      <Dialog open={addUserOpen} onOpenChange={(open) => { if (!open) resetUserForm(); else setAddUserOpen(true); }}>
        <DialogContent className="sm:max-w-md bg-card border-border" data-testid="dialog-user-access">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <UserPlus className="w-5 h-5 text-primary" />
              {editUser ? 'Edit User Access' : 'Add User Access'}
            </DialogTitle>
            <DialogDescription>
              {editUser ? 'Update this user\'s role and permissions.' : 'Grant a new email address access to the platform.'}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="space-y-2">
              <Label htmlFor="user-email">Email Address</Label>
              <Input
                id="user-email"
                data-testid="input-user-email"
                type="email"
                placeholder="user@example.com"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="bg-secondary/50"
                disabled={!!editUser}
              />
            </div>

            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger className="bg-secondary/50" data-testid="select-role">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {ROLES.map(r => (
                    <SelectItem key={r.value} value={r.value}>
                      <div>
                        <div className="font-medium">{r.label}</div>
                        <div className="text-xs text-muted-foreground">{r.description}</div>
                      </div>
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <Label>Permissions</Label>
              <div className="grid grid-cols-2 gap-2">
                {PERMISSIONS.map(p => (
                  <div
                    key={p.value}
                    className={`flex items-center gap-2 p-2 rounded-lg border cursor-pointer transition-colors ${
                      newPermissions.includes(p.value)
                        ? 'border-primary/50 bg-primary/10'
                        : 'border-border bg-secondary/40 hover:bg-secondary/50'
                    }`}
                    onClick={() => togglePermission(p.value)}
                    data-testid={`perm-${p.value}`}
                  >
                    <div className={`w-4 h-4 rounded border flex items-center justify-center ${
                      newPermissions.includes(p.value) ? 'bg-primary border-primary' : 'border-muted-foreground'
                    }`}>
                      {newPermissions.includes(p.value) && <Check className="w-3 h-3 text-primary-foreground" />}
                    </div>
                    <span className="text-xs">{p.label}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={resetUserForm} data-testid="button-cancel-user">Cancel</Button>
            <Button
              onClick={handleSaveUser}
              disabled={addUserMutation.isPending || updateUserMutation.isPending || !newEmail.trim()}
              data-testid="button-save-user"
            >
              {(addUserMutation.isPending || updateUserMutation.isPending) && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
              {editUser ? 'Update' : 'Add User'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
