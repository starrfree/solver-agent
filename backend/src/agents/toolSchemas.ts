import type { FunctionTool } from "openai/resources/responses/responses";

import { LedgerEntryType } from "../db/types";

/**
 * Strict JSON Schemas for the function tools exposed to the agents.
 *
 * The schemas are deliberately narrow: every property is `required`,
 * `additionalProperties` is `false`, and any free-form text field has a
 * declared purpose. This stops the model from smuggling free-form prose
 * into structured arguments.
 */

const ENTRY_TYPES: LedgerEntryType[] = [
  "assumption",
  "derivation",
  "result",
  "symbolic_computation",
  "numerical_computation",
  "cy_analyst_computation",
  "verification",
  "correction",
  "final_answer",
];

const ENTRY_STATUSES = ["pending", "accepted", "rejected"] as const;

function fn(
  name: string,
  description: string,
  parameters: Record<string, unknown>,
): FunctionTool {
  return {
    type: "function",
    name,
    description,
    parameters,
    strict: true,
  };
}

// --- Main Solver Agent tools ---------------------------------------------

export const ledgerAppendEntryTool: FunctionTool = fn(
  "ledger_append_entry",
  [
    "Append one prose entry to the append-only ledger. Use this every time you commit a meaningful step: stating an assumption, recording a derivation in prose, interpreting a computation via a 'result' entry, writing a correction, or declaring the final-answer candidate.",
    "Do NOT re-create the raw computation output — symbolic_compute and numerical_compute automatically persist their own 'symbolic_computation' / 'numerical_computation' entries. Instead, after each accepted computation you MUST append a 'result' entry that interprets it and lists the computation entry id in dependsOn; the platform blocks every other step until you do. Do NOT use type 'problem_followup' — those entries are appended automatically by the platform from user follow-up messages.",
    "Side effects: creates one new ledger entry visible to verification tools and to the user UI. The new entry id is returned in the tool output so you can reference it from subsequent dependsOn lists.",
  ].join(" "),
  {
    type: "object",
    additionalProperties: false,
    required: ["type", "status", "summary", "details", "dependsOn"],
    properties: {
      type: {
        type: "string",
        enum: ENTRY_TYPES,
        description:
          "Category of the entry. Pick 'assumption' for declared hypotheses, definitions or notation; 'derivation' for prose reasoning steps and plan outlines; 'result' to interpret a symbolic/numerical computation and state how its result fits the proof (must list the computation entry id in dependsOn); 'correction' for entries replacing a superseded one; 'final_answer' for the candidate that will be sent to verify_full_solution.",
      },
      status: {
        type: "string",
        enum: ENTRY_STATUSES,
        description:
          "Use 'accepted' for completed steps you stand behind; 'pending' only if the step is genuinely in progress; 'rejected' only when explicitly recording a known-bad step for traceability.",
      },
      summary: {
        type: "string",
        description: "One-line human-readable summary shown in the step card UI.",
      },
      details: {
        type: "string",
        description:
          "Full Markdown + LaTeX body. Include formulas, justifications, and references to prior entries by id. Be precise — this is what the verification sub-agents read.",
      },
      dependsOn: {
        type: "array",
        items: { type: "string" },
        description:
          "Ids of every prior ledger entry this step actually relies on (assumptions used, derivations built on, computation entries whose results are reused). Empty array only for the very first entries.",
      },
    },
  },
);

export const ledgerSupersedeEntryTool: FunctionTool = fn(
  "ledger_supersede_entry",
  [
    "Mark a previously appended ledger entry as superseded by a newer correction entry. Use this whenever verify_step rejected an entry or when you discover an earlier step was wrong.",
    "Required pairing: first append a new 'correction' entry that references the bad entry id in its dependsOn, then call this tool with both ids.",
    "Side effects: flips the target entry's status to 'superseded' in the ledger. Never edits its content — history is preserved.",
  ].join(" "),
  {
    type: "object",
    additionalProperties: false,
    required: ["entryId", "replacedByEntryId", "reason"],
    properties: {
      entryId: {
        type: "string",
        description: "Id of the entry to mark as superseded.",
      },
      replacedByEntryId: {
        type: "string",
        description:
          "Id of the 'correction' entry that replaces it (must already exist in the ledger).",
      },
      reason: {
        type: "string",
        description:
          "Short explanation of what was wrong with the superseded entry (e.g. 'sign error in step 3', 'assumption x>0 silently strengthened to x>1').",
      },
    },
  },
);

export const symbolicComputeTool: FunctionTool = fn(
  "symbolic_compute",
  [
    "Delegate an exact symbolic computation to the symbolic sub-agent (sympy by default, with a Wolfram Mathematica engine available via wolframscript). Use this for every non-trivial algebra, calculus, simplification, equation solving, dsolve, matrix manipulation, identity check, etc.",
    "The sub-agent is stateless: phrase the task as a fully self-contained natural-language instruction that restates the relevant expressions, variables, assumptions and the exact operation to perform.",
    "Returns the symbolic result, the final Python code that produced it, a status ('success' | 'timeout' | 'error') and any execution diagnostics.",
    "Side effects: persists a 'symbolic_computation' ledger entry with the code and result. Do NOT also call ledger_append_entry for the computation itself.",
  ].join(" "),
  {
    type: "object",
    additionalProperties: false,
    required: ["task", "dependsOn"],
    properties: {
      task: {
        type: "string",
        description:
          "Fully self-contained natural-language instruction. Example: 'Let f(x) = x^3 - 6x^2 + 11x - 6 with x real. Solve f(x) = 0 for x using sympy.solve and return the list of real roots.'",
      },
      dependsOn: {
        type: "array",
        items: { type: "string" },
        description:
          "Ids of ledger entries that supply context for this computation (assumptions reused, prior derivations whose results are inputs).",
      },
    },
  },
);

export const numericalComputeTool: FunctionTool = fn(
  "numerical_compute",
  [
    "Delegate a numerical computation, simulation or visualization to the numerical sub-agent (numpy / scipy / matplotlib, and able to compile & run C++ via subprocess for very heavy computation like combinatorics or large search). Use this for sanity checks, random-substitution identity tests, edge / boundary cases, Monte Carlo estimates, exhaustive/brute-force search, plots, etc. that give insight to you or the user.",
    "The sub-agent is stateless: phrase the task as a fully self-contained natural-language instruction that restates expressions, parameter ranges and the exact operation to perform. Never state the expected result.",
    "Returns the numerical result, the final Python code, a status ('success' | 'timeout' | 'error') and any generated artifacts (plots as PNG, CSVs, etc.).",
    "Side effects: persists a 'numerical_computation' ledger entry with the code, result and attached artifact files.",
  ].join(" "),
  {
    type: "object",
    additionalProperties: false,
    required: ["task", "dependsOn"],
    properties: {
      task: {
        type: "string",
        description:
          "Fully self-contained natural-language instruction. Example: 'Numerically check the identity sin(2x) = 2 sin(x) cos(x) for 500 random x in [-10, 10] and report the maximum absolute residual.'",
      },
      dependsOn: {
        type: "array",
        items: { type: "string" },
        description:
          "Ids of ledger entries that supply context (assumptions reused, prior derivations being checked, computation entries whose values are reused).",
      },
    },
  },
);

export const cyAnalystComputeTool: FunctionTool = fn(
  "cy_analyst_compute",
  [
    "Delegate a Calabi-Yau manifold analysis to the CY Analyst sub-agent, backed by the CYTools package (reflexive polytopes, toric varieties, triangulations, Hodge numbers h11/h21, Euler characteristic, intersection numbers, Mori / Kähler cones, and the Kreuzer-Skarke database). Use this instead of symbolic_compute / numerical_compute for any non-trivial CY / toric-geometry computation.",
    "The sub-agent is stateless: phrase the task as a fully self-contained natural-language instruction that states the polytope / Hodge numbers / divisor basis and the exact quantities to compute. Never state the expected result.",
    "Returns the result, the final Python code that produced it, a status ('success' | 'timeout' | 'error') and any generated artifacts. It degrades gracefully to sympy / numpy when a CYTools feature is unavailable.",
    "Side effects: persists a 'cy_analyst_computation' ledger entry with the code and result. Do NOT also call ledger_append_entry for the computation itself.",
  ].join(" "),
  {
    type: "object",
    additionalProperties: false,
    required: ["task", "dependsOn"],
    properties: {
      task: {
        type: "string",
        description:
          "Fully self-contained natural-language instruction. Example: 'For the reflexive polytope with vertices [[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]], build a fine regular star triangulation, take the anticanonical Calabi-Yau hypersurface, and report h11, h21 and the Euler characteristic.'",
      },
      dependsOn: {
        type: "array",
        items: { type: "string" },
        description:
          "Ids of ledger entries that supply context for this computation (assumptions reused, prior derivations whose results are inputs).",
      },
    },
  },
);

export const seekReferencesTool: FunctionTool = fn(
  "seek_references",
  [
    "Delegate a web lookup to the Reference Seeker sub-agent, which searches the live internet agentically for external knowledge: known theorem statements, definitions, published results, formulas, constants, papers, documentation. It returns either the relevant content with source URLs, or an explicit 'not found'.",
    "Use it when the problem needs external / real-world knowledge you are not certain of. Do NOT use it to solve or verify the mathematics itself — that stays with the compute and verification tools.",
    "The sub-agent is stateless: phrase the task as a fully self-contained natural-language instruction stating exactly what to look for and why.",
    "Side effects: persists a 'reference_lookup' ledger entry with the sourced findings. When a later step relies on the found material, list this entry's id in that step's dependsOn.",
  ].join(" "),
  {
    type: "object",
    additionalProperties: false,
    required: ["task", "dependsOn"],
    properties: {
      task: {
        type: "string",
        description:
          "Fully self-contained natural-language lookup instruction. Example: 'Find the precise statement (and source) of the Bombieri-Vinogradov theorem, including the ranges of the parameters for which it is known to hold.'",
      },
      dependsOn: {
        type: "array",
        items: { type: "string" },
        description:
          "Ids of ledger entries that supply context for this lookup (assumptions or derivations that motivated it).",
      },
    },
  },
);

export const verifyStepTool: FunctionTool = fn(
  "verify_step",
  [
    "Send one critical ledger entry to the adversarial step-verification sub-agent for an independent accept/reject verdict. Use this on any pivotal lemma or identity before building further work on top.",
    "The sub-agent receives the target entry plus the full text of every entry it dependsOn, then re-derives independently and runs numerical / edge-case checks.",
    "Side effects: persists a 'verification' ledger entry that references the checked step and records the verdict, justification and method.",
  ].join(" "),
  {
    type: "object",
    additionalProperties: false,
    required: ["entryId", "focus"],
    properties: {
      entryId: {
        type: "string",
        description: "Id of the ledger entry to verify.",
      },
      focus: {
        type: "string",
        description:
          "Concrete instruction on what aspect to scrutinize most. Example: 'check the boundary case x=0', 'confirm the sign of the integration constant', 'verify the identity holds for complex z'.",
      },
    },
  },
);

export const verifyFullSolutionTool: FunctionTool = fn(
  "verify_full_solution",
  [
    "Run a full audit of the ledger from the problem statement (or the most recent verified final_answer + follow-ups) to the candidate final answer.",
    "Call this exactly once when you believe the problem is solved AND you have appended a 'final_answer' ledger entry containing the candidate.",
    "Returns 'verified' (you may now call submit_final_answer) or 'rejected' with the list of issues you must address with new derivations, computations and corrections before retrying.",
  ].join(" "),
  {
    type: "object",
    additionalProperties: false,
    required: ["candidateAnswer"],
    properties: {
      candidateAnswer: {
        type: "string",
        description:
          "The proposed final answer in user-readable Markdown + LaTeX form (the same text you intend to send via submit_final_answer).",
      },
    },
  },
);

export const fetchArtifactFileTool: FunctionTool = fn(
  "fetch_artifact_file",
  [
    "Load a file previously generated by a computation tool (plot, CSV, JSON, .npy, ...) into your context so you can actually inspect its content.",
    "For image files the picture arrives on the next turn as an input_image content part — you can see it. For other file types the bytes arrive as a base64 string in this tool's output.",
    "Use this whenever a step or its dependencies references a file whose content you need to make a decision (read off a curve, scan a CSV row, inspect an error log).",
    "The tool also returns the stable URL /api/conversations/<conversationId>/files/<fileId> that you can embed in user-facing answers.",
  ].join(" "),
  {
    type: "object",
    additionalProperties: false,
    required: ["fileId", "purpose"],
    properties: {
      fileId: {
        type: "string",
        description:
          "Id of a file returned by an earlier symbolic_compute or numerical_compute call (as listed in that tool's output 'files' array).",
      },
      purpose: {
        type: "string",
        description:
          "One-line reason this file is being fetched. Example: 'inspect the convergence plot to confirm monotonic decrease'.",
      },
    },
  },
);

export const getLedgerEntriesTool: FunctionTool = fn(
  "get_ledger_entries",
  [
    "Retrieve the complete, untruncated content of one or more ledger entries by their ids. The compacted snapshot you are given only shows a one-line summary and truncated details per step; call this to read the full picture of a specific step.",
    "Returns, for each found entry: its full content (summary, details, verdict, justification, finalAnswer), its type/status/tool, the dependsOn graph, and — for computation steps — the attached artifacts: the Python code, captured stdout/stderr (length-capped), and references to any generated files (each with a fileId).",
    "This is read-only: it never creates, edits or runs anything. To actually inspect a generated file (plot, CSV, ...), take a fileId from this tool's output and pass it to fetch_artifact_file.",
  ].join(" "),
  {
    type: "object",
    additionalProperties: false,
    required: ["entryIds", "purpose"],
    properties: {
      entryIds: {
        type: "array",
        items: { type: "string" },
        description:
          "Ids of the ledger entries to retrieve, as shown in brackets (e.g. [entry_...]) in the reasoning-steps snapshot you were given.",
      },
      purpose: {
        type: "string",
        description:
          "One-line reason these entries are being retrieved. Example: 'read the full derivation and code behind step entry_abc to explain it to the user'.",
      },
    },
  },
);

export const submitFinalAnswerTool: FunctionTool = fn(
  "submit_final_answer",
  [
    "Deliver the final, fully verified answer to the user and end the run. Only callable AFTER verify_full_solution has returned 'verified' on the same candidate.",
    "Side effects: posts the answer as the assistant's user-facing message, links it to the final_answer ledger entry, and terminates the agent loop.",
    "Never call this if the latest verify_full_solution verdict was 'rejected' or if you have not yet called verify_full_solution.",
  ].join(" "),
  {
    type: "object",
    additionalProperties: false,
    required: ["answer", "summary", "finalAnswerEntryId"],
    properties: {
      answer: {
        type: "string",
        description:
          "Concise, readable proof of the WORKING solution (the clean successful chain only) in clean Markdown + LaTeX. Include: (1) a brief restatement of the problem with the assumptions / domain / notation in force, (2) the proof in logical order with each contributing step, the method used and a short justification linking it to the previous one — keep computation detail terse (state pivotal results, do NOT paste source code, long stdout or large tables), (3) the final result clearly highlighted (boxed expression or final equation) with units / domain-of-validity / edge-case notes when relevant. Do NOT embed plots, code listings or heavy computation detail — a separate reasoning-process walkthrough is generated automatically from the ledger for that. Exclude every failed attempt, superseded entry, rejected verification and debugging detour. Never inline base64 or dump internal ledger ids or sub-agent jargon.",
      },
      summary: {
        type: "string",
        description:
          "One-sentence plain-text summary stating only the headline result (not the proof), suitable for conversation list previews.",
      },
      finalAnswerEntryId: {
        type: "string",
        description:
          "Id of the ledger entry of type 'final_answer' that this message resolves (the one passed to the verified verify_full_solution call).",
      },
    },
  },
);

// --- Sub-agent tools ------------------------------------------------------

export const runPythonTool: FunctionTool = fn(
  "run_python",
  [
    "Execute a self-contained Python script in an isolated sandbox with sympy / numpy / scipy / matplotlib pre-installed. State does NOT persist across calls — each invocation gets a fresh interpreter.",
    "The working directory is the artifacts directory: any file written with a relative path (open('out.csv', 'w'), fig.savefig('plot.png'), np.save('data.npy', arr)) is captured and returned as an artifact. Never use absolute paths like /mnt/data, /tmp or ~ for outputs you want to keep.",
    "The sandbox can shell out via Python's subprocess module: a C++ toolchain (g++, -O3 -std=c++17) and a licensed Wolfram engine (wolframscript) are on PATH. Compile/run C++ scratch inside a tempfile.mkdtemp() directory so the binary and source are not captured as artifacts.",
    "Matplotlib uses the Agg backend and any open figures are saved as PNG artifacts automatically — you do not need to call plt.savefig yourself.",
    "Returns stdout, stderr, exit status and the list of generated files.",
  ].join(" "),
  {
    type: "object",
    additionalProperties: false,
    required: ["code", "purpose"],
    properties: {
      code: {
        type: "string",
        description:
          "Complete, self-contained Python script. Must print the final result to stdout on the last line in an unambiguous form.",
      },
      purpose: {
        type: "string",
        description:
          "One-line description of what this run is supposed to compute or verify (e.g. 'solve cubic for real roots', 'plot convergence of partial sums').",
      },
    },
  },
);

// --- Step / full verification call out to computation sub-agents ---------

export const subAgentSymbolicTool: FunctionTool = fn(
  "symbolic_compute",
  [
    "Spin up a fresh symbolic sub-agent to perform an independent exact computation for verification purposes.",
    "The sub-agent is stateless and has no access to the ledger — phrase the task as a fully self-contained natural-language instruction restating every relevant expression, variable and assumption.",
    "Returns the symbolic result, the final Python code, a status ('success' | 'timeout' | 'error') and any execution diagnostics.",
  ].join(" "),
  {
    type: "object",
    additionalProperties: false,
    required: ["task"],
    properties: {
      task: {
        type: "string",
        description:
          "Fully self-contained natural-language instruction for the symbolic sub-agent (e.g. 'Independently compute the integral of x*sin(x) from 0 to pi using sympy.integrate and return the simplified result').",
      },
    },
  },
);

export const subAgentNumericalTool: FunctionTool = fn(
  "numerical_compute",
  [
    "Spin up a fresh numerical sub-agent to perform a numerical evaluation, random-substitution check, edge-case probe or plot for verification purposes.",
    "The sub-agent is stateless and has no access to the ledger — phrase the task as a fully self-contained natural-language instruction restating every relevant expression, parameter range and the exact operation to perform. Do not state the expected result.",
    "Returns the numerical result, the final Python code, a status ('success' | 'timeout' | 'error') and any generated artifacts.",
  ].join(" "),
  {
    type: "object",
    additionalProperties: false,
    required: ["task"],
    properties: {
      task: {
        type: "string",
        description:
          "Fully self-contained natural-language instruction for the numerical sub-agent (e.g. 'Sample 1000 random x in (0, 5) and report the maximum residual of |lhs - rhs| for the identity lhs = log(x^2), rhs = 2*log(x)').",
      },
    },
  },
);

export const subAgentCyAnalystTool: FunctionTool = fn(
  "cy_analyst_compute",
  [
    "Spin up a fresh CY Analyst sub-agent (CYTools-backed) to independently compute Calabi-Yau / toric-geometry data for verification purposes.",
    "The sub-agent is stateless and has no access to the ledger — phrase the task as a fully self-contained natural-language instruction restating the polytope / Hodge numbers / basis and the exact quantities to compute. Do not state the expected result.",
    "Returns the result, the final Python code, a status ('success' | 'timeout' | 'error') and any execution diagnostics.",
  ].join(" "),
  {
    type: "object",
    additionalProperties: false,
    required: ["task"],
    properties: {
      task: {
        type: "string",
        description:
          "Fully self-contained natural-language instruction for the CY Analyst sub-agent (e.g. 'Independently recompute h11 and h21 for the anticanonical Calabi-Yau hypersurface of a fine regular star triangulation of the polytope with vertices [...]').",
      },
    },
  },
);

export const subAgentSeekReferencesTool: FunctionTool = fn(
  "seek_references",
  [
    "Spin up a fresh Reference Seeker sub-agent to independently look up external knowledge on the live web (theorem statements, published values, definitions) for verification purposes.",
    "It returns either the relevant content with source URLs, or an explicit 'not found'.",
    "The sub-agent is stateless and has no access to the ledger — phrase the task as a fully self-contained natural-language lookup instruction stating exactly what to find.",
  ].join(" "),
  {
    type: "object",
    additionalProperties: false,
    required: ["task"],
    properties: {
      task: {
        type: "string",
        description:
          "Fully self-contained natural-language lookup instruction for the Reference Seeker sub-agent (e.g. 'Find the published value and source of the best known upper bound for X').",
      },
    },
  },
);

// --- Bundles -------------------------------------------------------------

const baseMainSolverTools: FunctionTool[] = [
  ledgerAppendEntryTool,
  ledgerSupersedeEntryTool,
  symbolicComputeTool,
  numericalComputeTool,
  verifyStepTool,
  verifyFullSolutionTool,
  fetchArtifactFileTool,
  submitFinalAnswerTool,
];

/** Extra tools the solver only receives when the matching flag is enabled. */
export interface ToolFlags {
  cyAnalyst?: boolean;
  referenceSeeker?: boolean;
}

/**
 * Build the Main Solver tool list, conditionally including the opt-in extra
 * tools. The CY Analyst compute tool is only offered when enabled for the
 * conversation so a model can't call a disabled tool. `symbolic_compute` is
 * kept before it so the ordering matches the base pipeline.
 */
export function buildMainSolverTools(flags: ToolFlags = {}): FunctionTool[] {
  const tools = [...baseMainSolverTools];
  if (flags.cyAnalyst) {
    // Insert next to the other compute tools (after numerical_compute).
    const idx = tools.indexOf(numericalComputeTool) + 1;
    tools.splice(idx, 0, cyAnalystComputeTool);
  }
  if (flags.referenceSeeker) {
    // Insert after the compute tools (base or CY-extended), before verify_step.
    const idx = tools.indexOf(verifyStepTool);
    tools.splice(idx, 0, seekReferencesTool);
  }
  return tools;
}

/** Convenience default: the base Main Solver tools with no opt-in extras. */
export const mainSolverTools: FunctionTool[] = buildMainSolverTools();

export const computationSubAgentTools: FunctionTool[] = [runPythonTool];

const baseVerificationSubAgentTools: FunctionTool[] = [
  subAgentSymbolicTool,
  subAgentNumericalTool,
  fetchArtifactFileTool,
];

/**
 * Build the verification sub-agent tool list, conditionally including the CY
 * Analyst compute tool so verifiers can re-check CY results independently when
 * the tool is enabled for the conversation.
 */
export function buildVerificationSubAgentTools(flags: ToolFlags = {}): FunctionTool[] {
  const tools = [...baseVerificationSubAgentTools];
  if (flags.cyAnalyst) {
    const idx = tools.indexOf(subAgentNumericalTool) + 1;
    tools.splice(idx, 0, subAgentCyAnalystTool);
  }
  if (flags.referenceSeeker) {
    // Insert after the compute tools, before fetch_artifact_file.
    const idx = tools.indexOf(fetchArtifactFileTool);
    tools.splice(idx, 0, subAgentSeekReferencesTool);
  }
  return tools;
}

export const verificationSubAgentTools: FunctionTool[] = buildVerificationSubAgentTools();

// The Proof Narrator only inspects artifacts; it has no computation tools so
// it cannot fabricate new results — it can only describe what the ledger holds.
export const proofNarratorTools: FunctionTool[] = [fetchArtifactFileTool];

// Side-talk can read complete ledger entries and load generated files, but has
// no write or computation tools — it can only inspect and explain existing work.
export const sideTalkTools: FunctionTool[] = [
  getLedgerEntriesTool,
  fetchArtifactFileTool,
];

// --- Structured output schemas ------------------------------------------

export const stepVerificationSchema = {
  name: "step_verification_verdict",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["verdict", "justification", "method", "counterExample"],
    properties: {
      verdict: { type: "string", enum: ["accepted", "rejected"] },
      justification: { type: "string" },
      method: {
        type: "string",
        description:
          "Short description of how the verification was carried out (independent re-derivation, numerical substitution, ...).",
      },
      counterExample: {
        type: ["string", "null"],
        description:
          "If rejected, a concrete counter-example or failing case; null when accepted.",
      },
    },
  },
  strict: true,
} as const;

export const fullVerificationSchema = {
  name: "full_verification_verdict",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["verdict", "summary", "issues"],
    properties: {
      verdict: { type: "string", enum: ["verified", "rejected"] },
      summary: { type: "string" },
      issues: {
        type: "array",
        items: {
          type: "object",
          additionalProperties: false,
          required: ["entryId", "problem", "requiredCorrection"],
          properties: {
            entryId: { type: "string" },
            problem: { type: "string" },
            requiredCorrection: { type: "string" },
          },
        },
      },
    },
  },
  strict: true,
} as const;

export const referenceSeekerResultSchema = {
  name: "reference_seeker_result",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["status", "found", "result", "summary", "error"],
    properties: {
      status: {
        type: "string",
        enum: ["success", "error"],
        description:
          "'success' whenever the lookup itself completed — whether or not anything was found. 'error' only for technical failure to search at all.",
      },
      found: {
        type: "boolean",
        description: "Whether the requested material was actually found on the web.",
      },
      result: {
        type: "string",
        description:
          "When found: ALL relevant content, each statement attributed to its source as a Markdown link with the exact URL, quoting verbatim where practical. When not found: an explicit statement that it was not found, listing the queries/angles that were tried.",
      },
      summary: {
        type: "string",
        description:
          "One-line human-readable summary of the lookup outcome (what was sought and whether/where it was found).",
      },
      error: {
        type: ["string", "null"],
        description: "Error message when status is 'error'; null otherwise.",
      },
    },
  },
  strict: true,
} as const;

export const computationSubAgentResultSchema = {
  name: "computation_result",
  schema: {
    type: "object",
    additionalProperties: false,
    required: ["status", "result", "summary", "code", "error"],
    properties: {
      status: {
        type: "string",
        enum: ["success", "timeout", "error"],
      },
      result: {
        type: "string",
        description: "Final result expression / value as a string.",
      },
      summary: {
        type: "string",
        description: "Human-readable summary of what was computed.",
      },
      code: {
        type: "string",
        description: "Final Python script that produced the result.",
      },
      error: {
        type: ["string", "null"],
        description:
          "Error message when status is 'error' or 'timeout'; null on success.",
      },
    },
  },
  strict: true,
} as const;
