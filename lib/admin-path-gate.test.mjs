import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const root = mkdtempSync(join(tmpdir(), "pi-web-gate-"));
const warehouse = join(root, "AgentSMarkDatePoolv2");
const sessions = join(root, "session-private");
const prev = {
  ANNOTATION_WORKSPACE_ROOT: process.env.ANNOTATION_WORKSPACE_ROOT,
  PI_WEB_OPEN_FOLDER: process.env.PI_WEB_OPEN_FOLDER,
  PI_WEB_ADMIN_WORKSPACES: process.env.PI_WEB_ADMIN_WORKSPACES,
  PI_WEB_ADMIN_WORKSPACES_FILE: process.env.PI_WEB_ADMIN_WORKSPACES_FILE,
  PI_WEB_TERM_WS_ROOT: process.env.PI_WEB_TERM_WS_ROOT,
  PI_WEB_CODE_ZONES_ROOT: process.env.PI_WEB_CODE_ZONES_ROOT,
  PI_WEB_SESSIONS_ROOT: process.env.PI_WEB_SESSIONS_ROOT,
};

process.env.ANNOTATION_WORKSPACE_ROOT = warehouse;
process.env.PI_WEB_ADMIN_WORKSPACES = "{}";
process.env.PI_WEB_SESSIONS_ROOT = sessions;
delete process.env.PI_WEB_ADMIN_WORKSPACES_FILE;
process.env.PI_WEB_TERM_WS_ROOT = join(root, "term-ws");
delete process.env.PI_WEB_CODE_ZONES_ROOT;

const { bashCommandBlockReason, gateToolInput } = await createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
}).import("./admin-path-gate.ts");
const { isDataTreeCodeZoneName } = await createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
}).import("./admin-workspaces.ts");

test.after(() => {
  for (const [key, value] of Object.entries(prev)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(root, { recursive: true, force: true });
});

const gaoleleHome = join(warehouse, ".agent", "code", "gaolele", "home", "zsx_dip_eval");
const flyinguHome = join(warehouse, ".agent", "code", "flyingu", "home");

test("flyingu cannot read or write another login's code home", () => {
  assert.ok(bashCommandBlockReason(`ls ${gaoleleHome}`, "flyingu"));
  assert.ok(bashCommandBlockReason(`cp /tmp/a ${gaoleleHome}/a.py`, "flyingu"));
  const read = { path: gaoleleHome };
  assert.ok(gateToolInput("read", read, "flyingu"));
});

test("flyingu can read DatePool and its own home", () => {
  assert.equal(bashCommandBlockReason(`ls ${join(warehouse, "smt_wh")}`, "flyingu"), null);
  assert.equal(bashCommandBlockReason(`ls ${flyinguHome}`, "flyingu"), null);
  assert.equal(gateToolInput("read", { path: join(warehouse, "bench.json") }, "gaolele"), null);
});

test("an unregistered /home/aoi/hyf path can be read and cannot be written", () => {
  assert.equal(bashCommandBlockReason("ls /home/aoi/hyf/promptDet", "gaolele"), null);
  assert.equal(bashCommandBlockReason("ls /home/aoi/hyf/promptDet", "flyingu"), null);
  assert.equal(gateToolInput("read", { path: "/home/aoi/hyf/prod/README.md" }, "zhuyude"), null);
  assert.ok(bashCommandBlockReason("mkdir -p /home/aoi/hyf/promptDet/new", "flyingu"));
  assert.ok(gateToolInput("write", { path: "/home/aoi/hyf/promptDet/notes.py" }, "gaolele"));
});

test("a registered /home path belongs only to that login", () => {
  const privateRoot = join(root, "private-home");
  mkdirSync(privateRoot);
  const env = {
    ...process.env,
    PI_WEB_ADMIN_WORKSPACES: JSON.stringify({ flyingu: privateRoot }),
  };
  assert.equal(bashCommandBlockReason(`ls ${privateRoot}`, "flyingu", env), null);
  assert.equal(gateToolInput("write", { path: join(privateRoot, "a.py") }, "flyingu", env), null);
  assert.ok(bashCommandBlockReason(`ls ${privateRoot}`, "gaolele", env));
  assert.ok(gateToolInput("read", { path: join(privateRoot, "a.py") }, "zhuyude", env));
});

test("session files stay in the current leaf", () => {
  const own = join(sessions, "zhuyude", "pi", "a.jsonl");
  const ownKey = join(sessions, "zhuyude", "auth.json");
  const otherKey = join(sessions, "a_e91f79d9e0adf148", "auth.json");
  const quarantine = join(sessions, "_quarantine", "pi", "a.jsonl");
  assert.equal(bashCommandBlockReason(`cat ${own}`, "zhuyude"), null);
  assert.equal(gateToolInput("read", { path: ownKey }, "zhuyude"), null);
  assert.equal(gateToolInput("grep", { path: own }, "zhuyude"), null);
  assert.ok(bashCommandBlockReason(`cat ${otherKey}`, "zhuyude"));
  assert.ok(gateToolInput("read", { path: quarantine }, "zhuyude"));
  assert.ok(gateToolInput("find", { path: join(sessions, "_") }, "flyingu"));
  assert.ok(bashCommandBlockReason(`cat ${join(sessions, ".ticket-secret")}`, "zhuyude"));
  assert.ok(gateToolInput("read", { path: "/home/aoi/.pi/agent/provider-runtime-secrets.json" }, "flyingu"));
  assert.ok(bashCommandBlockReason("cat /dataset/pool/.agent/pi-web/provider-runtime-secrets.json", "zhuyude"));
});

test("an unregistered directory under /home/aoi/hyf cannot be created", () => {
  assert.ok(bashCommandBlockReason("mkdir -p /home/aoi/hyf/zsx_dip_eval", "flyingu"));
  assert.ok(bashCommandBlockReason("cp /tmp/a /home/aoi/hyf/zsx_dip_eval/a.py", "flyingu"));
  assert.equal(bashCommandBlockReason("cp /home/aoi/hyf/prod/a.py /tmp/b.py", "flyingu"), null);
  assert.equal(gateToolInput("read", { path: "/home/aoi/hyf/prod/README.md" }, "gaolele"), null);
  assert.ok(gateToolInput("write", { path: "/home/aoi/hyf/zsx_dip_eval/a.py" }, "flyingu"));
});

test("virtual code/home resolves onto the session login", () => {
  const input = { path: join(warehouse, "code", "home", "a.py") };
  assert.equal(gateToolInput("read", input, "flyingu"), null);
  assert.equal(input.path, join(flyinguHome, "a.py"));
});

test("the data tree hides the code parent and keeps the virtual code mount", () => {
  assert.equal(isDataTreeCodeZoneName(join(warehouse, ".agent"), "code"), true);
  assert.equal(isDataTreeCodeZoneName(join(warehouse, ".agent"), "code-homes"), true);
  assert.equal(isDataTreeCodeZoneName(warehouse, "code"), false);
});
