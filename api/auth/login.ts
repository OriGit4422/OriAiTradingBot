import type { VercelRequest, VercelResponse } from "@vercel/node";

export default function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== "POST") {
    return res.status(405).json({ message: "Method not allowed" });
  }

  const { username, password } = req.body as { username?: string; password?: string };
  const validUser = process.env.AUTH_USERNAME || "patyqm2010@gmail.com";
  const validPass = process.env.AUTH_PASSWORD || "Ori@4422";

  if (username === validUser && password === validPass) {
    return res.json({ success: true, user: { username: validUser, role: "admin" } });
  }

  return res.status(401).json({ success: false, message: "Invalid credentials" });
}
