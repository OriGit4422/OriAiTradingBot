import { sql } from "drizzle-orm";
import { pgTable, text, varchar, boolean, integer, real, timestamp, jsonb } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const users = pgTable("users", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  name: text("name").notNull(),
  role: text("role").notNull().default("user"),
  isActive: boolean("is_active").notNull().default(true),
  avatarColor: text("avatar_color").default("#3B82F6"),
  lastLogin: timestamp("last_login"),
  resetToken: text("reset_token"),
  resetTokenExpiry: timestamp("reset_token_expiry"),
});

export const strategies = pgTable("strategies", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  name: text("name").notNull(),
  description: text("description"),
  type: text("type").notNull().default("scalping"),
  pairs: text("pairs").array().default(sql`ARRAY[]::text[]`),
  indicators: text("indicators").array().default(sql`ARRAY[]::text[]`),
  timeframe: text("timeframe").notNull().default("1h"),
  riskLevel: text("risk_level").notNull().default("medium"),
  isActive: boolean("is_active").notNull().default(false),
  takeProfit: real("take_profit").default(2.0),
  stopLoss: real("stop_loss").default(1.0),
  maxPositionSize: real("max_position_size").default(10.0),
  winRate: real("win_rate").default(0),
  totalTrades: integer("total_trades").default(0),
  profitLoss: real("profit_loss").default(0),
});

export const signals = pgTable("signals", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  strategyId: varchar("strategy_id"),
  userId: varchar("user_id").notNull(),
  pair: text("pair").notNull(),
  type: text("type").notNull(),
  entry: real("entry").notNull(),
  target: real("target"),
  stopLoss: real("stop_loss"),
  confidence: real("confidence").notNull().default(0.5),
  status: text("status").notNull().default("active"),
  aiAnalysis: text("ai_analysis"),
  createdAt: timestamp("created_at").defaultNow(),
});

export const botSettings = pgTable("bot_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull().unique(),
  exchangeName: text("exchange_name").default("binance"),
  apiKey: text("api_key").default(""),
  apiSecret: text("api_secret").default(""),
  isLive: boolean("is_live").notNull().default(false),
  maxDailyTrades: integer("max_daily_trades").default(10),
  maxRiskPerTrade: real("max_risk_per_trade").default(2.0),
  dailyLossLimit: real("daily_loss_limit").default(5.0),
  notificationsEnabled: boolean("notifications_enabled").default(true),
  emailAlerts: boolean("email_alerts").default(true),
  autoTrade: boolean("auto_trade").default(false),
  trailingStop: boolean("trailing_stop").default(false),
  defaultLeverage: integer("default_leverage").default(1),
});

export const tradeHistory = pgTable("trade_history", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  userId: varchar("user_id").notNull(),
  strategyId: varchar("strategy_id"),
  pair: text("pair").notNull(),
  type: text("type").notNull(),
  entryPrice: real("entry_price").notNull(),
  exitPrice: real("exit_price"),
  quantity: real("quantity").notNull(),
  profitLoss: real("profit_loss"),
  status: text("status").notNull().default("open"),
  openedAt: timestamp("opened_at").defaultNow(),
  closedAt: timestamp("closed_at"),
});

export const insertUserSchema = createInsertSchema(users).pick({
  email: true,
  password: true,
  name: true,
});

export const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(6, "Password must be at least 6 characters"),
  name: z.string().min(2, "Name must be at least 2 characters"),
});

export const resetPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

export const newPasswordSchema = z.object({
  token: z.string(),
  password: z.string().min(6, "Password must be at least 6 characters"),
});

export const insertStrategySchema = createInsertSchema(strategies).pick({
  name: true,
  description: true,
  type: true,
  pairs: true,
  indicators: true,
  timeframe: true,
  riskLevel: true,
  takeProfit: true,
  stopLoss: true,
  maxPositionSize: true,
});

export const insertSignalSchema = createInsertSchema(signals).pick({
  pair: true,
  type: true,
  entry: true,
  target: true,
  stopLoss: true,
  confidence: true,
  aiAnalysis: true,
  strategyId: true,
});

export const insertBotSettingsSchema = createInsertSchema(botSettings).pick({
  exchangeName: true,
  apiKey: true,
  apiSecret: true,
  isLive: true,
  maxDailyTrades: true,
  maxRiskPerTrade: true,
  dailyLossLimit: true,
  notificationsEnabled: true,
  emailAlerts: true,
  autoTrade: true,
  trailingStop: true,
  defaultLeverage: true,
});

export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;
export type Strategy = typeof strategies.$inferSelect;
export type InsertStrategy = z.infer<typeof insertStrategySchema>;
export type Signal = typeof signals.$inferSelect;
export type InsertSignal = z.infer<typeof insertSignalSchema>;
export type BotSettings = typeof botSettings.$inferSelect;
export type InsertBotSettings = z.infer<typeof insertBotSettingsSchema>;
export type TradeHistory = typeof tradeHistory.$inferSelect;
