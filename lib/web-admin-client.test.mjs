import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clientWebAdmin } from "./web-admin-client.ts";

const source = readFileSync(new URL("./web-admin-client.ts", import.meta.url), "utf8");

test("readable leaf cookie scopes this browser", () => {
  assert.equal(clientWebAdmin("aoi_leaf=flyingu"), "flyingu");
  assert.equal(clientWebAdmin("other=1; aoi_leaf=flyingu"), "flyingu");
  assert.equal(clientWebAdmin("?admin=flyingu"), "");
  assert.equal(clientWebAdmin(""), "");
});

test("browser fetches send the leaf this document opened with", () => {
  assert.match(source, /credentials: "same-origin"/);
  assert.match(source, /aoi_leaf_bound/);
  assert.match(source, /headers.set\("x-aoi-admin", leaf\)/);
  assert.doesNotMatch(source, /web-admin-scope/);
});
