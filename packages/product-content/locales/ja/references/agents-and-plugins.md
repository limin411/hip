# hip エージェント、プラグイン & MCP（Level 3）

## 組み込みエージェントプロファイル

| プロファイル | 役割 |
|--------------|------|
| **supervisor** | 既定オーケストレータ：ツール、コミット、スクリプト、委任 |
| **plan** | 設計 / 計画向き |
| **explore** | 読み取り専用コード検索 |
| **coder** | 実装寄り（スクリプト可） |

**内部**エージェント：ペルソナ + モデル + ツール権限。  
**外部 / ACP**：別プロセス；製品メモリは既定オフ。

対応 ACP プリセット（設定 → エージェント → ACP 追加）：**OpenCode**、**Grok Build**（`grok agent stdio`）、**Pi**、**Claude Code**、**Codex**。Grok Build はネイティブ ACP（`https://x.ai/cli`）；認証は `grok login` または任意の `XAI_API_KEY`。

ACP の認証とモデルは**自己管理**：hip は provider API キーを ACP 子プロセスに注入しません。

## 機能マトリックス（組み込み vs ACP）

| 機能 | 組み込み primary | ACP primary | ACP サブ（dispatch） |
|------|------------------|-------------|----------------------|
| hip ツール（read / write / run_script …） | あり | なし | なし |
| hip Skills / プラグインフック | あり | なし | なし |
| hip MCP | あり | なし（計画: opt-in 転送） | なし |
| クライアント FS bridge | n/a | なし（stub） | なし |
| dispatch / task / task_batch | あり | なし | なし |
| TaskRuntime（bg shell / monitor / scheduler） | あり | なし | なし |
| クロスセッション Memory 注入 | あり | なし | なし |
| Memory 抽出 | あり | なし | なし |
| hip モデル選択 | あり | なし | なし |
| HITL | hip ツール | ACP `requestPermission` | 同 ACP primary |
| permissionMode | hip ゲート | chat/edit で安全 kind 自動；他は HITL | 親セッション継承 |

**要点:** ACP を primary にすると hip 組み込みツール/スキル/MCP ではなく、対等な別スタックになる。

## 委任 & TaskRuntime ツール（メインエージェント）

| ツール | 用途 |
|--------|------|
| `task` | 単一サブタスク（fg / background） |
| `dispatch_agent` | 名簿エージェント |
| `task_batch` | **2+ 独立サブタスク推奨**（真並列） |
| `run_script`（+ `background:true`） | シェル；長時間は `task_id` |
| `wait_tasks` | バックグラウンド id 待ち |
| `task_output` | これまでの出力を読む |
| `task_stop` | 実行中タスク停止 |
| `monitor` | stdout を UI イベントとして配信（モデルへ自動注入しない） |
| `scheduler_create` / `list` / `delete` | 定期起動（最短 60s） |

メインターンで長時間 shell/CI を sleep ポールしない。

### Runtime パネル（UI）

セッション右パネルは **Agents** と **Runtime** を統合。実行中は chip 表示。

## プラグイン

- 配置: `~/.hip/plugins/`；レジストリ `~/.hip/config/hip-plugins.json`。
- スキル、エージェント、MCP、フックを同梱可。

### Plugin Market（設定）

公式カタログのみ:

| Source id | Catalog |
|-----------|---------|
| `grok-official` | [xai-org/plugin-marketplace](https://github.com/xai-org/plugin-marketplace) |
| `claude-official` | [anthropics/claude-plugins-official](https://github.com/anthropics/claude-plugins-official) |

UI: **Grok market** · **Claude market** · **Custom plugins**。

- キャッシュ: `~/.hip/cache/marketplaces/<sourceId>/`
- ソース切替: `~/.hip/config/marketplace-sources.json`
- ダウンロード既定 `enabled: false`；`boundModel` をレビュー。

### プラグインディレクトリ

必須: `.plugin/plugin.json`（少なくとも `name` / `version`）。

### `hip-plugins.json`

推奨（文字列配列）:

```json
{
  "plugins": ["/absolute/path/to/plugin"],
  "entries": [],
  "enabled": { "my-plugin": true }
}
```

## MCP

- hip.toml / プラグイン合成。
- `mcp_search` 後 `mcp__<server>__<tool>`。
- ネットワークポリシーが出方向を遮断する場合あり。

## スキルスコープ

| スコープ | 場所 |
|----------|------|
| global | `~/.hip/skills/<id>/` |
| project | `.hip/skills/<id>/` |
| plugin | プラグイン内 |
| builtin | `~/.hip/builtin-skills/hip/`（最低優先） |
