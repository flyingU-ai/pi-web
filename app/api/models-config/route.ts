import { existsSync, readFileSync } from "node:fs";
import { NextResponse } from "next/server";
import type { Credential } from "@earendil-works/pi-ai";
import { resolveAdminAuthPath } from "@/lib/model-runtime";
import { ModelsConfigReadError, readModelsConfig, writeModelsConfig } from "@/lib/models-config-store";
import {
  detachSharedProviderApiKeys,
  markStoredApiKeys,
  readLocalProviderSecrets,
  stripProviderApiKeys,
} from "@/lib/models-config-secrets";
import { storeProviderCredential } from "@/lib/provider-credential-store";
import { applyAdminRuntimeApiKey } from "@/lib/rpc-manager";
import { resolveCurrentAdminAsync } from "@/lib/web-admin-scope";

export const dynamic = "force-dynamic";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function storedProviderIds(authPath: string): Set<string> {
  const ids = new Set(Object.keys(readLocalProviderSecrets()));
  if (!authPath || !existsSync(authPath)) return ids;
  try {
    const parsed: unknown = JSON.parse(readFileSync(authPath, "utf8"));
    if (!isRecord(parsed)) return ids;
    for (const [id, value] of Object.entries(parsed)) {
      if (!isRecord(value) || value.type !== "api_key") continue;
      if (typeof value.key === "string" && value.key.trim()) ids.add(id);
    }
  } catch {
    // A broken auth file does not reveal its contents.
  }
  return ids;
}

export async function GET() {
  try {
    detachSharedProviderApiKeys();
    const { config } = stripProviderApiKeys(readModelsConfig());
    let authPath = "";
    try {
      authPath = await resolveAdminAuthPath();
    } catch {
      authPath = "";
    }
    return NextResponse.json(markStoredApiKeys(config, storedProviderIds(authPath)));
  } catch (error) {
    if (error instanceof ModelsConfigReadError) {
      return NextResponse.json({ error: error.message }, { status: 422 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}

export async function PUT(req: Request) {
  try {
    const body = await req.json() as Record<string, unknown>;
    detachSharedProviderApiKeys();
    const { config, keys } = stripProviderApiKeys(body);
    if (Object.keys(keys).length > 0) {
      let authPath = "";
      try {
        authPath = await resolveAdminAuthPath();
      } catch {
        authPath = "";
      }
      if (!authPath) {
        return NextResponse.json({ error: "admin required" }, { status: 401 });
      }
      const admin = await resolveCurrentAdminAsync();
      for (const [providerId, apiKey] of Object.entries(keys)) {
        const credential = { type: "api_key", key: apiKey } as Credential;
        await storeProviderCredential(providerId, credential, authPath);
        if (admin) await applyAdminRuntimeApiKey(admin, providerId, apiKey);
      }
    }
    writeModelsConfig(config);
    return NextResponse.json({ success: true });
  } catch (error) {
    if (error instanceof ModelsConfigReadError) {
      return NextResponse.json({ error: error.message }, { status: 409 });
    }
    return NextResponse.json({ error: String(error) }, { status: 500 });
  }
}
