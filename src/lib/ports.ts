import net from "node:net";

const RUNTIME_PORT_RANGE: [number, number] = [42000, 43999];

export function pickFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const candidate =
      RUNTIME_PORT_RANGE[0] +
      Math.floor(Math.random() * (RUNTIME_PORT_RANGE[1] - RUNTIME_PORT_RANGE[0]));
    const server = net.createServer();
    server.once("error", () => {
      // 端口被占则重试一次（port 0 兜底）
      const s2 = net.createServer();
      s2.listen(0, "127.0.0.1", () => {
        const p = (s2.address() as net.AddressInfo).port;
        s2.close(() => resolve(p));
      });
      s2.once("error", reject);
    });
    server.listen(candidate, "127.0.0.1", () => {
      server.close(() => resolve(candidate));
    });
  });
}

export async function waitForPort(
  host: string,
  port: number,
  timeoutMs: number
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ok = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ host, port, timeout: 800 });
      socket.once("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.once("error", () => resolve(false));
      socket.once("timeout", () => {
        socket.destroy();
        resolve(false);
      });
    });
    if (ok) return true;
    await new Promise((r) => setTimeout(r, 400));
  }
  return false;
}
