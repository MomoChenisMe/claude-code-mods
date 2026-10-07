# tidy：把 Claude Code 的工作過程收起來

[English](README.en.md)

每一輪只留下你的訊息和 Claude 的最後回覆，中間的過程收成一行，點一下才展開。

## 功能

### 1. 過程收成一行

工具呼叫和結果、畫在畫面上的思考內容，以及工具之間的說明文字，全部收進 `› 處理了 N 秒` 這一行。

![tidy 截圖：你的訊息、收起來的「› 處理了」一行、開頭標著 ✻ 的最後回覆](docs/collapsed.png)

- **你的訊息**：維持 Claude Code 原本的灰底樣式，tidy 不改。
- **最後回覆**：最後一次工具呼叫之後的文字。開頭的圓點換成橘色粗體的 `✻`，換行的部分縮排兩格對齊。
- 有工具出錯時寫成 `› 處理了 1 分 23 秒 · 1 個錯誤`。
- **問你問題時**（AskUserQuestion、批准計畫的 ExitPlanMode）：問題，以及緊接在它前面的說明，照原樣留在對話裡，不收進這一行；等你回答時這一行寫 `› 處理中 · 等你回答`。
- 原本每輪結尾的 `Worked for …` 不再顯示，因為時間已經寫在這一行。

### 2. 點開看過程

點 `›` 變成 `⌄`，過程照原樣顯示，縮排兩格放在這一行底下。再點一次就收起來。

![tidy 截圖：點開後，過程縮排在「⌄ 處理了」底下](docs/expanded.png)

### 3. 工作中顯示目前的動作

Claude 還在工作時，這一行寫成 `› 處理中 · 目前的動作`：

![tidy 截圖：工作中的標頭寫著「處理中 · 執行：Wait ten seconds」](docs/working.png)

- 工具在跑時寫工具和參數，例如 `執行：Run the tests`、`讀取 register.tsx`。同時跑好幾個時加上「等 n 項」。
- 工具跑完後保留最近一個動作，直到下一個工具開始，或模型寫出新的說明（顯示說明或思考的第一句）。
- 太長時截成一行。

### 4. subagent 回報卡片

回答之後才送來的 subagent 回報會讓 Claude 開始新的一輪，所以留在對話裡，畫成一行卡片：類型、任務說明，以及完成通知帶來的狀態和時間。

![tidy 截圖：subagent 的回報畫成一行卡片「◆ Explore · 整理 statusbar 的按鈕 · 完成 5 秒 › 回報」](docs/card.png)

點一下這一列，回報全文縮排兩格展開在底下（Claude Code 會替展開的這一則加上淺灰底）；再點一下收起。subagent 失敗或被停止時，`◆` 和狀態是紅色。

![tidy 截圖：點一下卡片，回報全文縮排兩格展開在底下](docs/report.png)

### 5. 其他一起收起來的列

- 執行中指令下方的 `(ctrl+b to run in background)` 提示。
- 工作中送來的 subagent 回報（`Message from @…`），收進這一輪。
- 背景工作完成的通知（`Agent "…" finished`、`Background command "…" completed`）：工作中送來的收進這一輪；回答之後才送來的，收進開這個工作的那一輪。

## 需求

- Claude Code 2.1.290 以上（以 2.1.291、2.1.292 測試）。mod 的 API 目前是 early access，Claude Code 改版時，這個 mod 可能要跟著更新。
- 用滑鼠點 `›` 展開需要 Claude Code 的全螢幕版面（settings.json 的 `"tui": "fullscreen"`）。沒開全螢幕時，過程一樣會收起來，只是點了沒有反應。

## 安裝

在 Claude Code 的輸入框輸入：

```
/plugin install tidy --marketplace MomoChenisMe/claude-code-mods
```

第一次會問要不要加入 `github:MomoChenisMe/claude-code-mods` 這個 marketplace，回答 `y`；範圍選 user，每個專案都會載入。

不想用時，執行 `/plugin` 把 tidy 停用，畫面就恢復原樣。

## 已知限制

- 只整理載入 tidy 之後的對話：載入前就在畫面上的列，以及用 `--resume` 接回的舊對話，維持原樣。
- 模型剛寫出一句話、還沒開始呼叫工具時，還不知道這句話是不是最後的回覆，所以會先當成回覆顯示。工具一開始跑，它就收進 `›`。
- 權限詢問、問答視窗、斜線指令的輸出照常顯示。
- 同時開好幾個 subagent 時，Claude Code 把它們畫成一列 `N background agents launched`。這一列 mod 畫不到，收不起來；這種輪次的 `› 處理了` 會畫在回答上面。
- 離開一陣子回來時出現的 `※ recap:` 摘要也是 Claude Code 自己畫的，收不起來。不想看可以在 `/config` 關掉 recap。
- 只改畫面：對話紀錄、`ctrl+o` 打開的完整紀錄、模型讀到的內容都不變。

## 開發

```bash
claude plugin validate tidy
claude plugin test tidy
```

本機開發方式見 [repo 的 README](../README.md#開發)。
