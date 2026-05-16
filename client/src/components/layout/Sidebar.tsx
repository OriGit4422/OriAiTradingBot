import { useState } from 'react';
import { useLocation } from 'wouter';
import {
  LayoutDashboard,
  LineChart,
  Wallet,
  Settings,
  Activity,
  Zap,
  LogOut,
  Brain,
  Menu,
  X,
  CheckCircle2,
  Trophy,
  Download,
  BarChart2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';

export function Sidebar() {
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navItems = [
    { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
    { icon: LineChart, label: 'Markets', path: '/markets' },
    { icon: Brain, label: 'Strategies', path: '/strategies' },
    { icon: Activity, label: 'Signals', path: '/signals' },
    { icon: Wallet, label: 'Portfolio', path: '/portfolio' },
    { icon: BarChart2, label: 'Analytics', path: '/analytics', badge: 'NEW' },
    { icon: Trophy, label: 'Gold Trading', path: '/gold' },
    { icon: Settings, label: 'Settings', path: '/settings' },
  ];

  const [downloading, setDownloading] = useState(false);

  const handleLogout = () => {
    localStorage.removeItem('winm_auth');
    window.location.reload();
  };

  const handleDownloadProject = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const response = await fetch('/api/export/project');
      if (!response.ok) throw new Error('Export failed');
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      const disposition = response.headers.get('Content-Disposition') || '';
      const match = disposition.match(/filename="([^"]+)"/);
      a.download = match ? match[1] : 'OriAiTradingBot-source.zip';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e) {
      console.error('Download failed:', e);
    } finally {
      setDownloading(false);
    }
  };

  const handleNav = (path: string) => {
    setLocation(path);
    setMobileOpen(false);
  };

  return (
    <>
      <button
        className="md:hidden fixed top-3 left-3 z-50 p-2 rounded-lg bg-white border border-border shadow-sm"
        onClick={() => setMobileOpen(!mobileOpen)}
        data-testid="button-mobile-menu"
      >
        {mobileOpen ? <X className="h-5 w-5 text-foreground" /> : <Menu className="h-5 w-5 text-foreground" />}
      </button>

      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/30 z-30"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <div className={cn(
        "w-64 border-r border-sidebar-border bg-sidebar h-screen flex flex-col fixed left-0 top-0 z-40 transition-transform duration-200 shadow-sm",
        mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
      )}>
        {/* Logo */}
        <div className="p-5 flex items-center gap-3 border-b border-sidebar-border">
          <div className="h-9 w-9 rounded-lg bg-primary flex items-center justify-center shadow-sm">
            <Zap className="h-5 w-5 text-white" />
          </div>
          <div>
            <span className="text-base font-display font-bold text-foreground tracking-wider block leading-tight">
              WinM <span className="text-primary">AI</span>
            </span>
            <span className="text-[9px] font-mono text-muted-foreground tracking-widest uppercase">Quantum Trading</span>
          </div>
        </div>

        {/* Navigation */}
        <nav className="flex-1 px-3 py-4 space-y-0.5" data-testid="nav-sidebar">
          {navItems.map((item) => {
            const isActive = location === item.path;
            return (
              <Button
                key={item.path}
                variant="ghost"
                className={cn(
                  "w-full justify-start gap-3 h-10 text-sm font-medium transition-all rounded-lg",
                  isActive
                    ? "bg-primary/8 text-primary font-semibold"
                    : "text-muted-foreground hover:text-foreground hover:bg-secondary/80"
                )}
                onClick={() => handleNav(item.path)}
                data-testid={`nav-${item.label.toLowerCase()}`}
              >
                <item.icon className={cn("h-4 w-4 flex-shrink-0", isActive ? "text-primary" : item.path === '/gold' ? "text-amber-500" : "")} />
                <span>{item.label}</span>
                {(item as any).badge && !isActive && (
                  <span className="ml-auto text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-amber-100 text-amber-700 border border-amber-200">{(item as any).badge}</span>
                )}
                {isActive && (
                  <div className="ml-auto w-1.5 h-1.5 rounded-full bg-primary" />
                )}
              </Button>
            );
          })}
        </nav>

        {/* Footer */}
        <div className="p-4 border-t border-sidebar-border space-y-3">
          {/* Status */}
          <div className="rounded-lg bg-secondary/60 border border-border/50 p-3 space-y-1.5">
            <p className="text-[10px] text-muted-foreground uppercase font-mono font-semibold tracking-wider">System Status</p>
            <div className="flex items-center gap-2 text-xs text-green-600 font-medium">
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>Operational</span>
            </div>
            <div className="flex items-center gap-2 text-xs text-primary font-medium">
              <div className="w-2 h-2 rounded-full bg-primary animate-pulse" />
              <span>AI Engine Active</span>
            </div>
          </div>

          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-sm text-muted-foreground hover:text-primary hover:bg-primary/8 disabled:opacity-60"
            onClick={handleDownloadProject}
            disabled={downloading}
            data-testid="button-download-project"
            title="Download project ZIP for Google AI Studio"
          >
            <Download className={`h-4 w-4 ${downloading ? 'animate-bounce' : ''}`} />
            <span>{downloading ? 'Preparing…' : 'Download for AI Studio'}</span>
          </Button>

          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-sm text-muted-foreground hover:text-destructive hover:bg-destructive/8"
            onClick={handleLogout}
            data-testid="button-logout"
          >
            <LogOut className="h-4 w-4" />
            <span>Logout</span>
          </Button>
        </div>
      </div>
    </>
  );
}
