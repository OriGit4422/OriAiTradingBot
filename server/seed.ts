import { db } from "./db";
import { users, strategies, signals, botSettings, tradeHistory } from "@shared/schema";
import { eq } from "drizzle-orm";
import { scryptSync, randomBytes } from "crypto";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

export async function seedDatabase() {
  const existingUsers = await db.select().from(users);
  if (existingUsers.length > 0) return;

  const adminUser = await db.insert(users).values({
    email: "patyqm2010@gmail.com",
    password: hashPassword("Ori@4422"),
    name: "WINM Admin",
    role: "admin",
    avatarColor: "#8B5CF6",
  }).returning();

  const traderUser = await db.insert(users).values({
    email: "trader@winmai.com",
    password: hashPassword("trader123"),
    name: "Pro Trader",
    role: "user",
    avatarColor: "#10B981",
  }).returning();

  await db.insert(users).values({
    email: "demo@winmai.com",
    password: hashPassword("demo123"),
    name: "Demo User",
    role: "user",
    avatarColor: "#F59E0B",
  });

  const adminId = adminUser[0].id;
  const traderId = traderUser[0].id;

  const strats = await db.insert(strategies).values([
    {
      userId: adminId,
      name: "BTC Momentum Scalper",
      description: "AI-powered scalping strategy that uses RSI, MACD, and volume analysis to capture short-term Bitcoin movements.",
      type: "scalping",
      pairs: ["BTC/USDT"],
      indicators: ["RSI", "MACD", "Volume"],
      timeframe: "5m",
      riskLevel: "high",
      isActive: true,
      takeProfit: 1.5,
      stopLoss: 0.8,
      maxPositionSize: 15,
      winRate: 72.5,
      totalTrades: 156,
      profitLoss: 4250.75,
    },
    {
      userId: adminId,
      name: "ETH Swing Trader",
      description: "Medium-term strategy targeting Ethereum price swings using Bollinger Bands and Fibonacci levels.",
      type: "swing",
      pairs: ["ETH/USDT", "ETH/BTC"],
      indicators: ["Bollinger Bands", "Fibonacci", "EMA"],
      timeframe: "4h",
      riskLevel: "medium",
      isActive: true,
      takeProfit: 3.0,
      stopLoss: 1.5,
      maxPositionSize: 20,
      winRate: 65.3,
      totalTrades: 89,
      profitLoss: 2890.50,
    },
    {
      userId: adminId,
      name: "Multi-Coin DCA Bot",
      description: "Dollar-cost averaging strategy across top 5 cryptocurrencies with AI-optimized entry timing.",
      type: "dca",
      pairs: ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "ADA/USDT"],
      indicators: ["SMA", "RSI"],
      timeframe: "1d",
      riskLevel: "low",
      isActive: false,
      takeProfit: 5.0,
      stopLoss: 3.0,
      maxPositionSize: 10,
      winRate: 58.2,
      totalTrades: 45,
      profitLoss: 890.25,
    },
    {
      userId: traderId,
      name: "SOL Breakout Hunter",
      description: "Targets Solana breakout patterns with volume confirmation and trend following.",
      type: "breakout",
      pairs: ["SOL/USDT"],
      indicators: ["Volume", "ATR", "Support/Resistance"],
      timeframe: "1h",
      riskLevel: "high",
      isActive: true,
      takeProfit: 4.0,
      stopLoss: 2.0,
      maxPositionSize: 25,
      winRate: 61.8,
      totalTrades: 67,
      profitLoss: 1560.30,
    },
  ]).returning();

  await db.insert(signals).values([
    {
      userId: adminId,
      strategyId: strats[0].id,
      pair: "BTC/USDT",
      type: "long",
      entry: 67250.50,
      target: 69500.00,
      stopLoss: 66100.00,
      confidence: 0.87,
      status: "active",
      aiAnalysis: "Strong bullish divergence on 4H RSI. MACD histogram turning positive. Volume increasing 35% above average. Key resistance at 68,000 likely to break.",
    },
    {
      userId: adminId,
      strategyId: strats[1].id,
      pair: "ETH/USDT",
      type: "long",
      entry: 3420.75,
      target: 3650.00,
      stopLoss: 3310.00,
      confidence: 0.78,
      status: "active",
      aiAnalysis: "ETH forming ascending triangle on daily chart. Bollinger Band squeeze indicates imminent breakout. On-chain metrics show whale accumulation.",
    },
    {
      userId: adminId,
      pair: "SOL/USDT",
      type: "short",
      entry: 168.50,
      target: 155.00,
      stopLoss: 175.00,
      confidence: 0.65,
      status: "closed",
      aiAnalysis: "Overbought conditions on multiple timeframes. Bearish evening star pattern forming. Smart money flow indicator shows distribution.",
    },
    {
      userId: traderId,
      strategyId: strats[3].id,
      pair: "SOL/USDT",
      type: "long",
      entry: 152.30,
      target: 170.00,
      stopLoss: 145.00,
      confidence: 0.82,
      status: "active",
      aiAnalysis: "Breakout above key resistance with massive volume. AI model predicts 82% probability of continuation. Fibonacci extension targets 170.",
    },
  ]);

  await db.insert(botSettings).values([
    {
      userId: adminId,
      exchangeName: "binance",
      isLive: false,
      maxDailyTrades: 15,
      maxRiskPerTrade: 2.5,
      dailyLossLimit: 5.0,
      notificationsEnabled: true,
      emailAlerts: true,
      autoTrade: true,
      trailingStop: true,
      defaultLeverage: 3,
    },
    {
      userId: traderId,
      exchangeName: "bybit",
      isLive: false,
      maxDailyTrades: 10,
      maxRiskPerTrade: 2.0,
      dailyLossLimit: 4.0,
      notificationsEnabled: true,
      emailAlerts: false,
      autoTrade: false,
      trailingStop: false,
      defaultLeverage: 1,
    },
  ]);

  await db.insert(tradeHistory).values([
    { userId: adminId, strategyId: strats[0].id, pair: "BTC/USDT", type: "long", entryPrice: 64500, exitPrice: 66200, quantity: 0.05, profitLoss: 85.0, status: "closed" },
    { userId: adminId, strategyId: strats[0].id, pair: "BTC/USDT", type: "short", entryPrice: 67800, exitPrice: 66500, quantity: 0.03, profitLoss: 39.0, status: "closed" },
    { userId: adminId, strategyId: strats[1].id, pair: "ETH/USDT", type: "long", entryPrice: 3150, exitPrice: 3380, quantity: 1.2, profitLoss: 276.0, status: "closed" },
    { userId: adminId, strategyId: strats[0].id, pair: "BTC/USDT", type: "long", entryPrice: 66100, exitPrice: 65800, quantity: 0.04, profitLoss: -12.0, status: "closed" },
    { userId: traderId, strategyId: strats[3].id, pair: "SOL/USDT", type: "long", entryPrice: 145, exitPrice: 158, quantity: 10, profitLoss: 130.0, status: "closed" },
    { userId: traderId, strategyId: strats[3].id, pair: "SOL/USDT", type: "long", entryPrice: 155, quantity: 8, status: "open" },
  ]);

  console.log("Database seeded successfully");
}
