import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  adminFromRequest,
  fileIsUnder,
  runWithWebAdmin,
  sanitizeWebAdmin,
  scopedAuthPath,
  scopedSessionsDir,
  sessionsStoreRoot,
} = await jiti.import("./web-admin-scope.ts");
const { listAllSessions, invalidateSessionListCache, resolveSessionPath } = await jiti.import("./session-reader.ts");
const { resetSessionScanIndexForTests } = await jiti.import("./session-list-scanner.ts");

function resetCaches() {
  resetSessionScanIndexForTests();
  invalidateSessionListCache();
  globalThis.__piSessionListCache = undefined;
  globalThis.__piSessionListCacheByDir = undefined;
  globalThis.__piSessionListPromiseByDir = undefined;
  globalThis.__piSessionPathCache = undefined;
}

test("PI_WEB_SESSIONS_ROOT keeps jsonl off the warehouse NFS path", () => {
  const previous = process.env.PI_WEB_SESSIONS_ROOT;
  process.env.PI_WEB_SESSIONS_ROOT = "/home/aoi/session-private";
  try {
    assert.equal(sessionsStoreRoot("/dataset/coco_fu/AgentSMarkDatePoolv2"), "/home/aoi/session-private");
    assert.equal(
      scopedSessionsDir("flyingu", "/dataset/coco_fu/AgentSMarkDatePoolv2"),
      "/home/aoi/session-private/flyingu/pi",
    );
    assert.ok(!scopedSessionsDir("flyingu", "/dataset/coco_fu/AgentSMarkDatePoolv2").includes("/dataset/"));
  } finally {
    if (previous === undefined) delete process.env.PI_WEB_SESSIONS_ROOT;
    else process.env.PI_WEB_SESSIONS_ROOT = previous;
  }
});

test("provider keys are per admin next to the session root", () => {
  const previous = process.env.PI_WEB_SESSIONS_ROOT;
  process.env.PI_WEB_SESSIONS_ROOT = "/home/aoi/session-private";
  try {
    const warehouse = "/dataset/coco_fu/AgentSMarkDatePoolv2";
    assert.equal(scopedAuthPath("flyingu", warehouse), "/home/aoi/session-private/flyingu/auth.json");
    assert.equal(scopedAuthPath("huyufei", warehouse), "/home/aoi/session-private/huyufei/auth.json");
    assert.notEqual(scopedAuthPath("flyingu", warehouse), scopedAuthPath("huyufei", warehouse));
    assert.equal(scopedAuthPath("", warehouse), "");
  } finally {
    if (previous === undefined) delete process.env.PI_WEB_SESSIONS_ROOT;
    else process.env.PI_WEB_SESSIONS_ROOT = previous;
  }
});

test("sanitize and cookie identity", () => {
  assert.equal(sanitizeWebAdmin("alice"), "alice");
  assert.equal(sanitizeWebAdmin("../bob"), ".._bob");
  assert.equal(sanitizeWebAdmin("."), "");
  const req = new Request("http://127.0.0.1/api/sessions", {
    headers: { cookie: "aoi_admin=alice" },
  });
  assert.equal(adminFromRequest(req), "alice");
});

test("A cannot list B sessions", async () => {
  const previousRoot = process.env.ANNOTATION_WORKSPACE_ROOT;
  const previousFolder = process.env.PI_WEB_OPEN_FOLDER;
  const previousAgent = process.env.PI_CODING_AGENT_DIR;
  const previousSessions = process.env.PI_WEB_SESSIONS_ROOT;
  delete process.env.PI_WEB_SESSIONS_ROOT;
  const workspace = mkdtempSync(join(tmpdir(), "asm-admin-"));
  const agentHome = mkdtempSync(join(tmpdir(), "asm-piweb-"));
  process.env.ANNOTATION_WORKSPACE_ROOT = workspace;
  process.env.PI_WEB_OPEN_FOLDER = workspace;
  process.env.PI_CODING_AGENT_DIR = agentHome;
  const stamp = "2026-01-01T00:00:00.000Z";
  for (const admin of ["alice", "bob"]) {
    const dir = join(scopedSessionsDir(admin, workspace), "project");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, `${admin}.jsonl`),
      `${JSON.stringify({ type: "session", version: 3, id: `${admin}-sid`, cwd: workspace, timestamp: stamp })}\n`,
    );
  }
  resetCaches();
  try {
    const alice = await runWithWebAdmin("alice", () => listAllSessions({ force: true }));
    const bob = await runWithWebAdmin("bob", () => listAllSessions({ force: true }));
    assert.deepEqual(alice.map((s) => s.id), ["alice-sid"]);
    assert.deepEqual(bob.map((s) => s.id), ["bob-sid"]);
    assert.ok(fileIsUnder(join(scopedSessionsDir("alice", workspace), "project", "alice.jsonl"), scopedSessionsDir("alice", workspace)));
    assert.ok(!fileIsUnder(join(scopedSessionsDir("bob", workspace), "project", "bob.jsonl"), scopedSessionsDir("alice", workspace)));
  } finally {
    resetCaches();
    if (previousRoot === undefined) delete process.env.ANNOTATION_WORKSPACE_ROOT;
    else process.env.ANNOTATION_WORKSPACE_ROOT = previousRoot;
    if (previousFolder === undefined) delete process.env.PI_WEB_OPEN_FOLDER;
    else process.env.PI_WEB_OPEN_FOLDER = previousFolder;
    if (previousAgent === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgent;
    if (previousSessions === undefined) delete process.env.PI_WEB_SESSIONS_ROOT;
    else process.env.PI_WEB_SESSIONS_ROOT = previousSessions;
    rmSync(workspace, { recursive: true, force: true });
    rmSync(agentHome, { recursive: true, force: true });
  }
});

test("flat jsonl in admin leaf is listed; process-home sessions are not", async () => {
  const previousRoot = process.env.ANNOTATION_WORKSPACE_ROOT;
  const previousFolder = process.env.PI_WEB_OPEN_FOLDER;
  const previousAgent = process.env.PI_CODING_AGENT_DIR;
  const previousSessions = process.env.PI_WEB_SESSIONS_ROOT;
  delete process.env.PI_WEB_SESSIONS_ROOT;
  const workspace = mkdtempSync(join(tmpdir(), "asm-flat-"));
  const agentHome = mkdtempSync(join(tmpdir(), "asm-piweb-home-"));
  process.env.ANNOTATION_WORKSPACE_ROOT = workspace;
  process.env.PI_WEB_OPEN_FOLDER = workspace;
  process.env.PI_CODING_AGENT_DIR = agentHome;
  const stamp = "2026-10-12T03:32:14.772Z";
  const leaf = scopedSessionsDir("flyingu", workspace);
  mkdirSync(leaf, { recursive: true });
  const flatPath = join(leaf, `2026-10-12T03-32-14-772Z_flat-sid.jsonl`);
  writeFileSync(
    flatPath,
    `${JSON.stringify({ type: "session", version: 3, id: "flat-sid", cwd: workspace, timestamp: stamp })}\n`,
  );
  const nested = join(leaf, "project");
  mkdirSync(nested, { recursive: true });
  writeFileSync(
    join(nested, "nested-sid.jsonl"),
    `${JSON.stringify({ type: "session", version: 3, id: "nested-sid", cwd: workspace, timestamp: stamp })}\n`,
  );
  const orphanDir = join(agentHome, "sessions", "project");
  mkdirSync(orphanDir, { recursive: true });
  writeFileSync(
    join(orphanDir, "orphan.jsonl"),
    `${JSON.stringify({ type: "session", version: 3, id: "orphan-sid", cwd: workspace, timestamp: stamp })}\n`,
  );
  resetCaches();
  try {
    const listed = await runWithWebAdmin("flyingu", () => listAllSessions({ force: true }));
    assert.deepEqual(listed.map((s) => s.id).sort(), ["flat-sid", "nested-sid"]);
    const opened = await runWithWebAdmin("flyingu", () => resolveSessionPath("flat-sid"));
    assert.equal(opened, flatPath);
  } finally {
    resetCaches();
    if (previousRoot === undefined) delete process.env.ANNOTATION_WORKSPACE_ROOT;
    else process.env.ANNOTATION_WORKSPACE_ROOT = previousRoot;
    if (previousFolder === undefined) delete process.env.PI_WEB_OPEN_FOLDER;
    else process.env.PI_WEB_OPEN_FOLDER = previousFolder;
    if (previousAgent === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previousAgent;
    if (previousSessions === undefined) delete process.env.PI_WEB_SESSIONS_ROOT;
    else process.env.PI_WEB_SESSIONS_ROOT = previousSessions;
    rmSync(workspace, { recursive: true, force: true });
    rmSync(agentHome, { recursive: true, force: true });
  }
});
