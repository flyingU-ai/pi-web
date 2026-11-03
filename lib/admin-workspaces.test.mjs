import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const root = mkdtempSync(join(tmpdir(), "pi-web-ws-"));
const extra = join(root, "promptDet");
mkdirSync(extra, { recursive: true });

const {
  adminCodeHome,
  extraMountsFor,
  isForeignAdminCodePath,
  loadAdminWorkspaces,
  resolveAdminCodeRoot,
} = await createJiti(import.meta.url).import("./admin-workspaces.ts");

test.after(() => rmSync(root, { recursive: true, force: true }));

test("json extras stay extras; personal home is per admin", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-ws-file-"));
  const file = join(dir, "admin-workspaces.json");
  writeFileSync(file, JSON.stringify({ flyingu: extra, "": "/tmp/x" }));
  const warehouse = join(dir, "pool");
  mkdirSync(warehouse, { recursive: true });
  try {
    const env = {
      PI_WEB_ADMIN_WORKSPACES_FILE: file,
      ANNOTATION_WORKSPACE_ROOT: warehouse,
    };
    assert.equal(resolveAdminCodeRoot("flyingu", env), join(warehouse, ".agent", "code", "flyingu", "home"));
    assert.equal(resolveAdminCodeRoot("huyufei", env), join(warehouse, ".agent", "code", "huyufei", "home"));
    assert.deepEqual(loadAdminWorkspaces(env), { flyingu: extra });
    assert.deepEqual(extraMountsFor("flyingu", env).map((item) => item.path), [extra]);
    assert.deepEqual(extraMountsFor("huyufei", env), []);
    assert.equal(isForeignAdminCodePath(join(warehouse, ".agent", "code", "flyingu"), "huyufei", env), true);
    assert.equal(isForeignAdminCodePath(join(warehouse, ".agent", "code", "huyufei", "home", "secret.txt"), "flyingu", env), true);
    assert.equal(isForeignAdminCodePath(join(warehouse, ".agent", "code-homes", "huyufei", "secret.txt"), "flyingu", env), true);
    assert.equal(isForeignAdminCodePath(extra, "huyufei", env), true);
    assert.equal(isForeignAdminCodePath(extra, "flyingu", env), false);
    assert.equal(adminCodeHome("flyingu", env).endsWith("/flyingu/home"), true);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("prefers inline PI_WEB_ADMIN_WORKSPACES json extras", () => {
  const env = {
    PI_WEB_ADMIN_WORKSPACES: JSON.stringify({ flyingu: extra }),
    ANNOTATION_WORKSPACE_ROOT: join(root, "pool2"),
  };
  mkdirSync(env.ANNOTATION_WORKSPACE_ROOT, { recursive: true });
  assert.equal(extraMountsFor("flyingu", env)[0]?.path, extra);
  assert.equal(resolveAdminCodeRoot("flyingu", env), join(env.ANNOTATION_WORKSPACE_ROOT, ".agent", "code", "flyingu", "home"));
});
