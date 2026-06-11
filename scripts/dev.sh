#!/usr/bin/env bash
#
# hip 本地开发服务启停脚本 / start-stop helper for hip dev services.
#
# 可管理三种目标：
#   app      —— Tauri 桌面应用 (yarn tauri dev：编译 Rust + 弹出原生窗口 + 自动拉起 sidecar)  ← 默认
#   web      —— 仅 Vite 前端开发服务器 (http://localhost:1420，浏览器里看 mock UI)
#   sidecar  —— 仅 DeepSeek WebSocket 后端 (tsx，动态端口)
#
# app 模式已包含前端(vite)与后端(sidecar)，无需再单独启 web/sidecar。
# web/sidecar 仅用于不开桌面窗口的轻量调试（浏览器 UI / 后端单测）。
#
# 用法 / Usage:
#   scripts/dev.sh start   [app|web|sidecar]   # 后台启动（默认 app）
#   scripts/dev.sh stop    [app|web|sidecar]   # 停止（默认 app）
#   scripts/dev.sh restart [app|web|sidecar]
#   scripts/dev.sh status                      # 查看运行状态
#   scripts/dev.sh logs    <app|web|sidecar>   # tail -f 实时日志
#
# 进程 PID 与日志写入 logs/（已被 .gitignore 忽略）。
# 桌面 app 的 DeepSeek Key 由应用内「设置」写入系统钥匙串；.env 仅供独立 sidecar（及测试）使用。

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

# 列出某 pid 及其所有后代（深度优先；tauri 会派生 vite/cargo/hip/sidecar 等孙子进程）
list_descendants() {
  local pid="$1" child
  echo "$pid"
  for child in $(pgrep -P "$pid" 2>/dev/null); do list_descendants "$child"; done
}

# 杀掉整棵进程树：先快照所有 pid（防止 reparent 丢失），TERM，存活者再 KILL
kill_tree() {
  local root="$1" pids p
  [ -n "$root" ] || return 0
  pids="$(list_descendants "$root")"
  for p in $pids; do kill -TERM "$p" 2>/dev/null || true; done
  sleep 1
  for p in $pids; do kill -0 "$p" 2>/dev/null && kill -KILL "$p" 2>/dev/null || true; done
}

# 加载 .env 到环境（供 sidecar / tauri 读取 HIP_MODEL_DEEPSEEK_API_KEY）
load_env() {
  [ -f "$ENV_FILE" ] || return 0
  set -a
  # shellcheck disable=SC1090
  . "$ENV_FILE"
  set +a
}

warn_missing_key() {
  [ -n "${HIP_MODEL_DEEPSEEK_API_KEY:-}" ] || \
    echo "[dev] ⚠ 未找到 HIP_MODEL_DEEPSEEK_API_KEY（请在 .env 设置），仍会启动但真实 LLM 请求会失败。"
}

start_app() {
  if is_running app; then echo "[dev] app 已在运行 (pid $(cat "$(pid_file app)"))"; return 0; fi
  echo "[dev] 桌面应用从「设置」面板(系统钥匙串)读取 DeepSeek Key；首次启动需在应用内填入一次。"
  free_port "$WEB_PORT"   # tauri 的 beforeDevCommand 会在该端口起 vite
  echo "[dev] 启动桌面应用 (yarn tauri dev)… 改动过 Rust 时需编译，窗口会稍后弹出。"
  # exec 让记录的 PID 就是真正的进程（而非临时子 shell），停止时 kill_tree 才能命中整棵树
  ( cd "$ROOT" && exec nohup yarn tauri dev ) </dev/null >"$(log_file app)" 2>&1 &
  echo $! >"$(pid_file app)"
  sleep 0.5
  echo "[dev] 桌面应用启动中 (pid $(cat "$(pid_file app)"))，日志：logs/app.log"
  echo "[dev] 跟踪编译/启动进度： scripts/dev.sh logs app"
}

start_web() {
  if is_running web; then echo "[dev] web 已在运行 (pid $(cat "$(pid_file web)"))"; return 0; fi
  free_port "$WEB_PORT"
  echo "[dev] 启动 web (vite) → http://localhost:$WEB_PORT"
  ( cd "$ROOT" && exec nohup "$ROOT/node_modules/.bin/vite" ) </dev/null >"$(log_file web)" 2>&1 &
  echo $! >"$(pid_file web)"
  sleep 0.3
  echo "[dev] web 已启动 (pid $(cat "$(pid_file web)"))，日志：logs/web.log"
}

start_sidecar() {
  if is_running sidecar; then echo "[dev] sidecar 已在运行 (pid $(cat "$(pid_file sidecar)"))"; return 0; fi
  load_env; warn_missing_key
  echo "[dev] 启动 sidecar (DeepSeek WebSocket 后端)…"
  ( cd "$ROOT/packages/sidecar" && exec nohup "$ROOT/node_modules/.bin/tsx" src/main.ts ) </dev/null >"$(log_file sidecar)" 2>&1 &
  echo $! >"$(pid_file sidecar)"
  sleep 1.2
  local port; port="$(grep -o '"port":[0-9]*' "$(log_file sidecar)" 2>/dev/null | tail -1 | grep -o '[0-9]*' || true)"
  echo "[dev] sidecar 已启动 (pid $(cat "$(pid_file sidecar)"))${port:+，监听 ws://localhost:$port}，日志：logs/sidecar.log"
}

stop_one() {
  local svc="$1" pf pid
  pf="$(pid_file "$svc")"
  if is_running "$svc"; then
    pid="$(cat "$pf")"
    echo "[dev] 停止 $svc (pid ${pid}，连同子进程)…"
    kill_tree "$pid"   # 杀整棵树：app 模式下含 tauri/vite/cargo/hip 窗口/sidecar
  else
    echo "[dev] $svc 未在运行"
  fi
  rm -f "$pf"
  # 兜底：释放 vite 端口（app/web 都会用到 1420）
  case "$svc" in
    app|web) free_port "$WEB_PORT" ;;
  esac
}

status_one() {
  local svc="$1"
  if is_running "$svc"; then
    local pid extra=""
    pid="$(cat "$(pid_file "$svc")")"
    case "$svc" in
      app) extra=" → 桌面应用 (内含 vite :$WEB_PORT + sidecar)" ;;
      web) extra=" → http://localhost:$WEB_PORT" ;;
      sidecar)
        local port; port="$(grep -o '"port":[0-9]*' "$(log_file "$svc")" 2>/dev/null | tail -1 | grep -o '[0-9]*' || true)"
        [ -n "$port" ] && extra=" → ws://localhost:$port" ;;
    esac
    printf "  %-8s ● 运行中 (pid %s)%s\n" "$svc" "$pid" "$extra"
  else
    printf "  %-8s ○ 已停止\n" "$svc"
  fi
}

dispatch() {
  local action="$1" target="$2"
  case "$target" in
    app)     "${action}_app" ;;
    web)     "${action}_web" ;;
    sidecar) "${action}_sidecar" ;;
    *) echo "未知目标：${target}（可选 app|web|sidecar）" >&2; exit 1 ;;
  esac
}

TARGET="${2:-app}"

case "${1:-}" in
  start)
    dispatch start "$TARGET" ;;
  stop)
    case "$TARGET" in
      app|web|sidecar) stop_one "$TARGET" ;;
      *) echo "未知目标：${TARGET}（可选 app|web|sidecar）" >&2; exit 1 ;;
    esac ;;
  restart)
    "$0" stop "$TARGET"
    "$0" start "$TARGET" ;;
  status)
    echo "[dev] 服务状态："
    status_one app
    status_one web
    status_one sidecar ;;
  logs)
    [ -n "${2:-}" ] || { echo "用法：scripts/dev.sh logs <app|web|sidecar>" >&2; exit 1; }
    f="$(log_file "$2")"
    [ -f "$f" ] || { echo "暂无日志：$f" >&2; exit 1; }
    tail -f "$f" ;;
  *)
    echo "hip 开发服务启停脚本"
    echo
    echo "用法： scripts/dev.sh <命令> [目标]"
    echo
    echo "命令： start | stop | restart | status | logs"
    echo "目标： app | web | sidecar   (默认 app；logs 必须指定具体目标)"
    echo
    echo "  app      Tauri 桌面应用（编译 Rust + 原生窗口 + 自动拉起 sidecar）← 默认"
    echo "  web      仅 Vite 前端 (http://localhost:1420，浏览器 mock UI)"
    echo "  sidecar  仅 DeepSeek 后端 (WebSocket)"
    echo
    echo "示例："
    echo "  scripts/dev.sh start            # 启动桌面应用"
    echo "  scripts/dev.sh logs app         # 跟踪编译/启动日志"
    echo "  scripts/dev.sh stop             # 关闭桌面应用"
    echo "  scripts/dev.sh start web        # 只在浏览器里调 UI"
    echo "  scripts/dev.sh status           # 查看状态"
    exit 1 ;;
esac
