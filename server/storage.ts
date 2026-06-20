import { eq, desc } from "drizzle-orm";
import { db } from "./db";
import {
  users, type User, type InsertUser,
  settings, type Settings, type InsertSettings,
  strategies, type Strategy, type InsertStrategy,
  signals, type Signal, type InsertSignal,
  positions, type Position, type InsertPosition,
  wallet, type Wallet,
  userAccess, type UserAccess, type InsertUserAccess,
  botSettings, type BotSettings, type InsertBotSettings,
  botTrades, type BotTrade, type InsertBotTrade,
  botLogs, type BotLog, type InsertBotLog,
} from "@shared/schema";

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByUsername(username: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;

  getSettings(): Promise<Settings | undefined>;
  upsertSettings(data: Partial<InsertSettings>): Promise<Settings>;

  getStrategies(): Promise<Strategy[]>;
  getStrategy(id: string): Promise<Strategy | undefined>;
  createStrategy(data: InsertStrategy): Promise<Strategy>;
  updateStrategy(id: string, data: Partial<InsertStrategy>): Promise<Strategy | undefined>;
  deleteStrategy(id: string): Promise<void>;

  getSignals(): Promise<Signal[]>;
  getSignal(id: string): Promise<Signal | undefined>;
  createSignal(data: InsertSignal): Promise<Signal>;
  updateSignalStatus(id: string, status: string): Promise<Signal | undefined>;
  clearSignals(): Promise<void>;

  getPositions(): Promise<Position[]>;
  getOpenPositions(): Promise<Position[]>;
  createPosition(data: InsertPosition): Promise<Position>;
  closePosition(id: string, pnl: number): Promise<Position | undefined>;
  // Wallet
  getWallet(): Promise<Wallet>;
  updateWalletBalance(amount: number): Promise<Wallet>;
  // User Access
  getUserAccessList(): Promise<UserAccess[]>;
  getUserAccess(id: string): Promise<UserAccess | undefined>;
  createUserAccess(data: InsertUserAccess): Promise<UserAccess>;
  updateUserAccess(id: string, data: Partial<InsertUserAccess>): Promise<UserAccess | undefined>;
  deleteUserAccess(id: string): Promise<void>;

  // ===== AI Auto-Trading Bot =====
  getBotSettings(): Promise<BotSettings>;
  upsertBotSettings(data: Partial<InsertBotSettings>): Promise<BotSettings>;

  getBotTrades(limit?: number): Promise<BotTrade[]>;
  getBotTrade(id: string): Promise<BotTrade | undefined>;
  getOpenBotTrades(): Promise<BotTrade[]>;
  createBotTrade(data: InsertBotTrade): Promise<BotTrade>;
  updateBotTrade(id: string, data: Partial<BotTrade>): Promise<BotTrade | undefined>;

  getBotLogs(limit?: number): Promise<BotLog[]>;
  createBotLog(data: InsertBotLog): Promise<BotLog>;
  clearBotLogs(): Promise<void>;
}

export class DatabaseStorage implements IStorage {
  private readonly defaultStrategies: InsertStrategy[] = [
    {
      name: "SMC Liquidity Sweep",
      description: "Smart Money Concepts setup using liquidity grabs and BOS confirmation.",
      status: "active",
      risk: "Medium",
      winRate: 68,
      totalPnl: 1240,
      totalTrades: 87,
      pairs: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
      config: { timeframe: "15m-1h", confirmations: ["BOS", "OrderBlock", "RSI Divergence"] },
    },
    {
      name: "ICT Session Bias",
      description: "ICT killzone/session model with FVG + premium/discount arrays.",
      status: "active",
      risk: "High",
      winRate: 63,
      totalPnl: 980,
      totalTrades: 59,
      pairs: ["BTCUSDT", "XRPUSDT", "BNBUSDT"],
      config: { timeframe: "5m-15m", sessions: ["London", "NY"], confirmations: ["FVG", "CHOCH"] },
    },
    {
      name: "Trend Continuation EMA",
      description: "Momentum continuation using EMA stack + volume expansion.",
      status: "active",
      risk: "Low",
      winRate: 71,
      totalPnl: 1640,
      totalTrades: 112,
      pairs: ["BTCUSDT", "ETHUSDT", "DOGEUSDT", "ADAUSDT"],
      config: { timeframe: "1h-4h", confirmations: ["EMA9/21/50", "MACD", "Volume"] },
    },
    {
      name: "RSI Mean Reversion",
      description: "Fades overbought/oversold extremes (RSI >75 short, <25 long) with Stoch RSI confirmation. Best in ranging markets.",
      status: "active",
      risk: "Medium",
      winRate: 66,
      totalPnl: 870,
      totalTrades: 74,
      pairs: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT"],
      config: { timeframe: "15m-4h", confirmations: ["RSI", "StochRSI", "Bollinger"] },
    },
    {
      name: "Bollinger Band Squeeze",
      description: "Enters breakout trades when Bollinger Bands contract (low volatility squeeze) then expand with volume surge.",
      status: "active",
      risk: "Medium",
      winRate: 64,
      totalPnl: 1120,
      totalTrades: 68,
      pairs: ["BTCUSDT", "ETHUSDT", "AVAXUSDT", "DOTUSDT"],
      config: { timeframe: "1h-4h", confirmations: ["BB Width", "Volume", "MACD"] },
    },
    {
      name: "VWAP Deviation",
      description: "Trades mean-reversion to VWAP using +/-2 standard deviation bands. Intraday edge for liquid assets.",
      status: "active",
      risk: "Low",
      winRate: 69,
      totalPnl: 1380,
      totalTrades: 95,
      pairs: ["BTCUSDT", "ETHUSDT", "BNBUSDT"],
      config: { timeframe: "5m-15m", confirmations: ["VWAP", "SD Bands", "Volume"] },
    },
    {
      name: "Fibonacci Retracement",
      description: "Enters pullbacks at key Fib levels (0.382, 0.5, 0.618) in trending markets with OB or FVG confluence.",
      status: "active",
      risk: "Medium",
      winRate: 67,
      totalPnl: 1560,
      totalTrades: 83,
      pairs: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "ADAUSDT"],
      config: { timeframe: "1h-1d", confirmations: ["Fibonacci", "OrderBlock", "RSI"] },
    },
    {
      name: "Golden/Death Cross",
      description: "Long on EMA50/200 golden cross with volume confirmation; short on death cross. Trend-following swing strategy.",
      status: "active",
      risk: "Low",
      winRate: 72,
      totalPnl: 2100,
      totalTrades: 48,
      pairs: ["BTCUSDT", "ETHUSDT", "BNBUSDT", "SOLUSDT"],
      config: { timeframe: "4h-1d", confirmations: ["EMA50", "EMA200", "Volume"] },
    },
    {
      name: "Volume Profile VAH/VAL",
      description: "Fades price at Value Area High/Low when markets revisit high-volume nodes. Institutional-grade zone entries.",
      status: "active",
      risk: "High",
      winRate: 61,
      totalPnl: 740,
      totalTrades: 41,
      pairs: ["BTCUSDT", "ETHUSDT"],
      config: { timeframe: "1h-4h", confirmations: ["VAH", "VAL", "POC", "Volume"] },
    },
    {
      name: "Multi-TF Confluence",
      description: "Requires HTF trend alignment (4h/1d) with LTF entry trigger (15m/1h). Only trades when 3+ timeframes agree.",
      status: "active",
      risk: "Low",
      winRate: 74,
      totalPnl: 2340,
      totalTrades: 61,
      pairs: ["BTCUSDT", "ETHUSDT", "SOLUSDT", "XRPUSDT", "BNBUSDT"],
      config: { timeframe: "15m-1d", confirmations: ["HTF Trend", "LTF Trigger", "Volume", "RSI"] },
    },
    {
      name: "Breakout + Retest",
      description: "Waits for key level breakout then enters on the retest of broken structure with volume and candle confirmation.",
      status: "paused",
      risk: "Medium",
      winRate: 65,
      totalPnl: 1050,
      totalTrades: 77,
      pairs: ["BTCUSDT", "ETHUSDT", "LINKUSDT", "AVAXUSDT"],
      config: { timeframe: "1h-4h", confirmations: ["Structure Break", "Retest", "Volume"] },
    },
    {
      name: "Funding Rate Arbitrage",
      description: "Exploits extreme positive/negative funding rates on perp futures. Longs when funding < -0.05%, shorts when > 0.1%.",
      status: "paused",
      risk: "High",
      winRate: 59,
      totalPnl: 620,
      totalTrades: 33,
      pairs: ["BTCUSDT", "ETHUSDT", "SOLUSDT"],
      config: { timeframe: "4h-1d", confirmations: ["Funding Rate", "OI Trend", "RSI"] },
    },
  ];

  async getWallet(): Promise<Wallet> {
    let [w] = await db.select().from(wallet);
    if (!w) {
      [w] = await db.insert(wallet).values({ balance: 10000 }).returning();
    }
    return w;
  }

  async updateWalletBalance(amount: number): Promise<Wallet> {
    const w = await this.getWallet();
    const [updated] = await db.update(wallet)
      .set({ balance: w.balance + amount, updatedAt: new Date() })
      .where(eq(wallet.id, w.id))
      .returning();
    return updated;
  }

  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByUsername(username: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.username, username));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const [user] = await db.insert(users).values(insertUser).returning();
    return user;
  }

  async getSettings(): Promise<Settings | undefined> {
    const [s] = await db.select().from(settings);
    return s;
  }

  async upsertSettings(data: Partial<InsertSettings>): Promise<Settings> {
    const existing = await this.getSettings();
    if (existing) {
      const [updated] = await db.update(settings).set(data).where(eq(settings.id, existing.id)).returning();
      return updated;
    }
    const [created] = await db.insert(settings).values(data as InsertSettings).returning();
    return created;
  }

  async getStrategies(): Promise<Strategy[]> {
    const rows = await db.select().from(strategies);
    if (rows.length > 0) return rows;

    const seeded = await db.insert(strategies).values(this.defaultStrategies).returning();
    return seeded;
  }

  async getStrategy(id: string): Promise<Strategy | undefined> {
    const [s] = await db.select().from(strategies).where(eq(strategies.id, id));
    return s;
  }

  async createStrategy(data: InsertStrategy): Promise<Strategy> {
    const [s] = await db.insert(strategies).values(data).returning();
    return s;
  }

  async updateStrategy(id: string, data: Partial<InsertStrategy>): Promise<Strategy | undefined> {
    const [s] = await db.update(strategies).set(data).where(eq(strategies.id, id)).returning();
    return s;
  }

  async deleteStrategy(id: string): Promise<void> {
    await db.delete(strategies).where(eq(strategies.id, id));
  }

  async getSignals(): Promise<Signal[]> {
    return db.select().from(signals).orderBy(signals.createdAt);
  }

  async getSignal(id: string): Promise<Signal | undefined> {
    const [s] = await db.select().from(signals).where(eq(signals.id, id));
    return s;
  }

  async createSignal(data: InsertSignal): Promise<Signal> {
    const [s] = await db.insert(signals).values(data).returning();
    return s;
  }

  async updateSignalStatus(id: string, status: string): Promise<Signal | undefined> {
    const [s] = await db.update(signals).set({ status }).where(eq(signals.id, id)).returning();
    return s;
  }

  async clearSignals(): Promise<void> {
    await db.delete(signals);
  }

  async getPositions(): Promise<Position[]> {
    return db.select().from(positions).orderBy(positions.createdAt);
  }

  async getOpenPositions(): Promise<Position[]> {
    return db.select().from(positions).where(eq(positions.status, "open"));
  }

  async createPosition(data: InsertPosition): Promise<Position> {
    const [p] = await db.insert(positions).values(data).returning();
    return p;
  }

  async closePosition(id: string, pnl: number): Promise<Position | undefined> {
    const [p] = await db.update(positions)
      .set({ status: "closed", pnl, closedAt: new Date() })
      .where(eq(positions.id, id))
      .returning();
    return p;
  }
  async getUserAccessList(): Promise<UserAccess[]> {
    return db.select().from(userAccess).orderBy(userAccess.createdAt);
  }

  async getUserAccess(id: string): Promise<UserAccess | undefined> {
    const [u] = await db.select().from(userAccess).where(eq(userAccess.id, id));
    return u;
  }

  async createUserAccess(data: InsertUserAccess): Promise<UserAccess> {
    const [u] = await db.insert(userAccess).values(data).returning();
    return u;
  }

  async updateUserAccess(id: string, data: Partial<InsertUserAccess>): Promise<UserAccess | undefined> {
    const [u] = await db.update(userAccess).set(data).where(eq(userAccess.id, id)).returning();
    return u;
  }

  async deleteUserAccess(id: string): Promise<void> {
    await db.delete(userAccess).where(eq(userAccess.id, id));
  }

  // ===== AI Auto-Trading Bot =====
  async getBotSettings(): Promise<BotSettings> {
    let [s] = await db.select().from(botSettings);
    if (!s) {
      [s] = await db.insert(botSettings).values({}).returning();
    }
    return s;
  }

  async upsertBotSettings(data: Partial<InsertBotSettings>): Promise<BotSettings> {
    const existing = await this.getBotSettings();
    const [updated] = await db.update(botSettings)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(botSettings.id, existing.id))
      .returning();
    return updated;
  }

  async getBotTrades(limit = 100): Promise<BotTrade[]> {
    return db.select().from(botTrades).orderBy(desc(botTrades.createdAt)).limit(limit);
  }

  async getBotTrade(id: string): Promise<BotTrade | undefined> {
    const [t] = await db.select().from(botTrades).where(eq(botTrades.id, id));
    return t;
  }

  async getOpenBotTrades(): Promise<BotTrade[]> {
    return db.select().from(botTrades).where(eq(botTrades.status, "open")).orderBy(desc(botTrades.createdAt));
  }

  async createBotTrade(data: InsertBotTrade): Promise<BotTrade> {
    const [t] = await db.insert(botTrades).values(data).returning();
    return t;
  }

  async updateBotTrade(id: string, data: Partial<BotTrade>): Promise<BotTrade | undefined> {
    const [t] = await db.update(botTrades).set(data).where(eq(botTrades.id, id)).returning();
    return t;
  }

  async getBotLogs(limit = 100): Promise<BotLog[]> {
    return db.select().from(botLogs).orderBy(desc(botLogs.createdAt)).limit(limit);
  }

  async createBotLog(data: InsertBotLog): Promise<BotLog> {
    const [l] = await db.insert(botLogs).values(data).returning();
    return l;
  }

  async clearBotLogs(): Promise<void> {
    await db.delete(botLogs);
  }
}

export const storage = new DatabaseStorage();
