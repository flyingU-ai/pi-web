import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { enabledModelsForAdmin, readAdminEnabledModels, writeAdminEnabledModels } = await jiti.import("./admin-enabled-models.ts");

test("model toggles stay in the admin leaf", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-web-enabled-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const previous = process.env.PI_WEB_SESSIONS_ROOT;
  const previousWarehouse = process.env.ANNOTATION_WORKSPACE_ROOT;
  process.env.PI_WEB_SESSIONS_ROOT = root;
  process.env.ANNOTATION_WORKSPACE_ROOT = root;
  const shared = join(root, "settings.json");
  writeFileSync(shared, JSON.stringify({ enabledModels: ["llamacpp/**", "qwen-token-plan/*"] }));
  try {
    assert.equal(readAdminEnabledModels("flyingu"), undefined);
    writeAdminEnabledModels("flyingu", ["llamacpp/**"]);
    assert.deepEqual(readAdminEnabledModels("flyingu"), ["llamacpp/**"]);
    assert.equal(readAdminEnabledModels("gaolele"), undefined);
    assert.equal(readFileSync(shared, "utf8").includes("qwen-token-plan"), true);
    assert.equal(readAdminEnabledModels("_"), undefined);
    const settings = { getEnabledModels: () => ["llamacpp/**", "deepseek/*", "qwen-token-plan-cn/qwen3.8-max"] };
    assert.deepEqual(enabledModelsForAdmin(settings, "gaolele"), ["llamacpp/**"]);
    mkdirSync(join(root, "zhuyude"));
    writeFileSync(join(root, "zhuyude", "auth.json"), JSON.stringify({
      "qwen-token-plan-cn": { type: "api_key", key: "test-only" },
    }));
    assert.deepEqual(enabledModelsForAdmin(settings, "zhuyude"), [
      "llamacpp/**",
      "qwen-token-plan-cn/qwen3.8-max",
    ]);
  } finally {
    if (previous === undefined) delete process.env.PI_WEB_SESSIONS_ROOT;
    else process.env.PI_WEB_SESSIONS_ROOT = previous;
    if (previousWarehouse === undefined) delete process.env.ANNOTATION_WORKSPACE_ROOT;
    else process.env.ANNOTATION_WORKSPACE_ROOT = previousWarehouse;
  }
});
