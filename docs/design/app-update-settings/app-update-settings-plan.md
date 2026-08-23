# 通用设置 · 版本与更新 —— 执行计划

> 系列：`app-update-settings` ｜ spec：`app-update-settings-spec.md` ｜ 预览：`app-update-settings-preview.html`
> 按 spec Key Decisions（含 KD-13 调度、KD-14 Win ARM、KD-10 测试门）+ 文末 PR Plan 落地。
> **本计划不修改产品代码**；实施时另开 PR。

---

## 0. 范围与原则

- v1 = GitHub Releases **检查 + 用户确认后下载安装器 + SHA-256 + opener 打开**。不接 `tauri-plugin-updater`。PR-1..5 **不得**加入 updater 插件 / `latest.json` / minisign。
- 「自动更新」开关 = **自动检查（24h）**，默认 **off**。永不自动下载/安装。UI 文案「自动检查更新」。
- 自动检查 **只由 Rust wake loop 拥有**（KD-13）。前端只 listen + 开关 ON 时 `force:false` 一次。
- HTTP 全部 Rust；CSP 禁止前端打 GitHub。检查 client 与下载 client **超时分离**（禁止整段拷贝 `voice.rs::download_http_client`）。
- `[updates]` 必须同时进 protocol / `hip_config.rs`（含 **lib.rs ×12 + hip_config.rs 字面量 + 两处 From**）/ sidecar parser。项目 `.hip/hip.toml` **不要加 merge 分支**。
- **禁止** 加 `sidebar-app-version`。
- PR-4 硬依赖 PR-3：禁止把「立即更新」先做成纯网页 CTA。
- 测试纪律：每 PR `yarn tsc` + 相关 `yarn test` + `cargo test`；付费 LLM 护栏按 `CLAUDE.md`。
- i18n：引入 key 的 PR 一次补齐 zh-CN/en/zh-TW/ja/ko。
- 不要顺手修 Rust `HipConfig` 缺 `trash` 的既有债。

---

## PR-1 · `[updates]` 配置贯通

**依赖：** 无  
**验收：** 手写全局 `hip.toml` `[updates] autoCheck = true` 后，`get_hip_config` JSON 含 `updates.autoCheck`；再 `set_hip_config` 改 proxy，toml 里 `[updates]` 仍在。sidecar `readHipConfig` 能读到。项目 `.hip/hip.toml` 的 `[updates]` **不**覆盖全局（测试名：`project [updates] does not override global`）。`cargo test` 全绿（所有 `HipConfig {` 字面量已补字段）。

### 任务

1. protocol：`UpdatesConfig { autoCheck?: boolean }`，挂到 `HipConfig`（`proxy` 之后）。
2. `hip_config.rs`：JSON `UpdatesConfig`（camelCase）+ `TomlUpdatesConfig`（`auto_check` + alias `autoCheck`）；`HipConfig`/`TomlHipConfig` 字段；**两处** `From`；NotFound 默认（~L755）与 `voice_round_trips_*`（~L1130）等字面量补 `updates: None`；新 round-trip 测试 `updates_round_trips_toml_with_proxy_and_window`。
3. `lib.rs`：**12 处** `proxy: None` 旁补 `updates: None`（不要只改一处）。
4. sidecar `normalizeUpdates` + `validateConfig` 分支。**不要**在 `deepMergeConfig` 写 `merged.updates = project.updates`（现有 merge 也不 overlay `proxy`/`window`）。不要顺手 parse/merge `voice`。
5. `docs/examples/hip.toml.example` 在 `[proxy]` 后加注释块（默认注释掉）。`[updates]` 不进 `[window]`。

**不包含：** 任何 UI、任何 GitHub 请求。

---

## PR-2 · 检查命令

**依赖：** PR-1（建议；检查可不读 `autoCheck`）  
**验收：** `cargo test` 覆盖 spec 测试表：semver 只返回 Lt/Eq/Gt（不直接 `update_available`）/ asset 选择（含 **win aarch64 不命中 x64 exe**、mac x86_64 不命中 aarch64 dmg）/ 429+retryAfter / parse / 成功才写缓存 / `force=true` 无 If-None-Match / parserVersion miss / 304+损坏 result 重 GET / `assert_allowed` 拒绝 **原始** `http://evil.test` / Unix `updates_cache_dir` mode 0700。不打外网。

### 任务

1. **`src-tauri/src/paths.rs`**（本 PR 必改，不是可选项）：
   - `ensure_private_dir` 改为 `pub(crate)`
   - 新增 `pub fn updates_cache_dir(app) -> Option<PathBuf>`（`cache_dir` 旁，内部走 `ensure_private_dir`）
   - Unix 单测目录 0700。禁止 `cache_dir().join("updates")` 完事。
2. 新文件 `src-tauri/src/updates.rs`：
   - `check_inner(app, force)`：纯检查 + 缓存，**无 emit**
   - `updates_app_info` / `updates_check` 包装层只 `return check_inner(...)`，**禁止 emit**
   - `proxy_client_builder(app)`：**只**抽代理，不设 timeout
   - `assert_allowed(url)` 在 `client.get` **之前** 以及 `Policy::custom` 内
   - 检查 client：connect 10s、total 20s
   - UA `hip/<ver> (+https://github.com/limin411/hip)`、`Accept: application/vnd.github+json`
   - 写死 URL `https://api.github.com/repos/limin411/hip/releases/latest`
   - `last-check.json` 0600、`parserVersion: 1`、**仅成功写入**
   - semver 纯函数返回 cmp；status 由 asset 决策表得出（KD-14：Win ARM 无回退）
   - 检查阶段 sha256 **只**来自 `assets[].digest`
3. `lib.rs`：`mod updates;` + 注册。
4. 日志 `tauri_info!("updates", ...)` 无 PII；429 记 `x-ratelimit-remaining` 整数；deny 只 log host。

**不包含：** 下载、UI、wake loop。

---

## PR-3 · 下载 / 校验 / 打开

**依赖：** PR-2  
**验收：** inner 函数：SHA 失配被删；SUMS≠digest 拒绝；meta 变化不 Range；路径 `../` 被拒。command 包装：`debug_assertions && !cfg!(test)` 下 `updates_download` 返回错误。可用 tempfile，不打 GitHub。

### 任务

1. `updates_download`：只接受 cache 里当前 check 的 `tag` + `assetName`，禁止前端任意 URL。
2. 跟随 HTTPS，`Policy::custom` 校验每一跳。
3. 先下 `SHA256SUMS.txt`；与 digest 比对规则见 spec KD-9。
4. `.partial` + `.partial.meta.json` `{ tag, assetName, expectedSize, sha256, etag? }`。size 未知禁止 Range。
5. stall 60s 无字节 → error。进度 `updates://progress`，200ms 或 256 KiB。取消 = voice 同款 `AtomicBool`。下载 client：connect 10–30s，**无** 2h 总超时。
6. `updates_open_installer`：canonical 前缀 `{updates_cache_dir}/`。opener 失败 → `Err`，UI toast，不 panic。
7. `updates_open_release_page`：URL 前缀 `https://github.com/limin411/hip/releases`。
8. `HIP_UPDATES_ALLOW_DEV_INSTALL=1` 可绕过 dev 门。

---

## PR-4 · 通用设置 UI

**依赖：** PR-1 + PR-2 + **PR-3（硬门）**  
**验收：** `GeneralSettings.test.tsx` 新 describe 全绿，矩阵含 **`no_matching_asset` / `current_ahead` / 无 sha256 禁用安装 / 确认框未签名 / `error_hash` / toggle persist / ON 触发一次 `force:false` → `setLastResult` / mount 调 `updates_app_info` + `updates_check({force:false})` / `dev_blocked`**。`updatesStore` 是 lastResult 唯一写入点。`translation-keys.test.ts` 全绿。没有 `updates_download` **不准合**。

### 任务

1. `src/ipc/updates.ts` + vitest mock invoke。
2. `src/store/updatesStore.ts`：`appInfo` / `lastResult` / `progress` / `checking` + `set*`；**禁止** GeneralSettings 用另一份 useState 存检查结果。
3. `GeneralSettings.tsx`：代理区块后插入 spec 布局；**订阅 store**；mount hydration；复用现有 `Switch`；`updateSection('updates', …)` functional merge。
4. 状态行 / notes / 进度 / `Modal variant="confirm"` 未签名文案。
5. i18n 五文件（含 `noHash` / `errorHost`）。
6. **不** 改 `AppSidebar`。
7. 「立即更新」仅 `status==update_available && asset.sha256 && !debugBuild`。

---

## PR-5 · 自动检查 + toast + E2E

**依赖：** PR-4  
**验收：** 注入 `HttpClient` + 假 clock：`autoCheck` 省略 ⇒ 前 N 秒 **零** 次 client build。`updates_check` 命令单测不 emit。wake 在 `check_inner` 之后才 emit。Host 收到事件后 `setLastResult`，settings/general 已打开时 **仍写 store、只跳过 toast**。卸载设置后 `progress` 仍在。E2E 通用页有 `settings-updates`。snooze 24h 单测（假 clock）。

### 任务

1. Rust `spawn_wake_loop`：5s + 每 1h；每次 **re-read** toml；调用 **`check_inner`**（不是 command）；符合条件才 emit；emit 时写 `promptedTag/At`。
2. `WindowLifecycleHost` 进程级 `listen('updates://available')` **和** `listen('updates://progress')` → `store.setLastResult` / `setProgress`，然后才 toast。「查看」只打开 overlay。**不要**把 listen 只挂在设置树 / `AppLayout`。
3. 「稍后」只关 toast（无 IPC）。
4. 测试：模拟 available 事件 → store 有 lastResult → 已挂载的 GeneralSettings 不再是 idle。
5. E2E：testid only，不点检查。

---

## 风险与缓解

| 风险 | 级别 | 缓解 |
|---|---|---|
| CI 未签名，用户以为点「立即更新」会无感升级 | 高 | 确认框 + Gatekeeper 文案；不自退出 |
| GitHub 60/h | 中 | 成功缓存 + `force=true` 才无条件 GET；429 + `retryAfterSec` |
| Intel Mac / Win ARM 无包 | 中 | `no_matching_asset`；KD-14 不回退 x64 |
| `set_hip_config` 漏字段 | 中 | PR-1 列出 lib.rs×12 + hip_config.rs |
| 拷贝 voice 2h timeout | 高 | 两个 client；检查 20s |
| Range 拼到被替换的 asset | 中 | `.partial.meta.json` |
| 实施时误加侧栏版本 | 低 | 现有 AppSidebar 测试会红 |
| PR-4 先合、安装变打开网页 | 中 | 硬门：PR-4 依赖 PR-3 |

---

## 节奏建议

PR-1 可当天合。PR-2/3 可合成一个 Rust PR（共享 allowlist），但仍排在 UI 之前。PR-4 必须看到 `updates_download`。PR-5 最后。不要把 updater 插件塞进这些 PR。
