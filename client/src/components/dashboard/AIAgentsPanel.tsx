import { useQuery } from '@tanstack/react-query';
import { Brain, Zap, Globe, Activity, CheckCircle2, AlertCircle, RefreshCw, Cpu, Shield, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';
import { queryClient } from '@/lib/queryClient';
import { useState } from 'react';

interface AgentStatus {
  name: string;
  active: boolean;
  role: string;
  providers?: string[];
  consensusMode?: boolean;
}

interface AIProvider {
  name: string;
  active: boolean;
  model: string;
  enabled?: boolean;
}

interface IntelligenceStatus {
  agents: {
    primaryAI:  AgentStatus;
    coinglass:  AgentStatus;
    perplexity: AgentStatus;
    arkham:     AgentStatus;
  };
  aiProviders?: Record<string, AIProvider>;
  totalActive: number;
  validationEnabled: boolean;
  filteringActive: boolean;
  consensusMode: boolean;
  activeProviderNames: string[];
  minConfidenceToShow: number;
  signalFilterDescription: string;
}

const AGENT_META = {
  primaryAI:  { icon: Brain,    color: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/20' },
  coinglass:  { icon: Activity, color: 'text-orange-400', bg: 'bg-orange-500/10',  border: 'border-orange-500/20' },
  perplexity: { icon: Globe,    color: 'text-sky-400',    bg: 'bg-sky-500/10',    border: 'border-sky-500/20' },
  arkham:     { icon: Zap,      color: 'text-cyan-400',   bg: 'bg-cyan-500/10',   border: 'border-cyan-500/20' },
};

export function AIAgentsPanel() {
  const [refreshing, setRefreshing] = useState(false);

  const { data, isLoading } = useQuery<IntelligenceStatus>({
    queryKey: ['/api/intelligence/status'],
    refetchInterval: 30000,
    staleTime: 15000,
  });

  const handleRefresh = async () => {
    setRefreshing(true);
    await queryClient.invalidateQueries({ queryKey: ['/api/intelligence/status'] });
    await queryClient.refetchQueries({ queryKey: ['/api/intelligence/status'] });
    setRefreshing(false);
  };

  const entries = data
    ? (Object.entries(data.agents) as [keyof typeof AGENT_META, AgentStatus][])
    : [];

  const activeProviders = data?.aiProviders
    ? Object.values(data.aiProviders).filter(p => p.active)
    : [];

  const totalAgents = Object.keys(AGENT_META).length;

  return (
    <div className="rounded-xl border border-border bg-white shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-violet-400" />
          <span className="text-sm font-semibold text-foreground">AI Agents</span>
        </div>
        <div className="flex items-center gap-2">
          {data && (
            <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20">
              {data.totalActive}/{totalAgents} active
            </span>
          )}
          <button
            onClick={handleRefresh}
            disabled={isLoading || refreshing}
            title="Refresh agent status"
            className="p-1 rounded hover:bg-muted/30 transition-colors disabled:opacity-40"
          >
            <RefreshCw className={cn('h-3.5 w-3.5 text-muted-foreground', (isLoading || refreshing) && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Validation & Filtering Status */}
      {data && (
        <div className={cn(
          "mb-3 p-2 rounded-lg border text-[10px]",
          data.validationEnabled
            ? "bg-green-500/5 border-green-500/20"
            : "bg-yellow-500/5 border-yellow-500/20"
        )}>
          <div className="flex items-center gap-1.5 mb-1">
            {data.validationEnabled ? (
              <><Shield className="h-3 w-3 text-green-500" /><span className="font-semibold text-green-500 uppercase tracking-wide">Signal Validation Active</span></>
            ) : (
              <><AlertCircle className="h-3 w-3 text-yellow-500" /><span className="font-semibold text-yellow-500 uppercase tracking-wide">No AI Validation</span></>
            )}
          </div>
          <p className="text-muted-foreground leading-relaxed">{data.signalFilterDescription}</p>
          {data.consensusMode && (
            <div className="flex items-center gap-1 mt-1.5">
              <Filter className="h-3 w-3 text-violet-400" />
              <span className="text-violet-400 font-medium">
                {data.activeProviderNames.length}× consensus: {data.activeProviderNames.join(', ')}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Active AI Providers sub-panel */}
      {activeProviders.length > 0 && (
        <div className="mb-3 p-2 rounded-lg bg-violet-500/5 border border-violet-500/15">
          <div className="flex items-center gap-1.5 mb-1.5">
            <Cpu className="h-3 w-3 text-violet-400" />
            <span className="text-[10px] font-semibold text-violet-400 uppercase tracking-wide">
              AI Providers ({activeProviders.length})
              {activeProviders.length > 1 && <span className="ml-1 normal-case text-muted-foreground">— consensus mode</span>}
            </span>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {activeProviders.map(p => (
              <span
                key={p.name}
                className="text-[10px] px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20 font-medium"
              >
                {p.name}{p.model ? ` · ${p.model}` : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="h-12 rounded-lg bg-muted/20 animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map(([key, agent]) => {
            const meta = AGENT_META[key];
            const Icon = meta.icon;
            return (
              <div
                key={key}
                className={cn(
                  'flex items-center justify-between px-3 py-2 rounded-lg border transition-colors',
                  meta.bg, meta.border,
                )}
              >
                <div className="flex items-center gap-2.5 min-w-0">
                  <Icon className={cn('h-4 w-4 flex-shrink-0', meta.color)} />
                  <div className="min-w-0">
                    <div className="text-xs font-semibold text-foreground truncate">{agent.name}</div>
                    <div className="text-[10px] text-muted-foreground truncate max-w-[160px]">{agent.role}</div>
                    {key === 'primaryAI' && agent.providers && agent.providers.length > 1 && (
                      <div className="text-[9px] text-violet-400 truncate">{agent.providers.join(' + ')}</div>
                    )}
                  </div>
                </div>
                <div className="flex-shrink-0 ml-2">
                  {agent.active ? (
                    <div className="flex items-center gap-1 text-green-500">
                      <CheckCircle2 className="h-3.5 w-3.5" />
                      <span className="text-[10px] font-medium">Active</span>
                    </div>
                  ) : (
                    <div className="flex items-center gap-1 text-muted-foreground">
                      <AlertCircle className="h-3.5 w-3.5" />
                      <span className="text-[10px]">No key</span>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {data && data.totalActive < totalAgents && !data.validationEnabled && (
        <p className="mt-3 text-[10px] text-muted-foreground text-center">
          Add API keys in <strong>Settings → AI Agents</strong> to activate validation
        </p>
      )}
    </div>
  );
}
