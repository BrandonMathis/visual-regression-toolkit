import type { VisualResultStatus } from "../contracts/types.js";
export function exitCodeForStatus(status: VisualResultStatus): 0 | 1 | 2 {
  return status === "pass" ? 0 : status === "visual-diff" ? 2 : 1;
}
