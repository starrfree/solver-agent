# Solver Agent — Backend

Express + TypeScript service that orchestrates the **Main Solver Agent** and
specialized tool agents (symbolic, numerical, the opt-in Calabi-Yau Analyst,
step verification, full verification) on top of the OpenAI Responses API.
Conversations and the ledger are persisted in MongoDB. Real-time progress is
pushed to clients over Server-Sent Events.

See the [root README](../README.md) for the full architecture, installation
and extension guide.

## Architecture (one paragraph)

The HTTP layer (`src/routes/`) creates a conversation + ledger pair, persists the
user's first message and asynchronously kicks off the Main Solver Agent through
`services/solverOrchestrator.ts`. The orchestrator runs a manual-state Responses
API loop (`agents/mainSolverAgent.ts`) that exposes a strict tool schema for the
ledger, the two computation tools, the two verification tools and a
`submit_final_answer` tool. Each tool either writes to MongoDB and emits a
typed event on the in-process `eventBus`, or itself spins up a subordinate
Responses API agent (`agents/{symbolic,numerical,stepVerification,fullVerification}Agent.ts`).
The two computation sub-agents drive a Python sandbox (`python/runner.py`) that
runs sympy / numpy / scipy / matplotlib in an isolated tmp directory and
returns artifacts (figures, files) as base64 blobs. Clients subscribe to the
SSE stream at `/api/conversations/:id/stream` and see the ledger materialize
entry-by-entry while the agent thinks.

## Setup

```bash
# 1. Node deps
cd backend
npm install

# 2. Python venv used by the symbolic / numerical sandbox
python3 -m venv python/.venv
python/.venv/bin/pip install -r python/requirements.txt

# 3. Environment
cp .env.example .env
# fill in MONGODB_URI password, OPENAI_API_KEY, and point PYTHON_BIN at
# the venv interpreter, e.g. PYTHON_BIN=$(pwd)/python/.venv/bin/python

# 4. Run
npm run dev      # tsx watch
# or
npm run build && npm start
```

### Computation prerequisites (optional but recommended)

The Python sandbox can shell out via `subprocess`, which lets the computation
sub-agents use two extra engines when they are available on `PATH`:

- **C++ toolchain** (`g++`, supporting `-O3 -std=c++17`) — the **numerical**
  sub-agent compiles and runs C++ for very heavy combinatorics / large search.
  Ships with the Xcode Command Line Tools on macOS (`xcode-select --install`)
  or `build-essential` on Debian/Ubuntu.
- **Wolfram engine** (`wolframscript`) — the **symbolic** sub-agent uses
  Mathematica for hard closed-form integrals, `FullSimplify`, special functions
  and `Reduce`/`Solve` over the reals. Install the free
  [Wolfram Engine](https://www.wolfram.com/engine/) (or a licensed Mathematica),
  then activate it once with a Wolfram account: `wolframscript -activate`.
  Verify with `wolframscript -code '1+1'`.

Both are optional: if a tool is missing the agents simply fall back to pure
Python (numpy/scipy for the numerical agent, sympy for the symbolic agent).

### Calabi-Yau Analyst / CYTools (optional)

The opt-in **Calabi-Yau Analyst** sub-agent is backed by
[CYTools](https://cy.tools) (reflexive polytopes, toric varieties,
triangulations, Hodge numbers, intersection numbers, Mori / Kähler cones, the
Kreuzer-Skarke database). CYTools is a Python package with native solvers that
are best provided through a dedicated conda environment. Because the sandbox
runs whatever `PYTHON_BIN` points at, the simplest setup is a single conda env
that has CYTools **and** the base sandbox libraries, and pointing `PYTHON_BIN`
at it:

```bash
# 1. Create a conda env with the native solvers + base sandbox libs.
#    (topcom is not on conda-forge for Apple Silicon; CYTools' default CGAL /
#     bundled triangulation backends do not need it.)
conda create -y -n cytools -c conda-forge python=3.11 \
  palp normaliz cgal numpy scipy sympy matplotlib

# 2. Install CYTools into it (bundles pypalp / triangulumancer, etc.).
conda run -n cytools pip install "cytools>=1.4"

# 3. Point the sandbox at that interpreter in .env:
#    PYTHON_BIN=$(conda run -n cytools which python)
#    e.g. PYTHON_BIN=/Users/<you>/miniforge3/envs/cytools/bin/python

# 4. Smoke test (quintic → h11=1, h21=101, chi=-200):
conda run -n cytools python -c "from cytools import Polytope; \
p=Polytope([[1,0,0,0],[0,1,0,0],[0,0,1,0],[0,0,0,1],[-1,-1,-1,-1]]); \
cy=p.triangulate().get_cy(); print(cy.h11(), cy.h21(), cy.chi())"
```

Notes:

- CYTools caches to `~/Library/Caches/CYTools` (macOS) / `$XDG_CACHE_HOME`
  (Linux); the sandbox process must be able to write there.
- The optional **MOSEK** solver is license-gated and is skipped.
- CYTools is entirely optional: the Calabi-Yau Analyst is only offered when a
  conversation enables it, and the sub-agent's prompt tells it to fall back to
  sympy / numpy when `import cytools` (or a specific solver) is unavailable, so
  the pipeline never hard-fails.

## Environment variables

See [`.env.example`](./.env.example). Required: `MONGODB_URI`, `MONGODB_DB`,
`OPENAI_API_KEY`. Everything else has sensible defaults.

Sandbox / computation knobs worth noting:

- `PYTHON_TIMEOUT_MS` (default `60000`) — per-`run_python` wall-clock cap used by
  the symbolic sub-agent (halved in "fast" reasoning mode). Raised from the old
  30s so the Wolfram kernel's cold start plus real work fits comfortably.
- `PYTHON_HEAVY_TIMEOUT_MS` (default `240000`) — larger wall-clock cap used by
  the **numerical** sub-agent so compiled C++ search / combinatorics has room to
  finish.
- `PYTHON_MAX_CPU_SECONDS` — if you pin this in `.env`, raise it to match the
  heavy timeout (when unset it is derived from the wall-clock cap automatically).
- `PYTHON_MAX_MEMORY_BYTES` (default 2 GiB) — the `RLIMIT_AS`/`RLIMIT_DATA` cap
  is inherited by C++ binaries and the Wolfram kernel. macOS does not reliably
  enforce `RLIMIT_AS`, but on Linux a large Wolfram kernel may need this raised.

## REST surface

| Method | Path                                         | Description                                       |
| ------ | -------------------------------------------- | ------------------------------------------------- |
| GET    | `/api/health`                                | Liveness check                                    |
| GET    | `/api/conversations?userId=...`              | List conversations (most-recent first)            |
| POST   | `/api/conversations`                         | Create conversation + ledger, kicks off solver    |
| GET    | `/api/conversations/:id`                     | Conversation document                             |
| PATCH  | `/api/conversations/:id`                     | Update title / status (e.g. archive)              |
| GET    | `/api/conversations/:id/messages`            | All conversation messages                         |
| POST   | `/api/conversations/:id/messages`            | Append a user message and resume the solver       |
| GET    | `/api/conversations/:id/ledger`              | Ledger document                                   |
| GET    | `/api/conversations/:id/ledger/entries`      | Ledger entries (supports `?since=<ISO>`)          |
| GET    | `/api/conversations/:id/stream`              | SSE stream of ledger + message events             |

### POST `/api/conversations`

```json
{ "userId": "u_demo", "problemStatement": "Compute the integral of ..." }
```

Response: `201 { conversationId, ledgerId }`. Solver runs in the background;
subscribe to the SSE stream to see entries as they appear.

### POST `/api/conversations/:id/messages`

```json
{ "content": "Could you also check the boundary case x=0?" }
```

Response: `202`. Solver resumes asynchronously.

### SSE event types

```
event: ledger.entry.added
data:  { ledgerId, entry: <LedgerEntry> }

event: ledger.entry.updated
data:  { ledgerId, entry: <LedgerEntry> }

event: ledger.status.changed
data:  { ledgerId, status }

event: conversation.message.added
data:  { conversationId, message: <ConversationMessage> }

event: heartbeat
data:  { ts }
```

## Operational notes

- The orchestrator runs **in-process**; the EventBus and solver state are local
  to the Node instance. Sufficient for a single-node deployment; for HA you
  would swap `eventBus` for Redis pub/sub and persist solver state via a queue.
- Tool failures (Python errors, OpenAI rate limits, timeouts) are returned to
  the model as `function_call_output` rather than thrown — the agent is
  expected to recover, retry or escalate (e.g. symbolic → numerical fallback
  on repeated timeouts).
- All ledger writes are append-only. A "correction" creates a new entry that
  references the rejected one; the rejected entry's `status` is flipped to
  `superseded` (the only allowed in-place mutation) and the change is itself
  emitted as `ledger.entry.updated`.
