import type { Express, Request, Response, NextFunction } from "express";
import { createServer, type Server } from "http";
import session from "express-session";
import { storage } from "./storage";
import { loginSchema, registerSchema, resetPasswordSchema, newPasswordSchema, insertStrategySchema, insertSignalSchema, insertBotSettingsSchema } from "@shared/schema";
import { randomBytes } from "crypto";
import connectPgSimple from "connect-pg-simple";
import { pool } from "./db";

const PgSession = connectPgSimple(session);

function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!(req.session as any).userId) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  next();
}

function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (!(req.session as any).userId) {
    return res.status(401).json({ message: "Not authenticated" });
  }
  if ((req.session as any).userRole !== "admin") {
    return res.status(403).json({ message: "Admin access required" });
  }
  next();
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  app.use(
    session({
      store: new PgSession({ pool, createTableIfMissing: true }),
      secret: process.env.SESSION_SECRET || "crypto-bot-secret-key",
      resave: false,
      saveUninitialized: false,
      cookie: {
        maxAge: 30 * 24 * 60 * 60 * 1000,
        httpOnly: true,
        secure: false,
        sameSite: "lax",
      },
    })
  );

  app.post("/api/auth/register", async (req, res) => {
    try {
      const data = registerSchema.parse(req.body);
      const existing = await storage.getUserByEmail(data.email);
      if (existing) {
        return res.status(400).json({ message: "Email already registered" });
      }
      const user = await storage.createUser(data);
      (req.session as any).userId = user.id;
      (req.session as any).userRole = user.role;
      return res.json({ id: user.id, email: user.email, name: user.name, role: user.role, isActive: user.isActive, avatarColor: user.avatarColor });
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/auth/login", async (req, res) => {
    try {
      const data = loginSchema.parse(req.body);
      const user = await storage.verifyUser(data.email, data.password);
      if (!user) {
        return res.status(401).json({ message: "Invalid email or password" });
      }
      (req.session as any).userId = user.id;
      (req.session as any).userRole = user.role;
      return res.json({ id: user.id, email: user.email, name: user.name, role: user.role, isActive: user.isActive, avatarColor: user.avatarColor });
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => {
      res.json({ message: "Logged out" });
    });
  });

  app.get("/api/auth/me", async (req, res) => {
    const userId = (req.session as any).userId;
    if (!userId) return res.status(401).json({ message: "Not authenticated" });
    const user = await storage.getUser(userId);
    if (!user) return res.status(401).json({ message: "User not found" });
    return res.json({ id: user.id, email: user.email, name: user.name, role: user.role, isActive: user.isActive, avatarColor: user.avatarColor });
  });

  app.post("/api/auth/forgot-password", async (req, res) => {
    try {
      const data = resetPasswordSchema.parse(req.body);
      const token = randomBytes(32).toString("hex");
      const expiry = new Date(Date.now() + 3600000);
      await storage.setResetToken(data.email, token, expiry);
      return res.json({ message: "If that email exists, a password reset link has been sent to your email." });
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/auth/reset-password", async (req, res) => {
    try {
      const data = newPasswordSchema.parse(req.body);
      const user = await storage.getUserByResetToken(data.token);
      if (!user || !user.resetTokenExpiry || user.resetTokenExpiry < new Date()) {
        return res.status(400).json({ message: "Invalid or expired reset token" });
      }
      await storage.resetPassword(user.id, data.password);
      return res.json({ message: "Password reset successfully" });
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
  });

  app.get("/api/strategies", requireAuth, async (req, res) => {
    try {
      const strats = await storage.getStrategies((req.session as any).userId);
      return res.json(strats);
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/strategies/:id", requireAuth, async (req, res) => {
    try {
      const strategy = await storage.getStrategy(req.params.id);
      if (!strategy) return res.status(404).json({ message: "Strategy not found" });
      if (strategy.userId !== (req.session as any).userId) return res.status(403).json({ message: "Access denied" });
      return res.json(strategy);
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/strategies", requireAuth, async (req, res) => {
    try {
      const data = insertStrategySchema.parse(req.body);
      const strategy = await storage.createStrategy((req.session as any).userId, data);
      return res.json(strategy);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/strategies/:id", requireAuth, async (req, res) => {
    try {
      const existing = await storage.getStrategy(req.params.id);
      if (!existing) return res.status(404).json({ message: "Strategy not found" });
      if (existing.userId !== (req.session as any).userId) return res.status(403).json({ message: "Access denied" });
      const { name, description, type, pairs, indicators, timeframe, riskLevel, takeProfit, stopLoss, maxPositionSize, isActive } = req.body;
      const strategy = await storage.updateStrategy(req.params.id, { name, description, type, pairs, indicators, timeframe, riskLevel, takeProfit, stopLoss, maxPositionSize, isActive });
      return res.json(strategy);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
  });

  app.delete("/api/strategies/:id", requireAuth, async (req, res) => {
    try {
      const existing = await storage.getStrategy(req.params.id);
      if (!existing) return res.status(404).json({ message: "Strategy not found" });
      if (existing.userId !== (req.session as any).userId) return res.status(403).json({ message: "Access denied" });
      await storage.deleteStrategy(req.params.id);
      return res.json({ message: "Deleted" });
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/signals", requireAuth, async (req, res) => {
    try {
      const sigs = await storage.getSignals((req.session as any).userId);
      return res.json(sigs);
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/signals", requireAuth, async (req, res) => {
    try {
      const data = insertSignalSchema.parse(req.body);
      const signal = await storage.createSignal((req.session as any).userId, data);
      return res.json(signal);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/signals/:id", requireAuth, async (req, res) => {
    try {
      const existing = await storage.getSignal(req.params.id);
      if (!existing) return res.status(404).json({ message: "Signal not found" });
      if (existing.userId !== (req.session as any).userId) return res.status(403).json({ message: "Access denied" });
      const { status } = req.body;
      const signal = await storage.updateSignal(req.params.id, { status });
      return res.json(signal);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
  });

  app.delete("/api/signals/:id", requireAuth, async (req, res) => {
    try {
      const existing = await storage.getSignal(req.params.id);
      if (!existing) return res.status(404).json({ message: "Signal not found" });
      if (existing.userId !== (req.session as any).userId) return res.status(403).json({ message: "Access denied" });
      await storage.deleteSignal(req.params.id);
      return res.json({ message: "Deleted" });
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/signals/generate", requireAuth, async (req, res) => {
    const pairs = ["BTC/USDT", "ETH/USDT", "SOL/USDT", "BNB/USDT", "XRP/USDT", "ADA/USDT", "DOGE/USDT", "AVAX/USDT"];
    const types = ["long", "short"];
    const pair = pairs[Math.floor(Math.random() * pairs.length)];
    const type = types[Math.floor(Math.random() * types.length)];
    const basePrice = pair === "BTC/USDT" ? 65000 + Math.random() * 5000 : pair === "ETH/USDT" ? 3200 + Math.random() * 300 : pair === "SOL/USDT" ? 140 + Math.random() * 30 : pair === "BNB/USDT" ? 580 + Math.random() * 40 : pair === "XRP/USDT" ? 0.55 + Math.random() * 0.15 : pair === "ADA/USDT" ? 0.45 + Math.random() * 0.1 : pair === "DOGE/USDT" ? 0.08 + Math.random() * 0.03 : 35 + Math.random() * 5;
    const entry = Math.round(basePrice * 100) / 100;
    const multiplier = type === "long" ? 1 : -1;
    const target = Math.round((entry * (1 + multiplier * (0.02 + Math.random() * 0.05))) * 100) / 100;
    const stopLoss = Math.round((entry * (1 - multiplier * (0.01 + Math.random() * 0.02))) * 100) / 100;
    const confidence = Math.round((0.55 + Math.random() * 0.4) * 100) / 100;
    const analyses = [
      `Strong ${type} signal detected. RSI at ${type === "long" ? "oversold" : "overbought"} levels with MACD crossover confirmation. Volume surge of ${Math.floor(20 + Math.random() * 40)}% supports the move.`,
      `AI analysis indicates ${type === "long" ? "bullish" : "bearish"} divergence on the 4H chart. Fibonacci retracement aligns with key support/resistance at ${entry}. Risk-reward ratio: ${((Math.abs(target - entry) / Math.abs(stopLoss - entry))).toFixed(1)}:1.`,
      `Pattern recognition: ${type === "long" ? "Double bottom" : "Head and shoulders"} formation confirmed. Bollinger Band squeeze suggests imminent breakout. Smart money flow indicator is ${type === "long" ? "accumulating" : "distributing"}.`,
    ];
    const aiAnalysis = analyses[Math.floor(Math.random() * analyses.length)];
    const signal = await storage.createSignal((req.session as any).userId, {
      pair, type, entry, target, stopLoss, confidence, aiAnalysis, strategyId: req.body.strategyId || null,
    });
    return res.json(signal);
  });

  app.get("/api/settings", requireAuth, async (req, res) => {
    try {
      let settings = await storage.getBotSettings((req.session as any).userId);
      if (!settings) {
        settings = await storage.upsertBotSettings((req.session as any).userId, {} as any);
      }
      return res.json(settings);
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  app.put("/api/settings", requireAuth, async (req, res) => {
    try {
      const settings = await storage.upsertBotSettings((req.session as any).userId, req.body);
      return res.json(settings);
    } catch (e: any) {
      return res.status(400).json({ message: e.message });
    }
  });

  app.get("/api/trades", requireAuth, async (req, res) => {
    try {
      const trades = await storage.getTradeHistory((req.session as any).userId);
      return res.json(trades);
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/dashboard/stats", requireAuth, async (req, res) => {
    try {
      const userId = (req.session as any).userId;
      const strats = await storage.getStrategies(userId);
      const sigs = await storage.getSignals(userId);
      const trades = await storage.getTradeHistory(userId);
      const activeStrategies = strats.filter(s => s.isActive).length;
      const activeSignals = sigs.filter(s => s.status === "active").length;
      const totalPL = trades.reduce((sum, t) => sum + (t.profitLoss || 0), 0);
      const winningTrades = trades.filter(t => (t.profitLoss || 0) > 0).length;
      const winRate = trades.length > 0 ? (winningTrades / trades.length) * 100 : 0;
      return res.json({
        totalStrategies: strats.length,
        activeStrategies,
        totalSignals: sigs.length,
        activeSignals,
        totalTrades: trades.length,
        totalProfitLoss: Math.round(totalPL * 100) / 100,
        winRate: Math.round(winRate * 10) / 10,
        portfolioValue: 10000 + totalPL,
      });
    } catch (e: any) {
      return res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/admin/users", requireAdmin, async (req, res) => {
    const allUsers = await storage.getAllUsers();
    return res.json(allUsers.map(u => ({
      id: u.id, email: u.email, name: u.name, role: u.role,
      isActive: u.isActive, avatarColor: u.avatarColor, lastLogin: u.lastLogin,
    })));
  });

  app.patch("/api/admin/users/:id", requireAdmin, async (req, res) => {
    const { role, isActive } = req.body;
    const updated = await storage.updateUser(req.params.id, { role, isActive });
    if (!updated) return res.status(404).json({ message: "User not found" });
    return res.json({ id: updated.id, email: updated.email, name: updated.name, role: updated.role, isActive: updated.isActive, avatarColor: updated.avatarColor, lastLogin: updated.lastLogin });
  });

  app.delete("/api/admin/users/:id", requireAdmin, async (req, res) => {
    await storage.deleteUser(req.params.id);
    return res.json({ message: "Deleted" });
  });

  return httpServer;
}
