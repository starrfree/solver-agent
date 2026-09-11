import pino from "pino";

import { env } from "../config/env";

export const logger = pino({
  level: env.LOG_LEVEL,
  base: { service: "solver-agent-backend" },
  ...(env.NODE_ENV === "development"
    ? {
        transport: {
          target: "pino/file",
          options: { destination: 1 },
        },
      }
    : {}),
});

export type Logger = typeof logger;
