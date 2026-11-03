import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { buildLabSearch } = await createJiti(import.meta.url).import("./lab-query.ts");

test("session replace keeps admin and drops cwd so reload opens the chat", () => {
  assert.equal(
    buildLabSearch("cwd=%2Fpool&admin=flyingu", { session: "abc", cwd: null }),
    "?session=abc&admin=flyingu",
  );
});

test("cwd replace keeps admin and drops session", () => {
  assert.equal(
    buildLabSearch("?session=abc&cwd=%2Fpool&admin=flyingu", { cwd: "/pool", session: null }),
    "?cwd=%2Fpool&admin=flyingu",
  );
});

test("empty current search still writes the patch", () => {
  assert.equal(buildLabSearch("", { session: "s1" }), "?session=s1");
  assert.equal(buildLabSearch(new URLSearchParams(), { cwd: "/pool" }), "?cwd=%2Fpool");
});

test("missing admin stays missing", () => {
  assert.equal(
    buildLabSearch("session=old", { session: "new" }),
    "?session=new",
  );
});
