import test from "node:test";
import assert from "node:assert/strict";
import { previewToken, verifyPreviewToken } from "../../preview-token";

process.env.SESSION_SECRET = "preview-test-secret";

test("preview token verifies for the right project and expires", () => {
  const token = previewToken("project-1", 60);
  assert.equal(verifyPreviewToken("project-1", token), true);
  assert.equal(verifyPreviewToken("project-2", token), false);
  assert.equal(verifyPreviewToken("project-1", `${token}x`), false);

  const expired = previewToken("project-1", -10);
  assert.equal(verifyPreviewToken("project-1", expired), false);
});

test("preview token rejects malformed input", () => {
  assert.equal(verifyPreviewToken("project-1", ""), false);
  assert.equal(verifyPreviewToken("project-1", "abc"), false);
  assert.equal(verifyPreviewToken("project-1", "9999999999.deadbeef"), false);
});