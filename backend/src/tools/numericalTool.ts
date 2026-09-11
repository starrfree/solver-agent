import { runNumericalAgent } from "../agents/numericalAgent";
import { makeComputationHandler } from "./symbolicTool";
import { ToolHandler } from "./types";

export const numericalComputeHandler: ToolHandler = makeComputationHandler(
  "numerical_compute",
  runNumericalAgent,
);
