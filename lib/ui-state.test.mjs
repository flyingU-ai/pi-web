import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const pool = mkdtempSync(join(tmpdir(), "pi-web-ui-state-"));
process.env.ANNOTATION_WORKSPACE_ROOT = pool;
delete process.env.PI_WEB_OPEN_FOLDER;

const { normalizeUiState, readUiState, uiStatePath, writeUiState } =
  await createJiti(import.meta.url, { interopDefault: true, moduleCache: false }).import("./ui-state.ts");

test.after(() => rmSync(pool, { recursive: true, force: true }));

test("only the two whitelisted keys survive", () => {
  const state = normalizeUiState({
    pins: { "admin::pool": ["a", "", 42, "a", "b"] },
    unread: ["u1", null, "u1", "u2"],
    secret: "nope",
  });
  assert.deepEqual(state, { pins: { "admin::pool": ["a", "b"] }, unread: ["u1", "u2"] });
  assert.deepEqual(normalizeUiState(null), {});
  assert.deepEqual(normalizeUiState({ pins: [{ x: 1 }] }), {});
});

test("writes land under the warehouse and read back per admin", () => {
  assert.equal(uiStatePath("huyufei"), join(pool, ".agent", "pi-web", "ui-state", "huyufei.json"));
  assert.equal(writeUiState("huyufei", { pins: { "huyufei::pool": ["s1"] } }), true);
  assert.deepEqual(readUiState("huyufei"), { pins: { "huyufei::pool": ["s1"] } });
  assert.deepEqual(readUiState("someone-else"), {});
  // sanitizeWebAdmin turns separators into `_`, so the file stays in one dir.
  assert.equal(uiStatePath("../etc"), join(pool, ".agent", "pi-web", "ui-state", ".._etc.json"));
  assert.equal(uiStatePath(""), "");
});

test("a corrupt file falls back to empty instead of throwing", () => {
  writeFileSync(uiStatePath("broken"), "{not json", "utf8");
  assert.deepEqual(readUiState("broken"), {});
});
