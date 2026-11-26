import test from "node:test";
import assert from "node:assert/strict";
import { hashPassword, verifyPassword } from "../../password";

test("password hashing verifies the right password only", async () => {
  const hash = await hashPassword("correct-horse-battery");
  assert.match(hash, /^scrypt\$/);
  assert.equal(await verifyPassword("correct-horse-battery", hash), true);
  assert.equal(await verifyPassword("wrong-password", hash), false);
  assert.equal(await verifyPassword("correct-horse-battery", null), false);
  assert.equal(await verifyPassword("correct-horse-battery", "not-a-hash"), false);
});