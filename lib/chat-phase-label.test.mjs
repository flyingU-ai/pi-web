import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { phaseLabel } = await jiti.import("./chat-phase-label.ts");

/** Translate that echoes the key plus params, so assertions read as intent. */
const t = (key, params = {}) => (Object.keys(params).length ? `${key}:${JSON.stringify(params)}` : key);

test("reports the phase the stream is actually in", () => {
  assert.equal(phaseLabel({ kind: "waiting_model" }, t), "chat.waitingGenerate");
  assert.equal(phaseLabel({ kind: "running_command" }, t), "chat.runningCommand");
  assert.equal(phaseLabel(null, t), null);
  assert.equal(phaseLabel(undefined, t), null);
});

test("describes the tools currently running", () => {
  const one = phaseLabel({ kind: "running_tools", tools: [{ name: "Read" }] }, t);
  assert.equal(one, 'chat.runningNamedTool:{"name":"Read"}');

  assert.equal(
    phaseLabel({ kind: "running_tools", tools: [{ name: "Read" }, { name: "Grep" }] }, t),
    'chat.runningTools:{"names":"Read, Grep"}',
  );
  assert.equal(phaseLabel({ kind: "running_tools", tools: [] }, t), "chat.runningTool");

  // Progress on the newest tool is appended, not the first one's.
  assert.equal(
    phaseLabel({ kind: "running_tools", tools: [{ name: "Read" }, { name: "Bash", progress: "3/5" }] }, t),
    'chat.runningNamedTool:{"name":"Bash"} 3/5',
  );
});

test("compaction overrides the model phase so a long compaction does not read as a hang", () => {
  // The reported bug: a turn enters auto-compaction, the stream has not produced a token
  // yet, and the status still says "waiting for model".
  assert.equal(phaseLabel({ kind: "waiting_model" }, t, true), "chat.compacting");
  assert.equal(phaseLabel({ kind: "running_tools", tools: [{ name: "Read" }] }, t, true), "chat.compacting");
  assert.equal(phaseLabel(null, t, true), "chat.compacting");
});

test("compaction flag off keeps the phase label", () => {
  assert.equal(phaseLabel({ kind: "waiting_model" }, t, false), "chat.waitingGenerate");
  assert.equal(phaseLabel({ kind: "running_command" }, t, false), "chat.runningCommand");
});

test("waiting_model is honest about bash, down llama, and fat prefill", () => {
  assert.equal(
    phaseLabel({ kind: "waiting_model" }, t, { bashRunning: true }),
    "chat.runningCommand",
  );
  assert.equal(
    phaseLabel({ kind: "waiting_model" }, t, { llamaDown: true }),
    "chat.waitingModelDown",
  );
  assert.equal(
    phaseLabel({ kind: "waiting_model" }, t, { contextPercent: 31 }),
    'chat.waitingPrefill:{"percent":31}',
  );
  assert.equal(
    phaseLabel({ kind: "waiting_model" }, t, { contextPercent: 0.31 }),
    'chat.waitingPrefill:{"percent":31}',
  );
});
