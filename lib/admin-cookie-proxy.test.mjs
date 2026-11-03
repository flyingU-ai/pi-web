import assert from "node:assert/strict";
import test, { after, before } from "node:test";
import { createJiti } from "jiti";
import { NextRequest } from "next/server.js";

const originalPassword = process.env.PI_WEB_PASSWORD;
const jiti = createJiti(import.meta.url, {
  alias: { "@": process.cwd() },
  interopDefault: true,
  moduleCache: false,
});

before(() => { delete process.env.PI_WEB_PASSWORD; });
after(() => {
  if (originalPassword === undefined) delete process.env.PI_WEB_PASSWORD;
  else process.env.PI_WEB_PASSWORD = originalPassword;
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
