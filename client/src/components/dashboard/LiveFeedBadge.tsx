/**
 * Live feed status badge.
 *
 * Shows whether quotes are actually streaming and how old the newest tick is.
 * A dashboard that silently paints a 40-second-old price as current is worse
 * than one that admits it is behind, so staleness is surfaced, not hidden.
 */
import { cn } from '@/lib/utils';
import { useLivePrices, STALE_AFTER_MS } from '@/lib/live-price-store';

export function LiveFeedBadge({ className }: { className?: string }) {
  const { status, ageMs, lastTickAt, source } = useLivePrices();

  const stale = ageMs > STALE_AFTER_MS;
  const label =
    status === 'live' && !stale ? 'LIVE'
    : status === 'connecting' ? 'CONNECTING'
    : status === 'offline' ? 'OFFLINE'
    // Quotes are arriving, but from the 30 s REST poll rather than the socket.
    : source === 'rest' ? 'REST ONLY'
    : 'DELAYED';

  const tone =
    label === 'LIVE' ? 'text-green-500'
    // Amber, not red: on REST the numbers are still moving, just coarser.
    : label === 'CONNECTING' || label === 'REST ONLY' ? 'text-amber-500'
    : 'text-red-500';

  const age =
    !lastTickAt ? '—'
    : ageMs < 1500 ? 'now'
    : ageMs < 60_000 ? `${Math.round(ageMs / 1000)}s ago`
    : `${Math.round(ageMs / 60_000)}m ago`;

  return (
    <div
      className={cn('flex items-center gap-1.5 text-[9px] font-mono font-bold', tone, className)}
      title={`Feed ${status} via ${source}; newest tick ${age}`}
    >
      <span
        className={cn(
          'w-1.5 h-1.5 rounded-full',
          label === 'LIVE' ? 'bg-green-500 animate-pulse'
            : label === 'CONNECTING' || label === 'REST ONLY' ? 'bg-amber-500 animate-pulse'
            : 'bg-red-500',
        )}
      />
      <span>{label}</span>
      <span className="text-muted-foreground font-normal">{age}</span>
    </div>
  );
}
