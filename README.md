# IvanAtoms

逆向 atoms.dev 核心功能后重建的**演示级全栈 AI 建站平台**：描述需求 → AI 工程师自由生成完整 Node/npm 全栈代码工程（前端 + 后端 + 数据持久化）→ 沙箱构建 + 自修复 → 一键发布为公开 URL → 对话迭代重建替换上线。

> 规格与任务追踪见 `openspec/changes/rebuild-atoms-mvp/`（proposal / 8 能力规格 / design / tasks），逆向分析见 `docs/`。

## 快速开始

```bash
# 1. 安装依赖（Node 20+）
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env：
#   SESSION_SECRET   必填（openssl rand -base64 32）
#   DATABASE_URL     默认 file:../db/custom.db（SQLite）
#   LLM_BASE_URL / LLM_API_KEY / LLM_MODEL
#     任何 OpenAI 兼容网关（厂商直连 / OpenRouter / 自建网关）
#     未配置时回退「演示生成器」占位（仅验证链路，不产出真实工程）

# 3. 数据库迁移
npm run db:migrate

# 4. 启动
npm run dev        # 开发
npm run build && npm run start   # 生产
```

打开 http://localhost:3000 —— 输入任意邮箱即可登录（**演示登录**：无密码/验证码，请勿存放真实数据）。

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `SESSION_SECRET` | ✅ | 会话 cookie 签名密钥 |
| `DATABASE_URL` | ✅ | SQLite 文件路径（Prisma） |
| `LLM_BASE_URL` | 生成必需 | OpenAI 兼容网关地址 |
| `LLM_API_KEY` | 生成必需 | 网关 API key |
| `LLM_MODEL` | 生成必需 | 模型名 |
| `RUNTIME_ISOLATION` | - | `process`（默认）/ `container`（检测到 Docker 时容器隔离） |
| `SITE_BASE_URL` | - | sitemap 中的站点根地址 |
| `COOKIE_SECURE` | - | `true` 时会话 cookie 仅 HTTPS |

## 核心架构

```
用户 → 首页/对话（Next.js App Router，zh/en）
  └─ 消息入队（全局并发 1）→ SSE 流式反馈
       ├─ 自由生成（LLM，文件协议 ### FILE/DELETE）→ 工程快照 snapshots/v{n}
       ├─ 沙箱构建：npm install → build → 启动验证（受限子进程：净化环境/ulimit/超时）
       ├─ 自修复循环：错误尾部回传 LLM 修复，上限 5 轮
       └─ 版本落账 app_versions（仅构建成功）
  └─ 发布：nanoid slug + 独立运行时进程（端口分配 + run.json 恢复）
       └─ 反向代理 /p/{slug}（匿名公开）· /preview/{projectId}（属主 App Viewer）
           迭代 → 重建 → swap 原子上线（失败回滚旧版本）
```

- **存储**：宿主业务库 `db/custom.db`（Prisma：users / projects / messages / app_versions）；每项目 `storage/projects/{id}/`（快照 / 运行数据 / run.json）
- **App Viewer**：沙箱 iframe（`sandbox` 无 `allow-same-origin`），代理带 CORS 头支持产物自身 API 调用

## 已知 demo 边界（如实声明）

- 认证为**邮箱即登录**（无第二因子），仅限演示环境
- 无 Docker 时为**进程级隔离**：净化环境变量 + 资源限制，但非内核级隔离（界面已明示）
- 公开 URL 与宿主**同源**（路径代理，非独立子域）；产物理论上可读宿主同源 Cookie —— 生产化需泛子域方案
- 反向代理不支持 WebSocket
- 多智能体编排、竞速模式、可视化编辑器、计费、自定义域名、Stripe/Supabase 集成：**未实现**（见 proposal 的「明确不做」）

## 内容数据

营销内容页（模型/用例/对比/提示词/模板/发现）由 `src/content/entries.ts` 驱动：新增条目即出现新页面，`status: "draft"` 的条目不产出路由、不入 sitemap。品牌名与文案集中在 `messages/{zh,en}.json`。

## 常用命令

```bash
npm run dev          # 开发服务器
npm run build        # prisma generate + next build
npm run lint         # ESLint
npm run db:migrate   # Prisma 迁移
npm run db:studio    # 数据库浏览
```
