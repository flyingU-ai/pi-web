import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const {
  detachSharedProviderApiKeys,
  stripProviderApiKeys,
} = await createJiti(import.meta.url).import("./models-config-secrets.ts");

test("shared models.json loses apiKey and a personal key is not copied into the sidecar", (t) => {
  const root = mkdtempSync(join(tmpdir(), "pi-web-secrets-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const modelsPath = join(root, "models.json");
  const authPath = join(root, "auth.json");
  writeFileSync(modelsPath, JSON.stringify({
    providers: {
      llamacpp: { baseUrl: "http://127.0.0.1:8091/v1", apiKey: "localkey", models: [{ id: "qwen" }] },
      deepseek: { baseUrl: "https://api.example.test/v1", apiKey: "person-secret", models: [{ id: "v4" }] },
    },
  }));
  detachSharedProviderApiKeys(modelsPath, authPath);
  const saved = JSON.parse(readFileSync(modelsPath, "utf8"));
  assert.equal(saved.providers.llamacpp.apiKey, undefined);
  assert.equal(saved.providers.deepseek.apiKey, undefined);
  assert.equal(saved.providers.llamacpp.baseUrl, "http://127.0.0.1:8091/v1");
  const secrets = JSON.parse(readFileSync(join(root, "provider-runtime-secrets.json"), "utf8"));
  assert.equal(secrets.llamacpp, "localkey");
  assert.equal(secrets.deepseek, undefined);
  const auth = JSON.parse(readFileSync(authPath, "utf8"));
  assert.equal(auth.llamacpp.type, "api_key");
  assert.equal(auth.llamacpp.key, "localkey");
  assert.equal(auth.deepseek, undefined);
  const stripped = stripProviderApiKeys({ providers: { acme: { apiKey: "k", models: [] } } });
  assert.equal(stripped.config.providers.acme.apiKey, undefined);
  assert.equal(stripped.keys.acme, "k");
});
