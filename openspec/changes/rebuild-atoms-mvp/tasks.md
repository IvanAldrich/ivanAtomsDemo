# Tasks

## 1. 项目脚手架与全局骨架

- [x] 1.1 初始化 Next.js（App Router）+ TypeScript + Tailwind + ESLint 项目结构，运行 `npm run build` 成功
- [x] 1.2 集成 next-intl：zh/en 消息文件、locale 协商中间件、根路径重定向与语言切换持久化，验证 `/` 重定向到默认语言且切换后二次访问保持（marketing-site：多语言路由）
- [x] 1.3 实现全局顶部导航（登录/登出入口、语言切换）与页脚（产品/资源/公司/社区四组链接），验证页脚全部站内链接在两种语言下均 200（marketing-site：全局导航）

## 2. 简化认证与数据层

- [x] 2.1 建立 Prisma + SQLite schema（users/projects/messages/app_versions，含构建状态与运行时字段）与 `storage/projects/{id}/` 目录约定并完成迁移，验证 `prisma migrate` 与 Studio 表结构正确
- [x] 2.2 实现邮箱即登录 API 与签名会话 cookie（`SESSION_SECRET`）及登出，验证新邮箱提交即建号登录、已有邮箱直接登录、登出后会话失效（user-auth：邮箱即登录/会话）
- [x] 2.3 实现登录页 UI（含「演示登录」明示与条款链接）、`redirect` 安全校验（仅站内路径）与私有路由守卫中间件，验证外站 redirect 被忽略、未登录访问 /dashboard 跳登录页并携带 redirect（user-auth：安全回跳/守卫）

## 3. 项目与对话控制面

- [ ] 3.1 实现项目 CRUD API（按 owner 隔离、创建可携带初始需求消息），验证第二账号访问他人项目返回 404（workspace-projects）
- [ ] 3.2 实现 /dashboard 项目列表（按更新时间倒序、空状态引导、删除二次确认并触发级联清理任务），验证确认删除后项目/对话路由 404 且 `storage/projects/{id}` 被移除（workspace-projects + build-pipeline：删除级联）
- [ ] 3.3 实现 /chat/[id] 消息流界面与历史读取 API，验证刷新或重新进入后消息按原顺序完整恢复（chat-build：历史持久化）
- [ ] 3.4 实现消息发送 API 与 SSE 通道：消息落库、全局构建队列（并发 1）、排队状态与失败重试语义，验证构建中追加消息排队、失败显示重试入口且重试成功（chat-build：触发/排队/失败）

## 4. 工程自由生成

- [ ] 4.1 实现 LLM provider 薄抽象（`LLM_BASE_URL/API_KEY/MODEL`）与自由生成提示（运行契约：Node 20/npm、`npm start` + PORT、数据写 DATA_DIR、禁访问宿主；工程惯例参考），验证配置后可完成一次流式调用（app-generation：生成内容安全约束）
- [ ] 4.2 实现文件输出协议解析（工程计划 + 逐文件路径/内容，新增/修改/删除标记）与快照落盘校验（package.json 存在、路径无穿越），验证一轮生成落盘出完整多文件工程（app-generation：文件协议落盘）
- [ ] 4.3 实现迭代生成上下文组装（需求历史摘要 + 当前文件树 + 按需文件内容），验证一次「加页面」迭代后新快照包含新文件且未提及文件与上一版本一致（app-generation：迭代修改）

## 5. 构建管线与自修复

- [ ] 5.1 实现隔离执行器两级：容器级（检测 Docker 可用）与进程级降级（受限子进程 + ulimit + 超时），当前级别 MUST 在界面与日志明示，验证进程级构建无法读取宿主业务库文件且降级提示可见（build-pipeline：沙箱构建/隔离级别明示）
- [ ] 5.2 实现构建流程：`npm install` → `npm run build`（无则跳过）→ 启动验证（`npm start` + 端口就绪探测 + 启动超时），构建与安装日志流式回传对话，验证日志逐块可见且含失败原文（build-pipeline：构建日志/启动验证）
- [ ] 5.3 实现自修复循环：失败提取错误尾部 + 相关文件回传 LLM 产出修复并重建，上限 5 轮，超限明确失败，验证「首轮故意失败 → 第二轮修复成功」与「连续超限后当前版本不变」两条路径（build-pipeline：自修复循环）
- [ ] 5.4 实现版本落账：仅构建验证成功的快照写入 `app_versions` 并关联消息、更新项目当前版本，验证失败轮次不产生新版本（app-generation：以构建成功为界的版本化）

## 6. 运行时与发布交付

- [ ] 6.1 实现运行时管理器：为项目当前版本分配空闲端口、拉起进程、stdout 落日志、崩溃标记状态、宿主重启后按 `run.json` best-effort 恢复，验证项目进程被 kill 后宿主与其他项目不受影响（app-delivery：独立运行时）
- [ ] 6.2 实现内置反向代理：`/p/{slug}/*` → 项目端口（header/常见方法透传）与属主校验的 `/preview/{projectId}` 预览代理，验证代理路由可达项目应用首页与接口（app-delivery：App Viewer 代理）
- [ ] 6.3 实现发布/取消发布/迭代替换 API（nanoid slug、新版本验证通过后原子切换、失败回滚在线旧版本、取消后 404 并停进程），验证发布后匿名完整使用（含接口与数据持久）、迭代同 URL 更新、取消发布 404、更新失败回滚四条场景（app-delivery：发布/迭代更新）
- [ ] 6.4 实现 App Viewer 组件（沙箱 iframe + 桌面/移动视口切换 + 构建状态联动）与项目列表/对话页交付入口，验证从列表直达预览与视口切换（app-delivery：App Viewer/交付入口）

## 7. 首页与营销内容

- [ ] 7.1 实现首页转化区：需求输入 + 「开始」（未登录→登录带 redirect；已登录→携需求建项目进对话）、空输入提示，验证三条分支行为（marketing-site：首页转化区）
- [ ] 7.2 准备 6 个品类演示工程（用本管线预生成并构建，随平台交付于 `storage/demos/`），实现预览弹窗（标题/iframe/克隆/关闭），克隆=登录后以品类需求建项目，验证弹窗与克隆链路（marketing-site：预览弹窗）
- [ ] 7.3 实现定价页（三档、月/年切换、FAQ）与六类内容目录页（每类 2–6 条种子、筛选、draft 不产出路由），验证月年切换、筛选保持、draft 404（marketing-site/content-catalog）
- [ ] 7.4 实现 per-locale sitemap、robots 与内容页 OG metadata，验证 sitemap 只含已发布页（content-catalog：sitemap）

## 8. 集成验收

- [ ] 8.1 运行 `npm run build` 并冒烟全部路由（营销与内容页 200、私有路由重定向、`/p/[slug]` 与 `/preview` 行为正确），构建输出无错误
- [ ] 8.2 编写 README（启动、环境变量、隔离级别说明与 demo 边界声明、内容数据格式、演示登录说明），按 README 从零启动成功
- [ ] 8.3 对照全部 spec 的 Scenario 逐条验收并记录，重点跑通核心闭环脚本：邮箱登录→提交需求→自由生成工程→构建（含一次自修复演示）→发布→匿名完整使用→迭代→重建替换上线→取消发布；另验证删除级联与更新失败回滚

## Workflow follow-up

- 实现完成后经用户确认，运行 openspec archive 归档本变更并验证归档结果
