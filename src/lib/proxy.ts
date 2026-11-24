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

/** 注入到产物 HTML <head> 的前缀垫片：路径前缀兼容 + 沙箱存储兜底 + 预览错误上报 */
function shimScript(prefix: string): string {
  return `<script>(function(){var BASE=${JSON.stringify(prefix)};function fix(u){try{if(typeof u==="string"&&u.charAt(0)==="/"&&u.charAt(1)!=="/"&&u.indexOf(BASE+"/")!==0&&u!==BASE)return BASE+u;}catch(e){}return u;}
var of=window.fetch?window.fetch.bind(window):null;if(of){window.fetch=function(input,init){if(typeof input==="string")return of(fix(input),init);if(input&&input.url){try{var u=new URL(input.url);if(u.origin===location.origin&&u.pathname.charAt(0)==="/"&&u.pathname.indexOf(BASE+"/")!==0){return of(BASE+u.pathname+u.search,init);}}catch(e){}}return of(input,init);};}
var ox=XMLHttpRequest.prototype.open;XMLHttpRequest.prototype.open=function(m,url){if(typeof url==="string")arguments[1]=fix(url);return ox.apply(this,arguments);};
if(window.EventSource){var oes=window.EventSource;window.EventSource=function(u,o){return new oes(fix(u),o);};}
function memStore(){var m={};return{get length(){return Object.keys(m).length;},key:function(i){return Object.keys(m)[i]||null;},getItem:function(k){return k in m?m[k]:null;},setItem:function(k,v){m[k]=String(v);},removeItem:function(k){delete m[k];},clear:function(){m={};}};}
try{if(self.origin==="null"){try{void window.localStorage.getItem("x");}catch(e){Object.defineProperty(window,"localStorage",{value:memStore()});Object.defineProperty(window,"sessionStorage",{value:memStore()});}try{void document.cookie;}catch(e){Object.defineProperty(document,"cookie",{get:function(){return"";},set:function(){}});}}}
catch(e){}
if(window.self!==window.top){var report=function(msg){try{window.top.postMessage({__atomsPreviewError:String(msg).slice(0,500)},"*");}catch(e){}};window.addEventListener("error",function(e){report((e.message||"")+" @ "+(e.filename||"")+":"+(e.lineno||""));},true);window.addEventListener("unhandledrejection",function(e){report("unhandledrejection: "+((e.reason&&e.reason.message)||e.reason));});try{window.top.postMessage({__atomsPreviewReady:location.pathname},"*");}catch(e){}}} )();</script>`;
}

/** 重写 HTML 中的根绝对路径引用（src/href/action="/x" → prefix + "/x"），注入 base 与垫片 */
function rewriteHtml(html: string, prefix: string): string {
  let out = html.replace(
    /(\s(?:src|href|action)=")\/(?!\/)/g,
    `$1${prefix}/`
  );
  // 顺带处理单引号写法
  out = out.replace(/(\s(?:src|href|action)=')\/(?!\/)/g, `$1${prefix}/`);
  // base 统一相对路径基准（/p/{slug} 无尾斜杠时浏览器会相对父目录解析）
  const baseTag = `<base href="${prefix}/">`;
  const shim = shimScript(prefix);
  const headOpen = /<head[^>]*>/i.exec(out);
  if (headOpen) {
    const at = headOpen.index + headOpen[0].length;
    out = out.slice(0, at) + baseTag + shim + out.slice(at);
  } else if (/<html[^>]*>/i.test(out)) {
    out = out.replace(/<html[^>]*>/i, (m) => m + baseTag + shim);
  } else {
    out = baseTag + shim + out;
  }
  return out;
}

/**
 * 纯 fetch 反向代理：将请求透传到项目运行时端口（targetPath 已剥离平台前缀）。
 * HTML 响应会重写根绝对路径并注入前缀垫片，使产物在路径前缀托管下正常工作。
 * 注意：不支持 WebSocket 升级（demo 已知限制）。
 */
export async function proxyToRuntime(
  req: Request,
  projectId: string,
  targetPath: string,
  prefix: string
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
    const contentType = upstream.headers.get("content-type") ?? "";
    const isHtml = contentType.includes("text/html");

    const respHeaders = new Headers();
    upstream.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (
        !HOP_BY_HOP.has(lower) &&
        lower !== "content-encoding" &&
        !(isHtml && lower === "content-length")
      ) {
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

    if (isHtml && req.method !== "HEAD") {
      const html = await upstream.text();
      return new Response(rewriteHtml(html, prefix), {
        status: upstream.status,
        headers: respHeaders,
      });
    }

    return new Response(upstream.body, {
      status: upstream.status,
      headers: respHeaders,
    });
  } catch {
    return new Response("project runtime unreachable", { status: 502 });
  }
}