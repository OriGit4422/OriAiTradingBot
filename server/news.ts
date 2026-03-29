/**
 * NewsAPI integration — fetches articles, scores sentiment, caches results.
 * API docs: https://newsapi.org/docs
 */

export interface NewsArticle {
  title: string;
  description: string | null;
  url: string;
  source: string;
  publishedAt: string;          // ISO string
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  sentimentScore: number;       // -1 to +1
  impactLevel: 'HIGH' | 'MEDIUM' | 'LOW';
  imageUrl?: string | null;
}

// ── Simple keyword sentiment scorer ──────────────────────────────────────────

const BULLISH_WORDS = [
  'surge', 'rally', 'bull', 'bullish', 'soar', 'gain', 'gains', 'rise', 'rises',
  'rising', 'up', 'high', 'record', 'breakthrough', 'adoption', 'institutional',
  'buy', 'long', 'positive', 'growth', 'breakout', 'pump', 'skyrocket', 'explode',
  'accumulation', 'inflow', 'approve', 'approval', 'etf', 'integrate', 'launch',
  'partnership', 'upgrade', 'milestone', 'support', 'recover', 'recovery',
];

const BEARISH_WORDS = [
  'drop', 'crash', 'bear', 'bearish', 'fall', 'falls', 'falling', 'decline',
  'down', 'low', 'sell', 'short', 'ban', 'ban', 'crackdown', 'hack', 'hacked',
  'exploit', 'fraud', 'scam', 'rug', 'collapse', 'dump', 'outflow', 'regulation',
  'regulatory', 'fine', 'lawsuit', 'risk', 'warning', 'caution', 'concern',
  'loss', 'losses', 'negative', 'fear', 'panic', 'liquidation', 'forced',
];

const HIGH_IMPACT_WORDS = [
  'etf', 'sec', 'fed', 'federal', 'regulation', 'ban', 'hack', 'exploit',
  'institutional', 'billion', 'trillion', 'approval', 'breakout', 'crash',
  'record', 'ath', 'all-time', 'emergency', 'major', 'critical', 'breaking',
];

function scoreSentiment(text: string): { score: number; sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL'; impactLevel: 'HIGH' | 'MEDIUM' | 'LOW' } {
  const lower = text.toLowerCase();
  const words = lower.split(/\W+/);

  let score = 0;
  for (const w of words) {
    if (BULLISH_WORDS.includes(w)) score += 1;
    if (BEARISH_WORDS.includes(w)) score -= 1;
  }

  const maxWords = Math.max(words.length, 1);
  const normalized = Math.max(-1, Math.min(1, score / (maxWords * 0.2)));

  const hasHighImpact = HIGH_IMPACT_WORDS.some(w => lower.includes(w));
  const impactLevel = hasHighImpact ? 'HIGH' : Math.abs(score) >= 3 ? 'MEDIUM' : 'LOW';

  const sentiment = normalized > 0.05 ? 'BULLISH' : normalized < -0.05 ? 'BEARISH' : 'NEUTRAL';
  return { score: parseFloat(normalized.toFixed(3)), sentiment, impactLevel };
}

// ── Cache (5 min TTL) ─────────────────────────────────────────────────────────

const cache = new Map<string, { articles: NewsArticle[]; fetchedAt: number }>();
const CACHE_TTL = 5 * 60 * 1000;

function getCached(key: string): NewsArticle[] | null {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.fetchedAt < CACHE_TTL) return entry.articles;
  return null;
}

function setCache(key: string, articles: NewsArticle[]) {
  cache.set(key, { articles, fetchedAt: Date.now() });
}

// ── Coin → search query mapping ───────────────────────────────────────────────

function coinToQuery(coin: string): string {
  const MAP: Record<string, string> = {
    BTC: 'Bitcoin',
    ETH: 'Ethereum',
    SOL: 'Solana',
    BNB: 'Binance coin',
    XRP: 'XRP Ripple',
    ADA: 'Cardano',
    DOGE: 'Dogecoin',
    AVAX: 'Avalanche crypto',
    DOT: 'Polkadot',
    LINK: 'Chainlink crypto',
    XAUUSD: 'Gold price XAUUSD',
    GOLD: 'Gold price commodity',
  };
  return MAP[coin.toUpperCase()] ?? `${coin} crypto`;
}

// ── Core fetch ────────────────────────────────────────────────────────────────

async function fetchFromNewsApi(query: string, apiKey: string, pageSize = 10): Promise<NewsArticle[]> {
  const url = `https://newsapi.org/v2/everything?q=${encodeURIComponent(query)}&sortBy=publishedAt&pageSize=${pageSize}&language=en&apiKey=${apiKey}`;

  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`NewsAPI error ${res.status}: ${body}`);
  }

  const json: any = await res.json();
  if (json.status !== 'ok') throw new Error(`NewsAPI status: ${json.status} — ${json.message}`);

  return (json.articles || []).map((a: any): NewsArticle => {
    const text = `${a.title ?? ''} ${a.description ?? ''}`;
    const { score, sentiment, impactLevel } = scoreSentiment(text);
    return {
      title: a.title ?? '(no title)',
      description: a.description ?? null,
      url: a.url,
      source: a.source?.name ?? 'Unknown',
      publishedAt: a.publishedAt,
      sentiment,
      sentimentScore: score,
      impactLevel,
      imageUrl: a.urlToImage ?? null,
    };
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Fetch latest news articles for a specific coin/asset */
export async function getCoinNews(coin: string, apiKey: string, limit = 5): Promise<NewsArticle[]> {
  const key = `coin:${coin.toUpperCase()}`;
  const cached = getCached(key);
  if (cached) return cached.slice(0, limit);

  const query = coinToQuery(coin);
  const articles = await fetchFromNewsApi(query, apiKey, 10);
  setCache(key, articles);
  return articles.slice(0, limit);
}

/** Fetch general crypto market news */
export async function getMarketNews(apiKey: string, limit = 10): Promise<NewsArticle[]> {
  const key = 'market:general';
  const cached = getCached(key);
  if (cached) return cached.slice(0, limit);

  const articles = await fetchFromNewsApi('cryptocurrency bitcoin ethereum market', apiKey, 20);
  setCache(key, articles);
  return articles.slice(0, limit);
}

/** Compute aggregate sentiment summary for a set of articles */
export function aggregateSentiment(articles: NewsArticle[]): {
  overall: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  score: number;
  bullishCount: number;
  bearishCount: number;
  highImpactCount: number;
  headline: string;
} {
  if (!articles.length) {
    return { overall: 'NEUTRAL', score: 0, bullishCount: 0, bearishCount: 0, highImpactCount: 0, headline: 'No recent news' };
  }

  const bullish = articles.filter(a => a.sentiment === 'BULLISH').length;
  const bearish = articles.filter(a => a.sentiment === 'BEARISH').length;
  const highImpact = articles.filter(a => a.impactLevel === 'HIGH').length;
  const avgScore = articles.reduce((s, a) => s + a.sentimentScore, 0) / articles.length;

  const overall = avgScore > 0.05 ? 'BULLISH' : avgScore < -0.05 ? 'BEARISH' : 'NEUTRAL';
  const topArticle = articles.sort((a, b) => {
    const imp = { HIGH: 3, MEDIUM: 2, LOW: 1 };
    return imp[b.impactLevel] - imp[a.impactLevel];
  })[0];

  return {
    overall,
    score: parseFloat(avgScore.toFixed(3)),
    bullishCount: bullish,
    bearishCount: bearish,
    highImpactCount: highImpact,
    headline: topArticle.title,
  };
}
