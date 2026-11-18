import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { accountLeaf } = await createJiti(import.meta.url).import("./admin-leaf.ts");

test("ascii logins keep their directory and chinese names do not collide", () => {
  assert.equal(accountLeaf("flyingu"), "flyingu");
  assert.equal(accountLeaf("FlyingU"), "flyingu");
  assert.equal(accountLeaf("zhuyude"), "zhuyude");
  assert.equal(accountLeaf("朱世新"), "a_e91f79d9e0adf148");
  assert.equal(accountLeaf("朱裕德"), "a_5a6490f4be5d6613");
  assert.notEqual(accountLeaf("朱世新"), accountLeaf("朱裕德"));
  assert.equal(accountLeaf("_"), "");
  assert.equal(accountLeaf(""), "");
});
