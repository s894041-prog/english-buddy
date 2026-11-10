# agents.md – 專案藍圖：姐姐英語對話機器人

## 目標
- 幫姐姐做一個**免費**的線上英語家教對話機器人
- 每天使用約 **10 分鐘**
- 畫面上有虛擬機器人跟女兒對話
- 主題：學校課本內容、每周一句…等
- 對話顯示**中英文字幕**，AI 會幫忙修正錯誤
- 念錯時：給正確念法，請她**再念一次**
- API 一律用免費方案（Groq 等）

## 技術架構（全部免費）

| 功能 | 技術 | 備註 |
|---|---|---|
| 前端 + 機器人 | 單一 HTML 網頁 + SVG/CSS 動畫機器人（講話時嘴巴動） | 部署 GitHub Pages，平板/電腦開網址即可 |
| 機器人說英文（TTS） | 瀏覽器內建 `speechSynthesis` | 免費零延遲；Edge 的 Natural 語音最自然 |
| 聽女兒說話（STT） | Groq Whisper `whisper-large-v3-turbo` | 免費額度遠超每天 10 分鐘用量 |
| 對話 / 糾錯 / 翻譯 | Groq `openai/gpt-oss-120b`（主）/ `qwen/qwen3.8-27b`（快，備援） | 回傳 JSON：`{reply_en, reply_zh, corrections, retry_sentence}`；llama-3.3 已下架（2026-11-10 實測） |
| 進階 TTS（選配） | Groq `canopylabs/orpheus-v1-english` | 比 iPad 內建語音更自然，免費額度較小，可用於每周一句示範音 |
| API key 保護 | Cloudflare Worker 中繼（免費） | key 不能寫在前端 |
| 教材 | `lessons.json`（課本單元 + 每周一句） | 由爸爸填寫，AI 只在範圍內出題/聊天 |

## ⚠️ 關鍵技術風險：發音判斷
- Whisper / Web Speech API 都會「腦補」：念 "tree" 常被聽成 "three"，**不適合直接當發音評分**
- **Level 1（MVP）跟讀比對**：目標句已知 → STT 結果與目標句逐字 diff → 標紅錯字 → 請她重念（抓得到漏字、念錯字、念不出來）
- **Level 2（進階）Azure Pronunciation Assessment**：音素級評分（th→s 也抓得到），免費 F0 每月 5 小時，實際用量約 1~2 小時；需註冊 Azure（可能要信用卡）

## 每日 10 分鐘流程
1. 暖身（2 分）：複習上次念錯的字
2. 本週一句（3 分）：跟讀 → 情境對話
3. 課本單元（4 分）：問答練習，AI 即時糾正文法
4. 收尾（1 分）：拿星星、顯示今日錯字

## 加值功能（建議）
- 按住說話（Push-to-talk），避免小孩停頓被切斷
- 錯字本（localStorage）+ 間隔重複複習
- 家長報表：每日練習時間、錯字
- 中文字幕開關（程度好可先隱藏）
- 系統提示限定話題，避免聊歪
- 10 分鐘計時器，時間到機器人說掰掰

## 待確認問題
- [x] 使用者：**姐姐五年級、妹妹三年級** → 做雙角色切換（各自難度、各自錯字本）
- [x] 每周一句：學校公布，第 1~9 句已存入 `lessons.json`；目前週次 7~9；11/11 有 PK（第 1~6 句）→ 加「PK 衝刺模式」
- [x] 裝置：**iPad**（Safari / 加入主畫面）
- [x] Groq key：**申請一個就好**（額度以帳號/組織計，兩把 key 共用額度；兩人每日用量遠低於免費上限）
- [ ] 課本版本（姐姐 / 妹妹各是哪一版？）→ 提供電子書網址，由 AI 用瀏覽器讀取擷取單字/句型
- [ ] 是否需要協助申請 Cloudflare 帳號？

## iPad 注意事項
- 錄音用 `MediaRecorder` → iOS 輸出 `audio/mp4`，Groq Whisper 可直接吃
- `speechSynthesis` 首次播放必須由使用者點擊觸發（加「開始」按鈕）
- 建議到 設定 > 輔助使用 > 朗讀內容 > 聲音 > 英文，下載 Ava / Samantha（加強版）語音，音質大幅提升
- 不依賴 Web Speech 語音辨識（iOS 上不穩），統一走 Groq Whisper
- 課本內容有版權：若部署公開 GitHub Pages，教材 JSON 會被公開 → 考慮 Cloudflare Pages + 簡單密碼

## 任務清單 (TODO)
### Phase 1 – MVP
- [ ] 建立專案結構（`index.html`、`lessons.json`、`worker/`）
- [ ] SVG 機器人 + 說話嘴型動畫
- [ ] TTS 朗讀 + 中英字幕顯示
- [ ] 按住說話錄音 → Groq Whisper 轉文字
- [ ] 跟讀逐字比對 + 錯字標紅 + 請她重念
- [ ] Groq LLM 對話 / 糾錯 / 中文翻譯（JSON 輸出）
- [ ] Cloudflare Worker 中繼保護 API key
- [ ] 填入一個課本單元 + 本週一句做測試
- [ ] 讓姐姐試玩，收集回饋

### Phase 2 – 增強
- [ ] 每日 10 分鐘流程 + 計時器
- [ ] 錯字本 + 間隔重複
- [ ] 星星獎勵
- [ ] 家長報表
- [ ] 部署 GitHub Pages

### Phase 3 – 進階
- [ ] Azure Pronunciation Assessment 音素級發音評分
- [ ] 中文字幕開關 / 難度分級
