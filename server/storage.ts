import { eq, desc, and } from "drizzle-orm";
import { db } from "./db";
import {
  users, strategies, signals, botSettings, tradeHistory,
  type User, type InsertUser, type Strategy, type InsertStrategy,
  type Signal, type InsertSignal, type BotSettings, type InsertBotSettings,
  type TradeHistory,
} from "@shared/schema";
import { scryptSync, randomBytes } from "crypto";

function hashPassword(password: string): string {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return `${salt}:${hash}`;
}

function verifyPassword(password: string, stored: string): boolean {
  const [salt, hash] = stored.split(":");
  const newHash = scryptSync(password, salt, 64).toString("hex");
  return hash === newHash;
}

export interface IStorage {
  getUser(id: string): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  createUser(user: InsertUser): Promise<User>;
  verifyUser(email: string, password: string): Promise<User | null>;
  getAllUsers(): Promise<User[]>;
  updateUser(id: string, data: Partial<User>): Promise<User | undefined>;
  deleteUser(id: string): Promise<void>;
  setResetToken(email: string, token: string, expiry: Date): Promise<boolean>;
  getUserByResetToken(token: string): Promise<User | undefined>;
  resetPassword(userId: string, newPassword: string): Promise<void>;

  getStrategies(userId: string): Promise<Strategy[]>;
  getStrategy(id: string): Promise<Strategy | undefined>;
  createStrategy(userId: string, data: InsertStrategy): Promise<Strategy>;
  updateStrategy(id: string, data: Partial<Strategy>): Promise<Strategy | undefined>;
  deleteStrategy(id: string): Promise<void>;

  getSignals(userId: string): Promise<Signal[]>;
  getSignal(id: string): Promise<Signal | undefined>;
  createSignal(userId: string, data: InsertSignal): Promise<Signal>;
  updateSignal(id: string, data: Partial<Signal>): Promise<Signal | undefined>;
  deleteSignal(id: string): Promise<void>;

  getBotSettings(userId: string): Promise<BotSettings | undefined>;
  upsertBotSettings(userId: string, data: InsertBotSettings): Promise<BotSettings>;

  getTradeHistory(userId: string): Promise<TradeHistory[]>;
  createTrade(userId: string, data: Partial<TradeHistory>): Promise<TradeHistory>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.id, id));
    return user;
  }

  async getUserByEmail(email: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.email, email));
    return user;
  }

  async createUser(insertUser: InsertUser): Promise<User> {
    const hashedPassword = hashPassword(insertUser.password);
    const [user] = await db.insert(users).values({
      ...insertUser,
      password: hashedPassword,
    }).returning();
    return user;
  }

  async verifyUser(email: string, password: string): Promise<User | null> {
    const user = await this.getUserByEmail(email);
    if (!user) return null;
    if (!user.isActive) return null;
    if (!verifyPassword(password, user.password)) return null;
    await db.update(users).set({ lastLogin: new Date() }).where(eq(users.id, user.id));
    return user;
  }

  async getAllUsers(): Promise<User[]> {
    return db.select().from(users);
  }

  async updateUser(id: string, data: Partial<User>): Promise<User | undefined> {
    const [user] = await db.update(users).set(data).where(eq(users.id, id)).returning();
    return user;
  }

  async deleteUser(id: string): Promise<void> {
    await db.delete(users).where(eq(users.id, id));
  }

  async setResetToken(email: string, token: string, expiry: Date): Promise<boolean> {
    const result = await db.update(users).set({ resetToken: token, resetTokenExpiry: expiry }).where(eq(users.email, email)).returning();
    return result.length > 0;
  }

  async getUserByResetToken(token: string): Promise<User | undefined> {
    const [user] = await db.select().from(users).where(eq(users.resetToken, token));
    return user;
  }

  async resetPassword(userId: string, newPassword: string): Promise<void> {
    const hashedPassword = hashPassword(newPassword);
    await db.update(users).set({ password: hashedPassword, resetToken: null, resetTokenExpiry: null }).where(eq(users.id, userId));
  }

  async getStrategies(userId: string): Promise<Strategy[]> {
    return db.select().from(strategies).where(eq(strategies.userId, userId));
  }

  async getStrategy(id: string): Promise<Strategy | undefined> {
    const [strategy] = await db.select().from(strategies).where(eq(strategies.id, id));
    return strategy;
  }

  async createStrategy(userId: string, data: InsertStrategy): Promise<Strategy> {
    const [strategy] = await db.insert(strategies).values({ ...data, userId }).returning();
    return strategy;
  }

  async updateStrategy(id: string, data: Partial<Strategy>): Promise<Strategy | undefined> {
    const [strategy] = await db.update(strategies).set(data).where(eq(strategies.id, id)).returning();
    return strategy;
  }

  async deleteStrategy(id: string): Promise<void> {
    await db.delete(strategies).where(eq(strategies.id, id));
  }

  async getSignals(userId: string): Promise<Signal[]> {
    return db.select().from(signals).where(eq(signals.userId, userId)).orderBy(desc(signals.createdAt));
  }

  async getSignal(id: string): Promise<Signal | undefined> {
    const [signal] = await db.select().from(signals).where(eq(signals.id, id));
    return signal;
  }

  async createSignal(userId: string, data: InsertSignal): Promise<Signal> {
    const [signal] = await db.insert(signals).values({ ...data, userId }).returning();
    return signal;
  }

  async updateSignal(id: string, data: Partial<Signal>): Promise<Signal | undefined> {
    const [signal] = await db.update(signals).set(data).where(eq(signals.id, id)).returning();
    return signal;
  }

  async deleteSignal(id: string): Promise<void> {
    await db.delete(signals).where(eq(signals.id, id));
  }

  async getBotSettings(userId: string): Promise<BotSettings | undefined> {
    const [settings] = await db.select().from(botSettings).where(eq(botSettings.userId, userId));
    return settings;
  }

  async upsertBotSettings(userId: string, data: InsertBotSettings): Promise<BotSettings> {
    const existing = await this.getBotSettings(userId);
    if (existing) {
      const [updated] = await db.update(botSettings).set(data).where(eq(botSettings.userId, userId)).returning();
      return updated;
    }
    const [created] = await db.insert(botSettings).values({ ...data, userId }).returning();
    return created;
  }

  async getTradeHistory(userId: string): Promise<TradeHistory[]> {
    return db.select().from(tradeHistory).where(eq(tradeHistory.userId, userId)).orderBy(desc(tradeHistory.openedAt));
  }

  async createTrade(userId: string, data: Partial<TradeHistory>): Promise<TradeHistory> {
    const [trade] = await db.insert(tradeHistory).values({ ...data, userId } as any).returning();
    return trade;
  }
}

export const storage = new DatabaseStorage();
