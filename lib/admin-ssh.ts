/**
 * Per-admin Git SSH material on the host-local session disk.
 * `/home/aoi/session-private/<admin>/ssh` sits beside `auth.json`.
 * Logout does not delete it. The file tree never receives the private key.
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { sanitizeWebAdmin, sessionsStoreRoot } from "./web-admin-scope";

export interface AdminSshStatus {
  configured: boolean;
  fingerprint: string;
  host: string;
  algorithm: string;
}

function sshDir(admin: string): string {
  return join(sessionsStoreRoot(), sanitizeWebAdmin(admin), "ssh");
}

export function adminSshDir(admin: string): string {
  const name = sanitizeWebAdmin(admin);
  if (!name) return "";
  return sshDir(name);
}

function quotePath(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

export function sanitizeSshHost(host: string): string {
  const raw = String(host || "").trim() || "*";
  const parts = raw.split(/[,\s]+/).map((part) => part.trim()).filter(Boolean);
  if (!parts.length) return "*";
  for (const part of parts) {
    if (part === "*") continue;
    if (!/^[A-Za-z0-9*][A-Za-z0-9._*-]{0,252}$/.test(part)) {
      throw new Error("invalid host");
    }
  }
  return parts.join(" ");
}

export function fingerprintOpenSshPublicKey(line: string): { fingerprint: string; algorithm: string } {
  const parts = String(line || "").trim().split(/\s+/);
  if (parts.length < 2 || !/^ssh-/.test(parts[0])) throw new Error("invalid public key");
  const blob = Buffer.from(parts[1], "base64");
  if (blob.length < 8) throw new Error("invalid public key");
  const digest = createHash("sha256").update(blob).digest("base64").replace(/=+$/, "");
  return { fingerprint: `SHA256:${digest}`, algorithm: parts[0] };
}

function assertPrivateKey(privateKey: string): string {
  const key = String(privateKey || "").replace(/\r\n/g, "\n").trim();
  if (!key || key.length > 100_000 || key.includes("\0") || !key.includes("PRIVATE KEY")) {
    throw new Error("private key required");
  }
  return `${key}\n`;
}

function derivePublicKey(privatePath: string): string {
  const derived = spawnSync("ssh-keygen", ["-y", "-f", privatePath], { encoding: "utf8" });
  const line = String(derived.stdout || "").trim().split("\n")[0] || "";
  if (derived.status !== 0 || !line.startsWith("ssh-")) throw new Error("invalid public key");
  return `${line}\n`;
}

export function readAdminSshStatus(admin: string): AdminSshStatus {
  const empty: AdminSshStatus = { configured: false, fingerprint: "", host: "", algorithm: "" };
  const dir = adminSshDir(admin);
  if (!dir) return empty;
  try {
    const raw = JSON.parse(readFileSync(join(dir, "status.json"), "utf8")) as Partial<AdminSshStatus>;
    if (!raw || raw.fingerprint === undefined || !existsSync(join(dir, "id_ed25519"))) return empty;
    return {
      configured: true,
      fingerprint: String(raw.fingerprint || ""),
      host: String(raw.host || "*"),
      algorithm: String(raw.algorithm || ""),
    };
  } catch {
    return empty;
  }
}

export function saveAdminSshKey(
  admin: string,
  input: { privateKey: string; publicKey?: string; host?: string },
): AdminSshStatus {
  const name = sanitizeWebAdmin(admin);
  if (!name) throw new Error("admin required");
  const privateKey = assertPrivateKey(input.privateKey);
  const host = sanitizeSshHost(input.host || "*");
  const dir = sshDir(name);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const keyPath = join(dir, "id_ed25519");
  writeFileSync(keyPath, privateKey, { mode: 0o600 });
  let pub = String(input.publicKey || "").trim();
  if (!pub) pub = derivePublicKey(keyPath).trim();
  const identity = fingerprintOpenSshPublicKey(pub);
  writeFileSync(join(dir, "id_ed25519.pub"), `${pub.trim()}\n`, { mode: 0o644 });
  const known = join(dir, "known_hosts");
  if (!existsSync(known)) writeFileSync(known, "", { mode: 0o644 });
  const config = [
    `Host ${host}`,
    `  IdentityFile ${keyPath}`,
    "  IdentitiesOnly yes",
    "  IdentityAgent none",
    "  StrictHostKeyChecking accept-new",
    `  UserKnownHostsFile ${known}`,
    "",
  ].join("\n");
  writeFileSync(join(dir, "config"), config, { mode: 0o600 });
  const bin = join(dir, "bin");
  mkdirSync(bin, { recursive: true, mode: 0o700 });
  const realSsh = existsSync("/usr/bin/ssh") ? "/usr/bin/ssh" : "ssh";
  const wrapper = join(bin, "ssh");
  writeFileSync(
    wrapper,
    `#!/bin/sh\nexec ${quotePath(realSsh)} -F ${quotePath(join(dir, "config"))} -o IdentitiesOnly=yes -o IdentityAgent=none "$@"\n`,
    { mode: 0o700 },
  );
  const status: AdminSshStatus = {
    configured: true,
    fingerprint: identity.fingerprint,
    host,
    algorithm: identity.algorithm,
  };
  writeFileSync(join(dir, "status.json"), `${JSON.stringify({ ...status, updated_at: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600 });
  return status;
}

export function clearAdminSshKey(admin: string): void {
  const dir = adminSshDir(admin);
  if (!dir) return;
  rmSync(dir, { recursive: true, force: true });
}

/**
 * Overlay for an admin shell. Drops the host agent whenever an admin is known.
 * A configured key is the only identity git/ssh will offer.
 */
export function adminShellEnv(admin: string): Record<string, string> {
  const name = sanitizeWebAdmin(admin);
  if (!name) return {};
  const env: Record<string, string> = { SSH_AUTH_SOCK: "", GIT_SSH_COMMAND: "" };
  const dir = sshDir(name);
  const wrapper = join(dir, "bin", "ssh");
  if (existsSync(wrapper) && existsSync(join(dir, "config"))) {
    env.PATH_PREFIX = dirname(wrapper);
    env.GIT_SSH_COMMAND = wrapper;
  }
  return env;
}

export function applyAdminSshEnvironment(
  environment: NodeJS.ProcessEnv,
  admin: string,
  platform: NodeJS.Platform = process.platform,
): NodeJS.ProcessEnv {
  const overlay = adminShellEnv(admin);
  if (!sanitizeWebAdmin(admin)) return environment;
  const next: NodeJS.ProcessEnv = { ...environment };
  delete next.SSH_AUTH_SOCK;
  delete next.GIT_SSH_COMMAND;
  if (overlay.GIT_SSH_COMMAND) {
    next.GIT_SSH_COMMAND = overlay.GIT_SSH_COMMAND;
    const pathKey = platform === "win32"
      ? Object.keys(next).find((item) => item.toUpperCase() === "PATH") ?? "PATH"
      : "PATH";
    const delimiter = platform === "win32" ? ";" : ":";
    const current = next[pathKey] ?? "";
    next[pathKey] = [overlay.PATH_PREFIX, current].filter(Boolean).join(delimiter);
  }
  return next;
}
