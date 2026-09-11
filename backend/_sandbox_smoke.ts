/**
 * Sandbox isolation probe. Run from `backend/` with `npx tsx _sandbox_smoke.ts`.
 *
 * 1. Secret probe: a script must not see the backend's API keys or database
 *    settings in its environment. Fails the run if any of them leak.
 * 2. Memory probe: a script that allocates without bound must be stopped, by
 *    the RLIMIT_AS / RLIMIT_DATA cap (Linux: MemoryError, non-zero exit) or,
 *    on platforms that do not honour that rlimit (macOS), by the wall-clock
 *    timeout. Either outcome means the sandbox contained it.
 */
import { runPython } from "./src/python/runner";

const SECRET_KEYS = [
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
  "HUGGINGFACE_API_KEY",
  "MONGODB_URI",
  "MONGODB_DB",
];

async function main(): Promise<void> {
  const secretProbe = await runPython({
    code: [
      "import os",
      `leaked = [k for k in (${SECRET_KEYS.map((k) => `'${k}'`).join(",")}) if k in os.environ]`,
      "print('ENVKEYS=' + ','.join(sorted(os.environ.keys())))",
      "print('LEAKED=' + ','.join(leaked))",
    ].join("\n"),
  });
  console.log("[secret probe] stdout:", JSON.stringify(secretProbe.stdout));
  const leakedLine = secretProbe.stdout.split("\n").find((l) => l.startsWith("LEAKED="));
  if (leakedLine === undefined || leakedLine !== "LEAKED=") {
    throw new Error(`secret probe FAILED: ${leakedLine ?? "no LEAKED line in output"}`);
  }
  console.log("[secret probe] PASS: no backend secret visible to the script");

  const memTimeoutMs = 20_000;
  try {
    const memProbe = await runPython({
      code: [
        "x = bytearray()",
        "while True:",
        "    x += bytearray(50_000_000)",
        "print('SHOULD_NOT_REACH')",
      ].join("\n"),
      timeoutMs: memTimeoutMs,
    });
    if (memProbe.exitCode === 0 || memProbe.stdout.includes("SHOULD_NOT_REACH")) {
      throw new Error("memory probe FAILED: the script ran to completion");
    }
    console.log(
      "[mem probe] PASS: killed by the memory rlimit — exit:",
      memProbe.exitCode,
      "stderr tail:",
      JSON.stringify(memProbe.stderr.slice(-160)),
    );
  } catch (err) {
    if ((err as { code?: string }).code === "timeout") {
      console.log(
        `[mem probe] PASS (timeout): the memory rlimit is not honoured on this platform (expected on macOS); the wall-clock timeout stopped the script after ${memTimeoutMs} ms`,
      );
    } else {
      throw err;
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error("ERR", e);
    process.exit(1);
  });
