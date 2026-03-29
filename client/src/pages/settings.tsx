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
import { Bell, Lock, Key, Globe, Shield, Loader2, Users, UserPlus, Trash2, Edit, Mail, Check, X } from 'lucide-react';
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
  const { data: goldStatus } = useQuery<any>({
    queryKey: ['/api/gold/status'],
    refetchInterval: 10000,
  });

  const [displayName, setDisplayName] = useState('');
  const [maxRiskPercent, setMaxRiskPercent] = useState('2.0');
  const [binanceApiKey, setBinanceApiKey] = useState('');
  const [bybitApiKey, setBybitApiKey] = useState('');
  const [telegramChatId, setTelegramChatId] = useState('');
  const [goldMt5Login, setGoldMt5Login] = useState('');
  const [goldMt5Password, setGoldMt5Password] = useState('');
  const [goldMt5Server, setGoldMt5Server] = useState('');
  const [goldRiskPercent, setGoldRiskPercent] = useState('1.0');

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
      const res = await apiRequest('POST', '/api/gold/mt5/connect', {
        login: goldMt5Login,
        password: goldMt5Password,
        server: goldMt5Server,
      });
      return res.json();
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/gold/status'] });
      toast({ title: data.ok ? 'MT5 connected' : 'MT5 failed', description: data.message, variant: data.ok ? 'default' : 'destructive' as any });
    },
  });

  const autoGoldMutation = useMutation({
    mutationFn: async (enabled: boolean) => {
      const res = await apiRequest('PATCH', '/api/gold/auto-trading', {
        enabled,
        maxRiskPercent: parseFloat(goldRiskPercent) || 1.0,
      });
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
            <TabsList className="mb-6 bg-muted/30">
              <TabsTrigger value="general" data-testid="tab-general">General</TabsTrigger>
              <TabsTrigger value="api" data-testid="tab-api">API Keys</TabsTrigger>
              <TabsTrigger value="trading" data-testid="tab-trading">Trading</TabsTrigger>
              <TabsTrigger value="notifications" data-testid="tab-notifications">Notifications</TabsTrigger>
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

              <Card className="bg-card border-border">
                <CardHeader>
                  <CardTitle>Gold (XAUUSD) + MT5 Auto Trading</CardTitle>
                  <CardDescription>Connect MT5 bridge (paper mode), generate gold signals, and toggle auto trading.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                    <Input placeholder="MT5 Login" value={goldMt5Login} onChange={(e) => setGoldMt5Login(e.target.value)} />
                    <Input placeholder="MT5 Password" type="password" value={goldMt5Password} onChange={(e) => setGoldMt5Password(e.target.value)} />
                    <Input placeholder="MT5 Server" value={goldMt5Server} onChange={(e) => setGoldMt5Server(e.target.value)} />
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
                    <Input className="max-w-32" value={goldRiskPercent} onChange={(e) => setGoldRiskPercent(e.target.value)} />
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
                          className="flex items-center justify-between p-4 rounded-lg border border-border bg-muted/10 hover:bg-muted/20 transition-colors"
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
                className="bg-muted/20"
                disabled={!!editUser}
              />
            </div>

            <div className="space-y-2">
              <Label>Role</Label>
              <Select value={newRole} onValueChange={setNewRole}>
                <SelectTrigger className="bg-muted/20" data-testid="select-role">
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
                        : 'border-border bg-muted/10 hover:bg-muted/20'
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
