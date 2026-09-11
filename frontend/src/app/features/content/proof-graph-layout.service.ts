import { Injectable } from "@angular/core";
import type { ELK } from "elkjs/lib/elk-api";

import { LedgerEntry } from "../../core/api/dto";
import { GraphLayout, buildElkGraph, parseElkResult } from "./proof-graph-layout";

/**
 * Bridges the proof graph component and the ELK layout web worker.
 *
 * The main thread only loads the lightweight `elk-api` client; the layout
 * engine itself lives in the lazily loaded worker chunk (see
 * `proof-graph-layout.worker.ts`). elk-api matches responses to requests by
 * id internally, so concurrent or out-of-order layouts (from rapid
 * SSE-driven updates) can never resolve the wrong promise.
 */
@Injectable({ providedIn: "root" })
export class ProofGraphLayoutService {
  private elk: ELK | null = null;

  async layout(entries: readonly LedgerEntry[]): Promise<GraphLayout> {
    const elk = await this.ensureElk();
    const { root, edges, entries: ordered } = buildElkGraph(entries);
    const laidOut = await elk.layout(root);
    return parseElkResult(laidOut, ordered, edges);
  }

  private async ensureElk(): Promise<ELK> {
    if (this.elk) return this.elk;
    if (typeof Worker === "undefined") {
      throw new Error("Web workers are not available");
    }
    const { default: ElkConstructor } = await import("elkjs/lib/elk-api.js");
    this.elk ??= new ElkConstructor({
      workerFactory: () =>
        new Worker(new URL("./proof-graph-layout.worker", import.meta.url), {
          type: "module",
        }),
    });
    return this.elk;
  }
}
