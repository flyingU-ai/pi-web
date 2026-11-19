import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const root = mkdtempSync(join(tmpdir(), "pi-web-data-pools-"));
const live = join(root, "AgentSMarkDatePoolv2");
const next = join(root, "agentsmark_v2", "AgentSMarkDatePoolv2");
mkdirSync(live, { recursive: true });
mkdirSync(next, { recursive: true });
writeFileSync(join(live, "keep.txt"), "live");
writeFileSync(join(next, "keep.txt"), "next");

const prev = {
  ANNOTATION_WORKSPACE_ROOT: process.env.ANNOTATION_WORKSPACE_ROOT,
  PI_WEB_OPEN_FOLDER: process.env.PI_WEB_OPEN_FOLDER,
  PI_WEB_DATA_POOLS: process.env.PI_WEB_DATA_POOLS,
};
process.env.ANNOTATION_WORKSPACE_ROOT = live;
delete process.env.PI_WEB_OPEN_FOLDER;
delete process.env.PI_WEB_DATA_POOLS;

const {
  extraDataPoolRoots,
  isCatalogDataPoolRoot,
  isPrimaryDataPoolPath,
  isReadonlyDataPoolPath,
  listDataPools,
  resetDataPoolsCache,
} = await createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
}).import("./data-pools.ts");

test.after(() => {
  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
});

test("no extra env keeps only the live warehouse", () => {
  resetDataPoolsCache();
  delete process.env.PI_WEB_DATA_POOLS;
  const pools = listDataPools();
  assert.equal(pools.length, 1);
  assert.equal(pools[0].role, "primary");
  assert.equal(pools[0].readonly, false);
  assert.equal(extraDataPoolRoots().length, 0);
  assert.equal(isPrimaryDataPoolPath(join(live, "_incoming")), true);
  assert.equal(isReadonlyDataPoolPath(join(next, "smt")), false);
});

test("pipe env attaches a readonly snapshot without replacing primary", () => {
  resetDataPoolsCache();
  process.env.PI_WEB_DATA_POOLS = `next|新池 volume3|${next}|attach`;
  const pools = listDataPools();
  assert.equal(pools.length, 2);
  assert.equal(pools[0].role, "primary");
  assert.equal(pools[1].role, "attach");
  assert.equal(pools[1].readonly, true);
  assert.equal(pools[1].label, "新池 volume3");
  assert.equal(isCatalogDataPoolRoot(next), true);
  assert.equal(isReadonlyDataPoolPath(join(next, "hyf_oldfmt_202601", "a.jpg")), true);
  assert.equal(isReadonlyDataPoolPath(join(live, "smt_wh")), false);
  assert.equal(isPrimaryDataPoolPath(join(next, "x")), false);
});

test("missing attach roots are skipped so the assistant still boots", () => {
  resetDataPoolsCache();
  process.env.PI_WEB_DATA_POOLS = "ghost|missing|/dataset/does-not-exist-datepool|attach";
  const pools = listDataPools();
  assert.equal(pools.length, 1);
  assert.equal(pools[0].role, "primary");
});

test("symlinked warehouse alias is still the primary pool", () => {
  resetDataPoolsCache();
  delete process.env.PI_WEB_DATA_POOLS;
  const alias = join(root, "coco_fu");
  if (!existsSync(alias)) symlinkSync(live, alias, "dir");
  // /dataset/coco_fu -> /volume2/... is the real shape: listing path differs
  // from the realpath the catalog stores.
  assert.equal(isPrimaryDataPoolPath(join(alias, "_incoming")), true);
  assert.equal(isPrimaryDataPoolPath(join(alias, "not-created-yet", "x.jpg")), true);
  assert.equal(isPrimaryDataPoolPath(join(next, "x")), false);
  assert.equal(isReadonlyDataPoolPath(join(next, "y")), false);
});
