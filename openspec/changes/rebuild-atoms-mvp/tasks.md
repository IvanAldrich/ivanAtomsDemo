# Tasks

## 1. 项目脚手架与全局骨架

- [ ] 1.1 初始化 Next.js（App Router）+ TypeScript + Tailwind + ESLint 项目结构，运行 `npm run build` 成功
- [ ] 1.2 集成 next-intl：zh/en 消息文件、locale 协商中间件、根路径重定向与语言切换持久化，验证 `/` 重定向到默认语言且切换后二次访问保持（marketing-site：多语言路由）
- [ ] 1.3 实现全局顶部导航（登录/注册入口、语言切换）与页脚（产品/资源/公司/社区四组链接），验证页脚全部站内链接在两种语言下均 200（marketing-site：全局导航）

## 2. 数据驱动内容目录

- [ ] 2.1 定义六类内容（模型/用例/对比/提示词/模板/发现）的 Zod schema 与种子数据文件（每类 2–6 条，含 draft 样例与 zh/en 双语字段），运行类型校验通过
- [ ] 2.2 实现模型列表页与详情页及供应商筛选（URL 参数驱动），验证筛选后刷新保持、不存在 slug 返回 404（content-catalog）
- [ ] 2.3 实现用例/对比/提示词/模板/发现五类的列表页与详情页（generateStaticParams 预渲染、模板分类导航、发现已保存 tab 引导登录），验证 draft 条目路由 404 且不出现在列表（content-catalog）
- [ ] 2.4 实现 app/sitemap.ts（per-locale 收录已发布内容页）、robots.ts 与详情页 OG metadata，验证 sitemap 输出不含草稿且含全部已发布页（content-catalog：sitemap）

## 3. 首页转化区

- [ ] 3.1 实现首页：hero 与需求输入框+「开始」、信任背书区、agent 团队展示、FAQ 折叠，验证空输入点击「开始」时提示且不跳转（marketing-site：首页转化区）
- [ ] 3.2 实现「能构建什么」品类卡片区：6 个站内静态演示页 + 预览模态框（标题/iframe/克隆/关闭），验证点击卡片弹出模态框且 iframe 加载对应演示页（marketing-site：预览弹窗）
- [ ] 3.3 实现定价页（免费/专业/旗舰三档、月/年切换含折扣说明、积分档位表、FAQ），验证周期切换后价格与折扣文案变化（marketing-site：定价页）

## 4. 认证与会话

- [ ] 4.1 集成 Auth.js v5：Google provider + Email provider、JWT 会话、用户落库，本地完成一次 Google 登录并看到会话用户（user-auth：Google OAuth）
- [ ] 4.2 实现邮件 provider 抽象（console/resend）与验证码发送、时效与错误提示，验证 console 模式下新邮箱触发验证码邮件、错误验证码被拒（user-auth：登录注册合一）
- [ ] 4.3 实现登录页 UI（登录注册合一、条款链接）与 `redirect` 安全校验（仅站内路径）、登出、私有路由守卫中间件，验证外站 redirect 被忽略、未登录访问 /dashboard 跳登录页并携带 redirect（user-auth：安全回跳/守卫）

## 5. 工作区：项目与对话构建

- [ ] 5.1 建立 Prisma + SQLite 数据层（users/projects/messages）与项目 CRUD API（按 owner 隔离），验证用第二账号访问他人项目返回 404（workspace-projects：访问隔离）
- [ ] 5.2 实现 /dashboard 项目列表（按更新时间倒序、空状态引导、删除二次确认），验证确认删除后项目与对话路由均 404、取消删除无变化（workspace-projects）
- [ ] 5.3 实现 /chat/[id] 消息流界面与历史读取 API，验证刷新或重新进入后消息按原顺序完整恢复（chat-build：历史持久化）
- [ ] 5.4 实现 /api/projects/[id]/chat 流式接口（SSE、服务端消息先落库、项目内串行队列、失败返回可重试错误），验证流式逐块渲染、生成中状态、失败重试后正常追加（chat-build）
- [ ] 5.5 打通全链路转化：未登录首页提交需求 → 登录 → 携需求建项目进对话页；预览弹窗克隆 → 登录 → 建项目，按此脚本手工端到端验证一遍（marketing-site + workspace-projects 集成）

## 6. 集成验收

- [ ] 6.1 运行 `npm run build` 并冒烟全部路由（营销页与内容页 200、私有路由重定向、sitemap 可达），构建输出无错误
- [ ] 6.2 编写 README（本地启动步骤、环境变量清单、内容数据文件格式与新增条目方法），按 README 命令从零启动成功
- [ ] 6.3 对照五个 spec 的全部 Scenario 逐条验收并记录结果，全部通过

## Workflow follow-up

- 实现完成后经用户确认，运行 openspec archive 归档本变更并验证归档结果
