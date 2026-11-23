# Proposal

## Why

我们已完成对 atoms.dev（多智能体 AI 建站平台）的功能逆向（见 `docs/00-逆向总览.md` 至 `docs/04-重建范围建议.md`），需要按其功能规格重建一个**功能等价**的自有平台。本变更交付第一个可上线闭环：**营销站 + 工作区雏形**，验证「访客 → 注册 → 建项目 → 对话生成」的核心产品路径。

## What Changes

- 新建 Next.js（App Router）+ React + TypeScript 项目，作为平台唯一代码库
- 新增营销站（zh/en 双语，`/{locale}/` 路由前缀）：首页转化区（prompt 输入 + 「开始」）、「能构建什么」预览弹窗（iframe 演示 + 克隆入口）、定价页、信任背书、FAQ、全局导航/页脚、语言切换
- 新增数据驱动内容目录：模型、用例、竞品对比、提示词库、模板、发现 六类列表页 + 详情页（内容来自本地数据文件，SSR 渲染）
- 新增认证：Google OAuth + 邮箱验证码，登录/注册合一，`redirect` 回跳
- 新增工作区雏形：我的项目列表（新建/删除）+ `/chat/{id}` 项目对话，接单一 LLM，流式反馈
- 新增 SEO 基础：per-locale sitemap、robots（公开/私有分组）、OG meta
- **明确不做**（后续变更）：多智能体编排与批准流、Atoms Cloud 类发布托管（每项目子域/自定义域名）、可视化编辑器、竞速模式、积分计费与支付、SEO/广告 agent、视频生成、投放埋点矩阵
- 复用约束：全新品牌与文案，**不**复用 atoms.dev 的品牌名、文案原文、图片、视频素材

## Capabilities

### New Capabilities

- `marketing-site`: 营销站骨架与首页转化行为——多语言路由、全局导航/页脚、语言切换持久化、首页 prompt 转化区与「开始」跳转登录、预览/克隆弹窗（iframe 演示 + 克隆入口）、定价页展示
- `content-catalog`: 数据驱动的内容目录——模型/用例/对比/提示词/模板/发现 六类页面的列表与详情渲染、分类筛选、SSR 输出与 sitemap 收录
- `user-auth`: 用户认证与会话——Google OAuth 与邮箱验证码双通道、登录注册合一、redirect 回跳、会话保持与登出、路由守卫
- `workspace-projects`: 我的项目管理——项目列表、新建、删除、最近访问排序
- `chat-build`: 项目对话式构建——`/chat/{id}` 消息流、单模型流式生成、构建状态反馈、对话历史持久化

### Modified Capabilities

（无——greenfield 项目，尚无既有规格）

## Impact

- **代码**：`/home/admin/ivan/atoms` 下新建整个应用（app/、lib/、content/ 等目录）；现有 `docs/` 逆向文档不受影响
- **依赖**：Next.js、React、TypeScript、Tailwind CSS、shadcn/ui（或等价组件库）、next-intl（i18n）、NextAuth/Auth.js 或自建会话、Zod；LLM 接入通过 OpenAI 兼容 SDK（模型 API key 走环境变量）
- **环境变量**：`GOOGLE_CLIENT_ID/SECRET`、邮件服务密钥、`LLM_API_KEY`、`LLM_BASE_URL`
- **数据**：MVP 内容（模型/用例/对比/提示词等）以本地结构化数据文件管理，后续可替换为 CMS
- **未受影响**：atoms.dev 本身（零写入）；本变更不含对外部署动作
