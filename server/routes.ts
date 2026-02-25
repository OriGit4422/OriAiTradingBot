import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertSettingsSchema, insertStrategySchema, insertSignalSchema, insertPositionSchema } from "@shared/schema";
import { z } from "zod";
import { analyzeSignalWithAI, getMarketInsight } from "./ai-analysis";

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
      const updated = await storage.upsertSettings(req.body);
      res.json(updated);
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

  app.post("/api/signals", async (req, res) => {
    try {
      const data = insertSignalSchema.parse(req.body);
      const s = await storage.createSignal(data);
      res.status(201).json(s);
    } catch (e: any) {
      res.status(400).json({ message: e.message });
    }
  });

  app.post("/api/signals/bulk", async (req, res) => {
    try {
      const signalsData = z.array(insertSignalSchema).parse(req.body);
      const results = [];
      for (const s of signalsData) {
        results.push(await storage.createSignal(s));
      }
      res.status(201).json(results);
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
      
      // Update wallet balance with PnL
      if (pnl !== undefined) {
        await storage.updateWalletBalance(pnl);
      }
      
      res.json(p);
    } catch (e: any) {
      res.status(500).json({ message: e.message });
    }
  });

  return httpServer;
}
