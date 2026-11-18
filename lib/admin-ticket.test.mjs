import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const { signAdminCookie, signAdminTicket, verifyAdminCookie, verifyAdminTicket } = await createJiti(import.meta.url).import("./admin-ticket.ts");

test("a ticket names the leaf and rejects a forgery or expiry", () => {
  const secret = "test-secret";
  const ticket = signAdminTicket("flyingu", secret, 1_700_000_000_000);
  assert.equal(verifyAdminTicket(ticket, secret, 1_700_000_000_000), "flyingu");
  assert.equal(verifyAdminTicket(ticket, "other-secret", 1_700_000_000_000), "");
  assert.equal(verifyAdminTicket(`${ticket}x`, secret, 1_700_000_000_000), "");
  assert.equal(verifyAdminTicket(ticket, secret, 1_700_000_000_000 + 6 * 60 * 1000), "");
  assert.throws(() => signAdminTicket("_", secret));
  assert.throws(() => signAdminTicket("朱世新", secret));
  const cookie = signAdminCookie("flyingu", secret, 1_700_000_000_000);
  assert.equal(verifyAdminCookie(cookie, secret, 1_700_000_000_000), "flyingu");
  assert.equal(verifyAdminTicket(cookie, secret, 1_700_000_000_000), "");
  assert.equal(verifyAdminCookie(ticket, secret, 1_700_000_000_000), "");
  assert.equal(verifyAdminCookie("flyingu", secret, 1_700_000_000_000), "");
});
