/**
 * AI Budget Panel — where the day's AI credits actually went.
 *
 * The governor already enforces the cap; the value here is that it stops being
 * invisible. Before this panel the only way a user learned the budget had run
 * out was a red toast on a feature that had silently stopped working, with a
 * dollar figure in it and no way to see the trend behind it.
 *
 * Everything shown is measured, not projected: real provider token counts,
 * priced per model, accumulated per UTC day.
 */
import { useQuery } from '@tanstack/react-query';
import { Wallet, Database, ShieldAlert, ArrowDownCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface ProviderView {
  provider: string;
  spendUsd: number;
  calls: number;
  tokensIn: number;
  tokensOut: number;
  blocked: number;
  cacheHits: number;
  downgraded?: number;
  remainingUsd: number;
  usedFraction: number;
  headroomUsd: { critical: number; normal: number; cosmetic: number };
  costPer1kTokens: number | null;
}

interface BudgetStatus {
  day: string;
  dailyBudgetUsd: number;
  perCallCapUsd: number;
  totalSpendUsd: number;
  totalTokensIn: number;
  totalTokensOut: number;
  providers: ProviderView[];
  tierCeilings: { critical: number; normal: number; cosmetic: number };
  cacheEntries: number;
  savedByCacheUsd: number;
  blockedCalls: number;
  cacheHits: number;
  /** always = cheap model preferred; auto = only when the budget binds; off = never. */
  economyMode?: 'always' | 'auto' | 'off';
}

/** Sub-cent figures are the norm here, so 4 decimals is the useful precision. */
function usd(n: number): string {
  if (n === 0) return '$0';
  if (n < 0.0001) return '<$0.0001';
  return `$${n.toFixed(4)}`;
}

function compactTokens(n: number): string {
  if (n >= 1e6) return `${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(n);
}

function Stat({ label, value, hint, tone }: { label: string; value: string; hint?: string; tone?: string }) {
  return (
    <div className="rounded-md border border-border bg-card/50 p-2">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-mono">{label}</div>
      <div className={cn('text-sm font-black font-mono', tone)}>{value}</div>
      {hint && <div className="text-[9px] text-muted-foreground font-mono">{hint}</div>}
    </div>
  );
}

export function AIBudgetPanel() {
  const { data, isLoading } = useQuery<{ ok: boolean; budget: BudgetStatus }>({
    queryKey: ['/api/ai/budget'],
    // The ledger only moves when a call is made; a minute of lag costs nothing.
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const b = data?.budget;

  if (isLoading || !b) {
    return <div className="p-4 text-xs text-muted-foreground font-mono">Loading AI spend…</div>;
  }

  const usedPct = b.dailyBudgetUsd > 0 ? Math.min(100, (b.totalSpendUsd / b.dailyBudgetUsd) * 100) : 0;
  const totalTokens = b.totalTokensIn + b.totalTokensOut;
  const totalCalls = b.providers.reduce((s, p) => s + p.calls, 0);
  const downgrades = b.providers.reduce((s, p) => s + (p.downgraded ?? 0), 0);

  return (
    <div className="h-full flex flex-col" data-testid="panel-ai-budget">
      <div className="p-3 border-b border-border flex items-center gap-2 bg-gradient-to-r from-emerald-500/10 to-primary/5">
        <div className="h-6 w-6 rounded-md bg-emerald-500/20 flex items-center justify-center">
          <Wallet className="w-3.5 h-3.5 text-emerald-500" />
        </div>
        <div className="flex-1">
          <span className="text-xs font-black uppercase tracking-widest text-emerald-600">AI Credit Usage</span>
          <div className="text-[9px] text-muted-foreground font-mono">
            {b.day} UTC · cap {usd(b.dailyBudgetUsd)}/provider/day · max {usd(b.perCallCapUsd)}/call
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-3">
        {/* Day total against the cap */}
        <div>
          <div className="flex items-baseline justify-between mb-1">
            <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Spent today</span>
            <span className="text-sm font-black font-mono">
              {usd(b.totalSpendUsd)}
              <span className="text-[10px] text-muted-foreground"> / {usd(b.dailyBudgetUsd)}</span>
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                usedPct >= 90 ? 'bg-red-500' : usedPct >= 60 ? 'bg-amber-500' : 'bg-emerald-500',
              )}
              style={{ width: `${usedPct}%` }}
            />
          </div>
          <div className="text-[9px] text-muted-foreground font-mono mt-1">
            {usedPct.toFixed(1)}% of the daily ceiling · resets 00:00 UTC
          </div>
        </div>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <Stat label="Calls" value={String(totalCalls)} hint={`${compactTokens(totalTokens)} tokens`} />
          <Stat
            label="Output"
            value={compactTokens(b.totalTokensOut)}
            hint={`${compactTokens(b.totalTokensIn)} in`}
            tone="text-emerald-500"
          />
          <Stat
            label="Saved by cache"
            value={usd(b.savedByCacheUsd)}
            hint={`${b.cacheHits} free answers`}
            tone={b.savedByCacheUsd > 0 ? 'text-emerald-500' : ''}
          />
          <Stat
            label="Refused"
            value={String(b.blockedCalls)}
            hint="fell back to maths"
            tone={b.blockedCalls > 0 ? 'text-amber-500' : ''}
          />
        </div>

        {/* Per provider */}
        {b.providers.length === 0 ? (
          <div className="text-[10px] text-muted-foreground font-mono border border-dashed border-border rounded-md p-3 text-center">
            No AI calls made yet today — nothing has been spent.
          </div>
        ) : (
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-widest text-muted-foreground font-mono">Per provider</div>
            {b.providers.map(p => (
              <div key={p.provider} className="rounded-md border border-border p-2" data-testid={`budget-provider-${p.provider}`}>
                <div className="flex items-center justify-between mb-1">
                  <span className="text-[11px] font-bold">{p.provider}</span>
                  <span className="text-[11px] font-mono font-black">
                    {usd(p.spendUsd)}
                    <span className="text-muted-foreground font-normal"> · {usd(p.remainingUsd)} left</span>
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-muted overflow-hidden mb-1.5">
                  <div
                    className={cn(
                      'h-full rounded-full',
                      p.usedFraction >= 0.9 ? 'bg-red-500' : p.usedFraction >= 0.6 ? 'bg-amber-500' : 'bg-emerald-500',
                    )}
                    style={{ width: `${Math.min(100, p.usedFraction * 100)}%` }}
                  />
                </div>
                <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[9px] text-muted-foreground font-mono">
                  <span>{p.calls} calls</span>
                  <span>{compactTokens(p.tokensOut)} out / {compactTokens(p.tokensIn)} in</span>
                  {p.costPer1kTokens !== null && <span>${p.costPer1kTokens.toFixed(5)}/1k tok</span>}
                  {p.cacheHits > 0 && (
                    <span className="text-emerald-600 flex items-center gap-0.5">
                      <Database className="w-2.5 h-2.5" />{p.cacheHits} cached
                    </span>
                  )}
                  {(p.downgraded ?? 0) > 0 && (
                    <span className="text-blue-500 flex items-center gap-0.5">
                      <ArrowDownCircle className="w-2.5 h-2.5" />{p.downgraded} on cheap model
                    </span>
                  )}
                  {p.blocked > 0 && (
                    <span className="text-amber-600 flex items-center gap-0.5">
                      <ShieldAlert className="w-2.5 h-2.5" />{p.blocked} refused
                    </span>
                  )}
                </div>
                {/* What each tier still has. Cosmetic runs out first by design. */}
                <div className="flex gap-2 mt-1.5 text-[9px] font-mono">
                  {(['critical', 'normal', 'cosmetic'] as const).map(t => (
                    <span
                      key={t}
                      className={cn(
                        'px-1.5 py-0.5 rounded border',
                        p.headroomUsd[t] > 0
                          ? 'border-border text-muted-foreground'
                          : 'border-red-500/40 text-red-500',
                      )}
                    >
                      {t} {usd(p.headroomUsd[t])}
                    </span>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="text-[9px] text-muted-foreground font-mono leading-relaxed border-t border-border pt-2 space-y-1">
          <div>
            Calls are cached, de-duplicated and priced before they are sent. If one still
            does not fit the remaining budget it is refused and the deterministic engine
            answers instead — signals are never blocked by a spent budget.
          </div>
          <div>
            Model routing:{' '}
            <span className="text-foreground font-bold">{b.economyMode ?? 'always'}</span>
            {b.economyMode === 'off'
              ? ' — using your configured models as-is. Set AI_ECONOMY_MODE=always to cut spend.'
              : b.economyMode === 'auto'
                ? ' — your configured model is kept until the budget binds, then a cheaper one takes over.'
                : ' — small models handle these short structured prompts, so the premium model is skipped.'}
            {downgrades > 0 ? ` ${downgrades} call(s) rerouted today.` : ''}
          </div>
        </div>
      </div>
    </div>
  );
}
