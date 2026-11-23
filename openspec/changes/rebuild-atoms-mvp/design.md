# Design

## Context

仓库 `/home/admin/ivan/atoms` 目前只含逆向文档与 OpenSpec 规格（greenfield）。已对齐目标：**C 路线**——完整落地 atoms 核心闭环（自由生成全栈代码工程 → 沙箱构建 + 自修复 → 每项目独立运行时一键上线 → 迭代重建），认证等周边 demo 级简化。生成策略为**自由生成 + 自修复循环**。运行环境约束：本机（Wuying Linux 桌面）**无 Docker、无 caddy/nginx**，用户有 sudo；因此隔离与代理必须内置并支持降级。部署目标未定（见 Open Questions）。

## Goals / Non-Goals

**Goals:**
- 核心闭环一条龙：需求消息 → 自由生成多文件全栈工程 → 沙箱构建（失败自修复）→ 独立运行时 → 公开 URL 上线 → 迭代重建替换上线
- 单机可跑：内置反向代理与运行时管理，不强依赖外部基础设施；Docker 可用时自动升级为容器隔离
- 认证、内容、邮件全部最简可替换实现
- 满足 specs 的多语言/流式/隔离/回滚要求

**Non-Goals:**
- 生产级多租户隔离与高可用（自定义域名、横向扩展、审计合规）——界面与 README MUST 明示 demo 边界
- 多智能体编排、竞速模式、可视化编辑器、积分计费、Stripe 类集成、生产级认证
- 生成工程的通用运行时支持（仅支持 Node/npm 生态；其他生态如 Python/Go 延后）

## Decisions

### D1：单体 Next.js 应用，路由组分域 + 内置代理
- `app/[locale]/(marketing)/…` 营销面；`app/[locale]/(app)/…` 工作区（私有路由组，layout 挂守卫）
- 公开产物 URL 走宿主应用内置反代：`/p/{slug}/*` → 项目运行时端口（http-proxy 中间件，header/ websocket 透传）；子域名方案（`{slug}.域名`）留作部署配置项
- 备选：独立 Caddy/Traefik + 泛域名——本机无组件且增加运维，demo 不引入；后续部署真实域名时启用

### D2：i18n 用 next-intl
- 同前：middleware locale 协商、`messages/{zh,en}.json`、hreflang/metadata

### D3：内容目录 = 类型化数据文件 + 静态生成
- 同前：`content/` 六类 Zod 条目（draft/published、双语），种子每类 2–6 条，`generateStaticParams`，草稿不入路由与 sitemap

### D4：UI = Tailwind CSS + shadcn/ui
- 对话流、构建日志视图、App Viewer 视口切换、预览弹窗均用 shadcn 组件族

### D5：认证 = 自建 demo 会话（邮箱即登录）
- 同前：`POST /api/auth/login` 邮箱即登录/建号；签名 HttpOnly cookie（`SESSION_SECRET`，jose）；redirect 仅站内路径；界面明示演示登录
- 风险接受：无第二因子，仅限演示环境

### D6：数据与存储分层
- 宿主业务库：Prisma + SQLite（`users`、`projects`、`messages`、`app_versions`——版本指向工程快照目录、含构建状态与关联消息）
- 项目工程区：`storage/projects/{projectId}/`：`snapshots/v{n}/`（工程源码快照）、`build/v{n}/`（可运行产物）、`runtime/v{n}/data/`（项目自有 SQLite 等运行数据）、`run.json`（端口/状态）
- 删除项目 = 停止运行时 + 移除整个 `storage/projects/{id}` + 级联删库表（满足 build-pipeline 删除级联）

### D7：自由生成的输出协议
- LLM 提示注入运行契约：Node 20 + npm、启动命令约定（`npm start`，监听 `PORT` 环境变量）、数据写入工程内 `DATA_DIR`、禁止访问宿主服务与 `.env`、产物不依赖 GUI 环境
- 输出协议：先输出工程计划（文件树 JSON），再逐文件输出（路径 + 完整内容，Markdown 代码围栏或 JSON 消息流）；服务端按协议落盘快照并校验（package.json 存在、路径在工程根内、无路径穿越）
- 迭代请求上下文：需求历史（摘要）+ 当前工程文件树 + 指定文件的当前内容（按需注入，控制 token）；修改同样走文件协议（新增/修改/删除标记）
- 备选：固定脚手架 + agent 填充——用户已明确选择自由生成；脚手架知识仅注入提示词作为参考惯例（提升质量不约束结构）

### D8：构建管线（沙箱 + 自修复 + 限额）
- 流程：快照 → 隔离环境 `npm install` → `npm run build`（若无 build 脚本则跳过）→ 启动验证（`npm start` + 端口就绪探测，带启动超时）→ 判定成功
- **隔离两级**：`RUNTIME_ISOLATION=container|process`。容器级（Docker 存在时）：每构建/每运行一个容器（node:20-slim，网络仅放行 npm registry 与公网出站，挂载工程目录，内存/CPU/pids 限额）。**进程级降级（本机默认）**：受限子进程——独立工作目录、受限环境变量、ulimit（内存/CPU 时长）、并发 1、构建超时（如 10 分钟）；界面与日志明示「降级隔离（非生产级）」
- **自修复循环**：失败（构建或启动验证）→ 提取错误尾部（截断如 4KB）+ 相关文件路径 → 回传 LLM 产出修复（走 D7 文件协议）→ 重建；轮次上限 5；超限明确失败、保留当前版本
- 构建日志实时回传对话（SSE，见 D9）；安装与构建全量可观测
- 备选：仅一次性生成不做自修复——自由生成策略下成功率不可接受，必须有循环

### D9：构建通道 = Route Handler SSE + 全局队列
- `POST /api/projects/[id]/chat`：消息落库 → 入队 → SSE 流式回传（阶段事件：生成中/文件写入/安装中/构建中/启动验证/修复第 N 轮/成功/失败 + 日志块）
- 全局构建队列（并发 1，进程内锁 + DB 状态字段兜底），项目内消息排队语义由队列自然满足
- 断线重连：客户端按消息/轮次拉取历史回放，SSE 仅承载实时增量

### D10：运行时管理与发布替换
- 运行态：已发布项目运行其当前版本（`npm start`，分配空闲端口，stdout/stderr 落日志文件，崩溃不自动拉起并标记状态）
- 发布 = 注册 slug（nanoid）+ 反代路由 + 启动；取消发布 = 停进程 + 移除路由（404）
- 迭代再发布 = 新版本启动验证通过后原子切换端口映射（旧进程保留至切换完成再停止）；验证失败回滚在线旧版本（满足 app-delivery 回滚场景）
- 进程监督：宿主持有子进程句柄，宿主重启后按 `run.json` 恢复已发布项目（demo 级 best effort）

### D11：App Viewer 与安全
- App Viewer iframe 指向 `/p/{slug}`（与公开 URL 同源同路径，属主校验的预览变体走 `/preview/{projectId}` 内部代理）；`sandbox="allow-scripts allow-forms allow-popups"`（不含 allow-same-origin，产品页与宿主隔离）+ CSP
- 产物网络策略（容器级）：默认放行公网出站、封禁宿主内网端口；进程级：契约提示 + 端口分配隔离 + 明示降级

### D12：演示项目
- 首页「能构建什么」6 个品类演示 = 用本管线预生成并构建好的工程，随平台一起交付（`storage/demos/`），公开 URL 同构；「克隆」= 登录后以品类需求建项目

## Risks / Trade-offs

- [自由生成成功率低/循环超限] → 自修复 5 轮 + 提示注入工程惯例 + 失败保护保留旧版本；接受 demo 阶段部分需求失败
- [进程级隔离非真隔离（共享内核/网络）] → 界面与 README 明示；Docker 可用时升级容器级；封禁已知宿主端口写入提示
- [资源耗尽（构建/运行占满单机）] → 并发 1 + ulimit + 超时杀进程 + 磁盘配额检查；重编译类任务可借 wybuild 隔离
- [LLM token 成本高（多文件多轮）] → 文件树+按需注入内容；日志截断；轮次上限
- [宿主重启丢运行态] → `run.json` best-effort 恢复，明示限制
- [SQLite 单写者与队列锁竞争] → 构建串行化规避；部署时换 Postgres 连接串即可
- [长构建阻塞其他用户] → 队列可见（对话中显示排队状态），demo 接受

## Migration Plan

1. 本地 `npm run dev` 验证核心闭环（登录→需求→自由生成→构建（含一次自修复演示）→发布→匿名使用→迭代→重建替换→取消发布）
2. 部署到用户选定平台（配置 `SESSION_SECRET`、`LLM_*`、`RUNTIME_ISOLATION`、磁盘与端口范围）；有 Docker 时切换容器级隔离
3. 回滚 = 仓库回退 + 删除 `storage/`（无外部数据迁移）

## Open Questions

- 生产部署目标（自有服务器 / Vercel 不可行此类长驻进程 / Qoder Sites 同样受限）——**核心闭环需要长驻宿主进程，Vercel 类 Serverless 不适用**，需独立主机或容器平台；影响 D1 子域名与 D8 隔离级别的最终配置，不影响本设计
- LLM 网关选型（厂商直连 / OpenRouter / 自建）：env 隔离
- 是否为生成工程预置数据库迁移约定（Prisma vs 裸 SQLite 文件）：提示词层约定，可在实现期微调
