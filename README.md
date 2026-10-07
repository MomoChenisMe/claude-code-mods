# claude-code-mods

[English](README.en.md)

我自製的 Claude Code mod 集合。這個 repo 本身就是一個 Claude Code marketplace，非 Anthropic 官方作品。

## mod 清單

| mod | 用途 |
| --- | --- |
| [statusbar](statusbar/README.md) | 輸入框下方的狀態列：模型、effort，以及 ctx、5 小時、7 天、Fable 用量 |
| [tidy](tidy/README.md) | 每一輪的工具呼叫和思考收成一行 `› 處理了 N 秒`，只留下你的訊息和最後回覆 |

![statusbar 截圖](statusbar/docs/screenshot.png)

![tidy 截圖](tidy/docs/collapsed.png)

## 安裝

在 Claude Code 的輸入框輸入（把 `<mod>` 換成上表的名稱）：

```
/plugin install <mod> --marketplace MomoChenisMe/claude-code-mods
```

第一次會問要不要加入 `github:MomoChenisMe/claude-code-mods` 這個 marketplace，回答 `y`；範圍選 user，每個專案都會載入。

更新：執行 `claude plugin update <mod>`，再重開 Claude Code。

## 需求

- Claude Code 2.1.290 以上（以這一版測試）。mod 的 API 目前是 early access，Claude Code 改版時，mod 可能要跟著更新。

## 開發

每個 mod 是一個資料夾：`.claude-plugin/plugin.json`、`hooks/`（程式）、`types/`（狀態值型別）、`tests/`。

```bash
claude plugin validate <mod>
claude plugin test <mod>
```

本機開發時，把這個 repo 加成本地 marketplace 再安裝。Claude Code 會直接讀工作目錄，改完執行 `/reload-plugins` 就生效：

```bash
claude plugin marketplace add <這個 repo 的路徑>
claude plugin install <mod>@claude-code-mods
```

Claude Code 載入 mod 後，會在 `<mod>/.claude-plugin/types/` 產生型別檔（已列入 `.gitignore`）。之後用 TypeScript 執行 `tsc -p <mod>` 就能做型別檢查。

新增 mod：建立新資料夾，再在 `.claude-plugin/marketplace.json` 的 `plugins` 加一筆。
