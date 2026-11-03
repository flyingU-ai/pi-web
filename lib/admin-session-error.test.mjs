import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const {
  ADMIN_REQUIRED_HINT,
  isAdminRequiredFailure,
  messageForApiFailure,
} = await createJiti(import.meta.url).import("./admin-session-error.ts");

test("401 admin required is not shown as a bare HTTP status", async () => {
  assert.equal(isAdminRequiredFailure(401, { error: "admin required" }), true);
  assert.equal(isAdminRequiredFailure(403, { error: "admin required" }), false);
  const res = new Response(JSON.stringify({ error: "admin required" }), { status: 401 });
  assert.equal(await messageForApiFailure(res), ADMIN_REQUIRED_HINT);
});
