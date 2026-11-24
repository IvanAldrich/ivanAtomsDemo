#!/usr/bin/env bash
# IvanAtoms 生产服务启动脚本（云桌面重启后执行一次即可）
set -e
cd "$(dirname "$0")/.."
export PATH="/home/admin/tools/node-v22/bin:$PATH"

# 已在运行则跳过
if curl -s -o /dev/null --max-time 2 http://localhost:3000/zh; then
  echo "IvanAtoms 已在运行: http://localhost:3000"
  exit 0
fi

mkdir -p /tmp
nohup npm run start > /tmp/atoms-start.log 2>&1 &
sleep 4
if curl -s -o /dev/null --max-time 3 http://localhost:3000/zh; then
  echo "IvanAtoms 已启动: http://localhost:3000"
  tail -2 /tmp/atoms-start.log
else
  echo "启动失败，查看日志: /tmp/atoms-start.log"
  exit 1
fi
