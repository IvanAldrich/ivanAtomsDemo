export type MessageIntent = "build" | "bug-report" | "question";

const BUG_RE =
  /(没响应|无响应|没反应|不工作|不生效|报错|错误|异常|布局不合理|样式不对|不对|无法|打不开|404|500|卡住|闪退|崩溃|看不到|不显示|没有|消失|丢失|只剩|空白|黑屏|点击.{0,8}(没|无|不)|按钮.{0,8}(没|无|不))/;

const REMOVE_RE = /(删除|去掉|去除|移除|不要|取消|清理)/;

export function removalRequested(text: string): boolean {
  return REMOVE_RE.test(text);
}

const BUILD_RE =
  /(实现|新增|添加|增加|加一个|加个|加入|改成|改为|修改|修复|支持|优化|调整|重构|搭建|做一个|开发|上线|部署|更新|替换|去掉|删除)/;

const QUESTION_RE = /(为什么|怎么|如何|是什么|吗|呢|是否|能否|可以吗|完成了吗|进展)/;

export function classifyIntent(text: string): MessageIntent {
  if (BUG_RE.test(text)) return "bug-report";
  if (BUILD_RE.test(text)) return "build";
  if (QUESTION_RE.test(text)) return "question";
  return "build";
}

/**
 * 需求自检只适合功能/构建类消息。
 * 缺陷报告与咨询类消息不应被要求“实现”报告中的负面现象，否则必然误判 FAIL。
 */
export function shouldRunReview(
  text: string,
  opts: { isNewProject: boolean }
): boolean {
  if (opts.isNewProject) return true;
  return classifyIntent(text) === "build";
}