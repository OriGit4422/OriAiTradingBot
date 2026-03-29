import { useQuery } from '@tanstack/react-query';
import { Brain, Zap, Globe, Activity, CheckCircle2, XCircle, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface AgentStatus {
  name: string;
  active: boolean;
  role: string;
}

interface IntelligenceStatus {
  agents: {
    claude: AgentStatus;
    coinglass: AgentStatus;
    perplexity: AgentStatus;
    arkham: AgentStatus;
  };
  totalActive: number;
}

const AGENT_META = {
  claude:     { icon: Brain,    color: 'text-violet-400', bg: 'bg-violet-500/10', border: 'border-violet-500/20', label: 'Claude AI' },
  coinglass:  { icon: Activity, color: 'text-orange-400', bg: 'bg-orange-500/10',  border: 'border-orange-500/20', label: 'Coinglass' },
  perplexity: { icon: Globe,    color: 'text-sky-400',    bg: 'bg-sky-500/10',    border: 'border-sky-500/20',    label: 'Perplexity' },
  arkham:     { icon: Zap,      color: 'text-cyan-400',   bg: 'bg-cyan-500/10',   border: 'border-cyan-500/20',   label: 'Arkham' },
};

export function AIAgentsPanel() {
  const { data, isLoading } = useQuery<IntelligenceStatus>({
    queryKey: ['/api/intelligence/status'],
    refetchInterval: 60_000,
  });

  const entries = data
    ? (Object.entries(data.agents) as [keyof typeof AGENT_META, AgentStatus][])
    : [];

  return (
    <div className="rounded-xl border border-border bg-white shadow-sm p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <Brain className="h-4 w-4 text-violet-400" />
          <span className="text-sm font-semibold text-foreground">AI Agents</span>
        </div>
        {data && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-violet-500/10 text-violet-400 border border-violet-500/20">
            {data.totalActive}/4 active
          </span>
        )}
      </div>

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
                    <div className="text-xs font-semibold text-foreground truncate">{meta.label}</div>
                    <div className="text-[10px] text-muted-foreground truncate max-w-[160px]">{agent.role}</div>
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

      {data && data.totalActive < 4 && (
        <p className="mt-3 text-[10px] text-muted-foreground text-center">
          Add missing API keys in Settings → AI Agents to activate all agents
        </p>
      )}
    </div>
  );
}
