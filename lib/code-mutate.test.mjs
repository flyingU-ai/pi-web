import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const root = mkdtempSync(join(tmpdir(), "pi-web-code-mutate-"));
const warehouse = join(root, "AgentSMarkDatePoolv2");
const extraRoot = join(root, "promptDet");
mkdirSync(join(warehouse, "smt_wh"), { recursive: true });
mkdirSync(join(extraRoot, "LitDeepFlow"), { recursive: true });
writeFileSync(join(extraRoot, "LitDeepFlow", "a.py"), "hi");

const prevEnv = {
  ANNOTATION_WORKSPACE_ROOT: process.env.ANNOTATION_WORKSPACE_ROOT,
  PI_WEB_ADMIN_WORKSPACES: process.env.PI_WEB_ADMIN_WORKSPACES,
};
process.env.ANNOTATION_WORKSPACE_ROOT = warehouse;
process.env.PI_WEB_ADMIN_WORKSPACES = JSON.stringify({ flyingu: extraRoot });

const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});
const { mutateCodeEntry, sanitizeEntryName } = await jiti.import("./code-mutate.ts");

test.after(() => {
  for (const [key, value] of Object.entries(prevEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
});

test("sanitizeEntryName rejects traversal", () => {
  assert.equal(sanitizeEntryName("ok.txt"), "ok.txt");
  assert.equal(sanitizeEntryName("../x"), null);
  assert.equal(sanitizeEntryName(".git"), null);
  assert.equal(sanitizeEntryName("a/b"), null);
});

test("creates, renames, moves, merges and deletes only under the admin mounts", async () => {
  const code = join(warehouse, "code");
  const extra = join(code, "promptDet");
  let result = await mutateCodeEntry("flyingu", join(extra, "LitDeepFlow"), { action: "create-file", name: "n.py", content: "x" });
  assert.equal(result.status, 200);
  assert.equal(readFileSync(join(extraRoot, "LitDeepFlow", "n.py"), "utf8"), "x");

  result = await mutateCodeEntry("flyingu", join(extra, "LitDeepFlow", "n.py"), { action: "rename", name: "renamed.py" });
  assert.equal(result.status, 200);
  assert.equal(readFileSync(join(extraRoot, "LitDeepFlow", "renamed.py"), "utf8"), "x");

  result = await mutateCodeEntry("flyingu", extra, { action: "mkdir", name: "docs" });
  assert.equal(result.status, 200);

  result = await mutateCodeEntry("flyingu", join(extra, "LitDeepFlow", "renamed.py"), {
    action: "move",
    to: join(extra, "docs"),
  });
  assert.equal(result.status, 200);
  assert.equal(readFileSync(join(extraRoot, "docs", "renamed.py"), "utf8"), "x");

  result = await mutateCodeEntry("flyingu", join(extra, "LitDeepFlow"), {
    action: "merge",
    to: join(extra, "docs"),
  });
  assert.equal(result.status, 200);
  assert.equal(readFileSync(join(extraRoot, "docs", "a.py"), "utf8"), "hi");

  result = await mutateCodeEntry("flyingu", join(extra, "docs", "a.py"), { action: "delete" });
  assert.equal(result.status, 200);

  result = await mutateCodeEntry("flyingu", code, { action: "mkdir", name: "notes" });
  assert.equal(result.status, 200);
  assert.equal(existsSync(join(warehouse, ".agent", "code-homes", "flyingu", "notes")), true);

  result = await mutateCodeEntry("flyingu", join(warehouse, "smt_wh"), { action: "mkdir", name: "nope" });
  assert.equal(result.status, 403);

  result = await mutateCodeEntry("huyufei", join(extra, "docs"), { action: "mkdir", name: "x" });
  assert.equal(result.status, 403);

  result = await mutateCodeEntry("huyufei", code, { action: "create-file", name: "mine.txt", content: "ok" });
  assert.equal(result.status, 200);
  assert.equal(readFileSync(join(warehouse, ".agent", "code-homes", "huyufei", "mine.txt"), "utf8"), "ok");
});
