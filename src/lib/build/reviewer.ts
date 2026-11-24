import { readTree, selectKeyFiles } from "./snapshot";
import { llmConfigured, streamChat } from "@/lib/llm";

export type ReviewResult = { pass: boolean; feedback: string };

/**
 * L4 需求自检：验收员 LLM 对照原始需求核对功能覆盖。
 * 明确要求：PASS/FAIL 判定 + 缺失功能清单（打回修复轮）。
 */
export async function reviewRequirements(
  requirement: string,
  dir: string
): Promise<ReviewResult> {
  if (!llmConfigured()) return { pass: true, feedback: "" };

  const tree = await readTree(dir);
  const files = await selectKeyFiles(dir, 80 * 1024);

  const prompt = `你是产品验收员。请严格对照用户需求检查工程实现是否完整。

# 用户需求
${requirement.slice(0, 2000)}

# 工程文件树
${tree.map((p) => `- ${p}`).join("\n")}

# 关键文件内容
${files
  .map((f) => `### ${f.path}\n\`\`\`\n${f.content.slice(0, 16000)}\n\`\`\``)
  .join("\n\n")}

# 验收标准（只检查需求覆盖）
1. 需求中明确列出的每个功能，都能在代码中找到对应实现（前端交互 + 后端接口 + 持久化）
2. 不允许用无关功能替代用户点名的功能

# 重要
- 文件内容为节省上下文可能被截断展示。不要因展示截断判定文件不完整——完整性由平台的语法/资源机器校验负责。
- 若某功能代码未出现在展示片段中，视为可能存在（不因证据不足判 FAIL）；只有明确看到「用别的功能替代了需求功能」或「需求核心功能完全无对应代码」才判 FAIL。

只输出如下格式的前两行，不要输出其他分析：
第一行：RESULT: PASS 或 RESULT: FAIL
第二行（仅 FAIL 时）：缺失或偏离点：<逐条列出，用分号分隔>`;

  const result = await streamChat(
    [
      {
        role: "system",
        content:
          "你是严格的产品验收员，只做需求覆盖检查，不做代码风格评价。默认怀疑：功能说得存在但代码里找不到实现时判 FAIL。",
      },
      { role: "user", content: prompt },
    ],
    () => {},
    () => {}
  );
  const raw = result.text;

  const pass = /RESULT:\s*PASS/i.test(raw);
  const feedbackMatch = raw.match(/缺失或偏离点[:：]\s*([\s\S]{0,800})/);
  return {
    pass,
    feedback: pass
      ? ""
      : (feedbackMatch?.[1]?.trim() || raw.trim().slice(0, 500)),
  };
}