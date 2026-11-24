import { reconcileOrphanedRounds } from "./reconcile";
import { runtimeManager } from "./runtime/manager";

let bootPromise: Promise<void> | null = null;

/**
 * Node 服务启动钩子（惰性一次）：
 * 1) 孤儿构建对账（重启导致的「进行中」状态 → 失败可重试）
 * 2) 孤儿运行时进程清理
 * 3) 已发布项目运行时恢复
 * 由 Node-only 入口（页面布局/健康检查）首请求触发。
 */
export function ensureBoot(): Promise<void> {
  if (!bootPromise) {
    bootPromise = (async () => {
      try {
        const reconciled = await reconcileOrphanedRounds();
        if (reconciled > 0) {
          console.log(`[boot] reconciled ${reconciled} orphaned build round(s)`);
        }
        const killed = await runtimeManager.cleanupOrphanedProcesses();
        if (killed > 0) {
          console.log(`[boot] killed ${killed} orphaned runtime process(es)`);
        }
        const recovered = await runtimeManager.recover();
        if (recovered.length > 0) {
          console.log(`[boot] recovered ${recovered.length} published project(s)`);
        }
      } catch (err) {
        console.error("[boot] failed:", err);
      }
    })();
  }
  return bootPromise;
}