# Solver Agent

**An agentic, self-verifying solver for computations in mathematics and physics.**

Solver Agent splits a hard derivation into specialized LLM agents (a coordinating solver, computer-algebra and numerical sub-agents, an optional Calabi-Yau analyst, a literature-search agent and two adversarial verifiers), gives them a sandboxed code environment, and forces every step through an append-only **ledger** that is independently re-examined before an answer is ever returned to you. The result is a proof you can audit, replay, fork and interrogate, rather than what one usually gets out of a chat bot conversation.

To run Solver Agent on your own machine, follow the step-by-step [Installation](#installation) guide, which assumes no prior development experience and covers every tool from Git to MongoDB and the provider API keys.

![Solver Agent architecture: the researcher talks to the Main solver, which delegates to specialized sub-agents (symbolic, numerical, Calabi-Yau analysis, reference lookup) that run code in a sandbox; every step is appended to a persistent ledger which the step and full-solution verification agents review.](diagram.png)

The project is a TypeScript monorepo: an Express + MongoDB backend that orchestrates the agents over the OpenAI Responses API (with Anthropic Claude, Google Gemini and HuggingFace back-ends behind the same facade), and an Angular frontend that streams the ledger to the browser in real time.

## Table of contents

- [What is Solver Agent?](#what-is-solver-agent)
- [How it works](#how-it-works)
  - [The agents](#the-agents)
  - [The ledger](#the-ledger)
  - [Guard rails enforced in code](#guard-rails-enforced-in-code)
  - [Reasoning speed and optional tools](#reasoning-speed-and-optional-tools)
- [Features](#features)
- [Tech stack](#tech-stack)
- [Installation](#installation)
  - [Prerequisites](#prerequisites)
  - [0. Open a terminal](#0-open-a-terminal)
  - [1. Install Git](#1-install-git)
  - [2. Install Node.js](#2-install-nodejs)
  - [3. Install Python](#3-install-python)
  - [4. Set up MongoDB](#4-set-up-mongodb)
  - [5. Get an API key from a language-model provider](#5-get-an-api-key-from-a-language-model-provider)
  - [6. Download Solver Agent and install the backend](#6-download-solver-agent-and-install-the-backend)
  - [7. Create the Python sandbox environment](#7-create-the-python-sandbox-environment)
  - [8. Configure the environment](#8-configure-the-environment)
  - [9. Optional computation engines](#9-optional-computation-engines)
  - [10. Install and run the frontend](#10-install-and-run-the-frontend)
  - [11. Verify the installation](#11-verify-the-installation)
  - [Everyday use, stopping and updating](#everyday-use-stopping-and-updating)
- [Configuration reference](#configuration-reference)
- [Using Solver Agent](#using-solver-agent)
  - [From the web UI](#from-the-web-ui)
  - [Exporting a session](#exporting-a-session)
  - [From the REST API](#from-the-rest-api)
  - [Live event stream (SSE)](#live-event-stream-sse)
- [Navigating the project](#navigating-the-project)
  - [Repository layout](#repository-layout)
  - [Backend walkthrough](#backend-walkthrough)
  - [Frontend walkthrough](#frontend-walkthrough)
  - [Life of a solver run](#life-of-a-solver-run)
- [Adding a sub-agent](#adding-a-sub-agent)
  - [How a sub-agent fits into the pipeline](#how-a-sub-agent-fits-into-the-pipeline)
  - [Files you will touch](#files-you-will-touch)
  - [Worked example: a Graph Theory sub-agent](#worked-example-a-graph-theory-sub-agent)
  - [Frontend wiring](#frontend-wiring)
  - [Sub-agents that do not run Python](#sub-agents-that-do-not-run-python)
  - [Writing the sub-agent prompt](#writing-the-sub-agent-prompt)
  - [With an AI coding agent (Cursor, Claude Code, Codex and others)](#with-an-ai-coding-agent-cursor-claude-code-codex-and-others)
- [Changing model providers and models](#changing-model-providers-and-models)
  - [The three matrices](#the-three-matrices)
  - [Switching a role to another provider or model](#switching-a-role-to-another-provider-or-model)
  - [Adding a new model and its pricing](#adding-a-new-model-and-its-pricing)
  - [Adding a new provider](#adding-a-new-provider)
  - [Provider caveats](#provider-caveats)
- [Tuning the system prompts](#tuning-the-system-prompts)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Limitations and roadmap](#limitations-and-roadmap)
- [Contributing](#contributing)
- [License](#license)



## What is Solver Agent?

Solver Agent is a software system designed to support technically demanding calculations in mathematics and theoretical physics. It organizes the work of a large language model around an explicit, persistent record of the solution process, and it delegates substantive computation to external programs whose inputs and outputs are stored alongside the reasoning that motivated them.

The most familiar mode of use of a language model is conversational: the user poses a question, the model answers in free-form prose, and the exchange continues turn by turn. For a technical calculation this format imposes its own structure. The state of the work resides in the transcript, which mixes digressions, reasoning and corrections; intermediate quantities are produced inside the model's generated text or its inaccessible internal reasoning rather than by dedicated software; and there is no built-in notion of a step that can be individually referenced, revised or re-examined later. One usually has to redo most of the steps in order to trust the answer. Moreover non of the unsuccessful atempts are not present in the model answers.

An agent-based workflow arranges the same underlying capability differently. The model runs inside a loop in which it may repeatedly invoke external programs, exposed to it through a declared calling convention, and observe their results before deciding how to proceed. The state of the work need not reside in the conversation: it is held in an external data structure that the model reads from and writes to through the same mechanism, and that persists and can be inspected at any point. Solver Agent is an implementation of such a system, specialized for mathematical and physical calculations, built on the following principles.

**The solution process is recorded in a ledger.** Every step of the work is appended to a persistent, typed, append-only record stored in MongoDB independently of the conversation. An entry carries a `type` (`assumption`, `derivation`, `result`, `symbolic_computation`, `numerical_computation`, `cy_analyst_computation`, `reference_lookup`, `verification`, `correction`, `final_answer`, `problem_followup`), a `status` (`pending`, `accepted`, `rejected`, `superseded`), a summary, a detailed body, and a `dependsOn` list naming the earlier entries on which it rests. Entries are never edited in place: a defective step is marked `superseded` and its replacement is appended as a `correction` entry that references it, so that unsuccessful attempts remain visible. The ledger is therefore a directed graph in which any conclusion can be traced backward through the results, computations and assumptions that support it.

**Reasoning is separated from computation.** A coordinating agent, the Main solver, decomposes the problem, records its interpretation as `assumption` entries, writes its reasoning as `derivation` entries and proposes an answer. It does not perform substantive computation itself. Algebraic manipulations, numerical evaluations, geometric analyses and literature lookups are handed to specialized sub-agents, each running in a fresh context with its own instructions and tools. The computational sub-agents write and execute code in an isolated sandbox (`sympy` with an optional bridge to the Wolfram engine for the symbolic tool; `numpy`/`scipy`/`matplotlib` with the option of compiling C++ for the numerical tool; [CYTools](https://cy.tools) for the optional Calabi–Yau analysis tool) and return the code, its output and any generated files, which are persisted verbatim in the ledger. The Main solver must then interpret each computation in a `result` entry that lists it in `dependsOn`; the platform blocks every other action until it does.

**Assumptions and ambiguities are made explicit.** Before deriving anything, the Main solver is required to record its reading of the problem, the conventions adopted and the domain in which the results are claimed to hold as `assumption` entries. When the problem statement admits more than one reasonable reading, the choice is written down and later steps that depend on it reference the corresponding entry, so that the consequences of each interpretive choice can be traced through the record and the verifiers can check that no assumption was overlooked or silently strengthened.

**Verification is independent and enforced.** Two review processes operate on the ledger, each carried out by a language model separate from the Main solver, with its own instructions, its own computational tools and access only to the material it is given to review. Step verification examines a single entry together with the full text of its `dependsOn` entries and attempts an independent check, returning `accepted` or `rejected` with a justification and, where found, a counterexample. Full-solution verification receives the entire ledger together with the candidate `final_answer` and works through the dependency graph from the answer back to the problem statement, returning `verified` or `rejected` with an itemized list of the entries concerned and the corrections required. The proposed answer is released to the researcher only after a `verified` verdict, and this gate is enforced by the orchestration code rather than by the prompt alone: `submit_final_answer` is refused unless the most recent full verification returned `verified` and no solution-affecting entry has been appended since.

**The record is observable and reproducible.** The ledger is displayed as a live timeline while the system works and, alternatively, as its dependency graph. Every computation is stored with the exact task submitted, the code executed and the output produced, so that a researcher can identify which assumption or computation supports a conclusion and re-run the relevant code. On request the system composes a self-contained prose account of the solution from the ledger.

Solver Agent should be understood as a methodology for organizing and automating computer-assisted calculations. All of its reasoning components are language models, which can make mistakes; a tool can be invoked with the wrong input, and a well-organized record can document a flawed argument. What the system offers is a framework in which the individual steps of a calculation are explicit, inspectable and repeatable, and in which separate review procedures have something concrete to attach to. This is a stronger standard than a free-form generated answer, but it is not a formal proof: the ledger assigns no formal logical semantics to its entries, and an `accepted` or `verified` verdict is not a machine-checked certificate of truth. Its outputs are subject to the same scrutiny as any other computer-assisted result.

## How it works

The picture at the top of this page is the whole design. You (the *Researcher*) submit a problem and follow-ups to the **Main solver**, a coordinating agent that runs an agentic loop over the Responses API. It has a fixed set of function tools: append to the ledger, supersede an entry, delegate a computation, request a verification, read a generated file, and submit the final answer. Most of those tools do not run code directly: they spin up a *sub-agent*, a fresh, stateless LLM loop with its own prompt and tools, and turn its structured result into a ledger entry.

The **Ledger** is the shared memory. The Main solver reads a compacted snapshot of it at the start of every run and appends to it after every meaningful action. The verification agents read it back to check the work, and the UI streams it to the browser.

Computation sub-agents run their scripts in a **Sandbox**: a one-shot Python subprocess started from `PYTHON_BIN`, with an isolated temporary working directory, memory / CPU / output rlimits, a wall-clock timeout and no access to the backend's secrets. Anything the script writes to its working directory (plots, CSVs, `.npy` arrays) is captured, stored in MongoDB and attached to the ledger entry as an artifact.

### The agents


| Agent                             | Role in the pipeline                                                                                                                                                                                                                                                                     | Tools it can call                                                                                                                                                                                                                         | Source                                                         |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------- |
| **Main solver**                   | Coordinating agent. Interprets the problem, plans, writes prose derivations to the ledger, delegates every computation, requests verification, and submits the final answer. Manual-state Responses loop, so the ledger, the conversation and the model history stay in sync in MongoDB. | `ledger_append_entry`, `ledger_supersede_entry`, `symbolic_compute`, `numerical_compute`, `verify_step`, `verify_full_solution`, `fetch_artifact_file`, `submit_final_answer`, plus `cy_analyst_compute` / `seek_references` when enabled | `backend/src/agents/mainSolverAgent.ts`                        |
| **Symbolic**                      | Exact computer algebra. Writes, runs and debugs Python (sympy by default) and can shell out to `wolframscript` for hard closed forms. Returns a structured `{status, result, code, error}` verdict.                                                                                      | `run_python`                                                                                                                                                                                                                              | `agents/symbolicAgent.ts`                                      |
| **Numerical**                     | Evaluation, simulation, random-substitution identity checks, Monte Carlo, brute-force search and plots (numpy / scipy / matplotlib). Can compile and run C++(`g++ -O3`) for heavy combinatorics and gets a larger timeout budget.                                                        | `run_python`                                                                                                                                                                                                                              | `agents/numericalAgent.ts`                                     |
| **Calabi-Yau Analyst** *(opt-in)* | Toric / Calabi-Yau geometry on top of [CYTools](https://cy.tools): reflexive polytopes, triangulations, Hodge numbers, intersection numbers, Mori / Kähler cones, Kreuzer-Skarke lookups. Degrades to sympy / numpy when a CYTools feature is missing.                                   | `run_python`                                                                                                                                                                                                                              | `agents/cyAnalystAgent.ts`                                     |
| **Reference Seeker** *(opt-in)*   | Literature and documentation search on the live web via OpenAI's hosted `web_search`. Reports findings with source URLs or an explicit "not found"; never invents references and never does mathematics.                                                                                 | hosted `web_search`                                                                                                                                                                                                                       | `agents/referenceSeekerAgent.ts`                               |
| **Step verification**             | Adversarial reviewer of one ledger entry and its dependencies. Re-derives independently, probes edge cases and random substitutions, returns `accepted` / `rejected` with a justification and any counter-example.                                                                       | `symbolic_compute`, `numerical_compute`, `fetch_artifact_file` (+ `cy_analyst_compute`, `seek_references` when enabled)                                                                                                                   | `agents/stepVerificationAgent.ts`                              |
| **Full-solution verification**    | Audits the entire ledger from the problem statement to the candidate answer, following the `dependsOn` graph. Returns `verified` or `rejected` with a list of `{entryId, problem, requiredCorrection}` issues the solver must address.                                                   | same as step verification                                                                                                                                                                                                                 | `agents/fullVerificationAgent.ts`                              |
| **Proof narrator**                | Generated on demand once a problem is solved: writes a readable walkthrough of the *successful* reasoning chain from the ledger. Read-only, no computation tools, so it cannot invent new results.                                                                                       | `fetch_artifact_file`                                                                                                                                                                                                                     | `agents/proofNarratorAgent.ts`, `services/narrativeService.ts` |
| **Side-talk**                     | Answers your questions about the ongoing work without touching the ledger or the solver. Can pull full ledger entries and generated files into context, and optionally use web search. Stored in its own collection so it never leaks into the solver's input.                           | `get_ledger_entries`, `fetch_artifact_file`, optional hosted `web_search`                                                                                                                                                                 | `agents/sideTalkAgent.ts`                                      |


Every sub-agent is **stateless**: the Main solver must phrase each task as a self-contained natural-language instruction (the relevant expressions, assumptions and the exact operation), and the sub-agent has no access to the ledger beyond the context passed to it from the entries listed in `dependsOn`. This keeps the sub-agents from inheriting the solver's biases and makes verification genuinely independent.

All agent loops go through one provider-agnostic facade, `backend/src/agents/llmClient.ts`, which resolves the `(reasoningSpeed, reasoningRole)` pair to a provider / model / effort triple and dispatches to the OpenAI, Claude, Gemini or HuggingFace client (see [Changing model providers and models](#changing-model-providers-and-models)).

### The ledger

The ledger is a MongoDB collection of append-only entries attached to one conversation. Each entry carries:


| Field            | Meaning                                                                                                                                                                                               |
| ---------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `type`           | `assumption`, `derivation`, `result`, `symbolic_computation`, `numerical_computation`, `cy_analyst_computation`, `reference_lookup`, `verification`, `correction`, `final_answer`, `problem_followup` |
| `status`         | `pending`, `accepted`, `rejected`, or `superseded`                                                                                                                                                    |
| `dependsOn`      | ids of the earlier entries this step relies on; this is the edge set of the proof graph                                                                                                               |
| `content`        | `summary` (one line, shown on step cards), `details` (Markdown + LaTeX body), and for verification / final-answer entries `verdict`, `justification`, `finalAnswer`                                   |
| `tool`           | who produced it: `main_solver`, `symbolic`, `numerical`, `cy_analyst`, `reference_seeker`, `step_verification`, `full_verification`, `ledger`, `user`                                                 |
| `artifacts`      | generated `code`, captured `stdout` / `stderr`, `durationMs`, references to generated `files`, and the provider response ids that produced the entry                                                  |
| `reasoningSpeed` | the speed setting in force when the entry was produced (display only, never fed back to the model)                                                                                                    |


Rules the platform enforces:

- Entries are never edited in place. The only allowed mutation is flipping `status` to `superseded` through `ledger_supersede_entry`, which requires a `correction` entry that references the bad one. The mutation is itself broadcast as a `ledger.entry.updated` event.
- Computation tools (`symbolic_compute`, `numerical_compute`, `cy_analyst_compute`, `seek_references`) persist their own entries automatically, including the final code, output and files. The solver is told not to duplicate them.
- Files produced by the sandbox live in a separate `generatedFiles` collection and are served at `/api/conversations/:id/files/:fileId`, so the ledger stays small and the browser (and the model, via `fetch_artifact_file`) can load them on demand.
- User follow-up messages are appended as `problem_followup` entries by the platform, so the verifiers can see when the problem changed.

The full data model lives in `backend/src/db/types.ts`.

### Guard rails enforced in code

Prompts ask nicely; the agent loop in `mainSolverAgent.ts` makes sure. Three invariants are enforced in code, so a model cannot talk its way around them:

1. **Every computation must be interpreted.** After a successful `symbolic_compute` / `numerical_compute` / `cy_analyst_compute`, the loop blocks every tool call except `fetch_artifact_file` and a `ledger_append_entry` of type `result` whose `dependsOn` lists the computation. A raw number can never silently become part of the proof without the solver writing down what it means.
2. **No answer without a fresh full verification.** `submit_final_answer` is rejected unless the most recent `verify_full_solution` returned `verified` *and* nothing solution-affecting (new computation, append, supersede, or a rejected step verification) happened since. The gate is re-seeded from the persisted ledger on resume, so pausing and restarting cannot bypass it.
3. **Tool errors are data, not exceptions.** Python tracebacks, timeouts, provider rate limits and malformed arguments are returned to the model as the tool's output, so it can recover, retry a different approach or escalate (for example, switching from a timing-out symbolic integration to a numerical check). Only a user-initiated pause aborts a run.

Additional protections: strict JSON-schema tool definitions (`additionalProperties: false`, every field required), per-run and per-sub-agent turn budgets (`AGENT_MAX_TURNS`, `SUB_AGENT_MAX_TURNS`), a timeout budget after which a sub-agent must return `status: "timeout"`, and a sandbox that scrubs the environment so scripts cannot read your API keys (`backend/_sandbox_smoke.ts` probes exactly that).

### Reasoning speed and optional tools

Each conversation carries two knobs that you set when creating it and can change on any follow-up:

- **Reasoning speed**, `high` (default) or `fast`. It is a single user-facing switch that selects a whole column in the provider / model / effort matrices: `high` runs everything on the strongest configured models, `fast` uses cheaper, lower-latency models and halves the Python wall-clock timeout. The mapping is entirely yours to define in `backend/src/agents/llmClient.ts`.
- **Additional tools**: the **Calabi-Yau Analyst** and the **Reference Seeker** are opt-in per conversation. When a flag is on, the corresponding function tool is added to the Main solver's and the verifiers' tool lists and a short note is appended to the solver's system prompt explaining when to reach for it. When it is off, the model cannot even see the tool, so it cannot call a disabled capability.

Both settings are stored on the conversation document and honoured when a run is resumed or forked.

## Features

- **Live solving session.** Ledger entries and messages stream to the browser over Server-Sent Events as they are written; an activity strip shows which agents are working right now. The stream reconnects with exponential backoff and re-hydrates the current agent activity on connect.
- **Three-pane workspace.** Conversations sidebar (with status pills, archive and delete), the solving timeline in the centre (chat messages interleaved with collapsible step cards), and an artifacts panel on the right with tabs for the entry content, generated code, stdout / stderr, plots, downloadable files and the pinned final answer. Panes are resizable.
- **Proof graph.** A dependency-graph view of the ledger (`dependsOn` edges laid out with ELK in a web worker), colour-coded by entry type, with the selected step highlighted and one-click access to its artifacts.
- **Solution walkthrough.** Once a problem is solved you can generate a Proof Narrator write-up of the successful chain, rendered with Markdown, KaTeX and syntax-highlighted code.
- **Side-talk.** Ask the model questions about the current work in a separate panel. It can load full ledger entries and generated files into context (each one is flagged in the answer so you can jump to it) and optionally use web search, and nothing it says reaches the solver.
- **Pause, resume, follow up.** Interrupt a run mid-turn (in-flight model calls are aborted), resume from the existing ledger, or send a follow-up message that re-activates the solver with new context. Runs interrupted by a server restart are detected on boot and parked in `paused` so nothing is lost.
- **Fork.** Branch a conversation from any message or ledger entry into a new conversation that copies the ledger up to that point, so you can explore an alternative without losing the original.
- **Shareable export.** One click downloads a zip with the complete record of a session: an offline HTML page of the conversation as the app shows it and a LaTeX source (header with models, enabled tools and system-prompt hashes; the prompts in order; every ledger entry with its code, output, figures and verdicts, rejected and superseded steps included), plus `ledger.json`, the generated artifacts and the code of every computation. Rendered from the database with no model call, so anyone can publish or audit exactly what happened. See [Exporting a session](#exporting-a-session).
- **Usage and cost tracking.** Every model call is recorded with token counts (cached input and reasoning tokens included) and priced from a per-model table; a live meter shows the running cost per conversation, with a per-role breakdown.
- **Sandboxed computation** with sympy, numpy, scipy, matplotlib, optional C++ and Wolfram engines, and optional CYTools. Figures are captured automatically.
- **Light / dark theme**, drafts preserved per conversation, Markdown + LaTeX everywhere, sanitized with DOMPurify.



## Tech stack


| Layer                  | Technology                                                                                                                                                        |
| ---------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Backend runtime        | Node.js ≥ 20, TypeScript 5, Express 5, `tsx` for dev / `tsc` for builds                                                                                           |
| Persistence            | MongoDB 7 driver (conversations, messages, ledgers, ledger entries, generated files, side-talk, usage records)                                                    |
| LLM providers          | OpenAI Responses API (`openai` SDK), Anthropic Messages API (`@anthropic-ai/sdk`), Google Gemini API (`@google/genai`), HuggingFace Inference Router (OpenAI Chat Completions dialect) |
| Validation and logging | `zod` for env and request schemas, `pino` / `pino-http` structured logs                                                                                           |
| Session export         | `marked` (Markdown lexer / renderer), `katex` and `prismjs` (server-side math and code rendering for `report.html`), `archiver` (zip streaming)                     |
| Sandbox                | One-shot Python ≥ 3.11 subprocess (`child_process.spawn`, POSIX rlimits) with `sympy`, `numpy`, `scipy`, `matplotlib`; optional `g++`, `wolframscript`, `cytools` |
| Frontend               | Angular 21 (standalone components, signals, new control flow), SCSS with CSS variable tokens, Lucide icons                                                        |
| Rendering              | `marked` (Markdown), `katex` (math), `prismjs` (code), `dompurify` (sanitization), `elkjs` (graph layout)                                                         |
| Real-time              | Server-Sent Events via native `EventSource`, proxied through the Angular dev server                                                                               |




## Installation

This section assumes nothing: no prior experience with web development, no tools installed. If you already have Git, Node.js, Python and MongoDB on your machine, skip to [step 6](#6-download-solver-agent-and-install-the-backend); the table in [Prerequisites](#prerequisites) lists exactly what the later steps expect.

Solver Agent is made of two programs that you run side by side on your own computer:

- the **backend**, a server written in TypeScript that talks to the language-model providers, runs the Python sandbox and stores everything in a MongoDB database;
- the **frontend**, the web page you open in your browser to submit problems and read the ledger.

Nothing is installed system-wide by the project itself; everything lives inside the `solver-agent` folder you will download, apart from the tools listed below. Budget about an hour for a first installation, most of it waiting for downloads.

**Which operating system?** The instructions cover **macOS**, **Linux** (Ubuntu / Debian; other distributions differ only in the package manager) and **Windows**. On Windows, the recommended route is to install *Windows Subsystem for Linux* (WSL) and then follow the Linux instructions inside it: the sandbox's resource limits only work on Unix-like systems, and every command in this README then works unchanged. Native Windows also works (Node, Python and MongoDB all run there) but the sandbox will run without memory / CPU caps; notes for that route are given where the commands differ.

### Prerequisites

You will install five things, each explained in its own step below:


| Tool                                          | Why Solver Agent needs it                                                                                                                             | Step |
| --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---- |
| A terminal                                    | Every step below is a command you type.                                                                                                               | 0    |
| **Git**                                       | Downloads the source code (and later updates).                                                                                                        | 1    |
| **Node.js** (version 20 or newer) and **npm** | Runs the backend and builds the frontend. npm comes with Node. Angular is installed automatically by npm in step 10; no separate install.             | 2    |
| **Python** (version 3.11 or newer)            | The isolated environment in which the agents execute their sympy / numpy code.                                                                        | 3    |
| **MongoDB**                                   | The database that holds conversations, ledgers and generated files. Either a free cloud database (recommended for a first install) or a local server. | 4    |
| An **API key** from a language-model provider | The agents are language models hosted by OpenAI (default), Anthropic, Google or HuggingFace; the key lets the backend call them, billed to your account. | 5    |


Optional extras (a C++ compiler, the Wolfram Engine, CYTools) are covered in [step 9](#9-optional-computation-engines) and can be added at any later time.

### 0. Open a terminal

All commands in this guide are typed into a terminal, one line at a time, followed by Enter. Lines starting with `#` are comments and can be skipped.

- **macOS**: open *Terminal* (Applications → Utilities → Terminal, or press Cmd + Space and type `Terminal`).
- **Linux**: press Ctrl + Alt + T, or search for *Terminal* in your applications.
- **Windows (recommended, WSL)**: open *PowerShell* as administrator, run `wsl --install`, restart when asked, then open the *Ubuntu* app from the Start menu. It asks you to choose a Linux username and password the first time. From now on, use that Ubuntu window as your terminal and follow the **Linux** instructions. Your Windows files are reachable under `/mnt/c/...`, but keep the project inside the Linux home folder (`~`) for speed.
- **Windows (native)**: open *PowerShell* from the Start menu and follow the notes marked *native Windows*.

Two things to know: `cd some/folder` moves into a folder (`cd ..` goes up one level, `pwd` prints where you are), and **Ctrl + C** stops a program that is running in the terminal. You will need several terminal windows or tabs open at once later; on macOS Cmd + T opens a new tab, on Linux Ctrl + Shift + T, in the Windows Terminal app Ctrl + Shift + T as well.

### 1. Install Git

Git is the tool that downloads the repository and lets you update it later.

- **macOS**: run `git --version`. If Git is missing, macOS offers to install the *Command Line Tools*; accept and wait for it to finish (this also installs the C++ compiler used in step 9). Alternatively install [Homebrew](https://brew.sh) first (one command shown on its home page) and run `brew install git`.
- **Linux**: `sudo apt update && sudo apt install -y git`
- **Windows (native)**: download and run the installer from [git-scm.com/downloads](https://git-scm.com/downloads), keeping the default options.

Check: `git --version` prints something like `git version 2.4x`.

### 2. Install Node.js

Solver Agent needs Node.js **20 or newer**; the current *LTS* release is the right choice. The simplest reliable way on macOS and Linux is **nvm** (Node Version Manager), which installs Node in your home folder without administrator rights and lets you switch versions later.

**macOS / Linux (nvm):**

```bash
# Install nvm (check https://github.com/nvm-sh/nvm for the latest version number in the URL)
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash

# Close and reopen the terminal, then:
nvm install --lts
nvm use --lts
```

If after reopening the terminal `nvm` is "command not found", run `source ~/.nvm/nvm.sh` once, or follow the note the installer printed about adding lines to your shell profile (`~/.zshrc` on macOS, `~/.bashrc` on Linux).

**macOS (alternative):** `brew install node`.

**Windows (native):** download the *LTS* installer from [nodejs.org](https://nodejs.org) and run it with the default options (leave "Add to PATH" ticked). Close and reopen PowerShell afterwards.

Check:

```bash
node --version    # v22.x or newer (anything >= v20 works)
npm --version     # 10.x or newer
```

You do **not** need to install the Angular CLI globally. It is listed as a development dependency of the frontend and is installed into the project folder by `npm install` in step 10.

### 3. Install Python

The agents execute their code with a Python interpreter that you control. Solver Agent needs **Python 3.11 or newer**.

- **macOS**: `python3 --version`. macOS ships a `python3`, but it is often old and cannot create virtual environments cleanly. Install a current version with `brew install python@3.12`, or download the macOS installer from [python.org/downloads](https://www.python.org/downloads/) and run it.
- **Linux**: `sudo apt install -y python3 python3-venv python3-pip`. On Ubuntu 22.04 the default is 3.10, which is too old; install `python3.12 python3.12-venv` (available on 24.04 and via the `deadsnakes` PPA on 22.04) and use `python3.12` in place of `python3` in step 7.
- **Windows (native)**: download the installer from [python.org/downloads](https://www.python.org/downloads/). On the first screen **tick "Add python.exe to PATH"** before clicking Install. Use `python` instead of `python3` in the commands below.

Check: `python3 --version` prints `Python 3.11` or higher.

### 4. Set up MongoDB

MongoDB is the database. You need a **connection string** (an address the backend uses to reach the database) and a **database name**. There are two ways to get one; pick the first if you have never run a database before.

#### Option A: MongoDB Atlas (free cloud database, recommended for a first install)

Atlas is MongoDB's hosted service. The free tier ("M0") is more than enough for personal use and requires no installation.

1. Create an account at [mongodb.com/cloud/atlas/register](https://www.mongodb.com/cloud/atlas/register) (email or Google sign-in).
2. When asked to deploy a cluster, choose the **Free** (M0) option, pick a provider and a region close to you, keep the default name (`Cluster0`) and click *Create Deployment*. Provisioning takes a couple of minutes.
3. Atlas then shows a **security quickstart**:
  - **Create a database user.** Choose *Username and Password*. Pick a username (for example `solver`) and click *Autogenerate Secure Password*, then **copy the password somewhere safe**; you will need it in step 8. Avoid passwords with `@`, `:`, `/` or `%` characters, which would need to be escaped in the connection string. Click *Create Database User*.
  - **Network access.** Click *Add My Current IP Address*. If your IP address changes often (laptop on different networks), you can instead go to *Network Access* in the left menu, *Add IP Address*, and enter `0.0.0.0/0` ("allow access from anywhere"). The database is still protected by the username and password, but do restrict this again if you later host the backend on a fixed server.
4. Get the connection string: click **Connect** on your cluster, choose **Drivers**, select *Node.js*, and copy the string that looks like
  ```text
   mongodb+srv://solver:<db_password>@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0
  ```
   Replace `<db_password>` (including the angle brackets) with the password you saved. This is your `MONGODB_URI`.
5. The database name is up to you; use `solver-agent`. That is your `MONGODB_DB`. Atlas creates the database and its collections automatically the first time the backend writes to it; there is nothing to create by hand.



#### Option B: MongoDB running on your own computer

Use this if you prefer not to depend on a cloud service or want to work offline.

**macOS (Homebrew):**

```bash
brew tap mongodb/brew
brew install mongodb-community
brew services start mongodb-community     # starts now and on every login
```

**Linux (Ubuntu / Debian):** MongoDB is not in the default Ubuntu repositories. Follow the four commands in the official guide for your Ubuntu version at [mongodb.com/docs/manual/tutorial/install-mongodb-on-ubuntu](https://www.mongodb.com/docs/manual/tutorial/install-mongodb-on-ubuntu/) (they add MongoDB's package repository, then `sudo apt install -y mongodb-org`), then:

```bash
sudo systemctl enable --now mongod
```

Inside WSL, `systemctl` may not be available; start the server manually with `sudo mongod --dbpath /var/lib/mongodb --fork --logpath /var/log/mongodb/mongod.log` each time you reboot, or enable systemd in WSL (`/etc/wsl.conf`, `[boot] systemd=true`).

**Windows (native):** download the *MongoDB Community Server* MSI from [mongodb.com/try/download/community](https://www.mongodb.com/try/download/community) and run it, choosing *Complete* and leaving *Install MongoDB as a Service* ticked. It starts automatically.

**Any OS, with Docker:** if you already have [Docker Desktop](https://www.docker.com/products/docker-desktop/) installed,

```bash
docker run -d --name solver-mongo -p 27017:27017 -v solver-mongo-data:/data/db mongo:7
```

starts a MongoDB that survives restarts of the container (`docker start solver-mongo` after a reboot).

For all local options the connection string is `mongodb://localhost:27017` and you can again use `solver-agent` as the database name. Check that the server is running with `mongosh --eval "db.runCommand({ ping: 1 })"` if you installed the shell, or simply proceed: the backend prints a clear connection error at startup if the database is unreachable.

### 5. Get an API key from a language-model provider

The agents are large language models hosted by a provider; the backend calls them through the provider's API and the provider bills your account per token. You need at least one key. **The default configuration uses OpenAI for every agent**, so start with an OpenAI key; you can add the others later (see [Changing model providers and models](#changing-model-providers-and-models)).

An API key is a long secret string. Treat it like a password: never paste it into a chat, a screenshot or a public repository. The backend reads it from a local file (`.env`, step 8) that Git is configured to ignore.

**OpenAI (required with the default configuration):**

1. Create an account at [platform.openai.com](https://platform.openai.com/) (this is the developer platform; a ChatGPT subscription does not include API access).
2. Add a payment method or prepaid credits under *Settings → Billing*. New accounts have no credit by default and calls fail with a "quota exceeded" error until you do. It is a good idea to set a **monthly budget limit** on the same page.
3. Go to *API keys* ([platform.openai.com/api-keys](https://platform.openai.com/api-keys)), click *Create new secret key*, give it a name such as `solver-agent`, and copy the key (it starts with `sk-`). It is shown only once; if you lose it, create a new one.
4. Some newer models are only available to accounts that have completed *organization verification* under *Settings → Organization*. If the backend later reports that a model does not exist or is not available to you, complete the verification or switch that role to another model as described in [Changing model providers and models](#changing-model-providers-and-models).

**Anthropic (optional):** create an account at [console.anthropic.com](https://console.anthropic.com/), add credits under *Plans & Billing*, then create a key under *API Keys*. Keys start with `sk-ant-`.

**Google Gemini (optional):** open [Google AI Studio](https://aistudio.google.com/), sign in with a Google account, click *Get API key* and create a key in a Google Cloud project. Free-tier keys work for trying the app but have low rate limits and are not available for the Pro models; enable billing on the project (*Set up billing* in the API-keys page) for the paid tier. Keys start with `AIza`.

**HuggingFace (optional, for open-weight models through the Inference Router):** create an account at [huggingface.co](https://huggingface.co/), go to *Settings → Access Tokens* ([huggingface.co/settings/tokens](https://huggingface.co/settings/tokens)), create a token with *Make calls to Inference Providers* permission, and add a payment method under *Settings → Billing*. Tokens start with `hf_`.

**What does it cost?** Every model call is priced in the usage meter inside the app. With the default `high` configuration, a short textbook-style problem typically costs a few tens of cents; a long research-level derivation with many verification passes can reach several dollars. `fast` mode is several times cheaper. Set a budget limit at the provider and watch the meter during your first runs.

### 6. Download Solver Agent and install the backend

Choose a folder to keep the project in (your home folder is fine) and download the code with Git:

```bash
cd ~
git clone <this-repository-url> solver-agent
cd solver-agent
```

Replace `<this-repository-url>` with the URL shown by the green *Code* button on the repository page (it ends in `.git`). You now have a `solver-agent` folder with `backend/` and `frontend/` inside.

Install the backend's dependencies:

```bash
cd backend
npm install
```

This downloads the libraries listed in `backend/package.json` into `backend/node_modules/` (a few hundred megabytes; it takes a minute or two). Warnings about deprecated packages or "funding" are normal. An error that mentions `EACCES` or permissions means npm is trying to write somewhere it should not; the nvm-based installation from step 2 avoids this.

### 7. Create the Python sandbox environment

The symbolic and numerical agents run their scripts with whatever Python interpreter you point the backend at. Keeping that interpreter in a dedicated *virtual environment* (a private copy of Python with its own packages) means the sandbox contains exactly the libraries you expect, and nothing you install later on your system can break it.

Still inside `backend/`:

```bash
python3 -m venv python/.venv
python/.venv/bin/pip install --upgrade pip
python/.venv/bin/pip install sympy numpy scipy matplotlib
```

*Native Windows (PowerShell):*

```powershell
python -m venv python\.venv
python\.venv\Scripts\python.exe -m pip install --upgrade pip
python\.venv\Scripts\python.exe -m pip install sympy numpy scipy matplotlib
```

You do not need to "activate" the environment; the backend calls the interpreter by its full path. Print that path now and keep it for the next step:

```bash
echo "$(pwd)/python/.venv/bin/python"          # macOS / Linux
# native Windows: (Get-Location).Path + "\python\.venv\Scripts\python.exe"
```

Check that the libraries import correctly:

```bash
python/.venv/bin/python -c "import sympy, numpy, scipy, matplotlib; print('sandbox ok')"
```

`backend/python/requirements.txt` lists the same four libraries plus `cytools`, which is only needed for the optional Calabi–Yau Analyst and is best installed the conda way described in step 9. If you do not need it, the four libraries above are all you need.

### 8. Configure the environment

The backend reads its settings from a file named `.env` in the `backend/` folder. The leading dot makes it a *hidden* file: file browsers do not show it by default, and Git is configured never to upload it, which is what keeps your API key private.

Create it with a terminal editor (still inside `backend/`):

```bash
nano .env
```

Paste the following, then edit the values marked *change me*. In `nano`, save with Ctrl + O then Enter, and quit with Ctrl + X. (You can equally create the file in any code editor such as VS Code or Cursor: *File → New File*, save it as `.env` inside `backend/`.)

```dotenv
# --- required ---------------------------------------------------------------
# change me: the connection string from step 4 (Atlas or local).
MONGODB_URI=mongodb+srv://solver:YOUR_PASSWORD@cluster0.xxxxx.mongodb.net/?retryWrites=true&w=majority&appName=Cluster0
# For a local MongoDB use instead:
# MONGODB_URI=mongodb://localhost:27017
MONGODB_DB=solver-agent

# change me: at least one provider key from step 5. The default configuration
# uses OpenAI for every agent, so OPENAI_API_KEY is required unless you edit
# backend/src/agents/llmClient.ts.
OPENAI_API_KEY=sk-...
# ANTHROPIC_API_KEY=sk-ant-...
# HUGGINGFACE_API_KEY=hf_...
# GEMINI_API_KEY=AIza...

# --- sandbox ----------------------------------------------------------------
# change me: the absolute path printed at the end of step 7.
PYTHON_BIN=/Users/you/solver-agent/backend/python/.venv/bin/python

# --- server -----------------------------------------------------------------
PORT=3000
LOG_LEVEL=info
CORS_ORIGIN=http://localhost:4200
```

Notes:

- No spaces around `=`, no quotes needed, one setting per line. Lines starting with `#` are ignored.
- `PYTHON_BIN` must be an **absolute** path (starting with `/`, or `C:\` on native Windows), not `python/.venv/bin/python`.
- The file is validated when the backend starts (`backend/src/config/env.ts`). If a required value is missing or malformed the server prints the offending names and stops, so a typo is caught immediately rather than mid-run.
- Every other setting (timeouts, memory caps, turn budgets, pricing overrides) has a sensible default and is documented in the [Configuration reference](#configuration-reference). You do not need any of them for a first run.



### 9. Optional computation engines

All of these are optional and can be added later. When an engine is absent the sub-agents fall back to pure Python, so nothing fails; they simply have fewer options for very heavy or very hard computations.

**C++ compiler** (used by the numerical sub-agent for brute-force searches and heavy combinatorics). Any `g++` supporting `-O3 -std=c++17` on the `PATH` will do.

- macOS: `xcode-select --install` (already done if you installed Git the Apple way in step 1).
- Linux: `sudo apt install -y build-essential`
- Native Windows: install *MSYS2* or *Visual Studio Build Tools* and make sure `g++` is on the `PATH`; or use WSL.

Check: `g++ --version`.

**Wolfram Engine** (used by the symbolic sub-agent for hard closed-form integrals, `FullSimplify`, special functions and `Reduce` / `Solve` over the reals). Download the free [Wolfram Engine for Developers](https://www.wolfram.com/engine/) (a free Wolfram account is required), install it, activate it once with `wolframscript -activate` (enter your Wolfram ID), and check that `wolframscript -code '1+1'` prints `2`. The sandbox calls `wolframscript` through `subprocess`, so it must be on the `PATH` seen by the terminal you start the backend from.

**CYTools** (required only for the Calabi–Yau Analyst). CYTools ships native solvers that are easiest to obtain through **conda**, a package manager for scientific Python. If you do not have it, install [Miniforge](https://github.com/conda-forge/miniforge) (a small conda distribution; download the installer for your OS and run it, answering *yes* to initializing your shell, then reopen the terminal). Then create one conda environment that contains both CYTools and the base sandbox libraries, and point `PYTHON_BIN` at it *instead of* the venv from step 7:

```bash
conda create -y -n cytools -c conda-forge python=3.11 \
  palp normaliz cgal numpy scipy sympy matplotlib
conda run -n cytools pip install "cytools>=1.4"

# Smoke test: the quintic should give h11=1, h21=101, chi=-200
conda run -n cytools python -c "from cytools import Polytope; \
p=Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]]); \
cy=p.triangulate().get_cy(); print(cy.h11(), cy.h21(), cy.chi())"

# Print the interpreter path and put it in backend/.env as PYTHON_BIN:
conda run -n cytools which python
```

CYTools caches to `~/Library/Caches/CYTools` on macOS or `$XDG_CACHE_HOME` (usually `~/.cache`) on Linux; the sandbox process must be allowed to write there. The license-gated MOSEK solver is not used. `backend/docs/cytools-documentation.md` contains an offline copy of the CYTools API reference that the CY Analyst prompt was written against.

### 10. Install and run the frontend

Open a **second terminal window or tab** (keep the first one for the backend), go to the frontend folder and install its dependencies. This is where Angular gets installed, locally to the project:

```bash
cd ~/solver-agent/frontend
npm install
```

Then start the development web server:

```bash
npm start
```

After some seconds it prints `Local: http://localhost:4200/` and stays running; that is normal, it is serving the page. Leave this terminal open. The dev server forwards every request to `/api/...` to the backend on port 3000 (configured in `frontend/proxy.conf.json`), so no further setup is needed.

Now start the backend in your **first** terminal:

```bash
cd ~/solver-agent/backend
npm run dev
```

You should see log lines ending with something like `Server listening` together with `"port":3000`. This terminal also stays open; it prints one line per request and per agent action while you use the app. `npm run dev` restarts automatically whenever a source file changes, which matters when you edit prompts or model settings later.

If instead you see `Invalid environment configuration`, a `.env` value is missing or malformed; the message names it. If you see a MongoDB connection error (`MongoServerSelectionError`, `authentication failed`), re-check `MONGODB_URI`: the password, and, on Atlas, that your IP address is allowed under *Network Access*.

Open **[http://localhost:4200](http://localhost:4200)** in your browser. You should see the Solver Agent interface with an empty conversation list.

For a production deployment you would instead run `npm run build` in `frontend/` (static files land in `frontend/dist/`) and `npm run build && npm start` in `backend/`, and put both behind a web server that forwards `/api` to the backend without buffering (on nginx: `proxy_buffering off;` for that location, since the live stream uses Server-Sent Events). That is not needed to use the tool on your own machine.

### 11. Verify the installation

With both servers running, open a **third** terminal and run the checks:

```bash
# 1. Backend liveness
curl http://localhost:3000/api/health
# -> {"status":"ok","uptime":...}

# 2. Sandbox: the interpreter runs, scripts cannot see your API keys,
#    and a runaway allocation is stopped (by the memory rlimit on Linux,
#    by the wall-clock timeout on macOS, which ignores that rlimit)
cd ~/solver-agent/backend
npx tsx _sandbox_smoke.ts
# -> "[secret probe] PASS" and "[mem probe] PASS"; takes ~20 s on macOS

# 3. Unit tests: provider clients, computation guard, sub-agent loops,
#    session export. Mock-based; they make no network calls and need no API key.
npm test
```

Finally, in the browser, click the **+** button in the sidebar, paste a small problem such as

> Find all real solutions to $x^3 - 6x^2 + 11x - 6 = 0$.

choose **Fast** reasoning for this first try, and click **Start solving**. Within a few seconds ledger entries should start appearing in the timeline, the activity strip should show which agent is working, and after a few minutes the conversation should turn `solved` with the answer $x \in 1, 2, 3$. The usage meter in the header shows what the run cost. If the very first model call fails, the backend terminal shows the provider's error message (an invalid key, missing credit, or a model that is not available to your account); the [Troubleshooting](#troubleshooting) section lists the common ones.

### Everyday use, stopping and updating

To use Solver Agent on another day: start MongoDB if it is local and not running as a service, then open two terminals and run `npm run dev` in `backend/` and `npm start` in `frontend/`, and open [http://localhost:4200](http://localhost:4200). To stop, press Ctrl + C in each terminal. Your conversations are in the database and are still there next time.

To update to a newer version of the code:

```bash
cd ~/solver-agent
git pull
cd backend && npm install && cd ../frontend && npm install
```

then restart both servers. If `backend/python/requirements.txt` changed, re-run the `pip install` line from step 7 with the new package names.

## Configuration reference

All variables are read from `backend/.env` and validated in `backend/src/config/env.ts`.


| Variable                    | Default                  | Purpose                                                                                                                                         |
| --------------------------- | ------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `MONGODB_URI`               | *(required)*             | MongoDB connection string.                                                                                                                      |
| `MONGODB_DB`                | *(required)*             | Database name. Collections are created lazily.                                                                                                  |
| `OPENAI_API_KEY`            | `""`                     | OpenAI key. Required for any role routed to `openai`, which by default is all of them and always the Reference Seeker and side-talk web search. |
| `ANTHROPIC_API_KEY`         | `""`                     | Anthropic key, used by roles routed to `claude`.                                                                                                |
| `HUGGINGFACE_API_KEY`       | `""`                     | HuggingFace token, used by roles routed to `huggingface` (Inference Router, `https://router.huggingface.co/v1`).                                |
| `GEMINI_API_KEY`            | `""`                     | Google AI Studio key, used by roles routed to `gemini` (Gemini Developer API via `@google/genai`).                                              |
| `MODEL_PRICING_JSON`        | *(unset)*                | JSON object merged over the built-in pricing table, e.g. `{"gpt-5.6-sol":{"input":4,"cachedInput":0.4,"output":20}}` in USD per million tokens. |
| `PYTHON_BIN`                | `python3`                | Interpreter used by the sandbox. Point it at your venv or conda env.                                                                            |
| `PYTHON_TIMEOUT_MS`         | `60000`                  | Wall-clock cap per `run_python` call for the symbolic and CY sub-agents (halved in `fast` mode).                                                |
| `PYTHON_HEAVY_TIMEOUT_MS`   | `240000`                 | Wall-clock cap for the numerical sub-agent, so compiled C++ searches have room.                                                                 |
| `PYTHON_MAX_TIMEOUTS`       | `3`                      | Number of timeouts a sub-agent may hit before it must give up with `status: "timeout"`.                                                         |
| `PYTHON_MAX_CPU_SECONDS`    | derived from the timeout | CPU-time rlimit for the sandbox. `0` disables it. Raise it if you pin a larger heavy timeout.                                                   |
| `PYTHON_MAX_MEMORY_BYTES`   | `2147483648` (2 GiB)     | `RLIMIT_AS` / `RLIMIT_DATA` cap inherited by C++ binaries and the Wolfram kernel. macOS does not reliably enforce it; Linux does.               |
| `PYTHON_MAX_OUTPUT_BYTES`   | `8388608` (8 MiB)        | Hard cap on captured stdout + stderr before a run is killed.                                                                                    |
| `PYTHON_MAX_ARTIFACT_BYTES` | `2097152` (2 MiB)        | Files larger than this are dropped from the artifacts with a `skipped` marker.                                                                  |
| `AGENT_MAX_TURNS`           | `40`                     | Maximum Responses API turns for one Main solver run before it is marked `failed`.                                                               |
| `SUB_AGENT_MAX_TURNS`       | `12`                     | Maximum turns for any sub-agent (computation, verification, reference lookup).                                                                  |
| `PORT`                      | `3000`                   | HTTP port.                                                                                                                                      |
| `LOG_LEVEL`                 | `info`                   | pino level: `fatal`, `error`, `warn`, `info`, `debug`, `trace`, `silent`.                                                                       |
| `CORS_ORIGIN`               | `*`                      | Allowed origin for direct browser access. Irrelevant when going through the Angular proxy.                                                      |
| `NODE_ENV`                  | `development`            | `development`, `production` or `test`.                                                                                                          |


Model selection is deliberately **not** an environment variable: which provider, model and reasoning effort each agent uses is code in `backend/src/agents/llmClient.ts`, so the choice is reviewed, versioned and unit-tested together with the pricing table. See [Changing model providers and models](#changing-model-providers-and-models).

## Using Solver Agent

Solver Agent has no accounts. The frontend generates a random `userId`, stores it in `localStorage` and scopes the conversation list to it; the backend trusts that id. This is intended for a single researcher or a trusted group on a private network. Put it behind your own authentication layer before exposing it publicly.

### From the web UI

**Starting a problem.** Click the **+** button in the sidebar. The *New problem* dialog asks for:

- the **problem statement**, in plain text with Markdown / LaTeX if you like. State the domain, constraints, units and conventions explicitly; the solver records its interpretation as `assumption` entries you can check.
- the **reasoning effort**: *High* (thorough, token-heavy) or *Fast* (cheaper, lower latency).
- **additional tools**: toggle the Calabi-Yau Analyst and / or the Reference Seeker for this conversation.

Press **Start solving** (or Cmd/Ctrl + Enter). A conversation and ledger are created and the solver starts immediately in the background.

**Reading the timeline.** The centre pane interleaves your messages, the assistant's messages and ledger step cards in chronological order. Each card shows the entry type badge, its status (pending / accepted / rejected / superseded), which agent produced it, and a one-line summary; expand it for the full Markdown + LaTeX details. Cards with code or files have an **artifacts** button that opens the right-hand panel with tabs for the entry content, code, output, plots and files. The strip at the bottom of the timeline shows which agents are currently working.

**Following up.** Type in the composer to add context, ask for an extra case or point out an error. If the solver is running, your message pauses it, is recorded as a `problem_followup` entry and the solver resumes with the new input. The composer also lets you change the reasoning speed and the extra tools for the next run.

**Pause / Resume.** The composer's pause button aborts the current model call and marks the conversation `paused`; the banner's **Resume** button continues from the existing ledger. Runs that stop without submitting a verified answer are also left in `paused` so you can nudge them.

**Graph.** The **Graph** button in the header switches the centre pane to the proof dependency graph: nodes are ledger entries, edges are `dependsOn` links, colours follow the entry type. Click a node to select it and open its artifacts.

**Solution.** When the conversation is `solved`, the **Solution** button appears. The first click asks the Proof Narrator to write a walkthrough of the successful chain; afterwards it toggles between the narrative and the conversation.

**Side-talk.** The **Side-talk** button opens a chat panel on the right where you can ask about the ongoing work ("why did it pick that substitution?", "what does figure 2 show?"). Answers can cite ledger entries and files, shown as flags that scroll to or open the item, and you can enable web search per message. None of this reaches the solver.

**Fork.** Hover a message or step card and use **Fork** to create a new conversation containing the ledger up to that point (inclusive). Forking from the final answer creates an already-solved copy you can keep asking follow-ups on.

**Sidebar.** Conversations are sorted by last activity and show a status pill (`active`, `paused`, `solved`, `failed`, `archived`). You can archive / unarchive, rename via the API, or delete a conversation and everything attached to it.

**Cost.** The usage meter in the header shows the running USD cost for the conversation; click it for a breakdown per agent role, model and token category.

**Export.** The **Export** button in the header downloads the complete record of the conversation as a zip; see [Exporting a session](#exporting-a-session).

### Exporting a session

A solved (or unsolved) problem is only useful to others if they can see exactly what was asked, what the models did and how the result was checked. The **Export** button in the conversation header (or `GET /api/conversations/:id/export`) produces a zip named `solver-agent-<title>-<date>.zip` with:

| File                   | Content                                                                                                                                                              |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `report.html`          | The conversation exactly as the web UI shows it: your messages and the assistant's replies interleaved with the ledger step cards in chronological order, each card expandable to its content, code, output, plots and files, with dependency links, light and dark themes and "expand all". Math is rendered with KaTeX and code highlighted with Prism at export time; the page is fully self-contained (styles and fonts inlined, no script from the network) and opens offline from the unzipped folder, where it loads figures from `artifacts/`. |
| `report.tex`           | The publication document, a self-contained LaTeX source styled like the app: a header card per entry (type colour, badges, dependencies, model, duration), block cards for code (syntax-highlighted), output, results and verdicts, watermarks on rejected / superseded entries, hyperlinked cross-references. The models' math is reproduced verbatim; a macro they invented that no package defines is typeset as its own name in red (as KaTeX shows it in the app) instead of stopping the compiler. Compile from the zip root with `latexmk -pdf report.tex` (pdfLaTeX, XeLaTeX and LuaLaTeX all work; prefer XeLaTeX if the run produced unusual Unicode) or upload the whole zip to Overleaf. |
| `ledger.json`          | The raw records (conversation, ledger, entries, messages, usage per role and model, file index, prompt hashes) for programmatic use. The `userId` and provider response ids are omitted. |
| `artifacts/<entryId>/` | Every file produced by the sandbox, per entry (plots, CSVs, ...). Files skipped at run time because they exceeded the size cap are listed in the report but absent here. |
| `code/<entryId>.py`    | The final script of each computation entry, exactly as it was executed.                                                                                              |

`report.tex` has three sections:

1. **Header**: title, ids, creation and export dates, ledger status, reasoning speed, the optional tools that were enabled, the models actually used per agent role (from the usage records, so a conversation that switched providers lists every model), a SHA-256 over the system prompts, and the Solver Agent version.
2. **Prompts**: the problem statement and every follow-up, verbatim and in order.
3. **Ledger**: every entry in chronological order with a type badge, the agent that produced it, its status, its reasoning speed, the entries it depends on (hyperlinked), its summary and its body. Computation entries add the task given to the sub-agent, the code, stdout and stderr verbatim, the result, embedded figures, the duration and the model. Verification entries add the verdict, the method, the justification and the counter-example (or the list of issues for a full verification). Rejected and superseded entries are kept in place with a visible marker: they are part of the record.

System prompts are identified by their SHA-256 only (per prompt in the header table and in `ledger.json`, plus a combined hash); the texts themselves live in `backend/src/agents/systemPrompts.ts`, so a reader recomputes the hashes from the published repository to check that a run used the published prompts. Opt-in tool prompts and the notes they append to the Main solver's prompt are listed only when the tool was enabled; side-talk and the Proof Narrator are not part of the ledger and are not included.

The export is rendered deterministically from the database by `backend/src/export/`; no model is called, so it is free and can be repeated at any time. Models' hidden chain-of-thought is never stored and therefore not exported; the ledger records what the models committed to, not what they considered.

### From the REST API

Everything the UI does goes through the JSON API under `/api`, so you can drive Solver Agent from scripts, notebooks or your own frontend.


| Method   | Path                                                | Description                                                                                                                                                              |
| -------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `GET`    | `/api/health`                                       | Liveness check.                                                                                                                                                          |
| `GET`    | `/api/conversations?userId=...&limit=...`           | List a user's conversations, most recent first.                                                                                                                          |
| `POST`   | `/api/conversations`                                | Create a conversation + ledger and start the solver. Body: `{ userId, problemStatement, title?, reasoningSpeed?: "high"                                                  |
| `GET`    | `/api/conversations/:id`                            | Conversation document (status, settings, usage aggregate).                                                                                                               |
| `PATCH`  | `/api/conversations/:id`                            | Update `title` and / or `status` (for example `archived`).                                                                                                               |
| `DELETE` | `/api/conversations/:id`                            | Delete the conversation, ledger, entries, files, side-talk and usage records. Refused while a run is in flight.                                                          |
| `POST`   | `/api/conversations/:id/fork`                       | Fork. Body: `{ upToCreatedAt: ISO-8601, title?, markSolved? }`. Copies messages and entries created up to and including that timestamp.                                  |
| `POST`   | `/api/conversations/:id/pause`                      | Abort the in-flight run and mark the conversation `paused`.                                                                                                              |
| `POST`   | `/api/conversations/:id/resume`                     | Resume from the existing ledger. Returns `202`.                                                                                                                          |
| `POST`   | `/api/conversations/:id/narrate`                    | Ask the Proof Narrator to generate the solution walkthrough (conversation must be `solved`). Returns `202`; the text arrives as a `ledger.narrative.set` event.          |
| `GET`    | `/api/conversations/:id/usage`                      | Usage aggregate plus a per-role / per-model breakdown.                                                                                                                   |
| `GET`    | `/api/conversations/:id/messages`                   | User-facing messages.                                                                                                                                                    |
| `POST`   | `/api/conversations/:id/messages`                   | Follow-up. Body: `{ content, reasoningSpeed?, additionalTools? }`. Pauses any in-flight run, appends a `problem_followup` entry, re-activates the solver. Returns `202`. |
| `GET`    | `/api/conversations/:id/ledger`                     | Ledger document (`status`, `problemStatement`, `normalizedProblem`, `finalAnswer`, `narrative`).                                                                         |
| `GET`    | `/api/conversations/:id/ledger/entries?since=<ISO>` | Ledger entries, optionally only those created after `since`.                                                                                                             |
| `GET`    | `/api/conversations/:id/files`                      | Metadata of every generated file.                                                                                                                                        |
| `GET`    | `/api/conversations/:id/files/:fileId`              | Raw bytes of a generated file with the right `Content-Type`.                                                                                                             |
| `GET`    | `/api/conversations/:id/export`                     | Zip bundle with `report.html`, `report.tex`, `ledger.json`, `artifacts/` and `code/`, see [Exporting a session](#exporting-a-session).                                  |
| `GET`    | `/api/conversations/:id/side-talk`                  | Side-talk history.                                                                                                                                                       |
| `POST`   | `/api/conversations/:id/side-talk`                  | Ask a side-talk question. Body: `{ content, webSearch? }`. Synchronous; returns the assistant turn with its `loadedEntries` / `loadedArtifacts`.                         |
| `DELETE` | `/api/conversations/:id/side-talk[/:messageId]`     | Clear the side-talk history or one message.                                                                                                                              |
| `GET`    | `/api/conversations/:id/stream`                     | Server-Sent Events stream, see below.                                                                                                                                    |


Errors are returned as `{ "error": { "code", "message", "details?" } }` with conventional status codes (`400` validation, `404` not found, `409` conflict such as posting to an archived conversation).

A minimal end-to-end session with `curl`:

```bash
# 1. Create a conversation; the solver starts immediately.
curl -s -X POST http://localhost:3000/api/conversations \
  -H 'content-type: application/json' \
  -d '{"userId":"cli","problemStatement":"Compute \\int_0^\\pi x \\sin x \\, dx.","reasoningSpeed":"fast"}'
# -> {"conversationId":"conv_...","ledgerId":"ledg_...","problemId":"prob_..."}

# 2. Follow the ledger live (Ctrl-C to stop).
curl -N http://localhost:3000/api/conversations/conv_.../stream

# 3. Or poll.
curl -s http://localhost:3000/api/conversations/conv_.../ledger/entries | jq '.entries[] | {type,status,summary:.content.summary}'
curl -s http://localhost:3000/api/conversations/conv_.../messages | jq '.messages[-1].content'
```



### Live event stream (SSE)

`GET /api/conversations/:id/stream` is a standard `text/event-stream`. The event name is the `type` field of the payload, and the payload always carries `conversationId` and `ledgerId`:


| Event                           | Payload                               | When                                                                              |
| ------------------------------- | ------------------------------------- | --------------------------------------------------------------------------------- |
| `ready`                         | `{ activeAgents: AgentTool[] }`       | Immediately on connect, so a reconnecting client can restore the activity strip.  |
| `ledger.entry.added`            | `{ entry: LedgerEntry }`              | A new ledger entry was appended (by the solver, a sub-agent or a user follow-up). |
| `ledger.entry.updated`          | `{ entry: LedgerEntry }`              | An entry's status changed (only `superseded` flips, or artifact files attached).  |
| `ledger.status.changed`         | `{ status: LedgerStatus }`            | `active`, `paused`, `solved`, `failed`, `verified`.                               |
| `ledger.normalized_problem.set` | `{ normalizedProblem }`               | The solver recorded its reformulation of the problem.                             |
| `ledger.final_answer.set`       | `{ finalAnswer }`                     | The verified final answer was stored on the ledger.                               |
| `ledger.narrative.set`          | `{ narrative }`                       | The Proof Narrator finished the walkthrough.                                      |
| `conversation.message.added`    | `{ message: ConversationMessage }`    | A user or assistant message was appended.                                         |
| `conversation.status.changed`   | `{ status: ConversationStatus }`      | `active`, `paused`, `solved`, `failed`, `archived`.                               |
| `agent.activity`                | `{ tool: AgentTool, status: "started" | "finished" }`                                                                     |
| `usage.updated`                 | `{ usage: ConversationUsage }`        | Token / cost aggregate changed after a model call.                                |
| `solver.error`                  | `{ error: { code, message } }`        | The run failed (for example `max_turns_exceeded`).                                |
| `heartbeat`                     | `{ ts }`                              | Every 15 s to keep proxies from closing the connection.                           |


The events are emitted from an in-process `EventEmitter` (`backend/src/events/eventBus.ts`). That is sufficient for a single backend instance; to scale horizontally you would replace the bus with Redis pub/sub or similar, since the frontend only ever sees the HTTP stream.

## Navigating the project



### Repository layout

```text
solver-agent/
├── README.md                 ← you are here
├── diagram.png               ← architecture diagram
├── backend/                  ← Express + MongoDB orchestrator
│   ├── src/
│   │   ├── index.ts          ← bootstrap: Mongo, run recovery, routes, graceful shutdown
│   │   ├── config/           ← env.ts (zod-validated env), pricing.ts (per-model USD rates)
│   │   ├── agents/           ← one file per agent + llmClient facade + prompts + tool schemas
│   │   │   └── __tests__/    ← mock-based unit tests (npm test)
│   │   ├── tools/            ← Main-solver tool handlers (ledger, compute, verify, files)
│   │   ├── services/         ← solverOrchestrator, forkConversation, narrativeService
│   │   ├── export/           ← session export: document model, HTML + LaTeX renderers, zip
│   │   │   └── __tests__/    ← fixture-based renderer tests (npm test)
│   │   ├── routes/           ← Express routers under /api
│   │   ├── repositories/     ← thin MongoDB data-access layer per collection
│   │   ├── db/               ← mongo.ts (client, collections, indexes), types.ts (domain model)
│   │   ├── events/           ← eventBus.ts (typed in-process pub/sub + agent activity)
│   │   ├── python/           ← runner.ts: spawns the sandbox subprocess
│   │   └── util/             ← errors, ids, logger, asyncHandler
│   ├── python/
│   │   ├── runner.py         ← the sandbox itself (rlimits, artifact capture, matplotlib Agg)
│   │   └── requirements.txt
│   ├── debug/                ← audit and live smoke scripts (npx tsx debug/<script>.ts)
│   ├── docs/                 ← offline CYTools API reference used to write the CY prompt
│   ├── _sandbox_smoke.ts     ← sandbox isolation probe
│   └── README.md             ← backend-specific notes
└── frontend/                 ← Angular 21 SPA
    ├── src/app/
    │   ├── app.routes.ts     ← "/" (empty state) and "/c/:id" (conversation view)
    │   ├── core/api/         ← api.service.ts (REST), stream.service.ts (SSE), dto.ts (shared types)
    │   ├── core/state/       ← conversation-store (signals + SSE reducer), drafts, layout, theme, user
    │   ├── core/utils/       ← markdown.ts (marked + katex + prism + dompurify), time.ts
    │   ├── features/sidebar/ ← conversation list, new-conversation dialog
    │   ├── features/content/ ← timeline, step cards, composer, proof graph, side-talk, usage meter
    │   ├── features/artifacts/ ← right-hand panel and its tabs
    │   └── shared/           ← icon, badges, dialogs, markdown renderer, resizable pane
    ├── src/styles/           ← design tokens, reset, typography, KaTeX overrides
    ├── proxy.conf.json       ← /api → http://localhost:3000 for ng serve
    └── README.md             ← frontend-specific notes
```



### Backend walkthrough

Read these files in this order and the rest will make sense.

`src/agents/llmClient.ts`: the provider-agnostic facade. It owns the `PROVIDER_MATRIX`, `MODEL_MATRIX` and `EFFORT_MATRIX`, resolves `(reasoningSpeed, reasoningRole)` to a target, forwards `createResponse` to the right client and records usage. It also exports two generic loops, `runManualAgentLoop` (caller keeps the full input array) and `runPreviousResponseLoop` (server keeps the state via `previous_response_id`).

`src/agents/openaiClient.ts`**,** `claudeClient.ts`**,** `geminiClient.ts`**,** `hfClient.ts`: the four back-ends. Every client speaks the *OpenAI Responses shape* on both sides: it accepts `ResponseInputItem[]` and returns a `Response` whose `output` contains `reasoning`, `function_call` and `message` items. The Claude, Gemini and HuggingFace clients translate to and from their native APIs (Anthropic Messages, Gemini `generateContent`, Chat Completions) internally, including emulating `previous_response_id` with an in-process cache. The rest of the codebase never knows which vendor it is talking to.

`src/agents/toolSchemas.ts`: every function tool the models can call, as strict JSON Schemas, plus the structured-output schemas sub-agents must reply with (`computation_result`, `step_verification_verdict`, `full_verification_verdict`, `reference_seeker_result`). `buildMainSolverTools(flags)` and `buildVerificationSubAgentTools(flags)` assemble the per-conversation tool lists.

`src/agents/systemPrompts.ts`: one exported prompt constant per agent, plus the notes appended to the Main solver when an optional tool is enabled. Prompts are structured with XML-ish sections (`<role>`, `<tools>`, `<hard_rules>`, `<workflow>`, `<output_contract>`).

`src/agents/mainSolverAgent.ts`: the coordinating loop. `buildInitialInput` reconstructs the model input from MongoDB on every run (a developer message with the problem and a compacted ledger snapshot, followed by the conversation turns), the `while` loop dispatches tool calls to the handlers in `src/tools/`, and the guard logic described above lives in the small exported helpers at the bottom so it can be unit-tested.

`src/tools/*.ts`: one handler per Main-solver tool with the signature `(ctx: ToolContext, call) => Promise<string>`. `symbolicTool.ts` contains `makeComputationHandler`, the shared wrapper that turns any sub-agent runner into a tool: it resolves the `dependsOn` context, runs the sub-agent inside `trackAgentActivity`, persists the ledger entry and generated files, emits the SSE event and returns the JSON the model sees. `numericalTool.ts`, `cyAnalystTool.ts` and `referenceSeekerTool.ts` are each a few lines built on it.

`src/agents/symbolicAgent.ts`: `runComputationSubAgent`, the generic computation sub-agent loop shared by the symbolic, numerical and CY agents. It runs the `run_python` tool against `src/python/runner.ts`, tracks timeouts, chooses server-side state on OpenAI and manual state elsewhere, and parses the structured result.

`src/agents/stepVerificationAgent.ts`**,** `fullVerificationAgent.ts`: the verifiers. They receive the target entry (or the whole ledger) as text, may call fresh computation sub-agents, and must end with the structured verdict, which the tool handler persists as a `verification` entry.

`src/services/solverOrchestrator.ts`: run lifecycle. Keeps an in-memory map of in-flight runs (one per conversation) with an `AbortController`, implements `startSolverRun`, `pauseSolverRun`, `resumeSolverRun`, drains runs on shutdown and recovers interrupted ones on boot. Wraps each run in a usage context so every model call is attributed to the conversation.

`src/routes/*.ts`: thin Express routers that validate with `zod`, call repositories / services, and emit events. `src/repositories/*.ts` are equally thin wrappers over MongoDB collections; `src/db/mongo.ts` creates indexes on connect.

`src/export/`: the session export behind `GET /:id/export` (`routes/export.ts`). `buildExport.ts` loads the conversation, ledger, entries, generated files and usage records and shapes them into a renderer-independent `ExportDocument` (`types.ts`); `systemPromptCatalog.ts` picks the prompts that governed the run and hashes them; `renderHtml.ts` and `renderLatex.ts` serialise the document; `renderHtml.ts` reproduces the app's conversation view through `markdownToHtml.ts` (a server-side twin of the frontend's Markdown pipeline: KaTeX for math, Prism for code, raw HTML reduced to harmless formatting tags without attributes, except for the solver's figure `<img>` tags, which are redirected to `artifacts/`) and `htmlAssets.ts` (KaTeX stylesheet with its fonts inlined as data URIs, so the page works offline); `palette.ts` holds the colours shared by both renderers, mirroring the app's light theme; `renderLatex.ts` goes through `markdownToLatex.ts`, a `marked`-based converter that shields code, lifts math spans out before lexing so `_`, `^` and `\` inside formulas survive, escapes prose only, then puts the math back (display `$$` becomes `\[…\]`, KaTeX-style `$$\begin{align}…$$` becomes a bare `align`, blank lines inside display math are dropped), and `highlightPython.ts`, a small tokenizer that colours code inside `fvextra` Verbatim blocks (the `listings` package cannot handle non-Latin-1 output under pdfLaTeX); `zipBundle.ts` lays the reports, `ledger.json`, artifacts and code out as a zip stream with `archiver`. The renderers are pure functions of the document, which is what `export/__tests__/` exercises against a synthetic fixture.

`src/python/runner.ts` **+** `python/runner.py`: the sandbox pair. The TypeScript side spawns `PYTHON_BIN python/runner.py` with a scrubbed environment and the rlimit flags, pipes the script on stdin, enforces the wall-clock timeout and output cap, and parses the `__SOLVER_RUNNER_RESULT__` JSON trailer. The Python side applies the rlimits, forces the `Agg` backend, runs the script in a temporary directory, saves any open figures and base64-encodes every file in `artifacts/`.

`src/agents/usageTracker.ts`**,** `usageContext.ts`**,** `config/pricing.ts`: cost accounting. `AsyncLocalStorage` carries the current conversation through the agent loops, so `createResponse` can record a `UsageRecord` and `$inc` the conversation aggregate without threading ids through every call.

### Frontend walkthrough

The frontend is a standalone-component Angular app with signals and no NgModules.

**State.** `core/state/conversation-store.service.ts` is the single source of truth: it holds the conversation list, the selected conversation, its messages, ledger entries, usage, active agents, narrative and stream status as signals, exposes derived signals such as the interleaved `timeline`, and contains the reducer that applies every SSE event. Components read from it and call its methods; they never talk to the API directly for conversation data.

**API.** `core/api/api.service.ts` wraps every REST endpoint listed above; `core/api/stream.service.ts` manages one `EventSource` per conversation with exponential-backoff reconnection and typed event parsing. `core/api/dto.ts` mirrors the backend types in `backend/src/db/types.ts`; when you add an entry type, tool or agent on the backend, this is the first frontend file to update.

**Layout.** `app.component` hosts the three panes and the resizable dividers (`shared/resizable-pane.directive.ts`, widths persisted by `core/state/layout.service.ts`). `features/sidebar/` owns the conversation list and the *New problem* dialog. `features/content/content.component` is the conversation page: header with the Side-talk / Graph / Solution toggles and the usage meter, banners for pause / error / reconnect, the scrolling timeline of `chat-message` and `ledger-entry-card` components, the `agent-activity` strip and the `composer`. `features/artifacts/artifacts-panel.component` renders the selected entry with one component per tab (`entry-content`, `code`, `output`, `plot`, `files`, `final-answer`).

**Proof graph.** `features/content/proof-graph.component` renders the `dependsOn` DAG as SVG. Layout is computed by ELK inside a web worker (`proof-graph-layout.worker.ts`, driven by `proof-graph-layout.service.ts`) so large ledgers never block the UI thread.

**Rendering.** `core/utils/markdown.ts` configures `marked` with KaTeX math, Prism code highlighting and DOMPurify sanitization; `shared/markdown.component.ts` is the one place that puts HTML into the DOM. Entry-type labels, icons and colours are centralised in `shared/type-badge.component.ts` and the `--sa-type-`* tokens in `src/styles/_tokens.scss`.

**Theming.** `<html data-theme="dark|light">` switches two sets of CSS variables defined in `_tokens.scss`; `core/state/theme.service.ts` persists the choice and falls back to `prefers-color-scheme`.

### Life of a solver run

Putting it together, here is what happens when you click **Start solving**:

1. `POST /api/conversations` (`routes/conversations.ts`) creates the conversation and ledger documents, appends your problem as the first user message, emits `conversation.message.added`, and calls `startSolverRun` without awaiting it. The UI navigates to `/c/:id` and opens the SSE stream.
2. `solverOrchestrator.executeRun` marks the conversation `active`, opens a usage context and calls `runMainSolverTurn` with an `AbortSignal`.
3. `mainSolverAgent` loads messages and entries from MongoDB, builds the initial input, and enters the loop: `createResponse` → resolve provider / model / effort for `main_solver` → call the vendor → append the returned `reasoning` / `function_call` / `message` items to the input.
4. For each `function_call` the loop applies the guards, then dispatches to the handler. `ledger_append_entry` writes an entry and emits `ledger.entry.added`. `symbolic_compute` runs `runSymbolicAgent`, which loops on `run_python` against the sandbox until it can return a structured result; `makeComputationHandler` persists the entry, the code, the stdout and any files. `verify_step` spins up the step verifier, which may itself call fresh computation sub-agents. Each handler's return value goes back to the model as a `function_call_output`.
5. When the solver believes it is done, it appends a `final_answer` entry and calls `verify_full_solution`. The full verifier walks the ledger and returns `verified` or `rejected` with issues. A rejection sends the solver back to step 4 with corrections; a `verified` verdict arms `submit_final_answer`.
6. `submit_final_answer` posts the answer as an assistant message linked to the `final_answer` entry, flips the conversation and ledger to `solved`, and ends the run. The UI shows the **Solution** button; clicking it triggers the Proof Narrator through `POST /:id/narrate`.
7. Throughout, `trackAgentActivity` emits `agent.activity` events, `usageTracker` emits `usage.updated`, and the store reduces every event into the signals the components render.

A follow-up message repeats the cycle: it pauses any in-flight run, appends a `problem_followup` entry and a user message, then starts a fresh run whose initial input contains the whole updated ledger snapshot and conversation.

## Adding a sub-agent

A **sub-agent** is a specialized language-model loop that the Main solver (and the verifiers) can delegate a bounded task to: it has its own system prompt, its own tools, its own model routing and cost attribution, and it ends every task with a structured result that is persisted as a ledger entry of its own type. The symbolic, numerical and Calabi–Yau agents are sub-agents that write and run code in the sandbox; the Reference Seeker is a sub-agent that searches the web. This is the intended way to extend Solver Agent with a new capability, because a sub-agent inherits everything the platform already does for the existing ones: the `dependsOn` context resolution, the ledger persistence with code, output and files, the "interpret this computation before doing anything else" guard, the verifiers' ability to call it independently, the live activity indicator, the usage meter, and the per-role model matrices.

Two existing sub-agents are complete, self-contained references and the sections below follow them closely:

- the **Calabi–Yau Analyst** (`cyAnalystAgent.ts`, `cyAnalystTool.ts`, identifiers `cy_analyst` / `cy_analyst_compute` / `cy_analyst_computation` / `cyAnalyst`): an opt-in, sandbox-backed sub-agent built on the shared computation loop, wrapped into a tool in two short files;
- the **Reference Seeker** (`referenceSeekerAgent.ts`, `referenceSeekerTool.ts`, identifiers `reference_seeker` / `seek_references` / `reference_lookup` / `referenceSeeker`): an opt-in sub-agent with a custom loop (hosted web search, no Python) and its own structured-output schema.

Because both are opt-in, every place that has to know about them is the place a new sub-agent has to be registered too. Searching the repository for their identifiers (`rg -n "cy_analyst|cyAnalyst" backend/src frontend/src`) lists every file to touch, which is the most reliable checklist there is.

The work is spread over many files but is almost entirely mechanical, so the recommended way to add a sub-agent is to delegate the wiring to an AI coding assistant (Cursor, Claude Code, Codex, ...) and to spend your own time on the sub-agent's prompt; see [With an AI coding agent](#with-an-ai-coding-agent-cursor-claude-code-codex-and-others) for a prompt. The sections in between explain what that assistant will be doing, and are the checklist for doing it by hand.

### How a sub-agent fits into the pipeline

When the Main solver calls a sub-agent tool such as `cy_analyst_compute` with `{ task, dependsOn }`:

1. The tool handler (built with `makeComputationHandler` in `backend/src/tools/symbolicTool.ts`) loads the ledger entries named in `dependsOn` and formats them into a context string, so the sub-agent sees exactly the assumptions and results it is meant to build on and nothing else.
2. It calls the sub-agent **runner**, a function `(input: { task, context?, reasoningSpeed, signal? }) => Promise<ComputationResult>`, wrapped in `trackAgentActivity` so the UI shows the agent working. The runner is a fresh, stateless LLM loop: it receives the task and context as its first user message, may call its own tools (`run_python` for the sandbox agents) as many times as it needs within `SUB_AGENT_MAX_TURNS`, and must finish with a message conforming to a strict JSON schema (`computationSubAgentResultSchema` or a custom one).
3. The handler persists a ledger entry of the sub-agent's own `type` and `tool` attribution, with the final code, captured stdout / stderr, duration and any generated files (stored in the `generatedFiles` collection), emits `ledger.entry.added`, and returns a JSON summary including the new `entryId` to the Main solver.
4. The agent loop in `mainSolverAgent.ts` marks that entry as a *pending computation*: the solver may not call any other tool until it appends a `result` entry interpreting it and listing the `entryId` in `dependsOn`. Any later `verify_full_solution` verdict is invalidated by the new computation.
5. The step and full-solution verifiers receive a **twin** of the same tool (same name, `task` only, no `dependsOn`) so they can re-run the sub-agent independently, with no access to the ledger.

Every model call inside the runner goes through `llmClient.createResponse` with a `reasoningRole` of its own, so the sub-agent can be routed to a different provider or model, given a different effort, and appears as its own line in the cost breakdown.

### Files you will touch

A new sub-agent is spread over a predictable set of files. The exhaustive TypeScript unions mean that once you extend the types in the first row, `npm run typecheck` (backend) and `npm run build` (frontend) list everything else you still have to do.


| Concern                                  | File(s)                                                                                                                                                                                                                                   | What to add                                                                                                                                                                      |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ledger entry type, agent id, opt-in flag | `backend/src/db/types.ts`                                                                                                                                                                                                                 | a `LedgerEntryType`, a `LedgerEntryTool`, a `UsageAgentRole`, a field in `AdditionalTools`                                                                                       |
| Agent identity for events and routing    | `backend/src/events/eventBus.ts`, `backend/src/agents/openaiClient.ts`, `backend/src/agents/llmClient.ts`                                                                                                                                 | an `AgentTool`, a `ReasoningRole`, and a cell in each row of `PROVIDER_MATRIX`, `MODEL_MATRIX`, `EFFORT_MATRIX`                                                                  |
| Tool schemas                             | `backend/src/agents/toolSchemas.ts`                                                                                                                                                                                                       | the entry type in `ENTRY_TYPES`, the solver-facing tool, its verifier twin, a `ToolFlags` field, splices in `buildMainSolverTools` and `buildVerificationSubAgentTools`          |
| Prompts                                  | `backend/src/agents/systemPrompts.ts`                                                                                                                                                                                                     | `<NAME>_AGENT_PROMPT` for the sub-agent, `MAIN_SOLVER_<NAME>_NOTE` telling the solver when to use it                                                                             |
| Runner                                   | `backend/src/agents/<name>Agent.ts`                                                                                                                                                                                                       | the sub-agent loop (usually three lines on top of `runComputationSubAgent`)                                                                                                      |
| Handler                                  | `backend/src/tools/<name>Tool.ts`, `COMPUTATION_TOOL_ENTRY` in `symbolicTool.ts`                                                                                                                                                          | `makeComputationHandler(toolName, runner)` plus the entry type / tool mapping                                                                                                    |
| Main solver                              | `backend/src/agents/mainSolverAgent.ts`                                                                                                                                                                                                   | flag read, prompt note, `handlers` entry, tool-name lists for the pending-computation and verification-invalidation guards, `SOLUTION_MUTATING_TYPES`, `seedPendingComputations` |
| Verifiers                                | `backend/src/agents/stepVerificationAgent.ts`, `fullVerificationAgent.ts`                                                                                                                                                                 | flag pass-through and a dispatch branch that calls the runner                                                                                                                    |
| API and fork                             | `backend/src/routes/conversations.ts`, `routes/messages.ts`, `backend/src/services/forkConversation.ts`                                                                                                                                   | the flag in both `AdditionalToolsSchema` objects, the change-detection condition, the fork copy                                                                                  |
| Sandbox                                  | `backend/python/requirements.txt` and the environment `PYTHON_BIN` points at                                                                                                                                                              | any Python package the sub-agent relies on                                                                                                                                       |
| Frontend types and visuals               | `frontend/src/app/core/api/dto.ts`, `shared/type-badge.component.ts`, `features/content/proof-graph.component.ts`, `agent-activity.component.ts`, `usage-meter.component.ts`, `ledger-entry-card.component.ts`, `src/styles/_tokens.scss` | mirrored unions, label / icon / colour for the entry type and the agent                                                                                                          |
| Frontend toggle                          | `features/sidebar/new-conversation-dialog.component.ts`, `features/content/composer.component.ts`, `content.component.ts/.html`, `core/state/conversation-store.service.ts`                                                               | a switch that carries the flag to the create and follow-up API calls                                                                                                             |




### Worked example: a Graph Theory sub-agent

The walkthrough adds an opt-in **Graph Analyst** sub-agent, exposed to the solver as `graph_compute`, that runs [networkx](https://networkx.org) in the sandbox (connectivity, colourings, matchings, spectra, isomorphism, enumeration of small graphs). It mirrors the Calabi–Yau Analyst one for one, so at every step you can compare your files with `cyAnalystAgent.ts`, `cyAnalystTool.ts` and the `cy_analyst` occurrences in the files below. Substitute your own names throughout: the ledger entry type is `graph_computation`, the agent id and reasoning role are `graph_analyst`, and the conversation flag is `graphAnalyst`.

**Step 1: domain types** (`backend/src/db/types.ts`). Add `"graph_computation"` to `LedgerEntryType`, `"graph_analyst"` to both `LedgerEntryTool` and `UsageAgentRole`, and `graphAnalyst?: boolean` to `AdditionalTools`.

**Step 2: agent identity and model routing.** Add `"graph_analyst"` to `AgentTool` in `backend/src/events/eventBus.ts` (this is what the activity strip displays) and to `ReasoningRole` in `backend/src/agents/openaiClient.ts`. Then give the new role a cell in each `high` and `fast` row of `PROVIDER_MATRIX`, `MODEL_MATRIX` and `EFFORT_MATRIX` in `backend/src/agents/llmClient.ts`; copying the `cy_analyst` cells is the right starting point. A sub-agent with its own role can later be moved to a cheaper model or a different vendor without touching anything else.

**Step 3: tool schemas** (`backend/src/agents/toolSchemas.ts`). Add `"graph_computation"` to `ENTRY_TYPES` so the solver may reference it, then define the solver-facing tool. The description is what the Main solver reads to decide when to delegate, so it must say what the sub-agent is good at, that it is stateless, what it returns, and that it persists its own ledger entry:

```ts
export const graphComputeTool: FunctionTool = fn(
  "graph_compute",
  [
    "Delegate a graph-theory computation to the Graph Analyst sub-agent (networkx in the sandbox): connectivity, shortest paths, colourings, matchings, spectra, isomorphism, enumeration of small graphs.",
    "The sub-agent is stateless: phrase the task as a fully self-contained instruction that defines the graph (vertices, edges or a generator) and the exact quantity to compute. Never state the expected result.",
    "Returns the result, the final Python code, a status ('success' | 'timeout' | 'error') and any generated artifacts.",
    "Side effects: persists a 'graph_computation' ledger entry with the code and result. Do NOT also call ledger_append_entry for the computation itself.",
  ].join(" "),
  {
    type: "object",
    additionalProperties: false,
    required: ["task", "dependsOn"],
    properties: {
      task: { type: "string", description: "Fully self-contained natural-language instruction." },
      dependsOn: { type: "array", items: { type: "string" }, description: "Ids of ledger entries that supply context." },
    },
  },
);
```

Define its verifier twin next to `subAgentCyAnalystTool`: same `name`, a description phrased for independent re-computation, and only `task` in the schema, since verifiers have no ledger access. Add `graphAnalyst?: boolean` to `ToolFlags`, and splice the two tools into `buildMainSolverTools` and `buildVerificationSubAgentTools` next to the CY Analyst ones when `flags.graphAnalyst` is true. Keeping the tool opt-in means the solver never sees it in conversations where it was not enabled.

**Step 4: prompts** (`backend/src/agents/systemPrompts.ts`). Two constants. `GRAPH_ANALYST_AGENT_PROMPT` is the sub-agent's own system prompt; start from `CY_ANALYST_AGENT_PROMPT` and keep its structure (see [Writing the sub-agent prompt](#writing-the-sub-agent-prompt) below for what the code depends on). `MAIN_SOLVER_GRAPH_ANALYST_NOTE` is appended to the Main solver's prompt only when the flag is on; start from `MAIN_SOLVER_CY_ANALYST_NOTE` and keep the sentence requiring a `result` entry after each accepted computation, because the guard in the agent loop enforces exactly that.

**Step 5: the runner** (`backend/src/agents/graphAnalystAgent.ts`). For a sandbox-backed sub-agent the whole loop already exists in `runComputationSubAgent` (`symbolicAgent.ts`): it sends the task and context, handles `run_python` calls against the sandbox with the timeout budget, chooses server-side or manual state depending on the provider, and parses the structured result. The runner only supplies the prompt, the role and the budget:

```ts
import { env } from "../config/env";
import { ReasoningSpeed } from "../db/types";
import { ComputationResult, runComputationSubAgent } from "./symbolicAgent";
import { GRAPH_ANALYST_AGENT_PROMPT } from "./systemPrompts";

export async function runGraphAnalystAgent(input: {
  task: string;
  context?: string;
  reasoningSpeed: ReasoningSpeed;
  signal?: AbortSignal;
}): Promise<ComputationResult> {
  return runComputationSubAgent({
    instructions: GRAPH_ANALYST_AGENT_PROMPT,
    promptCacheKey: "graph-analyst-agent",
    reasoningRole: "graph_analyst",
    task: input.task,
    reasoningSpeed: input.reasoningSpeed,
    // Optional: give heavy searches the larger budget the numerical agent uses.
    pythonTimeoutMs: env.PYTHON_HEAVY_TIMEOUT_MS,
    ...(input.context !== undefined ? { context: input.context } : {}),
    ...(input.signal ? { signal: input.signal } : {}),
  });
}
```

**Step 6: the handler** (`backend/src/tools/graphAnalystTool.ts`). Register the ledger attribution in `COMPUTATION_TOOL_ENTRY` inside `symbolicTool.ts`, `graph_compute: { type: "graph_computation", tool: "graph_analyst" }`, then wrap the runner:

```ts
import { runGraphAnalystAgent } from "../agents/graphAnalystAgent";
import { makeComputationHandler } from "./symbolicTool";
import { ToolHandler } from "./types";

export const graphComputeHandler: ToolHandler = makeComputationHandler(
  "graph_compute",
  runGraphAnalystAgent,
);
```

`makeComputationHandler` does the rest: argument parsing, `dependsOn` context, activity tracking, ledger entry, file persistence, the SSE event and the JSON returned to the model.

**Step 7: the Main solver** (`backend/src/agents/mainSolverAgent.ts`). Read the flag (`conversation.additionalTools?.graphAnalyst ?? false`), pass it to `buildMainSolverTools`, append `MAIN_SOLVER_GRAPH_ANALYST_NOTE` to `instructions` when it is on, and add `graph_compute: graphComputeHandler` to the `handlers` map. Then extend the guards: add `"graph_compute"` to the two `call.name === ...` conditions that register a pending computation and that invalidate the full-verification verdict, add `"graph_computation"` to `SOLUTION_MUTATING_TYPES`, and to the type check inside `seedPendingComputations` so the guard survives a pause and resume. Skipping this step is the most common mistake: the sub-agent would work, but its results could be used without ever being interpreted in a `result` entry.

**Step 8: the verifiers** (`stepVerificationAgent.ts`, `fullVerificationAgent.ts`). Both read the conversation flags and call `buildVerificationSubAgentTools`; add `graphAnalyst` there. In the sub-agent dispatch of each file, add a `graph_compute` branch that calls `runGraphAnalystAgent({ task, reasoningSpeed, signal })` and returns `{ ok, status, result, summary, error }`, exactly like the `cy_analyst_compute` branch. This is what lets a verifier recompute a graph invariant on its own rather than trusting the solver's entry.

**Step 9: API and fork.** Add `graphAnalyst: z.boolean().optional()` to the `AdditionalToolsSchema` in `routes/conversations.ts` and to the inline schema and change-detection condition in `routes/messages.ts` (so a follow-up can switch the tool on or off), and copy the flag in `services/forkConversation.ts` so forks keep it.

**Step 10: sandbox dependency.** Install the package into the interpreter `PYTHON_BIN` points at (`python/.venv/bin/pip install networkx`, or `conda run -n cytools pip install networkx`) and add `networkx>=3.3` to `backend/python/requirements.txt`.

**Step 11: compile and test.** `npm run typecheck` in `backend/` flags anything you missed: the matrices are typed `Record<ReasoningRole, ...>`, so a role without a cell in every row is a compile error, and so is a missing `switch` case. Add `graph_computation` cases to `src/agents/__tests__/computationGuard.test.ts`, copying the two `cy_analyst_computation` tests in the `seedPendingComputations` block, and run `npm test`. `npx tsx debug/agentLoopAudit.ts` confirms the new role resolves to a priced model in both speeds.

### Frontend wiring

The frontend needs to know the new entry type and agent to display them, and needs a switch to turn the sub-agent on. The Angular compiler drives this: after the first step every remaining place fails to compile until you fill it in.

- **Types** (`frontend/src/app/core/api/dto.ts`): mirror step 1, adding the entry type, the tool, the usage role and `AdditionalTools.graphAnalyst`.
- **Visuals**: `shared/type-badge.component.ts` (label, icon name and colour variable for `graph_computation`), `features/content/proof-graph.component.ts` (colour and legend item), `features/content/agent-activity.component.ts` (label and caption shown while the agent works), `features/content/usage-meter.component.ts` (role label in the cost breakdown), and the `switch` statements on entry type and tool in `features/content/ledger-entry-card.component.ts`. Define the colour token `--sa-type-graph-analyst` for both themes in `src/styles/_tokens.scss`.
- **Toggle**: add a switch to `features/sidebar/new-conversation-dialog.component.ts` (payload field, signal, toggle method, a row in the *Additional tools* list) and to `features/content/composer.component.ts` (so it can be changed on a follow-up), then thread the value through `content.component.ts` / `.html` and the create / send methods of `core/state/conversation-store.service.ts` so it reaches the `additionalTools` field of the API body.
- Run `npm run lint && npm run build` in `frontend/`, start a conversation with the new switch on, ask a graph question, and watch a `graph_computation` card appear with its code and output in the artifacts panel.



### Sub-agents that do not run Python

Not every sub-agent is a computation. The Reference Seeker searches the web; you might want one that queries a proof assistant, a symbolic engine reached over HTTP, an institutional database, or a large-language-model "critic" with no tools at all. The plumbing above is unchanged (types, schemas, flag, handler via `makeComputationHandler`, guards, verifiers, frontend); only the runner differs. Follow `referenceSeekerAgent.ts`:

1. Build the initial input from `task` and `context` and loop for at most `env.SUB_AGENT_MAX_TURNS` turns, calling `createResponse` from `llmClient.ts` with your `reasoningRole`, your prompt, the tools you want (`tools: [...]` for function tools you dispatch yourself, `webSearch: true` for OpenAI's hosted search) and a `responseFormat` schema for the final message.
2. After each turn, push the returned `reasoning`, `message` and tool-call items back into the input (manual state), dispatch any function calls to your own code and append their `function_call_output`, and stop when the response contains a final message.
3. Parse the final message with your schema and return a `ComputationResult`: `status` (`success` | `timeout` | `error`), `result`, `summary`, `error`, and empty `code` / `stdout` / `stderr` / `artifacts` if there is nothing to record. Returning this shape is what lets `makeComputationHandler` persist the entry unchanged.
4. Declare a structured-output schema in `toolSchemas.ts` (see `referenceSeekerResultSchema`), and keep the `status` field so the ledger entry lands as `accepted` or `rejected` correctly.

Two constraints to keep in mind: hosted web search exists only on the OpenAI back-end, so a sub-agent that needs it must stay on `openai` in `PROVIDER_MATRIX`; and if your runner calls external services, return their failures inside the `ComputationResult` (`status: "error"`) rather than throwing, so the Main solver can react.

### Writing the sub-agent prompt

The prompt is where most of the iteration happens once the code compiles. All sub-agent prompts in `systemPrompts.ts` share the same sections, and several of them are load-bearing for the code:

- `<role>`: one paragraph; "you receive one self-contained task and your only job is to perform that bounded computation and return the result with the code that produced it". Sub-agents must not try to solve the surrounding problem.
- `<tools>`: what `run_python` provides (pre-installed libraries, fresh interpreter per call, relative paths for files that should be captured, no `/tmp` or `~`), and how to reach any extra engine (the symbolic prompt shows the `wolframscript` idiom; yours would show the `networkx` idioms and any pitfalls).
- `<workflow>`: write a complete script that prints the final result unambiguously on the last line; run it; on error fix and rerun, never invent; on `timeout` decompose and retry; after `PYTHON_MAX_TIMEOUTS` timeouts return `status: "timeout"`. The runner counts timeouts and tells the model when the budget is exhausted, but the prompt has to tell it what to do about it.
- `<output_contract>`: "reply with a single message that conforms to the provided structured output schema, include the final code". If the model wraps the JSON in prose, `parseStructuredOutput` returns `status: "error"` and the solver sees a failed computation.
- Any domain material the model is unlikely to know well. The Calabi–Yau prompt embeds the whole CYTools documentation at startup from `backend/docs/`; for a mainstream library a curated list of functions and conventions is enough.

Then evaluate on real problems: enable the sub-agent, give the solver a task that needs it, and read the `graph_computation` cards and the step-verification verdicts. A failing card's `task`, `code` and `stderr` tell you whether the Main solver phrased the task badly (fix the `MAIN_SOLVER_<NAME>_NOTE` and the tool description) or the sub-agent misused the library (fix its own prompt).

### With an AI coding agent (Cursor, Claude Code, Codex and others)

Adding a sub-agent is long but mechanical, which makes it a good job for an AI coding agent. The codebase is already agent-friendly: every extension point is typed exhaustively, so the compiler tells the agent what it forgot, and the Calabi–Yau Analyst and Reference Seeker are two complete worked examples it can pattern-match against.

**Give the agent the map.** Point it at this README and at the two reference sub-agents. In Cursor, `@README.md`, `@backend/src/agents/cyAnalystAgent.ts` and `@backend/src/agents/toolSchemas.ts` in the prompt is enough; Claude Code and Codex will find them if you name the paths.

**Example prompt:**

```text
Add an opt-in sub-agent to Solver Agent called the Graph Analyst, exposed to the
solver as the tool `graph_compute` and backed by networkx in the Python sandbox,
following exactly the pattern of the existing Calabi-Yau Analyst
(`cy_analyst_compute`). Search the repository for `cy_analyst`, `cyAnalyst`,
`reference_seeker` and `referenceSeeker` (backend/src and frontend/src) to see
the full set of files the two existing opt-in sub-agents touch, and use
README.md § "Adding a sub-agent" as the checklist.

What the Graph Analyst does: it receives one self-contained graph-theory task
from the Main solver (or a verifier), builds the graph in networkx from the
description in the task (explicit vertex/edge lists, an adjacency matrix, or a
named generator such as a Petersen graph, a hypercube, a random graph, etc.), computes exactly the quantity asked for, and returns the result
with the final script. Typical tasks: connectivity and components, shortest
paths and diameter, chromatic number and colourings, maximum matchings and
vertex covers, planarity, isomorphism testing, adjacency/Laplacian spectra,
and exhaustive enumeration or counting over small graphs (e.g. all graphs on
up to 7 vertices with a given property). It never solves the surrounding
problem, never guesses a result it did not compute, and reports 'error' or
'timeout' honestly. The Main solver should use it whenever a claim about a
concrete graph can be checked by computation instead of by hand.

Requirements:
- New ledger entry type `graph_computation`, tool/agent id `graph_analyst`,
  reasoning role `graph_analyst` with cells in all three matrices in
  backend/src/agents/llmClient.ts (copy the cy_analyst cells).
- Strict JSON-schema tool + verifier twin in toolSchemas.ts, flag `graphAnalyst`
  in ToolFlags / AdditionalTools / both route schemas / forkConversation.
- Runner built on runComputationSubAgent, handler built on
  makeComputationHandler, registered in mainSolverAgent (handlers, tool list,
  prompt note, pending-computation and verification-invalidation lists,
  SOLUTION_MUTATING_TYPES, seedPendingComputations) and in both verifiers.
- GRAPH_ANALYST_AGENT_PROMPT and MAIN_SOLVER_GRAPH_ANALYST_NOTE in
  systemPrompts.ts, modelled section by section on the CY Analyst prompt and
  note (keep the run_python contract, the workflow and the output_contract).
- Frontend: dto.ts, type-badge, proof-graph, agent-activity, usage-meter,
  ledger-entry-card, _tokens.scss, new-conversation dialog + composer toggle,
  store and content component wiring.
- Add networkx to backend/python/requirements.txt and two graph_computation
  cases to computationGuard.test.ts.

Do not touch unrelated prompts or matrices. When done, run
`cd backend && npm run typecheck && npm test` and `cd frontend && npm run lint
&& npm run build`, fix everything they report.
```



## Changing model providers and models

Model routing lives in one file, `backend/src/agents/llmClient.ts`, and nothing else in the codebase names a vendor or a model. Every agent stage is a **role** (`main_solver`, `full_verification`, `step_verification`, `computation`, `cy_analyst`, `reference_seeker`, `proof_narrator`, `side_talk`), every conversation has a **speed** (`high` or `fast`), and the `(speed, role)` pair indexes three matrices.

### The three matrices

```ts
// backend/src/agents/llmClient.ts (abridged)
export type LlmProvider = "openai" | "claude" | "huggingface" | "gemini";

const PROVIDER_MATRIX: Matrix<LlmProvider> = {
  high: { main_solver: "openai", full_verification: "openai", step_verification: "openai",
          computation: "openai", cy_analyst: "openai", proof_narrator: "openai",
          reference_seeker: "openai", side_talk: "openai" },
  fast: { /* same shape */ },
};

const MODEL_MATRIX: Matrix<string> = {
  high: { main_solver: "gpt-5.6-sol", full_verification: "gpt-5.6-sol", /* ... */ },
  fast: { main_solver: "gpt-5.6-luna", /* ... */ side_talk: "gpt-5.6-terra" },
};

const EFFORT_MATRIX: Matrix<ReasoningEffort> = {
  high: { main_solver: "high", /* ... */ proof_narrator: "medium", side_talk: "medium" },
  fast: { main_solver: "high", /* ... */ proof_narrator: "low", side_talk: "high" },
};
```

- `PROVIDER_MATRIX` picks the client (`openaiClient`, `claudeClient`, `geminiClient`, `hfClient`).
- `MODEL_MATRIX` is the model id passed verbatim to that client. HuggingFace ids may carry a `:provider` routing suffix such as `deepseek-ai/DeepSeek-V4-Pro-0813:together`; Gemini ids are the bare API names such as `gemini-3.1-pro-preview` or `gemini-3.8-flash`.
- `EFFORT_MATRIX` uses the OpenAI reasoning-effort axis (`minimal`, `low`, `medium`, `high`, `xhigh`) plus `max`. OpenAI receives it as `reasoning.effort` (`max` is mapped to `xhigh`); Claude maps it to adaptive-thinking levels; Gemini maps it to `thinking_level` (`minimal`/`low` → `LOW`, `medium` → `MEDIUM`, `high`/`xhigh`/`max` → `HIGH`); HuggingFace passes it through for models that accept `reasoning_effort` (z.ai GLM exposes `max`).

`providerFor`, `modelFor` and `effortFor` are the only readers, and `createResponse` injects the resolved model so call sites never mention one. The file already contains commented-out alternative rows for an all-Claude `high` configuration, a Gemini `high` configuration (3.1 Pro solving and verifying, 3.8 Flash for the cheaper roles), an all-HuggingFace (DeepSeek / GLM via Together) `fast` configuration and an all-Gemini-3.8-Flash `fast` configuration that you can uncomment as a starting point.

### Switching a role to another provider or model

Because the matrices are per role, you can mix vendors freely: run the Main solver on one provider, the verifiers on a second (different model families catch different mistakes) and the cheap computation sub-agents on a third.

**Example: main solver on Claude, verification on OpenAI, everything else unchanged.**

1. Put `ANTHROPIC_API_KEY` in `backend/.env`.
2. In `llmClient.ts`, change the `high` row:
  ```ts
   const PROVIDER_MATRIX = {
     high: {
       main_solver: "claude",          // was "openai"
       full_verification: "openai",
       // ...
     },
   };
   const MODEL_MATRIX = {
     high: {
       main_solver: "claude-fable-5",  // was "gpt-5.6-sol"
       full_verification: "gpt-5.6-sol",
       // ...
     },
   };
  ```
3. Make sure the model has a price in `backend/src/config/pricing.ts` (see below), or cost will be recorded as `0` with a one-time warning.
4. Restart the backend (`npm run dev` does so automatically on save). Any run that was in flight is parked as `paused` and picks up the new routing when you resume it. Which model produced a given entry is recoverable from the usage records (`GET /api/conversations/:id/usage`), not from the entry itself.

**Example: make** `fast` **mode fully open-weight via HuggingFace.** Set `HUGGINGFACE_API_KEY`, then uncomment the HuggingFace block in the `fast` rows of `PROVIDER_MATRIX` and `MODEL_MATRIX` (DeepSeek V4 Pro for solving, GLM-5.2 for cross-checking, V4 Flash for cheap computation and narration) and comment out the OpenAI lines. Leave `reference_seeker` and `side_talk` on OpenAI; see the caveats.

**Example: run everything except web search on Gemini.** Set `GEMINI_API_KEY`, then uncomment the Gemini blocks in `PROVIDER_MATRIX` and `MODEL_MATRIX` for the speed you want (`high`: `gemini-3.1-pro-preview` for the main solver, full verification and the CY analyst, `gemini-3.8-flash` for step verification, computation and narration; `fast`: `gemini-3.8-flash` everywhere) and comment out the OpenAI lines. `reference_seeker` and `side_talk` stay on OpenAI because they depend on OpenAI's hosted web search, so `OPENAI_API_KEY` is still needed for those two roles (or disable the Reference Seeker in the conversation's additional tools and leave the side-talk web-search switch off). Structured output combined with function calling is a Gemini 3 feature; stick to the Gemini 3 models above for the sub-agent roles.

**Changing only the effort.** To make verification cheaper without changing models, lower `EFFORT_MATRIX.high.step_verification` from `"high"` to `"medium"`. Effort is where most of the cost lives on reasoning models, since reasoning tokens are billed as output.

After any change, run the offline invariant check and the unit tests:

```bash
cd backend
npx tsx debug/agentLoopAudit.ts   # every (speed, role) resolves; web_search roles on OpenAI; every model priced
npm test
```



### Adding a new model and its pricing

Any model id your provider accepts can go straight into `MODEL_MATRIX`; there is no allow-list. The only companion change is pricing, so the usage meter stays truthful.

`backend/src/config/pricing.ts` holds `DEFAULT_PRICING`, a map from model id to `{ input, cachedInput, output }` in USD per million tokens (output includes reasoning tokens). Add a line:

```ts
"claude-opus-5-1": { input: 5, cachedInput: 0.5, output: 25 },
```

`pricingFor` tolerates dated snapshot suffixes (`gpt-5.6-sol-2026-07-09` resolves to `gpt-5.6-sol`), HuggingFace routing suffixes (`zai-org/GLM-5.2:together` falls back to `zai-org/GLM-5.2`) and the Gemini `models/` resource prefix, so you rarely need one entry per variant. The bundled Gemini rates are the paid-tier prices for prompts up to 200k tokens (Gemini 3.1 Pro bills roughly double above that, which is not modeled) and the 3.6–3.8 Flash rates are promotional through 2026-12-31; override them with `MODEL_PRICING_JSON` when they change.

If you would rather not edit code when list prices change, override or extend the table at runtime with `MODEL_PRICING_JSON` in `.env`:

```dotenv
MODEL_PRICING_JSON={"claude-opus-5-1":{"input":5,"cachedInput":0.5,"output":25},"gpt-5.6-sol":{"input":3.5,"cachedInput":0.35,"output":18}}
```

Malformed entries are skipped with a warning; the rest of the table is unaffected. `npx tsx debug/agentLoopAudit.ts` asserts that every model referenced by `MODEL_MATRIX` has a price, so run it after editing either file.

### Adding a new provider

A provider is a module that implements the same surface as `openaiClient.ts` while speaking the *OpenAI Responses shape* to the rest of the system. `claudeClient.ts` (Anthropic Messages API), `geminiClient.ts` (Gemini `generateContent`) and `hfClient.ts` (Chat Completions dialect) are the three existing translations; a new one for, say, a local vLLM / Ollama server or Azure OpenAI follows the same recipe.

1. **Create** `backend/src/agents/<vendor>Client.ts` exporting:
  - `createResponse(options: CreateResponseOptions): Promise<Response>`. Translate `instructions`, `input` (`ResponseInputItem[]`: `message`, `reasoning`, `function_call`, `function_call_output`, and `input_image` content parts), `tools` (`FunctionTool[]` with strict JSON Schemas), `reasoning.effort`, `responseFormat` (JSON schema for the final message), `previousResponseId` / `store`, `parallelToolCalls`, `maxOutputTokens` and `signal` into the vendor's request. Translate the reply back into a `Response` whose `output` array contains `reasoning`, `function_call` (with a `call_id` the loop will echo back) and `message` items, and whose `usage` follows the OpenAI shape (`input_tokens`, `input_tokens_details.cached_tokens`, `output_tokens`, `output_tokens_details.reasoning_tokens`) so cost tracking works unchanged.
  - `runManualAgentLoop` and `runPreviousResponseLoop`: you can copy the bodies from `claudeClient.ts`; they are generic over `createResponse`.
  - If the vendor has no server-side conversation state, emulate `previous_response_id` with an in-process cache keyed by the synthetic ids you return, as `hfClient.ts` and `geminiClient.ts` do, and make a cache miss throw an error whose message contains `unknown previousResponseId` so `isMissingPreviousResponseError` treats it as recoverable.
  - If the vendor needs opaque per-part data echoed back (Anthropic thinking signatures, Gemini thought signatures), stash it on the output items you emit under a private `__vendorX` key, as the existing clients do; the agent loops append those items back verbatim, so the data survives the round-trip.
  - Retry on transient HTTP statuses (`408 409 425 429 5xx`) with backoff, and rethrow abort errors untouched (`isAbort`).
2. **Register it in** `llmClient.ts`: extend `LlmProvider` with the new literal and add the module to `CLIENT_BY_PROVIDER`. The sub-agents already use manual state for every provider other than `openai` (`useServerState` in `symbolicAgent.ts` and `stepVerificationAgent.ts` checks `providerFor(...) === "openai"`), so an in-process state emulation needs no further change.
3. **Add the credential** to `EnvSchema` in `config/env.ts` (default `""`) and to the "at least one key" check at the bottom of that file.
4. **Price the models** in `config/pricing.ts`.
5. **Test the translation** by adding a suite to `src/agents/__tests__/clientAudit.test.ts`. The existing suites monkey-patch each SDK's transport to capture the exact wire request for a realistic multi-turn solver input and assert on it; copy the Claude, Gemini or HuggingFace suite and adapt the expectations. This is how the current back-ends were validated without spending tokens. Add the transport to the no-live-network guards at the top of that file and of `subAgentLoop.test.ts`, and consider an opt-in live smoke script like `debug/geminiLiveSmoke.ts`.

The whole rest of the codebase, agents, tools, orchestration, usage tracking and the frontend, needs no change.

### Provider caveats

- **Hosted web search is OpenAI-only.** The Reference Seeker and the side-talk "web search" switch rely on OpenAI's server-side `web_search` tool. The Claude, Gemini and HuggingFace clients silently drop the `webSearch` flag (the audit script makes this visible), so `reference_seeker` and `side_talk` must stay on `openai` unless you implement a search tool for the other providers (Gemini's `googleSearch` grounding tool would be the natural candidate). `debug/agentLoopAudit.ts` asserts this invariant.
- **State handling differs.** OpenAI keeps chained sub-agent turns server-side via `previous_response_id`. Claude, Gemini and HuggingFace only emulate it with an evictable in-process cache, so for those providers the computation and verification sub-agents automatically switch to manual state (the full history is re-sent every turn). This is correct but uses more input tokens; prompt caching (`promptCacheKey`) mitigates the cost on OpenAI, Anthropic's cache reads are priced in `pricing.ts`, and Gemini's implicit caching shows up as `cached_tokens` automatically.
- **Gemini thought signatures.** Gemini 3 requires the opaque `thoughtSignature` returned on a function call to be echoed back on that exact part, or the next request fails with a 400. `geminiClient.ts` stores the signature on the `function_call` item (`__geminiThoughtSignature`), regroups parallel calls into one `model` content and places all `functionResponse` parts first in the following `user` content, exactly as the API demands. A call that reaches Gemini without a signature (history produced by another provider) is sent with the documented `skip_thought_signature_validator` sentinel and logged. Thought *summaries* are surfaced as `reasoning` items but not re-sent unless signed, which keeps input tokens down.
- **Images.** `fetch_artifact_file` delivers pictures to the model as `input_image` parts. Text-only chat models on HuggingFace (for example DeepSeek) may reject them; pick a vision-capable model for roles that inspect plots (`main_solver`, the verifiers, `side_talk`, `proof_narrator`) or accept that the model will only see the file's metadata. Gemini receives `data:` URLs as `inlineData` (all Gemini 3 models are multimodal).
- **Structured output.** Sub-agents end with a strict JSON-schema message. All four clients support it, but smaller open-weight models sometimes wrap the JSON in prose; `parseStructuredOutput` then returns `status: "error"` and the solver retries. If you see many `parse_error` results with a given model, raise its effort or choose a stronger one for that role. On Gemini, a JSON schema *together with* function declarations is a Gemini 3 feature; if an older Gemini model rejects the combination, the client retries the turn once without the schema (logged as a warning) and relies on the lenient parser.
- **Gemini has no "disable parallel tool calls" switch.** `parallelToolCalls: false` is ignored; every loop already dispatches N calls per turn, so this only affects how often the model batches them.
- **Reasoning-only replies.** A response with neither a function call nor a message (truncated or reasoning-only) yields `finalMessage === null`; every loop handles it by treating the turn as empty and continuing, up to the turn budget. Very small `maxOutputTokens` values make this frequent.
- **Pricing drift.** The bundled prices are list prices as of August 2026 (September 2026 for Gemini). Override them with `MODEL_PRICING_JSON` rather than trusting the defaults forever.



## Tuning the system prompts

All prompts are plain template strings in `backend/src/agents/systemPrompts.ts`, one exported constant per agent (`MAIN_SOLVER_PROMPT`, `SYMBOLIC_AGENT_PROMPT`, `NUMERICAL_AGENT_PROMPT`, `CY_ANALYST_AGENT_PROMPT`, `REFERENCE_SEEKER_AGENT_PROMPT`, `STEP_VERIFICATION_PROMPT`, `FULL_VERIFICATION_PROMPT`, `PROOF_NARRATOR_PROMPT`, `SIDE_TALK_PROMPT`) plus the notes that are appended when an optional tool or web search is enabled. Editing them requires no other change; `npm run dev` reloads on save.

The prompts share a structure that is worth preserving when you edit them:

- `<role>` and `<objective>` state what the agent is and what "done" means.
- `<tools>` restates each tool in one line, including its side effects, so the model does not have to infer them from the JSON schema alone.
- `<persistence>` / `<eagerness_calibration>` set how long the agent should keep going and when it should reach for a tool rather than assert.
- `<hard_rules>` are absolute prohibitions, each paired with the positive behaviour to adopt instead.
- `<workflow>` is the ordered procedure, and `<output_contract>` (sub-agents) or the `submit_final_answer` description (Main solver) fixes the exact shape of the final message.

Two practical notes. The CY Analyst prompt embeds the full CYTools documentation from `backend/docs/cytools-documentation.md` at startup; if you upgrade CYTools, regenerate that file. And several rules in the prompts are *also* enforced in code (the `result` entry after a computation, the verification gate before submission, the "print the result on the last line" rule the runner relies on); if you loosen a rule in the prompt, check `mainSolverAgent.ts` and `symbolicAgent.ts` so the prompt and the guards stay consistent, otherwise the model will be told one thing and blocked for doing it.

When you change a prompt, evaluate on a handful of problems you know well and read the ledger, not just the final answer: the number of superseded entries, the ratio of accepted to rejected step verifications, and the cost shown by the usage meter are the signals that tell you whether a prompt change helped.

## Development

**Backend scripts** (run from `backend/`):


| Command                                       | What it does                                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run dev`                                 | `tsx watch src/index.ts`: run from TypeScript sources, restart on change.                                                                   |
| `npm run build`                               | Compile to `dist/` with `tsc`.                                                                                                              |
| `npm start`                                   | Run the compiled build (`node dist/index.js`).                                                                                              |
| `npm run typecheck`                           | `tsc --noEmit`; the fastest way to find every exhaustive map you forgot.                                                                    |
| `npm test`                                    | Node's built-in test runner over `src/agents/__tests__/*.test.ts` and `src/export/__tests__/*.test.ts` via `tsx --test`. Mock-based, offline, free. |
| `npm run test:audit`                          | Only the provider client audit suite.                                                                                                       |
| `npx tsx debug/agentLoopAudit.ts`             | Offline audit of the routing matrices, pricing coverage and the known provider translation quirks.                                          |
| `RUN_LIVE=1 npx tsx debug/openaiLiveSmoke.ts` | Opt-in live smoke test of the exact Responses API request patterns the loops use, on the cheap fast-tier model (well under a cent per run). |
| `npx tsx _sandbox_smoke.ts`                   | Verifies the sandbox hides secrets from scripts and stops a runaway allocation (memory rlimit on Linux, wall-clock timeout on macOS).        |


**Frontend scripts** (run from `frontend/`):


| Command         | What it does                                          |
| --------------- | ----------------------------------------------------- |
| `npm start`     | `ng serve` on port 4200 with the `/api` proxy.        |
| `npm run build` | Production bundle in `dist/`.                         |
| `npm run watch` | Development build in watch mode.                      |
| `npm run lint`  | ESLint with `angular-eslint` and `typescript-eslint`. |


**Tests.** The three suites in `backend/src/agents/__tests__/` are the safety net for the two areas where bugs are expensive, and `backend/src/export/__tests__/export.test.ts` checks the session export (HTML and LaTeX renderers, the Markdown-to-HTML pipeline's sanitising of model-written HTML and figure rewriting, the Markdown-to-LaTeX converter's escaping, code shielding and math passthrough including nested delimiters, the zip layout) against a synthetic ledger fixture:

- `clientAudit.test.ts` monkey-patches the OpenAI, Anthropic, Gemini and HuggingFace SDK transports to capture the exact wire request built from a realistic solver input (instructions, ledger context, reasoning items, tool calls and outputs, images) across single calls and multi-turn loops, and checks that usage is mapped back correctly for cost tracking.
- `computationGuard.test.ts` covers the in-code guard rails in `mainSolverAgent.ts`: pending-computation blocking, the verification gate, their re-seeding from a persisted ledger, and the parse helpers.
- `subAgentLoop.test.ts` covers the sub-agent loops' state strategy per provider and the recovery from a lost `previous_response_id` chain.

Tests never hit the network. A test that accidentally routes to a real provider is treated as a bug; the audit script flags the matrix configuration that would cause it.

**Conventions.** TypeScript `strict` everywhere, `noUnusedLocals` / `noUnusedParameters` on the backend, 2-space indentation, double quotes, trailing commas. Domain ids are prefixed UUIDs (`conv_`, `ledg_`, `entry_` + 8 hex chars, `msg_`, `file_`) generated in `util/ids.ts`. HTTP handlers are wrapped with `asyncHandler` and throw `HttpError` subclasses from `util/errors.ts`. Anything the model can see (tool output, prompts) is a JSON string or a template literal, never an exception.

**Logging.** `pino` at `LOG_LEVEL`; set `LOG_LEVEL=debug` to see every HTTP request and provider retry. Pipe through `npx pino-pretty` for human-readable output during development.

## Troubleshooting

`Invalid environment configuration` **on startup.** A required variable is missing or malformed; the message lists the keys. `MONGODB_URI` and `MONGODB_DB` are always required, and at least one provider key must be set.

`Failed to spawn Python runner (<path>)`**.** `PYTHON_BIN` does not point at an executable interpreter. Use an absolute path and confirm `"$PYTHON_BIN" -c "import sympy, numpy, scipy, matplotlib"` succeeds.

**Every computation returns** `ModuleNotFoundError`**.** The interpreter in `PYTHON_BIN` is not the one you installed the libraries into (typically the system `python3` instead of the venv). Fix the path, restart the backend.

**Computations keep timing out.** Raise `PYTHON_TIMEOUT_MS` (symbolic / CY) or `PYTHON_HEAVY_TIMEOUT_MS` (numerical), and if you pinned `PYTHON_MAX_CPU_SECONDS` raise it too. Remember `fast` mode halves the wall-clock budget. Wolfram's cold start alone takes several seconds.

`No pricing configured for model; cost recorded as 0`**.** Add the model to `config/pricing.ts` or `MODEL_PRICING_JSON`. Harmless otherwise.

`Previous response with id ... not found` **in the logs.** OpenAI expired or lost a stored response mid sub-agent, or the Claude / Gemini / HuggingFace emulation cache evicted it. The sub-agent restarts once from its initial input automatically; if it recurs constantly on a non-OpenAI provider, that provider should be using manual state (check `useServerState` in `symbolicAgent.ts`).

`400 ... thought_signature` **or** `function call ... missing signature` **from Gemini.** A `function_call` reached `geminiClient.ts` without its `thoughtSignature`, usually because the history was produced by another provider (you switched `PROVIDER_MATRIX` mid-conversation) or was persisted before the switch. The client already sends the skip-validation sentinel for such calls; if Gemini still rejects the request, start a new conversation on the new provider.

**Solver stops with a prose message and the conversation shows** `paused`**.** The model ended its turn without calling `submit_final_answer`. Click **Resume**, or send a follow-up such as "continue and submit the verified answer". If it happens often with a particular model, strengthen the `<persistence>` section of `MAIN_SOLVER_PROMPT` or pick a stronger model for `main_solver`.

`submit_final_answer is blocked` **in the ledger.** Working as intended: the solver tried to finish without a fresh `verified` verdict. It will call `verify_full_solution` next.

**Conversation stuck in** `active` **after a crash.** On boot the orchestrator runs `recoverInterruptedRuns`, which flips such conversations to `paused` so they can be resumed. If the backend is up and a conversation still looks stuck, `POST /api/conversations/:id/pause` then **Resume**.

**No live updates in the browser.** The SSE stream is proxied by `ng serve`; make sure the backend is on port 3000 (or update `proxy.conf.json`). Behind a reverse proxy, disable response buffering for `/api/**/stream` (`X-Accel-Buffering: no` is already sent). The header shows *Reconnecting* with an attempt counter while the client retries.

**Plots do not appear.** The sandbox saves open matplotlib figures automatically, but only files under 2 MiB by default (`PYTHON_MAX_ARTIFACT_BYTES`); skipped files appear in the entry with a `skipped` reason. Scripts must write with relative paths; absolute paths under `/tmp` are not captured.

`Cannot delete a conversation while a solver run is in flight`**.** Pause it first.

**High costs.** Check the usage meter breakdown: verification roles at `high` effort dominate long proofs. Lower their effort in `EFFORT_MATRIX`, use `fast` mode for exploratory questions, or route the verifiers to a cheaper model family.

## Limitations and roadmap

Known limitations of the current design, roughly in the order you are likely to hit them:

- **No authentication.** The `userId` is a browser-generated token trusted by the backend. Run it on a private network or behind your own auth proxy.
- **Single-node orchestration.** In-flight runs, the event bus and the `previous_response_id` emulation caches live in the Node process. Two backend instances would not see each other's runs. Swapping the bus for Redis pub/sub and the in-flight map for a queue is the natural next step.
- **Sandbox is process-level, not a VM.** The runner uses a scrubbed environment, a temporary working directory and POSIX rlimits (CPU, memory, output), which is adequate for code written by your own agents on your own machine; it is not a substitute for a container or gVisor when running untrusted problems from untrusted users. macOS does not enforce `RLIMIT_AS`.
- **Ledger compaction is coarse.** The Main solver sees the last 100 entries verbatim (`MAX_LEDGER_ENTRIES_VERBATIM`) and only a type count for older ones. Very long proofs may lose early detail from the solver's view; the verifiers and `get_ledger_entries` still see everything.
- **Web search depends on OpenAI.** See the provider caveats.
- **No streaming of partial model output.** Entries arrive whole. Token-level streaming of the assistant message is not implemented.
- **Verification is probabilistic.** Adversarial re-derivation and numerical probing catch most errors but are not a proof assistant. A Lean / Coq export of the ledger would be a meaningful addition.

Ideas that fit the architecture and would be welcome contributions: a Redis-backed event bus, a Docker-based sandbox runner, additional sub-agents (graph theory, statistics, dimensional analysis, a proof-assistant bridge), a search tool for non-OpenAI providers, LaTeX / PDF export of the narrative, and an evaluation harness that replays a problem set across matrix configurations and reports accuracy and cost.

## Contributing

Contributions are welcome: bug reports, new sub-agents, provider back-ends, prompt improvements backed by ledger evidence, and documentation.

1. Fork and branch from `main`.
2. Keep changes focused. A new sub-agent, a routing change and a prompt tweak are three pull requests, not one; they are reviewed differently.
3. Before opening a PR run, from `backend/`: `npm run typecheck && npm test && npx tsx debug/agentLoopAudit.ts`, and from `frontend/`: `npm run lint && npm run build`. All four must pass.
4. For anything that touches an agent loop, a provider client or a guard, add or extend a test in `backend/src/agents/__tests__/`. Tests must stay offline.
5. For prompt changes, include in the PR description the problems you ran, and what changed in the ledgers (superseded entries, verification verdicts, cost). "It felt better" is not enough to review.
6. Never commit `.env`, API keys or generated artifacts. `backend/.gitignore` and `frontend/.gitignore` already exclude the usual suspects.
7. Update this README when you add a sub-agent, a role, a provider, an env variable or an endpoint; the tables above are meant to stay exhaustive.

If you plan a large change (new provider, new sandbox backend, auth), open an issue first to agree on the approach.

## License

Solver Agent is free software, released under the [GNU Affero General Public License, version 3](LICENSE) (AGPL-3.0-or-later). You may use, study, modify and redistribute it for any purpose, including in research and teaching, provided that any version you distribute, and any modified version you make available to others over a network (for example by hosting it as a service), is itself released under the AGPL with its complete source code. See the [`LICENSE`](LICENSE) file for the full terms. If these terms do not fit your intended use, contact the maintainers to discuss a separate license.

Copyright (C) 2026 Eliott Morgensztern.

Third-party components keep their own licenses: the Wolfram Engine is free for development use but licensed separately for other uses, CYTools is distributed under the GPL, and use of the OpenAI, Anthropic, Google Gemini and HuggingFace APIs is governed by their respective terms. `backend/docs/cytools-documentation.md` is a copy of the CYTools documentation and remains the property of its authors.