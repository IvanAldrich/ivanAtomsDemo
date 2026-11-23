# Design

## Context

仓库 `/home/admin/ivan/atoms` 目前只含逆向文档（`docs/`）与 OpenSpec 规格，无任何应用代码（greenfield）。功能规格来自对 atoms.dev 的逆向（`docs/02-核心功能与流程.md`）；已确认技术栈 Next.js App Router + React，范围为「营销站 + 工作区雏形」。MVP 部署目标未定（见 Open Questions）。

## Goals / Non-Goals

**Goals:**
- 单仓库内交付营销站与工作区雏形，二者通过路由组与独立布局物理隔离
- 内容页全部数据驱动（本地数据文件），新增内容零代码改动
- LLM、邮件、OAuth 均以可替换 provider 形式接入，便于更换供应商
- 满足 specs 中的 SEO/多语言/流式/隔离要求

**Non-Goals:**
- 每项目子域发布、可视化编辑器、多 agent 编排、积分计费（后续变更）
- 多实例横向扩展与高可用（单实例即可跑通 MVP）
- CMS、投放埋点矩阵

## Decisions

### D1：单体 Next.js 应用，路由组分域
- `app/[locale]/(marketing)/…` 营销站；`app/[locale]/(app)/dashboard、chat/…` 工作区（私有路由组，layout 挂守卫）
- 备选：营销站与工作区拆两个应用（atoms.dev 原站做法）——MVP 阶段运维成本翻倍，放弃；路由组隔离保留后续拆分能力

### D2：i18n 用 next-intl
- middleware 做 locale 协商与重定向，消息文件 `messages/{zh,en}.json`；hreflang 与 per-locale URL 由其配合 App Router metadata 生成
- 备选：自研 i18n——SEO 元信息、路由前缀、cookie 持久化都要重造，不值

### D3：内容目录 = 类型化数据文件 + 静态生成
- `content/{models,usecases,comparisons,prompts,templates,discover}/*.ts(x)` 导出 Zod 校验的结构化条目（含 `status: draft|published`、多语言字段）
- 详情页 `generateStaticParams` 预渲染；草稿条目不产出路由、不入 sitemap（满足 content-catalog 规格）
- 备选：headless CMS——延后，数据文件层已把「内容源」抽象在单一边界后

### D4：UI = Tailwind CSS + shadcn/ui
- 对应原站「原子工具类 + 组件库」的角色；预览弹窗、FAQ 折叠、语言下拉用 shadcn 对应组件
- 备选：PrimeReact（对齐原站 PrimeVue）——视觉风格更贴原站但定制成本高，放弃

### D5：认证 = Auth.js v5（NextAuth）
- Google provider + Email provider（magic link/验证码语义）；会话用 JWT 策略
- `redirect` 校验：仅接受站内相对路径，防开放重定向（满足 user-auth 规格的安全回跳）
- 备选：Clerk（托管，快但外部依赖+成本）、自研——放弃

### D6：数据 = Prisma + SQLite（文件库）
- 表：`users`、`projects`（ownerId、title、promptText、updatedAt）、`messages`（projectId、role、content、状态）
- 备选：直接上 Postgres——MVP 本地零运维优先；Prisma 保证后续换连接串即迁 Postgres（列入风险跟踪）

### D7：LLM = OpenAI 兼容 SDK，流式走 Route Handler
- 环境变量 `LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`；`POST /api/projects/[id]/chat` 返回 SSE 流，服务端把用户消息先落库再流式写回复（满足 chat-build 的历史持久化与失败重试）
- 生成期间的排队行为在服务端按项目串行处理
- 备选：React Server Actions 流式——长连接与错误重试语义不如 Route Handler 明确

### D8：预览演示 = 站内静态演示页
- 6 个品类演示以静态页放入 `app/[locale]/(marketing)/demos/…`，iframe 引用同源路径
- 「克隆」在 MVP 中简化为「登录 → 以该品类为初始 prompt 建项目」；每项目子域托管留待发布托管变更
- 备选：MVP 即搭泛子域发布——超出本次范围

### D9：邮件 = provider 抽象
- `MAIL_PROVIDER=console|resend`；console 模式把验证码打到服务端日志（本地开发），Resend 用于真实发送

## Risks / Trade-offs

- [SQLite 不支持多实例部署] → Prisma schema 按 Postgres 兼容写法维护；部署目标确定后仅换连接串
- [LLM 供应商不稳定/费用] → provider 抽象 + base URL 可配；单模型单并发；失败重试已入规格
- [营销区与工作区在同一应用，发布互相影响] → 路由组独立构建单元、私有路由守卫在工作区 layout；后续可整体拆分
- [Google OAuth 依赖真实回调域名] → 本地开发用 localhost 回调；部署后补登记回调 URL（迁移步骤含此项）
- [iframe 站内演示与原站跨子域体验差异] → MVP 接受；不影响规格行为

## Migration Plan

1. 本地 `npm run dev` 验证全流程（注册→建项目→对话）
2. 部署到用户选定的目标平台；登记 OAuth 回调与邮件发信域名
3. 回滚 = 仓库回退（无外部数据迁移；SQLite 文件随版本保留）

## Open Questions

- 生产部署目标（自有服务器 / Vercel / Qoder Sites）：影响 OAuth 回调域名与数据库迁移时机，不影响本设计
- 邮件服务商最终选型（Resend vs 其他）：provider 抽象已隔离
