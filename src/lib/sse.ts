import { buildQueue } from "./queue";
import type { BuildEvent } from "./build/orchestrator";

/**
 * 构造某条消息触发的构建轮 SSE 响应。
 * 先订阅再执行 enqueueFn（单进程内保证不丢首事件）。
 */
export function roundSseResponse(
  projectId: string,
  messageId: string,
  enqueueFn: () => void
): Response {
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      let closed = false;
      const send = (ev: BuildEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch {
          closed = true;
          return;
        }
        if (ev.type === "round-end") {
          closed = true;
          unsubscribe?.();
          try {
            controller.close();
          } catch {
            /* already closed */
          }
        }
      };
      send({ type: "stage", stage: "queued" });
      unsubscribe = buildQueue.subscribe(projectId, messageId, send);
      enqueueFn();
    },
    cancel() {
      unsubscribe?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}
