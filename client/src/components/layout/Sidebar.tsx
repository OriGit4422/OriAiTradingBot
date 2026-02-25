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
  X
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
    { icon: Settings, label: 'Settings', path: '/settings' },
  ];

  const handleLogout = () => {
    localStorage.removeItem('winm_auth');
    window.location.reload();
  };

  const handleNav = (path: string) => {
    setLocation(path);
    setMobileOpen(false);
  };

  return (
    <>
      <button
        className="md:hidden fixed top-3 left-3 z-50 p-2 rounded-lg bg-card border border-border"
        onClick={() => setMobileOpen(!mobileOpen)}
        data-testid="button-mobile-menu"
      >
        {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
      </button>

      {mobileOpen && (
        <div
          className="md:hidden fixed inset-0 bg-black/50 z-30"
          onClick={() => setMobileOpen(false)}
        />
      )}

      <div className={cn(
        "w-64 border-r border-sidebar-border bg-sidebar h-screen flex flex-col fixed left-0 top-0 z-40 transition-transform duration-200",
        mobileOpen ? "translate-x-0" : "-translate-x-full md:translate-x-0"
      )}>
        <div className="p-6 flex items-center gap-3">
          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-primary to-purple-600 flex items-center justify-center shadow-lg shadow-primary/20">
            <Zap className="h-6 w-6 text-white" />
          </div>
          <div>
            <span className="text-lg font-display font-bold text-sidebar-foreground tracking-wider block leading-tight">
              WinM <span className="text-primary">AI</span>
            </span>
            <span className="text-[10px] font-mono text-muted-foreground tracking-widest">QUANTUM TRADING</span>
          </div>
        </div>

        <nav className="flex-1 px-4 space-y-1 mt-4" data-testid="nav-sidebar">
          {navItems.map((item) => (
            <Button
              key={item.path}
              variant="ghost"
              className={cn(
                "w-full justify-start gap-3 h-11 text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-all",
                location === item.path && "bg-sidebar-accent text-primary border-r-2 border-primary rounded-r-none font-semibold"
              )}
              onClick={() => handleNav(item.path)}
              data-testid={`nav-${item.label.toLowerCase()}`}
            >
              <item.icon className="h-5 w-5" />
              <span className="font-medium">{item.label}</span>
            </Button>
          ))}
        </nav>

        <div className="p-4 border-t border-sidebar-border">
          <div className="bg-sidebar-accent/50 rounded-lg p-4 mb-4">
            <div className="text-xs text-muted-foreground uppercase mb-2 font-mono">System Status</div>
            <div className="flex items-center gap-2 text-sm text-green-400">
              <div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              <span>Operational</span>
            </div>
            <div className="flex items-center gap-2 text-sm text-primary mt-1">
              <div className="w-2 h-2 rounded-full bg-primary/50" />
              <span>AI Engine Active</span>
            </div>
          </div>

          <Button
            variant="ghost"
            className="w-full justify-start gap-3 text-destructive hover:text-destructive hover:bg-destructive/10"
            onClick={handleLogout}
            data-testid="button-logout"
          >
            <LogOut className="h-5 w-5" />
            <span>Logout</span>
          </Button>
        </div>
      </div>
    </>
  );
}
