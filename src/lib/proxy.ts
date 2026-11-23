import { runtimeManager } from "./runtime/manager";

const HOP_BY_HOP = new Set([
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
]);

/**
 * 纯 fetch 反向代理：将请求透传到项目运行时端口（targetPath 已剥离平台前缀）。
 * 注意：不支持 WebSocket 升级（demo 已知限制）。
 */
export async function proxyToRuntime(
  req: Request,
  projectId: string,
  targetPath: string
): Promise<Response> {
  const port = runtimeManager.portFor(projectId);
  if (!port) {
    return new Response("project runtime not running", { status: 503 });
  }

  const url = new URL(req.url);
  const target = `http://127.0.0.1:${port}${targetPath}${url.search}`;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.set(key, value);
  });

  const init: RequestInit & { duplex?: "half" } = {
    method: req.method,
    headers,
  };
  if (!["GET", "HEAD"].includes(req.method)) {
    init.body = req.body;
    init.duplex = "half";
  }

  try {
    const upstream = await fetch(target, init);
    const respHeaders = new Headers();
    upstream.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (!HOP_BY_HOP.has(lower) && lower !== "content-encoding") {
        respHeaders.set(key, value);
      }
    });
    // 沙箱 iframe（不透明源）调用产物自身 API 需要 CORS；宿主 Cookie 不随跨源请求发送
    respHeaders.set("Access-Control-Allow-Origin", "*");
    respHeaders.set(
      "Access-Control-Allow-Methods",
      "GET, POST, PUT, PATCH, DELETE, OPTIONS"
    );
    const reqHeaders = req.headers.get("access-control-request-headers");
    if (reqHeaders) {
      respHeaders.set("Access-Control-Allow-Headers", reqHeaders);
    }
    if (req.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: respHeaders });
    }
    return new Response(upstream.body, {
      status: upstream.status,
      headers: respHeaders,
    });
  } catch {
    return new Response("project runtime unreachable", { status: 502 });
  }
}
