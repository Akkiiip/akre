import express from "express";
import { registerLiveRoutes } from "./live-routes";
import { registerCatalogue } from "./catalogue";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { resolve } from "node:path";
import { z } from "zod";
import type { Service } from "./service";
export function createApp(
  service: Service,
  config: {
    password?: string;
    sessionSecret?: string;
    origin?: string;
    staticDir?: string;
    serverlessDemo?: boolean;
    serverlessLive?: boolean;
    executeJobsInline?: boolean;
  } = {},
) {
  const app = express();
  app.disable("x-powered-by");
  app.use(express.json({ limit: "128kb" }));
  const secret = config.sessionSecret ?? randomBytes(32).toString("hex");
  const equal = (a: string, b: string) => {
    const x = Buffer.from(a),
      y = Buffer.from(b);
    return x.length === y.length && timingSafeEqual(x, y);
  };
  const sign = (value: string) =>
    createHmac("sha256", secret).update(value).digest("hex");
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "same-origin");
    res.setHeader("X-Frame-Options", "DENY");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'",
    );
    next();
  });
  app.use("/api", (req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    if (!["GET", "HEAD"].includes(req.method)) {
      const origin = req.headers.origin;
      const allowed =
        config.origin ??
        `${config.serverlessDemo ? "https" : "http"}://${req.headers.host}`;
      if (origin && origin !== allowed) {
        res.status(403).json({ error: "Origin is not allowed" });
        return;
      }
      if (req.headers["content-type"]?.split(";")[0] !== "application/json") {
        res.status(415).json({ error: "JSON required" });
        return;
      }
    }
    next();
  });
  const attempts = new Map<string, { count: number; until: number }>();
  app.post("/api/login", (req, res) => {
    const key = req.ip ?? "unknown",
      now = Date.now();
    let a = attempts.get(key);
    if (!a || a.until < now) {
      a = { count: 0, until: now + 15 * 60_000 };
      attempts.set(key, a);
    }
    if (++a.count > 10) {
      res
        .status(429)
        .json({ error: "Too many attempts; try again in 15 minutes" });
      return;
    }
    const { password } = z
      .object({ password: z.string().max(1000) })
      .parse(req.body);
    if (!config.password || !equal(password, config.password)) {
      res.status(401).json({ error: "Invalid password" });
      return;
    }
    attempts.delete(key);
    const exp = String(Date.now() + 8 * 60 * 60_000);
    res.setHeader(
      "Set-Cookie",
      `akre_session=${exp}.${sign(exp)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${config.serverlessDemo || config.origin?.startsWith("https:") ? "; Secure" : ""}`,
    );
    res.json({ ok: true });
  });
  app.get("/api/health", (_req, res) =>
    res.json({
      status: "ok",
      mode: service.repo.mode,
      ...(config.serverlessDemo
        ? { runtime: "nodejs24.x", storage: "ephemeral", durable: false }
        : config.serverlessLive
          ? { runtime: "nodejs24.x", storage: "postgres", durable: true }
          : {}),
    }),
  );
  app.use("/api", (req, res, next) => {
    if (config.password) {
      const cookie = req.headers.cookie
        ?.split(";")
        .map((c) => c.trim())
        .find((c) => c.startsWith("akre_session="))
        ?.slice(13);
      const [exp, sig] = cookie?.split(".") ?? [];
      if (!exp || !sig || Number(exp) < Date.now() || !equal(sign(exp), sig)) {
        res.status(401).json({ error: "Sign in required" });
        return;
      }
    }
    next();
  });
  app.post("/api/logout", (_req, res) => {
    res.setHeader(
      "Set-Cookie",
      "akre_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0",
    );
    res.json({ ok: true });
  });
  registerCatalogue(app, service);
  registerLiveRoutes(app, service);
  app.get("/api/state", (_req, res) =>
    res.json({
      mode: service.repo.mode,
      ...(config.serverlessDemo
        ? {
            storage: {
              kind: "ephemeral",
              durable: false,
              notice:
                "Vercel DEMO: temporary instance-local data. Changes can reset and are not shared across instances.",
            },
          }
        : config.serverlessLive
          ? {
              storage: {
                kind: "postgres",
                durable: true,
                notice: "LIVE: durable PostgreSQL storage.",
              },
            }
          : {}),
      data: service.repo.snapshot(),
      integrations: service.integrations(),
    }),
  );
  app.patch("/api/products/:id/lifecycle", (req, res) =>
    res.json(service.transition(String(req.params.id), req.body)),
  );
  app.put("/api/products/:id/economics", (req, res) =>
    res.json(service.saveCosts(String(req.params.id), req.body)),
  );
  app.post("/api/assets", (req, res) =>
    res.status(201).json(service.createAsset(req.body)),
  );
  app.post("/api/experiments", (req, res) =>
    res.status(201).json(service.createExperiment(req.body)),
  );
  app.put("/api/experiments/:id/metrics", (req, res) =>
    res.json(service.saveMetrics(String(req.params.id), req.body)),
  );
  app.post("/api/listings", (req, res) =>
    res.status(201).json(service.createListing(req.body)),
  );
  app.post("/api/jobs", async (req, res) => {
    const job = service.enqueue(req.body);
    // DEMO jobs are bounded local calculations; finish before serverless suspension.
    if (config.executeJobsInline) await service.runNext();
    res.status(202).json(service.repo.get("jobs", job.id));
  });
  app.post("/api/jobs/:id/retry", (req, res) =>
    res.json(service.retry(String(req.params.id))),
  );
  app.use("/api", (_req, res) =>
    res.status(404).json({ error: "Endpoint not found" }),
  );
  if (config.staticDir) {
    app.use(express.static(resolve(config.staticDir)));
    app.get("/{*path}", (_req, res) =>
      res.sendFile(resolve(config.staticDir!, "index.html")),
    );
  }
  app.use(
    (
      err: unknown,
      _req: express.Request,
      res: express.Response,
      _next: express.NextFunction,
    ) => {
      if (config.serverlessDemo && !(err instanceof z.ZodError)) {
        const parseError =
          err instanceof SyntaxError &&
          "type" in err &&
          err.type === "entity.parse.failed";
        const coded = err instanceof Error && "code" in err;
        const unexpected =
          coded || err instanceof TypeError || !(err instanceof Error);
        console.error(
          JSON.stringify({
            event: "akre_api_request_failed",
            type: err instanceof Error ? err.name : "UnknownError",
            code: coded
              ? String((err as Error & { code: unknown }).code)
              : "REQUEST_REJECTED",
          }),
        );
        res.status(parseError ? 400 : unexpected ? 500 : 400).json({
          error: parseError
            ? "Invalid JSON request"
            : unexpected
              ? "Backend request failed. Check server logs."
              : "Request rejected. Check the input, lifecycle state and integration configuration.",
        });
        return;
      }
      const message =
        err instanceof z.ZodError
          ? err.issues
              .map((i) => `${i.path.join(".")}: ${i.message}`)
              .join("; ")
          : err instanceof Error
            ? err.message
            : "Request failed";
      res
        .status(
          err instanceof z.ZodError
            ? 400
            : message.includes("not found")
              ? 404
              : message.includes("NOT CONFIGURED")
                ? 409
                : 400,
        )
        .json({ error: message });
    },
  );
  return app;
}
