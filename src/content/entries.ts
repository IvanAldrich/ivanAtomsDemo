import { z } from "zod";

const entrySchema = z.object({
  slug: z.string().min(1).max(80).regex(/^[a-z0-9-]+$/),
  category: z.enum([
    "models",
    "usecases",
    "comparison",
    "prompts",
    "discover",
    "templates",
  ]),
  status: z.enum(["published", "draft"]),
  provider: z.string().optional(),
  topic: z.string().optional(),
  title: z.object({ zh: z.string(), en: z.string() }),
  subtitle: z.object({ zh: z.string(), en: z.string() }),
  body: z.object({ zh: z.string(), en: z.string() }),
});

export type ContentEntry = z.infer<typeof entrySchema>;

const ENTRIES: ContentEntry[] = [
  // —— 模型（4，含 1 草稿）——
  {
    slug: "reasoning-coder",
    category: "models",
    status: "published",
    provider: "OpenAI-compatible",
    title: { zh: "Reasoning Coder", en: "Reasoning Coder" },
    subtitle: {
      zh: "面向复杂工程与多步推理的编程模型",
      en: "A coding model for complex engineering and multi-step reasoning",
    },
    body: {
      zh: "适合工程结构设计、跨文件修改与疑难排查。在本平台中作为默认生成模型，输出严格遵循文件协议，适合首次构建与深度迭代。",
      en: "Best for project structure design, cross-file changes and tricky debugging. The default generation model on this platform; follows the file protocol strictly for first builds and deep iterations.",
    },
  },
  {
    slug: "fast-coder",
    category: "models",
    status: "published",
    provider: "OpenAI-compatible",
    title: { zh: "Fast Coder", en: "Fast Coder" },
    subtitle: {
      zh: "低延迟日常编码模型",
      en: "Low-latency everyday coding model",
    },
    body: {
      zh: "适合小改动、文案调整与快速原型。延迟低、成本低，可用作竞速对比的基线模型。",
      en: "Great for small edits, copy tweaks and quick prototypes. Low latency and cost; a good baseline for race-mode comparisons.",
    },
  },
  {
    slug: "vision-coder",
    category: "models",
    status: "published",
    provider: "Anthropic-compatible",
    title: { zh: "Vision Coder", en: "Vision Coder" },
    subtitle: {
      zh: "带视觉反馈的多模态编程模型",
      en: "Multimodal coding model with visual feedback",
    },
    body: {
      zh: "可读取界面截图做视觉反馈迭代，适合样式还原与 UI 打磨场景。",
      en: "Reads UI screenshots for visual-feedback iteration; ideal for pixel work and UI polishing.",
    },
  },
  {
    slug: "video-generator",
    category: "models",
    status: "draft",
    provider: "ByteDance-compatible",
    title: { zh: "Video Generator", en: "Video Generator" },
    subtitle: { zh: "文生视频（接入中）", en: "Text to video (in integration)" },
    body: { zh: "草稿：视频生成能力规划中。", en: "Draft: video generation is planned." },
  },
  // —— 用例（3）——
  {
    slug: "landing-page-builder",
    category: "usecases",
    status: "published",
    title: { zh: "AI 落地页构建器", en: "AI landing page builder" },
    subtitle: {
      zh: "一句话得到转化导向的产品官网",
      en: "A conversion-focused site from one sentence",
    },
    body: {
      zh: "描述你的受众与行动召唤，AI 工程师生成 hero、特性、定价与 CTA 的完整页面，并直接通过启动验证。构建后可继续对话微调文案与布局，发布为公开链接用于投放。",
      en: "Describe your audience and call to action; the AI engineer generates hero, features, pricing and CTA sections that pass start validation. Keep chatting to refine copy and layout, then publish a public link for campaigns.",
    },
  },
  {
    slug: "internal-tool-builder",
    category: "usecases",
    status: "published",
    title: { zh: "内部工具构建器", en: "Internal tool builder" },
    subtitle: {
      zh: "审批、库存、报表类工具当天可用",
      en: "Approval, inventory and reporting tools ready same-day",
    },
    body: {
      zh: "把流程描述清楚（角色、状态、字段），生成的工程自带后端接口与数据存储，验证通过即可分享给同事使用。",
      en: "Describe the flow (roles, states, fields); the generated project ships with backend APIs and storage, ready to share with teammates after validation.",
    },
  },
  {
    slug: "browser-game-builder",
    category: "usecases",
    status: "published",
    title: { zh: "浏览器游戏构建器", en: "Browser game builder" },
    subtitle: {
      zh: "玩法描述即得可试玩初版",
      en: "A playable first version from a gameplay description",
    },
    body: {
      zh: "说清玩法、操作与得分规则，即可得到开箱即玩的小游戏；边玩边提修改，重建后即刻更新。",
      en: "Describe the mechanics, controls and scoring to get a playable mini game; iterate while playing and rebuild to update instantly.",
    },
  },
  // —— 对比（3）——
  {
    slug: "vs-template-market",
    category: "comparison",
    status: "published",
    title: { zh: "对比模板市场", en: "vs. template marketplaces" },
    subtitle: {
      zh: "自由生成 vs 挑模板改模板",
      en: "Free generation vs. picking and editing templates",
    },
    body: {
      zh: "模板市场给你固定的起点，改到满意需要懂代码；本平台按你的需求自由生成工程结构，迭代也用自然语言完成。模板适合极标准的需求，自由生成适合『我的产品长这样』。",
      en: "Template markets give a fixed starting point and editing requires code knowledge; this platform generates the project structure from your need and iterates in natural language. Templates fit ultra-standard needs; free generation fits 'my product looks like this'.",
    },
  },
  {
    slug: "vs-lowcode",
    category: "comparison",
    status: "published",
    title: { zh: "对比低代码平台", en: "vs. low-code platforms" },
    subtitle: {
      zh: "完整代码所有权 vs 平台锁定",
      en: "Full code ownership vs. platform lock-in",
    },
    body: {
      zh: "低代码平台把逻辑锁在拖拽画布与私有运行时里；本平台的产物是标准 Node/npm 工程，随时可导出走自己的基础设施。你拥有的是代码，不是账号。",
      en: "Low-code locks logic into drag-drop canvases and proprietary runtimes; the artifact here is a standard Node/npm project you can export and host anywhere. You own code, not an account.",
    },
  },
  {
    slug: "vs-pure-chat",
    category: "comparison",
    status: "published",
    title: { zh: "对比纯聊天助手", en: "vs. plain chat assistants" },
    subtitle: {
      zh: "可运行可发布 vs 代码片段",
      en: "Runnable and publishable vs. code snippets",
    },
    body: {
      zh: "聊天助手给你片段，还要自己装环境跑起来；本平台在沙箱里安装、构建、启动验证并部署，对话结束你拿到的是能访问的产品。",
      en: "Chat assistants hand you snippets to run yourself; this platform installs, builds, validates and deploys in the sandbox — the conversation ends with a product you can visit.",
    },
  },
  // —— 提示词（3）——
  {
    slug: "prompt-landing",
    category: "prompts",
    status: "published",
    topic: "landing",
    title: { zh: "落地页提示词", en: "Landing page prompt" },
    subtitle: { zh: "结构化描述受众与转化目标", en: "Structure audience and conversion goals" },
    body: {
      zh: "「为 [产品] 做落地页：受众是 [人群]，核心痛点 [三点]，主 CTA [动作]，风格 [关键词]，包含 hero、三个特性、定价表与 FAQ。」",
      en: "\"Build a landing page for [product]: audience [who], core pains [three], primary CTA [action], style [keywords], including hero, three features, pricing and FAQ.\"",
    },
  },
  {
    slug: "prompt-tool",
    category: "prompts",
    status: "published",
    topic: "tool",
    title: { zh: "内部工具提示词", en: "Internal tool prompt" },
    subtitle: { zh: "说清角色、状态与字段", en: "State roles, states and fields" },
    body: {
      zh: "「做 [工具名]：用户分 [角色]，数据字段 [清单]，操作流程 [步骤]，需要列表/筛选/导出，数据保存到服务端。」",
      en: "\"Build [tool]: users are [roles], fields are [list], flow is [steps], needs list/filter/export, data persisted server-side.\"",
    },
  },
  {
    slug: "prompt-game",
    category: "prompts",
    status: "published",
    topic: "game",
    title: { zh: "小游戏提示词", en: "Mini game prompt" },
    subtitle: { zh: "玩法、操作、得分规则三要素", en: "Mechanics, controls, scoring" },
    body: {
      zh: "「做浏览器小游戏：玩法 [躲避/收集/消除]，操作 [键盘/鼠标]，得分规则 [描述]，难度随时间提升，带最高分记录。」",
      en: "\"Build a browser mini game: mechanics [dodge/collect/match], controls [keyboard/mouse], scoring [rule], difficulty ramps up, keep a high score.\"",
    },
  },
  // —— 发现（3）——
  {
    slug: "team-standup-bot",
    category: "discover",
    status: "published",
    title: { zh: "每日站会机器人", en: "Daily standup bot" },
    subtitle: { zh: "团队打卡与汇总工具", en: "Team check-in and digest tool" },
    body: {
      zh: "团队成员提交昨日/今日/阻塞三项，机器人按频道汇总成站会纪要。含简单统计与导出。",
      en: "Team members submit yesterday/today/blockers; the bot digests them into standup notes with simple stats and export.",
    },
  },
  {
    slug: "habit-tracker",
    category: "discover",
    status: "published",
    title: { zh: "习惯打卡应用", en: "Habit tracker" },
    subtitle: { zh: "21 天习惯养成", en: "21-day habit building" },
    body: {
      zh: "自定义习惯列表、每日打卡、连续天数与完成率图表。数据保存在服务端。",
      en: "Custom habit list, daily check-ins, streaks and completion charts. Data persisted server-side.",
    },
  },
  {
    slug: "invoice-generator",
    category: "discover",
    status: "published",
    title: { zh: "发票生成器", en: "Invoice generator" },
    subtitle: { zh: "自由职业者记账工具", en: "Freelancer invoicing tool" },
    body: {
      zh: "录入客户与项目，生成可打印的发票页面，支持编号与状态管理。",
      en: "Enter clients and projects, print invoice pages, manage numbers and statuses.",
    },
  },
  // —— 模板（引用 6 个演示品类）——
  {
    slug: "template-landing",
    category: "templates",
    status: "published",
    topic: "landing",
    title: { zh: "SaaS 落地页模板", en: "SaaS landing template" },
    subtitle: { zh: "hero + 特性 + 定价 + CTA", en: "hero + features + pricing + CTA" },
    body: { zh: "转化导向结构，克隆后按需替换文案与配色。", en: "Conversion-focused structure; clone and swap copy and colors." },
  },
  {
    slug: "template-webapp",
    category: "templates",
    status: "published",
    topic: "app",
    title: { zh: "待办应用模板", en: "Todo app template" },
    subtitle: { zh: "增删改查起步结构", en: "CRUD starter structure" },
    body: { zh: "前后端与数据存储的最小完整示例。", en: "A minimal complete example with frontend, backend and storage." },
  },
  {
    slug: "template-portfolio",
    category: "templates",
    status: "published",
    topic: "site",
    title: { zh: "作品集模板", en: "Portfolio template" },
    subtitle: { zh: "瀑布流展示结构", en: "Masonry showcase structure" },
    body: { zh: "深色头部 + 网格作品墙。", en: "Dark header plus a project grid wall." },
  },
];

// —— 校验（启动即校验数据完整性）——
for (const e of ENTRIES) {
  entrySchema.parse(e);
}

export function publishedByCategory(
  category: ContentEntry["category"]
): ContentEntry[] {
  return ENTRIES.filter((e) => e.category === category && e.status === "published");
}

export function bySlug(
  category: ContentEntry["category"],
  slug: string
): ContentEntry | null {
  return (
    ENTRIES.find(
      (e) => e.category === category && e.slug === slug && e.status === "published"
    ) ?? null
  );
}

export function uniqueProviders(category: ContentEntry["category"]): string[] {
  return [
    ...new Set(
      publishedByCategory(category)
        .map((e) => e.provider)
        .filter((p): p is string => Boolean(p))
    ),
  ];
}

export function uniqueTopics(category: ContentEntry["category"]): string[] {
  return [
    ...new Set(
      publishedByCategory(category)
        .map((e) => e.topic)
        .filter((t): t is string => Boolean(t))
    ),
  ];
}

export function pickText(
  text: { zh: string; en: string },
  locale: string
): string {
  return locale === "en" ? text.en : text.zh;
}
