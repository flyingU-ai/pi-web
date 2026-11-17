import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { interopDefault: true, moduleCache: false });
const { pinSession, unpinSession, pinnedSessionIds, orderByPins } = await jiti.import("./session-pins.ts");

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
