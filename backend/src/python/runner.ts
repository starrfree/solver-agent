import { spawn, ChildProcess } from "node:child_process";
import * as os from "node:os";
import * as path from "node:path";

import { env } from "../config/env";
import { TimeoutError, ToolError } from "../util/errors";
import { logger } from "../util/logger";

const RESULT_PREFIX = "__SOLVER_RUNNER_RESULT__";

const RUNNER_PATH = path.resolve(__dirname, "..", "..", "python", "runner.py");

/**
 * Env vars that are safe (and sometimes necessary) to expose to sandboxed,
 * model-generated Python. Everything else from the backend process env —
 * notably OPENAI_API_KEY / ANTHROPIC_API_KEY / HUGGINGFACE_API_KEY /
 * MONGODB_URI — is deliberately withheld so untrusted code cannot read or
 * exfiltrate secrets.
 */
const ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "LANG",
  "LC_ALL",
  "LC_CTYPE",
  "TMPDIR",
  // Windows needs these for the interpreter to start at all.
  "SystemRoot",
  "SYSTEMROOT",
  "WINDIR",
  "PATHEXT",
] as const;

/**
 * Build the minimal environment handed to the Python sandbox: an allowlist of
 * the parent env plus a handful of safe overrides. `MPLCONFIGDIR` is pinned to
 * a temp dir so matplotlib never writes into the real `$HOME`.
 */
function buildSandboxEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const key of ENV_ALLOWLIST) {
    const value = process.env[key];
    if (value !== undefined) out[key] = value;
  }
  out.PYTHONUNBUFFERED = "1";
  out.MPLBACKEND = "Agg";
  out.MPLCONFIGDIR = path.join(os.tmpdir(), "solver-mplconfig");
  return out;
}

/** Effective CPU-time cap (seconds). Falls back to wall-clock + headroom. */
function cpuSecondsFor(timeoutMs: number): number {
  if (env.PYTHON_MAX_CPU_SECONDS !== undefined) return env.PYTHON_MAX_CPU_SECONDS;
  return Math.ceil(timeoutMs / 1000) + 5;
}

/**
 * Kill the entire process group of a detached child (so any grandchildren the
 * script spawned are reaped too), falling back to killing the child directly
 * when the group signal cannot be delivered.
 */
function killProcessTree(child: ChildProcess): void {
  if (typeof child.pid === "number") {
    try {
      process.kill(-child.pid, "SIGKILL");
      return;
    } catch {
      // Group kill failed (e.g. process already gone, or no group on win32).
    }
  }
  try {
    child.kill("SIGKILL");
  } catch {
    // Nothing more we can do.
  }
}

/**
 * Shape of the trailing `__SOLVER_RUNNER_RESULT__{...}` JSON line emitted
 * by `python/runner.py`. Artifact bytes arrive base64-encoded inline
 * because the runner's temp directory is wiped before the Node side has
 * a chance to read the files from disk.
 */
interface PythonRunnerResultLine {
  exitCode: number;
  error: string | null;
  artifacts: Array<{
    name: string;
    /** Base64 of the file's bytes. Omitted when `skipped` is true. */
    data?: string;
    skipped?: boolean;
    reason?: string;
    size: number;
  }>;
}

export interface RunPythonOptions {
  /** Python source. Will be executed in a sandboxed tmp dir. */
  code: string;
  /** Override for `PYTHON_TIMEOUT_MS`. */
  timeoutMs?: number;
}

/**
 * One file captured from the sandbox `artifacts/` directory. The raw
 * bytes are returned verbatim; persistence (and any base64 encoding) is
 * the caller's job.
 */
export interface RunnerArtifact {
  name: string;
  mimeType: string;
  size: number;
  /** Bytes of the file. Omitted only when `skipped` is true. */
  data?: Buffer;
  skipped?: boolean;
  reason?: string;
}

export interface RunPythonResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  /** True when the subprocess was killed because the timeout elapsed. */
  timedOut: boolean;
  /** True when the subprocess was killed because it exceeded the output cap. */
  outputExceeded?: boolean;
  /** Files captured from the sandbox `artifacts/` directory. */
  artifacts: RunnerArtifact[];
}

const MIME_BY_EXT: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".pdf": "application/pdf",
  ".csv": "text/csv",
  ".txt": "text/plain",
  ".json": "application/json",
};

function mimeTypeFor(name: string): string {
  const ext = path.extname(name).toLowerCase();
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

/**
 * Execute Python source in the sandboxed runner. Stdout/stderr are returned
 * verbatim, except for the trailing `__SOLVER_RUNNER_RESULT__{...}` line
 * which is stripped from stdout and used to populate `exitCode` + artifacts.
 */
export async function runPython(options: RunPythonOptions): Promise<RunPythonResult> {
  const timeoutMs = options.timeoutMs ?? env.PYTHON_TIMEOUT_MS;
  const start = Date.now();

  const maxOutputBytes = env.PYTHON_MAX_OUTPUT_BYTES;

  return new Promise<RunPythonResult>((resolve, reject) => {
    const child = spawn(
      env.PYTHON_BIN,
      [
        RUNNER_PATH,
        "--max-artifact-bytes",
        String(env.PYTHON_MAX_ARTIFACT_BYTES),
        "--max-memory-bytes",
        String(env.PYTHON_MAX_MEMORY_BYTES),
        "--cpu-seconds",
        String(cpuSecondsFor(timeoutMs)),
      ],
      {
        stdio: ["pipe", "pipe", "pipe"],
        env: buildSandboxEnv(),
        // Put the child in its own process group so we can SIGKILL the whole
        // tree (including any grandchildren it spawns) on timeout / overflow.
        detached: true,
      },
    );

    let stdout = "";
    let stderr = "";
    let outputBytes = 0;
    let timedOut = false;
    let outputExceeded = false;

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, timeoutMs);

    const enforceOutputCap = () => {
      if (outputBytes <= maxOutputBytes || outputExceeded) return;
      outputExceeded = true;
      killProcessTree(child);
    };

    child.stdout.setEncoding("utf-8");
    child.stderr.setEncoding("utf-8");
    child.stdout.on("data", (chunk: string) => {
      stdout += chunk;
      outputBytes += Buffer.byteLength(chunk, "utf-8");
      enforceOutputCap();
    });
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk;
      outputBytes += Buffer.byteLength(chunk, "utf-8");
      enforceOutputCap();
    });

    child.on("error", (err) => {
      clearTimeout(timer);
      reject(
        new ToolError(
          "python_runner_unavailable",
          `Failed to spawn Python runner (${env.PYTHON_BIN}): ${err.message}`,
        ),
      );
    });

    child.on("close", async (code) => {
      clearTimeout(timer);
      const durationMs = Date.now() - start;

      if (timedOut) {
        return reject(new TimeoutError(timeoutMs));
      }

      const { exitCode, artifacts, cleanedStdout } = await parseResult(stdout);

      const result: RunPythonResult = {
        exitCode: exitCode ?? code ?? 0,
        stdout: cleanedStdout,
        stderr: outputExceeded
          ? `${stderr}\n[runner] output exceeded ${maxOutputBytes} bytes; process killed.`
          : stderr,
        durationMs,
        timedOut: false,
        ...(outputExceeded ? { outputExceeded: true } : {}),
        artifacts,
      };
      resolve(result);
    });

    try {
      child.stdin.write(options.code);
      child.stdin.end();
    } catch (err) {
      clearTimeout(timer);
      reject(
        new ToolError(
          "python_runner_stdin_error",
          err instanceof Error ? err.message : String(err),
        ),
      );
    }
  });
}

function parseResult(stdout: string): {
  exitCode: number | null;
  artifacts: RunnerArtifact[];
  cleanedStdout: string;
} {
  const idx = stdout.lastIndexOf(RESULT_PREFIX);
  if (idx === -1) {
    return { exitCode: null, artifacts: [], cleanedStdout: stdout };
  }

  const newlineEnd = stdout.indexOf("\n", idx);
  const jsonEnd = newlineEnd === -1 ? stdout.length : newlineEnd;
  const jsonStr = stdout.slice(idx + RESULT_PREFIX.length, jsonEnd);

  // Strip the result line (and the leading "\n" the runner emits before it).
  const before = stdout.slice(0, idx).replace(/\n$/, "");
  const after = stdout.slice(jsonEnd + 1);
  const cleanedStdout = before + (after ? `\n${after}` : "");

  let parsed: PythonRunnerResultLine;
  try {
    parsed = JSON.parse(jsonStr) as PythonRunnerResultLine;
  } catch (err) {
    logger.warn(
      { err, jsonStr },
      "Failed to parse python runner result trailer",
    );
    return { exitCode: null, artifacts: [], cleanedStdout };
  }

  const artifacts: RunnerArtifact[] = [];
  for (const a of parsed.artifacts ?? []) {
    if (a.skipped || !a.data) {
      artifacts.push({
        name: a.name,
        mimeType: mimeTypeFor(a.name),
        size: a.size,
        skipped: true,
        ...(a.reason ? { reason: a.reason } : {}),
      });
      continue;
    }
    let buf: Buffer;
    try {
      buf = Buffer.from(a.data, "base64");
    } catch (err) {
      logger.warn(
        { err, name: a.name },
        "Failed to decode python artifact base64",
      );
      artifacts.push({
        name: a.name,
        mimeType: mimeTypeFor(a.name),
        size: a.size,
        skipped: true,
        reason: "decode_error",
      });
      continue;
    }
    artifacts.push({
      name: a.name,
      mimeType: mimeTypeFor(a.name),
      size: buf.byteLength,
      data: buf,
    });
  }

  return { exitCode: parsed.exitCode, artifacts, cleanedStdout };
}
