import { CandlestickData, Time } from 'lightweight-charts';

export interface Coin {
  symbol: string;
  name: string;
  price: number;
  change24h: number;
  volume: string;
}

export interface Signal {
  id: string;
  coin: string;
  strategy: 'SMC' | 'ICT' | 'DDMC' | 'DMC' | 'CRT' | 'MMC' | 'MMCC' | 'RCT';
  type: 'LONG' | 'SHORT';
  entry: number;
  tp: number;
  sl: number;
  timeframe: '1m' | '3m' | '5m' | '15m' | '30m' | '1h' | '4h' | '8h' | '1d';
  confidence: number;
  timestamp: string;
  status: 'ACTIVE' | 'PENDING' | 'EXECUTED';
}

export const COINS: Coin[] = [
  { symbol: 'BTC', name: 'Bitcoin', price: 98432.50, change24h: 2.4, volume: '45.2B' },
  { symbol: 'ETH', name: 'Ethereum', price: 3450.12, change24h: -1.2, volume: '18.1B' },
  { symbol: 'SOL', name: 'Solana', price: 145.60, change24h: 5.8, volume: '4.2B' },
  { symbol: 'BNB', name: 'Binance Coin', price: 590.20, change24h: 0.5, volume: '1.2B' },
  { symbol: 'XRP', name: 'Ripple', price: 1.12, change24h: -0.8, volume: '2.1B' },
  { symbol: 'ADA', name: 'Cardano', price: 0.45, change24h: 1.1, volume: '0.8B' },
  { symbol: 'DOGE', name: 'Dogecoin', price: 0.12, change24h: 8.4, volume: '3.5B' },
  { symbol: 'AVAX', name: 'Avalanche', price: 32.40, change24h: -2.1, volume: '0.6B' },
  { symbol: 'DOT', name: 'Polkadot', price: 6.80, change24h: 0.2, volume: '0.4B' },
  { symbol: 'LINK', name: 'Chainlink', price: 14.20, change24h: 3.2, volume: '0.9B' },
  { symbol: 'MATIC', name: 'Polygon', price: 0.65, change24h: -1.5, volume: '0.3B' },
  { symbol: 'TRX', name: 'Tron', price: 0.11, change24h: 0.1, volume: '0.2B' },
  { symbol: 'SHIB', name: 'Shiba Inu', price: 0.000024, change24h: 4.5, volume: '1.1B' },
  { symbol: 'LTC', name: 'Litecoin', price: 85.40, change24h: 0.8, volume: '0.5B' },
  { symbol: 'UNI', name: 'Uniswap', price: 7.80, change24h: -3.4, volume: '0.3B' },
  { symbol: 'ATOM', name: 'Cosmos', price: 8.90, change24h: 1.2, volume: '0.2B' },
  { symbol: 'XLM', name: 'Stellar', price: 0.10, change24h: -0.5, volume: '0.1B' },
  { symbol: 'NEAR', name: 'Near Protocol', price: 5.40, change24h: 6.7, volume: '0.4B' },
  { symbol: 'APT', name: 'Aptos', price: 9.20, change24h: 2.1, volume: '0.3B' },
  { symbol: 'FIL', name: 'Filecoin', price: 5.60, change24h: -1.8, volume: '0.2B' },
];

export const SIGNALS: Signal[] = [
  { id: '1', coin: 'BTC', strategy: 'SMC', type: 'LONG', entry: 98100, tp: 102000, sl: 97500, timeframe: '15m', confidence: 92, timestamp: '2 min ago', status: 'ACTIVE' },
  { id: '2', coin: 'ETH', strategy: 'ICT', type: 'SHORT', entry: 3480, tp: 3300, sl: 3520, timeframe: '1h', confidence: 88, timestamp: '15 min ago', status: 'ACTIVE' },
  { id: '3', coin: 'SOL', strategy: 'DDMC', type: 'LONG', entry: 142.50, tp: 155.00, sl: 138.00, timeframe: '4h', confidence: 95, timestamp: '1 hour ago', status: 'PENDING' },
  { id: '4', coin: 'XRP', strategy: 'MMC', type: 'SHORT', entry: 1.15, tp: 1.05, sl: 1.18, timeframe: '5m', confidence: 76, timestamp: '5 min ago', status: 'EXECUTED' },
  { id: '5', coin: 'DOGE', strategy: 'RCT', type: 'LONG', entry: 0.115, tp: 0.14, sl: 0.11, timeframe: '1m', confidence: 65, timestamp: '30 sec ago', status: 'ACTIVE' },
  { id: '6', coin: 'BNB', strategy: 'MMCC', type: 'LONG', entry: 585, tp: 610, sl: 575, timeframe: '30m', confidence: 82, timestamp: '45 min ago', status: 'PENDING' },
  { id: '7', coin: 'ADA', strategy: 'CRT', type: 'SHORT', entry: 0.46, tp: 0.42, sl: 0.47, timeframe: '1d', confidence: 89, timestamp: '4 hours ago', status: 'ACTIVE' },
  { id: '8', coin: 'AVAX', strategy: 'DMC', type: 'LONG', entry: 31.50, tp: 35.00, sl: 30.00, timeframe: '4h', confidence: 91, timestamp: '2 hours ago', status: 'ACTIVE' },
];

export const generateCandleData = (startPrice: number, count: number = 100): CandlestickData<Time>[] => {
  let price = startPrice;
  const data: CandlestickData<Time>[] = [];
  const now = Math.floor(Date.now() / 1000); // Current timestamp in seconds

  for (let i = count; i > 0; i--) {
    const time = (now - i * 60 * 60) as Time; // Hourly candles
    const open = price;
    const high = open * (1 + (Math.random() * 0.02));
    const low = open * (1 - (Math.random() * 0.02));
    const close = (open + high + low) / 3 + (Math.random() - 0.5) * open * 0.01;
    
    data.push({
      time,
      open,
      high,
      low,
      close,
    });
    price = close;
  }
  return data;
};
