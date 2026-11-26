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
  createdAt: string;
};

const IN_FLIGHT = new Set(["queued", "generating", "building", "repairing"]);
const STEPS = ["queued", "generating", "building"] as const;

function stepIndex(stage: string | null): number {
  if (stage === "building" || stage === "repairing") return 2;
  if (stage === "generating") return 1;
  if (stage === "queued") return 0;
  return -1;
}

function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export function ChatView({
  projectId,
  projectTitle,
  previewToken,
  initialMessages,
  initialStatus,
  initialHasVersion,
  initialPublishedSlug,
}: {
  projectId: string;
  projectTitle: string;
  previewToken: string;
  initialMessages: ChatMessage[];
  initialStatus: string;
  initialHasVersion: boolean;
  initialPublishedSlug: string | null;
}) {
  const t = useTranslations("chat");
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  // 版本可用性必须响应式：构建进行中打开页面时初始为 false，构建成功后即刻可预览/发布
  const [hasVersion, setHasVersion] = useState(initialHasVersion);
  const [input, setInput] = useState("");
  const [stage, setStage] = useState<string | null>(null);
  const [logs, setLogs] = useState<string[]>([]);
  const [sending, setSending] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [tab, setTab] = useState<"chat" | "preview">("chat");
  const [viewport, setViewport] = useState<"desktop" | "mobile">("desktop");
  const [iframeKey, setIframeKey] = useState(0);
  const [iframeLoading, setIframeLoading] = useState(true);
  const [now, setNow] = useState(() => Date.now());
  const [publishedSlug, setPublishedSlug] = useState<string | null>(
    initialPublishedSlug
  );
  const [publishing, setPublishing] = useState(false);
  const [copied, setCopied] = useState(false);
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
      const status = lastUser?.buildStatus ?? null;
      if (status && IN_FLIGHT.has(status)) {
        // 从 queued → generating/building/repairing 时同步阶段，避免页面一直显示“排队中”
        setStage(status);
        return;
      }
      if (status === "success") setHasVersion(true);
      setStage(null);
      clearInterval(timer);
    }, 1500);
    return () => clearInterval(timer);
  }, [initialStatus, projectId]);

  // 本轮耗时以服务端消息时间戳为准，刷新/离开页面后仍可恢复
  const lastUser = [...messages].reverse().find((m) => m.role === "user");
  const lastAssistant = [...messages].reverse().find((m) => m.role === "assistant");
  const roundAssistant =
    lastUser?.buildRound != null
      ? [...messages]
          .reverse()
          .find(
            (m) =>
              m.role === "assistant" && m.buildRound === lastUser.buildRound
          )
      : undefined;
  const roundStartedAt = lastUser ? Date.parse(lastUser.createdAt) : NaN;
  const roundEndedAt = roundAssistant
    ? Date.parse(roundAssistant.createdAt)
    : NaN;
  const lastRoundActive = Boolean(
    lastUser?.buildStatus && IN_FLIGHT.has(lastUser.buildStatus)
  );
  useEffect(() => {
    if (!lastRoundActive) return;
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [lastRoundActive, lastUser?.id]);
  const elapsedSec =
    Number.isFinite(roundStartedAt) && lastUser?.buildStatus
      ? Math.max(
          0,
          Math.floor(
            ((Number.isFinite(roundEndedAt) ? roundEndedAt : now) -
              roundStartedAt) /
              1000
          )
        )
      : null;
  const roundDone =
    stage === null && !sending && lastUser && lastUser.buildStatus !== null;
  const roundSuccess =
    roundDone && lastUser.buildStatus === "success" && hasVersion;
  const roundFailed = roundDone && lastUser.buildStatus === "failed";

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
            if (ev.stage === "success") {
              setHasVersion(true);
              await refreshMessages();
            } else if (ev.stage === "failed") {
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
    setMessages((prev) => [
      ...prev,
      {
        id: `optimistic-${Date.now()}`,
        role: "user",
        content,
        buildRound: null,
        buildStatus: "queued",
        createdAt: new Date().toISOString(),
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

  async function publish() {
    if (publishing) return;
    setPublishing(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/publish`, {
        method: "POST",
      });
      if (res.ok) {
        const data = (await res.json()) as { url: string };
        setPublishedSlug(data.url.split("/").pop() ?? null);
      }
    } finally {
      setPublishing(false);
    }
  }

  async function unpublish() {
    if (publishing) return;
    setPublishing(true);
    try {
      const res = await fetch(`/api/projects/${projectId}/publish`, {
        method: "DELETE",
      });
      if (res.ok) setPublishedSlug(null);
    } finally {
      setPublishing(false);
    }
  }

  async function copyLink() {
    if (!publishedSlug) return;
    await navigator.clipboard.writeText(
      `${window.location.origin}/p/${publishedSlug}`
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const publicUrl =
    typeof window !== "undefined" && publishedSlug
      ? `${window.location.origin}/p/${publishedSlug}`
      : "";

  return (
    <div
      className={
        tab === "preview"
          ? "flex h-[calc(100vh-3.5rem)] w-full flex-col px-4"
          : "mx-auto flex h-[calc(100vh-3.5rem)] max-w-5xl flex-col px-4"
      }
    >
      <div className="flex items-center gap-3 border-b border-neutral-200 py-3">
        <Link
          href="/dashboard"
          className="rounded-md border border-neutral-200 px-2.5 py-1 text-sm text-neutral-600 hover:border-neutral-300"
        >
          ← {t("backToProjects")}
        </Link>
        <h1 className="min-w-0 flex-1 truncate text-base font-semibold text-neutral-900">
          {projectTitle}
        </h1>
        {publishedSlug && (
          <a
            href={`/p/${publishedSlug}`}
            target="_blank"
            rel="noreferrer"
            className="rounded-md border border-brand-200 bg-brand-50 px-2.5 py-1 text-sm text-brand-700 hover:border-brand-300"
          >
            {t("openPublic")} ↗
          </a>
        )}
        <div className="flex rounded-lg border border-neutral-200 bg-neutral-100 p-0.5 text-sm">
          <button
            onClick={() => setTab("chat")}
            className={`rounded-md px-3 py-1 ${
              tab === "chat"
                ? "bg-white text-neutral-900 shadow-sm"
                : "text-neutral-500"
            }`}
          >
            {t("tabChat")}
          </button>
          <button
            onClick={() => setTab("preview")}
            className={`rounded-md px-3 py-1 ${
              tab === "preview"
                ? "bg-white text-neutral-900 shadow-sm"
                : "text-neutral-500"
            }`}
          >
            {t("tabPreview")}
          </button>
        </div>
      </div>

      {tab === "preview" ? (
        <div className="flex min-h-0 flex-1 flex-col py-4">
          {!hasVersion ? (
            <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-neutral-300 bg-neutral-50 p-10 text-center">
              <p className="text-sm text-neutral-500">
                {sending || (stage !== null && IN_FLIGHT.has(stage))
                  ? t("previewBuilding")
                  : t("previewUnavailable")}
              </p>
            </div>
          ) : (
            <>
              <div className="mb-3 flex items-center justify-between">
                <div className="flex rounded-lg border border-neutral-200 p-0.5 text-sm">
                  <button
                    onClick={() => setViewport("desktop")}
                    className={`rounded-md px-3 py-1 ${
                      viewport === "desktop"
                        ? "bg-white shadow-sm text-neutral-900"
                        : "text-neutral-500"
                    }`}
                  >
                    {t("viewportDesktop")}
                  </button>
                  <button
                    onClick={() => setViewport("mobile")}
                    className={`rounded-md px-3 py-1 ${
                      viewport === "mobile"
                        ? "bg-white shadow-sm text-neutral-900"
                        : "text-neutral-500"
                    }`}
                  >
                    {t("viewportMobile")}
                  </button>
                </div>
                <button
                  onClick={() => {
                    setIframeKey((k) => k + 1);
                    setIframeLoading(true);
                  }}
                  className="rounded-md border border-neutral-200 px-3 py-1.5 text-sm text-neutral-600 hover:border-neutral-300"
                >
                  ⟳ {t("reload")}
                </button>
              </div>
              <div className="relative flex min-h-0 flex-1 justify-center overflow-hidden rounded-xl border border-neutral-200 bg-neutral-50">
                {iframeLoading && (
                  <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-neutral-50 text-sm text-neutral-500">
                    <span className="h-5 w-5 animate-spin rounded-full border-2 border-neutral-300 border-t-brand-500" />
                    {t("previewStarting")}
                  </div>
                )}
                <iframe
                  key={iframeKey}
                  src={`/preview/${projectId}/${previewToken}/`}
                  sandbox="allow-scripts allow-forms allow-popups"
                  onLoad={() => setIframeLoading(false)}
                  className={
                    viewport === "mobile"
                      ? "h-full w-[390px] border-0 bg-white"
                      : "h-full w-full border-0 bg-white"
                  }
                  title="App Viewer"
                />
              </div>
            </>
          )}
        </div>
      ) : (
        <>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-6">
            {/* 构建完成横幅 */}
            {roundSuccess && !IN_FLIGHT.has(stage ?? "") && (
              <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-emerald-800">
                    ✅ {t("buildDone")}
                  </p>
                  <div className="flex gap-2">
                    <button
                      onClick={() => {
                        setTab("preview");
                        setIframeLoading(true);
                      }}
                      className="rounded-lg bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700"
                    >
                      {t("previewNow")}
                    </button>
                    {publishedSlug ? (
                      <>
                        <button
                          onClick={publish}
                          disabled={publishing}
                          className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                        >
                          {publishing ? "…" : t("updateLive")}
                        </button>
                        <button
                          onClick={copyLink}
                          className="rounded-lg border border-emerald-300 bg-white px-4 py-1.5 text-sm text-emerald-700 hover:bg-emerald-100"
                        >
                          {copied ? t("copied") : t("copyLink")}
                        </button>
                        <button
                          onClick={unpublish}
                          disabled={publishing}
                          className="rounded-lg border border-neutral-200 bg-white px-3 py-1.5 text-sm text-neutral-600 hover:border-neutral-300 disabled:opacity-60"
                        >
                          {t("unpublish")}
                        </button>
                      </>
                    ) : (
                      <button
                        onClick={publish}
                        disabled={publishing}
                        className="rounded-lg bg-brand-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-60"
                      >
                        {publishing ? "…" : t("publish")}
                      </button>
                    )}
                  </div>
                </div>
                {elapsedSec !== null && (
                  <p className="mt-2 text-xs tabular-nums text-emerald-700">
                    {t("elapsed")} {formatDuration(elapsedSec)}
                  </p>
                )}
                {publicUrl && (
                  <a
                    href={`/p/${publishedSlug}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 block truncate text-xs text-emerald-700 underline"
                  >
                    {publicUrl}
                  </a>
                )}
              </div>
            )}

            {/* 构建失败横幅 */}
            {roundFailed && (
              <div className="rounded-xl border border-red-200 bg-red-50 p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold text-red-800">
                    ❌ {t("buildFailedTitle")}
                  </p>
                  <button
                    onClick={() => retry(lastUser!.id)}
                    disabled={retryingId === lastUser!.id}
                    className="rounded-lg bg-red-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-60"
                  >
                    {retryingId === lastUser!.id ? t("retrying") : t("retry")}
                  </button>
                </div>
                {elapsedSec !== null && (
                  <p className="mt-2 text-xs tabular-nums text-red-700">
                    {t("elapsed")} {formatDuration(elapsedSec)}
                  </p>
                )}
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-red-600">
                    {t("failureDetail")}
                  </summary>
                  <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-neutral-600">
                    {lastAssistant?.content}
                  </pre>
                </details>
              </div>
            )}

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
                </div>
              </div>
            ))}

            {/* 进行中：步骤条 + 日志 */}
            {(stage !== null || logs.length > 0) && (
              <div className="rounded-xl border border-neutral-200 bg-neutral-50 p-4 text-sm">
                <div className="flex items-center gap-2">
                  {STEPS.map((s, i) => {
                    const active = stepIndex(stage) >= i;
                    const current = stepIndex(stage) === i;
                    return (
                      <div key={s} className="flex items-center gap-2">
                        {i > 0 && (
                          <span
                            className={`h-px w-6 ${active ? "bg-brand-400" : "bg-neutral-200"}`}
                          />
                        )}
                        <span
                          className={`flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs ${
                            current
                              ? "bg-brand-100 text-brand-800 font-medium"
                              : active
                                ? "bg-neutral-200 text-neutral-600"
                                : "bg-white text-neutral-300"
                          }`}
                        >
                          {current && (
                            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand-500" />
                          )}
                          {t(`stage.${s}`)}
                        </span>
                      </div>
                    );
                  })}
                  {stage === "repairing" && (
                    <span className="rounded-full bg-amber-100 px-2.5 py-1 text-xs text-amber-800">
                      {t("stage.repairing")}
                    </span>
                  )}
                  {elapsedSec !== null && (lastRoundActive || stage !== null) && (
                    <span className="ml-auto text-xs tabular-nums text-neutral-400">
                      {t("elapsed")} {formatDuration(elapsedSec)}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-xs text-neutral-400">{t("etaHint")}</p>
                {logs.length > 0 && (
                  <pre className="mt-2 max-h-40 overflow-y-auto whitespace-pre-wrap text-xs text-neutral-500">
                    {logs.join("\n")}
                  </pre>
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
        </>
      )}
    </div>
  );
}
