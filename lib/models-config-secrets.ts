/**
 * Personal provider keys must not live in the shared models.json.
 * Local llama keys move to a root-only sidecar the browser never receives.
 */

import { existsSync, lstatSync, mkdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { readModelsConfig, writeModelsConfig } from "./models-config-store";

export const LOCAL_PROVIDER_IDS = new Set(["llamacpp", "llamacpp-gguf"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function catalogDirectory(modelsPath: string): string {
  try {
    if (lstatSync(modelsPath).isSymbolicLink()) return dirname(realpathSync(modelsPath));
  } catch {
    // Missing or not a link: the sidecar stays beside the given path.
  }
  return dirname(modelsPath);
}

export function localProviderSecretsPath(modelsPath?: string): string {
  const models = modelsPath || join(getAgentDir(), "models.json");
  return join(catalogDirectory(models), "provider-runtime-secrets.json");
}

export function readLocalProviderSecrets(secretsPath = localProviderSecretsPath()): Record<string, string> {
  if (!existsSync(secretsPath)) return {};
  try {
    const parsed: unknown = JSON.parse(readFileSync(secretsPath, "utf8"));
    if (!isRecord(parsed)) return {};
    const out: Record<string, string> = {};
    for (const [id, value] of Object.entries(parsed)) {
      if (!LOCAL_PROVIDER_IDS.has(id) || typeof value !== "string" || !value.trim()) continue;
      out[id] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function writeLocalProviderSecrets(secrets: Record<string, string>, secretsPath: string): void {
  const dir = dirname(secretsPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writePrivateFileAtomicSync(secretsPath, JSON.stringify(secrets, null, 2));
}

/** Drop every provider apiKey. Non-empty values are returned so the caller can store them per admin. */
export function stripProviderApiKeys(data: Record<string, unknown>): {
  config: Record<string, unknown>;
  keys: Record<string, string>;
} {
  const config = structuredClone(data);
  const keys: Record<string, string> = {};
  if (!isRecord(config.providers)) return { config, keys };
  for (const [id, provider] of Object.entries(config.providers)) {
    if (!isRecord(provider)) continue;
    if (typeof provider.apiKey === "string" && provider.apiKey.trim()) {
      keys[id] = provider.apiKey.trim();
    }
    delete provider.apiKey;
  }
  return { config, keys };
}

export function markStoredApiKeys(data: Record<string, unknown>, storedIds: ReadonlySet<string>): Record<string, unknown> {
  if (!isRecord(data.providers) || storedIds.size === 0) return data;
  for (const [id, provider] of Object.entries(data.providers)) {
    if (!isRecord(provider) || !storedIds.has(id)) continue;
    provider.apiKeyStored = true;
  }
  return data;
}

function upsertSharedAuth(providerId: string, apiKey: string, authPath: string): void {
  let parsed: Record<string, unknown> = {};
  if (existsSync(authPath)) {
    try {
      const value: unknown = JSON.parse(readFileSync(authPath, "utf8"));
      if (isRecord(value)) parsed = value;
    } catch {
      return;
    }
  }
  const current = parsed[providerId];
  if (isRecord(current) && typeof current.key === "string" && current.key.trim()) return;
  parsed[providerId] = { type: "api_key", key: apiKey };
  const dir = dirname(authPath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writePrivateFileAtomicSync(authPath, JSON.stringify(parsed, null, 2));
}

/**
 * Move local llama keys out of models.json. Other apiKey fields are removed
 * and not copied into the shared sidecar.
 */
export function detachSharedProviderApiKeys(
  modelsPath = join(getAgentDir(), "models.json"),
  authPath = join(getAgentDir(), "auth.json"),
): void {
  if (!existsSync(modelsPath)) return;
  const current = readModelsConfig(modelsPath);
  const { config, keys } = stripProviderApiKeys(current);
  if (Object.keys(keys).length === 0) return;
  const secretPaths = [join(dirname(modelsPath), "provider-runtime-secrets.json")];
  const sharedSecrets = localProviderSecretsPath(modelsPath);
  if (!secretPaths.includes(sharedSecrets)) secretPaths.push(sharedSecrets);
  const secrets: Record<string, string> = {};
  for (const secretPath of secretPaths) Object.assign(secrets, readLocalProviderSecrets(secretPath));
  for (const [id, apiKey] of Object.entries(keys)) {
    if (!LOCAL_PROVIDER_IDS.has(id)) continue;
    if (!secrets[id]) secrets[id] = apiKey;
    upsertSharedAuth(id, apiKey, authPath);
    const sharedAuth = join(catalogDirectory(modelsPath), "auth.json");
    if (sharedAuth !== authPath) upsertSharedAuth(id, apiKey, sharedAuth);
  }
  for (const secretPath of secretPaths) writeLocalProviderSecrets(secrets, secretPath);
  writeModelsConfig(config, modelsPath);
}
