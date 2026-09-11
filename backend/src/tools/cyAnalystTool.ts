import { runCyAnalystAgent } from "../agents/cyAnalystAgent";
import { makeComputationHandler } from "./symbolicTool";
import { ToolHandler } from "./types";

export const cyAnalystComputeHandler: ToolHandler = makeComputationHandler(
  "cy_analyst_compute",
  runCyAnalystAgent,
);
