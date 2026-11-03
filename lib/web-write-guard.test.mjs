import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

test("does not register a product write-guard extension", () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "web-write-guard.ts"), "utf8");
  assert.equal(src.includes("createProductWriteGuardExtension"), false);
  assert.equal(src.includes("WRITE_DENIED"), false);
});
