import type { Express } from "express";
import { getUserById, getUserByEmail, createUser, updateUser, verifyPassword } from "../db/profileStore";

declare module "express-session" {
  interface SessionData { loginId?: number; }
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function registerAuthRoutes(app: Express) {

  // POST /api/auth/register — create new account
  app.post("/api/auth/register", async (req, res) => {
    try {
      const { name, phone, password } = req.body as Record<string, string>;
      const email = (req.body.email as string)?.trim().toLowerCase();
      if (!name?.trim())     return res.status(400).json({ error: "Full name is required" });
      if (!email)            return res.status(400).json({ error: "Email is required" });
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Invalid email address" });
      if (!phone?.trim())    return res.status(400).json({ error: "Phone number is required" });
      if (phone.replace(/\D/g, "").length < 10)
        return res.status(400).json({ error: "Phone must be at least 10 digits" });
      if (!password || password.length < 6)
        return res.status(400).json({ error: "Password must be at least 6 characters" });

      const existing = await getUserByEmail(email);
      if (existing) return res.status(409).json({ error: "An account with this email already exists" });

      const user = await createUser({ name, email, phone, password });
      req.session.loginId = user.loginId;
      req.session.save((err) => {
        if (err) return res.status(500).json({ error: "Session error. Please try again." });
        res.json(user);
      });
    } catch (e: any) {
      console.error("[Auth] register error:", e.message);
      res.status(500).json({ error: "Registration failed. Please try again." });
    }
  });

  // POST /api/auth/login — sign in with email + password
  app.post("/api/auth/login", async (req, res) => {
    try {
      const { password } = req.body as Record<string, string>;
      const email = (req.body.email as string)?.trim().toLowerCase();
      if (!email)            return res.status(400).json({ error: "Email is required" });
      if (!password?.trim()) return res.status(400).json({ error: "Password is required" });

      const row = await getUserByEmail(email);
      if (!row) return res.status(401).json({ error: "No account found with this email" });

      const ok = await verifyPassword(password, row.password);
      if (!ok) return res.status(401).json({ error: "Incorrect password" });

      req.session.loginId = row.loginId;
      req.session.save((err) => {
        if (err) return res.status(500).json({ error: "Session error. Please try again." });
        res.json({
          loginId: row.loginId, name: row.name, email: row.email,
          phone: row.phone, createdAt: row.createdAt.toISOString(),
        });
      });
    } catch (e: any) {
      console.error("[Auth] login error:", e.message);
      res.status(500).json({ error: "Login failed. Please try again." });
    }
  });

  // POST /api/auth/logout
  app.post("/api/auth/logout", (req, res) => {
    req.session.destroy(() => res.json({ ok: true }));
  });

  // GET /api/auth/me
  app.get("/api/auth/me", async (req, res) => {
    try {
      const id = req.session.loginId;
      if (!id) return res.status(401).json({ error: "Not authenticated" });
      const user = await getUserById(id);
      if (!user) return res.status(401).json({ error: "Session expired" });
      res.json(user);
    } catch (e: any) {
      res.status(500).json({ error: "Server error" });
    }
  });

  // PUT /api/auth/profile — update details + optional password change
  app.put("/api/auth/profile", async (req, res) => {
    try {
      const id = req.session.loginId;
      if (!id) return res.status(401).json({ error: "Not authenticated" });

      const { name, phone, newPassword } = req.body as Record<string, string>;
      const email = (req.body.email as string)?.trim().toLowerCase();
      if (!name?.trim())  return res.status(400).json({ error: "Full name is required" });
      if (!email)         return res.status(400).json({ error: "Email is required" });
      if (!phone?.trim()) return res.status(400).json({ error: "Phone is required" });
      if (!EMAIL_RE.test(email)) return res.status(400).json({ error: "Invalid email address" });
      if (newPassword && newPassword.length < 6)
        return res.status(400).json({ error: "New password must be at least 6 characters" });

      const updated = await updateUser(id, {
        name, email, phone,
        ...(newPassword ? { password: newPassword } : {}),
      });
      if (!updated) return res.status(404).json({ error: "User not found" });
      res.json(updated);
    } catch (e: any) {
      console.error("[Auth] profile update error:", e.message);
      res.status(500).json({ error: "Update failed. Please try again." });
    }
  });
}
