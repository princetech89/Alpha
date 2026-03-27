import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import session from "express-session";
import { registerRoutes } from "./api/routes";
import { registerAuthRoutes } from "./api/auth";
import { serveStatic } from "./middleware/static";
import { createServer } from "http";

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

app.use(session({
  secret: process.env.SESSION_SECRET ?? "alphasignal-dev-secret-2026",
  resave: false,
  saveUninitialized: false,
  cookie: {
    maxAge: 30 * 24 * 60 * 60 * 1000,
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
  },
}));

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
  registerAuthRoutes(app);
  await registerRoutes(httpServer, app);

  if (process.env.NODE_ENV === "production") {
    serveStatic(app);
  } else {
    const { setupVite } = await import("./middleware/vite");
    await setupVite(httpServer, app);
  }

  // ── ERROR & 404 HANDLING ──────────────────────────────────────────────────
  // (Always must be after all routes and handlers)

  // 1. Final catch-all for anything missing (mainly for API 404s)
  app.use((req, res) => {
    if (req.path.startsWith("/api")) {
      res.status(404).json({ message: "API endpoint not found" });
    } else {
      // should never really get here because of setupVite/serveStatic catch-all,
      // but if we do, return 404 plain text.
      res.status(404).send("Not Found");
    }
  });

  // 2. Global Exception Handler (must have 4 args!)
  app.use((err: any, _req: Request, res: Response, next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    console.error("Internal Server Error:", err);

    if (res.headersSent) {
      return next(err);
    }
    res.status(status).json({ message });
  });

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
