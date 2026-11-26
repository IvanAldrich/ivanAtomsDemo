# Proposal

## Why

当前生成流水线在契约层面鼓励单体文件：运行契约允许前端「内联或静态目录均可」，计划阶段只要求 4–12 个文件且没有大小预算。以浏览器小游戏为例，这类需求经常被生成为 30–80KB 的单文件；但问题并不限于游戏，任意网站或 Web 应用都可能出现同样的结构膨胀，并引发四个连锁问题：

- 迭代上下文每个文件只注入前 20,000 字符，大文件后半段模型不可见；80KB 总预算耗尽时大文件会被跳过。
- 单文件生成 `max_tokens` 为 12,000 且包含 reasoning，大文件必然截断并进入续写循环。
- 文件越大，SEARCH/REPLACE 的精确匹配越容易失败，进而触发最多 5 轮修复。
- 每次修复都重新注入关键文件，形成 token 与耗时的放大回路。

实测某类项目迭代每轮约 2.5–5 万 tokens，首轮构建可达 7 分钟。现在需要把「模块化」从提示词建议升级为可校验、可执行的架构约束，且该约束适用于任意网站类型。

## What Changes

- 新增架构 Profile 与 Module Manifest（落盘 `.atoms/manifest.json`）：规划阶段输出结构化模块清单，包含路径、职责、exports 签名、依赖和大小预算。Profile 覆盖通用网站、CRUD、工作台、落地页、API 服务与小游戏，并支持扩展；小游戏只是其中一种，不构成产品边界。
- 生成契约加入硬性文件预算：代码文件 soft 12KB / hard 16KB，`index.html` ≤ 4KB，内联 JS/CSS ≤ 2KB；提供 `generic-webapp`、`browser-game` 等 Profile 模板。
- 首次构建按依赖拓扑生成，单文件调用只注入依赖的 exports 签名，不再附带上游整文件；层内支持有限并发。
- 迭代改为 Context Assembler：依据 manifest、最近编辑和需求关键词选择 1–3 个目标文件及依赖签名，替代当前 80KB 全量注入；新增 `### NEED:` 按需读取协议与 EDIT 失败重读重试。
- 新增确定性结构门禁：大小、import 图、入口可达、内联代码、manifest 漂移，在 `npm install` 之前失败并返回结构化 violations。
- 新增 Split Agent：超限文件自动生成拆分计划，基于 TypeScript AST 搬移符号并保持公共 API，最多两次尝试。
- 新增生成观测：记录每轮 input/output/reasoning tokens、文件大小、上下文文件、EDIT/续写/拆分次数。
- **BREAKING**：迭代与修复轮不再全量注入关键文件；存量工程首次迭代时自动生成启发式 manifest。

## Capabilities

### New Capabilities

- `modular-project-generation`: 架构 Profile、Module Manifest、文件大小预算、依赖拓扑生成与模块模板。
- `context-aware-iteration`: 迭代上下文组装、目标文件选择、`NEED` 按需读取与 EDIT 重试策略。
- `structure-governance`: 确定性结构门禁与超限文件拆分工作流。
- `generation-observability`: 每轮 token、文件、上下文与失败指标的记录与查询。

### Modified Capabilities

无。当前 `openspec/specs/` 为空，不存在需要修改的既有 capability。

## Impact

- 代码：
  - `src/lib/build/prompts.ts`：运行契约、计划/单文件/修复提示词
  - `src/lib/build/generator.ts`：两阶段生成与逐文件循环
  - `src/lib/build/snapshot.ts`：`selectKeyFiles` 与快照写入
  - `src/lib/build/protocol.ts`：文件大小与数量上限
  - `src/lib/build/orchestrator.ts`：迭代/修复上下文与门禁调用
  - `src/lib/build/builder.ts`：结构门禁插入点（语法校验之前）
  - 新增 `src/lib/build/manifest.ts`、`context.ts`、`structure.ts`、`split.ts`、`stats.ts`
- 数据：快照内新增 `.atoms/manifest.json`；每轮指标可落 JSONL 或新增 Prisma 表。
- 依赖：AST 解析复用仓库已有的 `typescript`，不新增运行时依赖。
- 兼容性：无 manifest 的旧快照按文件树生成启发式 manifest；首次编辑超限文件时触发拆分。
- 预期收益：迭代上下文降到 24KB 以内（约 3–8k tokens），EDIT 失败率 < 5%，首轮构建 p50 ≤ 3 分钟。