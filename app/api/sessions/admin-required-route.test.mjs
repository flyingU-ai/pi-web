import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const routeSrc = readFileSync(new URL("./route.ts", import.meta.url), "utf8");

test("warehouse session list fails closed without admin", () => {
  assert.match(routeSrc, /warehouseRoot\(\) && !adminFromRequest\(req\)/);
  assert.match(routeSrc, /status: 401/);
  assert.match(routeSrc, /admin required/);
  assert.doesNotMatch(routeSrc, /_no_admin/);
});
