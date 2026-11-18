import { join } from "node:path";
import {
  createAgentSessionServices,
  getAgentDir,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { isBlockedAdminLeaf } from "./admin-leaf";
import { rememberProviderModels } from "./deferred-provider-models";
import { readLocalProviderSecrets } from "./models-config-secrets";
import { multiUserMode, resolveCurrentAdminAsync, scopedAuthPath, warehouseRoot } from "./web-admin-scope";

export async function resolveAdminAuthPath(): Promise<string> {
  if (!warehouseRoot()) {
    if (multiUserMode()) throw new Error("admin required");
    return join(getAgentDir(), "auth.json");
  }
  const admin = await resolveCurrentAdminAsync();
  if (!admin || isBlockedAdminLeaf(admin)) {
    throw new Error("admin required");
  }
  const scoped = scopedAuthPath(admin);
  if (!scoped) throw new Error("admin required");
  return scoped;
}

export async function createAdminModelRuntime(): Promise<ModelRuntime> {
  const runtime = await ModelRuntime.create({
    authPath: await resolveAdminAuthPath(),
    refreshOnCreate: false,
  });
  await injectLocalProviderSecrets(runtime);
  return runtime;
}

/** Local llama keys stay on this machine. They are not copied into each admin's auth.json. */
async function injectLocalProviderSecrets(runtime: ModelRuntime): Promise<void> {
  const secrets = readLocalProviderSecrets();
  for (const [providerId, apiKey] of Object.entries(secrets)) {
    if (!apiKey) continue;
    try {
      const status = runtime.getProviderAuthStatus(providerId);
      if (status.configured && status.source === "stored") continue;
      if (status.configured && status.source === "models_json_key") continue;
      await runtime.setRuntimeApiKey(providerId, apiKey);
    } catch {
      // The catalog may not know this provider yet.
    }
  }
}

/**
 * ModelRuntime that also includes providers registered by extensions (an
 * extension that calls `registerProvider` / `createProvider` during resource
 * loading). A bare `ModelRuntime.create()` only knows built-in providers plus
 * models.json, so extension-registered providers were invisible to the
 * provider-listing and auth routes.
 *
 * The agent dir acts as cwd so project-local extensions stay out; global
 * package extensions always load. Not cached: these routes need fresh
 * credentials for auth status and login/logout to be truthful.
 */
export async function createModelRuntimeWithExtensions(): Promise<ModelRuntime> {
  const agentDir = getAgentDir();
  const modelRuntime = await createAdminModelRuntime();
  const services = await createAgentSessionServices({ cwd: agentDir, agentDir, modelRuntime });
  await rememberProviderModels(services.modelRuntime);
  return services.modelRuntime;
}
