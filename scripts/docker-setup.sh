#!/usr/bin/env bash
# Docker 沙箱环境初始化：镜像、隔离网络、容器互访阻断、容器→宿主防火墙。
set -euo pipefail

if [ "$(id -u)" -eq 0 ]; then
  SUDO=""
else
  SUDO="sudo"
fi

IMAGE="${SANDBOX_IMAGE:-node:22-bookworm}"
RUNTIME_NETWORK="${SANDBOX_RUNTIME_NETWORK:-atoms-runtime}"
BUILD_NETWORK="${SANDBOX_BUILD_NETWORK:-atoms-build}"

if ! docker info >/dev/null 2>&1; then
  echo "Docker 不可用。请确认 daemon 已启动，且当前用户已加入 docker 组（newgrp docker 或重新登录）。" >&2
  exit 1
fi

if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
  echo "拉取沙箱镜像 $IMAGE ..."
  docker pull "$IMAGE"
fi

ensure_network() {
  local name="$1"
  local internal="$2"
  if docker network inspect "$name" >/dev/null 2>&1; then
    return
  fi
  echo "创建隔离网络 $name ..."
  if [ "$internal" = "true" ]; then
    docker network create --internal "$name" >/dev/null
  else
    docker network create "$name" >/dev/null
  fi
}

ensure_network "$RUNTIME_NETWORK" true
ensure_network "$BUILD_NETWORK" false

if ! command -v iptables >/dev/null 2>&1; then
  echo "警告：未找到 iptables，容器互访与宿主访问阻断未配置。" >&2
  exit 0
fi

if ! $SUDO iptables -L DOCKER-USER >/dev/null 2>&1; then
  $SUDO iptables -N DOCKER-USER
  $SUDO iptables -I FORWARD 1 -j DOCKER-USER
fi

network_iface() {
  local name="$1"
  local id
  id="$(docker network inspect -f '{{.Id}}' "$name")"
  printf 'br-%s' "$(printf '%s' "$id" | cut -c1-12)"
}

# 只阻断同一网桥内的容器互访；宿主 -> 容器不受影响。
apply_container_isolation() {
  local name="$1"
  local iface
  iface="$(network_iface "$name")"
  if ! $SUDO iptables -C DOCKER-USER -i "$iface" -o "$iface" -j DROP 2>/dev/null; then
    $SUDO iptables -I DOCKER-USER -i "$iface" -o "$iface" -j DROP
  fi
  echo "已阻断 $name 容器互访（$iface）"
}

# 阻断容器 -> 宿主（网桥网关 + 宿主 LAN IP），保留宿主 -> 容器。
apply_host_block() {
  local name="$1"
  local iface gateway
  iface="$(network_iface "$name")"
  gateway="$(docker network inspect -f '{{(index .IPAM.Config 0).Gateway}}' "$name" 2>/dev/null || true)"
  [ -n "$gateway" ] || return 0

  local ips="$gateway"
  ips="$ips $(hostname -I 2>/dev/null || true)"

  # 允许宿主发起的连接回包（host -> container），但拒绝容器主动访问宿主
  if ! $SUDO iptables -C INPUT -i "$iface" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT 2>/dev/null; then
    $SUDO iptables -I INPUT 1 -i "$iface" -m conntrack --ctstate ESTABLISHED,RELATED -j ACCEPT
  fi

  for ip in $ips; do
    [ -n "$ip" ] || continue
    if ! $SUDO iptables -C INPUT -i "$iface" -d "$ip" -j DROP 2>/dev/null; then
      $SUDO iptables -I INPUT -i "$iface" -d "$ip" -j DROP
    fi
  done
  echo "已阻断 $name 容器 -> 宿主（$iface, $gateway）"
}

apply_container_isolation "$RUNTIME_NETWORK"
apply_container_isolation "$BUILD_NETWORK"
apply_host_block "$RUNTIME_NETWORK"
apply_host_block "$BUILD_NETWORK"

echo "提示：iptables 规则重启后需重新执行本脚本（或接入 iptables-persistent）。"
echo "Docker 沙箱就绪：image=$IMAGE runtime=$RUNTIME_NETWORK build=$BUILD_NETWORK"
echo "提示：Web 与 worker 进程都需要 docker 组权限；可用 'sg docker -c \"npm run ...\"' 启动。"