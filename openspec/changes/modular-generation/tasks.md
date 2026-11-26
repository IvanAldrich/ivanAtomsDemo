# Tasks

## 1. 结构模型与 Profile 基础

- [x] 1.1 在 `src/lib/build/manifest.ts` 定义 `ModuleManifest`/`ModuleEntry` 类型与预算类型，在 `src/lib/build/profiles.ts` 定义 `generic-webapp`、`crud-app`、`dashboard`、`landing-page`、`api-service`、`browser-game` 六个 Profile 常量（可扩展，未命中时回退 `generic-webapp`）；用 `npx tsc --noEmit` 验证类型通过。
- [x] 1.2 实现 `validateManifest()`：校验路径合法、入口存在、依赖存在、无重复、模块数在 4–24、每个模块有 role 与 maxKB；用 `node --test` 覆盖合法样例和缺少入口/依赖/重复路径的非法样例。
- [x] 1.3 增加预算配置解析（manifest `budgets` 优先，其次 `MODULAR_FILE_SOFT_KB`/`MODULAR_FILE_HARD_KB` 等环境变量），并用单元测试验证覆盖优先级。

## 2. 提示词与协议

- [x] 2.1 更新 `src/lib/build/prompts.ts` 的 `RUNTIME_CONTRACT`：加入代码文件 soft 12KB/hard 16KB、`index.html` ≤4KB、内联 JS/CSS ≤2KB、禁止大段内联、ESM 相对路径规则；用快照测试验证生成的 system prompt 包含这些约束。
- [x] 2.2 计划阶段改为输出 manifest JSON：更新 `buildPlanPrompt()` 与解析逻辑，规划结果写入 `.atoms/manifest.json`；用单元测试覆盖合法 JSON、非法 JSON 和缺字段三种情况。
- [x] 2.3 改写 `buildSingleFilePrompt()`：只接收 manifest entry、依赖模块的 `exports` 签名和该文件预算，不再拼接上游文件完整内容；用单元测试验证 prompt 不包含依赖的函数体。
- [x] 2.4 让修复 prompt 消费结构化 `Violation[]`：`FILE_TOO_LARGE` 渲染为拆分指令，`MISSING_DEP` 指出文件与目标；用单元测试验证每种 violation 的修复文本。
- [x] 2.5 在输出协议中增加 `### NEED: <path>` 解析与路径白名单校验；用单元测试验证合法路径被接受、`../` 越界路径被拒绝、最多两轮后停止。

## 3. 首次构建流水线

- [x] 3.1 首次构建先生成 manifest 与空模块桩（含 exports 签名），再填充内容；验证快照包含 `.atoms/manifest.json`、入口文件和全部桩文件。
- [x] 3.2 实现按依赖拓扑分层生成，同层并发上限 2–3（可配置）；用单元测试验证层顺序和最大并发数。
- [x] 3.3 生成完成后校验 manifest 与实际文件一致；增加测试验证新增/缺失文件会产生 `MANIFEST_DRIFT`。
- [x] 3.4 生成阶段检查单文件预算，超过 hard 限制立即触发拆分或失败；用单元测试验证 15KB 通过、17KB 触发。

## 4. 结构门禁

- [x] 4.1 新增 `src/lib/build/structure.ts`，实现大小与内联检查（代码 16KB、HTML 4KB、内联 2KB、内联资源 8KB）；用 `node --test` 覆盖每个 violation code。
- [x] 4.2 实现 import 图检查：目标存在、入口可达、孤立模块、循环依赖；用单元测试覆盖缺失依赖与环。
- [x] 4.3 实现 manifest 漂移与 ESM/MIME 检查；用单元测试覆盖未声明文件、缺少 `type="module"` 和 MIME 不一致。
- [x] 4.4 在 `src/lib/build/builder.ts` 的语法校验之前接入结构门禁；用集成测试验证超限项目在 `npm install` 前失败，且 `BuildOutcome.violations` 非空。
- [x] 4.5 修复轮接入 violations：验证修复 prompt 包含错误码、路径、限制值和建议，而不是原始日志尾部。

## 5. Split Agent

- [x] 5.1 使用仓库已有的 `typescript` 解析 `ScriptKind.JS`，提取顶层函数/类的名称与行范围；用单元测试覆盖函数、类、export 声明。
- [x] 5.2 实现拆分计划 JSON 的生成提示与校验（新路径、symbol→file 映射、re-export 策略）；用单元测试验证非法计划被拒绝。
- [x] 5.3 实现按行范围确定性搬移、自动补 `export`/`import`、原文件 re-export 保持公共 API；用单元测试验证导入符号仍可用，并运行一次快照构建验证。
- [x] 5.4 实现拆分触发条件（门禁 `FILE_TOO_LARGE`、编辑后超 hard、同一文件连续 EDIT 失败）与最多两次重试；用单元测试验证触发和上限。
- [x] 5.5 拆分后重新执行结构门禁、语法校验与构建；用集成测试验证拆分引入的错误会进入修复轮而非直接成功。

## 6. 迭代上下文

- [x] 6.1 新增 `src/lib/build/context.ts`，实现文件打分（显式路径、最近编辑、role 关键词、入口/依赖）与 24KB 预算裁剪；用单元测试覆盖目标文件选择与超预算裁剪。
- [x] 6.2 实现依赖签名注入：只使用 manifest 的 `exports`；用单元测试验证上下文不含依赖完整实现。
- [x] 6.3 迭代流程接入 Context Assembler，替换 `selectKeyFiles`；用测试验证生成的 prompt 字节数不超过配置预算。
- [x] 6.4 实现 `NEED` 两轮追加读取；用测试验证合法追加、超过两轮停止、越界路径拒绝。
- [x] 6.5 实现 EDIT 失败后的相关行范围重读与一次重试；用测试验证只重读目标文件且失败后进入修复轮。
- [x] 6.6 需求历史裁剪为最近 2–3 条或摘要，且不注入 assistant 回复；用测试验证长对话 prompt 的组成。

## 7. 可观测性

- [x] 7.1 在 `src/lib/llm.ts` 的请求中加入 `stream_options: { include_usage: true }`，返回 usage；用一次真实小样本调用验证 usage 非空。
- [x] 7.2 将每次调用的 stage、model、input/output/reasoning tokens、finishReason、耗时写入 `storage/projects/<id>/build-stats.jsonl`；用测试验证字段完整且不含文件内容或 API key。
- [x] 7.3 记录每轮构建指标：上下文文件、总字节、EDIT/续写/拆分/修复次数、失败类别；用测试验证一轮构建产生一条记录。
- [x] 7.4 提供按项目/轮次查询与 p50/p95 聚合的脚本或 API；用样例数据验证聚合结果。
- [x] 7.5 记录每个文件大小并标记 soft/hard 超限；用边界值 12KB、16KB 测试验证标记正确。

## 8. 迁移与开关

- [x] 8.1 为无 manifest 的旧快照从文件树生成启发式 manifest（role 按路径推断）；用测试验证旧项目可读取并进入生成/迭代。
- [x] 8.2 新建工程默认启用硬门禁，旧工程进入 advisory 模式（只告警不阻塞）；用测试验证两种模式的行为差异。
- [x] 8.3 增加 `MODULAR_GENERATION=off` 回滚开关，回退到旧的 `selectKeyFiles` 与自由文本计划；用测试验证回滚路径不读取 manifest。
- [x] 8.4 更新 `README.md`/开发说明，写明 manifest 位置、预算、开关和指标文件；按文档命令实际执行一次验证。

## 9. 集成验证

- [ ] 9.1 用 10 个覆盖多类型站点（落地页、CRUD、工作台、小游戏、API 服务等）的固定需求跑 A/B，按类型记录首轮耗时、每轮 tokens、EDIT 失败率、修复轮数；验证迭代上下文 ≤24KB、EDIT 失败率 <5%、首轮 p50 ≤3 分钟。
- [x] 9.2 运行 `npm run lint` 与 `npm run build`（平台自身），验证通过。
- [ ] 9.3 通过浏览器实际创建并迭代至少两种类型的站点（如落地页 + 交互应用），确认无文件截断、无结构超限、预览与发布正常，并记录指标。

## 10. 验收回归修复（真实增量轮暴露）

- [x] 10.1 修正 bug 报告的目标选择：入口 HTML / bootstrap / input / UI 优先，`server.js` 不再默认入选；用 context 单测验证。
- [x] 10.2 路径只允许 ASCII 安全字符；禁止模型写/改/删 `.atoms/manifest.json`；用 protocol 单测验证。
- [x] 10.3 写入快照后自动同步 manifest；修复轮禁止新增模块；用 manifest 单测验证。
- [x] 10.4 续写不再要求输出新的 FILE 头，续写上下文使用完整已输出内容；用类型检查与构建验证。
- [x] 10.5 未超过 soft 的小文件不拆分；拆分产物放入 `<source>-parts/` 避免重名；用 split 单测验证。

## 11. 验收门禁回归修复

- [x] 11.1 增加消息意图分类（build / bug-report / question）；用 intent 单测验证缺陷报告与功能需求。
- [x] 11.2 缺陷报告与咨询类消息跳过需求覆盖自检；构建/启动/冒烟通过即成功。
- [x] 11.3 review 调用记录 usage；补 reviewer prompt 的缺陷报告说明。

## 12. 验收回归修复（语法门禁误判）

- [x] 12.1 含 `import`/`export` 的 `.js` 按 ESM 解析语法；用 builder 回归测试验证污染文件在 install 前失败。
- [x] 12.2 FILE 内容含带语言标记的 Markdown 代码围栏时拒绝；用 protocol 单测验证。
- [x] 12.3 布局类反馈强制包含样式模块；用 context 单测验证。
- [x] 12.4 成功摘要包含变更说明与 files/edits/deletes 列表。

## 13. 验收回归修复（索引与拆分安全）

- [x] 13.1 代码块只放真实文件行，符号索引/行范围移到代码块外；提示禁止用索引做 SEARCH；用 context/prompts 单测验证。
- [x] 13.2 语法错误按 `[stdin]:line` 注入错误行附近的真实片段。
- [x] 13.3 Split Agent 只拆 >hard 文件；写入前虚拟图校验缺失依赖/循环依赖，失败则跳过；用 split 单测验证 13KB 文件不拆。
- [x] 13.4 拆分产物复制原文件 import 语句，避免依赖丢失。

## 14. 验收回归修复（删除绕过与症状意图）

- [x] 14.1 DELETE 指向 manifest 模块且用户未要求删除时拒绝；用 guardDeletes 与提示词规则约束。
- [x] 14.2 写入后对比基线 manifest，发现模块被删则从上一版本快照恢复并重新同步。
- [x] 14.3 意图分类覆盖「看不到/没有/不显示/只剩」等症状措辞；用 intent 单测验证。
- [x] 14.4 提示词明确「修复错误禁止删除模块绕过门禁」。

## 15. 验收回归修复（入口自启动时序）

- [x] 15.1 新增 `ENTRY_BOOTSTRAP_TIMING` 门禁：顶层监听 DOMContentLoaded/load 且无 readyState 兜底判错；用 structure 单测验证。
- [x] 15.2 运行契约写明入口自启动必须处理两种时序并给出模板。
- [x] 15.3 验收提示补充「实现可内联在入口文件，不要求独立模块」。

## 16. 验收回归修复（FILE+DELETE 冲突与修复轮死锁）

- [x] 16.1 协议层拒绝同一文件同时出现 FILE 与 DELETE；用 protocol 单测验证（防止快照先写后删）。
- [x] 16.2 移除「修复轮禁止新增模块」的一刀切限制，允许补建 MISSING_DEP/恢复被删文件。
- [x] 16.3 修复提示词改为：可新增模块但需与结构一致；删除仍需用户明确要求；FILE/DELETE 不得同文件。

## 17. 验收回归修复（review 死循环与误报）

- [x] 17.1 review 熔断：构建/启动/冒烟通过且 review 连续 3 次 FAIL 时接受版本并在摘要附验收提醒。
- [x] 17.2 review 反馈强制代码级定位（文件+函数+具体错配），禁止只说「不完整」。
- [x] 17.3 修复 UNREACHABLE_MODULE 误报：HTML 中 `src="src/main.js"`（无 ./ 前缀）也能作为可达性根；用 structure 单测验证。

## 18. 验收回归修复（导出解析）

- [x] 18.1 新增 `EXPORT_MISSING` 门禁：import 的命名绑定不在目标模块导出中时判错，错误含实际导出清单；用 structure 单测验证（含正反两例）。
- [x] 18.2 在「星际争霸2」v1 上验证：检出 `setupRenderer`（实际导出 `render`）与 `setupHUD`（实际导出 `renderHud`）两处链接失败。

## Workflow follow-up

- 在项目评审要求满足后归档该 change。
- 归档后验证主 specs 中的 capability 与 Purpose 正确写入。