import cors from "cors";
import express, { ErrorRequestHandler, NextFunction, Request, Response } from "express";
import pinoHttp from "pino-http";

import { env } from "./config/env";
import { connectMongo, disconnectMongo } from "./db/mongo";
import conversationsRouter from "./routes/conversations";
import exportRouter from "./routes/export";
import filesRouter from "./routes/files";
import healthRouter from "./routes/health";
import ledgerRouter from "./routes/ledger";
import messagesRouter from "./routes/messages";
import sideTalkRouter from "./routes/sideTalk";
import streamRouter from "./routes/stream";
import { drainSolverRuns, recoverInterruptedRuns } from "./services/solverOrchestrator";
import { HttpError } from "./util/errors";
import { logger } from "./util/logger";

async function main(): Promise<void> {
  await connectMongo();
  await recoverInterruptedRuns();

  const app = express();
  app.disable("x-powered-by");
  app.use(
    cors({
      origin: env.CORS_ORIGIN === "*" ? true : env.CORS_ORIGIN,
      // Lets a cross-origin frontend read the export bundle's file name.
      exposedHeaders: ["Content-Disposition"],
    }),
  );
  app.use(express.json({ limit: "1mb" }));
  app.use(
    pinoHttp({
      logger,
      serializers: {
        req: (req) => ({ method: req.method, url: req.url }),
        res: (res) => ({ statusCode: res.statusCode }),
      },
      customLogLevel: (_req, res, err) => {
        if (err || res.statusCode >= 500) return "error";
        if (res.statusCode >= 400) return "warn";
        return "debug";
      },
    }),
  );

  app.use("/api/health", healthRouter);
  app.use("/api/conversations", conversationsRouter);
  app.use("/api/conversations/:id/messages", messagesRouter);
  app.use("/api/conversations/:id/side-talk", sideTalkRouter);
  app.use("/api/conversations/:id/ledger", ledgerRouter);
  app.use("/api/conversations/:id/files", filesRouter);
  app.use("/api/conversations/:id/export", exportRouter);
  app.use("/api/conversations/:id/stream", streamRouter);

  app.use((_req: Request, res: Response, _next: NextFunction) => {
    res.status(404).json({ error: { code: "not_found", message: "Route not found" } });
  });

  const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
    if (err instanceof HttpError) {
      res.status(err.status).json({
        error: {
          code: err.code,
          message: err.message,
          ...(err.details ? { details: err.details } : {}),
        },
      });
      return;
    }
    logger.error({ err }, "Unhandled error");
    res.status(500).json({
      error: {
        code: "internal_error",
        message: err instanceof Error ? err.message : "Internal server error",
      },
    });
  };
  app.use(errorHandler);

  const server = app.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, "Server listening");
  });

  const shutdown = async (signal: string): Promise<void> => {
    logger.info({ signal }, "Shutdown signal received");
    server.close(() => {
      logger.info("HTTP server closed");
    });
    await drainSolverRuns();
    await disconnectMongo();
    process.exit(0);
  };

  process.on("SIGTERM", () => {
    void shutdown("SIGTERM");
  });
  process.on("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.on("uncaughtException", (err) => {
    logger.fatal({ err }, "Uncaught exception");
  });
  process.on("unhandledRejection", (reason) => {
    logger.error({ reason }, "Unhandled promise rejection");
  });
}

main().catch((err) => {
  logger.fatal({ err }, "Failed to bootstrap server");
  process.exit(1);
});
