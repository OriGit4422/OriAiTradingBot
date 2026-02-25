import { eq } from "drizzle-orm";
import { db } from "./db";
import {
  users, type User, type InsertUser,
  settings, type Settings, type InsertSettings,
  strategies, type Strategy, type InsertStrategy,
  signals, type Signal, type InsertSignal,
  positions, type Position, type InsertPosition,
  wallet, type Wallet
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
}

export class DatabaseStorage implements IStorage {
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
    return db.select().from(strategies);
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
}

export const storage = new DatabaseStorage();
