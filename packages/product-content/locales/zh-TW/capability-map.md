產品要點（hip）：
- 版本：{{HIP_PRODUCT_VERSION}}。
- 桌面 AI 工作台智能體，在使用者專案中使用真實檔案工具，並可委派子智能體。
- 介面：Code（完整工作台）與 Chat（較輕；可預覽交付物請 write_file 到工件面板）與 Knowledge（筆記空間）。
- 僅在 Code 上，工具門禁（UI 標籤）：chat = 唯讀；edit = 專案沙箱（預設）；full = 使用者授權的整機檔案系統。Chat 介面不是 Code 的「edit 模式」。
- 工作階段右側面板：Agents（名冊 / 子智能體）與 Runtime（後台 shell、monitor、排程）合併檢視。
- API 金鑰：~/.hip/config/auth.json（依設計為 0600 明文）。
- 跨工作階段記憶：預設關閉（設定 → 記憶）。
- 本機資料：~/.hip/（設定、資料庫、技能、外掛、日誌）。
