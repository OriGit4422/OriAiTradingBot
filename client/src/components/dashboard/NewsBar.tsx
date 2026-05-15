import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, TrendingUp, TrendingDown, Minus, Newspaper, RefreshCw, AlertTriangle, Filter } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { queryClient } from '@/lib/queryClient';

interface NewsArticle {
  title: string;
  description: string | null;
  url: string;
  source: string;
  publishedAt: string;
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  sentimentScore: number;
  impactLevel: 'HIGH' | 'MEDIUM' | 'LOW';
  imageUrl?: string | null;
}

interface NewsResponse {
  articles: NewsArticle[];
  sentiment: {
    overall: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
    score: number;
    bullishCount: number;
    bearishCount: number;
    highImpactCount: number;
    headline: string;
  } | null;
}

type ImpactFilter = 'ALL' | 'HIGH' | 'MEDIUM' | 'LOW';
type CurrencyFilter = 'ALL' | 'BTC' | 'ETH' | 'SOL' | 'XRP' | 'BNB' | 'ADA' | 'DOGE' | 'AVAX' | 'GOLD';

const CURRENCY_KEYWORDS: Record<Exclude<CurrencyFilter, 'ALL'>, string[]> = {
  BTC: ['bitcoin', 'btc', 'xbt'],
  ETH: ['ethereum', 'eth', 'ether'],
  SOL: ['solana', 'sol'],
  XRP: ['xrp', 'ripple'],
  BNB: ['bnb', 'binance'],
  ADA: ['ada', 'cardano'],
  DOGE: ['doge', 'dogecoin'],
  AVAX: ['avax', 'avalanche'],
  GOLD: ['gold', 'xauusd', 'xau'],
};

const IMPACT_KEYWORDS = {
  HIGH: ['breaking', 'crash', 'surge', 'collapse', 'major', 'record', 'ban', 'hack', 'exploit', 'emergency'],
  MEDIUM: ['analysis', 'report', 'rise', 'fall', 'dip', 'gains', 'update', 'launch', 'upgrade', 'partnership'],
};

function deriveImpact(article: NewsArticle): 'HIGH' | 'MEDIUM' | 'LOW' {
  if (article.impactLevel) return article.impactLevel;
  const text = (article.title + ' ' + (article.description || '')).toLowerCase();
  if (IMPACT_KEYWORDS.HIGH.some(kw => text.includes(kw))) return 'HIGH';
  if (IMPACT_KEYWORDS.MEDIUM.some(kw => text.includes(kw))) return 'MEDIUM';
  return 'LOW';
}

function detectCurrency(title: string): CurrencyFilter[] {
  const text = title.toLowerCase();
  const found = (Object.entries(CURRENCY_KEYWORDS) as [Exclude<CurrencyFilter, 'ALL'>, string[]][])
    .filter(([, keywords]) => keywords.some(kw => text.includes(kw)))
    .map(([currency]) => currency);
  return found.length ? found : ['ALL' as CurrencyFilter];
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

const sentimentConfig = {
  BULLISH: { color: 'text-green-600', bg: 'bg-green-50 border-green-200', badge: 'bg-green-100 text-green-700 border-green-200', Icon: TrendingUp },
  BEARISH: { color: 'text-red-600', bg: 'bg-red-50 border-red-200', badge: 'bg-red-100 text-red-700 border-red-200', Icon: TrendingDown },
  NEUTRAL: { color: 'text-yellow-600', bg: 'bg-yellow-50/50 border-yellow-200/50', badge: 'bg-yellow-100 text-yellow-700 border-yellow-200', Icon: Minus },
};

const impactConfig = {
  HIGH: 'bg-red-100 text-red-700 border border-red-200',
  MEDIUM: 'bg-orange-100 text-orange-700 border border-orange-200',
  LOW: 'bg-gray-100 text-gray-600 border border-gray-200',
};

const IMPACT_FILTERS: ImpactFilter[] = ['ALL', 'HIGH', 'MEDIUM', 'LOW'];
const CURRENCY_FILTERS: CurrencyFilter[] = ['ALL', 'BTC', 'ETH', 'SOL', 'XRP', 'BNB', 'ADA', 'GOLD'];

interface NewsBarProps {
  coin: string;
}

export function NewsBar({ coin }: NewsBarProps) {
  const queryKey = [`/api/news/${coin}`];
  const { data, isLoading, isError } = useQuery<NewsResponse>({
    queryKey,
    refetchInterval: 5 * 60 * 1000,
    staleTime: 4 * 60 * 1000,
  });

  const [impactFilter, setImpactFilter] = useState<ImpactFilter>('ALL');
  const [currencyFilter, setCurrencyFilter] = useState<CurrencyFilter>('ALL');
  const [showFilters, setShowFilters] = useState(false);

  const articles = data?.articles ?? [];
  const sentiment = data?.sentiment;

  const filtered = articles.filter(article => {
    const impact = deriveImpact(article);
    if (impactFilter !== 'ALL' && impact !== impactFilter) return false;
    if (currencyFilter !== 'ALL') {
      const currencies = detectCurrency(article.title);
      if (!currencies.includes(currencyFilter) && !currencies.includes('ALL' as CurrencyFilter)) return false;
    }
    return true;
  });

  const activeFilters = (impactFilter !== 'ALL' ? 1 : 0) + (currencyFilter !== 'ALL' ? 1 : 0);

  return (
    <div className="bg-white rounded-xl border border-border shadow-sm overflow-hidden" data-testid="card-news-bar">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-gradient-to-r from-blue-500/5 to-transparent">
        <div className="flex items-center gap-2">
          <div className="h-6 w-6 rounded-md bg-blue-500/15 flex items-center justify-center">
            <Newspaper className="w-3.5 h-3.5 text-blue-600" />
          </div>
          <span className="text-xs font-black uppercase tracking-widest text-blue-700">
            {coin === 'BTC' ? 'Bitcoin' : coin === 'ETH' ? 'Ethereum' : coin === 'XAUUSD' ? 'Gold (XAUUSD)' : coin} News
          </span>
          <span className="text-[10px] text-muted-foreground">· Impact on price action</span>
        </div>

        <div className="flex items-center gap-2">
          {sentiment && (
            <div className="hidden md:flex items-center gap-1.5">
              <span className="text-[10px] text-muted-foreground">Overall:</span>
              <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-full border', sentimentConfig[sentiment.overall].badge)}>
                {sentiment.overall}
              </span>
              <span className="text-[10px] text-muted-foreground font-mono">
                {sentiment.bullishCount}↑ {sentiment.bearishCount}↓
                {sentiment.highImpactCount > 0 && <span className="ml-1 text-red-500 font-bold">{sentiment.highImpactCount} HIGH</span>}
              </span>
            </div>
          )}
          <Button
            variant="ghost"
            size="sm"
            className={cn(
              "h-6 px-2 flex items-center gap-1 text-[10px] relative",
              showFilters && "bg-primary/10 text-primary"
            )}
            onClick={() => setShowFilters(v => !v)}
            data-testid="button-news-filters"
          >
            <Filter className="w-3 h-3" />
            <span className="hidden sm:inline">Filter</span>
            {activeFilters > 0 && (
              <span className="absolute -top-1 -right-1 w-3.5 h-3.5 rounded-full bg-primary text-white text-[8px] flex items-center justify-center font-bold">
                {activeFilters}
              </span>
            )}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 w-6 p-0"
            onClick={() => queryClient.invalidateQueries({ queryKey })}
            disabled={isLoading}
          >
            <RefreshCw className={cn("w-3 h-3 text-muted-foreground", isLoading && "animate-spin")} />
          </Button>
        </div>
      </div>

      {/* Filter panel */}
      {showFilters && (
        <div className="px-4 py-3 border-b border-border bg-muted/20 space-y-2.5" data-testid="panel-news-filters">
          <div className="flex items-start gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] text-muted-foreground font-mono uppercase w-14 shrink-0">Impact</span>
              <div className="flex gap-1 flex-wrap">
                {IMPACT_FILTERS.map(f => (
                  <button
                    key={f}
                    onClick={() => setImpactFilter(f)}
                    className={cn(
                      "px-2 py-0.5 rounded text-[10px] font-bold border transition-all",
                      impactFilter === f
                        ? f === 'ALL'
                          ? 'bg-primary text-white border-primary'
                          : f === 'HIGH'
                          ? 'bg-red-500 text-white border-red-500'
                          : f === 'MEDIUM'
                          ? 'bg-orange-500 text-white border-orange-500'
                          : 'bg-gray-500 text-white border-gray-500'
                        : 'bg-background border-border text-muted-foreground hover:bg-muted/40'
                    )}
                    data-testid={`filter-impact-${f.toLowerCase()}`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="flex items-start gap-3 flex-wrap">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="text-[10px] text-muted-foreground font-mono uppercase w-14 shrink-0">Currency</span>
              <div className="flex gap-1 flex-wrap">
                {CURRENCY_FILTERS.map(f => (
                  <button
                    key={f}
                    onClick={() => setCurrencyFilter(f)}
                    className={cn(
                      "px-2 py-0.5 rounded text-[10px] font-bold border transition-all",
                      currencyFilter === f
                        ? 'bg-primary text-white border-primary'
                        : 'bg-background border-border text-muted-foreground hover:bg-muted/40'
                    )}
                    data-testid={`filter-currency-${f.toLowerCase()}`}
                  >
                    {f}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {activeFilters > 0 && (
            <button
              onClick={() => { setImpactFilter('ALL'); setCurrencyFilter('ALL'); }}
              className="text-[10px] text-primary hover:underline font-medium"
              data-testid="button-clear-filters"
            >
              Clear all filters
            </button>
          )}
        </div>
      )}

      {/* Content */}
      {isLoading ? (
        <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
          <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          Loading latest news...
        </div>
      ) : isError ? (
        <div className="flex items-center gap-2 px-4 py-3 text-xs text-muted-foreground">
          <AlertTriangle className="w-3.5 h-3.5 text-orange-500" />
          Could not load news. Check API key in Settings → API Keys.
        </div>
      ) : filtered.length === 0 ? (
        <div className="px-4 py-4 text-xs text-muted-foreground text-center">
          {articles.length === 0
            ? `No recent news found for ${coin}.`
            : 'No articles match the selected filters.'}
        </div>
      ) : (
        <div className="divide-y divide-border/40">
          {filtered.slice(0, 5).map((article, i) => {
            const cfg = sentimentConfig[article.sentiment] ?? sentimentConfig.NEUTRAL;
            const Icon = cfg.Icon;
            const impact = deriveImpact(article);
            return (
              <a
                key={i}
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-start gap-3 px-4 py-3 hover:bg-muted/30 transition-colors cursor-pointer group"
                data-testid={`news-article-${i}`}
              >
                <div className={cn("mt-0.5 flex-shrink-0 w-5 h-5 rounded-full flex items-center justify-center border", cfg.bg)}>
                  <Icon className={cn("w-2.5 h-2.5", cfg.color)} />
                </div>

                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs font-semibold text-foreground leading-snug line-clamp-2 group-hover:text-primary transition-colors">
                      {article.title}
                    </p>
                    <ExternalLink className="w-3 h-3 text-muted-foreground flex-shrink-0 mt-0.5 opacity-0 group-hover:opacity-100 transition-opacity" />
                  </div>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    <span className="text-[10px] text-muted-foreground font-medium">{article.source}</span>
                    <span className="text-[10px] text-muted-foreground">{timeAgo(article.publishedAt)}</span>
                    <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded border", impactConfig[impact])}>
                      {impact}
                    </span>
                    <span className={cn("text-[9px] font-bold px-1.5 py-0.5 rounded border", cfg.badge)}>
                      {article.sentiment === 'BULLISH' ? '↑ BULLISH' : article.sentiment === 'BEARISH' ? '↓ BEARISH' : '— NEUTRAL'}
                    </span>
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      )}

      {/* Footer */}
      <div className="px-4 py-2 border-t border-border/50 bg-muted/20 flex items-center justify-between">
        <span className="text-[9px] text-muted-foreground">
          Powered by NewsAPI · Sentiment by Claude keyword analysis
          {activeFilters > 0 && (
            <span className="ml-1 text-primary font-medium">
              · {filtered.length}/{articles.length} shown
            </span>
          )}
        </span>
        {sentiment && (
          <div className="flex items-center gap-1">
            <span className="text-[9px] text-muted-foreground">Score:</span>
            <span className={cn("text-[9px] font-mono font-bold", sentiment.score > 0 ? 'text-green-600' : sentiment.score < 0 ? 'text-red-600' : 'text-muted-foreground')}>
              {sentiment.score > 0 ? '+' : ''}{sentiment.score.toFixed(2)}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
