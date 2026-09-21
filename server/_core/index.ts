import "dotenv/config";
import express from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import { serveStatic, setupVite } from "./vite";
import { investigate } from "../investigation";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise(resolve => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);
  // Configure body parser with larger size limit for file uploads
  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));
  const proxyFastApi = async (path: string, init?: RequestInit) => {
    const fastApiUrl = process.env.FASTAPI_API_URL?.replace(/\/$/, "");
    if (!fastApiUrl) return null;
    const upstream = await fetch(`${fastApiUrl}${path}`, { ...init, signal: AbortSignal.timeout(120000) });
    return { status: upstream.status, payload: await upstream.json() };
  };
  app.get("/api/investigations", async (_req, res) => {
    try {
      const result = await proxyFastApi("/api/investigations");
      if (!result) return res.status(503).json({ message: "Saved investigations require the FastAPI service." });
      return res.status(result.status).json(result.payload);
    } catch { return res.status(502).json({ message: "FastAPI service unavailable." }); }
  });
  app.get("/api/investigations/:value", async (req, res) => {
    try {
      const result = await proxyFastApi(`/api/investigations/${encodeURIComponent(req.params.value)}`);
      if (!result) return res.status(503).json({ message: "Saved investigations require the FastAPI service." });
      return res.status(result.status).json(result.payload);
    } catch { return res.status(502).json({ message: "FastAPI service unavailable." }); }
  });
  app.post("/api/investigations/compare", async (req, res) => {
    try {
      const result = await proxyFastApi("/api/investigations/compare", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(req.body) });
      if (!result) return res.status(503).json({ message: "Comparison requires the FastAPI service." });
      return res.status(result.status).json(result.payload);
    } catch { return res.status(502).json({ message: "FastAPI service unavailable." }); }
  });
  app.post("/api/investigate", async (req, res) => {
    try {
      const fastApiUrl = process.env.FASTAPI_API_URL?.replace(/\/$/, "");
      if (fastApiUrl) {
        const upstream = await fetch(`${fastApiUrl}/api/investigate`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ query: String(req.body?.query || "") }),
          signal: AbortSignal.timeout(120000),
        });
        const payload = await upstream.json();
        res.status(upstream.status).json(payload);
        return;
      }
      const payload = await investigate(String(req.body?.query || ""));
      res.json(payload);
    } catch (error) {
      const code = (error as Error & { code?: string }).code;
      res.status(code === "CONFIGURATION_REQUIRED" ? 503 : code === "EMPTY_RESULTS" ? 404 : 400).json({
        message: error instanceof Error ? error.message : "The investigation could not be completed.",
        code,
      });
    }
  });
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  // tRPC API
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    })
  );
  // development mode uses Vite, production mode uses static files
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}

startServer().catch(console.error);
