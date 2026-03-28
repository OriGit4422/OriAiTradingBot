import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes";
import { serveStatic } from "./static";
import { createServer } from "http";
import { pool } from "./db";

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
        ADD COLUMN IF NOT EXISTS coinglass_api_key         TEXT,
        ADD COLUMN IF NOT EXISTS perplexity_api_key        TEXT,
        ADD COLUMN IF NOT EXISTS arkham_api_key            TEXT,
        ADD COLUMN IF NOT EXISTS meta_api_token            TEXT,
        ADD COLUMN IF NOT EXISTS meta_api_account_id       TEXT,
        ADD COLUMN IF NOT EXISTS gold_auto_trading_enabled BOOLEAN NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS gold_lot_size             REAL    NOT NULL DEFAULT 0.01,
        ADD COLUMN IF NOT EXISTS gold_max_daily_trades     INTEGER NOT NULL DEFAULT 5,
        ADD COLUMN IF NOT EXISTS gold_min_confidence       INTEGER NOT NULL DEFAULT 75;
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
  httpServer.listen(
    {
      port,
      host: "0.0.0.0",
      reusePort: true,
    },
    () => {
      log(`serving on port ${port}`);
    },
  );
})();
