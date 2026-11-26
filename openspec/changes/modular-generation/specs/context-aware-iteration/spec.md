# Spec Delta

## Purpose

让迭代只加载与当前需求相关的最小代码集。通过 manifest 地图、目标文件选择和按需读取，降低每轮 token 与 EDIT 失败率，避免全量注入工程。

## ADDED Requirements

### Requirement: 目标文件选择

系统 SHALL 为每次迭代根据 manifest 的模块职责、用户消息中出现的路径或关键词、最近编辑记录与依赖关系选择 1–3 个目标文件，而不是选择全部关键文件。

#### Scenario: 按需求选择 UI 文件

- **WHEN** 用户要求修改页面中的分数、统计或某个界面模块（例如游戏 HUD）
- **THEN** 系统选择负责该 UI 的文件作为目标文件，而不是整个工程

#### Scenario: Bug 报告选择交互文件

- **WHEN** 用户反馈「点击开始没响应，页面布局不合理」
- **THEN** 系统优先选择入口 HTML、bootstrap 与输入/UI 模块，而不是无关的 server.js

#### Scenario: 布局类反馈必须包含样式文件

- **WHEN** 用户反馈「页面布局不合理 / 文字都挤在一起」
- **THEN** 目标文件中至少包含一个样式模块，避免模型看不到 CSS 却去修改无关 JS

#### Scenario: 功能缺失描述按缺陷处理

- **WHEN** 用户反馈「页面上只能看到背景图，没有战舰、陨石等元素」
- **THEN** 系统将其识别为缺陷报告，跳过功能覆盖自检而不是要求实现负面描述

### Requirement: 上下文预算

每轮迭代发送的代码上下文 SHALL 不超过配置预算（默认 24KB）；超出时系统 MUST 按文件优先级裁剪，或对目标文件只注入相关行范围。

#### Scenario: 目标文件超过预算

- **WHEN** 目标文件大于单文件上下文软限制且未拆分
- **THEN** 系统只注入符号索引与相关行范围，并提示可触发拆分

### Requirement: 依赖签名注入

对目标文件的直接依赖，系统 SHALL 只注入 manifest 中声明的 `exports` 签名与职责说明，不注入依赖模块的完整实现。

#### Scenario: 注入依赖签名而非实现

- **WHEN** 目标 `hud.js` 依赖 `engine.js`
- **THEN** 上下文包含 `engine.js` 的导出签名，不包含其完整函数体

### Requirement: NEED 按需读取

当模型需要上下文中未提供的文件时，系统 SHALL 支持 `### NEED: <path>` 协议，加载该文件并重新调用模型，最多追加两轮。

#### Scenario: 模型请求额外文件

- **WHEN** 模型输出 `### NEED: src/services/storage.js`
- **THEN** 系统读取该文件、加入上下文并重新调用一次，超过两轮后不再追加

### Requirement: EDIT 失败重读

当 SEARCH/REPLACE 未匹配时，系统 SHALL 重新读取目标文件的相关行范围并允许一次重试，而不是回退到全量注入所有文件。

#### Scenario: 首次编辑未匹配

- **WHEN** EDIT 的 SEARCH 片段在目标文件中找不到
- **THEN** 系统重读目标文件对应区域后重试一次，仍失败才进入修复轮

### Requirement: 片段索引与 SEARCH 安全

系统 SHALL 将符号索引与行范围放在代码块之外，代码块只包含真实文件行；提示 MUST 要求 SEARCH 逐字符匹配代码块中的真实行，禁止使用索引、行号或说明文字。语法错误修复 MUST 注入错误行附近的真实片段。

#### Scenario: 语法错误按行定位

- **WHEN** 构建报告 `[stdin]:104` 语法错误
- **THEN** 上下文包含第 104 行附近的真实代码，符号索引位于代码块外

#### Scenario: 禁止用索引做 SEARCH

- **WHEN** 模型尝试用「符号索引」或行号注释作为 SEARCH
- **THEN** 提示明确禁止该行为，EDIT 失败时进入修复轮而不是盲目拆分

### Requirement: 历史裁剪

迭代上下文中的需求历史 SHALL 只保留最近 2–3 条需求或其摘要，并且 MUST NOT 注入 assistant 的历史回复。

#### Scenario: 长对话只带最近需求

- **WHEN** 项目已有超过 10 轮用户消息
- **THEN** 上下文只包含最近 2–3 条需求或摘要，不包含历史 assistant 回复

### Requirement: 聊天式消息不触发构建

纯询问或讨论类消息 SHALL 直接生成文字回复，不进入文件选择、结构门禁或构建流程。

#### Scenario: 询问进度直接回复

- **WHEN** 用户消息是「现在完成了吗」这类询问
- **THEN** 系统直接返回文字回答，不产生文件编辑或构建