# tidy: fold away Claude Code's work in progress

[繁體中文](README.md)

Each turn keeps only your message and Claude's final answer. The work in between folds into one line that opens on a click. The labels are in Traditional Chinese for now.

## Features

### 1. The work folds into one line

Tool calls and results, thinking that the screen shows, and the notes written between tool calls all fold into the `› 處理了 N 秒` line ("worked for N seconds").

![tidy screenshot: your message, the folded "›" line, and the final answer marked with ✻](docs/collapsed.png)

- **Your message**: keeps Claude Code's own grey style. tidy does not change it.
- **Final answer**: the text after the last tool call. Its leading dot becomes a bold orange `✻`, and wrapped lines indent two cells to align.
- When a tool fails, the line adds the count: `› 處理了 1 分 23 秒 · 1 個錯誤` ("1 min 23 s · 1 error").
- The `Worked for …` line at the end of each turn is hidden, because the time is already on the folded line.

### 2. Open the work

Click `›` and it turns into `⌄`. The work shows as Claude Code draws it, indented two cells under the line. Click again to fold it.

![tidy screenshot: after a click, the work is indented under the "⌄" line](docs/expanded.png)

### 3. The current step while Claude works

While Claude works, the line reads `› 處理中 · <current step>` ("working · …"):

![tidy screenshot: while Claude works, the line reads "處理中 · 執行：Wait ten seconds"](docs/working.png)

- While a tool runs, the line names the tool and its argument, for example `執行：Run the tests` ("run: …") or `讀取 register.tsx` ("read …"). With several tools at once it adds "等 n 項" ("and n more").
- After a tool finishes, the line keeps the latest step until the next tool starts or the model writes a new note (it then shows the first sentence of that note or thinking).
- A long line is cut to fit one row.

### 4. Subagent report cards

A subagent report that arrives after the answer starts a new turn, so it stays in the conversation as a one-row card: the type, the task description, and the status and time from the finish notice (完成 means "done", 回報 means "report").

![tidy screenshot: a subagent report drawn as the one-row card "◆ Explore · 整理 statusbar 的按鈕 · 完成 5 秒 › 回報"](docs/card.png)

Click the row to show the full report under it, indented two cells; Claude Code gives the opened message a light grey background. Click again to fold it. When the subagent failed or was stopped, the `◆` and the status are red.

![tidy screenshot: after a click, the full report is indented two cells under the card](docs/report.png)

### 5. Other rows that fold away

- The `(ctrl+b to run in background)` hint under a running command.
- A subagent report (`Message from @…`) that arrives while Claude works. It folds into that turn.
- The notice that a background task finished (`Agent "…" finished`, `Background command "…" completed`). One that arrives while Claude works folds into that turn. One that arrives after the answer folds into the turn that started the task.

## Requirements

- Claude Code 2.1.290 or later (tested with 2.1.291 and 2.1.292). The mod API is in early access, so this mod may need an update when Claude Code changes.
- Clicking `›` needs Claude Code's fullscreen layout (`"tui": "fullscreen"` in settings.json). Without it the work still folds, but the click does nothing.

## Install

Type this in the Claude Code prompt:

```
/plugin install tidy --marketplace MomoChenisMe/claude-code-mods
```

The first time, Claude Code asks whether to add the `github:MomoChenisMe/claude-code-mods` marketplace. Answer `y`, and pick the user scope so every project loads it.

To stop using it, disable tidy in `/plugin`. The screen goes back to how Claude Code draws it.

## Known limits

- tidy only folds the conversation after it loads. Rows that were on screen before it loaded, and old conversations you bring back with `--resume`, stay as they were.
- When the model has just written a sentence and has not called a tool yet, tidy cannot tell whether it is the final answer, so it shows it as the answer first. When the tool starts, the sentence folds into `›`.
- Permission prompts, question dialogs and slash command output show as usual.
- When Claude starts several subagents at once, Claude Code draws them as one `N background agents launched` row. A mod cannot draw over that row, so it stays. In such a turn, the `›` line shows above the answer.
- The `※ recap:` summary that shows when you come back after some time is also drawn by Claude Code itself and stays. To turn it off, use `/config`.
- tidy changes the drawing only: the transcript, the full record that `ctrl+o` opens and what the model reads stay the same.

## Development

```bash
claude plugin validate tidy
claude plugin test tidy
```

See the [repo README](../README.en.md#development) for local development.
