# handoff.md – 交接日誌

## 最近一次收工

* 日期：尚未收工
* 電腦：尚未收工
* 完成項目：無
* 未完成項目：見 agents.md

## 開工紀錄 – 2026-11-10 17:24

* 專案初始化，建立 agents.md / handoff.md / README.md
* 完成需求討論與技術規劃（全免費架構：GitHub Pages + 瀏覽器 TTS + Groq Whisper/LLM + Cloudflare Worker）
* 確認關鍵風險：STT 會腦補，MVP 先用「跟讀逐字比對」判斷念錯，進階再接 Azure 發音評分
* 下一步：回答 agents.md 的「待確認問題」→ 開始 Phase 1 MVP
* Groq API key 已設定（存於 .dev.vars 與使用者環境變數 GROQ_API_KEY，不寫入任何 md）

## 工作紀錄 – 2026-11-10 17:43
* 完成 PK 練習版 MVP：跟我念 / 中翻英 / PK 挑戰（15 秒、兩次機會、計分星星）
* Groq：whisper-large-v3-turbo 辨識 + gpt-oss-120b 念錯小提示（llama-3.3 已下架）
* 推上 GitHub：s894041-prog/english-buddy，Pages 已開
* iPad key 用 QR（網址 #key=）匯入 localStorage，QR 圖不在 repo
* 待辦：姐姐試玩回饋、課本電子書、Cloudflare Worker
