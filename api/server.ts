import type { VercelRequest, VercelResponse } from "@vercel/node";
import express from "express";
import { createServer } from "http";

const app = express();

app.use(
  express.json({
    verify: (req: any, _res, buf) => {
      req.rawBody = buf;
    },
  })
);
app.use(express.urlencoded({ extended: false }));

let initialized = false;

async function ensureInitialized(httpServer: ReturnType<typeof createServer>) {
  if (initialized) return;
  initialized = true;
  try {
    const { registerRoutes } = await import("../server/routes");
    await registerRoutes(httpServer, app);
  } catch (err: any) {
    console.error("[vercel] registerRoutes failed:", err.message);
  }
}

const httpServer = createServer(app);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  await ensureInitialized(httpServer);
  return app(req as any, res as any);
}
