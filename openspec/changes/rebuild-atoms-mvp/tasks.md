# Tasks

## 1. 项目脚手架与全局骨架

- [ ] 1.1 初始化 Next.js（App Router）+ TypeScript + Tailwind + ESLint 项目结构，运行 `npm run build` 成功
- [ ] 1.2 集成 next-intl：zh/en 消息文件、locale 协商中间件、根路径重定向与语言切换持久化，验证 `/` 重定向到默认语言且切换后二次访问保持（marketing-site：多语言路由）
- [ ] 1.3 实现全局顶部导航（登录/登出入口、语言切换）与页脚（产品/资源/公司/社区四组链接），验证页脚全部站内链接在两种语言下均 200（marketing-site：全局导航）

## 2. 简化认证与数据层

- [ ] 2.1 建立 Prisma + SQLite schema（users/projects/messages/app_versions）并完成迁移，验证 `prisma migrate` 与 Studio 中四张表结构正确
- [ ] 2.2 实现邮箱即登录 API 与签名会话 cookie（`SESSION_SECRET`）及登出，验证新邮箱提交即建号登录、已有邮箱直接登录、登出后会话失效（user-auth：邮箱即登录/会话）
- [ ] 2.3 实现登录页 UI（含「演示登录」明示与条款链接）、`redirect` 安全校验（仅站内路径）与私有路由守卫中间件，验证外站 redirect 被忽略、未登录访问 /dashboard 跳登录页并携带 redirect（user-auth：安全回跳/守卫）

## 3. 项目与对话控制面

- [ ] 3.1 实现项目 CRUD API（按 owner 隔离、创建可携带初始需求消息、删除级联清消息与版本），验证第二账号访问他人项目返回 404、删除后项目与对话路由均 404（workspace-projects）
- [ ] 3.2 实现 /dashboard 项目列表（按更新时间倒序、空状态引导、删除二次确认），验证排序与取消删除行为（workspace-projects）
- [ ] 3.3 实现 /chat/[id] 消息流界面与历史读取 API，验证刷新或重新进入后消息按原顺序完整恢复（chat-build：历史持久化）
- [ ] 3.4 实现消息发送 API：消息落库、项目内串行构建队列、排队与失败重试语义，验证构建中追加消息排队、失败显示重试入口且重试成功（chat-build：触发构建/排队/失败）

## 4. 应用生成（核心闭环）

- [ ] 4.1 实现 LLM provider 薄抽象（`LLM_BASE_URL/API_KEY/MODEL` 环境变量）与生成系统提示（自包含单页 HTML 约束：内联 CSS/JS、无外部服务依赖、禁访问宿主），验证配置后可完成一次流式调用
- [ ] 4.2 实现生成管线：SSE 流式过程回传 → 产物校验（HTML 结构完整、大小上限）→ 成功保存 app_versions 新版本并关联触发消息、更新项目当前版本，验证一条需求端到端产出可在浏览器直接运行的应用（app-generation：生成/版本化）
- [ ] 4.3 实现迭代生成：请求上下文含需求历史与当前产物，验证两轮迭代后新版本体现修改且旧版本仍保留（app-generation：迭代更新）
- [ ] 4.4 实现失败保护：构建失败时不写入新版本并回传可重试错误，验证失败后项目当前版本仍为上一轮产物（app-generation：失败保护）

## 5. 预览与发布（App Viewer + 公开 URL）

- [ ] 5.1 实现产物渲染端点（属主校验的工作区预览 + `GET /p/[slug]` 公开路由）与沙箱 iframe（sandbox 无 allow-same-origin + CSP），验证产物内脚本无法读取宿主 Cookie（app-generation：沙箱渲染）
- [ ] 5.2 实现 App Viewer（iframe 渲染当前版本、桌面/移动视口切换、构建完成后刷新到新版本），验证视口切换与版本跟随（app-delivery：App Viewer）
- [ ] 5.3 实现发布/取消发布 API（nanoid slug），验证发布后匿名访问公开 URL 可完整交互、未发布与取消发布返回 404、迭代后再发布同 URL 内容更新（app-delivery：发布）
- [ ] 5.4 实现交付入口：项目列表预览/公开链接入口、对话页切换 App Viewer，验证从列表直达预览（app-delivery：交付入口）

## 6. 首页与营销内容

- [ ] 6.1 实现首页转化区：需求输入 + 「开始」（未登录→登录带 redirect；已登录→携需求建项目进对话）、空输入提示，验证三条分支行为（marketing-site：首页转化区）
- [ ] 6.2 实现「能构建什么」预览弹窗：6 个预生成演示应用（复用产物渲染路径）+ 模态框（标题/iframe/克隆/关闭），克隆=登录后以品类需求建项目，验证弹窗与克隆链路（marketing-site：预览弹窗）
- [ ] 6.3 实现定价页（三档、月/年切换、FAQ）与六类内容目录页（每类 2–6 条种子、供应商/品类筛选、draft 不产出路由），验证月年切换、筛选保持、draft 404（marketing-site/content-catalog）
- [ ] 6.4 实现 per-locale sitemap、robots 与内容页 OG metadata，验证 sitemap 只含已发布页（content-catalog：sitemap）

## 7. 集成验收

- [ ] 7.1 运行 `npm run build` 并冒烟全部路由（营销与内容页 200、私有路由重定向、`/p/[slug]` 行为正确），构建输出无错误
- [ ] 7.2 编写 README（本地启动、环境变量、内容数据格式、演示登录说明），按 README 从零启动成功
- [ ] 7.3 对照全部 spec 的 Scenario 逐条验收并记录，重点跑通核心闭环脚本：邮箱登录→提交需求→生成应用→App Viewer 预览→发布→匿名访问→迭代→再发布→取消发布

## Workflow follow-up

- 实现完成后经用户确认，运行 openspec archive 归档本变更并验证归档结果
