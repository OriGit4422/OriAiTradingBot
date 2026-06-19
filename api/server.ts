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

// Auth route handled here so it works even if DB is unavailable
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

let initialized = false;
let initError: Error | null = null;

async function ensureInitialized(httpServer: ReturnType<typeof createServer>) {
  if (initialized || initError) return;
  try {
    const { registerRoutes } = await import("../server/routes");
    await registerRoutes(httpServer, app);
  } catch (err: any) {
    initError = err;
    console.error("[vercel] registerRoutes failed:", err.message);
  } finally {
    initialized = true;
  }
}

const httpServer = createServer(app);

export default async function handler(req: VercelRequest, res: VercelResponse) {
  await ensureInitialized(httpServer);
  return app(req as any, res as any);
}
