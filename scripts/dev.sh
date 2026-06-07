#!/usr/bin/env bash
#
# hip 本地开发服务启停脚本 / start-stop helper for hip dev services.
#
# 管理两个长驻进程：
#   web      —— Vite 前端开发服务器 (http://localhost:1420)
#   sidecar  —— DeepSeek WebSocket 后端 (tsx，动态端口，自动加载 .env)
#
# 用法 / Usage:
#   scripts/dev.sh start   [web|sidecar|all]   # 后台启动（默认 all）
#   scripts/dev.sh stop    [web|sidecar|all]   # 停止（默认 all）
#   scripts/dev.sh restart [web|sidecar|all]
#   scripts/dev.sh status                      # 查看运行状态
#   scripts/dev.sh logs    <web|sidecar>       # tail -f 实时日志
#
# 进程 PID 与日志写入 logs/（已被 .gitignore 忽略）。

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT/logs"
WEB_PORT=1420
ENV_FILE="$ROOT/.env"

mkdir -p "$LOG_DIR"

pid_file() { echo "$LOG_DIR/$1.pid"; }
log_file() { echo "$LOG_DIR/$1.log"; }

# 进程是否在跑：PID 文件存在且进程存活
is_running() {
  local pf; pf="$(pid_file "$1")"
  [ -f "$pf" ] || return 1
  local pid; pid="$(cat "$pf" 2>/dev/null || true)"
  [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null
}

# 占用某端口的进程 PID（取第一个）
port_pid() { lsof -ti ":$1" 2>/dev/null | head -1 || true; }

# 释放端口：先 SIGTERM，必要时 SIGKILL
free_port() {
  local port="$1" pid
  pid="$(port_pid "$port")"
  [ -n "$pid" ] || return 0
  echo "[dev] 端口 $port 被 pid $pid 占用，先结束它…"
  kill "$pid" 2>/dev/null || true
  sleep 0.8
  pid="$(port_pid "$port")"
  if [ -n "$pid" ]; then kill -9 "$pid" 2>/dev/null || true; sleep 0.3; fi
}

# 加载 .env 到环境（供 sidecar 读取 DEEPSEEK_API_KEY）
load_env() {
  [ -f "$ENV_FILE" ] || return 0
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
}

start_web() {
  if is_running web; then echo "[dev] web 已在运行 (pid $(cat "$(pid_file web)"))"; return 0; fi
  free_port "$WEB_PORT"
  echo "[dev] 启动 web (vite) → http://localhost:$WEB_PORT"
  ( cd "$ROOT" && nohup "$ROOT/node_modules/.bin/vite" >"$(log_file web)" 2>&1 & echo $! >"$(pid_file web)" )
  sleep 0.3
  echo "[dev] web 已启动 (pid $(cat "$(pid_file web)"))，日志：logs/web.log"
}

start_sidecar() {
  if is_running sidecar; then echo "[dev] sidecar 已在运行 (pid $(cat "$(pid_file sidecar)"))"; return 0; fi
  load_env
  if [ -z "${DEEPSEEK_API_KEY:-}" ]; then
    echo "[dev] ⚠ 未找到 DEEPSEEK_API_KEY（请在 .env.local 设置），sidecar 仍会启动但真实请求会失败。"
  fi
  echo "[dev] 启动 sidecar (DeepSeek WebSocket 后端)…"
  ( cd "$ROOT/packages/sidecar" && nohup "$ROOT/node_modules/.bin/tsx" src/main.ts >"$(log_file sidecar)" 2>&1 & echo $! >"$(pid_file sidecar)" )
  # sidecar 启动后会把 {"port":N} 打到 stdout（日志里），抓出来给用户看
  sleep 1.2
  local port; port="$(grep -o '"port":[0-9]*' "$(log_file sidecar)" 2>/dev/null | tail -1 | grep -o '[0-9]*' || true)"
  echo "[dev] sidecar 已启动 (pid $(cat "$(pid_file sidecar)"))${port:+，监听 ws://localhost:$port}，日志：logs/sidecar.log"
}

stop_one() {
  local svc="$1" port="${2:-}" pf pid
  pf="$(pid_file "$svc")"
  if is_running "$svc"; then
    pid="$(cat "$pf")"
    echo "[dev] 停止 $svc (pid $pid)…"
    kill "$pid" 2>/dev/null || true
    pkill -P "$pid" 2>/dev/null || true   # 顺带回收子进程
    sleep 0.5
    kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null || true
  else
    echo "[dev] $svc 未在运行"
  fi
  rm -f "$pf"
  [ -n "$port" ] && free_port "$port" || true   # web：兜底释放端口，防止 vite 残留
}

status_one() {
  local svc="$1"
  if is_running "$svc"; then
    local pid; pid="$(cat "$(pid_file "$svc")")"
    local extra=""
    if [ "$svc" = web ]; then
      extra=" → http://localhost:$WEB_PORT"
    else
      local port; port="$(grep -o '"port":[0-9]*' "$(log_file "$svc")" 2>/dev/null | tail -1 | grep -o '[0-9]*' || true)"
      [ -n "$port" ] && extra=" → ws://localhost:$port"
    fi
    printf "  %-8s ● 运行中 (pid %s)%s\n" "$svc" "$pid" "$extra"
  else
    printf "  %-8s ○ 已停止\n" "$svc"
  fi
}

TARGET="${2:-all}"

case "${1:-}" in
  start)
    case "$TARGET" in
      web)     start_web ;;
      sidecar) start_sidecar ;;
      all)     start_sidecar; start_web ;;
      *) echo "未知目标：$TARGET（可选 web|sidecar|all）" >&2; exit 1 ;;
    esac
    ;;
  stop)
    case "$TARGET" in
      web)     stop_one web "$WEB_PORT" ;;
      sidecar) stop_one sidecar ;;
      all)     stop_one web "$WEB_PORT"; stop_one sidecar ;;
      *) echo "未知目标：$TARGET（可选 web|sidecar|all）" >&2; exit 1 ;;
    esac
    ;;
  restart)
    "$0" stop "$TARGET"
    "$0" start "$TARGET"
    ;;
  status)
    echo "[dev] 服务状态："
    status_one web
    status_one sidecar
    ;;
  logs)
    [ -n "${2:-}" ] || { echo "用法：scripts/dev.sh logs <web|sidecar>" >&2; exit 1; }
    f="$(log_file "$2")"
    [ -f "$f" ] || { echo "暂无日志：$f" >&2; exit 1; }
    tail -f "$f"
    ;;
  *)
    echo "hip 开发服务启停脚本"
    echo
    echo "用法： scripts/dev.sh <命令> [目标]"
    echo
    echo "命令： start | stop | restart | status | logs"
    echo "目标： web | sidecar | all   (默认 all；logs 必须指定 web 或 sidecar)"
    echo
    echo "示例："
    echo "  scripts/dev.sh start            # 启动 sidecar + web"
    echo "  scripts/dev.sh start web        # 只启动前端"
    echo "  scripts/dev.sh stop             # 全部停止"
    echo "  scripts/dev.sh status           # 查看状态"
    echo "  scripts/dev.sh logs sidecar     # 跟踪 sidecar 日志"
    exit 1
    ;;
esac
