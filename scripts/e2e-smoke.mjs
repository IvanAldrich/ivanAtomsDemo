const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const timeoutMs = Number(process.env.E2E_TIMEOUT_MS ?? 120_000);
const email = `e2e-${Date.now()}@example.com`;
const password = "e2e-password-123";

function cookieFrom(res) {
  const raw = res.headers.getSetCookie?.()[0] ?? res.headers.get("set-cookie");
  if (!raw) throw new Error("auth response did not set a session cookie");
  return raw.split(";")[0];
}

async function waitForHealth() {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${base}/api/health`, {
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error("health check timeout");
}

async function main() {
  await waitForHealth();

  const register = await fetch(`${base}/api/auth/register`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!register.ok) throw new Error(`register failed: HTTP ${register.status}`);
  cookieFrom(register);

  const badLogin = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password: "wrong-password" }),
  });
  if (badLogin.status !== 401) {
    throw new Error(`wrong password should be 401, got ${badLogin.status}`);
  }

  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!login.ok) throw new Error(`login failed: HTTP ${login.status}`);
  const cookie = cookieFrom(login);

  // 跨源写操作必须被 middleware 拒绝
  const crossOrigin = await fetch(`${base}/api/projects`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      origin: "https://evil.example",
      cookie,
    },
    body: JSON.stringify({ title: "csrf-should-fail" }),
  });
  if (crossOrigin.status !== 403) {
    throw new Error(`cross-origin write should be 403, got ${crossOrigin.status}`);
  }

  const create = await fetch(`${base}/api/projects`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie },
    body: JSON.stringify({ title: "e2e-smoke" }),
  });
  if (!create.ok) throw new Error(`create failed: HTTP ${create.status}`);
  const { project } = await create.json();
  let cleaned = false;

  try {
    const chat = await fetch(`${base}/api/projects/${project.id}/chat`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie },
      body: JSON.stringify({ content: "make a landing page" }),
    });
    if (!chat.ok) throw new Error(`chat failed: HTTP ${chat.status}`);
    if (!(chat.headers.get("content-type") ?? "").includes("text/event-stream")) {
      throw new Error("chat did not return SSE");
    }

    const reader = chat.body.getReader();
    const decoder = new TextDecoder();
    const events = [];
    let buffer = "";
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx;
      while ((idx = buffer.indexOf("\n\n")) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        if (!chunk.startsWith("data: ")) continue;
        events.push(JSON.parse(chunk.slice(6)));
      }
      if (events.some((e) => e.type === "round-end")) break;
    }

    const success = events.some(
      (e) => e.type === "stage" && e.stage === "success"
    );
    const done = events.find((e) => e.type === "done");
    if (!success || !done?.ok) {
      throw new Error(
        `build did not succeed; events=${JSON.stringify(events.slice(-5))}`
      );
    }

    const messages = await fetch(
      `${base}/api/projects/${project.id}/messages`,
      { headers: { cookie } }
    );
    const data = await messages.json();
    const assistant = (data.messages ?? []).find((m) => m.role === "assistant");
    if (!assistant || assistant.buildStatus !== "success") {
      throw new Error("assistant message did not reach success");
    }

    console.log(
      `[e2e] passed: project=${project.id} events=${events.length} last=${events.at(-1)?.type}`
    );
  } finally {
    const del = await fetch(`${base}/api/projects/${project.id}`, {
      method: "DELETE",
      headers: { cookie },
    }).catch(() => null);
    cleaned = Boolean(del?.ok);
    if (!cleaned) console.error("[e2e] cleanup failed; project:", project.id);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[e2e] failed:", err);
    process.exit(1);
  });