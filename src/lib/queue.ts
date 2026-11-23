import { EventEmitter } from "node:events";
import { runBuildRound, type BuildEvent } from "./build/orchestrator";

type Job = { projectId: string; messageId: string };

class BuildQueue {
  private jobs: Job[] = [];
  private active: Job | null = null;
  private bus = new EventEmitter();

  constructor() {
    this.bus.setMaxListeners(200);
  }

  /** 订阅某条消息触发的构建轮事件 */
  subscribe(projectId: string, messageId: string, cb: (ev: BuildEvent) => void) {
    const key = `${projectId}:${messageId}`;
    this.bus.on(key, cb);
    return () => this.bus.off(key, cb);
  }

  /** 项目是否有排队中的任务 */
  queuedProjectIds(): Set<string> {
    return new Set(this.jobs.map((j) => j.projectId));
  }

  enqueue(job: Job) {
    this.jobs.push(job);
    void this.pump();
  }

  private async pump() {
    if (this.active) return;
    this.active = this.jobs.shift() ?? null;
    while (this.active) {
      const job = this.active;
      const key = `${job.projectId}:${job.messageId}`;
      try {
        await runBuildRound(job, (ev) => this.bus.emit(key, ev));
      } catch (err) {
        this.bus.emit(key, {
          type: "error",
          message: err instanceof Error ? err.message : "internal error",
        } satisfies BuildEvent);
      }
      this.bus.emit(key, { type: "round-end" } satisfies BuildEvent);
      this.active = this.jobs.shift() ?? null;
    }
  }
}

const globalForQueue = globalThis as unknown as { __buildQueue?: BuildQueue };

export const buildQueue = globalForQueue.__buildQueue ?? new BuildQueue();
globalForQueue.__buildQueue = buildQueue;
