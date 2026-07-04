import type { VercelRequest, VercelResponse } from "@vercel/node";
import { createSessionToken, buildSessionCookie } from "../../server/auth";

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { username, password } = req.body as { username?: string; password?: string };
  const validUser = process.env.AUTH_USERNAME;
  const validPass = process.env.AUTH_PASSWORD;
  if (!validUser || !validPass) {
    return res.status(500).json({ message: "Authentication is not configured" });
  }

  if (username === validUser && password === validPass) {
    const token = createSessionToken(validUser);
    res.setHeader("Set-Cookie", buildSessionCookie(token));
    return res.json({ success: true, user: { username: validUser, role: "admin" } });
  }

  return res.status(401).json({ success: false, message: "Invalid credentials" });
}
