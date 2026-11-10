import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const {
  adminShellEnv,
  applyAdminSshEnvironment,
  clearAdminSshKey,
  readAdminSshStatus,
  saveAdminSshKey,
} = await jiti.import("./admin-ssh.ts");

const PRIVATE_KEY = "-----BEGIN OPENSSH PRIVATE KEY-----\ndGVzdA==\n-----END OPENSSH PRIVATE KEY-----\n";
const PUBLIC_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIJfakekeymaterialforadminssh test";

test("a saved key survives beside the admin and is not echoed back", () => {
  const root = mkdtempSync(join(tmpdir(), "admin-ssh-"));
  const previous = process.env.PI_WEB_SESSIONS_ROOT;
  process.env.PI_WEB_SESSIONS_ROOT = root;
  try {
    assert.equal(readAdminSshStatus("gaolele").configured, false);
    const status = saveAdminSshKey("gaolele", {
      privateKey: PRIVATE_KEY,
      publicKey: PUBLIC_KEY,
      host: "gitlab.gz.cvte.cn",
    });
    assert.equal(status.configured, true);
    assert.equal(status.host, "gitlab.gz.cvte.cn");
    assert.match(status.fingerprint, /^SHA256:/);
    assert.equal(JSON.stringify(status).includes("PRIVATE KEY"), false);
    const again = readAdminSshStatus("gaolele");
    assert.equal(again.fingerprint, status.fingerprint);
    const onDisk = readFileSync(join(root, "gaolele", "ssh", "id_ed25519"), "utf8");
    assert.match(onDisk, /PRIVATE KEY/);
    const wrapped = adminShellEnv("gaolele");
    assert.equal(wrapped.SSH_AUTH_SOCK, "");
    assert.match(wrapped.GIT_SSH_COMMAND, /gaolele\/ssh\/bin\/ssh$/);
    const other = adminShellEnv("huyufei");
    assert.equal(other.GIT_SSH_COMMAND, "");
    assert.equal(other.SSH_AUTH_SOCK, "");
    const bashEnv = applyAdminSshEnvironment(
      { SSH_AUTH_SOCK: "/tmp/host-agent", PATH: "/usr/bin", HOME: "/home/aoi" },
      "gaolele",
    );
    assert.equal(bashEnv.SSH_AUTH_SOCK, undefined);
    assert.match(String(bashEnv.PATH), /gaolele\/ssh\/bin/);
    assert.equal(applyAdminSshEnvironment({ SSH_AUTH_SOCK: "/tmp/host-agent" }, "").SSH_AUTH_SOCK, "/tmp/host-agent");
    clearAdminSshKey("gaolele");
    assert.equal(readAdminSshStatus("gaolele").configured, false);
    assert.throws(() => saveAdminSshKey("gaolele", { privateKey: "not a key", publicKey: PUBLIC_KEY }), /private key/);
    assert.throws(() => saveAdminSshKey("gaolele", { privateKey: PRIVATE_KEY, publicKey: PUBLIC_KEY, host: "bad host;" }), /invalid host/);
  } finally {
    if (previous === undefined) delete process.env.PI_WEB_SESSIONS_ROOT;
    else process.env.PI_WEB_SESSIONS_ROOT = previous;
    rmSync(root, { recursive: true, force: true });
  }
});
