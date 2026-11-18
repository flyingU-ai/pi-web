import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";

const originalPassword = process.env.PI_WEB_PASSWORD;
const originalSessions = process.env.PI_WEB_SESSIONS_ROOT;
const originalWarehouse = process.env.ANNOTATION_WORKSPACE_ROOT;
const originalTicket = process.env.PI_WEB_TICKET_SECRET;
const originalTicketFile = process.env.PI_WEB_TICKET_SECRET_FILE;
const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});

before(() => {
  delete process.env.PI_WEB_PASSWORD;
  delete process.env.PI_WEB_SESSIONS_ROOT;
  delete process.env.ANNOTATION_WORKSPACE_ROOT;
  delete process.env.PI_WEB_TICKET_SECRET;
  delete process.env.PI_WEB_TICKET_SECRET_FILE;
});
after(() => {
  const restore = (name, value) => {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  };
  restore("PI_WEB_PASSWORD", originalPassword);
  restore("PI_WEB_SESSIONS_ROOT", originalSessions);
  restore("ANNOTATION_WORKSPACE_ROOT", originalWarehouse);
  restore("PI_WEB_TICKET_SECRET", originalTicket);
  restore("PI_WEB_TICKET_SECRET_FILE", originalTicketFile);
});

const { proxy } = await jiti.import("../proxy.ts");

function request(path, headers = {}) {
  return new NextRequest(`http://localhost${path}`, {
    headers: { Host: "localhost", ...headers },
  });
}

function cookieHeader(response) {
  return response.headers.getSetCookie?.() || response.headers.get("set-cookie") || "";
}

test("document ?admin= sets the lab cookie", () => {
  const response = proxy(request("/?cwd=%2Fpool&admin=flyingu"));
  assert.equal(response.status, 200);
  assert.match(String(cookieHeader(response)), /aoi_admin=flyingu/);
});

test("full document without admin clears the lab cookie", () => {
  const response = proxy(request("/?session=abc"));
  assert.equal(response.status, 200);
  assert.match(String(cookieHeader(response)), /aoi_admin=;/);
});

test("RSC session switch without admin keeps the current cookie", () => {
  const response = proxy(request("/?session=abc", {
    RSC: "1",
    Cookie: "aoi_admin=flyingu",
  }));
  assert.equal(response.status, 200);
  assert.doesNotMatch(String(cookieHeader(response)), /aoi_admin=/);
});

test("client router fetch (sec-fetch-dest empty) keeps the current cookie", () => {
  const response = proxy(request("/?session=abc", {
    "sec-fetch-dest": "empty",
    "sec-fetch-mode": "cors",
    Cookie: "aoi_admin=flyingu",
  }));
  assert.equal(response.status, 200);
  assert.doesNotMatch(String(cookieHeader(response)), /aoi_admin=/);
});

test("a warehouse ticket sets the leaf and a named admin cannot choose another", async () => {
  const previousSecret = process.env.PI_WEB_TICKET_SECRET;
  const previousSessions = process.env.PI_WEB_SESSIONS_ROOT;
  process.env.PI_WEB_TICKET_SECRET = "test-secret";
  process.env.PI_WEB_SESSIONS_ROOT = "/tmp/pi-web-sessions";
  try {
    const { signAdminTicket } = await jiti.import("../lib/admin-ticket.ts");
    const ticket = signAdminTicket("flyingu", "test-secret", Date.now());
    const exchanged = proxy(request(`/?cwd=%2Fpool&ticket=${encodeURIComponent(ticket)}`));
    assert.equal(exchanged.status, 303);
    const setCookie = String(cookieHeader(exchanged));
    assert.match(setCookie, /aoi_leaf=flyingu/);
    const signed = /aoi_admin=([^;]+)/.exec(setCookie)?.[1] || "";
    assert.match(signed, /^v1\./);
    assert.doesNotMatch(String(exchanged.headers.get("location")), /ticket=/);
    assert.doesNotMatch(String(exchanged.headers.get("location")), /admin=/);

    const forged = proxy(request(`/?ticket=${encodeURIComponent(ticket)}&admin=gaolele`));
    assert.equal(forged.status, 403);

    const named = proxy(request("/?admin=flyingu"));
    assert.equal(named.status, 403);
    assert.doesNotMatch(String(cookieHeader(named)), /aoi_admin=/);

    const header = proxy(request("/api/sessions", {
      Cookie: `aoi_admin=${signed}`,
      "x-aoi-admin": "gaolele",
    }));
    assert.equal(header.status, 403);

    const unsigned = proxy(request("/api/sessions", { Cookie: "aoi_admin=flyingu" }));
    assert.equal(unsigned.status, 401);

    const ok = proxy(request("/api/sessions", { Cookie: `aoi_admin=${signed}` }));
    assert.equal(ok.status, 200);

    const missing = proxy(request("/api/sessions"));
    assert.equal(missing.status, 401);
  } finally {
    if (previousSecret === undefined) delete process.env.PI_WEB_TICKET_SECRET;
    else process.env.PI_WEB_TICKET_SECRET = previousSecret;
    if (previousSessions === undefined) delete process.env.PI_WEB_SESSIONS_ROOT;
    else process.env.PI_WEB_SESSIONS_ROOT = previousSessions;
  }
});
