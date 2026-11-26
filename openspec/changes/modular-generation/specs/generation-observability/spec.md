# Spec Delta

## Purpose

为每次生成调用和每轮构建提供可查询的 token、文件、上下文与失败指标。没有这些数据，模块化预算与上下文优化只能靠猜测，无法验证收益。

## ADDED Requirements

### Requirement: 单次调用用量记录

系统 SHALL 记录每次 LLM 调用的模型、阶段、input tokens、output tokens、reasoning tokens、finish reason 与耗时。

#### Scenario: 记录单文件生成

- **WHEN** 一次单文件生成调用完成
- **THEN** 系统写入一条用量记录，包含模型、阶段、输入/输出/思考 token 与耗时

### Requirement: 每轮构建记录

系统 SHALL 记录每轮构建的上下文文件列表、上下文总字节、EDIT 次数、续写次数、拆分次数、修复轮数与最终结果。

#### Scenario: 记录一次迭代

- **WHEN** 一次迭代轮次结束
- **THEN** 系统记录该轮选择的上下文文件、总字节、EDIT/续写/拆分次数与成功或失败结果

### Requirement: 文件大小统计

系统 SHALL 记录每个生成或修改文件的大小，并标记其是否超过 soft 12KB 或 hard 16KB 限制。

#### Scenario: 标记超过软限制

- **WHEN** 生成文件为 14KB
- **THEN** 指标记录该文件超过 soft 限制但未超过 hard 限制

### Requirement: 指标查询与聚合

系统 SHALL 支持按项目与轮次查询指标，并提供 token、耗时与文件大小的 p50/p95 聚合。

#### Scenario: 查询聚合指标

- **WHEN** 查询某项目最近 20 轮的指标
- **THEN** 返回 token、耗时与文件大小的 p50 与 p95

### Requirement: 失败原因分类

系统 SHALL 将失败归类为协议、结构门禁、语法、构建、启动、验收或超时，并记录对应失败阶段。

#### Scenario: 记录结构门禁失败

- **WHEN** 构建因结构门禁失败
- **THEN** 指标记录失败类别为 `structure` 并包含触发错误的文件

### Requirement: 敏感信息保护

指标记录 MUST NOT 包含提示词全文、文件内容、用户凭证或 API key，只允许记录路径、大小、token 与错误码等元数据。

#### Scenario: 只记录元数据

- **WHEN** 系统写入用量与构建指标
- **THEN** 记录中不包含文件内容、完整提示词或 API key