import crypto from "crypto";

// Stateless, signed session tokens — safe across Vercel's per-invocation
// serverless functions, which don't share in-memory state (rules out
// express-session with a MemoryStore).

const SESSION_TTL_MS = 12 * 60 * 60 * 1000; // 12 hours
export const SESSION_COOKIE_NAME = "session";

const PUBLIC_API_PATHS = new Set(["/api/auth/login", "/api/auth/logout", "/api/auth/me"]);

function getSecret(): string {
  const secret = process.env.SESSION_SECRET || process.env.AUTH_PASSWORD;
  if (!secret) {
    throw new Error("SESSION_SECRET (or AUTH_PASSWORD) environment variable is required");
  }
  return secret;
}

function sign(payload: string): string {
  return crypto.createHmac("sha256", getSecret()).update(payload).digest("base64url");
}

export function createSessionToken(username: string): string {
  const expires = Date.now() + SESSION_TTL_MS;
  // Usernames are often emails (contain dots), so encode before joining on "."
  const encodedUser = Buffer.from(username, "utf8").toString("base64url");
  const payload = `${encodedUser}.${expires}`;
  return `${payload}.${sign(payload)}`;
}

export function verifySessionToken(token: string | undefined | null): boolean {
  if (!token) return false;
  const parts = token.split(".");
  if (parts.length !== 3) return false;
  const [encodedUser, expiresStr, sig] = parts;
  const payload = `${encodedUser}.${expiresStr}`;

  let expected: Buffer;
  try {
    expected = Buffer.from(sign(payload));
  } catch {
    return false;
  }
  const actual = Buffer.from(sig);
  if (actual.length !== expected.length || !crypto.timingSafeEqual(actual, expected)) {
    return false;
  }

  const expires = Number(expiresStr);
  return Number.isFinite(expires) && Date.now() <= expires;
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const cookies: Record<string, string> = {};
  if (!header) return cookies;
  for (const pair of header.split(";")) {
    const idx = pair.indexOf("=");
    if (idx === -1) continue;
    const key = pair.slice(0, idx).trim();
    const val = pair.slice(idx + 1).trim();
    if (key) cookies[key] = decodeURIComponent(val);
  }
  return cookies;
}

export function buildSessionCookie(token: string): string {
  const attrs = [
    `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}`,
    "Path=/",
    `Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}`,
    "HttpOnly",
    "SameSite=Lax",
  ];
  if (process.env.NODE_ENV === "production") attrs.push("Secure");
  return attrs.join("; ");
}

export function buildClearSessionCookie(): string {
  const attrs = [`${SESSION_COOKIE_NAME}=`, "Path=/", "Max-Age=0", "HttpOnly", "SameSite=Lax"];
  if (process.env.NODE_ENV === "production") attrs.push("Secure");
  return attrs.join("; ");
}

// Express middleware — gates every /api/* route except the auth endpoints
// themselves. Mount once, before any route registration.
export function requireAuth(req: any, res: any, next: any) {
  if (!req.path.startsWith("/api/")) return next();
  if (PUBLIC_API_PATHS.has(req.path)) return next();

  const cookies = parseCookies(req.headers.cookie);
  if (!verifySessionToken(cookies[SESSION_COOKIE_NAME])) {
    return res.status(401).json({ message: "Authentication required" });
  }
  next();
}
