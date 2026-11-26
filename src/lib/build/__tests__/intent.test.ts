import test from "node:test";
import assert from "node:assert/strict";
import { classifyIntent, removalRequested, shouldRunReview } from "../intent";

test("bug reports are not treated as feature requirements", () => {
  const text = "不对，点击“开始游戏”没响应，页面布局也不合理";
  assert.equal(classifyIntent(text), "bug-report");
  assert.equal(shouldRunReview(text, { isNewProject: false }), false);
});

test("feature requests still trigger review", () => {
  assert.equal(classifyIntent("给待办列表加一个搜索框"), "build");
  assert.equal(
    shouldRunReview("给待办列表加一个搜索框", { isNewProject: false }),
    true
  );
  assert.equal(classifyIntent("把按钮改成红色"), "build");
});

test("questions and new projects", () => {
  assert.equal(classifyIntent("现在完成了吗"), "question");
  assert.equal(shouldRunReview("现在完成了吗", { isNewProject: false }), false);
  assert.equal(
    shouldRunReview("做一个公司官网落地页", { isNewProject: true }),
    true
  );
});

test("missing-feature symptoms are bug reports, not feature requests", () => {
  const text = "1.去处“测试变更”文案\n2.现在页面上只能看到背景图，没有战舰、陨石等元素";
  assert.equal(classifyIntent(text), "bug-report");
  assert.equal(shouldRunReview(text, { isNewProject: false }), false);
});

test("removalRequested only fires on explicit removal wording", () => {
  assert.equal(removalRequested("删除测试文案"), true);
  assert.equal(removalRequested("把测试变更去掉"), true);
  assert.equal(removalRequested("请修复，页面还是乱的"), false);
  assert.equal(removalRequested("去处“测试变更”文案"), false);
});