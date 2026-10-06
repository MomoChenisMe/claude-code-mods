# statusbar：Claude Code 的用量狀態列

[English](README.en.md)

在 Claude Code 輸入框下方加一行狀態列，任何專案都能用：

![statusbar 截圖：輸入框下方的模型、effort、ctx、compact 鈕、5h、7d](docs/screenshot.png)

- **模型、effort**：膠囊樣式。effort 依等級上色：low 綠、medium 黃、high 橘、xhigh 和 max 紅。用 `/model`、`/effort` 切換後會立刻跟著變。
- **ctx**：這段對話用掉多少上下文視窗。
- **⇣ compact**：ctx 旁邊的按鈕。按下等於在輸入框送出 `/compact`；模型正在回覆時，會排隊等這一輪結束再壓縮。
- **5h、7d**：5 小時與每週的用量額度，後面是重置時間。訂閱帳號才有這兩項。
- 百分比依用量上色：未滿 50% 綠、未滿 75% 黃、未滿 90% 橘、其餘紅。
- Claude Code 自己的提示列（`? for shortcuts`、模式標籤）照常顯示。

## 需求

- Claude Code 2.1.290 以上（以這一版測試）。mod 的 API 目前是 early access，Claude Code 改版時，這個 mod 可能要跟著更新。

## 安裝

在 Claude Code 的輸入框輸入：

```
/plugin install statusbar --marketplace MomoChenisMe/claude-code-mods
```

第一次會問要不要加入 `github:MomoChenisMe/claude-code-mods` 這個 marketplace，回答 `y`；範圍選 user，每個專案都會載入。

它和 settings.json 的 `statusLine` 是兩樣東西，可以同時存在。如果不想看到兩行，就把 `statusLine` 拿掉。

## 已知限制

- compact 鈕按一下就會壓縮對話，沒有確認步驟。
- 切換 `/model` 後，模型名稱立刻變；但 `/model` 的輸出不含 effort，所以 effort 要等下一次送出訊息才更新。
- effort 是從 `/effort` 的英文輸出 `Set effort level to …` 讀出來的。Claude Code 改了這句話時，effort 一樣會在下一次送出訊息時更新。

## 開發

```bash
claude plugin validate statusbar
claude plugin test statusbar
```

本機開發方式見 [repo 的 README](../README.md#開發)。
