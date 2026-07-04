import { useState, useEffect } from "react";
import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import Login from "@/pages/login";
import Dashboard from "@/pages/dashboard";
import Markets from "@/pages/markets";
import Strategies from "@/pages/strategies";
import Signals from "@/pages/signals";
import Portfolio from "@/pages/portfolio";
import Settings from "@/pages/settings";
import Gold from "@/pages/gold";
import Analytics from "@/pages/analytics";
import BotPage from "@/pages/bot";
import AgentsPage from "@/pages/agents";
import NotFound from "@/pages/not-found";
import { applyThemeById, getActiveThemeId } from "@/lib/themes";

// Apply saved theme immediately on boot (before first paint)
applyThemeById(getActiveThemeId());

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/markets" component={Markets} />
      <Route path="/strategies" component={Strategies} />
      <Route path="/signals" component={Signals} />
      <Route path="/portfolio" component={Portfolio} />
      <Route path="/settings" component={Settings} />
      <Route path="/gold" component={Gold} />
      <Route path="/analytics" component={Analytics} />
      <Route path="/bot" component={BotPage} />
      <Route path="/agents" component={AgentsPage} />
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const auth = localStorage.getItem('winm_auth');
    if (!auth) {
      setChecked(true);
      return;
    }
    // localStorage only reflects the last login; confirm the session
    // cookie is still valid server-side before trusting it.
    fetch('/api/auth/me', { credentials: 'include' })
      .then((res) => res.json())
      .then((data) => {
        if (!data.authenticated) localStorage.removeItem('winm_auth');
        setIsAuthenticated(!!data.authenticated);
      })
      .catch(() => setIsAuthenticated(false))
      .finally(() => setChecked(true));
  }, []);

  if (!checked) {
    return null;
  }

  if (!isAuthenticated) {
    return (
      <QueryClientProvider client={queryClient}>
        <TooltipProvider>
          <Toaster />
          <Login onLogin={() => setIsAuthenticated(true)} />
        </TooltipProvider>
      </QueryClientProvider>
    );
  }

  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
