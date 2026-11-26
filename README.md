# IvanAtoms

逆向 atoms.dev 核心功能后重建的**演示级全栈 AI 建站平台**：描述需求 → AI 工程师自由生成完整 Node/npm 全栈代码工程（前端 + 后端 + 数据持久化）→ Docker 沙箱构建 + 自修复 → 一键发布为公开 URL → 对话迭代重建替换上线。

> 规格与任务追踪见 `openspec/changes/rebuild-atoms-mvp/` 与 `openspec/changes/modular-generation/`；逆向分析见 `docs/`。

## 快速开始

前置：Node 22（见 `.nvmrc`）、Docker（daemon 可用，当前用户有 docker 组权限）。

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
# 必填：SESSION_SECRET、DATABASE_URL、LLM_BASE_URL/LLM_API_KEY/LLM_MODEL
# 默认 RUNTIME_ISOLATION=container（需要 Docker；无 Docker 时自动降级并明确告警）

# 3. 初始化 Docker 沙箱（镜像 + 隔离网络 + 容器互访/宿主访问防火墙）
npm run docker:setup
# 生产建议安装 deploy/atoms-docker-firewall.service，重启后自动恢复网络隔离

# 4. 数据库迁移
npm run db:migrate

# 5. 开发：Web 与 worker 是两个进程
npm run dev
npm run worker        # 另一个终端；后台构建执行器

# 6. 生产
npm run build
npm run start         # 另一个终端
npm run worker
# 或一键（含 docker 组权限处理）：bash scripts/serve.sh
```

打开 http://localhost:3000 —— 使用邮箱 + 密码注册/登录（演示环境，请勿存放真实数据）。

> `RUNTIME_ISOLATION=container` 只有在 `docker info` 真实可用时才生效；否则 health 会明确报告 `process + degraded`，不会假装容器隔离。

## 环境变量

| 变量 | 必填 | 说明 |
|---|---|---|
| `SESSION_SECRET` | ✅ | 会话 cookie 与预览令牌签名密钥 |
| `DATABASE_URL` | ✅ | SQLite 文件路径（Prisma） |
| `LLM_BASE_URL` / `LLM_API_KEY` / `LLM_MODEL` | 生成必需 | OpenAI 兼容网关 |
| `RUNTIME_ISOLATION` | - | `container`（推荐）/ `process`（仅本地开发显式降级） |
| `SANDBOX_IMAGE` | - | 构建/运行时镜像，默认 `node:22-bookworm` |
| `SANDBOX_RUNTIME_NETWORK` | - | 运行时网络，默认 `atoms-runtime`（internal；容器互访由 DOCKER-USER 阻断） |
| `SANDBOX_BUILD_NETWORK` | - | 构建网络，默认 `atoms-build`（可访问 registry；容器互访与宿主访问阻断） |
| `SANDBOX_MEMORY_MB` | - | 单容器内存上限，默认 2048 |
| `SANDBOX_PIDS_LIMIT` | - | 单容器 pids 上限，默认 512 |
| `SANDBOX_CPUS` | - | 单容器 CPU 上限，默认 2 |
| `SANDBOX_USER` | - | 容器内 UID:GID，默认跟随宿主（保证工作目录可写） |
| `PREVIEW_TOKEN_TTL_SEC` | - | 预览令牌有效期，默认 86400 |
| `MODULAR_GENERATION` | - | `off` 时回滚到旧的全量上下文与自由文本计划 |
| `MODULAR_STRICT` | - | `1` 时旧工程也启用结构硬门禁 |
| `MODULAR_FILE_SOFT_KB` / `MODULAR_FILE_HARD_KB` | - | 单文件预算，默认 10 / 16 |
| `MODULAR_CONTEXT_KB` | - | 迭代上下文预算，默认 24 |
| `MODULAR_GEN_CONCURRENCY` | - | 依赖层内并发生成数，默认 2 |
| `SITE_BASE_URL` | - | sitemap 中的站点根地址 |
| `APP_BASE_DOMAIN` | - | 应用独立域名后缀，如 `apps.example.com` → `{slug}.apps.example.com`；本地 `apps.localhost` 仅浏览器与平台同机时可用 |
| `COOKIE_SECURE` | - | `true` 时会话 cookie 仅 HTTPS，并启用 `__Host-ia_session` 前缀 |

## 核心架构

```
Browser
  ├─ 控制面 Next.js（auth / projects / publish / SSE）
  └─ /p/{slug}、/preview/{projectId}/{token} → 反向代理 → 运行时容器 IP

控制面 ──> 数据库（SQLite/Prisma：users/projects/messages/versions/build_jobs/build_events）
  │
  ├─ 入队 BuildJob（幂等，messageId 唯一）
  ▼
独立 worker 进程（npm run worker）
  │  claim + lease + heartbeat + 重试
  ▼
Sandbox Provider（Docker）
  ├─ 构建：npm install / build / 启动验证 / 资源冒烟
  ├─ 运行时：每个 project-version 一个容器
  └─ 产物：storage/projects/{id}/snapshots/v{n}
```

### 构建流水线

- 生成：Profile + Module Manifest → 依赖拓扑分层生成；迭代只注入 1–3 个目标文件 + 依赖签名（≤24KB），优先 SEARCH/REPLACE
- 结构门禁（在 `npm install` 之前）：大小/内联/import 图/入口可达/manifest 漂移/ESM
- 语法校验：一次容器启动，批量 `node --check`
- 沙箱构建：`npm install` → `npm run build` → 启动验证 → 资源冒烟
- 自修复：错误尾部 + 结构化 violations + 原始需求回传，上限 5 轮
- 版本落账：仅全部门禁通过才写 `app_versions`

### 隔离与安全

- **container 模式**（默认）：
  - 非 root（1000:1000）、只读 rootfs、`/tmp` tmpfs；
  - `--cap-drop ALL`、`no-new-privileges`、pids/内存/CPU 限额；
  - 只挂载项目工作目录，不挂载宿主目录、不注入宿主环境变量；
  - 运行时使用 internal 网络，宿主可访问容器 IP，容器无外联；
  - 构建期使用 bridge 网络（npm registry 需要），后续可替换为 registry 代理 + egress 白名单。
- **process 模式**：仅显式本地开发降级；没有内核级隔离，不能用于不可信代码。
- **认证**：邮箱 + 密码；密码使用 scrypt 加盐哈希；会话 Cookie host-only + SameSite=Lax；生产开启 `COOKIE_SECURE` 时使用 `__Host-` 前缀。已有账号可用 `NEW_PASSWORD='...' npx tsx scripts/set-password.ts user@example.com` 设置/重置密码。
- **应用独立域名**：配置 `APP_BASE_DOMAIN` 后，`/p/{slug}` 会 307 到 `{slug}.{APP_BASE_DOMAIN}`；应用与平台不同源，生成页面的 JS 无法读取/调用平台 API。
- **跨源写防护**：平台 `/api/*` 的非 GET 请求校验 `Origin`，跨源写操作直接 403。
- **平台会话隔离**：代理转发前剥离平台会话 Cookie 与上游同名 `Set-Cookie`；生成应用无法读取/覆盖平台会话。
- **预览令牌**：HMAC + 过期时间，默认 24h；无效/过期返回 401。
- **安全响应头**：`X-Content-Type-Options`、`Referrer-Policy`、`Permissions-Policy`、`X-Frame-Options`。

### 持久队列与运行时

- `BuildJob`：`queued → leased → running → done/failed`，带租约、心跳、最大重试次数；worker 崩溃后租约过期可重新领取。
- `BuildEvent`：worker 将事件落库，SSE 轮询回放；不再依赖单进程 EventEmitter。
- 运行时：每个 `project-version` 一个容器；发布/迭代采用暂存启动 → 健康检查 → 原子切换；删除项目会停止容器并清理磁盘。
- 启动对账：重启后中断的构建标记失败可重试；孤儿容器按 label 清理；已发布项目按 `run.json` 恢复。
- 快照 GC：只保留最近 3 个版本，且保护当前版本与正在运行的版本。

### 可观测性

- 每轮构建写入 `storage/projects/<id>/build-stats.jsonl`（路径/大小/token/错误码，不含文件内容或密钥）。
- `GET /api/health` 返回 DB、uptime、真实隔离级别与降级原因、worker 心跳（最后可见秒数）以及队列积压（queued/running）。

## 测试与 CI

```bash
npm test                 # 47 个单测：manifest/门禁/上下文/拆分/指标/预览令牌
npm run test:integration # 临时 DB 上的队列/事件/租约/重试集成测试
npm run test:sandbox     # Docker 契约：非 root、只读 rootfs、无宿主文件、注入无效、无外联
npm run test:e2e         # Web + worker + SSE 闭环（需先启动服务）
npm run lint
npm run typecheck
npm run build
```

CI（`.github/workflows/ci.yml`）在 PR 上执行 lint、typecheck、单测、集成测试、生产构建，并启动临时 Web/worker 跑 E2E smoke；独立 `sandbox` job 运行 Docker 契约测试。

## 常用命令

```bash
npm run dev              # 开发服务器
npm run worker           # 后台构建执行器
npm run build            # prisma generate + next build
npm start                # 生产 Web
npm run docker:setup     # 拉镜像 + 创建隔离网络
npm test                 # 单测
npm run test:integration # 队列集成测试
npm run test:sandbox     # Docker 沙箱契约测试
npm run test:e2e         # Web + worker + SSE 闭环
npm run stats -- <projectId>  # 构建/token 指标 p50/p95
npm run db:migrate       # Prisma 迁移（开发）
npm run db:deploy        # Prisma 迁移（部署）
npm run db:studio        # 数据库浏览
NEW_PASSWORD='至少8位' npx tsx scripts/set-password.ts user@example.com  # 设置/重置密码
```

## 已知边界（demo 级，生产化待办）

- 邮箱密码认证已启用，但暂无邮箱验证、找回密码与二因子（已有账号用 set-password 脚本设置密码）；
- 应用独立子域已实现；生产需要 `APP_BASE_DOMAIN` 泛解析 DNS + 泛域名证书，反向代理需保留 Host；若与平台共用注册域，建议迁到独立 eTLD+1，避免 Cookie tossing；
- 反向代理不支持 WebSocket；
- 配额/限流按当前决定暂缓；
- SQLite 单实例；多实例需 Postgres + 对象存储 + 共享队列；
- 构建期网络尚未做 egress 白名单（需要 npm registry 代理）；
- 待办：按用户构建配额、结构化日志/OTel、优雅停机、备份策略、子域路由、限流与滥用检测。

## 内容数据

营销内容页（模型/用例/对比/提示词/模板/发现）由 `src/content/entries.ts` 驱动：新增条目即出现新页面，`status: "draft"` 的条目不产出路由、不入 sitemap。品牌名与文案集中在 `messages/{zh,en}.json`。