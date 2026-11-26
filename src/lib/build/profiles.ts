import type { ModuleEntry } from "./manifest";

export type Profile = {
  name: string;
  description: string;
  modules: ModuleEntry[];
};

export const PROFILES: Record<string, Profile> = {
  "generic-webapp": {
    name: "generic-webapp",
    description: "通用网站/Web 应用：任意页面 + 可选 API + JSON 持久化",
    modules: [
      { path: "public/index.html", role: "entry-html", exports: [], deps: [], maxKB: 4 },
      { path: "public/styles.css", role: "styles", exports: [], deps: [], maxKB: 8 },
      { path: "public/app.js", role: "ui", exports: [], deps: [], maxKB: 10 },
      { path: "server.js", role: "server", exports: [], deps: ["./src/routes.js"], maxKB: 8 },
      { path: "src/routes.js", role: "http-routes", exports: ["handle(req, res)"], deps: ["./store.js"], maxKB: 8 },
      { path: "src/store.js", role: "storage", exports: ["readAll()", "writeAll(items)"], deps: [], maxKB: 6 },
    ],
  },
  "browser-game": {
    name: "browser-game",
    description: "浏览器小游戏：canvas 渲染、游戏循环、输入、实体与 HUD（模块精简以减少跨文件契约面）",
    modules: [
      { path: "public/index.html", role: "entry-html", exports: [], deps: [], maxKB: 4 },
      { path: "public/styles.css", role: "styles", exports: [], deps: [], maxKB: 8 },
      { path: "public/src/engine.js", role: "game-loop", exports: ["createEngine(canvas)", "start()", "pause()", "restart()"], deps: ["./input.js"], maxKB: 14 },
      { path: "public/src/input.js", role: "input", exports: ["bindInput(engine)"], deps: [], maxKB: 6 },
      { path: "public/src/main.js", role: "bootstrap", exports: ["bootstrap()"], deps: ["./engine.js"], maxKB: 6 },
      { path: "public/src/storage.js", role: "storage", exports: ["loadSave()", "saveGame(state)"], deps: [], maxKB: 4 },
      { path: "server.js", role: "server", exports: [], deps: [], maxKB: 6 },
    ],
  },
  "crud-app": {
    name: "crud-app",
    description: "单页 CRUD：Node 服务 + REST API + JSON 持久化 + 静态前端",
    modules: [
      { path: "public/index.html", role: "entry-html", exports: [], deps: [], maxKB: 4 },
      { path: "public/styles.css", role: "styles", exports: [], deps: [], maxKB: 8 },
      { path: "public/app.js", role: "ui", exports: [], deps: [], maxKB: 10 },
      { path: "server.js", role: "server", exports: [], deps: ["./src/routes.js", "./src/store.js"], maxKB: 8 },
      { path: "src/routes.js", role: "http-routes", exports: ["handle(req, res)"], deps: ["./store.js"], maxKB: 8 },
      { path: "src/store.js", role: "storage", exports: ["readAll()", "writeAll(items)"], deps: [], maxKB: 6 },
    ],
  },
  dashboard: {
    name: "dashboard",
    description: "工作台/仪表盘：多视图、本地状态、持久化",
    modules: [
      { path: "public/index.html", role: "entry-html", exports: [], deps: [], maxKB: 4 },
      { path: "public/styles/base.css", role: "base-styles", exports: [], deps: [], maxKB: 6 },
      { path: "public/styles/dashboard.css", role: "dashboard-styles", exports: [], deps: [], maxKB: 6 },
      { path: "public/src/main.js", role: "bootstrap", exports: ["bootstrap()"], deps: ["./views/dashboard.js"], maxKB: 4 },
      { path: "public/src/views/dashboard.js", role: "view", exports: ["renderDashboard(state)"], deps: ["../services/storage.js"], maxKB: 10 },
      { path: "public/src/services/storage.js", role: "storage", exports: ["loadState()", "saveState(state)"], deps: [], maxKB: 5 },
      { path: "server.js", role: "server", exports: [], deps: [], maxKB: 8 },
    ],
  },
  "landing-page": {
    name: "landing-page",
    description: "营销落地页：静态页面 + 少量交互",
    modules: [
      { path: "public/index.html", role: "entry-html", exports: [], deps: [], maxKB: 4 },
      { path: "public/styles.css", role: "styles", exports: [], deps: [], maxKB: 8 },
      { path: "public/app.js", role: "interaction", exports: [], deps: [], maxKB: 6 },
      { path: "server.js", role: "server", exports: [], deps: [], maxKB: 5 },
    ],
  },
  "api-service": {
    name: "api-service",
    description: "无前端的 REST API 服务 + 持久化",
    modules: [
      { path: "server.js", role: "server", exports: [], deps: ["./src/routes.js"], maxKB: 8 },
      { path: "src/routes.js", role: "http-routes", exports: ["handle(req, res)"], deps: ["./store.js"], maxKB: 8 },
      { path: "src/store.js", role: "storage", exports: ["readAll()", "writeAll(items)"], deps: [], maxKB: 6 },
      { path: "src/validate.js", role: "validation", exports: ["validate(input)"], deps: [], maxKB: 4 },
    ],
  },
};

const DEFAULT_PROFILE = "generic-webapp";

export function profileForName(name: string): Profile {
  return PROFILES[name] ?? PROFILES[DEFAULT_PROFILE];
}

export function selectProfile(requirement: string): Profile {
  const text = requirement.toLowerCase();
  if (/(游戏|小游戏|game|贪吃蛇|俄罗斯方块|打飞机|跑酷|消除|塔防|射击|冒险)/.test(text)) {
    return PROFILES["browser-game"];
  }
  if (/(落地页|官网|landing|营销页|主页介绍)/.test(text)) {
    return PROFILES["landing-page"];
  }
  if (/(api|接口服务|webhook|只提供接口|后端服务)/.test(text)) {
    return PROFILES["api-service"];
  }
  if (/(工作台|仪表盘|dashboard|看板|番茄|知识库|笔记)/.test(text)) {
    return PROFILES["dashboard"];
  }
  if (/(增删改查|crud|管理后台|后台管理|记账|清单|列表管理)/.test(text)) {
    return PROFILES["crud-app"];
  }
  // 任意网站/Web 应用：使用通用站点 Profile，可通过新增 Profile 继续扩展
  return PROFILES[DEFAULT_PROFILE];
}

export function profilePrompt(profile: Profile): string {
  return [
    `推荐架构 Profile：${profile.name}（${profile.description}）`,
    "建议模块骨架（可增删，但必须保持职责单一与预算）：",
    ...profile.modules.map(
      (m) =>
        `- ${m.path} — ${m.role}` +
        (m.exports.length ? `；exports: ${m.exports.join(", ")}` : "") +
        `；≤${m.maxKB ?? 10}KB`
    ),
  ].join("\n");
}