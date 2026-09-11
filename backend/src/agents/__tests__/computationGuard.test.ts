/**
 * Computation-interpretation guard suite.
 *
 * Proves that the main solver enforces the "a computation must be interpreted
 * by a following 'result' entry" invariant: the pure helpers behind the loop
 * guard in mainSolverAgent decide blocking and pending-state transitions
 * deterministically, without DB or network access.
 *
 * Run: `npm test` (from backend/).
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { ResponseFunctionToolCall } from "openai/resources/responses/responses";

import { LedgerEntry, LedgerEntryTool, LedgerEntryType } from "../../db/types";
import {
  isAllowedWhilePending,
  parseAppendArgs,
  parseComputationEntryId,
  parseFullVerificationVerdict,
  parseOk,
  parseStepVerdict,
  seedFullSolutionVerified,
  seedPendingComputations,
} from "../mainSolverAgent";

function entry(
  id: string,
  type: LedgerEntryType,
  dependsOn: string[] = [],
  status: LedgerEntry["status"] = "accepted",
): LedgerEntry {
  return {
    _id: id,
    ledgerId: "ledger-1",
    type,
    status,
    dependsOn,
    content: { summary: `${type} ${id}` },
    tool: "main_solver",
    createdAt: new Date(),
  };
}

function verificationEntry(
  id: string,
  tool: LedgerEntryTool,
  verdict: "verified" | "rejected" | "accepted",
): LedgerEntry {
  return {
    _id: id,
    ledgerId: "ledger-1",
    type: "verification",
    status: verdict === "rejected" ? "rejected" : "accepted",
    dependsOn: [],
    content: { summary: `${tool} ${id}`, verdict },
    tool,
    createdAt: new Date(),
  };
}

function appendCall(args: unknown): ResponseFunctionToolCall {
  return {
    type: "function_call",
    call_id: "call-1",
    name: "ledger_append_entry",
    arguments: JSON.stringify(args),
  } as ResponseFunctionToolCall;
}

describe("isAllowedWhilePending", () => {
  test("only a 'result' append or an artifact read may run while pending", () => {
    assert.equal(isAllowedWhilePending("ledger_append_entry", true), true);
    assert.equal(isAllowedWhilePending("fetch_artifact_file", false), true);

    for (const name of [
      "symbolic_compute",
      "numerical_compute",
      "cy_analyst_compute",
      "verify_step",
      "verify_full_solution",
      "submit_final_answer",
      "ledger_supersede_entry",
    ]) {
      assert.equal(isAllowedWhilePending(name, false), false, `${name} blocked`);
    }
    // A non-result ledger_append_entry (e.g. type 'derivation') is also blocked.
    assert.equal(isAllowedWhilePending("ledger_append_entry", false), false);
  });
});

describe("seedPendingComputations", () => {
  test("flags a trailing computation with no later dependant", () => {
    const entries = [
      entry("a1", "assumption"),
      entry("c1", "symbolic_computation", ["a1"]),
    ];
    const pending = seedPendingComputations(entries);
    assert.deepEqual([...pending], ["c1"]);
  });

  test("does not flag a computation interpreted by a later entry", () => {
    const entries = [
      entry("c1", "numerical_computation", []),
      entry("r1", "result", ["c1"]),
    ];
    assert.equal(seedPendingComputations(entries).size, 0);
  });

  test("treats legacy derivation-interpreted computations as interpreted", () => {
    const entries = [
      entry("c1", "symbolic_computation", []),
      entry("d1", "derivation", ["c1"]),
    ];
    assert.equal(seedPendingComputations(entries).size, 0);
  });

  test("ignores non-accepted computations", () => {
    const entries = [entry("c1", "symbolic_computation", [], "rejected")];
    assert.equal(seedPendingComputations(entries).size, 0);
  });

  test("flags a trailing cy_analyst_computation with no later dependant", () => {
    const entries = [
      entry("a1", "assumption"),
      entry("c1", "cy_analyst_computation", ["a1"]),
    ];
    assert.deepEqual([...seedPendingComputations(entries)], ["c1"]);
  });

  test("does not flag a cy_analyst_computation interpreted by a later result", () => {
    const entries = [
      entry("c1", "cy_analyst_computation", []),
      entry("r1", "result", ["c1"]),
    ];
    assert.equal(seedPendingComputations(entries).size, 0);
  });
});

describe("parse helpers", () => {
  test("parseAppendArgs extracts type and dependsOn, tolerating bad JSON", () => {
    assert.deepEqual(parseAppendArgs(appendCall({ type: "result", dependsOn: ["c1"] })), {
      type: "result",
      dependsOn: ["c1"],
    });
    const bad = { ...appendCall({}), arguments: "{not json" } as ResponseFunctionToolCall;
    assert.equal(parseAppendArgs(bad), null);
  });

  test("parseComputationEntryId only returns the id on ok=true", () => {
    assert.equal(
      parseComputationEntryId(JSON.stringify({ ok: true, entryId: "c9" })),
      "c9",
    );
    assert.equal(
      parseComputationEntryId(JSON.stringify({ ok: false, entryId: "c9" })),
      null,
    );
    assert.equal(parseComputationEntryId("garbage"), null);
  });

  test("parseOk reflects the ok flag", () => {
    assert.equal(parseOk(JSON.stringify({ ok: true })), true);
    assert.equal(parseOk(JSON.stringify({ ok: false })), false);
    assert.equal(parseOk("garbage"), false);
  });

  test("parseFullVerificationVerdict extracts verified/rejected only", () => {
    assert.equal(
      parseFullVerificationVerdict(JSON.stringify({ ok: true, verdict: "verified" })),
      "verified",
    );
    assert.equal(
      parseFullVerificationVerdict(JSON.stringify({ ok: true, verdict: "rejected" })),
      "rejected",
    );
    assert.equal(parseFullVerificationVerdict(JSON.stringify({ ok: true })), null);
    assert.equal(parseFullVerificationVerdict("garbage"), null);
  });

  test("parseStepVerdict extracts accepted/rejected only", () => {
    assert.equal(
      parseStepVerdict(JSON.stringify({ ok: true, verdict: "accepted" })),
      "accepted",
    );
    assert.equal(
      parseStepVerdict(JSON.stringify({ ok: true, verdict: "rejected" })),
      "rejected",
    );
    assert.equal(parseStepVerdict(JSON.stringify({ ok: true })), null);
    assert.equal(parseStepVerdict("garbage"), null);
  });
});

describe("seedFullSolutionVerified", () => {
  test("true when the last full verification is verified and nothing changed after", () => {
    const entries = [
      entry("f1", "final_answer"),
      verificationEntry("v1", "full_verification", "verified"),
    ];
    assert.equal(seedFullSolutionVerified(entries), true);
  });

  test("false when a solution-affecting entry was appended after the verification", () => {
    const entries = [
      entry("f1", "final_answer"),
      verificationEntry("v1", "full_verification", "verified"),
      entry("d1", "derivation", ["f1"]),
    ];
    assert.equal(seedFullSolutionVerified(entries), false);
  });

  test("a step-verification entry after the full verification does not disarm it", () => {
    const entries = [
      entry("f1", "final_answer"),
      verificationEntry("v1", "full_verification", "verified"),
      verificationEntry("s1", "step_verification", "accepted"),
    ];
    assert.equal(seedFullSolutionVerified(entries), true);
  });

  test("false when the last full verification was rejected", () => {
    const entries = [
      entry("f1", "final_answer"),
      verificationEntry("v1", "full_verification", "rejected"),
    ];
    assert.equal(seedFullSolutionVerified(entries), false);
  });

  test("false when no full verification exists", () => {
    const entries = [entry("f1", "final_answer")];
    assert.equal(seedFullSolutionVerified(entries), false);
  });

  test("uses the most recent full verification (re-verified after a follow-up)", () => {
    const entries = [
      entry("f1", "final_answer"),
      verificationEntry("v1", "full_verification", "rejected"),
      entry("c1", "correction", ["f1"]),
      entry("f2", "final_answer"),
      verificationEntry("v2", "full_verification", "verified"),
    ];
    assert.equal(seedFullSolutionVerified(entries), true);
  });
});

describe("guard lifecycle (simulated loop)", () => {
  test("computation blocks other tools until a result entry clears it", () => {
    const pending = seedPendingComputations([]);
    assert.equal(pending.size, 0);

    // An accepted computation becomes pending.
    const compOutput = JSON.stringify({ ok: true, entryId: "c1" });
    const compId = parseComputationEntryId(compOutput);
    assert.ok(compId);
    pending.add(compId);

    // A verify_step while pending is blocked (not allowed).
    assert.equal(
      pending.size > 0 && !isAllowedWhilePending("verify_step", false),
      true,
    );

    // The interpreting 'result' append is allowed and clears the computation.
    const resultCall = appendCall({ type: "result", dependsOn: ["c1"] });
    const args = parseAppendArgs(resultCall);
    assert.equal(args?.type, "result");
    assert.equal(isAllowedWhilePending(resultCall.name, args?.type === "result"), true);
    if (parseOk(JSON.stringify({ ok: true, entryId: "r1" }))) {
      for (const dep of args?.dependsOn ?? []) pending.delete(dep);
    }
    assert.equal(pending.size, 0);

    // With nothing pending, other tools run again.
    assert.equal(
      pending.size > 0 && !isAllowedWhilePending("verify_step", false),
      false,
    );
  });
});
