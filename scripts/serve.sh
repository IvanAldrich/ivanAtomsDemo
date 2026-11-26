#!/usr/bin/env bash
# IvanAtoms 生产服务启动脚本（云桌面重启后执行一次即可）
# 需要 Docker 与 docker 组权限；Web 与 worker 都必须能访问 docker socket。
set -euo pipefail
cd "$(dirname "$0")/.."
export PATH="/home/admin/tools/node-v22/bin:$PATH"

if curl -s -o /dev/null --max-time 2 http://localhost:3000/zh; then
  echo "IvanAtoms Web 已在运行: http://localhost:3000"
else
  nohup bash -c 'if docker info >/dev/null 2>&1; then npm run start; else sg docker -c "npm run start"; fi' \
    > /tmp/atoms-start.log 2>&1 &
  sleep 4
  if curl -s -o /dev/null --max-time 3 http://localhost:3000/zh; then
    echo "IvanAtoms Web 已启动: http://localhost:3000"
    tail -2 /tmp/atoms-start.log
  else
    echo "Web 启动失败，查看日志: /tmp/atoms-start.log"
    exit 1
  fi
fi

if pgrep -f "tsx src/worker.ts" >/dev/null 2>&1; then
  echo "构建 worker 已在运行"
else
  nohup bash -c 'if docker info >/dev/null 2>&1; then npm run worker; else sg docker -c "npm run worker"; fi' \
    > /tmp/atoms-worker.log 2>&1 &
  sleep 1
  if pgrep -f "tsx src/worker.ts" >/dev/null 2>&1; then
    echo "构建 worker 已启动: /tmp/atoms-worker.log"
  else
    echo "worker 启动失败，查看日志: /tmp/atoms-worker.log"
    exit 1
  fi
fi

echo "提示：首次部署请先运行 npm run docker:setup"