# hip 故障排除（Level 3）

## API / 模型呼叫失敗

1. 開啟 **設定 → 提供者**，確認已儲存金鑰。
2. 金鑰在 `~/.hip/config/auth.json`（切勿向使用者列印金鑰）。
3. 在 UI 外改鑑權後請重新啟動應用。
4. 查看 `~/.hip/logs/`。

## CLI：`APP_NOT_RUNNING`

請先啟動 hip 桌面應用，再執行 `yarn cli:dev doctor`。

## 開啟記憶後列表仍空

確認使用/產生開關、對話輪次、API 金鑰；可試 **立即學習**。SQLite 是真相來源。

## 智能體無法寫檔

- **chat** 唯讀；**edit** 沙箱在專案根；**full** 需使用者明確授權。

## 技能未列出

可能在 `hip.toml` 停用；內建產品技能 id 為 `hip`（`~/.hip/builtin-skills/hip/`）。

## Sidecar 連線

重新啟動應用；開發時工具鏈變更後執行 `yarn sidecar:dev-bin`。
