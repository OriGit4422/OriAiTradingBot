import { sql } from "drizzle-orm";
import { pgTable, text, varchar, integer, real, boolean, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  username: text("username").notNull().unique(),
  password: text("password").notNull(),
});

export const insertUserSchema = createInsertSchema(users).pick({
  username: true,
  password: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// User Settings
export const settings = pgTable("settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  displayName: text("display_name").notNull().default("Trader"),
  compactMode: boolean("compact_mode").notNull().default(false),
  soundEffects: boolean("sound_effects").notNull().default(true),
  maxLeverage: integer("max_leverage").notNull().default(20),
  maxRiskPercent: real("max_risk_percent").notNull().default(2.0),
  autoStopLoss: boolean("auto_stop_loss").notNull().default(true),
  telegramEnabled: boolean("telegram_enabled").notNull().default(false),
  telegramBotToken: text("telegram_bot_token"),
  telegramChatId: text("telegram_chat_id"),
  discordEnabled: boolean("discord_enabled").notNull().default(false),
  discordWebhookUrl: text("discord_webhook_url"),
  notifyOnSignal: boolean("notify_on_signal").notNull().default(true),
  notifyOnHighConfidence: boolean("notify_on_high_confidence").notNull().default(true),
  minNotifyConfidence: integer("min_notify_confidence").notNull().default(80),
  binanceApiKey: text("binance_api_key"),
  binanceConnected: boolean("binance_connected").notNull().default(false),
  bybitApiKey: text("bybit_api_key"),
  bybitConnected: boolean("bybit_connected").notNull().default(false),
  // AI Agent integrations
  coinglassApiKey: text("coinglass_api_key"),
  perplexityApiKey: text("perplexity_api_key"),
  arkhamApiKey: text("arkham_api_key"),
  // MT5 / Gold trading
  metaApiToken: text("meta_api_token"),
  metaApiAccountId: text("meta_api_account_id"),
  goldAutoTradingEnabled: boolean("gold_auto_trading_enabled").notNull().default(false),
  goldLotSize: real("gold_lot_size").notNull().default(0.01),
  goldMaxDailyTrades: integer("gold_max_daily_trades").notNull().default(5),
  goldMinConfidence: integer("gold_min_confidence").notNull().default(75),
});

export const insertSettingsSchema = createInsertSchema(settings).omit({ id: true });
export type InsertSettings = z.infer<typeof insertSettingsSchema>;
export type Settings = typeof settings.$inferSelect;

// Trading Strategies
export const strategies = pgTable("strategies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: text("name").notNull(),
  description: text("description").notNull(),
  status: text("status").notNull().default("active"), // active | paused
  risk: text("risk").notNull().default("Medium"), // Low | Medium | High
  winRate: real("win_rate").notNull().default(0),
  totalPnl: real("total_pnl").notNull().default(0),
  totalTrades: integer("total_trades").notNull().default(0),
  pairs: text("pairs").array().notNull().default(sql`'{}'::text[]`),
  config: jsonb("config"),
});

export const insertStrategySchema = createInsertSchema(strategies).omit({ id: true });
export type InsertStrategy = z.infer<typeof insertStrategySchema>;
export type Strategy = typeof strategies.$inferSelect;

// Signal History
export const signals = pgTable("signals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  coin: text("coin").notNull(),
  strategy: text("strategy").notNull(),
  type: text("type").notNull(), // LONG | SHORT
  entry: real("entry").notNull(),
  tp: real("tp").notNull(),
  sl: real("sl").notNull(),
  marketPrice: real("market_price").notNull(),
  timeframe: text("timeframe").notNull(),
  confidence: integer("confidence").notNull(),
  status: text("status").notNull().default("ACTIVE"), // ACTIVE | PENDING | EXECUTED | INVALIDATED
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertSignalSchema = createInsertSchema(signals).omit({ id: true, createdAt: true });
export type InsertSignal = z.infer<typeof insertSignalSchema>;
export type Signal = typeof signals.$inferSelect;

// Portfolio Positions
export const positions = pgTable("positions", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  symbol: text("symbol").notNull(),
  amount: real("amount").notNull(),
  entryPrice: real("entry_price").notNull(),
  type: text("type").notNull(), // LONG | SHORT
  leverage: integer("leverage").notNull().default(1),
  status: text("status").notNull().default("open"), // open | closed
  pnl: real("pnl"),
  closedAt: timestamp("closed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertPositionSchema = createInsertSchema(positions).omit({ id: true, createdAt: true, closedAt: true, pnl: true });
export type InsertPosition = z.infer<typeof insertPositionSchema>;
export type Position = typeof positions.$inferSelect;

// Demo Wallet
export const wallet = pgTable("wallet", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  balance: real("balance").notNull().default(10000), // Default $10k demo
  currency: text("currency").notNull().default("USD"),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertWalletSchema = createInsertSchema(wallet).omit({ id: true, updatedAt: true });
export type Wallet = typeof wallet.$inferSelect;

// User Access / Rights Management
export const userAccess = pgTable("user_access", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  role: text("role").notNull().default("viewer"),
  permissions: text("permissions").array().notNull().default(sql`'{}'::text[]`),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertUserAccessSchema = createInsertSchema(userAccess).omit({ id: true, createdAt: true });
export type InsertUserAccess = z.infer<typeof insertUserAccessSchema>;
export type UserAccess = typeof userAccess.$inferSelect;

// Gold Trades
export const goldTrades = pgTable("gold_trades", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  type: text("type").notNull(), // BUY | SELL
  lotSize: real("lot_size").notNull(),
  entryPrice: real("entry_price").notNull(),
  tp: real("tp").notNull(),
  sl: real("sl").notNull(),
  confidence: integer("confidence").notNull(),
  status: text("status").notNull().default("OPEN"), // OPEN | CLOSED | CANCELLED
  mt5OrderId: text("mt5_order_id"),
  pnl: real("pnl"),
  closedAt: timestamp("closed_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertGoldTradeSchema = createInsertSchema(goldTrades).omit({ id: true, createdAt: true, closedAt: true, pnl: true });
export type InsertGoldTrade = z.infer<typeof insertGoldTradeSchema>;
export type GoldTrade = typeof goldTrades.$inferSelect;

// AI Chat (for integration)
export { conversations, messages } from "./models/chat";
export type { Conversation, Message } from "./models/chat";
