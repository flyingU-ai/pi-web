/**
 * Per-admin enabledModels overlay. The shared settings.json stays the default
 * catalog and is not rewritten when one person toggles a model.
 */

import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { SettingsManager } from "@earendil-works/pi-coding-agent";
import { writePrivateFileAtomicSync } from "./atomic-file";
import { isBlockedAdminLeaf } from "./admin-leaf";
import { sanitizeWebAdmin, scopedAuthPath, sessionsStoreRoot } from "./web-admin-scope";

const LOCAL_MODEL_PROVIDERS = new Set(["llamacpp", "llamacpp-gguf"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function adminEnabledModelsPath(admin: string): string {
  const name = sanitizeWebAdmin(admin);
  if (!name || isBlockedAdminLeaf(name)) return "";
  return join(sessionsStoreRoot(), name, "enabled-models.json");
}

/** Undefined when this admin has not toggled yet and still follows the shared list. */
export function readAdminEnabledModels(admin: string): string[] | undefined {
  const path = adminEnabledModelsPath(admin);
  if (!path || !existsSync(path)) return undefined;
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isRecord(parsed) || !Array.isArray(parsed.enabledModels)) return undefined;
    if (parsed.enabledModels.some((entry) => typeof entry !== "string")) return undefined;
    return parsed.enabledModels as string[];
  } catch {
    return undefined;
  }
}

export function writeAdminEnabledModels(admin: string, patterns: string[] | undefined): void {
  const path = adminEnabledModelsPath(admin);
  if (!path) throw new Error("admin required");
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: 0o700 });
  writePrivateFileAtomicSync(path, JSON.stringify({ enabledModels: patterns ?? [] }, null, 2));
}

export function providerIdFromPattern(pattern: string): string {
  return pattern.trim().split("/")[0]?.split(":")[0] ?? "";
}

/** Provider ids that have a credential in this leaf. Values are not returned. */
export function readAdminCredentialProviders(admin: string): Set<string> {
  const path = scopedAuthPath(admin);
  if (!path || !existsSync(path)) return new Set();
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isRecord(parsed)) return new Set();
    const ids = Object.entries(parsed)
      .filter(([, value]) => isRecord(value) && (value.type === "api_key" || value.type === "oauth"))
      .map(([id]) => id);
    return new Set(ids);
  } catch {
    return new Set();
  }
}

/**
 * Local models stay shared. A cloud pattern is visible only when this leaf
 * has that provider's credential. A saved key also enables `provider/*`
 * without writing the shared settings file.
 */
export function enabledModelsForAdmin(
  settingsManager: SettingsManager,
  admin: string,
): string[] | undefined {
  const overlay = readAdminEnabledModels(admin);
  const base = overlay ?? settingsManager.getEnabledModels() ?? ["llamacpp/**"];
  const credentials = readAdminCredentialProviders(admin);
  const kept = base.filter((pattern) => {
    const provider = providerIdFromPattern(pattern);
    if (!provider || provider === "*" || LOCAL_MODEL_PROVIDERS.has(provider)) return true;
    return credentials.has(provider);
  });
  for (const provider of credentials) {
    if (LOCAL_MODEL_PROVIDERS.has(provider)) continue;
    if (!kept.some((pattern) => providerIdFromPattern(pattern) === provider)) {
      kept.push(`${provider}/*`);
    }
  }
  if (kept.length === 0) kept.push("llamacpp/**");
  return kept;
}
