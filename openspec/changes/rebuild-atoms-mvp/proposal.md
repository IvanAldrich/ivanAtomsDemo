# Proposal

## Why

我们已完成对 atoms.dev（多智能体 AI 建站平台）的功能逆向（见 `docs/00-逆向总览.md` 至 `docs/04-重建范围建议.md`），需要重建一个**核心功能等价**的 demo 产品。核心期望：**用户通过本 agent 产品，用自然语言自定义实现自己的产品**——描述需求 → agent 生成可运行的应用 → 预览、迭代 → 发布为可分享的自有产品。周边能力（认证等）在 demo 阶段允许简化，但该核心闭环 MUST 完整落地。

## What Changes

- 新建 Next.js（App Router）+ React + TypeScript 单体应用（营销面与工作区以路由组隔离）
- **核心构建闭环（本变更重心）**：
  - 项目对话驱动应用生成：发送需求 → LLM 生成**自包含可运行的单页 Web 应用**（HTML/CSS/JS 产物）→ 流式呈现构建过程 → 产物版本化存储并关联触发消息
  - 对话迭代：后续修改需求基于项目上下文与当前产物生成新版本；失败时保留旧版本并支持重试
  - App Viewer：工作区内 iframe 沙箱预览（桌面/移动视口切换）
  - 发布：每项目一键发布为站内公开 URL（匿名可访问、不可猜测），再发布即更新，可取消发布——这就是用户「自己的产品」
- 认证**简化**（demo 级）：登录页输入邮箱即登录/注册（无 Google OAuth、无验证码邮件），带会话、安全回跳与私有路由守卫
- 营销面：首页转化区（prompt 输入 → 未登录跳登录 / 已登录直接建项目进构建）、「能构建什么」预览弹窗（演示项目）、定价页、六类数据驱动内容页（种子数据精简为每类 2–6 条）
- i18n（zh/en）与 SEO 基础（per-locale sitemap、robots、OG）
- 生成侧为单 agent 单模型管线（多智能体编排与角色化团队叙事延后；不改变对话-产物行为契约）
- **明确不做**（后续变更）：多智能体编排与批准流、Atoms Cloud 类后端能力生成（登录/数据库/支付的产物）、自定义域名、可视化编辑器、竞速模式、积分计费、Google OAuth/邮件验证码、视频生成、投放埋点矩阵
- 复用约束：全新品牌与文案，**不**复用 atoms.dev 的品牌名、文案原文、图片、视频素材

## Capabilities

### New Capabilities

- `marketing-site`: 营销站骨架与首页转化行为——多语言路由、全局导航/页脚、语言切换持久化、首页 prompt 转化区与「开始」跳转、预览/克隆弹窗、定价页展示
- `content-catalog`: 数据驱动的内容目录——模型/用例/对比/提示词/模板/发现六类页面的列表与详情渲染、分类筛选、SSR 输出与 sitemap 收录
- `user-auth`: demo 级认证与会话——邮箱即登录/注册、redirect 安全回跳、会话保持与登出、私有路由守卫
- `workspace-projects`: 我的项目管理——项目列表、新建（可携带初始需求）、删除、访问隔离
- `chat-build`: 构建对话控制面——`/chat/{id}` 消息流、发送消息触发项目构建任务、构建过程流式反馈、多轮迭代、历史持久化、失败重试
- `app-generation`: 应用产物生成——从需求生成自包含可运行的单页 Web 应用、版本化存储、迭代更新、失败保护、沙箱渲染边界
- `app-delivery`: 产品交付——App Viewer 预览（视口切换、反映当前版本）、项目发布为公开 URL、取消发布、列表直达入口

### Modified Capabilities

（无——greenfield 项目，尚无既有规格）

## Impact

- **代码**：`/home/admin/ivan/atoms` 下新建整个应用；现有 `docs/` 逆向文档不受影响
- **依赖**：Next.js、React、TypeScript、Tailwind CSS、shadcn/ui、next-intl、Prisma、Zod；LLM 接入用 OpenAI 兼容 SDK（key 走环境变量）。**不引入** Auth.js/Google OAuth/邮件服务（demo 简化）
- **环境变量**：`LLM_BASE_URL`、`LLM_API_KEY`、`LLM_MODEL`、`SESSION_SECRET`
- **数据**：MVP 内容（模型/用例等）以本地结构化数据文件管理；用户/项目/消息/产物版本存 SQLite
- **未受影响**：atoms.dev 本身（零写入）；本变更不含对外部署动作
