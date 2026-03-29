import type { Express } from "express";
import { createServer, type Server } from "http";
import { readFileSync } from "fs";
import { storage } from "./storage";
import { insertSettingsSchema, insertStrategySchema, insertSignalSchema, insertPositionSchema, insertUserAccessSchema } from "@shared/schema";
import { z } from "zod";
import { analyzeSignalWithAI, getMarketInsight } from "./ai-analysis";
import { notifySignal, sendTestNotifications, validateSignalBestPractice } from "./notifications";
import { testBinanceConnectivity, testBybitConnectivity } from "./exchange-connectivity";
import { evaluateSignalsPerformance } from "./signal-performance";
import { connectMt5, disconnectMt5, generateGoldSignal, getGoldTradingStatus, getLiveGoldPrice, runGoldAutoTradeOnce, setGoldAutoTrading } from "./gold-trading";
import { getLatestCryptoNews } from "./news";

function getAppVersionInfo() {
  let version = "unknown";
  try {
    const pkgRaw = readFileSync(new URL("../package.json", import.meta.url), "utf-8");
    const pkg = JSON.parse(pkgRaw);
    version = pkg.version || "unknown";
  } catch (_e) {}

  return {
    appVersion: version,
    buildTime: process.env.BUILD_TIME || new Date().toISOString(),
    gitBranch: process.env.GIT_BRANCH || "unknown",
    gitCommit: process.env.GIT_COMMIT || "unknown",
  };
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  // ─── Auth ─────────────────────────────────────────────────
  app.post("/api/auth/login", (req, res) => {
    const { username, password } = req.body;
    const validUser = process.env.AUTH_USERNAME || "patyqm2010@gmail.com";
    const validPass = process.env.AUTH_PASSWORD || "Ori@4422";
    if (username === validUser && password === validPass) {
      res.json({ success: true, user: { username: validUser, role: "admin" } });
    } else {
      res.status(401).json({ success: false, message: "Invalid credentials" });
    }
  });

  // ─── AI Analysis ──────────────────────────────────────────
  app.post("/api/ai/analyze-signal", async (req, res) => {
    try {
      const result = await analyzeSignalWithAI(req.body);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/ai/market-insight", async (req, res) => {
    try {
      const { coins, marketData } = req.body;
      const result = await getMarketInsight(coins || ["BTC", "ETH", "SOL", "BNB", "XRP"], marketData);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── Settings ───────────────────────────────────────────────
  app.get("/api/settings", async (_req, res) => {
    try {
      let s = await storage.getSettings();
      if (!s) {
        s = await storage.upsertSettings({});
      }
      res.json(s);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/settings", async (req, res) => {
    try {
      const patch = { ...req.body };

      if (typeof patch.binanceApiKey === "string") {
        const test = await testBinanceConnectivity(patch.binanceApiKey);
        patch.binanceConnected = test.ok;
      }

      if (typeof patch.bybitApiKey === "string") {
        const test = await testBybitConnectivity(patch.bybitApiKey);
        patch.bybitConnected = test.ok;
      }

      const updated = await storage.upsertSettings(patch);
      res.json(updated);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/exchange/binance/test", async (req, res) => {
    const result = await testBinanceConnectivity(req.body?.apiKey);
    res.status(result.ok ? 200 : 503).json(result);
  });

  app.post("/api/exchange/bybit/test", async (req, res) => {
    const result = await testBybitConnectivity(req.body?.apiKey);
    res.status(result.ok ? 200 : 503).json(result);
  });

  app.post("/api/notifications/test", async (_req, res) => {
    try {
      const result = await sendTestNotifications();
      res.status(result.ok ? 200 : 503).json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/news/latest", async (req, res) => {
    try {
      const limitRaw = Number(req.query?.limit ?? 10);
      const news = await getLatestCryptoNews(Number.isFinite(limitRaw) ? limitRaw : 10);
      res.json({ items: news });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── Gold + MT5 ─────────────────────────────────────────────
  app.get("/api/gold/price", async (_req, res) => {
    const result = await getLiveGoldPrice();
    res.status(result.price ? 200 : 503).json(result);
  });

  app.get("/api/gold/status", (_req, res) => {
    res.json(getGoldTradingStatus());
  });

  app.post("/api/gold/signal", async (req, res) => {
    try {
      const signal = await generateGoldSignal(req.body?.timeframe || "15m");
      res.json(signal);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/gold/mt5/connect", (req, res) => {
    const result = connectMt5(req.body || {});
    res.status(result.ok ? 200 : 400).json(result);
  });

  app.post("/api/gold/mt5/disconnect", (_req, res) => {
    const result = disconnectMt5();
    res.json(result);
  });

  app.patch("/api/gold/auto-trading", (req, res) => {
    const result = setGoldAutoTrading(req.body || { enabled: false });
    res.json(result);
  });

  app.post("/api/gold/auto-trade/run", async (_req, res) => {
    const result = await runGoldAutoTradeOnce();
    res.status(result.ok ? 200 : 400).json(result);
  });

  app.get("/api/system/requirements-status", async (_req, res) => {
    try {
      const s = await storage.getSettings();
      const hasTelegramConfig = !!(s?.telegramEnabled && s?.telegramBotToken && s?.telegramChatId);
      const hasDiscordConfig = !!(s?.discordEnabled && s?.discordWebhookUrl);
      res.json({
        status: "ok",
        features: {
          aiSignalConfirmation: true,
          signalBestPracticeValidation: true,
          exchangeConnectivityChecks: true,
          signalPerformance24h: true,
          notifications: {
            telegramReady: hasTelegramConfig,
            discordReady: hasDiscordConfig,
            notifyOnSignal: !!s?.notifyOnSignal,
            highConfidenceOnly: !!s?.notifyOnHighConfidence,
            minNotifyConfidence: s?.minNotifyConfidence ?? 80,
          },
          exchanges: {
            binanceConnected: !!s?.binanceConnected,
            bybitConnected: !!s?.bybitConnected,
          },
        },
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/system/version", (_req, res) => {
    res.json({
      status: "ok",
      ...getAppVersionInfo(),
    });
  });

  app.get("/api/system/diagnostics", async (_req, res) => {
    try {
      const s = await storage.getSettings();
      const [binance, bybit] = await Promise.all([
        testBinanceConnectivity(s?.binanceApiKey || undefined),
        testBybitConnectivity(s?.bybitApiKey || undefined),
      ]);

      const notificationCheck = await sendTestNotifications();
      const strategyCount = (await storage.getStrategies()).length;

      res.json({
        status: "ok",
        diagnostics: {
          exchanges: { binance, bybit },
          notifications: notificationCheck,
          strategies: { count: strategyCount, seededFallback: strategyCount > 0 },
          endpoints: {
            aiAnalyzeSignal: "/api/ai/analyze-signal",
            signalPerformance: "/api/signals/performance?hours=24",
            requirements: "/api/system/requirements-status",
          },
        },
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── Strategies ─────────────────────────────────────────────
  app.get("/api/strategies", async (_req, res) => {
    try {
      const strats = await storage.getStrategies();
      res.json(strats);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/strategies", async (req, res) => {
    try {
      const data = insertStrategySchema.parse(req.body);
      const s = await storage.createStrategy(data);
      res.status(201).json(s);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/strategies/:id", async (req, res) => {
    try {
      const s = await storage.updateStrategy(req.params.id, req.body);
      if (!s) return res.status(404).json({ message: "Strategy not found" });
      res.json(s);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/strategies/:id", async (req, res) => {
    try {
      await storage.deleteStrategy(req.params.id);
      res.status(204).send();
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── Signals ────────────────────────────────────────────────
  app.get("/api/signals", async (_req, res) => {
    try {
      const sigs = await storage.getSignals();
      res.json(sigs);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/signals/performance", async (req, res) => {
    try {
      const hours = Math.max(1, Math.min(240, Number(req.query.hours || 24)));
      const allSignals = await storage.getSignals();
      const performance = await evaluateSignalsPerformance(allSignals, hours);
      res.json({
        hoursWindow: hours,
        total: performance.length,
        summary: {
          tpHit: performance.filter((p) => p.outcome === "TP_HIT").length,
          slHit: performance.filter((p) => p.outcome === "SL_HIT").length,
          running: performance.filter((p) => p.outcome === "RUNNING").length,
          noData: performance.filter((p) => p.outcome === "NO_DATA").length,
        },
        items: performance,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/signals", async (req, res) => {
    try {
      const data = insertSignalSchema.parse(req.body);
      const quality = validateSignalBestPractice(data);
      if (!quality.isValid) {
        return res.status(422).json({
          message: "Signal failed best-practice checks",
          issues: quality.issues,
          riskReward: Number(quality.riskReward.toFixed(2)),
        });
      }
      const s = await storage.createSignal(data);
      await notifySignal(s);
      res.status(201).json(s);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/signals/bulk", async (req, res) => {
    try {
      const signalsData = z.array(insertSignalSchema).parse(req.body);
      const results = [];
      const rejected: Array<{ coin: string; timeframe: string; issues: string[]; riskReward: number }> = [];
      for (const s of signalsData) {
        const quality = validateSignalBestPractice(s);
        if (!quality.isValid) {
          rejected.push({
            coin: s.coin,
            timeframe: s.timeframe,
            issues: quality.issues,
            riskReward: Number(quality.riskReward.toFixed(2)),
          });
          continue;
        }

        const created = await storage.createSignal(s);
        results.push(created);
        await notifySignal(created);
      }
      res.status(201).json({ created: results, rejected, summary: { created: results.length, rejected: rejected.length } });
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/signals/:id/status", async (req, res) => {
    try {
      const { status } = req.body;
      const s = await storage.updateSignalStatus(req.params.id, status);
      if (!s) return res.status(404).json({ message: "Signal not found" });
      res.json(s);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/signals", async (_req, res) => {
    try {
      await storage.clearSignals();
      res.status(204).send();
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── Positions ──────────────────────────────────────────────
  app.get("/api/positions", async (_req, res) => {
    try {
      const pos = await storage.getOpenPositions();
      res.json(pos);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.get("/api/positions/all", async (_req, res) => {
    try {
      const pos = await storage.getPositions();
      res.json(pos);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/positions", async (req, res) => {
    try {
      const data = insertPositionSchema.parse(req.body);
      const p = await storage.createPosition(data);
      res.status(201).json(p);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  // ─── Wallet ────────────────────────────────────────────────
  app.get("/api/wallet", async (_req, res) => {
    try {
      const w = await storage.getWallet();
      res.json(w);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/wallet/deposit", async (req, res) => {
    try {
      const { amount } = req.body;
      const w = await storage.updateWalletBalance(amount);
      res.json(w);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.patch("/api/positions/:id/close", async (req, res) => {
    try {
      const { pnl } = req.body;
      const p = await storage.closePosition(req.params.id, pnl);
      if (!p) return res.status(404).json({ message: "Position not found" });
      
      if (pnl !== undefined) {
        await storage.updateWalletBalance(pnl);
      }
      
      res.json(p);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── User Access Management ──────────────────────────────
  app.get("/api/user-access", async (_req, res) => {
    try {
      const list = await storage.getUserAccessList();
      res.json(list);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.post("/api/user-access", async (req, res) => {
    try {
      const data = insertUserAccessSchema.parse(req.body);
      const u = await storage.createUserAccess(data);
      res.status(201).json(u);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.patch("/api/user-access/:id", async (req, res) => {
    try {
      const u = await storage.updateUserAccess(req.params.id, req.body);
      if (!u) return res.status(404).json({ message: "User not found" });
      res.json(u);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  app.delete("/api/user-access/:id", async (req, res) => {
    try {
      await storage.deleteUserAccess(req.params.id);
      res.status(204).send();
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  return httpServer;
}
