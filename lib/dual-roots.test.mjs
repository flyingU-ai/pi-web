import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const root = mkdtempSync(join(tmpdir(), "pi-web-dual-roots-"));
const warehouse = join(root, "AgentSMarkDatePoolv2");
const codeRoot = join(root, "promptDet");
mkdirSync(join(warehouse, "smt_wh"), { recursive: true });
mkdirSync(codeRoot, { recursive: true });
writeFileSync(join(codeRoot, "README.md"), "hi");

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});

const { canMountVirtualCode, gitCwdForPath, resolveDualRootPath, VIRTUAL_CODE_DIR, virtualCodeDisplayPath } = await jiti.import(
  "./dual-roots.ts",
);

test.after(() => rmSync(root, { recursive: true, force: true }));

test("maps DatePool/code onto the admin repo and skips a real code child", () => {
  const env = {
    ANNOTATION_WORKSPACE_ROOT: warehouse,
    PI_WEB_ADMIN_WORKSPACES: JSON.stringify({ flyingu: codeRoot }),
  };
  process.env.ANNOTATION_WORKSPACE_ROOT = warehouse;
  process.env.PI_WEB_ADMIN_WORKSPACES = env.PI_WEB_ADMIN_WORKSPACES;

  assert.equal(VIRTUAL_CODE_DIR, "code");
  assert.equal(canMountVirtualCode(warehouse, "flyingu"), true);
  assert.equal(resolveDualRootPath(join(warehouse, "code"), "flyingu"), codeRoot);
  assert.equal(resolveDualRootPath(join(warehouse, "code", "README.md"), "flyingu"), join(codeRoot, "README.md"));
  assert.equal(resolveDualRootPath(join(warehouse, "smt_wh"), "flyingu"), join(warehouse, "smt_wh"));

  assert.equal(gitCwdForPath(join(warehouse, "code", "README.md"), "flyingu"), codeRoot);
  mkdirSync(join(codeRoot, "LitDeepFlow"), { recursive: true });
  writeFileSync(join(codeRoot, "LitDeepFlow", "a.py"), "x");
  assert.equal(
    gitCwdForPath(join(warehouse, "code", "LitDeepFlow", "a.py"), "flyingu"),
    join(codeRoot, "LitDeepFlow"),
  );
  assert.equal(
    virtualCodeDisplayPath(join(codeRoot, "README.md"), "flyingu"),
    join(warehouse, "code", "README.md"),
  );

  mkdirSync(join(warehouse, "code"));
  assert.equal(canMountVirtualCode(warehouse, "flyingu"), false);
  assert.equal(resolveDualRootPath(join(warehouse, "code"), "flyingu"), join(warehouse, "code"));
});
