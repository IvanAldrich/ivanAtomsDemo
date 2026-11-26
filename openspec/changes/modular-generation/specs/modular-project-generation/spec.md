# Spec Delta

## Purpose

让平台生成可维护、可增量修改的模块化工程。通过架构 Profile、Module Manifest 与文件大小预算，约束首次生成的结构，避免把完整产品塞进单个大文件。

## ADDED Requirements

### Requirement: 架构 Profile 选择

系统 SHALL 在规划前根据需求内容选择架构 Profile（如 `generic-webapp`、`crud-app`、`dashboard`、`landing-page`、`api-service`、`browser-game`），并应用该 Profile 的模块骨架、预算与生成顺序。未命中专用 Profile 时 MUST 使用通用站点 Profile，不得把产品限定为某一种网站类型。

#### Scenario: 任意网站需求使用通用 Profile

- **WHEN** 用户需求描述一个未命中专用 Profile 的网站或 Web 应用
- **THEN** 系统选择 `generic-webapp` Profile，并在规划中使用其模块骨架、预算与生成顺序

#### Scenario: 小游戏需求使用专用 Profile

- **WHEN** 用户需求描述一个浏览器小游戏
- **THEN** 系统在通用能力之上选择 `browser-game` Profile，并使用游戏模块骨架

### Requirement: Module Manifest 生成

规划阶段系统 SHALL 输出结构化 Module Manifest，至少包含每个模块的 `path`、`role`、`exports`、`deps` 与 `maxKB`，并落盘到工程根目录的 `.atoms/manifest.json`。

#### Scenario: 规划产出 manifest

- **WHEN** 规划阶段成功完成
- **THEN** 工程快照包含 `.atoms/manifest.json`，其中声明入口、模块清单、依赖与预算

### Requirement: Manifest 校验

系统 SHALL 在写入快照前校验 manifest：路径合法、入口存在、依赖声明存在、模块数量与预算在允许范围内、无重复路径。

#### Scenario: 缺少入口的 manifest 被拒绝

- **WHEN** 规划结果缺少入口模块或声明了不存在的依赖
- **THEN** 系统拒绝写入并返回可修复的协议错误，不进入构建阶段

### Requirement: 文件大小预算

生成契约 SHALL 约束代码文件 soft 12KB / hard 16KB、`index.html` ≤ 4KB、内联 JS/CSS ≤ 2KB；超过 hard 限制的产物 MUST 拆分，不得直接通过。

#### Scenario: 超限文件触发拆分

- **WHEN** 单文件生成结果超过 16KB 或 `index.html` 超过 4KB
- **THEN** 系统不将其视为完成，并要求按职责拆分或抽取外部文件

### Requirement: 依赖拓扑生成

首次构建系统 SHALL 按依赖拓扑顺序生成模块，单文件生成调用只注入其依赖模块的 `exports` 签名与职责说明，不注入上游模块的完整实现。

#### Scenario: 只注入依赖签名

- **WHEN** 生成 `engine.js`，其依赖 `storage.js`
- **THEN** 该次调用的上下文只包含 `storage.js` 的导出签名与职责，不包含 `storage.js` 的完整代码

### Requirement: Profile 模板库

系统 SHALL 提供可扩展的 Profile 模板库，至少覆盖通用网站、CRUD、工作台、落地页、API 服务与浏览器小游戏；每个 Profile MUST 声明模块路径、职责、依赖与大小目标，并允许新增 Profile 而不改动既有能力。

#### Scenario: 通用站点使用模板

- **WHEN** 需求被识别为通用网站或 Web 应用
- **THEN** manifest 使用 `generic-webapp` 模板的模块划分，而不是把全部逻辑放入单个 `app.js`

#### Scenario: 专用站点使用专用模板

- **WHEN** 需求被识别为浏览器小游戏、工作台或落地页
- **THEN** manifest 使用对应专用 Profile 的模块划分，同时保留通用生成与门禁能力

### Requirement: 生成路径安全

系统 SHALL 只接受 ASCII 安全字符、相对且无路径穿越的文件路径；含中文说明、空格或括号的伪路径 MUST 被拒绝。模型 MUST NOT 直接写入、编辑或删除 `.atoms/manifest.json`，该文件由平台维护。

#### Scenario: 拒绝带说明文字的伪路径

- **WHEN** 模型输出 `### FILE: public/src/main.js（续接断点，从 import 之后开始）`
- **THEN** 系统以非法路径拒绝该计划，不落盘任何文件

#### Scenario: 拒绝模型改 manifest

- **WHEN** 模型的 FILE/EDIT/DELETE 指向 `.atoms/manifest.json`
- **THEN** 系统拒绝该操作，并保留平台生成的 manifest

### Requirement: Manifest 增量同步

当模块新增、删除或拆分时，系统 SHALL 更新 manifest，保持 manifest 与磁盘文件一致，并在后续生成与迭代中继续以其为上下文地图。

#### Scenario: 拆分后 manifest 更新

- **WHEN** Split Agent 把一个文件拆成多个模块
- **THEN** manifest 增加新模块条目、更新原模块的职责与依赖，并移除失效路径