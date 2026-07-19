# hip

[English](./README.md) | [简体中文](./README.zh-CN.md) | [繁體中文](./README.zh-TW.md) | **日本語** | [한국어](./README.ko.md)

**hip** はデスクトップAIワークベンチです（Claude Code Desktop / Codex Desktop の思想に基づく）。Tauriシェル、React UI、Node.jsサイドカーで構成され、プロジェクト内で [LangGraph](https://langchain-ai.github.io/langgraphjs/) エージェントを実行します。

各UIタブは独立したセッションです。製品デフォルトは **Supervisor ReAct** ループです。エージェントはツールを使用し、`task` / `dispatch_agent` / `task_batch` を介して委譲するタイミングを決定します。通常のターンでは **Planner → Coder → Reviewer** パイプラインは強制されません。

## ハイライト

| 領域 | 説明 |
|------|----------------|
| **サーフェス** | **Code** — 完全なプロジェクトワークベンチ（ファイル、gitガイダンス、MCP、ツール）。**Chat** — より軽量な会話。成果物をプレビュー可能な形でワークスペースに書き込み、アーティファクトパネルに表示します。 |
| **権限** | **edit**（デフォルト、プロジェクトサンドボックス）、**chat**（読み取り専用）、**full**（ユーザーが許可した全ファイルシステム）。 |
| **エージェント** | Supervisor とロスターエージェント（**explore** / **plan** / **coder**）。エージェント駆動の分離と、`task_batch` による真の並列処理。 |
| **拡張性** | スキル（`SKILL.md`）、プラグイン、MCPサーバー、フック — グローバルは `~/.hip/`、プロジェクトは `.hip/` 配下。 |
| **メモリ** | セッション間メモリは **デフォルトでオフ**。**Settings → Memory** で有効化。 |
| **CLI** | アタッチ専用の `@hip/cli`。**実行中**のデスクトップアプリに接続（`doctor`、`session`、`run`、`repl`）。 |
| **ローカルファースト** | 設定、SQLite DB、スキル、プラグイン、ログは `~/.hip/` 配下に保存。 |

## アーキテクチャ

実行時には3つのプロセスが通信します。

| プロセス | ランタイム | 役割 |
|---------|---------|------|
| **Tauri Shell** | Rust（`src-tauri/`） | ウィンドウ管理、サイドカーのライフサイクル、`get_sidecar_port` コマンド |
| **フロントエンド** | React + Vite（`src/`） | タブ、チャット、エージェント実行ツリー |
| **サイドカー** | Node.js（`packages/sidecar/`） | LangGraph エージェントランタイム、WebSocket サーバー |

Tauriシェルは起動時にサイドカーを生成します（`tauri-plugin-shell` のサイドカー機構を使用）。サイドカーは空きポートにWebSocketサーバーをバインドし、`{"port":NNNN}` をstdoutに出力します。Rustがこれをキャプチャし、`get_sidecar_port` コマンドで公開します。フロントエンドは `ws://localhost:NNNN` に接続します。

### 委譲エントリ（エージェントランタイム）

製品のターンは3つのパスのいずれかに入ります。**明示的な**ワークフロー定義のみがデフォルトのReActループを無効にします。セッションの `orchMode` はルーティングに使用されません（UIトグルは削除済み、APIは非推奨のまま）。

| エントリ | タイミング | 動作 |
|-------|------|----------|
| **デフォルト ReAct + task/dispatch** | 通常の `message:send`（保留中のワークフローなし） | Supervisor ReAct グラフ（`buildGraph`）。`task` / `dispatch_agent` によるエージェント駆動の分離。1つの `task_batch` による**真の並列**マルチパートリサーチ（オプションでタスクごとに `agent` 指定可能、デフォルトの同時実行数は4）。逐次的な `dispatch_agent` よりも `task_batch` を推奨。 |
| **明示的 DAG** | `pendingWorkflowDef` が設定されている、または `workflow:run` | Orchestrator / workflow-runner DAG。モードフラグでは強制されません。組み込みのクラスタテンプレート（例：planner→coder）は内部/テスト用ヘルパーのみです。 |
| **マルチエージェントハンドオフ** | オプション / 非デフォルトの呼び出し元 | `multi-agent-graph` ハンドオフ（`handoff_to_*`）構成。実験的なサーフェスであり、製品デフォルトのセッションパスではありません。 |

これは **yarn workspaces** モノレポです。

```
packages/protocol/   @hip/protocol — 共有 WebSocket メッセージ型
packages/sidecar/    @hip/sidecar  — LangGraph WS サーバー
packages/cli/        @hip/cli      — アタッチ専用製品CLI
packages/product-content/  エージェント埋め込み + 設定ヘルプのロケール
src/                 React フロントエンド
src-tauri/           Rust シェル
```

## 開発環境のセットアップ

> APIキー（例：DeepSeek）はアプリの **Settings** パネルで入力し、
> `~/.hip/config/auth.json`（ファイルモード `0600`）に保存されます。これが唯一の情報源です。
> デスクトップアプリ、スタンドアロンサイドカー（`scripts/dev.sh start sidecar`）、
> テストスイートはすべてここからキーを読み取ります。**`~/.hip/config/` には平文のAPIキーが保存されます。クラウドドライブやドットファイルリポジトリと同期しないでください。**

### 前提条件

- Node.js + [Yarn](https://yarnpkg.com/)（workspaces）
- Rust ツールチェーン（Tauri用）
- [Tauri v2](https://v2.tauri.app/start/prerequisites/) のプラットフォーム依存関係

### クイックスタート

```bash
# 1. ワークスペースの依存関係をインストール
yarn install

# 2. 開発モードのサイドカーラッパーを生成（初回のみ、ツールチェーン変更後も実行）。
#    src-tauri/binaries/ は gitignore されたビルドアーティファクトディレクトリのため、
#    Rustビルドがサイドカーを解決できるようにするにはこの手順が必要です。
yarn sidecar:dev-bin

# 3. アプリを実行（Vite、サイドカー、Tauriウィンドウを起動）
yarn tauri dev
```

その後、**Settings** を開き、プロバイダのAPIキーを追加し、**Code** または **Chat** サーフェスでセッションを開始します。

### LangSmith トレーシング（オプション）

サイドカーで実行される LangGraph / LangChain は [LangSmith](https://smith.langchain.com/) にトレースをエクスポートできます。トレーシングは **デフォルトでオフ** です。

**推奨方法:** `~/.hip/config/hip.toml` に設定を記述します（サイドカー起動時に `HIP_CONFIG_PATH` 経由で読み込まれます）。

```toml
[langsmith]
enabled = true
api_key = "lsv2_…"                                    # LangSmith設定から取得
project = "hip"
endpoint = "https://eu.api.smith.langchain.com"       # EUのみ。USクラウドの場合は省略
```

プロジェクトレベルの `.hip/hip.toml` でグローバルセクション全体を上書きできます（`[agentLoop]` と同じマージルール）。

**上書き:** プロセス環境変数がすでに設定されている場合はそちらが優先されます（`LANGSMITH_TRACING`、`LANGSMITH_API_KEY`、`LANGSMITH_PROJECT`、`LANGSMITH_ENDPOINT`、およびレガシー `LANGCHAIN_*` エイリアス）。Tauriはこれらをサイドカーに転送します。

各ユーザーターンは1つのルートトレースになります。同じhipセッションのマルチターン実行は、`metadata.thread_id` / `metadata.session_id`（= セッションID）を介して1つのLangSmith **Thread** にグループ化されます。ルート実行の **name** もセッションIDです。LLMスパンは `hip.model` という名前になります。`api_key` をgitに含めないでください。hip.toml は `~/.hip/config/` 配下にあります（このディレクトリを公開クラウド/ドットファイルリポジトリと同期しないでください）。

### ACP ホストポリシー（オプション）

セッションが外部ACPエージェント（OpenCode、Claude Code、Grok Buildなど）を使用する場合、hipはACP **クライアント**として動作します。ホスト側のポリシーは `hip.toml` の `[acp]` セクションに記述します。

```toml
[acp]
fsBridge = true          # fs/read_text_file と fs/write_text_file をアドバタイズおよび提供（デフォルト true）
forwardMcp = false       # 有効な hip/plugin MCP サーバーを session/new に転送（デフォルト false）
fsReadMaxBytes = 2000000 # fs/read_text_file あたりの最大バイト数（デフォルト 2_000_000）
```

スネークケースのエイリアス（`fs_bridge`、`forward_mcp`、`fs_read_max_bytes`）も受け入れられます。プロジェクトの `.hip/hip.toml` はグローバルの `[acp]` セクションを**全体置換**します（`[langsmith]` と同じルール）。

**MCP転送のセキュリティ注意:** `forwardMcp` はデフォルトで **false** です。これにより、hipがMCPコマンド、環境変数、HTTPヘッダー（APIキーを含む）を外部エージェントプロセスに黙って渡すことを防ぎます。`true` に設定すると、hip.toml の `mcpServers` から有効なサーバーと有効なプラグインがACPの `session/new` / `session/load` にマッピングされます（`stdio` は常に、`http`/`sse` はエージェントがそれらのMCP機能をアドバタイズしている場合のみ）。hipのツール許可/拒否リスト（`enabledTools` / `disabledTools`）は**転送されません**。エージェントは完全なMCPサーフェスを参照します。

### ローカルデータレイアウト（`~/.hip/`）

| パス | 目的 |
|------|---------|
| `~/.hip/config/` | `auth.json`、`hip.toml`、ネットワークポリシー（該当する場合はモード `0600`） |
| `~/.hip/db/hip.db` | SQLite セッション、メッセージ、エージェント実行、ツール、イベント |
| `~/.hip/data/tool-output/` | 大きなツール出力（DB外に保持） |
| `~/.hip/logs/` | サイドカー / Tauri ログ |
| `~/.hip/skills/`、`plugins/`、`scratch/` | スキル、プラグイン、インストールスクラッチ |
| `~/.hip/memories/` | メモリ有効時のMarkdownエクスポートミラー |
| `~/.hip/trash/` | 製品のごみ箱隔離（Knowledge FSペイロード。セッションはSQLiteの `deleted_at` を使用） |

### ごみ箱（ソフトデリート）

**デスクトップUI**で、Chat/CodeセッションやKnowledgeスペース/ドキュメントを削除すると、**ごみ箱**（サイドバー、履歴の上）に移動します。アイテムは復元または完全削除できます。保持期間が経過すると自動的に削除されます。

| 設定 | 場所 |
|---------|----------|
| 保持日数（デフォルト **7**、範囲 1–365） | **Settings → General**、または `~/.hip/config/hip.toml` → `[trash] retentionDays = 7` |

- **UI削除** → ソフトデリート（復元可能）。
- **CLI** `hip session delete <id> --yes` → **完全な**ハードデリート（ごみ箱を使用しません）。
- **メモリ**のごみ箱は **Settings → Memory** 配下にあります（別途30日デフォルト）。

```bash
# オプション：大規模な完全削除後に空きページを再利用（アプリを閉じている必要があります）
sqlite3 ~/.hip/db/hip.db 'VACUUM;'
```

### 便利なスクリプト

| コマンド | 説明 |
|---------|-------------|
| `yarn tauri dev` | フルデスクトップアプリを開発モードで実行 |
| `yarn sidecar:dev` | サイドカーWSサーバーをスタンドアロンで実行（ポートを表示） |
| `yarn sidecar:dev-bin` | `src-tauri/binaries/` に開発用サイドカーラッパーを（再）生成 |
| `yarn cli:dev` | 製品CLI（`hip doctor` / `session` / `run` / `repl`）— **実行中のhipアプリが必要** |
| `yarn cli:test` | CLI単体テスト（有料LLM不要） |
| `yarn type-check` | フロントエンドの型チェック |
| `yarn workspace @hip/sidecar type-check` | サイドカーの型チェック |
| `yarn test` | フロントエンド + 単体テスト（Vitest） |
| `yarn product:content` | エージェント/UI製品コンテンツの埋め込みを再生成 |

### 製品CLI（`@hip/cli`）

**実行中**のhipデスクトップアプリにアタッチする専用コンパニオン（共有サイドカー + `~/.hip` データ）。

**別途SDKパッケージはありません**。スクリプトは `hip … --json` を呼び出してください。
CLIは製品サイドカーを**起動しません**。先にアプリを起動してください。そうしないと、コマンドは `APP_NOT_RUNNING`（終了コード3）で失敗します。

```bash
# デスクトップアプリを起動した後：

# ヘルスチェック：ディスカバリファイル + アタッチ + hasApiKey
yarn cli:dev doctor

# 認証キーの有無？（秘密は決して表示しません）
yarn cli:dev config auth-status

# 動作中のアプリに対するワンショット実行（HipRunResult JSON）
yarn cli:dev run --stream none \
  --json --output /tmp/hip-out/result.json \
  "Reply with exactly: pong"

# 人間向けストリームモード：text | tools | all | none
yarn cli:dev run --stream all "summarize README.md"

# セッション（GUIと共有）
yarn cli:dev session list
yarn cli:dev session show <id-prefix> --limit 20
# 完全なハードデリート（UIのごみ箱ではありません）
yarn cli:dev session delete <id> --yes

# インタラクティブなマルチターンREPL（TTY。HITLはGUIが存在する場合はGUIを優先）
yarn cli:dev repl --cwd .
```

| フラグ / コマンド | 意味 |
|----------------|---------|
| `doctor` | アタッチヘルスチェック（実行中のアプリが必要） |
| `--json` / `--output` | `HipRunResult` schemaVersion 1 |
| `--out-dir` | `result.json`、`trace.jsonl`、`patch.diff`、`usage.json` |
| `--stream` | 人間向けトランスクリプト（text \| tools \| all \| none） |
| `--hitl auto` | ツール権限を自動承認（**GUIをバイパス**） |
| `--hitl prompt` | GUIクライアントがない場合、GUIまたはTTYを待機 |
| `session *` | 一覧表示/表示/送信。`session delete` は**完全削除**（UIはソフトデリートでごみ箱へ） |
| `repl` | マルチターンインタラクティブチャット |
| `HIP_CLI_DEV_SPAWN=1` | 開発のみ：分離スパウン（製品DBは使用しない） |

## メモリ

セッション間メモリは **デフォルトでオフ** です。**Settings → Memory** で有効化してください。
SQLiteが情報源です。`~/.hip/memories/` にはMarkdownエクスポートミラーが保存されます。
エージェント向け（およびオプションのメンテナー向け）製品コピー：[packages/product-content/references/memory.md](./packages/product-content/references/memory.md)

## 推奨IDE設定

- [VS Code](https://code.visualstudio.com/) + [Tauri](https://marketplace.visualstudio.com/items?itemName=tauri-apps.tauri-vscode) + [rust-analyzer](https://marketplace.visualstudio.com/items?itemName=rust-lang.rust-analyzer)

## 製品コンテンツ（エージェント埋め込み）

組み込みの製品/コーディングスキルはエージェント用に埋め込まれています（リポジトリの意味でのユーザー向けヘルプページではありません。Settings Helpはローカライズされた本文を使用します）。

情報源（`docs/` 配下ではありません）：

- 製品：[packages/product-content/](./packages/product-content/)
- コーディング/委譲操作スキル：[packages/product-content/ops/](./packages/product-content/ops/)
- UIロケール：`packages/product-content/locales/zh-CN/`、`zh-TW/`、`ja/`、`ko/`

これらのツリーを編集した後、埋め込みを再生成するには：`yarn product:content`

リポジトリルートの `docs/`（存在する場合）はオプションの開発者ノートのみであり、アプリから読み取られることはありません。

## ドキュメントの言語

| 言語 | ファイル |
|----------|------|
| English | [README.md](./README.md) |
| 简体中文 | [README.zh-CN.md](./README.zh-CN.md) |
| 繁體中文 | [README.zh-TW.md](./README.zh-TW.md) |
| 日本語 | [README.ja.md](./README.ja.md) |
| 한국어 | [README.ko.md](./README.ko.md) |

英語がGitHubおよびエージェント向け製品埋め込みのデフォルトです。技術的な識別子（パス、CLIフラグ、ツール名）はロケール間で同一に保ってください。

アプリUI言語（設定 → インターフェース言語）：**English**、**简体中文**、**繁體中文**、**日本語**、**한국어**。
