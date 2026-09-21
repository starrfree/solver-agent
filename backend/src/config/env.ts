import { config as loadDotenv } from "dotenv";
import { z } from "zod";

loadDotenv();

const EnvSchema = z.object({
  MONGODB_URI: z.string().min(1, "MONGODB_URI is required"),
  MONGODB_DB: z.string().min(1, "MONGODB_DB is required"),

  OPENAI_API_KEY: z.string().default(""),
  ANTHROPIC_API_KEY: z.string().default(""),
  HUGGINGFACE_API_KEY: z.string().default(""),
  GEMINI_API_KEY: z.string().default(""),

  /**
   * Optional JSON object overriding / extending the built-in model pricing
   * table used for cost tracking, e.g.
   * `{"gpt-5.6-sol":{"input":4,"cachedInput":0.4,"output":20}}` (USD per 1M tokens).
   * Merged on top of the defaults in `config/pricing.ts`.
   */
  MODEL_PRICING_JSON: z.string().optional(),

  PYTHON_BIN: z.string().default("python3"),
  PYTHON_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  /**
   * Wall-clock cap for the numerical sub-agent's heavy runs (e.g. compiled C++
   * search / combinatorics driven via subprocess). Larger than
   * PYTHON_TIMEOUT_MS so genuinely expensive computations have room to finish.
   */
  PYTHON_HEAVY_TIMEOUT_MS: z.coerce.number().int().positive().default(240_000),
  PYTHON_MAX_TIMEOUTS: z.coerce.number().int().positive().default(3),
  PYTHON_MAX_ARTIFACT_BYTES: z.coerce.number().int().positive().default(2_097_152),
  /** Address-space / data-segment cap for sandboxed Python (bytes). Default 2 GiB. */
  PYTHON_MAX_MEMORY_BYTES: z.coerce.number().int().positive().default(2_147_483_648),
  /**
   * CPU-time cap for sandboxed Python (seconds). 0 disables the rlimit and
   * relies solely on the wall-clock timeout. Default derives from
   * PYTHON_TIMEOUT_MS at startup when left unset (see below).
   */
  PYTHON_MAX_CPU_SECONDS: z.coerce.number().int().nonnegative().optional(),
  /** Hard cap on captured stdout+stderr bytes before the run is killed. Default 8 MiB. */
  PYTHON_MAX_OUTPUT_BYTES: z.coerce.number().int().positive().default(8_388_608),

  AGENT_MAX_TURNS: z.coerce.number().int().positive().default(40),
  SUB_AGENT_MAX_TURNS: z.coerce.number().int().positive().default(12),

  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z
    .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
    .default("info"),
  CORS_ORIGIN: z.string().default("*"),

  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
});

export type Env = z.infer<typeof EnvSchema>;

const parsed = EnvSchema.safeParse(process.env);
if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
    .join("\n");
  // eslint-disable-next-line no-console
  console.error(`Invalid environment configuration:\n${issues}`);
  process.exit(1);
}

export const env: Env = parsed.data;

if (
  !env.OPENAI_API_KEY &&
  !env.ANTHROPIC_API_KEY &&
  !env.HUGGINGFACE_API_KEY &&
  !env.GEMINI_API_KEY
) {
  // eslint-disable-next-line no-console
  console.error(
    "At least one of OPENAI_API_KEY, ANTHROPIC_API_KEY, HUGGINGFACE_API_KEY, or GEMINI_API_KEY " +
      "must be set (the provider used for each agent stage is selected in agents/llmClient.ts).",
  );
  process.exit(1);
}
