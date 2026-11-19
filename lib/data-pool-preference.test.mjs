import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const {
  dataPoolStorageScope,
  readSelectedDataPoolId,
  writeSelectedDataPoolId,
} = await createJiti(import.meta.url).import("./data-pool-preference.ts");

test("data pool choice stays in this browser, keyed by admin and cwd", () => {
  const mem = new Map();
  const storage = {
    getItem: (key) => mem.get(key) ?? null,
    setItem: (key, value) => { mem.set(key, value); },
  };
  const scope = dataPoolStorageScope("/dataset/coco_fu/AgentSMarkDatePoolv2", "flyingu");
  assert.equal(readSelectedDataPoolId(scope, storage), "");
  writeSelectedDataPoolId(scope, "next", storage);
  assert.equal(readSelectedDataPoolId(scope, storage), "next");
  const other = dataPoolStorageScope("/dataset/coco_fu/AgentSMarkDatePoolv2", "gaolele");
  assert.equal(readSelectedDataPoolId(other, storage), "");
});
