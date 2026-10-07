# tidy：把 Claude Code 的工作過程收起來

[English](README.en.md)

每一輪只留下你的訊息和 Claude 的最後回覆。中間的工具呼叫、思考和過程說明收成一行 `› 處理了 N 秒`，點一下才展開：

![tidy 截圖：你的訊息、收起來的「› 處理了」一行、開頭標著 ✻ 的最後回覆](docs/collapsed.png)

- **你的訊息**：維持 Claude Code 原本的灰底樣式，tidy 不改。
- **過程**：工具呼叫和結果、畫在畫面上的思考內容，以及工具之間的說明文字，全部收進 `› 處理了 N 秒` 這一行。
  - 工作中顯示 `› 處理中…`。
  - 有工具出錯時寫成 `› 處理了 1 分 23 秒 · 1 個錯誤`。
  - 執行中指令下方的 `(ctrl+b to run in background)` 提示也一起收起來。
  - 原本每輪結尾的 `Worked for …` 不再顯示，因為時間已經寫在這一行。
- **展開**：點 `›` 變成 `⌄`，過程照原樣顯示，縮排兩格放在這一行底下。再點一次就收起來。
- **最後回覆**：最後一次工具呼叫之後的文字。開頭的圓點換成橘色粗體的 `✻`，換行的部分縮排兩格對齊。

展開後的樣子：

![tidy 截圖：點開後，過程縮排在「⌄ 處理了」底下](docs/expanded.png)

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
- 只改畫面：對話紀錄、`ctrl+o` 打開的完整紀錄、模型讀到的內容都不變。

## 開發

```bash
claude plugin validate tidy
claude plugin test tidy
```

本機開發方式見 [repo 的 README](../README.md#開發)。
