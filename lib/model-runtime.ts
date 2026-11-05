import { join } from "node:path";
import {
  createAgentSessionServices,
  getAgentDir,
  ModelRuntime,
} from "@earendil-works/pi-coding-agent";
import { rememberProviderModels } from "./deferred-provider-models";
import { resolveCurrentAdminAsync, scopedAuthPath } from "./web-admin-scope";

export async function resolveAdminAuthPath(): Promise<string> {
  const scoped = scopedAuthPath(await resolveCurrentAdminAsync());
  return scoped || join(getAgentDir(), "auth.json");
}

export async function createAdminModelRuntime(): Promise<ModelRuntime> {
  return ModelRuntime.create({
    authPath: await resolveAdminAuthPath(),
    refreshOnCreate: false,
  });
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
