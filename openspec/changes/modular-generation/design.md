# Design

## Context

当前流水线（参见 proposal.md - Why）：

- 首次构建走两阶段生成：计划（自由文本清单）+ 逐文件生成，单文件 `max_tokens` 12,000，逐文件串行。
- 迭代通过 `selectKeyFiles` 注入最多 80KB 关键文件，单文件在 prompt 里再截前 20,000 字符；需求历史取最近 8 条、每条 500 字符。
- 构建顺序为语法校验 → `npm install` → `npm run build` → 启动探测 → 资源冒烟；失败最多重试 5 轮。
- 生成工程是纯 Node + 静态前端，无打包器；运行时通过 preview/publish 路由以路径前缀托管。
- 存量快照没有 manifest；`openspec/specs/` 为空，本 change 同时建立新的 capability 基线。

设计约束：不引入打包器或框架；不改变运行时隔离；所有生成能力必须兼容存量工程；门禁必须确定性、毫秒级，不能依赖 LLM。

## Goals / Non-Goals

**Goals:**

- 用 Profile + Module Manifest 把「模块化」变成可校验的架构约束。
- 把文件大小预算与上下文可见性、输出预算对齐，消除截断和「后半段不可见」。
- 迭代只加载工作集，把每轮代码上下文压到 24KB 以内。
- 在 install 之前用确定性门禁拦截结构问题。
- 为超限文件提供自动拆分工作流。
- 记录可查询的 token/文件/失败指标。

**Non-Goals:**

- 不引入 Vite/Webpack/esbuild 等打包步骤。
- 不实现完整的工具调用 Agent 循环；只做有界的 `NEED` 追加读取（最多两轮）。
- 不做向量检索或跨仓库检索。
- 不改变运行时隔离级别、端口分配和 preview/publish 机制。
- 不自动重写用户手工修改的工程；只处理平台生成的快照。

## Decisions

### D1: Profile + Manifest 作为唯一结构真相

在 `src/lib/build/profiles.ts` 以 TypeScript 常量定义 Profile（`generic-webapp`、`crud-app`、`dashboard`、`landing-page`、`api-service`、`browser-game`），每个 Profile 提供模块骨架、职责、默认预算、生成顺序。未命中专用 Profile 时使用 `generic-webapp`；Profile 是开放集合，可新增而不改既有能力。小游戏只是其中一个专用 Profile，不构成产品边界。规划阶段输出 JSON manifest，落盘 `.atoms/manifest.json`，并作为后续生成、上下文组装、门禁与拆分的唯一结构来源。

Manifest 最小结构：

```json
{
  "schemaVersion": 1,
  "profile": "browser-game",
  "entry": "public/index.html",
  "budgets": { "fileSoftKB": 10, "fileHardKB": 16, "htmlKB": 4, "inlineKB": 2, "contextKB": 24 },
  "modules": [
    { "path": "public/src/core/engine.js", "role": "game-loop",
      "exports": ["createEngine(state)", "start()", "stop()"],
      "deps": ["../services/storage.js"], "maxKB": 10 }
  ]
}
```

校验放在新模块 `src/lib/build/manifest.ts`：路径、入口、依赖、重复、数量、预算。失败抛 `ProtocolError`，复用现有修复轮。

备选：继续用自由文本计划（无法机器校验）；只给固定脚手架（无法适配不同产品）。选择 manifest 是因为它同时服务上下文选择、门禁与拆分三个环节。

### D2: 文件大小预算

默认预算：代码 soft 10–12KB / hard 16KB；`index.html` ≤ 4KB；内联 JS/CSS ≤ 2KB；CSS ≤ 8KB；内联资源 ≤ 8KB。预算可由 manifest/环境变量覆盖。

依据：16KB 约 4–5k tokens，可完整放入 `max_tokens` 12,000；也低于迭代 prompt 的 20,000 字符单文件切片，保证全文可见。超过 16KB 的文件一分为二后仍能保持职责内聚。

备选：8KB（过度碎片化，调用数翻倍）；32KB（仍会截断且 SEARCH 命中率下降）；不设限（现状）。

### D3: 依赖拓扑生成 + 签名上下文

首次构建先生成 manifest 与空模块桩（含 exports 签名），再按依赖拓扑分层生成；同层模块使用 2–3 的有界并发。单文件调用只注入：该模块 role、依赖模块的 `exports` 签名、预算，不注入上游完整代码。

实现位置：

- `generator.ts` 把当前串行 `for` 改为按层调度的 worker pool。
- `prompts.ts` 的 `buildSingleFilePrompt` 改为接收 manifest entry 与依赖签名。
- 依赖环由 manifest 校验拒绝。

备选：继续串行（首轮慢）；单次输出全工程（截断）；注入上游全文（token 高、鼓励复制而非引用）。

### D4: Context Assembler 与 NEED 协议

新增 `src/lib/build/context.ts`，按分数选择 1–3 个目标文件：

```
score = 10*显式路径/文件名 +
        5*最近编辑 +
        3*role 与需求关键词匹配 +
        2*入口或入口直接依赖 +
        1*与已选文件有依赖关系
```

预算默认 24KB；目标文件 ≤ soft 时注入全文，> soft 时注入符号索引 + 相关行范围并建议拆分；直接依赖只注入 `exports` 签名；需求历史取最近 2–3 条或摘要；不注入 assistant 回复。符号索引与行范围必须放在代码块外，代码块只含真实文件行；SEARCH 禁止使用索引/行号。语法错误按 `[stdin]:line` 注入错误行附近的真实片段。

选择目标时使用「分数 + 角色优先级」：入口 HTML / bootstrap / input / UI 优先于 engine / renderer / styles / server；中文交互词（点击、没响应、按钮、布局）参与匹配，`server.js` 不再默认入选。入口 HTML 仅在 UI/布局类需求中参与选择；布局类反馈会强制保留一个样式文件槽位。

新增输出协议 `### NEED: <path>`：平台加载该文件后可再调用一次，最多两轮。EDIT 的 SEARCH 未命中时，重新读取目标文件相关行范围并重试一次，仍失败才进入修复轮。

备选：向量检索（文件规模仅 8–16 个，收益低、引入额外依赖）；全量注入（现状）；先让模型列文件再生成（多一轮调用）。选择打分 + NEED 是因为它无额外依赖、可解释、可测试。

### D5: 结构门禁作为独立确定性模块

新增 `src/lib/build/structure.ts`，在 `builder.ts` 的语法校验之前调用（`npm install` 之前）。检查：单文件大小、HTML 大小、内联代码/资源、import 目标存在、入口可达、孤立模块、循环依赖、manifest 漂移、ESM/MIME 一致性。

验收自检按消息意图过滤：缺陷报告与咨询类消息不进入需求覆盖自检，避免把「没响应/布局不合理/没有元素」当作要实现的功能；功能/构建类消息仍保留自检。意图分类覆盖症状措辞（看不到、没有、不显示、只剩、消失等）。review 调用同样记录 usage，便于区分模型成本。

模块删除护栏：DELETE 指向 manifest 模块且用户未明确要求删除时直接拒绝；写入后若 manifest 相比基线缺少模块，从上一版本快照恢复该文件并重新同步，防止模型用删除绕过语法/结构门禁。

语法门禁对含 `import`/`export` 的 `.js` 强制按 ESM 解析（`--input-type=module`），避免 CommonJS 模式漏检；含语言标记代码围栏的 FILE 内容直接判协议错误。成功摘要包含模型 preamble 与 files/edits/deletes 列表，便于用户确认实际变更。

返回结构化 `Violation[]`（`code`、`path`、`actual`、`limit`、`message`、`suggestion`），`BuildOutcome` 增加 `violations` 字段；修复 prompt 直接消费 violations，而不是错误尾部。门禁本身不调用 LLM。

备选：LLM 验收员检查结构（慢、贵、不稳定）；构建后再检查（已浪费 install 时间）；只靠提示词（模型会漂移）。

### D6: Split Agent 使用 TypeScript AST

新增 `src/lib/build/split.ts`。触发条件：结构门禁 `FILE_TOO_LARGE`、编辑后超 hard、同一文件连续 EDIT 失败。只有超过 hard（16KB）的文件才会真正拆分；soft–hard 之间的文件留在原文件修复。写入前在内存中构造虚拟文件图，校验缺失依赖与循环依赖，不安全则放弃拆分。新文件复制原文件的 import 语句，避免依赖丢失。

流程：

1. 用仓库已有的 `typescript`（devDependency）解析 `ScriptKind.JS`，获取顶层函数/类的名称与行范围。
2. 模型只输出拆分计划 JSON（新路径、symbol→file 映射、re-export 策略），不重写代码。
3. 平台按行范围确定性搬移符号，自动补 `export`/`import`；解析失败时才回退 LLM 生成新文件。
4. 原文件保留 re-export，保持公共 API；更新依赖方 import。拆分产物统一放入 `<source>-parts/` 子目录，避免与既有模块重名；未超过 soft 预算的小文件不拆分。
5. 重新执行结构门禁、语法校验与构建；最多两次尝试。

备选：LLM 重写整个文件（token 高、易语法错误）；正则切分（脆弱）；不拆分（现状）。选择 AST 是因为仓库已有 TypeScript 依赖，且拆分过程可复现、可测试。

### D7: 指标使用 JSONL + 可选 DB 表

每轮写 `storage/projects/<id>/build-stats.jsonl`，字段包括：round、stage、file、model、input/output/reasoning tokens、finishReason、ms、fileKB、contextFiles、editAttempts、continuations、splits、failureCategory。默认不落文件内容与提示词。后续可增加 Prisma 表用于聚合查询。

`llm.ts` 的请求增加 `stream_options: { include_usage: true }`，从最后一个 chunk 读取 usage；当前代码完全丢弃 usage。

备选：只写 DB（需要迁移，查询灵活）；外部监控系统（运维成本高）；不记录（现状，无法验证收益）。

### D8: 协议与兼容性

- `protocol.ts` 增加 `MAX_CODE_FILE_BYTES = 16KB`（资源/数据文件豁免），路径、数量校验保持。
- 新增 manifest 输出与 `NEED` 协议；修复 prompt 支持结构化 violations。
- 存量快照：首次迭代时从文件树生成启发式 manifest（role 由路径推断）；超过 hard 的文件在首次编辑时触发拆分。
- 新工程直接启用硬门禁；旧工程前 N 轮可配置为 advisory（仅告警），避免一次性全部阻塞。

## Risks / Trade-offs

- [文件变多导致调用数增加] → 有界并发 2–3、Profile 固定骨架、单文件输出更短；总 token 不显著增加，重试显著减少。
- [过度拆分伤可读性] → 典型站点 8–16 个模块上限；数据/资源文件豁免；预算可调。
- [拆分引入 import 错误] → AST 搬移 + 结构门禁 + 最多两次 + 构建兜底。
- [拆分制造重复模块] → 拆分产物放入 `<source>-parts/` 子目录；未超过 soft 的小文件不拆分。
- [Manifest 漂移] → 每次构建校验；可自动补条目；漂移作为结构化 violation。
- [旧工程项目超大，首次拆分成本高] → advisory 模式 + 编辑时拆分 + 明确日志。
- [ESM/静态服务不兼容] → 门禁检查 `type="module"` 与 MIME；生成服务端统一返回正确 Content-Type。
- [模型不遵守预算] → 不依赖提示词自觉，门禁硬拦截；修复 prompt 给出拆分指令。
- [并发生成导致接口不一致] → 先生成桩与签名，按拓扑层并发生成；同层模块只依赖下层稳定签名。
- [指标泄露内容] → 只记录元数据；禁止写入文件内容与提示词。
- [Prompt 缓存收益不确定] → 把 system + manifest 放在稳定前缀，但不依赖缓存作为正确性条件。

## Migration Plan

1. **P0（可独立上线）**：新增结构门禁与大小预算，只对新建工程硬失败；旧工程 advisory；`llm.ts` 打开 usage 并写 JSONL。可通过 `MODULAR_GENERATION=off` 回滚到旧行为。
2. **P1**：引入 manifest 与 Context Assembler，新建工程默认启用；迭代上下文切换为工作集 + `NEED`；修复轮同样使用工作集。
3. **P2**：上线 Split Agent 与通用/专用 Profile（`generic-webapp`、`browser-game` 等）；旧工程首次编辑超限文件时自动拆分。
4. **P3**：层内并发生成、指标聚合查询、成本看板。

回滚：环境变量关闭新路径即可回到 `selectKeyFiles` + 自由文本计划；manifest 保留但不读取，不影响构建。

验证：用 10 个覆盖多类型站点（落地页、CRUD、工作台、小游戏、API 服务等）的固定需求做 A/B，比较首轮耗时、每轮 tokens、EDIT 失败率、修复轮数、构建成功率；达标线为迭代上下文 ≤ 24KB、EDIT 失败率 < 5%、首轮 p50 ≤ 3 分钟。

## Open Questions

- 上下文预算是否需要按模型区分（思考型 vs 非思考型）？可先共用 24KB，后续按指标调整。
- 首次构建遇到超限文件时，是立即自动拆分还是先失败交给修复轮？可先由门禁触发拆分，观察两次尝试的成功率再定。
- 成本告警阈值属于运营配置，可在 P3 根据实际单价确定。