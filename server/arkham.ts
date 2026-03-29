import { storage } from './storage';

export interface WhaleTransfer {
  amount: string;
  amountUSD: number;
  direction: 'TO_EXCHANGE' | 'FROM_EXCHANGE' | 'WHALE_TO_WHALE';
  fromEntity: string;
  toEntity: string;
  chain: string;
  time: string;
}

export interface WhaleActivity {
  coin: string;
  netExchangeFlow: 'INFLOW' | 'OUTFLOW' | 'NEUTRAL';
  exchangeInflows: number;   // count of large transfers TO exchanges
  exchangeOutflows: number;  // count of large transfers FROM exchanges
  totalVolumeUSD: number;
  flowBias: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  signal: string;
  topTransfers: WhaleTransfer[];
  available: boolean;
  error?: string;
}

// Arkham chain identifiers
const CHAIN_MAP: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  BNB: 'bsc',
  AVAX: 'avalanche',
  XRP: 'xrp',
  ADA: 'cardano',
  DOGE: 'dogecoin',
};

// Known exchange entity name fragments
const EXCHANGE_NAMES = ['binance', 'coinbase', 'kraken', 'bybit', 'okx', 'okex', 'huobi', 'htx',
  'kucoin', 'bitfinex', 'gate', 'mexc', 'bitget', 'crypto.com'];

function isExchange(entityName: string): boolean {
  const lower = (entityName ?? '').toLowerCase();
  return EXCHANGE_NAMES.some(ex => lower.includes(ex));
}

function formatAmount(value: number, coin: string): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(2)}M ${coin}`;
  if (value >= 1_000)     return `${(value / 1_000).toFixed(1)}K ${coin}`;
  return `${value.toFixed(2)} ${coin}`;
}

export async function getWhaleActivity(coin: string): Promise<WhaleActivity> {
  const base: WhaleActivity = {
    coin, netExchangeFlow: 'NEUTRAL', exchangeInflows: 0, exchangeOutflows: 0,
    totalVolumeUSD: 0, flowBias: 'NEUTRAL',
    signal: 'Arkham API key not configured', topTransfers: [], available: false,
  };

  try {
    const settings = await storage.getSettings();
    const apiKey = settings?.arkhamApiKey;
    if (!apiKey) return base;

    const chain = CHAIN_MAP[coin];
    if (!chain) return { ...base, signal: `Chain not supported for ${coin}` };

    // Query recent large transfers on this chain
    const params = new URLSearchParams({
      base: chain,
      limit: '30',
      sortKey: 'time',
      sortDir: 'desc',
      timeGte: String(Math.floor(Date.now() / 1000) - 86400), // last 24h
    });

    const res = await fetch(`https://api.arkhamintelligence.com/transfers?${params}`, {
      headers: { 'API-Key': apiKey, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) throw new Error(`Arkham ${res.status}: ${await res.text()}`);
    const data = await res.json();
    const transfers: any[] = data.transfers ?? data ?? [];

    let exchangeInflows  = 0;
    let exchangeOutflows = 0;
    let totalVolumeUSD   = 0;
    const topTransfers: WhaleTransfer[] = [];

    for (const tx of transfers) {
      const fromName = tx.fromAddress?.arkhamEntity?.name ?? tx.fromAddress?.address ?? 'Unknown';
      const toName   = tx.toAddress?.arkhamEntity?.name   ?? tx.toAddress?.address   ?? 'Unknown';
      const unitVal  = parseFloat(tx.unitValue  ?? tx.tokenAmount ?? '0');
      const usdVal   = parseFloat(tx.historicalUSD ?? tx.usdValue ?? '0');

      totalVolumeUSD += usdVal;

      let direction: WhaleTransfer['direction'] = 'WHALE_TO_WHALE';
      if      (isExchange(toName)   && !isExchange(fromName)) { direction = 'TO_EXCHANGE';   exchangeInflows++;  }
      else if (isExchange(fromName) && !isExchange(toName))   { direction = 'FROM_EXCHANGE'; exchangeOutflows++; }

      topTransfers.push({
        amount:      formatAmount(unitVal, coin),
        amountUSD:   Math.round(usdVal),
        direction,
        fromEntity:  fromName.slice(0, 30),
        toEntity:    toName.slice(0, 30),
        chain,
        time:        tx.blockTimestamp ? new Date(tx.blockTimestamp * 1000).toLocaleTimeString() : 'Unknown',
      });
    }

    // Sort by USD value desc, take top 5
    topTransfers.sort((a, b) => b.amountUSD - a.amountUSD);
    const top5 = topTransfers.slice(0, 5);

    // Determine flow bias
    let netExchangeFlow: WhaleActivity['netExchangeFlow'] = 'NEUTRAL';
    let flowBias: WhaleActivity['flowBias']               = 'NEUTRAL';
    let signal = '';
    const net = exchangeInflows - exchangeOutflows;

    if (net >= 4) {
      netExchangeFlow = 'INFLOW';
      flowBias        = 'BEARISH';
      signal = `🔴 ${exchangeInflows} large transfers TO exchanges — whales depositing, potential sell pressure`;
    } else if (net <= -4) {
      netExchangeFlow = 'OUTFLOW';
      flowBias        = 'BULLISH';
      signal = `🟢 ${exchangeOutflows} withdrawals FROM exchanges — whales accumulating off exchange`;
    } else if (exchangeInflows === 0 && exchangeOutflows === 0) {
      signal = `⚪ No large whale movements detected in last 24h for ${coin}`;
    } else {
      signal = `⚪ Balanced whale flow: ${exchangeInflows} exchange deposits, ${exchangeOutflows} withdrawals`;
    }

    return {
      coin, netExchangeFlow, exchangeInflows, exchangeOutflows,
      totalVolumeUSD: Math.round(totalVolumeUSD),
      flowBias, signal, topTransfers: top5, available: true,
    };
  } catch (err: any) {
    console.error('[Arkham]', err.message);
    return { ...base, signal: `Arkham unavailable: ${err.message}`, error: err.message };
  }
}
