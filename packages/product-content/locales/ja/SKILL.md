# hip

hip は**デスクトップ AI 作業台**（Tauri シェル + React UI + Node sidecar）、製品バージョン **{{HIP_PRODUCT_VERSION}}** です。各 UI タブは独立セッションです。既定の製品ループは **Supervisor ReAct** エージェントで、ツールを使い `task` / `dispatch_agent` / `task_batch` で委任できます。通常ターンに Planner → Coder → Reviewer 強制パイプラインはありません。

このスキルは *hip 製品そのもの* の公式ガイドです。ユーザープロジェクトの通常コーディングでは **読み込まない** でください。

製品の質問には**ユーザーの言語**で答え、設定パスと識別子は原文のまま正確に。

## 段階的開示

- **Level 1**（システムプロンプト Skills 一覧）：名前 + 説明のみ
- **Level 2**（本ファイル）：`use_skill({ name: "hip" })` で読み込む概要
- **Level 3**：`references/` — 必要時 `read_file` で絶対パスを読む

ここに無い製品詳細は創作せず「不明」と述べる。

## サーフェス

| サーフェス | 用途 |
|------------|------|
| **Code** | プロジェクト作業台：ファイルツール、git 指針、MCP カタログ、フルツール、非同期 TaskRuntime |
| **Chat** | 軽量会話：短いプロンプト、git コミット指針なし；プレビュー可能な成果物は `write_file` |
| **Knowledge** | ノート空間アシスタント；ソフトウェアプロジェクトのコーディングエージェントではない |

サーフェスは UI で選択；システムプロンプトが反映済み。

## 権限モード

| モード | 効果 |
|--------|------|
| **edit**（既定） | プロジェクトルートにサンドボックス |
| **chat** | 読み取り専用（書き込み/スクリプト不可） |
| **full** | サンドボックスなし（ユーザー許可）；絶対パス推奨 |

edit/chat のパスは `/` 始まりのプロジェクト相対。シェルツール名を発明せず `run_script` を使う。

## 設定（デスクトップ UI）

- **プロバイダ / API キー** — `~/.hip/config/auth.json`（0600 平文）
- **メモリ** — クロスセッションは**既定オフ**（設定 → メモリ）
- **スキル** — インストール済みスキルの有効/無効
- **プラグイン** — インストール/有効化；設定に Plugin Market
- **エージェント** — supervisor / plan / explore / coder とカスタム
- **ネットワークポリシー** — 出方向ツールの許可/拒否

## 右パネル：Agents + Runtime

セッション右パネルは次を統合：

- **Agents** — 名簿、サブエージェント、委任状態
- **Runtime** — バックグラウンド shell、monitor、スケジュール。実行中は chip 表示

長時間 shell / CI / 定期チェックは TaskRuntime ツールを使う。メインターンで sleep ポールしない。

## スキル・プラグイン・MCP

- **スキル**：`SKILL.md` フォルダ。グローバル `~/.hip/skills/`、プロジェクト `.hip/skills/`。
- **プラグイン**：`~/.hip/plugins/`。詳細は `references/agents-and-plugins.md`。
- **MCP**：`mcp_search` 後 `mcp__<server>__<tool>`。

## エージェントと委任

- 専用名簿を優先：explore / plan / coder。
- 独立サブタスク 2+ → 一度の `task_batch`。
- 長時間作業 → TaskRuntime（`run_script` background、`monitor`、`scheduler_*`）。
- 詳細：`references/agents-and-plugins.md`。

## CLI（`@hip/cli`）

**起動済み** hip アプリへのアタッチ専用（共有 sidecar + `~/.hip`）。製品 sidecar は起動しない。

```bash
yarn cli:dev doctor
yarn cli:dev config auth-status
yarn cli:dev session list
yarn cli:dev run --stream none --json "Reply with exactly: pong"
yarn cli:dev repl --cwd .
```

アプリ未起動時は `APP_NOT_RUNNING`。

## プロジェクト指導ファイル

`AGENTS.md` / `Claude.md` / `.hip` があれば製品より**プロジェクト**規約を優先。

## Level 3 参照

- メモリ → `references/memory.md`
- 設定とデータ → `references/config-and-data.md`
- トラブルシュート → `references/troubleshooting.md`
- エージェント・プラグイン・MCP・TaskRuntime → `references/agents-and-plugins.md`
