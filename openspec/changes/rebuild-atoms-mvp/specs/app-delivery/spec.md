# Spec Delta

## Purpose

定义产品交付能力：用户在工作区通过 App Viewer 预览自己的应用（桌面/移动视口），并可一键把项目发布为匿名可访问的公开 URL——用户由此获得并分享「自己的产品」。

## ADDED Requirements

### Requirement: App Viewer 预览
工作区 MUST 为每个项目提供应用预览（App Viewer）：以沙箱 iframe 渲染当前版本，并 MUST 支持桌面与移动两种视口切换。预览 MUST 始终显示当前版本。

#### Scenario: 预览反映当前版本
- **WHEN** 用户在某轮构建成功后打开 App Viewer
- **THEN** 预览渲染的是最新成功版本

#### Scenario: 切换视口
- **WHEN** 用户在 App Viewer 中切换到移动视口
- **THEN** 预览以移动端宽度渲染产物

### Requirement: 发布为公开 URL
项目 MUST 支持发布：发布后生成一个站内公开 URL（无需登录即可访问，地址 MUST 含不可预测的随机标识），该 URL 渲染项目当前版本。未发布或已取消发布的项目 MUST 不可公开访问。

#### Scenario: 发布并匿名访问
- **WHEN** 用户发布项目后以其公开 URL 匿名访问
- **THEN** 浏览器完整渲染该项目的当前版本应用

#### Scenario: 未发布不可访问
- **WHEN** 访问一个未发布项目的公开地址
- **THEN** 系统返回 404

#### Scenario: 迭代后再发布更新
- **WHEN** 项目在发布后经历新的成功构建并再次发布
- **THEN** 同一公开 URL 展示更新后的版本

#### Scenario: 取消发布
- **WHEN** 用户取消已发布项目的发布
- **THEN** 其公开 URL 返回 404，项目在工作区仍可用

### Requirement: 交付入口
项目列表 MUST 提供打开 App Viewer 的入口；已发布项目 MUST 同时提供公开链接入口。对话页 MUST 能直接切换查看 App Viewer。

#### Scenario: 从列表直达预览
- **WHEN** 用户在项目列表点击预览入口
- **THEN** 直接打开该项目 App Viewer 并渲染当前版本
