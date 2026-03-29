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
import { Bell, Lock, Key, Globe, Shield, Loader2, Users, UserPlus, Trash2, Edit, Mail, Check, X, Brain, Activity, Zap, Palette, Sun, Moon, Plus, CheckCircle2, TrendingUp, Link, Unlink, RefreshCw } from 'lucide-react';
import type { Settings, UserAccess } from '@shared/schema';
import {
  PRESET_THEMES, ACCENT_PRESETS, getAllThemes, getActiveThemeId,
  applyTheme, saveCustomTheme, deleteCustomTheme, getCustomThemes,
  buildCustomVars, hexToHsl, type Theme, type CustomTheme,
} from '@/lib/themes';
import { cn } from '@/lib/utils';

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
  const { data: settings, isLoading, isError } = useQuery<Settings>({
    queryKey: ['/api/settings'],
    retry: 3,
  });

  const { data: userAccessList = [], isLoading: accessLoading } = useQuery<UserAccess[]>({
    queryKey: ['/api/user-access'],
  });
  const { data: goldStatus } = useQuery<any>({
    queryKey: ['/api/gold/status'],
    refetchInterval: 10000,
  });

  const [displayName, setDisplayName] = useState('');
  const [maxRiskPercent, setMaxRiskPercent] = useState('2.0');
  const [binanceApiKey, setBinanceApiKey] = useState('');
  const [bybitApiKey, setBybitApiKey] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');

  // ── Exchange (Binance / Bybit / MEXC) state ──────────────────────────────
  const [binanceApiSecret, setBinanceApiSecret] = useState('');
  const [binanceAutoTrading, setBinanceAutoTrading] = useState(false);
  const [binanceLeverage, setBinanceLeverage] = useState('10');
  const [binanceMarginType, setBinanceMarginType] = useState<'ISOLATED' | 'CROSSED'>('ISOLATED');
  const [binanceMaxPosition, setBinanceMaxPosition] = useState('100');

  const [bybitApiSecret, setBybitApiSecret] = useState('');
  const [bybitAutoTrading, setBybitAutoTrading] = useState(false);
  const [bybitLeverage, setBybitLeverage] = useState('10');
  const [bybitMarginType, setBybitMarginType] = useState<'ISOLATED' | 'CROSSED'>('ISOLATED');
  const [bybitMaxPosition, setBybitMaxPosition] = useState('100');

  const [mexcApiKey, setMexcApiKey] = useState('');
  const [mexcApiSecret, setMexcApiSecret] = useState('');
  const [mexcAutoTrading, setMexcAutoTrading] = useState(false);
  const [mexcLeverage, setMexcLeverage] = useState('10');
  const [mexcMarginType, setMexcMarginType] = useState<'ISOLATED' | 'CROSSED'>('ISOLATED');
  const [mexcMaxPosition, setMexcMaxPosition] = useState('100');

  const [binanceBalance, setBinanceBalance] = useState<{ available: number; total: number } | null>(null);
  const [bybitBalance, setBybitBalance] = useState<{ available: number; total: number } | null>(null);
  const [mexcBalance, setMexcBalance] = useState<{ available: number; total: number } | null>(null);
  const [testingExchange, setTestingExchange] = useState<string | null>(null);
  const [fetchingBalance, setFetchingBalance] = useState<string | null>(null);
  const [discordWebhookUrl, setDiscordWebhookUrl] = useState('');
  const [coinglassApiKey, setCoinglassApiKey] = useState('');
  const [perplexityApiKey, setPerplexityApiKey] = useState('');
  const [arkhamApiKey, setArkhamApiKey] = useState('');
  const [newsApiKey, setNewsApiKey] = useState('');

  // ── MT5 / Gold state ─────────────────────────────────────────────────────
  // Legacy simple MT5 login fields (used by built-in gold-trading module)
  const [mt5Login, setMt5Login] = useState('');
  const [mt5Password, setMt5Password] = useState('');
  const [mt5Server, setMt5Server] = useState('');
  const [goldRisk, setGoldRisk] = useState('1.0');
  // MetaApi advanced fields
  const [metaApiToken, setMetaApiToken] = useState('');
  const [metaApiAccountId, setMetaApiAccountId] = useState('');
  const [goldLotSize, setGoldLotSize] = useState('0.01');
  const [goldMaxDailyTrades, setGoldMaxDailyTrades] = useState('5');
  const [goldMinConfidence, setGoldMinConfidence] = useState('75');
  const [goldAutoTradingEnabled, setGoldAutoTradingEnabled] = useState(false);

  // ── Theme state ──────────────────────────────────────────────────────────
  const [activeThemeId, setActiveThemeId] = useState(getActiveThemeId);
  const [customThemes, setCustomThemes] = useState(getCustomThemes);
  const [customName, setCustomName] = useState('');
  const [customBase, setCustomBase] = useState<'light' | 'dark'>('dark');
  const [customPrimary, setCustomPrimary] = useState('#0ea5e9');

  const handleApplyTheme = (theme: Theme) => {
    applyTheme(theme);
    setActiveThemeId(theme.id);
  };

  const handleSaveCustom = () => {
    const name = customName.trim() || `Custom ${customThemes.length + 1}`;
    const id = `custom-${Date.now()}`;
    const vars = buildCustomVars(customPrimary, customBase);
    const newTheme: CustomTheme = {
      id, name, type: customBase, primaryHex: customPrimary, custom: true,
      preview: { bg: customBase === 'light' ? '#f4f6f8' : '#0f172a', card: '#ffffff', primary: customPrimary, accent2: customPrimary },
      vars,
    };
    saveCustomTheme(newTheme);
    setCustomThemes(getCustomThemes());
    handleApplyTheme(newTheme);
    setCustomName('');
    toast({ title: `Theme "${name}" saved and applied` });
  };

  const handleDeleteCustom = (id: string) => {
    deleteCustomTheme(id);
    setCustomThemes(getCustomThemes());
    if (activeThemeId === id) handleApplyTheme(PRESET_THEMES[0]);
  };

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
      setNewsApiKey((settings as any).newsApiKey ?? '');
      setMetaApiToken(settings.metaApiToken ?? '');
      setMetaApiAccountId(settings.metaApiAccountId ?? '');
      setGoldLotSize(String(settings.goldLotSize ?? 0.01));
      setGoldMaxDailyTrades(String(settings.goldMaxDailyTrades ?? 5));
      setGoldMinConfidence(String(settings.goldMinConfidence ?? 75));
      setGoldAutoTradingEnabled(settings.goldAutoTradingEnabled ?? false);
      // Exchange fields
      setBinanceApiSecret((settings as any).binanceApiSecret ?? '');
      setBinanceAutoTrading((settings as any).binanceAutoTrading ?? false);
      setBinanceLeverage(String((settings as any).binanceLeverage ?? 10));
      setBinanceMarginType((settings as any).binanceMarginType ?? 'ISOLATED');
      setBinanceMaxPosition(String((settings as any).binanceMaxPositionUsdt ?? 100));
      setBybitApiSecret((settings as any).bybitApiSecret ?? '');
      setBybitAutoTrading((settings as any).bybitAutoTrading ?? false);
      setBybitLeverage(String((settings as any).bybitLeverage ?? 10));
      setBybitMarginType((settings as any).bybitMarginType ?? 'ISOLATED');
      setBybitMaxPosition(String((settings as any).bybitMaxPositionUsdt ?? 100));
      setMexcApiKey((settings as any).mexcApiKey ?? '');
      setMexcApiSecret((settings as any).mexcApiSecret ?? '');
      setMexcAutoTrading((settings as any).mexcAutoTrading ?? false);
      setMexcLeverage(String((settings as any).mexcLeverage ?? 10));
      setMexcMarginType((settings as any).mexcMarginType ?? 'ISOLATED');
      setMexcMaxPosition(String((settings as any).mexcMaxPositionUsdt ?? 100));
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

  const testGoldSignalMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/gold/signal', { timeframe: '15m' });
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: 'Gold signal generated', description: `${data.type} XAUUSD | conf ${data.confidence}%` });
    },
    onError: (error: Error) => {
      toast({ title: 'Gold signal failed', description: error.message, variant: 'destructive' });
    },
  });

  const connectMt5Mutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/gold/mt5/connect', { login: mt5Login, password: mt5Password, server: mt5Server });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/gold/status'] });
      toast({ title: data.ok ? 'MT5 connected' : 'MT5 failed', description: data.message, variant: data.ok ? 'default' : 'destructive' as any });
    },
  });

  const autoGoldMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await apiRequest('PATCH', '/api/gold/auto-trading', { enabled, maxRiskPercent: parseFloat(goldRisk) || 1.0 });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/gold/status'] });
      toast({ title: data.message });
    },
  });

  const runAutoGoldMutation = useMutation({
    mutationFn: async () => {
      const res = await apiRequest('POST', '/api/gold/auto-trade/run');
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: data.ok ? 'Gold auto trade executed' : 'Gold auto trade blocked', description: data.message, variant: data.ok ? 'default' : 'destructive' as any });
    },
  });

  const testExchangeConnection = async (exchange: 'binance' | 'bybit' | 'mexc') => {
    setTestingExchange(exchange);
    try {
      const res = await apiRequest('POST', `/api/exchange/${exchange}/test`);
      const data = await res.json();
      if (data.ok) {
        queryClient.invalidateQueries({ queryKey: ['/api/settings'] });
        if (data.balance) {
          const bal = { available: data.balance.availableBalance, total: data.balance.totalWalletBalance };
          if (exchange === 'binance') setBinanceBalance(bal);
          else if (exchange === 'bybit') setBybitBalance(bal);
          else setMexcBalance(bal);
        }
        toast({ title: `${exchange.charAt(0).toUpperCase() + exchange.slice(1)} connected!`, description: data.message });
      } else {
        toast({ title: 'Connection failed', description: data.message, variant: 'destructive' });
      }
    } catch (e: any) {
      toast({ title: 'Connection error', description: e.message, variant: 'destructive' });
    } finally {
      setTestingExchange(null);
    }
  };

  const fetchExchangeBalance = async (exchange: 'binance' | 'bybit' | 'mexc') => {
    setFetchingBalance(exchange);
    try {
      const res = await apiRequest('GET', `/api/exchange/${exchange}/balance`);
      const data = await res.json();
      if (data.ok) {
        const bal = { available: data.availableBalance, total: data.totalWalletBalance };
        if (exchange === 'binance') setBinanceBalance(bal);
        else if (exchange === 'bybit') setBybitBalance(bal);
        else setMexcBalance(bal);
      }
    } catch {} finally {
      setFetchingBalance(null);
    }
  };

  const saveExchangeSettings = (exchange: 'binance' | 'bybit' | 'mexc') => {
    if (exchange === 'binance') {
      updateMutation.mutate({
        binanceApiKey,
        binanceApiSecret,
        binanceAutoTrading,
        binanceLeverage: parseInt(binanceLeverage) || 10,
        binanceMarginType,
        binanceMaxPositionUsdt: parseFloat(binanceMaxPosition) || 100,
      } as any);
    } else if (exchange === 'bybit') {
      updateMutation.mutate({
        bybitApiKey,
        bybitApiSecret,
        bybitAutoTrading,
        bybitLeverage: parseInt(bybitLeverage) || 10,
        bybitMarginType,
        bybitMaxPositionUsdt: parseFloat(bybitMaxPosition) || 100,
      } as any);
    } else {
      updateMutation.mutate({
        mexcApiKey,
        mexcApiSecret,
        mexcAutoTrading,
        mexcLeverage: parseInt(mexcLeverage) || 10,
        mexcMarginType,
        mexcMaxPositionUsdt: parseFloat(mexcMaxPosition) || 100,
      } as any);
    }
  };

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

  if (isError) {
    return (
      <div className="min-h-screen bg-background text-foreground font-sans flex">
        <Sidebar />
        <div className="flex-1 md:pl-64 flex flex-col items-center justify-center gap-4">
          <div className="text-destructive text-lg font-semibold">Failed to load settings</div>
          <p className="text-muted-foreground text-sm">Check your database connection and try refreshing.</p>
          <Button onClick={() => window.location.reload()} variant="outline">Retry</Button>
        </div>
      </div>
    );
  }

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
            <TabsList className="mb-6 bg-secondary flex-wrap h-auto gap-0.5 p-1">
              <TabsTrigger value="general" data-testid="tab-general">General</TabsTrigger>
              <TabsTrigger value="api" data-testid="tab-api">API Keys</TabsTrigger>
              <TabsTrigger value="trading" data-testid="tab-trading">Trading</TabsTrigger>
              <TabsTrigger value="notifications" data-testid="tab-notifications">Notifications</TabsTrigger>
              <TabsTrigger value="themes" data-testid="tab-themes">
                <Palette className="w-3.5 h-3.5 mr-1.5" />
                Themes
              </TabsTrigger>
              <TabsTrigger value="ai-agents" data-testid="tab-ai-agents">
                <Brain className="w-3.5 h-3.5 mr-1.5" />
                AI Agents
              </TabsTrigger>
              <TabsTrigger value="mt5" data-testid="tab-mt5">
                <Activity className="w-3.5 h-3.5 mr-1.5" />
                MT5 / Gold
              </TabsTrigger>
              <TabsTrigger value="exchanges" data-testid="tab-exchanges">
                <TrendingUp className="w-3.5 h-3.5 mr-1.5" />
                Exchanges
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
              <Card className="bg-card border-border mb-6">
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

              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle>Gold (XAUUSD) + MT5 Auto Trading</CardTitle>
                  <CardDescription>Connect MT5 bridge (paper mode), generate gold signals, and toggle auto trading.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <Input placeholder="MT5 Login" value={mt5Login} onChange={(e) => setMt5Login(e.target.value)} />
                    <Input placeholder="MT5 Password" type="password" value={mt5Password} onChange={(e) => setMt5Password(e.target.value)} />
                    <Input placeholder="MT5 Server" value={mt5Server} onChange={(e) => setMt5Server(e.target.value)} />
                  </div>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => connectMt5Mutation.mutate()} disabled={connectMt5Mutation.isPending}>Connect MT5</Button>
                    <Button variant="outline" onClick={() => autoGoldMutation.mutate(!(goldStatus?.auto?.enabled))} disabled={autoGoldMutation.isPending}>
                      {goldStatus?.auto?.enabled ? 'Disable' : 'Enable'} Auto Trading
                    </Button>
                    <Button variant="outline" onClick={() => testGoldSignalMutation.mutate()} disabled={testGoldSignalMutation.isPending}>Generate Gold Signal</Button>
                    <Button variant="secondary" onClick={() => runAutoGoldMutation.mutate()} disabled={runAutoGoldMutation.isPending}>Run Auto Trade</Button>
                  </div>
                  <div className="flex items-center gap-2">
                    <Label>Gold Risk %</Label>
                    <Input className="max-w-32" value={goldRisk} onChange={(e) => setGoldRisk(e.target.value)} />
                  </div>
                  <div className="text-xs text-muted-foreground">
                    MT5: <span className={goldStatus?.mt5?.connected ? 'text-green-500' : 'text-red-500'}>{goldStatus?.mt5?.connected ? 'Connected' : 'Disconnected'}</span>
                    {' '}| Auto: <span className={goldStatus?.auto?.enabled ? 'text-green-500' : 'text-red-500'}>{goldStatus?.auto?.enabled ? 'Enabled' : 'Disabled'}</span>
                    {' '}| Mode: Paper
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

            {/* ── THEMES TAB ──────────────────────────────────────────────── */}
            <TabsContent value="themes">
              <div className="space-y-6">

                {/* Preset gallery */}
                <Card className="bg-card border-border">
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                        <Palette className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <CardTitle>Preset Themes</CardTitle>
                        <CardDescription>Click any theme to apply it instantly across the entire app.</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                      {PRESET_THEMES.map(theme => {
                        const isActive = activeThemeId === theme.id;
                        return (
                          <button
                            key={theme.id}
                            onClick={() => handleApplyTheme(theme)}
                            className={cn(
                              'group relative rounded-xl border-2 overflow-hidden text-left transition-all hover:scale-[1.02]',
                              isActive ? 'border-primary ring-2 ring-primary/30' : 'border-border hover:border-primary/40'
                            )}
                            data-testid={`theme-${theme.id}`}
                          >
                            {/* Preview swatch */}
                            <div className="h-20 relative" style={{ background: theme.preview.bg }}>
                              {/* Fake sidebar strip */}
                              <div className="absolute left-0 top-0 bottom-0 w-8" style={{ background: theme.type === 'light' ? '#e8edf3' : `${theme.preview.bg}cc` }} />
                              {/* Fake card */}
                              <div className="absolute left-10 top-3 right-3 h-8 rounded-md shadow-sm" style={{ background: theme.preview.card, border: '1px solid rgba(0,0,0,0.08)' }}>
                                {/* Primary accent bar */}
                                <div className="h-1.5 rounded-t-md" style={{ background: theme.preview.primary }} />
                                {/* Fake text lines */}
                                <div className="flex gap-1 p-1.5">
                                  <div className="h-1.5 w-8 rounded-full" style={{ background: theme.preview.primary + '80' }} />
                                  <div className="h-1.5 w-12 rounded-full" style={{ background: theme.preview.accent2 + '40' }} />
                                </div>
                              </div>
                              {/* Fake nav items */}
                              {[0,1,2].map(i => (
                                <div key={i} className="absolute left-1.5 rounded" style={{ top: `${12 + i * 14}px`, width: '18px', height: '8px', background: i === 0 ? theme.preview.primary + 'aa' : theme.preview.accent2 + '30' }} />
                              ))}
                              {/* Active check */}
                              {isActive && (
                                <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                                  <Check className="w-3 h-3 text-white" />
                                </div>
                              )}
                            </div>
                            {/* Label */}
                            <div className="px-2.5 py-2 bg-card border-t border-border/50 flex items-center justify-between">
                              <span className="text-xs font-semibold text-foreground truncate">{theme.name}</span>
                              <span className={cn('text-[9px] px-1.5 py-0.5 rounded-full font-bold uppercase flex items-center gap-0.5', theme.type === 'light' ? 'bg-yellow-100 text-yellow-700' : 'bg-slate-700 text-slate-200')}>
                                {theme.type === 'light' ? <Sun className="w-2.5 h-2.5" /> : <Moon className="w-2.5 h-2.5" />}
                                {theme.type}
                              </span>
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>

                {/* Custom themes list */}
                {customThemes.length > 0 && (
                  <Card className="bg-card border-border">
                    <CardHeader>
                      <CardTitle className="text-base">Your Custom Themes</CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                        {customThemes.map(theme => {
                          const isActive = activeThemeId === theme.id;
                          return (
                            <div key={theme.id} className={cn('relative group rounded-xl border-2 overflow-hidden', isActive ? 'border-primary' : 'border-border')}>
                              <button
                                onClick={() => handleApplyTheme(theme)}
                                className="w-full text-left"
                              >
                                <div className="h-16 flex items-center justify-center" style={{ background: theme.type === 'light' ? '#f4f6f8' : '#0f172a' }}>
                                  <div className="w-8 h-8 rounded-full shadow-md" style={{ background: theme.primaryHex }} />
                                  {isActive && (
                                    <div className="absolute top-1.5 right-1.5 w-5 h-5 rounded-full bg-primary flex items-center justify-center">
                                      <Check className="w-3 h-3 text-white" />
                                    </div>
                                  )}
                                </div>
                                <div className="px-2.5 py-1.5 bg-card border-t border-border/50">
                                  <div className="text-xs font-semibold truncate">{theme.name}</div>
                                  <div className="text-[9px] text-muted-foreground capitalize">{theme.type} · custom</div>
                                </div>
                              </button>
                              <button
                                onClick={() => handleDeleteCustom(theme.id)}
                                className="absolute top-1 left-1 w-5 h-5 rounded-full bg-destructive/80 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                              >
                                <X className="w-2.5 h-2.5" />
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>
                )}

                {/* Custom theme builder */}
                <Card className="bg-card border-border">
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                        <Plus className="w-5 h-5 text-primary" />
                      </div>
                      <div>
                        <CardTitle>Build Custom Theme</CardTitle>
                        <CardDescription>Choose a base style and accent colour to create your own unique theme.</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    {/* Name */}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Theme Name</Label>
                      <Input
                        value={customName}
                        onChange={e => setCustomName(e.target.value)}
                        placeholder="My Custom Theme"
                        className="bg-secondary/50 max-w-xs"
                      />
                    </div>

                    {/* Base style */}
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold">Base Style</Label>
                      <div className="flex gap-3">
                        {(['light', 'dark'] as const).map(type => (
                          <button
                            key={type}
                            onClick={() => setCustomBase(type)}
                            className={cn(
                              'flex items-center gap-2 px-4 py-2.5 rounded-lg border-2 text-sm font-medium transition-all',
                              customBase === type ? 'border-primary bg-primary/8 text-primary' : 'border-border hover:border-primary/40'
                            )}
                          >
                            {type === 'light' ? <Sun className="w-4 h-4" /> : <Moon className="w-4 h-4" />}
                            {type === 'light' ? 'Light' : 'Dark'}
                            {customBase === type && <CheckCircle2 className="w-3.5 h-3.5" />}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* Accent colour presets */}
                    <div className="space-y-2">
                      <Label className="text-xs font-semibold">Accent Colour</Label>
                      <div className="flex flex-wrap gap-2">
                        {ACCENT_PRESETS.map(ac => (
                          <button
                            key={ac.hex}
                            title={ac.label}
                            onClick={() => setCustomPrimary(ac.hex)}
                            className={cn(
                              'w-8 h-8 rounded-full border-2 transition-all hover:scale-110',
                              customPrimary === ac.hex ? 'border-foreground scale-110 ring-2 ring-offset-1 ring-foreground/30' : 'border-transparent'
                            )}
                            style={{ background: ac.hex }}
                          />
                        ))}
                      </div>
                      {/* Manual hex input */}
                      <div className="flex items-center gap-2 mt-1">
                        <div className="w-7 h-7 rounded-lg border border-border" style={{ background: customPrimary }} />
                        <Input
                          type="color"
                          value={customPrimary}
                          onChange={e => setCustomPrimary(e.target.value)}
                          className="w-10 h-7 p-0.5 rounded cursor-pointer border border-border"
                          title="Pick any colour"
                        />
                        <Input
                          value={customPrimary}
                          onChange={e => {
                            const v = e.target.value;
                            if (/^#[0-9a-fA-F]{0,6}$/.test(v)) setCustomPrimary(v);
                          }}
                          className="bg-secondary/50 font-mono text-xs w-28"
                          placeholder="#0ea5e9"
                          maxLength={7}
                        />
                        <span className="text-[10px] text-muted-foreground font-mono">HSL: {hexToHsl(customPrimary.length === 7 ? customPrimary : '#0ea5e9')}</span>
                      </div>
                    </div>

                    {/* Live preview */}
                    <div className="space-y-1.5">
                      <Label className="text-xs font-semibold">Preview</Label>
                      <div className="rounded-xl border border-border overflow-hidden h-24 flex" style={{ background: customBase === 'light' ? '#f4f6f8' : '#0f172a' }}>
                        {/* Fake sidebar */}
                        <div className="w-14 border-r flex flex-col gap-1 p-2" style={{ background: customBase === 'light' ? '#eef1f6' : '#0a1020', borderColor: customBase === 'light' ? '#dce3ec' : '#1e2a40' }}>
                          <div className="w-6 h-6 rounded-lg mb-1" style={{ background: customPrimary }} />
                          {[0,1,2,3].map(i => (
                            <div key={i} className="h-2 rounded-full" style={{ width: `${70 - i * 10}%`, background: i === 0 ? customPrimary + 'aa' : (customBase === 'light' ? '#cbd5e1' : '#334155') }} />
                          ))}
                        </div>
                        {/* Fake content */}
                        <div className="flex-1 p-3 space-y-2">
                          <div className="h-4 rounded" style={{ width: '60%', background: customPrimary + '30' }} />
                          <div className="flex gap-2">
                            {[1,2,3].map(i => (
                              <div key={i} className="flex-1 h-8 rounded-lg border" style={{ background: customBase === 'light' ? '#fff' : '#1e293b', borderColor: customBase === 'light' ? '#e2e8f0' : '#334155' }}>
                                <div className="h-1 rounded-t-lg" style={{ background: i === 1 ? customPrimary : (customBase === 'light' ? '#e2e8f0' : '#334155') }} />
                              </div>
                            ))}
                          </div>
                          <div className="flex gap-1">
                            <div className="h-2 rounded-full w-16" style={{ background: customPrimary }} />
                            <div className="h-2 rounded-full w-10" style={{ background: customBase === 'light' ? '#cbd5e1' : '#475569' }} />
                          </div>
                        </div>
                      </div>
                    </div>

                    <Button onClick={handleSaveCustom} className="gap-2">
                      <Plus className="w-4 h-4" />
                      Save & Apply Custom Theme
                    </Button>
                  </CardContent>
                </Card>
              </div>
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
                        { label: 'NewsAPI', desc: 'Live news impact on signals', color: 'text-blue-400', bg: 'bg-blue-500/10', Icon: Globe, active: !!(settings as any).newsApiKey },
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

                {/* NewsAPI */}
                <Card className="bg-card border-border">
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-blue-500/10 rounded-lg flex items-center justify-center">
                        <Globe className="w-5 h-5 text-blue-400" />
                      </div>
                      <div>
                        <CardTitle className="text-base">NewsAPI — Live News Impact</CardTitle>
                        <CardDescription>Real-time news articles for each coin. Feeds headline sentiment into Claude signal analysis. Powers the news bar on the dashboard.</CardDescription>
                      </div>
                      <div className={`ml-auto text-xs font-semibold px-2 py-1 rounded-full ${(settings as any).newsApiKey ? 'bg-green-500/10 text-green-500' : 'bg-secondary text-muted-foreground'}`}>
                        {(settings as any).newsApiKey ? 'Active' : 'Inactive'}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="space-y-1">
                      <Label className="text-xs">API Key</Label>
                      <div className="flex gap-2">
                        <Input
                          type="password"
                          value={newsApiKey}
                          onChange={(e) => setNewsApiKey(e.target.value)}
                          placeholder="Enter NewsAPI key..."
                          className="bg-secondary font-mono text-xs"
                        />
                        <Button
                          size="sm"
                          onClick={() => updateMutation.mutate({ newsApiKey: newsApiKey || null } as any)}
                          disabled={updateMutation.isPending || newsApiKey === ((settings as any).newsApiKey ?? '')}
                        >
                          Save
                        </Button>
                      </div>
                    </div>
                    <div className="rounded-lg bg-blue-500/5 border border-blue-500/20 p-3 space-y-1">
                      <p className="text-[11px] font-semibold text-blue-400">How to get your NewsAPI key:</p>
                      <ol className="text-[11px] text-muted-foreground space-y-0.5 list-decimal list-inside">
                        <li>Sign up free at newsapi.org</li>
                        <li>Your API key is shown on the dashboard after registration</li>
                        <li>Paste above and Save — news will appear on the dashboard immediately</li>
                      </ol>
                    </div>
                    <div className="rounded-lg bg-secondary/40 border border-border p-3">
                      <p className="text-[11px] text-muted-foreground">
                        <span className="font-semibold text-foreground">What this powers:</span> News ticker bar below every chart, per-coin headline sentiment injection into Claude AI signal analysis, X/social sentiment layer in market intelligence.
                      </p>
                    </div>
                  </CardContent>
                </Card>
              </div>
            </TabsContent>

            {/* ── MT5 / GOLD TAB ─────────────────────────────────────────── */}
            <TabsContent value="mt5">
              <div className="space-y-4">

                {/* MetaApi connection */}
                <Card className="bg-card border-border">
                  <CardHeader>
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-amber-500/10 rounded-lg flex items-center justify-center">
                        <span className="text-xl leading-none">🥇</span>
                      </div>
                      <div>
                        <CardTitle>MT5 Connection (MetaApi)</CardTitle>
                        <CardDescription>Connect your MetaTrader 5 account via MetaApi cloud to enable gold auto-trading.</CardDescription>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="rounded-lg bg-amber-500/5 border border-amber-500/20 p-3 text-xs text-amber-800 space-y-1">
                      <p className="font-semibold">How to connect:</p>
                      <ol className="list-decimal list-inside space-y-0.5 text-muted-foreground">
                        <li>Register free at <span className="font-medium text-amber-700">metaapi.cloud</span></li>
                        <li>Add your MT5 account in MetaApi dashboard</li>
                        <li>Install the MetaApi EA on your MT5 terminal</li>
                        <li>Copy your API Token and Account ID below</li>
                      </ol>
                    </div>
                    <div className="space-y-2">
                      <Label>MetaApi Token</Label>
                      <Input
                        type="password"
                        placeholder="Your MetaApi auth token..."
                        value={metaApiToken}
                        onChange={(e) => setMetaApiToken(e.target.value)}
                        className="bg-secondary/50 font-mono text-xs"
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>MetaApi Account ID</Label>
                      <Input
                        placeholder="e.g. abc123def456..."
                        value={metaApiAccountId}
                        onChange={(e) => setMetaApiAccountId(e.target.value)}
                        className="bg-secondary/50 font-mono text-xs"
                      />
                    </div>
                    <Button
                      onClick={() => updateMutation.mutate({ metaApiToken, metaApiAccountId })}
                      disabled={updateMutation.isPending}
                      className="gap-2"
                    >
                      {updateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                      Save MT5 Credentials
                    </Button>
                  </CardContent>
                </Card>

                {/* Gold trading settings */}
                <Card className="bg-card border-border">
                  <CardHeader>
                    <CardTitle>Gold Auto-Trading Settings</CardTitle>
                    <CardDescription>Configure how the bot trades XAUUSD (Gold) automatically.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-5">
                    <div className="flex items-center justify-between py-2 border-b border-border">
                      <div>
                        <Label className="font-semibold">Enable Auto Trading</Label>
                        <p className="text-xs text-muted-foreground mt-0.5">Bot will automatically execute gold signals via MT5</p>
                      </div>
                      <Switch
                        checked={goldAutoTradingEnabled}
                        onCheckedChange={(v) => {
                          setGoldAutoTradingEnabled(v);
                          updateMutation.mutate({ goldAutoTradingEnabled: v });
                        }}
                      />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <div className="space-y-2">
                        <Label>Lot Size</Label>
                        <Input
                          type="number"
                          step="0.01"
                          min="0.01"
                          max="10"
                          value={goldLotSize}
                          onChange={(e) => setGoldLotSize(e.target.value)}
                          className="bg-secondary/50"
                        />
                        <p className="text-[11px] text-muted-foreground">Standard lots (0.01 = micro)</p>
                      </div>
                      <div className="space-y-2">
                        <Label>Max Daily Trades</Label>
                        <Input
                          type="number"
                          min="1"
                          max="20"
                          value={goldMaxDailyTrades}
                          onChange={(e) => setGoldMaxDailyTrades(e.target.value)}
                          className="bg-secondary/50"
                        />
                        <p className="text-[11px] text-muted-foreground">Maximum trades per day</p>
                      </div>
                      <div className="space-y-2">
                        <Label>Min AI Confidence (%)</Label>
                        <Input
                          type="number"
                          min="50"
                          max="95"
                          value={goldMinConfidence}
                          onChange={(e) => setGoldMinConfidence(e.target.value)}
                          className="bg-secondary/50"
                        />
                        <p className="text-[11px] text-muted-foreground">Only trade above this threshold</p>
                      </div>
                    </div>
                    <Button
                      onClick={() => updateMutation.mutate({
                        goldLotSize: parseFloat(goldLotSize) || 0.01,
                        goldMaxDailyTrades: parseInt(goldMaxDailyTrades) || 5,
                        goldMinConfidence: parseInt(goldMinConfidence) || 75,
                      })}
                      disabled={updateMutation.isPending}
                      className="gap-2"
                    >
                      {updateMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                      Save Gold Settings
                    </Button>
                  </CardContent>
                </Card>

              </div>
            </TabsContent>

            {/* ── EXCHANGES TAB ───────────────────────────────────────── */}
            <TabsContent value="exchanges">
              <div className="space-y-5">
                <div className="text-sm text-muted-foreground bg-secondary/40 rounded-lg p-3 border border-border">
                  Connect your exchange accounts to enable auto-trading. API keys are stored encrypted and used only to place orders you approve.
                </div>

                {/* ── BINANCE ── */}
                {(() => {
                  const isConnected = !!(settings as any)?.binanceConnected;
                  const isTesting = testingExchange === 'binance';
                  const isFetching = fetchingBalance === 'binance';
                  return (
                    <Card className="bg-card border-border">
                      <CardHeader>
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-yellow-500/10 rounded-lg flex items-center justify-center">
                            <TrendingUp className="w-5 h-5 text-yellow-500" />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <CardTitle className="text-base">Binance Futures</CardTitle>
                              <Badge variant={isConnected ? 'default' : 'secondary'} className={`text-[10px] h-5 ${isConnected ? 'bg-green-500/20 text-green-400 border-green-500/30' : ''}`}>
                                {isConnected ? '● Connected' : '○ Disconnected'}
                              </Badge>
                            </div>
                            <CardDescription>USDⓈ-M Perpetual Futures — fapi.binance.com</CardDescription>
                          </div>
                          {isConnected && (
                            <Button size="sm" variant="ghost" onClick={() => fetchExchangeBalance('binance')} disabled={isFetching} className="gap-1 text-xs">
                              <RefreshCw className={`w-3 h-3 ${isFetching ? 'animate-spin' : ''}`} />
                              {binanceBalance ? `$${binanceBalance.available.toFixed(2)}` : 'Balance'}
                            </Button>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {binanceBalance && (
                          <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-green-500/5 border border-green-500/20">
                            <div><p className="text-[11px] text-muted-foreground">Available Balance</p><p className="text-sm font-bold text-green-400">${binanceBalance.available.toFixed(2)} USDT</p></div>
                            <div><p className="text-[11px] text-muted-foreground">Total Wallet</p><p className="text-sm font-bold">${binanceBalance.total.toFixed(2)} USDT</p></div>
                          </div>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">API Key</Label>
                            <Input type="password" value={binanceApiKey} onChange={(e) => setBinanceApiKey(e.target.value)} placeholder="Binance API Key" className="bg-secondary/50 font-mono text-xs" />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">API Secret</Label>
                            <Input type="password" value={binanceApiSecret} onChange={(e) => setBinanceApiSecret(e.target.value)} placeholder="Binance API Secret" className="bg-secondary/50 font-mono text-xs" />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">Leverage (1–125x)</Label>
                            <Input type="number" min="1" max="125" value={binanceLeverage} onChange={(e) => setBinanceLeverage(e.target.value)} className="bg-secondary/50" />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Margin Type</Label>
                            <div className="flex gap-2">
                              {(['ISOLATED', 'CROSSED'] as const).map(t => (
                                <button key={t} onClick={() => setBinanceMarginType(t)} className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-all ${binanceMarginType === t ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/40'}`}>{t}</button>
                              ))}
                            </div>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Max Position (USDT)</Label>
                            <Input type="number" min="10" value={binanceMaxPosition} onChange={(e) => setBinanceMaxPosition(e.target.value)} className="bg-secondary/50" />
                          </div>
                        </div>
                        <div className="flex items-center justify-between py-2 border-t border-border">
                          <div>
                            <Label className="text-sm font-semibold">Auto-Trading</Label>
                            <p className="text-xs text-muted-foreground">Automatically execute signals on Binance Futures</p>
                          </div>
                          <Switch checked={binanceAutoTrading} onCheckedChange={setBinanceAutoTrading} />
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          <Button size="sm" onClick={() => saveExchangeSettings('binance')} disabled={updateMutation.isPending} className="gap-1.5">
                            {updateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                            Save Settings
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => { saveExchangeSettings('binance'); setTimeout(() => testExchangeConnection('binance'), 500); }} disabled={isTesting || !binanceApiKey || !binanceApiSecret} className="gap-1.5">
                            {isTesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link className="w-3 h-3" />}
                            {isTesting ? 'Testing…' : 'Test Connection'}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })()}

                {/* ── BYBIT ── */}
                {(() => {
                  const isConnected = !!(settings as any)?.bybitConnected;
                  const isTesting = testingExchange === 'bybit';
                  const isFetching = fetchingBalance === 'bybit';
                  return (
                    <Card className="bg-card border-border">
                      <CardHeader>
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-orange-500/10 rounded-lg flex items-center justify-center">
                            <TrendingUp className="w-5 h-5 text-orange-500" />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <CardTitle className="text-base">Bybit Futures</CardTitle>
                              <Badge variant={isConnected ? 'default' : 'secondary'} className={`text-[10px] h-5 ${isConnected ? 'bg-green-500/20 text-green-400 border-green-500/30' : ''}`}>
                                {isConnected ? '● Connected' : '○ Disconnected'}
                              </Badge>
                            </div>
                            <CardDescription>Linear Perpetuals — api.bybit.com V5</CardDescription>
                          </div>
                          {isConnected && (
                            <Button size="sm" variant="ghost" onClick={() => fetchExchangeBalance('bybit')} disabled={isFetching} className="gap-1 text-xs">
                              <RefreshCw className={`w-3 h-3 ${isFetching ? 'animate-spin' : ''}`} />
                              {bybitBalance ? `$${bybitBalance.available.toFixed(2)}` : 'Balance'}
                            </Button>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {bybitBalance && (
                          <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-green-500/5 border border-green-500/20">
                            <div><p className="text-[11px] text-muted-foreground">Available Balance</p><p className="text-sm font-bold text-green-400">${bybitBalance.available.toFixed(2)} USDT</p></div>
                            <div><p className="text-[11px] text-muted-foreground">Total Wallet</p><p className="text-sm font-bold">${bybitBalance.total.toFixed(2)} USDT</p></div>
                          </div>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">API Key</Label>
                            <Input type="password" value={bybitApiKey} onChange={(e) => setBybitApiKey(e.target.value)} placeholder="Bybit API Key" className="bg-secondary/50 font-mono text-xs" />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">API Secret</Label>
                            <Input type="password" value={bybitApiSecret} onChange={(e) => setBybitApiSecret(e.target.value)} placeholder="Bybit API Secret" className="bg-secondary/50 font-mono text-xs" />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">Leverage (1–100x)</Label>
                            <Input type="number" min="1" max="100" value={bybitLeverage} onChange={(e) => setBybitLeverage(e.target.value)} className="bg-secondary/50" />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Margin Type</Label>
                            <div className="flex gap-2">
                              {(['ISOLATED', 'CROSSED'] as const).map(t => (
                                <button key={t} onClick={() => setBybitMarginType(t)} className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-all ${bybitMarginType === t ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/40'}`}>{t}</button>
                              ))}
                            </div>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Max Position (USDT)</Label>
                            <Input type="number" min="10" value={bybitMaxPosition} onChange={(e) => setBybitMaxPosition(e.target.value)} className="bg-secondary/50" />
                          </div>
                        </div>
                        <div className="flex items-center justify-between py-2 border-t border-border">
                          <div>
                            <Label className="text-sm font-semibold">Auto-Trading</Label>
                            <p className="text-xs text-muted-foreground">Automatically execute signals on Bybit Futures</p>
                          </div>
                          <Switch checked={bybitAutoTrading} onCheckedChange={setBybitAutoTrading} />
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          <Button size="sm" onClick={() => saveExchangeSettings('bybit')} disabled={updateMutation.isPending} className="gap-1.5">
                            {updateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                            Save Settings
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => { saveExchangeSettings('bybit'); setTimeout(() => testExchangeConnection('bybit'), 500); }} disabled={isTesting || !bybitApiKey || !bybitApiSecret} className="gap-1.5">
                            {isTesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link className="w-3 h-3" />}
                            {isTesting ? 'Testing…' : 'Test Connection'}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })()}

                {/* ── MEXC ── */}
                {(() => {
                  const isConnected = !!(settings as any)?.mexcConnected;
                  const isTesting = testingExchange === 'mexc';
                  const isFetching = fetchingBalance === 'mexc';
                  return (
                    <Card className="bg-card border-border">
                      <CardHeader>
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 bg-blue-500/10 rounded-lg flex items-center justify-center">
                            <TrendingUp className="w-5 h-5 text-blue-500" />
                          </div>
                          <div className="flex-1">
                            <div className="flex items-center gap-2">
                              <CardTitle className="text-base">MEXC Futures</CardTitle>
                              <Badge variant={isConnected ? 'default' : 'secondary'} className={`text-[10px] h-5 ${isConnected ? 'bg-green-500/20 text-green-400 border-green-500/30' : ''}`}>
                                {isConnected ? '● Connected' : '○ Disconnected'}
                              </Badge>
                            </div>
                            <CardDescription>Perpetual Contracts — contract.mexc.com</CardDescription>
                          </div>
                          {isConnected && (
                            <Button size="sm" variant="ghost" onClick={() => fetchExchangeBalance('mexc')} disabled={isFetching} className="gap-1 text-xs">
                              <RefreshCw className={`w-3 h-3 ${isFetching ? 'animate-spin' : ''}`} />
                              {mexcBalance ? `$${mexcBalance.available.toFixed(2)}` : 'Balance'}
                            </Button>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        {mexcBalance && (
                          <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-green-500/5 border border-green-500/20">
                            <div><p className="text-[11px] text-muted-foreground">Available Balance</p><p className="text-sm font-bold text-green-400">${mexcBalance.available.toFixed(2)} USDT</p></div>
                            <div><p className="text-[11px] text-muted-foreground">Total Wallet</p><p className="text-sm font-bold">${mexcBalance.total.toFixed(2)} USDT</p></div>
                          </div>
                        )}
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">API Key</Label>
                            <Input type="password" value={mexcApiKey} onChange={(e) => setMexcApiKey(e.target.value)} placeholder="MEXC API Key" className="bg-secondary/50 font-mono text-xs" />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">API Secret</Label>
                            <Input type="password" value={mexcApiSecret} onChange={(e) => setMexcApiSecret(e.target.value)} placeholder="MEXC API Secret" className="bg-secondary/50 font-mono text-xs" />
                          </div>
                        </div>
                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                          <div className="space-y-1">
                            <Label className="text-xs">Leverage (1–100x)</Label>
                            <Input type="number" min="1" max="100" value={mexcLeverage} onChange={(e) => setMexcLeverage(e.target.value)} className="bg-secondary/50" />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Margin Type</Label>
                            <div className="flex gap-2">
                              {(['ISOLATED', 'CROSSED'] as const).map(t => (
                                <button key={t} onClick={() => setMexcMarginType(t)} className={`flex-1 py-2 text-xs font-medium rounded-lg border transition-all ${mexcMarginType === t ? 'border-primary bg-primary/10 text-primary' : 'border-border hover:border-primary/40'}`}>{t}</button>
                              ))}
                            </div>
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Max Position (USDT)</Label>
                            <Input type="number" min="10" value={mexcMaxPosition} onChange={(e) => setMexcMaxPosition(e.target.value)} className="bg-secondary/50" />
                          </div>
                        </div>
                        <div className="flex items-center justify-between py-2 border-t border-border">
                          <div>
                            <Label className="text-sm font-semibold">Auto-Trading</Label>
                            <p className="text-xs text-muted-foreground">Automatically execute signals on MEXC Futures</p>
                          </div>
                          <Switch checked={mexcAutoTrading} onCheckedChange={setMexcAutoTrading} />
                        </div>
                        <div className="flex gap-2 flex-wrap">
                          <Button size="sm" onClick={() => saveExchangeSettings('mexc')} disabled={updateMutation.isPending} className="gap-1.5">
                            {updateMutation.isPending ? <Loader2 className="w-3 h-3 animate-spin" /> : null}
                            Save Settings
                          </Button>
                          <Button size="sm" variant="outline" onClick={() => { saveExchangeSettings('mexc'); setTimeout(() => testExchangeConnection('mexc'), 500); }} disabled={isTesting || !mexcApiKey || !mexcApiSecret} className="gap-1.5">
                            {isTesting ? <Loader2 className="w-3 h-3 animate-spin" /> : <Link className="w-3 h-3" />}
                            {isTesting ? 'Testing…' : 'Test Connection'}
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })()}
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
