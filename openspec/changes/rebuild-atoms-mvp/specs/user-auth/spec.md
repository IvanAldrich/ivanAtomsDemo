# Spec Delta

## Purpose

定义 demo 级认证与会话能力：登录页输入邮箱即可完成登录或注册（无第二因子，仅用于演示），会话在私有路由间保持并支持安全回跳。生产级认证（OAuth、验证码）由后续变更引入。

## ADDED Requirements

### Requirement: 邮箱即登录
登录页 MUST 接受一个邮箱地址即可完成认证：已注册邮箱直接登录；未注册邮箱自动创建账户并登录。系统 MUST 在界面上标明这是演示级登录方式。

#### Scenario: 新邮箱自动注册
- **WHEN** 用户在登录页输入未注册邮箱并提交
- **THEN** 系统创建新账户、建立会话并进入回跳目标页

#### Scenario: 已注册邮箱登录
- **WHEN** 用户输入已注册邮箱并提交
- **THEN** 系统建立该用户会话并进入回跳目标页

### Requirement: 安全回跳
登录入口 MUST 支持携带站内 `redirect` 参数，登录成功后 MUST 跳转该地址。redirect MUST 仅接受站内相对路径，外站地址 MUST 被忽略并回退到默认页。

#### Scenario: 登录后回跳来源页
- **WHEN** 用户从私有路由被引导到登录页后完成登录
- **THEN** 系统跳回该私有路由

#### Scenario: 拒绝外站 redirect
- **WHEN** 登录请求携带外站 URL 作为 redirect 参数
- **THEN** 系统忽略该参数并在登录后跳转默认页

### Requirement: 会话保持与登出
登录用户的会话 MUST 在浏览器会话间保持。用户 MUST 能从工作区登出，登出后 MUST 清除会话并返回营销站首页。

#### Scenario: 登出
- **WHEN** 已登录用户点击登出
- **THEN** 会话失效，访问私有路由重新要求登录

### Requirement: 私有路由守卫
未登录用户访问私有路由（我的项目、项目对话、个人资料）时 MUST 被重定向到登录页并携带该路由的 redirect 参数。

#### Scenario: 未登录访问私有路由
- **WHEN** 未登录用户直接访问项目对话路由
- **THEN** 系统重定向到登录页，URL 携带原路由 redirect
