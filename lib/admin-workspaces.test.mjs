import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const { loadAdminWorkspaces, resolveAdminCodeRoot } = await createJiti(import.meta.url).import(
  "./admin-workspaces.ts",
);

test("maps flyingu to promptDet and ignores empty names", () => {
  const dir = mkdtempSync(join(tmpdir(), "pi-web-ws-"));
  const file = join(dir, "admin-workspaces.json");
  writeFileSync(file, JSON.stringify({ flyingu: "/home/aoi/hyf/promptDet", "": "/tmp/x" }));
  try {
    const env = { PI_WEB_ADMIN_WORKSPACES_FILE: file, ANNOTATION_WORKSPACE_ROOT: "" };
    assert.equal(resolveAdminCodeRoot("flyingu", env), "/home/aoi/hyf/promptDet");
    assert.equal(resolveAdminCodeRoot("other", env), "");
    assert.deepEqual(loadAdminWorkspaces(env), { flyingu: "/home/aoi/hyf/promptDet" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("prefers inline PI_WEB_ADMIN_WORKSPACES json", () => {
  const env = {
    PI_WEB_ADMIN_WORKSPACES: JSON.stringify({ flyingu: "/home/aoi/hyf/promptDet" }),
  };
  assert.equal(resolveAdminCodeRoot("flyingu", env), "/home/aoi/hyf/promptDet");
});
