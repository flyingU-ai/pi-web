import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { moduleCache: false });

test("multi-user mode without a warehouse does not open the shared auth file", async () => {
  const previous = {
    sessions: process.env.PI_WEB_SESSIONS_ROOT,
    warehouse: process.env.ANNOTATION_WORKSPACE_ROOT,
    folder: process.env.PI_WEB_OPEN_FOLDER,
    secret: process.env.PI_WEB_TICKET_SECRET,
    secretFile: process.env.PI_WEB_TICKET_SECRET_FILE,
  };
  process.env.PI_WEB_SESSIONS_ROOT = "/tmp/pi-web-sessions-only";
  delete process.env.ANNOTATION_WORKSPACE_ROOT;
  delete process.env.PI_WEB_OPEN_FOLDER;
  delete process.env.PI_WEB_TICKET_SECRET;
  delete process.env.PI_WEB_TICKET_SECRET_FILE;
  try {
    const { resolveAdminAuthPath } = await jiti.import("./model-runtime.ts");
    await assert.rejects(resolveAdminAuthPath(), /admin required/);
  } finally {
    const restore = (name, value) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore("PI_WEB_SESSIONS_ROOT", previous.sessions);
    restore("ANNOTATION_WORKSPACE_ROOT", previous.warehouse);
    restore("PI_WEB_OPEN_FOLDER", previous.folder);
    restore("PI_WEB_TICKET_SECRET", previous.secret);
    restore("PI_WEB_TICKET_SECRET_FILE", previous.secretFile);
  }
});
