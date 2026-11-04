import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { clientWebAdmin } from "./web-admin-client.ts";

const source = readFileSync(new URL("./web-admin-client.ts", import.meta.url), "utf8");

test("iframe query yields the lab admin", () => {
  assert.equal(clientWebAdmin("?admin=flyingu&cwd=/pool"), "flyingu");
  assert.equal(clientWebAdmin(""), "");
});

test("browser fetches attach x-aoi-admin without importing Node ALS", () => {
  assert.match(source, /CLIENT_ADMIN_HEADER = "x-aoi-admin"/);
  assert.match(source, /credentials: "same-origin"/);
  assert.doesNotMatch(source, /web-admin-scope/);
});
