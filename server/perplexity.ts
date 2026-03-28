import { storage } from './storage';

export interface NewsSentiment {
  coin: string;
  sentiment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  headline: string;
  summary: string;
  riskLevel: 'LOW' | 'MEDIUM' | 'HIGH';
  keyEvents: string[];
  tradingImpact: string;
  available: boolean;
  error?: string;
}

const VALID_SENTIMENTS = new Set(['BULLISH', 'BEARISH', 'NEUTRAL']);
const VALID_RISKS      = new Set(['LOW', 'MEDIUM', 'HIGH']);

export async function getNewsSentiment(coin: string): Promise<NewsSentiment> {
  const base: NewsSentiment = {
    coin, sentiment: 'NEUTRAL', headline: 'Perplexity API key not configured',
    summary: '', riskLevel: 'LOW', keyEvents: [], tradingImpact: 'No data', available: false,
  };

  try {
    const settings = await storage.getSettings();
    const apiKey = settings?.perplexityApiKey;
    if (!apiKey) return base;

    const response = await fetch('https://api.perplexity.ai/chat/completions', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(15000),
      body: JSON.stringify({
        model: 'sonar',
        messages: [
          {
            role: 'system',
            content: 'You are an expert crypto trading news analyst. Analyze news for direct price-moving impact. Respond ONLY in valid JSON with no markdown or code blocks.',
          },
          {
            role: 'user',
            content: `Analyze all news about ${coin} cryptocurrency from the last 24 hours.

Focus strictly on price-moving events:
- Exchange listings or delistings
- Regulatory actions (SEC, CFTC, country bans)
- Protocol hacks, exploits, or security vulnerabilities
- Major partnerships or institutional adoption
- Large whale movements or exchange deposits
- Token unlocks or large supply events
- Fork announcements or major upgrades

Return ONLY this exact JSON structure (no extra text):
{
  "sentiment": "BULLISH" | "BEARISH" | "NEUTRAL",
  "headline": "single most impactful headline in ≤15 words",
  "summary": "2-3 sentence summary of key events and their expected price impact",
  "riskLevel": "LOW" | "MEDIUM" | "HIGH",
  "keyEvents": ["event1", "event2", "event3"],
  "tradingImpact": "1 sentence: how this affects ${coin} trading right now"
}`,
          },
        ],
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      throw new Error(`Perplexity ${response.status}: ${errText}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content ?? '';

    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('Could not parse JSON from Perplexity response');

    const p = JSON.parse(jsonMatch[0]);

    return {
      coin,
      sentiment:     VALID_SENTIMENTS.has(p.sentiment)  ? p.sentiment  : 'NEUTRAL',
      headline:      typeof p.headline === 'string'      ? p.headline   : 'No significant news',
      summary:       typeof p.summary  === 'string'      ? p.summary    : '',
      riskLevel:     VALID_RISKS.has(p.riskLevel)        ? p.riskLevel  : 'LOW',
      keyEvents:     Array.isArray(p.keyEvents)           ? p.keyEvents.slice(0, 5) : [],
      tradingImpact: typeof p.tradingImpact === 'string'  ? p.tradingImpact : '',
      available: true,
    };
  } catch (err: any) {
    console.error('[Perplexity]', err.message);
    return { ...base, headline: `News unavailable: ${err.message}`, error: err.message };
  }
}
