# Design

## Context

仓库 `/home/admin/ivan/atoms` 目前只含逆向文档（`docs/`）与 OpenSpec 规格，无任何应用代码（greenfield）。已确认核心期望：demo 产品 MUST 落地「用户通过对话自定义实现自己的产品」的完整闭环（生成→预览→发布），认证等周边允许 demo 级简化。技术栈 Next.js App Router + React。部署目标未定（见 Open Questions）。

## Goals / Non-Goals

**Goals:**
- 核心闭环一条龙：需求消息 → 生成自包含单页应用（版本化）→ App Viewer 沙箱预览 → 发布公开 URL → 迭代再发布
- 营销站与工作区同仓同应用，路由组隔离
- 认证、邮件、内容数据全部走最简可替换实现，后续可无痛升级
- 满足 specs 的 SEO/多语言/流式/隔离要求

**Non-Goals:**
- 生产级认证（OAuth、验证码邮件）——demo 邮箱即登录，界面上明示
- 产物的后端能力（登录/数据库/支付的服务端生成）——产物限定为纯前端单页应用
- 多智能体编排、竞速模式、可视化编辑器、自定义域名、积分计费
- 多实例横向扩展（单实例跑通 demo）

## Decisions

### D1：单体 Next.js 应用，路由组分域
- `app/[locale]/(marketing)/…` 营销面；`app/[locale]/(app)/dashboard、chat/…` 工作区（私有路由组，layout 挂守卫）；公开产物路由独立于两组之外
- 备选：营销站与工作区拆两个应用（atoms.dev 原站做法）——MVP 阶段运维成本翻倍，放弃；路由组隔离保留后续拆分能力

### D2：i18n 用 next-intl
- middleware 做 locale 协商与重定向，消息文件 `messages/{zh,en}.json`；hreflang 与 per-locale URL 配合 App Router metadata 生成
- 备选：自研 i18n——SEO 元信息、路由前缀、cookie 持久化都要重造，不值

### D3：内容目录 = 类型化数据文件 + 静态生成
- `content/{models,usecases,comparisons,prompts,templates,discover}/*.ts(x)` 导出 Zod 校验条目（`status: draft|published`、双语字段），种子数据每类 2–6 条
- 详情页 `generateStaticParams` 预渲染；草稿不产出路由、不入 sitemap
- 备选：headless CMS——延后，数据文件层已把「内容源」抽象在单一边界后

### D4：UI = Tailwind CSS + shadcn/ui
- 预览弹窗、FAQ 折叠、语言下拉用 shadcn 组件；App Viewer 视口切换自实现
- 备选：PrimeReact（对齐原站 PrimeVue）——定制成本高，放弃

### D5：认证 = 自建 demo 会话（邮箱即登录）
- 自建：`POST /api/auth/login` 接受邮箱，查库即登录/建号；会话用签名 HttpOnly cookie（`SESSION_SECRET`，jose 或 iron-session）
- 界面明示「演示登录」；redirect 仅接受站内相对路径
- 备选：Auth.js v5（NextAuth）——其价值在 OAuth/E-mail provider，本阶段都被砍掉，引入只增加依赖；后续上生产认证时再评估迁入
- 明确风险接受：无第二因子，任何人可用任意邮箱进入对应账户，仅限演示环境

### D6：数据 = Prisma + SQLite
- 表：`users`；`projects`（ownerId、title、currentVersionId、publishedSlug?、publishedAt?）；`messages`（projectId、role、content、buildStatus）；`app_versions`（projectId、version 序号、html 内容、触发 messageId、createdAt）
- 公开 slug 用 nanoid（不可猜测，满足 app-delivery 规格）
- 备选：直接上 Postgres——MVP 本地零运维优先；Prisma 保证后续换连接串即迁（列入风险）

### D7：LLM = OpenAI 兼容 SDK，产物为单 HTML 文档
- 环境变量 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`；provider 一层薄抽象，可换网关
- 生成管线：服务端组装系统提示（约束：输出一个完整自包含 HTML 文档，内联 CSS/JS，禁外部服务依赖、禁访问宿主）+ 需求历史 + 当前产物 → 流式生成 → 校验（HTML 结构完整、大小上限如 512KB）→ 存为新版本
- **迭代策略 = 全量重生成**（把当前产物作为上下文重出整份），不做增量补丁：实现简单、可靠、可整体回退；代价是 token 消耗与长产物截断风险（见风险）
- 备选：结构化多文件产物 + 构建管线——MVP 复杂度过高；增量 diff 编辑——模型稳定性差

### D8：构建通道 = Route Handler SSE + 项目内串行队列
- `POST /api/projects/[id]/chat`：消息先落库 → 触发构建 → SSE 流式回传过程文本 → 完成时回传版本事件
- 服务端按项目维护构建互斥（内存队列 + DB 状态字段防多实例竞态的最低保障），排队行为满足 chat-build 规格
- 备选：任务表 + 轮询——demo 阶段 SSE 语义更直接；WebSocket——引入长连接基础设施，不值

### D9：产物渲染与沙箱
- 工作区 App Viewer 与公开 URL 共用同一渲染路径：`GET /p/[slug]`（发布后可达）与工作区预览 `GET /api/projects/[id]/preview`（登录+属主校验）直接输出产物 HTML
- iframe 侧统一 `sandbox="allow-scripts"`（不含 `allow-same-origin`，产物与宿主不同源上下文）+ `Content-Security-Policy` 限制外联
- 备选：产物存对象存储 + 独立域——发布托管阶段再做，本阶段站内路由足够

### D10：邮件能力移除
- demo 无邮件需求（无验证码、无通知）；原 provider 抽象决策作废

### D11：预览演示 = 用本产品生成的示例应用
- 首页「能构建什么」的 6 个演示项目即预生成好的产物版本，走同一渲染路径；「克隆」= 登录后以其品类描述为初始需求建项目（与真实闭环同构）
- 备选：外部静态演示页——与核心闭环脱节，放弃

## Risks / Trade-offs

- [LLM 产物质量不稳定/不完整] → 生成后校验 + 失败保护保留旧版本 + 重试；系统提示强约束输出形态
- [全量重生成的 token 成本与上下文截断] → 产物大小上限；超限提示用户精简；后续可换增量策略
- [demo 登录无安全边界] → 界面明示仅演示；生产部署前 MUST 替换（后续变更）
- [SQLite 不支持多实例部署] → Prisma schema 按 Postgres 兼容写法维护；部署目标确定后换连接串
- [产物沙箱逃逸面（第三方脚本）] → sandbox 无 same-origin + CSP 白名单；产物默认禁外联脚本
- [营销区与工作区同应用互相影响] → 路由组独立构建单元、私有路由守卫在工作区 layout；后续可整体拆分

## Migration Plan

1. 本地 `npm run dev` 验证核心闭环（邮箱登录→需求→生成→预览→发布→匿名访问→迭代→再发布）
2. 部署到用户选定目标平台（含 `SESSION_SECRET`、`LLM_*` 环境变量）
3. 回滚 = 仓库回退（无外部数据迁移；SQLite 文件随版本保留）

## Open Questions

- 生产部署目标（自有服务器 / Vercel / Qoder Sites）：影响环境变量与数据库迁移时机，不影响本设计
- LLM 网关选型（直接厂商 / OpenRouter / 自建网关）：provider 抽象已隔离，仅配 env
