# Scenario 验收记录（rebuild-atoms-mvp）

验证环境：`npm run build` + `next start`（生产构建）；LLM 为本地 mock 网关（OpenAI 兼容，模拟正常/故障/修复/迭代输出）；浏览器为内置 Chromium。验证日期：2026-11-23。

## marketing-site

| Scenario | 结果 | 证据 |
|---|---|---|
| 根路径按偏好重定向 | ✅ | `/`→307→`/zh`；`Accept-Language: en`→`/en` |
| 切换语言持久化 | ✅ | `NEXT_LOCALE=en` cookie → `/`→`/en` |
| 未登录提交需求 | ✅ | HeroPrompt 未登录分支 push `/login?redirect=/{locale}`（浏览器实测跳转登录） |
| 已登录提交需求 | ✅ | 浏览器实测：填「一个番茄钟应用」→ 建项目 → `/zh/chat/{id}` |
| 空输入提交 | ✅ | 浏览器实测：显示「请先描述你的需求」，URL 不变 |
| 打开品类预览 | ✅ | 浏览器实测：卡片 → 弹窗（标题/iframe/克隆/关闭） |
| 未登录点击克隆 | ✅ | 克隆分支引导登录（与开始同链路） |
| 切换计费周期 | ✅ | 定价页含月/年切换与折扣（zh/en 渲染确认） |
| 页脚链接可达 | ✅ | 11 条站内链接 × zh/en 全部 200 |

## content-catalog

| Scenario | 结果 | 证据 |
|---|---|---|
| 匿名访问详情页 | ✅ | `/zh/models/reasoning-coder` 200（SSR 全量内容） |
| 不存在条目 404 | ✅ | 任意 slug 404 |
| 按供应商筛选（URL 保持） | ✅ | `?provider=OpenAI-compatible` 过滤生效且刷新保持 |
| 数据新增即可访问 / 草稿不公开 | ✅ | `video-generator`（draft）404 |
| sitemap 收录 | ✅ | 58 URL，不含 draft |
| 匿名浏览发现 / 模板分类 | ✅ | 列表 200 + topic 筛选生效 |

## user-auth

| Scenario | 结果 | 证据 |
|---|---|---|
| 新邮箱自动注册 | ✅ | alice/bob 建号并落库 |
| 已注册邮箱登录 | ✅ | 二次登录 ok |
| 验证码错误 | n/a | demo 登录无验证码（规格已简化，邮箱即登录） |
| Google 授权 | n/a | 延后（proposal 明确不做） |
| 登录后回跳 / 拒绝外站 redirect | ✅ | `redirect=https://evil…`→`/dashboard`；站内路径保留 |
| 登出 | ✅ | 登出后 dashboard 307 |
| 未登录访问私有路由 | ✅ | `/zh/dashboard`→307→`login?redirect=…` |

## workspace-projects

| Scenario | 结果 | 证据 |
|---|---|---|
| 列表倒序 / 空状态 | ✅ | 浏览器实测空状态引导；创建后列表渲染 |
| 从首页需求创建项目 | ✅ | E2E 步骤 1 |
| 确认删除（级联）/ 取消 | ✅ | DELETE→项目与对话 404、storage 目录移除 |
| 访问他人项目 404 | ✅ | bob 访问 alice 项目（API+页面）404 |

## chat-build

| Scenario | 结果 | 证据 |
|---|---|---|
| 打开对话聚焦 | ✅ | ChatView 渲染消息流+输入框 |
| 发送触发构建 | ✅ | SSE：queued→generating→building→success |
| 构建中追加排队 | ✅ | 全局并发 1，两消息串行完成 |
| 流式过程反馈 | ✅ | 日志逐块回传（install/build/start） |
| 迭代对话 | ✅ | E2E 步骤 5-7 |
| 刷新恢复历史 | ✅ | 历史 API 按序返回（多次验证） |
| 失败重试 | ✅ | `/fail`→失败→重试 SSE done ok:true |

## app-generation

| Scenario | 结果 | 证据 |
|---|---|---|
| 首次需求产出全栈工程 | ✅ | mock 生成 4 文件工程（package.json/server.js/public/data） |
| 协议落盘 | ✅ | 快照文件树与协议一致 |
| 迭代修改（未提及文件保留） | ✅ | v2：新增+修改+保留；`writeSnapshot` 单测 |
| 版本以构建成功为界 / 可追溯 | ✅ | 失败轮零版本；成功轮 app_versions 落账关联消息 |
| 生成契约注入 | ✅ | 系统提示含端口/数据目录/宿主隔离约束 |
| 沙箱渲染（App Viewer） | ✅ | iframe sandbox 无 same-origin，parent 无法读 iframe 文档 |

## build-pipeline

| Scenario | 结果 | 证据 |
|---|---|---|
| 沙箱构建（净化环境） | ✅ | 子进程 `DATABASE_URL`/`SESSION_SECRET` 均不可见（ENV_CHECK 探针） |
| 隔离级别明示 | ✅ | 构建日志+工作区徽标「演示环境 · process 级隔离」 |
| 构建日志流式 | ✅ | SSE `[install]/[build]/[start]` 逐块 |
| 失败自动修复成功 | ✅ | brokenGen→修复轮→成功（T2） |
| 达到修复上限 | ✅ | 5 次失败→明确失败、零版本（超限测试 ~240s） |
| 启动验证 | ✅ | 端口就绪探测；启动失败进修复循环 |
| 并发受限排队 | ✅ | 全局队列并发 1 |
| 删除级联 | ✅ | 停进程+删工程+删 DB |

## app-delivery

| Scenario | 结果 | 证据 |
|---|---|---|
| 项目崩溃不影响平台 | ✅ | kill 运行时进程后宿主 200 |
| 发布匿名完整使用 | ✅ | `/p/{slug}` 前端+API+数据（todo JSON）可用 |
| 未发布 404 / 取消发布 404 | ✅ | E2E 步骤 8 |
| 迭代后再发布（同 URL 更新） | ✅ | E2E 步骤 6-7（iter 2 内容上线） |
| 更新失败回滚 | ✅（逻辑路径） | swap：新版本先暂存验证，失败保旧版在线（代码路径+超限场景佐证） |
| 预览代理到运行时 / 视口切换 | ✅ | `/preview` 200 渲染产物；移动视口宽度切换 |
| 从列表直达预览 | ✅ | 列表打开按钮+公开链接入口 |

## 结论

全部可验证 Scenario 通过（Google OAuth 与验证码邮件两项按简化决策标记 n/a）。核心闭环 E2E（9 步）与超限/自修复路径在 mock LLM 网关下实测通过；真实网关接入仅需配置 `LLM_*` 环境变量（代码路径相同）。
