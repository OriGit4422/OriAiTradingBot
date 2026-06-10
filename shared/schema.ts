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
  // Binance Futures
  binanceApiKey: text("binance_api_key"),
  binanceApiSecret: text("binance_api_secret"),
  binanceConnected: boolean("binance_connected").notNull().default(false),
  binanceAutoTrading: boolean("binance_auto_trading").notNull().default(false),
  binanceLeverage: integer("binance_leverage").notNull().default(10),
  binanceMarginType: text("binance_margin_type").notNull().default("ISOLATED"),
  binanceMaxPositionUsdt: real("binance_max_position_usdt").notNull().default(100),
  // Bybit Futures
  bybitApiKey: text("bybit_api_key"),
  bybitApiSecret: text("bybit_api_secret"),
  bybitConnected: boolean("bybit_connected").notNull().default(false),
  bybitAutoTrading: boolean("bybit_auto_trading").notNull().default(false),
  bybitLeverage: integer("bybit_leverage").notNull().default(10),
  bybitMarginType: text("bybit_margin_type").notNull().default("ISOLATED"),
  bybitMaxPositionUsdt: real("bybit_max_position_usdt").notNull().default(100),
  // MEXC Futures
  mexcApiKey: text("mexc_api_key"),
  mexcApiSecret: text("mexc_api_secret"),
  mexcConnected: boolean("mexc_connected").notNull().default(false),
  mexcAutoTrading: boolean("mexc_auto_trading").notNull().default(false),
  mexcLeverage: integer("mexc_leverage").notNull().default(10),
  mexcMarginType: text("mexc_margin_type").notNull().default("ISOLATED"),
  mexcMaxPositionUsdt: real("mexc_max_position_usdt").notNull().default(100),
  // Custom AI Provider 1 (OpenAI-compatible)
  customAi1Enabled: boolean("custom_ai1_enabled").notNull().default(false),
  customAi1Name: text("custom_ai1_name").default("Custom AI 1"),
  customAi1BaseUrl: text("custom_ai1_base_url"),
  customAi1ApiKey: text("custom_ai1_api_key"),
  customAi1Model: text("custom_ai1_model").default("gpt-4o"),
  // Custom AI Provider 2 (OpenAI-compatible)
  customAi2Enabled: boolean("custom_ai2_enabled").notNull().default(false),
  customAi2Name: text("custom_ai2_name").default("Custom AI 2"),
  customAi2BaseUrl: text("custom_ai2_base_url"),
  customAi2ApiKey: text("custom_ai2_api_key"),
  customAi2Model: text("custom_ai2_model").default("gpt-4o"),
  // OpenAI (direct)
  openaiEnabled: boolean("openai_enabled").notNull().default(false),
  openaiApiKey: text("openai_api_key"),
  openaiModel: text("openai_model").default("gpt-4o"),
  // Anthropic Claude (direct)
  anthropicEnabled: boolean("anthropic_enabled").notNull().default(false),
  anthropicApiKey: text("anthropic_api_key"),
  anthropicModel: text("anthropic_model").default("claude-sonnet-4-5"),
  // Google Gemini
  geminiEnabled: boolean("gemini_enabled").notNull().default(false),
  geminiApiKey: text("gemini_api_key"),
  geminiModel: text("gemini_model").default("gemini-1.5-pro"),
  // AI Agent integrations
  coinglassApiKey: text("coinglass_api_key"),
  perplexityApiKey: text("perplexity_api_key"),
  arkhamApiKey: text("arkham_api_key"),
  newsApiKey: text("news_api_key"),
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

// ===================== AI Auto-Trading Bot (Phase 1) =====================
// NOTE: This bot module is fully isolated from the legacy
// POST /api/exchange/:exchange/trade -> autoTradeSignal() live path, which uses
// a different (unsafe) sizing model. The bot uses the 2%-risk engine only.

// Bot Settings + runtime state (singleton row, like `wallet` / `settings`)
export const botSettings = pgTable("bot_settings", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  // Runtime state ("locked" is computed at read-time, never persisted)
  mode: text("mode").notNull().default("paper"), // paper | testnet | live
  status: text("status").notNull().default("paused"), // active | paused | stopped
  connectedExchange: text("connected_exchange").notNull().default("bybit"), // bybit | binance | both
  lockReason: text("lock_reason"),
  // Live trading gate
  liveUnlocked: boolean("live_unlocked").notNull().default(false),
  riskDisclaimerAccepted: boolean("risk_disclaimer_accepted").notNull().default(false),
  // Execution behaviour
  manualApproval: boolean("manual_approval").notNull().default(true),
  autoExecute: boolean("auto_execute").notNull().default(false),
  // Paper account (separate from the demo `wallet` so deposits/closes can't corrupt it)
  paperBalance: real("paper_balance").notNull().default(100),
  paperStartingBalance: real("paper_starting_balance").notNull().default(100),
  // Risk preset ("$100 Small Account Safe Mode" defaults)
  riskPerTradePercent: real("risk_per_trade_percent").notNull().default(2),
  maxDailyLossPercent: real("max_daily_loss_percent").notNull().default(4),
  maxOpenTrades: integer("max_open_trades").notNull().default(1),
  maxTradesPerDay: integer("max_trades_per_day").notNull().default(2),
  stopAfterLosses: integer("stop_after_losses").notNull().default(2),
  defaultLeverage: integer("default_leverage").notNull().default(3),
  maxLeverage: integer("max_leverage").notNull().default(5),
  hardLeverageCap: integer("hard_leverage_cap").notNull().default(10),
  // Signal gating
  minGrade: text("min_grade").notNull().default("A+"), // A+ | A | B | C
  minConfidence: integer("min_confidence").notNull().default(85),
  minRr: real("min_rr").notNull().default(2),
  allowedSymbols: text("allowed_symbols").array().notNull().default(sql`'{BTCUSDT,ETHUSDT}'::text[]`),
  // No-trade filter toggles
  newsFilter: boolean("news_filter").notNull().default(true),
  macroFilter: boolean("macro_filter").notNull().default(true),
  dataStaleFilter: boolean("data_stale_filter").notNull().default(true),
  liquidityFilter: boolean("liquidity_filter").notNull().default(true),
  spreadFilter: boolean("spread_filter").notNull().default(true),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const insertBotSettingsSchema = createInsertSchema(botSettings).omit({ id: true, updatedAt: true });
export type InsertBotSettings = z.infer<typeof insertBotSettingsSchema>;
export type BotSettings = typeof botSettings.$inferSelect;

// Bot Trades (trade journal — paper trades in Phase 1)
export const botTrades = pgTable("bot_trades", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  signalId: text("signal_id"),
  exchange: text("exchange").notNull().default("bybit"),
  mode: text("mode").notNull().default("paper"), // paper | testnet | live
  symbol: text("symbol").notNull(),
  direction: text("direction").notNull(), // LONG | SHORT
  timeframe: text("timeframe"),
  strategy: text("strategy"),
  entry: real("entry").notNull(),
  stopLoss: real("stop_loss").notNull(),
  tp1: real("tp1"),
  tp2: real("tp2"),
  tp3: real("tp3"),
  positionSize: real("position_size").notNull(),
  leverage: integer("leverage").notNull().default(1),
  marginUsed: real("margin_used").notNull().default(0),
  riskAmount: real("risk_amount").notNull().default(0),
  walletBefore: real("wallet_before").notNull().default(0),
  walletAfter: real("wallet_after"),
  grade: text("grade"),
  confidence: integer("confidence"),
  rr: real("rr"),
  status: text("status").notNull().default("open"), // open | closed | cancelled
  exitPrice: real("exit_price"),
  pnl: real("pnl"),
  exitReason: text("exit_reason"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  closedAt: timestamp("closed_at"),
});

export const insertBotTradeSchema = createInsertSchema(botTrades).omit({
  id: true, createdAt: true, closedAt: true, walletAfter: true, exitPrice: true, pnl: true, exitReason: true,
});
export type InsertBotTrade = z.infer<typeof insertBotTradeSchema>;
export type BotTrade = typeof botTrades.$inferSelect;

// Bot Logs (event audit trail)
export const botLogs = pgTable("bot_logs", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  level: text("level").notNull().default("info"), // info | warn | error | success
  event: text("event").notNull(),
  message: text("message").notNull(),
  meta: jsonb("meta"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const insertBotLogSchema = createInsertSchema(botLogs).omit({ id: true, createdAt: true });
export type InsertBotLog = z.infer<typeof insertBotLogSchema>;
export type BotLog = typeof botLogs.$inferSelect;

// AI Chat (for integration)
export { conversations, messages } from "./models/chat";
export type { Conversation, Message } from "./models/chat";
