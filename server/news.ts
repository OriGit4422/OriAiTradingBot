export interface NewsItem {
  title: string;
  url: string;
  source: string;
  publishedAt: string;
}

const FALLBACK_NEWS: NewsItem[] = [
  "BTC volatility rises as traders watch key resistance",
  "ETH ecosystem activity remains elevated into weekend session",
  "SOL derivatives open interest trends higher on momentum",
  "BNB range compression hints at potential breakout move",
  "XRP order-flow heatmap shows heavy liquidity pockets",
  "ADA spot volumes improve as risk appetite stabilizes",
  "DOGE social chatter increases amid short-term momentum",
  "AVAX rotates near major support with mixed sentiment",
  "Macro calendar keeps crypto traders focused on risk",
  "Funding rates cool across majors after sharp intraday moves",
].map((title, i) => ({
  title,
  url: "https://www.coindesk.com/",
  source: "Market Brief",
  publishedAt: new Date(Date.now() - i * 60 * 60 * 1000).toISOString(),
}));

function decodeXml(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function parseRssItems(xml: string, limit: number): NewsItem[] {
  const rawItems = xml.split("<item>").slice(1).map((chunk) => chunk.split("</item>")[0]).slice(0, limit);
  const items = rawItems
    .map((item) => {
      const title = item.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim();
      const link = item.match(/<link>([\s\S]*?)<\/link>/i)?.[1]?.trim();
      const pubDate = item.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1]?.trim();
      if (!title || !link) return null;

      return {
        title: decodeXml(title.replace(/<!\[CDATA\[|\]\]>/g, "")),
        url: decodeXml(link.replace(/<!\[CDATA\[|\]\]>/g, "")),
        source: "CoinDesk",
        publishedAt: pubDate ? new Date(pubDate).toISOString() : new Date().toISOString(),
      } satisfies NewsItem;
    })
    .filter((x): x is NewsItem => Boolean(x));

  return items;
}

export async function getLatestCryptoNews(limit = 10): Promise<NewsItem[]> {
  const safeLimit = Math.min(20, Math.max(1, limit));
  try {
    const res = await fetch("https://www.coindesk.com/arc/outboundfeeds/rss/", {
      headers: { "user-agent": "OriAiTradingBot/1.0" },
    });
    if (!res.ok) return FALLBACK_NEWS.slice(0, safeLimit);
    const xml = await res.text();
    const parsed = parseRssItems(xml, safeLimit);
    return parsed.length ? parsed : FALLBACK_NEWS.slice(0, safeLimit);
  } catch {
    return FALLBACK_NEWS.slice(0, safeLimit);
  }
}

export async function getCoinNews(symbol: string, limit = 10): Promise<{ articles: NewsItem[]; sentiment: string | null }> {
  const normalized = (symbol || "").toUpperCase();
  const all = await getLatestCryptoNews(limit * 2);
  const filtered = all.filter((a) => a.title.toUpperCase().includes(normalized)).slice(0, limit);
  const articles = filtered.length ? filtered : all.slice(0, limit);
  return {
    articles,
    sentiment: null,
  };
}
