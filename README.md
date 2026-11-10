# 姐姐英語對話機器人

免費的線上英語練習家教：虛擬機器人陪女兒每天練 10 分鐘英語對話，內容包含課本單元與每周一句，提供中英字幕、錯誤修正與跟讀重念。

## 技術
- 前端：HTML + SVG 機器人（GitHub Pages）
- 語音合成：瀏覽器 `speechSynthesis`
- 語音辨識：Groq Whisper（免費）
- 對話 AI：Groq Llama 3.3 70B（免費）
- API 中繼：Cloudflare Worker（免費）

## 專案管理
此資料夾使用 **local-project-workflow** 管理：
- `agents.md` – 藍圖、架構、任務清單
- `handoff.md` – 開工 / 收工日誌
- `README.md` – 本說明文件

## 工作流程
1. 初始化（已完成）
2. 開工 – 查看上次收工資訊與未完成任務
3. 收工 – 追加收工紀錄、勾選已完成任務
