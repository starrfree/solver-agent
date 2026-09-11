import { runReferenceSeekerAgent } from "../agents/referenceSeekerAgent";
import { makeComputationHandler } from "./symbolicTool";
import { ToolHandler } from "./types";

export const seekReferencesHandler: ToolHandler = makeComputationHandler(
  "seek_references",
  runReferenceSeekerAgent,
);
