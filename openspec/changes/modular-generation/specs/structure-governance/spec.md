# Spec Delta

## Purpose

用确定性结构门禁与自动拆分工作流，保证工程结构持续满足模块化预算。任何超出大小、内联或依赖约束的产物都必须在构建前被拦截或修复。

## ADDED Requirements

### Requirement: 结构门禁执行时机

系统 SHALL 在 `npm install` 之前执行结构门禁；门禁失败时 MUST 阻止后续安装、构建与启动验证。

#### Scenario: 超限文件在安装前失败

- **WHEN** 工程包含超过 hard 限制的代码文件
- **THEN** 结构门禁在 `npm install` 之前失败，不产生安装与构建日志

### Requirement: 大小与内联检查

结构门禁 SHALL 检查代码文件 hard 16KB、`index.html` 4KB、内联 JS/CSS 2KB，并在失败时返回结构化 violation，包含错误码、路径、实际值、限制值与修复建议。

#### Scenario: 报告文件过大

- **WHEN** `public/app.js` 为 24KB
- **THEN** 门禁返回 `FILE_TOO_LARGE`，包含路径、24KB、16KB 限制和建议拆分点

### Requirement: ESM 语法门禁与内容完整性

系统 SHALL 对包含 `import`/`export` 的 `.js` 文件按 ES Module 解析语法，不得回退到 CommonJS 解析；解析失败 MUST 在 `npm install` 前阻止构建并指出文件。FILE 块内容 MUST NOT 包含带语言标记的 Markdown 代码围栏，检测到 MUST 视为协议错误并进入修复。

#### Scenario: 续写污染的 ESM 文件被拦截

- **WHEN** `engine.js` 中混入 ` ```javascript ` 与断行代码，Node 以 CommonJS 解析会误判通过
- **THEN** 系统以 ESM 模式解析失败，阻止构建并报告该文件，而不是「语法校验通过」

#### Scenario: 文件内容混入代码围栏

- **WHEN** 模型输出的代码文件内容包含 ` ```javascript ` 等语言围栏
- **THEN** 系统以协议错误拒绝该计划并进入修复轮

#### Scenario: 合法 ESM 文件通过

- **WHEN** 文件包含合法的 `import`/`export`
- **THEN** 系统按模块语法解析通过，继续后续构建

### Requirement: 入口自启动时序

浏览器脚本在顶层监听 `DOMContentLoaded`/`load` 时 MUST 同时提供 `document.readyState` 兜底；否则 MUST 判为结构错误并给出修复模板（事件后执行的脚本将永远不初始化）。

#### Scenario: 只监听 DOMContentLoaded 被拦截

- **WHEN** `main.js` 顶层只有 `document.addEventListener('DOMContentLoaded', bootstrap)`
- **THEN** 结构门禁返回 `ENTRY_BOOTSTRAP_TIMING`，并建议 readyState 兜底写法

#### Scenario: readyState 兜底通过

- **WHEN** 脚本使用 `if (document.readyState === 'loading') ... else init()`
- **THEN** 门禁通过，入口在任何时序下都会初始化

### Requirement: FILE 与 DELETE 冲突拒绝

同一文件的 FILE 与 DELETE MUST NOT 同时出现在一个计划中；检测到 MUST 以协议错误拒绝（否则快照写入会先写后删，把刚生成的内容删掉）。

#### Scenario: 全量重写计划被拒绝

- **WHEN** 模型对 `input.js` 同时输出 FILE 块与 DELETE 块
- **THEN** 系统以协议错误拒绝，并提示重写只用 FILE

#### Scenario: 修复轮允许补建缺失模块

- **WHEN** 修复轮需要重建 MISSING_DEP 涉及的模块（如被误删的 `input.js`）
- **THEN** 系统允许新增文件并同步 manifest，不再一刀切禁止

### Requirement: import 图检查

结构门禁 SHALL 校验所有 `import`/`require` 目标存在、入口可达、无孤立模块且无循环依赖。

#### Scenario: 依赖不存在

- **WHEN** 某模块 import 了不存在的文件
- **THEN** 门禁返回 `MISSING_DEP`，指出引用文件与目标路径

### Requirement: Manifest 漂移检查

结构门禁 SHALL 校验 manifest 与磁盘文件一致；发现漂移时 MUST 自动更新 manifest 或返回 `MANIFEST_DRIFT` 修复错误。

#### Scenario: 磁盘新增文件

- **WHEN** 工程中出现 manifest 未声明的文件
- **THEN** 系统自动补充 manifest 条目，或返回可修复的漂移错误

### Requirement: 自动拆分工作流

当文件超过 hard 限制或同一文件连续 EDIT 失败时，系统 SHALL 启动 Split Agent：生成拆分计划、按符号搬移代码、保持公共 API，最多尝试两次。

#### Scenario: 拆分超大文件

- **WHEN** `public/app.js` 达到 18KB 且包含主循环、实体与 HUD 逻辑
- **THEN** Split Agent 拆分为独立模块，并由原文件 re-export 保持既有引用可用

### Requirement: 拆分后验证

拆分完成后系统 SHALL 重新执行结构门禁、语法校验与完整构建；任一步失败则进入修复轮而不是视为完成。

#### Scenario: 拆分引入依赖错误

- **WHEN** 拆分后的新模块 import 路径错误
- **THEN** 结构门禁返回 `MISSING_DEP` 并进入修复轮

### Requirement: ESM 与静态服务检查

结构门禁 SHALL 校验前端模块使用 `type="module"` 或等价加载方式，并校验生成的服务端以正确 MIME 返回 JS 与 CSS。

#### Scenario: 缺少模块加载方式

- **WHEN** `index.html` 引用 ES module 但没有声明 `type="module"`
- **THEN** 门禁返回 `MODULE_MODE`，要求修正加载方式

### Requirement: 验收自检意图过滤

系统 SHALL 仅对功能/构建类消息执行需求覆盖自检；缺陷报告与咨询类消息 MUST NOT 被当作功能需求。构建、启动与冒烟已通过时，不得因「点击没响应」「布局不合理」这类现象描述再判 FAIL。

#### Scenario: 缺陷报告不误判

- **WHEN** 用户报告「点击开始游戏没响应，页面布局也不合理」
- **THEN** 系统跳过需求覆盖自检，构建与冒烟通过即成功

#### Scenario: 功能需求仍执行自检

- **WHEN** 用户要求「加一个计分板」
- **THEN** 系统继续执行需求覆盖自检

### Requirement: 拆分安全边界

Split Agent MUST 只拆分超过 hard 预算（16KB）的文件；soft–hard 之间的文件 MUST 留在原文件修复，不得自动拆分。写入前 MUST 校验虚拟 import 图，发现缺失依赖或循环依赖时必须放弃拆分并交给修复轮。

#### Scenario: 13KB 文件不拆分

- **WHEN** `engine.js` 为 13.4KB 且连续 EDIT 失败
- **THEN** 系统不拆分该文件，继续在原文件上修复

#### Scenario: 不安全的拆分计划被放弃

- **WHEN** 拆分计划会产生 `engine-parts` 之间的循环依赖或缺失依赖
- **THEN** 系统在写入前检测到并放弃拆分，不破坏现有工程

### Requirement: 模块删除护栏

系统 MUST NOT 接受未被用户明确请求的模块删除：DELETE 指向 manifest 模块时必须拒绝并进入修复；若写入后发现模块相对基线被删除，必须从上一版本快照恢复该文件。用户消息包含明确删除措辞（删除/去掉/移除等）时才允许删除。

#### Scenario: 修复轮删除引擎被拒绝

- **WHEN** 修复轮输出 `### DELETE: public/src/core/engine.js` 而用户只要求修复缺陷
- **THEN** 系统拒绝该计划并要求在原文件内修复，不得删除模块绕过门禁

#### Scenario: 删除后自动恢复

- **WHEN** 某轮写入后 manifest 相比基线缺少模块且用户未请求删除
- **THEN** 系统从上一版本快照恢复被删文件并重新同步 manifest

#### Scenario: 用户明确要求删除

- **WHEN** 用户消息包含「删除/去掉/移除」等措辞
- **THEN** 系统允许对应 DELETE 生效

### Requirement: 验收熔断

当构建、启动与冒烟全部通过而需求自检连续 3 次不通过时，系统 MUST 接受该版本并在摘要中附「验收提醒」（含 review 反馈），不得继续消耗修复轮次导致全部丢弃。review 反馈 MUST 包含代码级定位（文件名 + 函数/变量名 + 具体错配），不允许只给「不完整」。

#### Scenario: 死循环熔断

- **WHEN** 5 次尝试中构建/启动/冒烟均通过，review 前 3 次均 FAIL 且反馈不可收敛
- **THEN** 第 3 次 review FAIL 后系统接受版本，摘要附带验收提醒与 review 具体反馈

#### Scenario: review 反馈必须可操作

- **WHEN** review 判 FAIL
- **THEN** 反馈列出具体文件与函数/变量的错配（如 `main.js: render() 缺少 ctx`），而非「逻辑不完整」

### Requirement: 导出解析门禁

系统 MUST 在构建前校验每个 import 的命名绑定在目标模块的实际导出中存在；不存在 MUST 判 `EXPORT_MISSING` 并列出实际导出清单。这是模块链接级别的确定性检查（名称不存在时浏览器拒绝加载整个模块图）。

#### Scenario: import 名称与导出不匹配被拦截

- **WHEN** `main.js` 从 `renderer.js` 导入 `{ setupRenderer }` 但 renderer.js 只导出 `render`
- **THEN** 构建在 install 前失败，错误信息包含实际导出清单（`render`），修复指令明确

#### Scenario: 导出全部匹配通过

- **WHEN** 所有 import 的命名绑定都能在目标模块找到
- **THEN** 门禁通过，继续后续构建

### Requirement: 资源内联限制

结构门禁 SHALL 拒绝超过 8KB 的 base64/data URI 内联资源，并要求将其放入静态资源目录或独立文件。

#### Scenario: 大体积内联图片

- **WHEN** 某 HTML 或 JS 中内联了超过 8KB 的 data URI
- **THEN** 门禁返回 `INLINE_ASSET`，要求外部化该资源