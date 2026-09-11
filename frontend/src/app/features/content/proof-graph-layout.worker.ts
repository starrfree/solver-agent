/**
 * Web worker hosting the ELK.js layout engine for the proof graph.
 *
 * `elk-worker.js` detects that it is running inside a worker (`document` is
 * undefined) and registers its own `onmessage` dispatcher speaking the
 * elk-api message protocol, so a side-effect import is all that is needed.
 * The ~1.4 MB engine lives only in this lazily loaded worker chunk: it never
 * weighs down the main bundle, and layout never blocks the UI thread. The
 * main-thread counterpart is `ProofGraphLayoutService`, which drives this
 * worker through the lightweight `elkjs/lib/elk-api` client.
 */
import "elkjs/lib/elk-worker.js";
