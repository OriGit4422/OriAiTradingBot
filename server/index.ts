import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { execSync } from "child_process";
import { pool } from "./db";
// Was missing: the scanner auto-start block below calls storage.getBotSettings(),
// so every boot threw ReferenceError into its own catch and the market scanner
// never started, no matter what scannerConfig.enabled was set to.
import { storage } from "./storage";
import { startHourlyAlertScheduler } from "./hourly-alerts";
import { startAutoScanner } from "./auto-scanner";
import { startMarketScanner, configureScanner } from "./agents/market-scanner";
import { startLearningEngine } from "./agents/learning-engine";
import { restoreBudgetLedger, startBudgetPersistence } from "./ai-budget-persistence";

// ─── Last-resort crash guards ────────────────────────────────────────────────
// A single unhandled promise rejection anywhere in the tree used to terminate the
// process under Node's default --unhandled-rejections=throw — a provider 404 in
// ai-providers took the whole bot offline, open positions and all. The specific
// leak is fixed at its source, but a trading process should degrade loudly rather
// than exit silently, so anything that slips through is logged and survived.
process.on('unhandledRejection', (reason) => {
  console.error('[fatal-guard] Unhandled promise rejection (process kept alive):', reason);
});

process.on('uncaughtException', (err) => {
  console.error('[fatal-guard] Uncaught exception (process kept alive):', err);
});

const app = express();
const httpServer = createServer(app);

declare module "http" {
  interface IncomingMessage {
    rawBody: unknown;
  }
}

app.use(
  express.json({
    verify: (req, _res, buf) => {
      req.rawBody = buf;
    },
  }),
);

app.use(express.urlencoded({ extended: false }));

export function log(message: string, source = "express") {
  const formattedTime = new Date().toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    hour12: true,
  });

  console.log(`${formattedTime} [${source}] ${message}`);
}

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  // Auto-migrate: add new columns that may not exist in older DB deployments
  try {
    await pool.query(`
      ALTER TABLE settings
        ADD COLUMN IF NOT EXISTS coinglass_api_key              TEXT,
        ADD COLUMN IF NOT EXISTS perplexity_api_key             TEXT,
        ADD COLUMN IF NOT EXISTS arkham_api_key                 TEXT,
        ADD COLUMN IF NOT EXISTS meta_api_token                 TEXT,
        ADD COLUMN IF NOT EXISTS meta_api_account_id            TEXT,
        ADD COLUMN IF NOT EXISTS gold_auto_trading_enabled      BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS gold_lot_size                  REAL    NOT NULL DEFAULT 0.01,
        ADD COLUMN IF NOT EXISTS gold_max_daily_trades          INTEGER NOT NULL DEFAULT 5,
        ADD COLUMN IF NOT EXISTS gold_min_confidence            INTEGER NOT NULL DEFAULT 75,
        ADD COLUMN IF NOT EXISTS binance_api_secret             TEXT,
        ADD COLUMN IF NOT EXISTS binance_auto_trading           BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS binance_leverage               INTEGER NOT NULL DEFAULT 10,
        ADD COLUMN IF NOT EXISTS binance_margin_type            TEXT    NOT NULL DEFAULT 'ISOLATED',
        ADD COLUMN IF NOT EXISTS binance_max_position_usdt      REAL    NOT NULL DEFAULT 100,
        ADD COLUMN IF NOT EXISTS bybit_api_secret               TEXT,
        ADD COLUMN IF NOT EXISTS bybit_auto_trading             BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS bybit_leverage                 INTEGER NOT NULL DEFAULT 10,
        ADD COLUMN IF NOT EXISTS bybit_margin_type              TEXT    NOT NULL DEFAULT 'ISOLATED',
        ADD COLUMN IF NOT EXISTS bybit_max_position_usdt        REAL    NOT NULL DEFAULT 100,
        ADD COLUMN IF NOT EXISTS mexc_api_key                   TEXT,
        ADD COLUMN IF NOT EXISTS mexc_api_secret                TEXT,
        ADD COLUMN IF NOT EXISTS mexc_connected                 BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS mexc_auto_trading              BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS mexc_leverage                  INTEGER NOT NULL DEFAULT 10,
        ADD COLUMN IF NOT EXISTS mexc_margin_type               TEXT    NOT NULL DEFAULT 'ISOLATED',
        ADD COLUMN IF NOT EXISTS mexc_max_position_usdt         REAL    NOT NULL DEFAULT 100,
        ADD COLUMN IF NOT EXISTS news_api_key                   TEXT;
    `);
  } catch (e: any) {
    // Non-fatal: table may not exist yet on first boot (db:push handles full init)
    console.warn("[migration] settings column check skipped:", e.message);
  }

  // Auto-migrate: create gold_trades table if not exists
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS gold_trades (
        id               VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
        type             TEXT    NOT NULL,
        lot_size         REAL    NOT NULL,
        entry_price      REAL    NOT NULL,
        tp               REAL    NOT NULL,
        sl               REAL    NOT NULL,
        confidence       INTEGER NOT NULL,
        status           TEXT    NOT NULL DEFAULT 'OPEN',
        mt5_order_id     TEXT,
        pnl              REAL,
        closed_at        TIMESTAMP,
        created_at       TIMESTAMP NOT NULL DEFAULT NOW()
      );
    `);
  } catch (e: any) {
    console.warn("[migration] gold_trades table check skipped:", e.message);
  }

  await registerRoutes(httpServer, app);

  // Start hourly Telegram alert scheduler
  startHourlyAlertScheduler();

  // Start auto-scanner (runs every 5 min, executes signals when autoExecute=true)
  startAutoScanner();

  // Self-calibration from closed trades. Pure math on data already in the DB —
  // no AI calls, so it runs regardless of the AI budget.
  startLearningEngine();

  // Restore today's AI spend so a restart cannot reset the daily cap.
  await restoreBudgetLedger();
  startBudgetPersistence();

  // Start autonomous market intelligence scanner
  // Reads config from bot settings — enabled/timeframes/coins set via UI or API
  try {
    const bs = await storage.getBotSettings() as any;
    const scannerConfig = bs?.scannerConfig;
    if (scannerConfig?.enabled) {
      configureScanner(scannerConfig);
      startMarketScanner();
    } else {
      console.log('[market-scanner] not auto-started (disabled in settings — enable via /api/agents/scanner/config)');
    }
  } catch {
    console.log('[market-scanner] could not read scanner config, skipping auto-start');
  }

  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }

    return res.status(status).json({ message });
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./vite");
    await setupVite(httpServer, app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);

  const startListening = (retry = true) => {
    httpServer.listen({ port, host: "0.0.0.0", reusePort: true }, () => {
      log(`serving on port ${port}`);
    });
  };

  httpServer.on("error", (err: any) => {
    if (err.code === "EADDRINUSE") {
      console.warn(`[server] Port ${port} in use — killing occupying process and retrying...`);
      try {
        execSync(`fuser -k ${port}/tcp 2>/dev/null || true`);
      } catch {}
      setTimeout(() => {
        httpServer.removeAllListeners("error");
        httpServer.on("error", (e: any) => {
          console.error("[server] Failed to start after retry:", e.message);
          process.exit(1);
        });
        startListening(false);
      }, 1000);
    } else {
      console.error("[server] Unexpected error:", err.message);
      process.exit(1);
    }
  });

  startListening();
})();
