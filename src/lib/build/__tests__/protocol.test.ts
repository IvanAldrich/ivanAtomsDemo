import test from "node:test";
import assert from "node:assert/strict";
import {
  extractNeedPaths,
  isValidPath,
  parseGenerationPlan,
  validatePlan,
} from "../protocol";

test("parseGenerationPlan reads FILE, EDIT, DELETE and NEED", () => {
  const raw = `说明
### FILE: a.js
\`\`\`js
export const a = 1;
\`\`\`
### EDIT: b.js
<<<<<<< SEARCH
old
=======
new
>>>>>>> REPLACE
### DELETE: c.js
### NEED: d.js
`;
  const plan = parseGenerationPlan(raw);
  assert.equal(plan.files[0].path, "a.js");
  assert.equal(plan.files[0].content, "export const a = 1;");
  assert.equal(plan.edits[0].search, "old");
  assert.equal(plan.edits[0].replace, "new");
  assert.deepEqual(plan.deletes, ["c.js"]);
  assert.deepEqual(plan.needs, ["d.js"]);
});

test("extractNeedPaths accepts safe paths and rejects traversal", () => {
  const raw = `### NEED: src/a.js
### NEED: ../secret
### NEED: /etc/passwd
### NEED: src/a.js
`;
  assert.deepEqual(extractNeedPaths(raw), ["src/a.js"]);
});

test("isValidPath rejects annotated or non-ASCII paths", () => {
  assert.equal(isValidPath("public/src/main.js"), true);
  assert.equal(
    isValidPath("public/src/main.js（续接断点，从 import 之后开始）"),
    false
  );
  assert.equal(isValidPath("src/中文.js"), false);
  assert.equal(isValidPath("src/main file.js"), false);
});

test("validatePlan rejects direct manifest writes", () => {
  const plan = parseGenerationPlan(
    "### FILE: .atoms/manifest.json\n```json\n{}\n```"
  );
  assert.throws(
    () => validatePlan(plan, { requirePackageJson: false }),
    /Manifest 由平台管理/
  );
});

test("validatePlan rejects markdown fences inside code files", () => {
  const plan = parseGenerationPlan(
    "### FILE: public/app.js\n```js\nconst a = 'function```javascript\naw = 1;\n```"
  );
  assert.throws(
    () => validatePlan(plan, { requirePackageJson: false }),
    /Markdown 代码围栏/
  );
});

test("validatePlan rejects FILE and DELETE on the same path", () => {
  const plan = parseGenerationPlan(
    "### FILE: public/app.js\n```js\nexport const a = 1;\n```\n### DELETE: public/app.js"
  );
  assert.throws(
    () => validatePlan(plan, { requirePackageJson: false }),
    /FILE 与 DELETE/
  );
});

test("validatePlan enforces code file budget by option", () => {
  const big = "x".repeat(17 * 1024);
  const plan = parseGenerationPlan(`### FILE: public/app.js\n\`\`\`js\n${big}\n\`\`\``);
  assert.throws(
    () => validatePlan(plan, { requirePackageJson: false, maxCodeFileKB: 16 }),
    /超过模块预算/
  );
  assert.doesNotThrow(() =>
    validatePlan(plan, { requirePackageJson: false, maxCodeFileKB: 512 })
  );
});