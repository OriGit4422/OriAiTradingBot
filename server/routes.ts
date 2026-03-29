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
import { getCoinglassData } from "./coinglass";
import { getNewsSentiment } from "./perplexity";
import { getWhaleActivity } from "./arkham";
import { runMultiAgentValidation } from "./signal-validator";
import { getGoldCandles, getGoldSpotPrice } from "./gold-data";
import { analyzeGold } from "./gold-analysis";
import { getMT5AccountInfo, placeMT5Order, getMT5OpenPositions } from "./mt5";
import { testExchangeConnection, getBinanceBalance, getBybitBalance, getMexcBalance, autoTradeSignal, type ExchangeName } from "./exchanges";
import { getCoinNews, getMarketNews, aggregateSentiment } from "./news";

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
      const signalData = req.body;
      // Enrich with news context if NewsAPI key is available
      let enrichedData = { ...signalData };
      try {
        const s = await storage.getSettings();
        const newsApiKey = (s as any)?.newsApiKey || process.env.NEWS_API_KEY || 'd66b436737204e49a72f1cafb522d483';
        if (newsApiKey) {
          const { articles, sentiment } = await getCoinNews(signalData.coin, newsApiKey, 5)
            .then(arts => ({ articles: arts, sentiment: aggregateSentiment(arts) }));
          if (articles.length) {
            enrichedData.agentContext = {
              ...enrichedData.agentContext,
              newsImpact: sentiment.overall,
              newsTopHeadlines: articles.slice(0, 3).map((a: any) => a.title),
            };
          }
        }
      } catch (_e) { /* non-fatal: news enrichment is best-effort */ }

      const result = await analyzeSignalWithAI(enrichedData);
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

  // ─── Gold + MT5 ─────────────────────────────────────────────
  app.get("/api/gold/price", async (_req, res) => {
    try {
      // Use gold-data.ts which returns the full GoldSpot shape the frontend expects
      const spot = await getGoldSpotPrice();
      if (!spot || !spot.price) {
        // Fallback to legacy getLiveGoldPrice if getGoldSpotPrice fails
        const legacy = await getLiveGoldPrice();
        return res.status(legacy.price ? 200 : 503).json(legacy);
      }
      res.json(spot);
    } catch (e: any) {
      // Final fallback
      const legacy = await getLiveGoldPrice().catch(() => ({ price: 0, symbol: 'XAUUSD', source: 'Unavailable', timestamp: new Date().toISOString() }));
      res.status(legacy.price ? 200 : 503).json(legacy);
    }
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

  // ─── AI Intelligence Endpoints ────────────────────────────────────────────

  // GET /api/intelligence/status — which agents are configured
  app.get("/api/intelligence/status", async (_req, res) => {
    try {
      const s = await storage.getSettings();
      res.json({
        agents: {
          claude:     { name: "Claude AI",    active: true,              role: "Primary signal analysis & cross-validation" },
          coinglass:  { name: "Coinglass",    active: !!s?.coinglassApiKey,  role: "Derivatives: funding rates, long/short ratios" },
          perplexity: { name: "Perplexity",   active: !!s?.perplexityApiKey, role: "Real-time news sentiment filter" },
          arkham:     { name: "Arkham",       active: !!s?.arkhamApiKey,     role: "Whale & smart money on-chain tracking" },
        },
        totalActive: 1 + [s?.coinglassApiKey, s?.perplexityApiKey, s?.arkhamApiKey].filter(Boolean).length,
      });
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/intelligence/coinglass/:coin
  app.get("/api/intelligence/coinglass/:coin", async (req, res) => {
    try {
      const data = await getCoinglassData(req.params.coin.toUpperCase());
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/intelligence/news/:coin
  app.get("/api/intelligence/news/:coin", async (req, res) => {
    try {
      const data = await getNewsSentiment(req.params.coin.toUpperCase());
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/intelligence/whale/:coin
  app.get("/api/intelligence/whale/:coin", async (req, res) => {
    try {
      const data = await getWhaleActivity(req.params.coin.toUpperCase());
      res.json(data);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // POST /api/intelligence/validate — full multi-agent signal validation
  app.post("/api/intelligence/validate", async (req, res) => {
    try {
      const result = await runMultiAgentValidation(req.body);
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── Gold Extended Routes ─────────────────────────────────────────────────

  // GET /api/gold/candles/:interval  (1m | 5m | 15m | 30m | 1h | 4h | 1d)
  app.get("/api/gold/candles/:interval", async (req, res) => {
    try {
      const interval = req.params.interval || '1h';
      const limit = parseInt(req.query.limit as string) || 200;
      const candles = await getGoldCandles(interval, limit);
      res.json(candles);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // GET /api/gold/signal/:timeframe
  app.get("/api/gold/signal/:timeframe", async (req, res) => {
    try {
      const signal = await analyzeGold(req.params.timeframe || '1h');
      res.json(signal);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // POST /api/gold/trade  — place auto trade via MT5
  app.post("/api/gold/trade", async (req, res) => {
    try {
      const s = await storage.getSettings();
      if (!s?.metaApiToken || !s?.metaApiAccountId) {
        return res.status(400).json({ message: "MT5 not connected. Add MetaApi token and account ID in Settings." });
      }
      if (!s.goldAutoTradingEnabled) {
        return res.status(400).json({ message: "Auto trading is disabled. Enable it in Settings → MT5." });
      }
      const { type, entry, tp, sl, confidence, lotSize } = req.body;
      if (!type || !entry || !tp || !sl) {
        return res.status(400).json({ message: "Missing required trade fields (type, entry, tp, sl)" });
      }
      if (confidence < (s.goldMinConfidence ?? 75)) {
        return res.status(400).json({ message: `Signal confidence ${confidence}% below minimum ${s.goldMinConfidence}%` });
      }
      const result = await placeMT5Order(s.metaApiToken, s.metaApiAccountId, {
        symbol: 'XAUUSD',
        type: type === 'BUY' ? 'ORDER_TYPE_BUY' : 'ORDER_TYPE_SELL',
        volume: lotSize ?? s.goldLotSize ?? 0.01,
        stopLoss: sl,
        takeProfit: tp,
      });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── MT5 Account ──────────────────────────────────────────────────────────

  // GET /api/mt5/account
  app.get("/api/mt5/account", async (_req, res) => {
    try {
      const s = await storage.getSettings();
      if (!s?.metaApiToken || !s?.metaApiAccountId) {
        return res.json({ connected: false, message: "MT5 credentials not configured" });
      }
      const info = await getMT5AccountInfo(s.metaApiToken, s.metaApiAccountId);
      res.json(info);
    } catch (e: any) {
      res.status(500).json({ message: e.message, connected: false });
    }
  });

  // GET /api/mt5/positions
  app.get("/api/mt5/positions", async (_req, res) => {
    try {
      const s = await storage.getSettings();
      if (!s?.metaApiToken || !s?.metaApiAccountId) {
        return res.json([]);
      }
      const positions = await getMT5OpenPositions(s.metaApiToken, s.metaApiAccountId);
      res.json(positions);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  // ─── Exchange Auto-Trading ────────────────────────────────────────────────

  // POST /api/exchange/:exchange/test  — verify credentials
  app.post("/api/exchange/:exchange/test", async (req, res) => {
    try {
      const exchange = req.params.exchange as ExchangeName;
      if (!["binance", "bybit", "mexc"].includes(exchange)) {
        return res.status(400).json({ ok: false, message: "Unknown exchange" });
      }
      const { apiKey, apiSecret } = req.body;
      if (!apiKey || !apiSecret) return res.status(400).json({ ok: false, message: "apiKey and apiSecret required" });
      const result = await testExchangeConnection(exchange, apiKey, apiSecret);
      // Persist connected status to settings
      if (result.ok) {
        const patch: Record<string, any> = {};
        patch[`${exchange}Connected`] = true;
        await storage.upsertSettings(patch as any);
      }
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  // GET /api/exchange/:exchange/balance
  app.get("/api/exchange/:exchange/balance", async (req, res) => {
    try {
      const exchange = req.params.exchange as ExchangeName;
      const s = await storage.getSettings();
      if (!s) return res.status(400).json({ ok: false, message: "Settings not found" });
      const keyMap: Record<string, [string | null | undefined, string | null | undefined]> = {
        binance: [s.binanceApiKey, s.binanceApiSecret],
        bybit:   [s.bybitApiKey,   s.bybitApiSecret],
        mexc:    [s.mexcApiKey,    s.mexcApiSecret],
      };
      const [apiKey, apiSecret] = keyMap[exchange] ?? [];
      if (!apiKey || !apiSecret) return res.json({ ok: false, exchange, message: "API keys not configured", totalWalletBalance: 0, availableBalance: 0, unrealizedPnl: 0, currency: "USDT" });
      let bal;
      if (exchange === "binance") bal = await getBinanceBalance(apiKey, apiSecret);
      else if (exchange === "bybit") bal = await getBybitBalance(apiKey, apiSecret);
      else bal = await getMexcBalance(apiKey, apiSecret);
      res.json(bal);
    } catch (e: any) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  // POST /api/exchange/:exchange/trade  — manual / auto-triggered trade
  app.post("/api/exchange/:exchange/trade", async (req, res) => {
    try {
      const exchange = req.params.exchange as ExchangeName;
      const s = await storage.getSettings();
      if (!s) return res.status(400).json({ ok: false, message: "Settings not found" });
      const keyMap: Record<string, [string | null | undefined, string | null | undefined]> = {
        binance: [s.binanceApiKey, s.binanceApiSecret],
        bybit:   [s.bybitApiKey,   s.bybitApiSecret],
        mexc:    [s.mexcApiKey,    s.mexcApiSecret],
      };
      const [apiKey, apiSecret] = keyMap[exchange] ?? [];
      if (!apiKey || !apiSecret) return res.status(400).json({ ok: false, message: `${exchange} API keys not configured in Settings` });

      const cfgMap: Record<string, { lev: number; margin: string; maxUsdt: number; auto: boolean; minConf: number }> = {
        binance: { lev: s.binanceLeverage ?? 10, margin: s.binanceMarginType ?? "ISOLATED", maxUsdt: s.binanceMaxPositionUsdt ?? 100, auto: s.binanceAutoTrading ?? false, minConf: 70 },
        bybit:   { lev: s.bybitLeverage ?? 10,   margin: s.bybitMarginType ?? "ISOLATED",   maxUsdt: s.bybitMaxPositionUsdt ?? 100,   auto: s.bybitAutoTrading ?? false,   minConf: 70 },
        mexc:    { lev: s.mexcLeverage ?? 10,    margin: s.mexcMarginType ?? "ISOLATED",    maxUsdt: s.mexcMaxPositionUsdt ?? 100,    auto: s.mexcAutoTrading ?? false,    minConf: 70 },
      };
      const cfg = cfgMap[exchange];

      const result = await autoTradeSignal(exchange, apiKey, apiSecret, req.body, {
        leverage: cfg.lev,
        marginType: cfg.margin as "ISOLATED" | "CROSSED",
        maxPositionUsdt: cfg.maxUsdt,
        minConfidence: cfg.minConf,
      });
      res.json(result);
    } catch (e: any) {
      res.status(500).json({ ok: false, message: e.message });
    }
  });

  // ── NEWS ROUTES ──────────────────────────────────────────────────────────────

  // GET /api/news/market — general crypto market news + aggregate sentiment
  app.get("/api/news/market", async (req, res) => {
    try {
      const s = await storage.getSettings();
      const apiKey = (s as any)?.newsApiKey || process.env.NEWS_API_KEY || 'd66b436737204e49a72f1cafb522d483';
      const articles = await getMarketNews(apiKey, 10);
      const sentiment = aggregateSentiment(articles);
      res.json({ articles, sentiment });
    } catch (e: any) {
      res.status(500).json({ message: e.message, articles: [], sentiment: null });
    }
  });

  // GET /api/news/:coin — coin-specific news (BTC, ETH, XAUUSD, etc.)
  app.get("/api/news/:coin", async (req, res) => {
    try {
      const s = await storage.getSettings();
      const apiKey = (s as any)?.newsApiKey || process.env.NEWS_API_KEY || 'd66b436737204e49a72f1cafb522d483';
      const limit = parseInt(req.query.limit as string) || 5;
      const articles = await getCoinNews(req.params.coin, apiKey, limit);
      const sentiment = aggregateSentiment(articles);
      res.json({ articles, sentiment });
    } catch (e: any) {
      res.status(500).json({ message: e.message, articles: [], sentiment: null });
    }
  });

  return httpServer;
}
