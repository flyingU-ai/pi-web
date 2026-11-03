import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readlinkSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const root = mkdtempSync(join(tmpdir(), "pi-web-dual-roots-"));
const warehouse = join(root, "AgentSMarkDatePoolv2");
const extraRoot = join(root, "promptDet");
mkdirSync(join(warehouse, "smt_wh"), { recursive: true });
mkdirSync(extraRoot, { recursive: true });
writeFileSync(join(extraRoot, "README.md"), "hi");

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});

const {
  canMountVirtualCode,
  ensureTerminalWorkspace,
  gitCwdForPath,
  isForeignTermWorkspace,
  listVirtualCodeChildren,
  resolveDualRootPath,
  resolveTerminalCwd,
  VIRTUAL_CODE_DIR,
  virtualCodeDisplayPath,
} = await jiti.import("./dual-roots.ts");

const prevEnv = {
  ANNOTATION_WORKSPACE_ROOT: process.env.ANNOTATION_WORKSPACE_ROOT,
  PI_WEB_ADMIN_WORKSPACES: process.env.PI_WEB_ADMIN_WORKSPACES,
  PI_WEB_TERM_WS_ROOT: process.env.PI_WEB_TERM_WS_ROOT,
  PI_WEB_CODE_HOMES_ROOT: process.env.PI_WEB_CODE_HOMES_ROOT,
};
test.after(() => {
  for (const [key, value] of Object.entries(prevEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
});

test("every admin gets a home; extras sit beside it; real DatePool/code disables mount", () => {
  process.env.ANNOTATION_WORKSPACE_ROOT = warehouse;
  process.env.PI_WEB_ADMIN_WORKSPACES = JSON.stringify({ flyingu: extraRoot });
  delete process.env.PI_WEB_CODE_HOMES_ROOT;

  assert.equal(VIRTUAL_CODE_DIR, "code");
  assert.equal(canMountVirtualCode(warehouse, "flyingu"), true);
  assert.equal(canMountVirtualCode(warehouse, "huyufei"), true);
  assert.equal(canMountVirtualCode(warehouse, ""), false);

  const flyinguHome = join(warehouse, ".agent", "code-homes", "flyingu");
  const huyufeiHome = join(warehouse, ".agent", "code-homes", "huyufei");
  assert.equal(resolveDualRootPath(join(warehouse, "code", "home"), "flyingu"), flyinguHome);
  assert.equal(resolveDualRootPath(join(warehouse, "code", "promptDet"), "flyingu"), extraRoot);
  assert.equal(
    resolveDualRootPath(join(warehouse, "code", "promptDet", "README.md"), "flyingu"),
    join(extraRoot, "README.md"),
  );
  assert.equal(resolveDualRootPath(join(warehouse, "smt_wh"), "flyingu"), join(warehouse, "smt_wh"));
  assert.equal(resolveDualRootPath(join(warehouse, "code", "home"), "huyufei"), huyufeiHome);
  assert.equal(
    resolveDualRootPath(join(warehouse, "code", "promptDet"), "huyufei"),
    join(warehouse, "code", "promptDet"),
  );

  const names = listVirtualCodeChildren("flyingu").map((child) => child.name);
  assert.deepEqual(names, ["home", "promptDet"]);
  assert.deepEqual(listVirtualCodeChildren("huyufei").map((child) => child.name), ["home"]);

  mkdirSync(join(extraRoot, "LitDeepFlow"), { recursive: true });
  writeFileSync(join(extraRoot, "LitDeepFlow", "a.py"), "x");
  assert.equal(
    gitCwdForPath(join(warehouse, "code", "promptDet", "LitDeepFlow", "a.py"), "flyingu"),
    join(extraRoot, "LitDeepFlow"),
  );
  assert.equal(
    virtualCodeDisplayPath(join(extraRoot, "README.md"), "flyingu"),
    join(warehouse, "code", "promptDet", "README.md"),
  );

  mkdirSync(join(warehouse, "code"));
  assert.equal(canMountVirtualCode(warehouse, "flyingu"), false);
  assert.equal(resolveDualRootPath(join(warehouse, "code"), "flyingu"), join(warehouse, "code"));
});

test("terminal workspace is per-admin and rejects another admin's term-ws", () => {
  rmSync(join(warehouse, "code"), { recursive: true, force: true });
  const termBase = join(root, "term-ws");
  process.env.ANNOTATION_WORKSPACE_ROOT = warehouse;
  process.env.PI_WEB_ADMIN_WORKSPACES = JSON.stringify({ flyingu: extraRoot });
  process.env.PI_WEB_TERM_WS_ROOT = termBase;

  const flyinguWs = ensureTerminalWorkspace("flyingu");
  assert.equal(flyinguWs, join(termBase, "flyingu"));
  assert.equal(resolveTerminalCwd(warehouse, "flyingu"), flyinguWs);
  assert.equal(resolveTerminalCwd(join(warehouse, "smt_wh"), "flyingu"), join(warehouse, "smt_wh"));
  assert.equal(readlinkSync(join(flyinguWs, "data")), warehouse);
  assert.equal(readlinkSync(join(flyinguWs, "code", "home")), join(warehouse, ".agent", "code-homes", "flyingu"));
  assert.equal(readlinkSync(join(flyinguWs, "code", "promptDet")), extraRoot);

  const otherWs = ensureTerminalWorkspace("huyufei");
  assert.notEqual(otherWs, flyinguWs);
  assert.equal(readlinkSync(join(otherWs, "code", "home")), join(warehouse, ".agent", "code-homes", "huyufei"));
  assert.equal(isForeignTermWorkspace(join(flyinguWs, "code", "promptDet"), "huyufei"), true);
  assert.equal(isForeignTermWorkspace(join(otherWs, "code", "home"), "huyufei"), false);
  assert.equal(resolveTerminalCwd(flyinguWs, "huyufei"), "");
});
