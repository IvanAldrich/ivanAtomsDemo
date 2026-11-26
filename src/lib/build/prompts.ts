import type { ModuleEntry, ModuleManifest } from "./manifest";
import { profilePrompt, type Profile } from "./profiles";

export const RUNTIME_CONTRACT = `
# 任务与硬性约束（违反任何一条即判失败）

你为一个托管平台生成「可独立构建运行的 Node.js 全栈工程」。平台将执行：npm install → npm run build（如有）→ npm start 并探测端口就绪。产物必须是**多文件工程**，不是单个网页。

1. 【必须】文件清单包含 package.json：含 name 与 scripts.start（如 "node server.js"），dependencies 可为空对象
2. 【必须】包含 Node.js 后端服务入口：监听 0.0.0.0:process.env.PORT（默认 3000）；容器内运行时只允许该端口对外，绑定 127.0.0.1 会导致平台无法探测
3. 【必须】包含前端页面：由该后端伺服 HTML/CSS/JS（内联或静态目录均可）
4. 【必须】包含数据持久化：读写工程内 ./data 目录（JSON 文件或 SQLite）
5. 【禁止】只输出一个 HTML 文件；【禁止】依赖浏览器 localStorage 作为唯一持久化
6. 前端资源与 API 引用【必须】使用相对路径（如 ./app.js、styles.css、fetch('api/list')），【禁止】以 / 开头的根绝对路径（平台以路径前缀托管，绝对路径会 404）
7. dependencies 仅限 npm 公共仓库；不得读取宿主环境变量之外的秘密、不得连接平台内部服务
8. 运行容器默认无外网访问（internal network），不得依赖运行时外部 API/外链；只允许写工程目录与 /tmp
9. 界面文本语言跟随用户需求语言，注意响应式与基础美观

# 模块化与大小预算（硬性）

1. 【必须】单文件代码 soft 10–12KB、hard 16KB；\`index.html\` ≤ 4KB；内联 JS/CSS ≤ 2KB；CSS 单文件 ≤ 8KB
2. 【必须】每个文件只承担一个职责；禁止把整个游戏/应用塞进单个 app.js
3. 【必须】浏览器代码使用 ES modules + 相对路径；依赖通过 import 引用，禁止复制其他模块实现
4. 【必须】禁止内联超过 8KB 的 base64/data URI 资源；资源放入静态目录并以相对 URL 引用
5. 【必须】若某项改动会使文件超过预算，先拆分为新模块并保持原文件 re-export，不得继续堆积
6. 迭代时只修改目标文件；需要其他文件时使用 \`### NEED: 路径\` 请求，不要重发整个工程
7. 【必须】除非用户明确要求删除某功能/文件，禁止输出 DELETE；修复错误必须在原文件内完成，不得通过删除模块绕过门禁
8. 【必须】浏览器入口脚本自启动必须同时处理两种时序：\`if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init); else init();\`——只监听 DOMContentLoaded 在脚本晚于事件执行时会永远不初始化

# 输出协议（唯一允许的输出格式）

先一句简短说明，然后按需输出以下块：

1) 整文件（新文件或大重构）：
### FILE: package.json
\`\`\`json
{ ...完整文件内容... }
\`\`\`

2) 增量修改（迭代首选，为节省 token 与避免重写大文件）：
### EDIT: public/app.js
<<<<<<< SEARCH
（旧代码片段，必须与现有文件逐字符一致）
=======
（替换后的新代码片段）
>>>>>>> REPLACE

3) 删除文件：
### DELETE: 相对路径

4) 请求补充上下文（迭代轮，最多两轮）：
### NEED: src/core/engine.js

规则：FILE 块必须是完整内容；EDIT 的 SEARCH 必须逐字复制现有文件内容（含缩进，
不确定原文时不要用 EDIT）；小于约 400 行的文件修改时优先用 FILE 整文件重写
（更可靠），只有大文件才用 EDIT；迭代优先使用 EDIT，仅新增文件或大面积
重构才用 FILE；未提及的文件保持不变。`;

export function buildSystemPrompt(): string {
  return `你是一位资深全栈工程师 AI，为用户构建可上线的完整产品（前端 + 后端 + 数据持久化）。

${RUNTIME_CONTRACT}

# 需求覆盖（重要）

用户明确列出的每个功能点 MUST 实现——宁可实现超出，不可缺失。开头的一句话说明中列出已实现的功能清单，便于用户核对。

# 对话式消息（重要）

如果用户消息只是询问或讨论（例如「完成了吗」「进展如何」「这个功能是怎么做的」），而不是构建或修改需求：直接用简短文字回答（2-5 句），不要输出任何 ### FILE 块。

如果用户消息是在**报告现象或提问**（例如「为什么 404」「按钮没反应」「预览里看不到 X」）：先用 2-5 句给出最可能的原因诊断（提示可能是旧版本预览、缓存、或描述中已存在的功能），并明确询问是否需要修改；用户未明确要求修改前，不要输出任何 ### FILE 块。

只有当消息包含**明确的构建/修改意图**（如「加一个 X 功能」「把 Y 改成 Z」「修复并实现 W」）时才输出文件。

工程惯例参考（架构与文件划分以 Module Manifest 为准，不得违反上述硬性约束）：
- 若上下文中提供了 Module Manifest，严格遵守其中的模块职责、依赖与大小预算；不得把模块合并回单个大文件
- 小型产品推荐形态：单入口 Node HTTP 服务（http 内置模块或 express）+ 伺服静态前端目录 + JSON 文件存储
- 前后端同进程即可，无需数据库服务；表单/列表注意基础样式与移动端适配`;
}

export type IterationContext = {
  requirementHistory: string[];
  fileTree: string[];
  keyFileContents: Array<{ path: string; content: string; truncated?: boolean; index?: string }>;
  manifestSummary?: string;
  stubs?: Array<{ path: string; role: string; exports: string[] }>;
  targetPaths?: string[];
};

export function buildUserPrompt(
  requirement: string,
  ctx: IterationContext | null
): string {
  if (!ctx || (ctx.fileTree.length === 0 && ctx.keyFileContents.length === 0)) {
    return `用户需求：\n\n${requirement}\n\n请从零生成完整工程（首次构建）。牢记输出协议与全部硬性约束。`;
  }

  const tree = ctx.fileTree.map((p) => `- ${p}`).join("\n");
  const contents = ctx.keyFileContents
    .map(
      (f) =>
        `### 现有文件 ${f.path}${f.truncated ? "（仅相关片段，非完整文件）" : ""}\n` +
        (f.index
          ? `范围/符号索引（仅用于定位，不是文件内容；禁止用于 SEARCH）：\n${f.index}\n`
          : "") +
        `\`\`\`\n${f.content.slice(0, 20000)}\n\`\`\``
    )
    .join("\n\n");

  const stubs = (ctx.stubs ?? [])
    .map(
      (s) =>
        `### 依赖签名 ${s.path}（${s.role}）\n` +
        (s.exports.length ? s.exports.map((e) => `- ${e}`).join("\n") : "- （无导出）")
    )
    .join("\n\n");

  const history = ctx.requirementHistory
    .slice(-3)
    .map((r, i) => `${i + 1}. ${r.slice(0, 500)}`)
    .join("\n");

  const targets = (ctx.targetPaths ?? []).join("、");

  return `这是对已有工程的迭代修改。

# 需求历史（仅最近）
${history || "（无）"}

# 当前需求
${requirement}

${ctx.manifestSummary ? `# Module Manifest\n${ctx.manifestSummary}\n` : ""}
# 当前工程文件树
${tree}

# 目标文件（只修改这些文件）
${targets || "（按需求选择）"}

# 关键现有文件内容
${contents || "（无注入）"}

${stubs ? `# 依赖签名（只读，不要修改或复制实现）\n${stubs}\n` : ""}
注意：先判断这条消息的性质——
- 若是提问/讨论（如「完成了吗」）：直接简短回答，不要输出文件
- 若是修改需求：优先用 EDIT（SEARCH/REPLACE）做增量修改，仅新增文件或大面积重构用 FILE；
  用户点名的功能 MUST 全部实现
- 只修改目标文件；若确实还需要其他文件，用 \`### NEED: 路径\` 请求，不要重发整个工程
- SEARCH 必须逐字符匹配代码块中的真实行；不要使用范围/符号索引、行号或说明文字作为 SEARCH
- 若改动会使文件超过预算，先拆分为新模块并在原文件 re-export

未提及的文件保持不变（已有 package.json 时无需重发）。`;
}

/** 两阶段生成 · 阶段一：输出结构化 Module Manifest（省 token、可校验） */
export function buildPlanPrompt(requirement: string, profile?: Profile): string {
  return `用户需求：
${requirement}

${profile ? `# 推荐架构\n${profilePrompt(profile)}\n` : ""}
请只输出一个 JSON 对象，不要输出代码、Markdown 围栏或额外解释。结构：
{
  "schemaVersion": 1,
  "profile": "<profile-name>",
  "entry": "public/index.html",
  "budgets": {
    "fileSoftKB": 10,
    "fileHardKB": 16,
    "htmlKB": 4,
    "inlineKB": 2,
    "contextKB": 24,
    "inlineAssetKB": 8
  },
  "modules": [
    { "path": "public/index.html", "role": "entry-html", "exports": [], "deps": [], "maxKB": 4 },
    { "path": "public/src/main.js", "role": "bootstrap", "exports": ["bootstrap()"], "deps": ["./core/engine.js"], "maxKB": 4 }
  ]
}

硬性要求：
- 模块数 4–16；entry 必须出现在 modules 中；package.json 不需要列入 modules
- 每个模块只承担一个职责，maxKB 不超过 16，且代码文件目标 ≤ 12KB
- deps 必须是工程内相对路径（./ 或 ../），指向 modules 中的其他模块
- 浏览器小游戏必须拆分引擎、输入、渲染、实体、关卡、HUD、存档等职责，禁止单文件`;
}

/** 两阶段生成 · 阶段二：只生成单个文件的完整内容（只给依赖签名） */
export function buildSingleFilePrompt(
  requirement: string,
  manifest: ModuleManifest,
  target: ModuleEntry,
  depSignatures: Array<{ path: string; role: string; exports: string[] }>,
  siblings: Array<{ path: string; content: string }> = []
): string {
  const moduleList = manifest.modules
    .map((m) => `- ${m.path} — ${m.role}（≤${m.maxKB ?? manifest.budgets.fileSoftKB}KB）`)
    .join("\n");
  const deps = depSignatures
    .map(
      (d) =>
        `### ${d.path}（${d.role}）\n` +
        (d.exports.length ? d.exports.map((e) => `- ${e}`).join("\n") : "- （无导出）")
    )
    .join("\n\n");
  const budget = target.maxKB ?? manifest.budgets.fileSoftKB;

  let siblingBlock = "";
  let used = 0;
  const picked: Array<{ path: string; content: string }> = [];
  for (const s of siblings) {
    const size = Math.min(s.content.length, 10000);
    if (used + size > 26000) continue;
    picked.push({ path: s.path, content: s.content.slice(0, 10000) });
    used += size;
  }
  if (picked.length > 0) {
    siblingBlock = `# 已生成文件（必须与其保持 DOM id、函数签名、state 字段完全一致）\n${picked
      .map((s) => `### ${s.path}\n\`\`\`\n${s.content}\n\`\`\``)
      .join("\n\n")}\n`;
  }

  return `工程需求：
${requirement}

# 工程模块清单
${moduleList}

# 当前文件
路径：${target.path}
职责：${target.role}
必须导出：${target.exports.length ? target.exports.join(", ") : "（按职责导出）"}
大小预算：≤ ${budget}KB（硬上限 ${manifest.budgets.fileHardKB}KB）

${deps ? `# 依赖签名（只读，不要复制其实现）\n${deps}\n` : ""}${siblingBlock}
现在**只输出文件 ${target.path} 的完整内容**，格式：
### FILE: ${target.path}
\`\`\`语言
完整内容
\`\`\`
只输出这一个文件块，不要输出其他文件；与已生成文件中的 DOM id、函数签名、
state 字段/属性名逐字一致（这是硬性要求，任何不一致都会导致功能失效）；若内容
将超过预算，必须精简职责而不是继续堆积。`;
}

export function buildRepairPrompt(input: {
  requirement: string;
  error: string;
  tree: string[];
  keyFileContents: Array<{ path: string; content: string; truncated?: boolean; index?: string }>;
  previousRawTail: string;
  violations?: string[];
  targetPaths?: string[];
}): string {
  const hasFiles = input.tree.length > 0;
  const tree = input.tree.map((p) => `- ${p}`).join("\n") || "（尚无文件落盘）";
  const contents = input.keyFileContents
    .map(
      (f) =>
        `### 现有文件 ${f.path}${f.truncated ? "（仅相关片段，非完整文件）" : ""}\n` +
        (f.index
          ? `范围/符号索引（仅用于定位，不是文件内容；禁止用于 SEARCH）：\n${f.index}\n`
          : "") +
        `\`\`\`\n${f.content.slice(0, 12000)}\n\`\`\``
    )
    .join("\n\n");
  const violations = (input.violations ?? []).join("\n");
  const targets = (input.targetPaths ?? []).join("、");

  return `上一轮输出未通过平台的校验或构建，需要修复。

# 不可丢失的用户需求（修复时必须保持完整实现，禁止回退或删减需求功能）
${input.requirement.slice(0, 2000)}

# 失败原因 / 错误输出（截断）
\`\`\`
${input.error.slice(-3000)}
\`\`\`
${violations ? `\n# 结构门禁错误（必须逐条修复）\n\`\`\`\n${violations}\n\`\`\`\n` : ""}${targets ? `\n# 目标文件\n${targets}\n` : ""}
${hasFiles ? "" : `\n# 上一轮原始输出（尾部截断，未通过协议校验）\n\`\`\`\n${input.previousRawTail.slice(-2000)}\n\`\`\`\n请严格按输出协议重新输出完整工程（多文件 + package.json + Node 服务端），不要重复上一轮的错误。`}

# 当前工程文件树
${tree}

${contents ? `# 相关文件内容\n${contents}` : ""}

请按输出协议输出修复后的文件${
    hasFiles ? "（只输出需要修改的文件，未提及的保持不变）" : ""
  }。修复目标是同时满足：结构门禁通过 + 构建通过 + 用户需求功能完整。
若错误包含 FILE_TOO_LARGE / INLINE_TOO_LARGE，必须拆分或抽取外部文件，不得继续输出超限大文件。
修复轮可以新增模块（例如修复 MISSING_DEP、恢复被删文件、或按错误提示补文件），但必须与现有结构一致且被正确 import。
删除文件仍受限制：除非用户明确要求删除，否则不要输出 DELETE；重写文件只用 FILE，不要对同一文件同时输出 FILE 和 DELETE。
SEARCH 必须逐字符匹配代码块中的真实行；不要使用范围/符号索引、行号或说明文字作为 SEARCH。
修复语法/结构错误必须在原文件内修正，不得删除模块绕过门禁。`;
}
