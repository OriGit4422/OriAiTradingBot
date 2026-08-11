/**
 * Signal Accuracy panel.
 *
 * Shows what the engine has actually achieved on closed trades — hit rate,
 * expectancy in R, calibration of its own confidence, and where the weak slices
 * are. Also surfaces today's AI spend against the daily cap.
 *
 * Deliberately blunt: when the sample is too small to conclude anything, it says
 * so instead of rendering a confident-looking percentage over four trades.
 */
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { Target, Brain, DollarSign, AlertTriangle, TrendingUp, TrendingDown } from 'lucide-react';

interface AccuracySlice {
  key: string;
  trades: number;
  wins: number;
  hitRate: number;
  expectancyR: number;
  totalPnlUsd: number;
  significant: boolean;
}

interface CalibrationBucket {
  label: string;
  trades: number;
  predictedWinRate: number;
  calibratedWinRate: number | null;
  divergencePts: number | null;
}

interface AccuracyReport {
  sampleSize: number;
  openTrades: number;
  headline: {
    hitRate: number | null;
    expectancyR: number | null;
    brierScore: number | null;
    totalPnlUsd: number;
    profitFactor: number | null;
    avgWinR: number | null;
    avgLossR: number | null;
    maxConsecutiveLosses: number;
  };
  calibration: CalibrationBucket[];
  learning: {
    active: boolean;
    notes: string[];
    appliedContexts: Array<{ kind: string; key: string; multiplier: number; trades: number }>;
  };
  byTimeframe: AccuracySlice[];
  byStrategy: AccuracySlice[];
  byDirection: AccuracySlice[];
  aiSpend: {
    day: string;
    dailyBudgetUsd: number;
    totalSpendUsd: number;
    savedByCacheUsd: number;
    providers: Array<{ provider: string; spendUsd: number; calls: number; cacheHits: number; blocked: number }>;
  };
  verdict: string;
}

function pct(v: number | null | undefined): string {
  return v === null || v === undefined ? '—' : `${(v * 100).toFixed(1)}%`;
}

function Stat({ label, value, tone, hint }: { label: string; value: string; tone?: string; hint?: string }) {
  return (
    <div className="rounded-lg border border-border/50 bg-muted/10 p-2.5">
      <div className="text-[9px] uppercase tracking-widest text-muted-foreground font-bold">{label}</div>
      <div className={cn('text-lg font-black font-mono leading-tight', tone)}>{value}</div>
      {hint && <div className="text-[9px] text-muted-foreground font-mono mt-0.5">{hint}</div>}
    </div>
  );
}

function SliceTable({ title, rows }: { title: string; rows: AccuracySlice[] }) {
  if (!rows.length) return null;
  return (
    <div>
      <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1.5">{title}</div>
      <div className="overflow-x-auto">
        <table className="w-full text-[10px] font-mono">
          <thead>
            <tr className="text-muted-foreground border-b border-border/40">
              <th className="text-left font-bold py-1">Key</th>
              <th className="text-right font-bold">N</th>
              <th className="text-right font-bold">Hit</th>
              <th className="text-right font-bold">Exp R</th>
              <th className="text-right font-bold">PnL</th>
            </tr>
          </thead>
          <tbody>
            {rows.slice(0, 8).map(r => (
              <tr key={r.key} className={cn('border-b border-border/20', !r.significant && 'opacity-50')}>
                <td className="py-1 font-bold">
                  {r.key}
                  {!r.significant && <span className="ml-1 text-[8px] text-muted-foreground">(low n)</span>}
                </td>
                <td className="text-right">{r.trades}</td>
                <td className="text-right">{pct(r.hitRate)}</td>
                <td className={cn('text-right font-bold', r.expectancyR >= 0 ? 'text-green-500' : 'text-red-500')}>
                  {r.expectancyR >= 0 ? '+' : ''}{r.expectancyR.toFixed(2)}
                </td>
                <td className={cn('text-right', r.totalPnlUsd >= 0 ? 'text-green-500' : 'text-red-500')}>
                  {r.totalPnlUsd >= 0 ? '+' : ''}{r.totalPnlUsd.toFixed(2)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function AccuracyPanel() {
  const { data, isLoading } = useQuery<{ ok: boolean; report: AccuracyReport }>({
    queryKey: ['/api/agents/accuracy'],
    // Accuracy only moves when a trade closes — no need to poll hard.
    refetchInterval: 5 * 60 * 1000,
    staleTime: 4 * 60 * 1000,
  });

  const report = data?.report;

  if (isLoading || !report) {
    return (
      <div className="p-4 text-xs text-muted-foreground font-mono">Loading accuracy data…</div>
    );
  }

  const h = report.headline;
  const spend = report.aiSpend;
  const budgetPct = spend.dailyBudgetUsd > 0
    ? Math.min(100, (spend.totalSpendUsd / spend.dailyBudgetUsd) * 100)
    : 0;

  return (
    <div className="h-full flex flex-col">
      <div className="p-3 border-b border-border flex items-center gap-2 bg-gradient-to-r from-blue-500/10 to-primary/5">
        <div className="h-6 w-6 rounded-md bg-blue-500/20 flex items-center justify-center">
          <Target className="w-3.5 h-3.5 text-blue-500" />
        </div>
        <div className="flex-1">
          <span className="text-xs font-black uppercase tracking-widest text-blue-600">Signal Accuracy</span>
          <div className="text-[9px] text-muted-foreground font-mono">
            {report.sampleSize} closed · {report.openTrades} open · realized only
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-auto p-3 space-y-4">
        {/* Headline */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-2">
          <Stat
            label="Hit Rate"
            value={pct(h.hitRate)}
            tone={h.hitRate === null ? '' : h.hitRate >= 0.5 ? 'text-green-500' : 'text-red-500'}
            hint={`${report.sampleSize} trades`}
          />
          <Stat
            label="Expectancy"
            value={h.expectancyR === null ? '—' : `${h.expectancyR >= 0 ? '+' : ''}${h.expectancyR.toFixed(2)}R`}
            tone={h.expectancyR === null ? '' : h.expectancyR > 0 ? 'text-green-500' : 'text-red-500'}
            hint="per trade"
          />
          <Stat
            label="Brier Score"
            value={h.brierScore === null ? '—' : h.brierScore.toFixed(3)}
            tone={h.brierScore === null ? '' : h.brierScore <= 0.18 ? 'text-green-500' : h.brierScore <= 0.25 ? 'text-amber-500' : 'text-red-500'}
            hint="0.25 = coin flip"
          />
          <Stat
            label="Profit Factor"
            value={h.profitFactor === null ? '—' : h.profitFactor.toFixed(2)}
            tone={h.profitFactor === null ? '' : h.profitFactor >= 1 ? 'text-green-500' : 'text-red-500'}
            hint={`max ${h.maxConsecutiveLosses} losses in a row`}
          />
        </div>

        {/*
          Realized average win and loss, in R. Both are measured from actual pnl
          against the risk actually taken, so a stop that slipped shows as worse
          than -1.00R. A hit rate above 50% sitting next to an average loss
          bigger than the average win is the classic hidden edge drain, and it is
          invisible from hit rate alone.
        */}
        <div className="grid grid-cols-2 gap-2">
          <Stat
            label="Avg Win"
            value={h.avgWinR === null ? '—' : `+${h.avgWinR.toFixed(2)}R`}
            tone={h.avgWinR === null ? '' : 'text-green-500'}
            hint="realized, not planned"
          />
          <Stat
            label="Avg Loss"
            value={h.avgLossR === null ? '—' : `${h.avgLossR.toFixed(2)}R`}
            tone={
              h.avgLossR === null ? ''
              : h.avgLossR < -1.05 ? 'text-red-500'   // stops are slipping past plan
              : 'text-amber-500'
            }
            hint={h.avgLossR !== null && h.avgLossR < -1.05 ? 'stops slipping past plan' : 'realized, not planned'}
          />
        </div>

        {/* Verdict */}
        <div className="rounded-lg border border-border/50 bg-muted/10 p-2.5 text-[11px] leading-relaxed">
          {report.verdict}
        </div>

        {/* Calibration */}
        <div>
          <div className="text-[10px] font-black uppercase tracking-widest text-muted-foreground mb-1.5">
            Confidence Calibration
          </div>
          <div className="space-y-1">
            {report.calibration.filter(b => b.trades > 0).map(b => {
              const realized = b.calibratedWinRate ?? 0;
              const off = b.divergencePts ?? 0;
              return (
                <div key={b.label} className="flex items-center gap-2 text-[10px] font-mono">
                  <span className="w-16 text-muted-foreground">{b.label}</span>
                  <div className="flex-1 h-2 rounded-full bg-muted/40 overflow-hidden relative">
                    <div
                      className={cn('h-full', Math.abs(off) > 15 ? 'bg-red-500' : Math.abs(off) > 7 ? 'bg-amber-500' : 'bg-green-500')}
                      style={{ width: `${Math.max(2, realized * 100)}%` }}
                    />
                    {/* marker for what the score claimed */}
                    <div
                      className="absolute top-0 h-full w-px bg-foreground/60"
                      style={{ left: `${b.predictedWinRate * 100}%` }}
                      title={`Predicted ${pct(b.predictedWinRate)}`}
                    />
                  </div>
                  <span className="w-12 text-right">{pct(realized)}</span>
                  <span className={cn('w-14 text-right font-bold', Math.abs(off) > 15 ? 'text-red-500' : 'text-muted-foreground')}>
                    {off >= 0 ? '+' : ''}{off.toFixed(0)}pt
                  </span>
                  <span className="w-8 text-right text-muted-foreground">n{b.trades}</span>
                </div>
              );
            })}
            {report.calibration.every(b => b.trades === 0) && (
              <div className="text-[10px] text-muted-foreground font-mono">No closed trades to calibrate against yet.</div>
            )}
          </div>
        </div>

        {/* Learning */}
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <Brain className="w-3 h-3 text-purple-500" />
            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              Self-Optimisation
            </span>
            <span className={cn(
              'text-[9px] font-mono font-bold px-1.5 rounded',
              report.learning.active ? 'bg-green-500/20 text-green-600' : 'bg-muted text-muted-foreground',
            )}>
              {report.learning.active ? 'ACTIVE' : 'GATHERING DATA'}
            </span>
          </div>
          {report.learning.notes.map((n, i) => (
            <div key={i} className="text-[10px] text-muted-foreground leading-relaxed flex gap-1.5">
              <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5 text-amber-500" />
              <span>{n}</span>
            </div>
          ))}
          {report.learning.appliedContexts.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1">
              {report.learning.appliedContexts.map(c => (
                <span
                  key={`${c.kind}-${c.key}`}
                  className={cn(
                    'text-[9px] font-mono px-1.5 py-0.5 rounded border',
                    c.multiplier < 1
                      ? 'border-red-500/40 text-red-500 bg-red-500/10'
                      : 'border-green-500/40 text-green-500 bg-green-500/10',
                  )}
                  title={`${c.trades} trades`}
                >
                  {c.multiplier < 1 ? <TrendingDown className="w-2.5 h-2.5 inline mr-0.5" /> : <TrendingUp className="w-2.5 h-2.5 inline mr-0.5" />}
                  {c.key} ×{c.multiplier}
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Breakdowns */}
        <SliceTable title="By Timeframe" rows={report.byTimeframe} />
        <SliceTable title="By Strategy" rows={report.byStrategy} />
        <SliceTable title="By Direction" rows={report.byDirection} />

        {/* AI spend */}
        <div>
          <div className="flex items-center gap-1.5 mb-1.5">
            <DollarSign className="w-3 h-3 text-green-500" />
            <span className="text-[10px] font-black uppercase tracking-widest text-muted-foreground">
              AI Spend Today ({spend.day})
            </span>
          </div>
          <div className="h-2 rounded-full bg-muted/40 overflow-hidden mb-1">
            <div
              className={cn('h-full', budgetPct > 90 ? 'bg-red-500' : budgetPct > 60 ? 'bg-amber-500' : 'bg-green-500')}
              style={{ width: `${Math.max(1, budgetPct)}%` }}
            />
          </div>
          <div className="text-[10px] font-mono text-muted-foreground">
            ${spend.totalSpendUsd.toFixed(5)} of ${spend.dailyBudgetUsd.toFixed(2)}/day cap
            {spend.savedByCacheUsd > 0 && ` · $${spend.savedByCacheUsd.toFixed(5)} saved by cache`}
          </div>
          {spend.providers.map(p => (
            <div key={p.provider} className="text-[10px] font-mono flex justify-between mt-0.5">
              <span>{p.provider}</span>
              <span className="text-muted-foreground">
                ${p.spendUsd.toFixed(5)} · {p.calls} calls · {p.cacheHits} cached
                {p.blocked > 0 && <span className="text-amber-500"> · {p.blocked} capped</span>}
              </span>
            </div>
          ))}
          {spend.providers.length === 0 && (
            <div className="text-[10px] font-mono text-muted-foreground">No AI calls made today.</div>
          )}
        </div>
      </div>
    </div>
  );
}
