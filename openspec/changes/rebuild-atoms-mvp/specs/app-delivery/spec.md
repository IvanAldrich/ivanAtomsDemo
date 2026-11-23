# Spec Delta

## Purpose

定义产品交付能力：构建产物以每项目独立运行时运行（与宿主及彼此隔离），平台通过反向代理分配公开 URL，用户一键上线、迭代更新、可停止分享——用户由此获得「自己的产品」。

## ADDED Requirements

### Requirement: 每项目独立运行时
已发布项目的应用 MUST 在独立于宿主平台的运行时中运行（容器或受限进程），项目应用崩溃 MUST 不影响宿主平台与其他项目。

#### Scenario: 项目崩溃不影响平台
- **WHEN** 某已发布项目进程崩溃
- **THEN** 宿主平台与其他项目正常运行

### Requirement: 发布与公开 URL
项目 MUST 支持发布：发布后系统 MUST 启动其当前版本的运行时，并通过平台反向代理在公开 URL（含不可预测随机标识）提供服务，匿名访问者 MUST 能完整使用该应用（含前端、后端接口与数据持久化）。未发布或已停止的项目 MUST 不可公开访问。

#### Scenario: 发布并匿名完整使用
- **WHEN** 用户发布项目后以其公开 URL 匿名访问
- **THEN** 前端页面、后端接口与数据读写全部可用（如注册账号后数据可持久）

#### Scenario: 未发布不可访问
- **WHEN** 访问一个未发布项目的公开地址
- **THEN** 系统返回 404

#### Scenario: 取消发布
- **WHEN** 用户取消已发布项目的发布
- **THEN** 其公开 URL 返回 404，运行时停止，项目在工作区仍可用

### Requirement: 迭代更新上线
项目在发布后经历新版本构建成功并再次发布时，系统 MUST 以新版本替换运行时，同一公开 URL MUST 服务新版本，替换期间失败 MUST 回滚保持旧版本在线。

#### Scenario: 迭代后再发布
- **WHEN** 已发布项目完成新一轮构建并再发布
- **THEN** 同一公开 URL 展示新版本功能

#### Scenario: 更新失败回滚
- **WHEN** 新版本启动验证失败且未能修复
- **THEN** 公开 URL 继续服务上一在线版本

### Requirement: App Viewer 预览
工作区 MUST 为每个项目提供 App Viewer：以沙箱 iframe 经平台代理加载该项目当前版本的运行时，MUST 支持桌面与移动视口切换，预览 MUST 始终指向当前版本。

#### Scenario: 预览代理到运行时
- **WHEN** 用户打开某项目的 App Viewer
- **THEN** iframe 通过平台代理加载当前版本运行时，应用可完整交互

#### Scenario: 切换视口
- **WHEN** 用户在 App Viewer 中切换到移动视口
- **THEN** 预览以移动端宽度渲染

### Requirement: 交付入口
项目列表 MUST 提供打开 App Viewer 的入口；已发布项目 MUST 同时提供公开链接入口。对话页 MUST 能直接切换查看 App Viewer 与构建状态。

#### Scenario: 从列表直达预览
- **WHEN** 用户在项目列表点击预览入口
- **THEN** 直接打开该项目 App Viewer 并加载当前版本
