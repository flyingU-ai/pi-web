import assert from "node:assert/strict";
import test from "node:test";

import {
  clearExpandedToolCalls,
  isPageReceiptTool,
  isToolCallExpanded,
  setToolCallExpanded,
} from "./tool-call-expansion.ts";

test("remembers expanded tool calls across remounts by toolCallId", () => {
  clearExpandedToolCalls();
  assert.equal(isToolCallExpanded("call_1"), false);

  setToolCallExpanded("call_1", true);
  assert.equal(isToolCallExpanded("call_1"), true);
  assert.equal(isToolCallExpanded("call_2"), false);

  setToolCallExpanded("call_1", false);
  assert.equal(isToolCallExpanded("call_1"), false);
});

test("ignores tool calls without an id", () => {
  clearExpandedToolCalls();
  setToolCallExpanded(undefined, true);
  assert.equal(isToolCallExpanded(undefined), false);
});

test("page_accept and page screenshots are receipt tools", () => {
  assert.equal(isPageReceiptTool({
    toolName: "bash",
    input: { command: "node pi_engine/scripts/page_accept.mjs --tab benchmark" },
  }), true);
  assert.equal(isPageReceiptTool({
    toolName: "read",
    input: { path: "/dataset/coco_fu/AgentSMarkDatePoolv2/.agent/pi-web/memory/page-distribution.png" },
  }), true);
  assert.equal(isPageReceiptTool({
    toolName: "bash",
    input: { command: "ls smt_benchmark | head" },
  }), false);
});
