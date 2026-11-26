import { buildQueue } from "./queue";
import type { BuildEvent } from "./build/orchestrator";

const POLL_MS = 300;
const MAX_IDLE_MS = 20 * 60 * 1000;
const MAX_ENQUEUE_WAIT_MS = 10_000;

/**
 * 构造某条消息触发的构建轮 SSE 响应。
 * 事件由独立 worker 写入 BuildEvent 表，这里轮询回放；断线重连/多实例下不依赖进程内 EventEmitter。
 */
export function roundSseResponse(
  projectId: string,
  messageId: string,
  enqueueFn: () => void | Promise<void>
): Response {
  const encoder = new TextEncoder();
  let closed = false;
  let lastSeq = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const close = () => {
        if (closed) return;
        closed = true;
        if (timer) clearTimeout(timer);
        try {
          controller.close();
        } catch {
          /* already closed */
        }
      };
      const send = (ev: BuildEvent) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(ev)}\n\n`));
        } catch {
          closed = true;
          return;
        }
        if (ev.type === "round-end") close();
      };

      send({ type: "stage", stage: "queued" });
      const startedAt = Date.now();

      void (async () => {
        try {
          await enqueueFn();
        } catch (err) {
          send({
            type: "error",
            message: err instanceof Error ? err.message : "enqueue failed",
          });
          send({ type: "round-end" });
          close();
          return;
        }

        let lastActivity = Date.now();
        const tick = async () => {
          if (closed) return;
          try {
            const events = await buildQueue.eventsSince(messageId, lastSeq);
            for (const e of events) {
              lastSeq = e.seq;
              lastActivity = Date.now();
              send(e.event);
              if (closed) return;
            }
            const status = await buildQueue.jobStatus(messageId);
            if (status === "done") {
              send({ type: "round-end" });
              return;
            }
            if (status === "failed") {
              send({ type: "error", message: "构建失败，请查看对话中的失败原因" });
              send({ type: "round-end" });
              return;
            }
            if (!status && Date.now() - startedAt > MAX_ENQUEUE_WAIT_MS) {
              send({ type: "error", message: "构建任务未入队" });
              send({ type: "round-end" });
              return;
            }
            if (Date.now() - lastActivity > MAX_IDLE_MS) {
              send({ type: "error", message: "构建事件超时，请重试" });
              send({ type: "round-end" });
              return;
            }
          } catch {
            /* 瞬时 DB 错误：下一轮继续 */
          }
          timer = setTimeout(() => void tick(), POLL_MS);
        };
        void tick();
      })();
    },
    cancel() {
      closed = true;
      if (timer) clearTimeout(timer);
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