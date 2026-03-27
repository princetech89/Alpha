/**
 * Vercel Serverless Entry Point
 * ─────────────────────────────
 * Mirrors server/index.ts but:
 *  - Does NOT call httpServer.listen() (Vercel manages the HTTP lifecycle)
 *  - Uses connect-pg-simple for session persistence (Vercel is stateless)
 *  - Skips Vite/static middleware (Vercel CDN serves dist/public directly)
 */

import "dotenv/config";
import express, { type Request, type Response, type NextFunction } from "express";
import session from "express-session";
import connectPgSimple from "connect-pg-simple";
import { createServer } from "http";
import { registerRoutes } from "../server/api/routes";
import { registerAuthRoutes } from "../server/api/auth";

declare module "http" {
  interface IncomingMessage { rawBody: unknown; }
}

const app = express();
const httpServer = createServer(app);

// ── Middleware ─────────────────────────────────────────────────────────────────
app.use(express.json({
  verify: (req: any, _res, buf) => { req.rawBody = buf; },
}));
app.use(express.urlencoded({ extended: false }));

// PostgreSQL-backed sessions — survives Vercel cold starts
const PgSession = connectPgSimple(session);
app.use(session({
  store: new PgSession({
    conString: process.env.DATABASE_URL,
    tableName: "session",
    createTableIfMissing: true,
  }),
  secret: process.env.SESSION_SECRET ?? "alphasignal-dev-secret-2026",
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: true,
    sameSite: "none",
  },
}));

// ── Lazy initialisation — registers all routes once on first request ───────────
let initPromise: Promise<void> | null = null;

function ensureReady(): Promise<void> {
  if (!initPromise) {
    initPromise = (async () => {
      registerAuthRoutes(app);
      await registerRoutes(httpServer, app);

      // 404 catch-all
      app.use((req: Request, res: Response) => {
        if (req.path.startsWith("/api")) {
          res.status(404).json({ message: "API endpoint not found" });
        } else {
          res.status(404).send("Not Found");
        }
      });

      // Global error handler
      app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
        const status = err.status || err.statusCode || 500;
        const message = err.message || "Internal Server Error";
        if (res.headersSent) return next(err);
        res.status(status).json({ message });
      });
    })();
  }
  return initPromise;
}

// Pre-warm on module load (reduces first-request latency)
ensureReady().catch(console.error);

export default app;
