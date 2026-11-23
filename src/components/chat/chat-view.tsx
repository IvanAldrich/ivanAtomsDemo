"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Link } from "@/i18n/navigation";
import type { BuildEvent } from "@/lib/build/orchestrator";

type ChatMessage = {
  id: string;
  role: string;
  content: string;
  buildRound: number | null;
  buildStatus: string | null;
};

const IN_FLIGHT = new Set(["queued", "generating", "building", "repairing"]);

export function ChatView({
  projectId,
  projectTitle,
  initialMessages,
  initialStatus,
}: {
  projectId: string;
  projectTitle: string;
  initialMessages: ChatMessage[];
  initialStatus: string;
}) {
  const t = useTranslations("chat");
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [stage, setStage] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const refreshMessages = useCallback(async () => {
    const res = await fetch(`/api/projects/${projectId}/messages`);
    if (res.ok) {
      const data = (await res.json()) as { messages: ChatMessage[] };
      setMessages(data.messages);
    }
  }, [projectId]);

  // 兜底：进入页面时构建仍在进行（如从「新建项目」跳转而来），轮询至本轮结束
  useEffect(() => {
    if (!IN_FLIGHT.has(initialStatus)) return;
    setStage(initialStatus);
    const timer = setInterval(async () => {
      const res = await fetch(`/api/projects/${projectId}/messages`);
      if (!res.ok) return;
      const data = (await res.json()) as { messages: ChatMessage[] };
      setMessages(data.messages);
      const lastUser = [...data.messages].reverse().find((m) => m.role === "user");
      if (!lastUser || !IN_FLIGHT.has(lastUser.buildStatus ?? "")) {
        setStage((s) => (s === initialStatus ? null : s));
        clearInterval(timer);
      }
    }, 1500);
    return () => clearInterval(timer);
  }, [initialStatus, projectId]);

  const readStream = useCallback(
    async (res: Response) => {
      const reader = res.body!.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf("\n\n")) >= 0) {
          const chunk = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          if (!chunk.startsWith("data: ")) continue;
          let ev: BuildEvent;
          try {
            ev = JSON.parse(chunk.slice(6));
          } catch {
            continue;
          }
          if (ev.type === "stage") {
            setStage(ev.stage);
            if (ev.stage === "success" || ev.stage === "failed") {
              await refreshMessages();
            }
          } else if (ev.type === "log") {
            setLogs((prev) => [...prev, ev.text]);
          } else if (ev.type === "error") {
            setLogs((prev) => [...prev, `ERROR: ${ev.message}`]);
          }
        }
      }
    },
    [refreshMessages]
  );

  async function send() {
    const content = input.trim();
    if (!content || sending) return;
    setInput("");
    setSending(true);
    setStage("queued");
    setLogs([]);
    // 乐观插入用户消息
    setMessages((prev) => [
      ...prev,
      {
        id: `optimistic-${Date.now()}`,
        role: "user",
        content,
        buildRound: null,
        buildStatus: "queued",
      },
    ]);
    try {
      const res = await fetch(`/api/projects/${projectId}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (!res.ok || !res.body) {
        setStage("failed");
        await refreshMessages();
        return;
      }
      await readStream(res);
    } catch {
      setStage("failed");
    } finally {
      setSending(false);
      setStage(null);
      messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }

  async function retry(messageId: string) {
    if (retryingId || sending) return;
    setRetryingId(messageId);
    setStage("queued");
    setLogs([]);
    try {
      const res = await fetch(`/api/projects/${projectId}/chat/retry`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messageId }),
      });
      if (res.ok && res.body) {
        await readStream(res);
      }
    } finally {
      setRetryingId(null);
      setStage(null);
    }
  }

  return (
    <div className="mx-auto flex h-[calc(100vh-3.5rem)] max-w-3xl flex-col px-4">
      <div className="flex items-center gap-3 border-b border-neutral-200 py-3">
        <Link
          href="/dashboard"
          className="rounded-md border border-neutral-200 px-2.5 py-1 text-sm text-neutral-600 hover:border-neutral-300"
        >
          ← {t("backToProjects")}
        </Link>
        <h1 className="truncate text-base font-semibold text-neutral-900">
          {projectTitle}
        </h1>
      </div>

      <div className="flex-1 space-y-4 overflow-y-auto py-6">
        {messages.map((m) => (
          <div
            key={m.id}
            className={m.role === "user" ? "flex justify-end" : "flex"}
          >
            <div
              className={
                m.role === "user"
                  ? "max-w-[85%] rounded-2xl bg-brand-600 px-4 py-2.5 text-sm text-white"
                  : "max-w-[85%] rounded-2xl border border-neutral-200 bg-white px-4 py-2.5 text-sm whitespace-pre-wrap text-neutral-800"
              }
            >
              <p className="mb-1 text-xs opacity-60">
                {m.role === "user" ? t("you") : t("engineer")}
              </p>
              {m.content}
              {m.role === "user" && m.buildStatus === "failed" && (
                <div className="mt-2">
                  <button
                    onClick={() => retry(m.id)}
                    disabled={retryingId === m.id}
                    className="rounded-md bg-red-50 px-3 py-1 text-xs font-medium text-red-600 hover:bg-red-100 disabled:opacity-60"
                  >
                    {retryingId === m.id ? t("retrying") : t("retry")}
                  </button>
                </div>
              )}
            </div>
          </div>
        ))}

        {(stage || logs.length > 0) && (
          <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-3 text-sm">
            {stage && (
              <div className="flex items-center gap-2 text-neutral-700">
                {stage !== "success" && stage !== "failed" && (
                  <span className="h-2 w-2 animate-pulse rounded-full bg-amber-500" />
                )}
                <span className="font-medium">{t(`stage.${stage}`)}</span>
              </div>
            )}
            {logs.length > 0 && (
              <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-neutral-500">
                {logs.join("\n")}
              </pre>
            )}
            {stage === "failed" && (
              <p className="mt-2 text-xs text-red-600">{t("failedRoundHint")}</p>
            )}
          </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      <div className="border-t border-neutral-200 py-4">
        <div className="flex items-end gap-2">
          <textarea
            rows={2}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={t("inputPlaceholder")}
            disabled={sending}
            className="flex-1 resize-none rounded-xl border border-neutral-300 px-3 py-2 text-sm outline-none focus:border-brand-500 disabled:opacity-60"
          />
          <button
            onClick={send}
            disabled={sending || !input.trim()}
            className="h-10 shrink-0 rounded-xl bg-brand-600 px-5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {sending ? t("building") : t("send")}
          </button>
        </div>
      </div>
    </div>
  );
}
