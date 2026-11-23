import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { pinSession, unpinSession, pinnedSessionIds, orderByPins, readPinsMap, writePinsMap, mergePinMaps } =
  await jiti.import("./session-pins.ts");

function memoryStorage() {
  const data = new Map();
  return {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
  };
}

test("pins stay in pin order ahead of the time order", () => {
  const storage = memoryStorage();
  pinSession("admin::pool", "old", storage);
  pinSession("admin::pool", "new", storage);
  assert.deepEqual(pinnedSessionIds("admin::pool", storage), ["new", "old"]);

  const ordered = orderByPins(
    [{ id: "c" }, { id: "old" }, { id: "a" }, { id: "new" }],
    (item) => item.id,
    pinnedSessionIds("admin::pool", storage),
  );
  assert.deepEqual(ordered.map((item) => item.id), ["new", "old", "c", "a"]);

  unpinSession("admin::pool", "new", storage);
  const after = orderByPins(
    [{ id: "c" }, { id: "old" }, { id: "a" }],
    (item) => item.id,
    pinnedSessionIds("admin::pool", storage),
  );
  assert.deepEqual(after.map((item) => item.id), ["old", "c", "a"]);
});

test("the shared map round-trips and remote scopes win on merge", () => {
  const local = memoryStorage();
  pinSession("admin::a", "s1", local);
  writePinsMap({ ...readPinsMap(local), "admin::b": ["s9"] }, local);
  assert.deepEqual(readPinsMap(local), { "admin::a": ["s1"], "admin::b": ["s9"] });

  const merged = mergePinMaps({ "admin::a": ["s1"], "admin::b": ["s9"] }, { "admin::a": ["s2"] });
  assert.deepEqual(merged, { "admin::a": ["s2"], "admin::b": ["s9"] });
  assert.deepEqual(mergePinMaps({ "admin::a": ["s1"] }, {}), { "admin::a": ["s1"] });
});
