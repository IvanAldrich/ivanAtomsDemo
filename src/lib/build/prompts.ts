export const RUNTIME_CONTRACT = `
# 任务与硬性约束（违反任何一条即判失败）

你为一个托管平台生成「可独立构建运行的 Node.js 全栈工程」。平台将执行：npm install → npm run build（如有）→ npm start 并探测端口就绪。产物必须是**多文件工程**，不是单个网页。

1. 【必须】文件清单包含 package.json：含 name 与 scripts.start（如 "node server.js"），dependencies 可为空对象
2. 【必须】包含 Node.js 后端服务入口：监听 process.env.PORT（默认 3000），优先纯 Node 内置模块（也可用 express）
3. 【必须】包含前端页面：由该后端伺服 HTML/CSS/JS（内联或静态目录均可）
4. 【必须】包含数据持久化：读写工程内 ./data 目录（JSON 文件或 SQLite）
5. 【禁止】只输出一个 HTML 文件；【禁止】依赖浏览器 localStorage 作为唯一持久化
6. dependencies 仅限 npm 公共仓库；不得读取宿主环境变量之外的秘密、不得连接平台内部服务
7. 界面文本语言跟随用户需求语言，注意响应式与基础美观

# 输出协议（唯一允许的输出格式）

先一句简短说明，然后逐文件输出，格式严格如下：

### FILE: package.json
\`\`\`json
{ ...完整文件内容... }
\`\`\`

### FILE: server.js
\`\`\`js
// 完整文件内容
\`\`\`

依此类推。需要删除文件时单独一行：### DELETE: 相对路径
每个文件必须是完整内容（不是 diff/片段）。`;

export function buildSystemPrompt(): string {
  return `你是一位资深全栈工程师 AI，为用户构建可上线的完整产品（前端 + 后端 + 数据持久化）。

${RUNTIME_CONTRACT}

# 需求覆盖（重要）

用户明确列出的每个功能点 MUST 实现——宁可实现超出，不可缺失。开头的一句话说明中列出已实现的功能清单，便于用户核对。

# 对话式消息（重要）

如果用户消息只是询问或讨论（例如「完成了吗」「进展如何」「这个功能是怎么做的」），而不是构建或修改需求：直接用简短文字回答（2-5 句），不要输出任何 ### FILE 块。只有当消息包含新的构建/修改意图时才输出文件。

工程惯例参考（架构自由，但上述硬性约束不可违反）：
- 小型产品推荐形态：单入口 Node HTTP 服务（http 内置模块或 express）+ 伺服静态前端目录 + JSON 文件存储
- 前后端同进程即可，无需数据库服务；表单/列表注意基础样式与移动端适配`;
}

export type IterationContext = {
  requirementHistory: string[];
  fileTree: string[];
  keyFileContents: Array<{ path: string; content: string }>;
};

export function buildUserPrompt(
  requirement: string,
  ctx: IterationContext | null
): string {
  if (!ctx || ctx.fileTree.length === 0) {
    return `用户需求：\n\n${requirement}\n\n请从零生成完整工程（首次构建）。牢记输出协议与全部硬性约束。`;
  }

  const tree = ctx.fileTree.map((p) => `- ${p}`).join("\n");
  const contents = ctx.keyFileContents
    .map((f) => `### 现有文件 ${f.path}\n\`\`\`\n${f.content.slice(0, 20000)}\n\`\`\``)
    .join("\n\n");

  const history = ctx.requirementHistory
    .slice(-8)
    .map((r, i) => `${i + 1}. ${r.slice(0, 500)}`)
    .join("\n");

  return `这是对已有工程的迭代修改。

# 需求历史
${history}

# 当前需求
${requirement}

注意：先判断这条消息的性质——
- 若是提问/讨论（如「完成了吗」）：直接简短回答，不要输出文件
- 若是构建/修改需求：按输出协议输出需要新增/修改的完整文件与需要删除的文件；用户点名的功能 MUST 全部实现

# 当前工程文件树
${tree}

# 关键现有文件内容
${contents || "（无注入）"}

未提及的文件保持不变（已有 package.json 时无需重发）。`;
}

export function buildRepairPrompt(input: {
  requirement: string;
  error: string;
  tree: string[];
  keyFileContents: Array<{ path: string; content: string }>;
  previousRawTail: string;
}): string {
  const hasFiles = input.tree.length > 0;
  const tree = input.tree.map((p) => `- ${p}`).join("\n") || "（尚无文件落盘）";
  const contents = input.keyFileContents
    .map((f) => `### 现有文件 ${f.path}\n\`\`\`\n${f.content.slice(0, 12000)}\n\`\`\``)
    .join("\n\n");

  return `上一轮输出未通过平台的校验或构建，需要修复。

# 不可丢失的用户需求（修复时必须保持完整实现，禁止回退或删减需求功能）
${input.requirement.slice(0, 2000)}

# 失败原因 / 错误输出（截断）
\`\`\`
${input.error.slice(-3000)}
\`\`\`
${hasFiles ? "" : `\n# 上一轮原始输出（尾部截断，未通过协议校验）\n\`\`\`\n${input.previousRawTail.slice(-2000)}\n\`\`\`\n请严格按输出协议重新输出完整工程（多文件 + package.json + Node 服务端），不要重复上一轮的错误。`}

# 当前工程文件树
${tree}

${contents ? `# 相关文件内容\n${contents}` : ""}

请按输出协议输出修复后的完整文件${
    hasFiles ? "（只输出需要修改的文件，未提及的保持不变）" : ""
  }。修复目标是同时满足：构建通过 + 用户需求功能完整。`;
}
