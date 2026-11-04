import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const source = readFileSync(new URL("./route.ts", import.meta.url), "utf8");
const indexSource = readFileSync(new URL("../../file-index/route.ts", import.meta.url), "utf8");
const filesSource = readFileSync(new URL("../../files/[...path]/route.ts", import.meta.url), "utf8");

test("DatePool git status stays empty and does not forest extra mounts", () => {
  assert.match(source, /Opening Assistant on DatePool must stay O\(1\)/);
  assert.match(source, /isDatePoolRoot\(cwd\) \|\| isDatePoolRoot\(resolved\)/);
  assert.doesNotMatch(source, /children\.map\(\(child\) => getGitStatusForest\(child\.path\)\)/);
  assert.match(source, /getGitStatusForest\(hit\.path\)/);
});

test("DatePool file-index only injects code\/ names", () => {
  assert.match(indexSource, /`\$\{VIRTUAL_CODE_DIR\}\/\$\{child\.name\}\/`/);
  assert.doesNotMatch(indexSource, /listWithGit\(child\.path\)/);
  assert.doesNotMatch(indexSource, /listWithWalk\(child\.path\)/);
});

test("DatePool file list reports why virtual code is missing", () => {
  assert.match(filesSource, /codeMount = \{ ok: false, reason: "admin_required" \}/);
  assert.match(filesSource, /blocked_by_real_code_dir/);
});

test("virtual code/promptDet status maps extra-mount diffs back to DatePool paths", async () => {
  const base = mkdtempSync(join(tmpdir(), "pi-web-git-status-virtual-"));
  const warehouse = join(base, "AgentSMarkDatePoolv2");
  const extra = join(base, "promptDet");
  mkdirSync(join(warehouse, "smt_wh"), { recursive: true });
  mkdirSync(extra, { recursive: true });
  execFileSync("git", ["-C", extra, "init", "--quiet"]);
  writeFileSync(join(extra, "tracked.py"), "original\n");
  execFileSync("git", ["-C", extra, "add", "."]);
  execFileSync("git", ["-C", extra, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "--quiet", "-m", "base"]);
  writeFileSync(join(extra, "tracked.py"), "updated\n");

  const prev = {
    ANNOTATION_WORKSPACE_ROOT: process.env.ANNOTATION_WORKSPACE_ROOT,
    PI_WEB_ADMIN_WORKSPACES: process.env.PI_WEB_ADMIN_WORKSPACES,
    PI_WEB_OPEN_FOLDER: process.env.PI_WEB_OPEN_FOLDER,
  };
  process.env.ANNOTATION_WORKSPACE_ROOT = warehouse;
  process.env.PI_WEB_ADMIN_WORKSPACES = JSON.stringify({ flyingu: extra });
  delete process.env.PI_WEB_OPEN_FOLDER;
  const previousRoots = globalThis.__piAdditionalAllowedRootsByAdmin;
  const previousCache = globalThis.__piAllowedRootsCacheByAdmin;
  delete globalThis.__piAdditionalAllowedRootsByAdmin;
  delete globalThis.__piAllowedRootsCacheByAdmin;

  const jiti = createJiti(import.meta.url, {
    alias: { "@": process.cwd() },
    interopDefault: true,
    moduleCache: false,
  });
  try {
    const { GET } = await jiti.import("./route.ts");
    const { allowFileRoot } = await jiti.import("../../../../lib/file-access.ts");
    const { NextRequest } = await jiti.import("next/server");
    allowFileRoot(warehouse, "flyingu");
    allowFileRoot(extra, "flyingu");
    allowFileRoot(warehouse);
    allowFileRoot(extra);
    delete globalThis.__piAllowedRootsCacheByAdmin;

    const empty = await GET(new NextRequest(`http://localhost/api/git/status?cwd=${encodeURIComponent(warehouse)}`, {
      headers: { "x-aoi-admin": "flyingu" },
    }));
    const emptyBody = await empty.json();
    assert.equal(empty.status, 200, JSON.stringify(emptyBody));
    assert.deepEqual(emptyBody, {
      isGitRepository: false,
      repositoryRoot: null,
      files: [],
      additions: 0,
      deletions: 0,
    });

    const virtual = join(warehouse, "code", "promptDet");
    const response = await GET(new NextRequest(`http://localhost/api/git/status?cwd=${encodeURIComponent(virtual)}`, {
      headers: { "x-aoi-admin": "flyingu" },
    }));
    const body = await response.json();
    assert.equal(response.status, 200, JSON.stringify(body));
    assert.equal(body.isGitRepository, true);
    assert.equal(body.files.length, 1);
    assert.equal(body.files[0].filePath, join(warehouse, "code", "promptDet", "tracked.py"));
    assert.equal(body.files[0].status, "modified");
  } finally {
    for (const [key, value] of Object.entries(prev)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    globalThis.__piAdditionalAllowedRootsByAdmin = previousRoots;
    globalThis.__piAllowedRootsCacheByAdmin = previousCache;
    rmSync(base, { recursive: true, force: true });
  }
});
