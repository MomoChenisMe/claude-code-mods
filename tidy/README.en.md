# tidy: fold away Claude Code's work in progress

[繁體中文](README.md)

Each turn keeps only your message and Claude's final answer. The tool calls, thinking and progress notes in between fold into one line, `› 處理了 N 秒` ("worked for N seconds"), that opens on a click:

![tidy screenshot: your message, the folded "›" line, and the final answer marked with ✻](docs/collapsed.png)

- **Your message**: keeps Claude Code's own grey style. tidy does not change it.
- **The work**: tool calls and results, thinking that the screen shows, and the notes written between tool calls all fold into the `› 處理了 N 秒` line.
  - While Claude works, the line tells what it does now. While a tool runs, it names the tool and its argument: `› 處理中 · 執行：Run the tests` ("working · run: …"), `› 處理中 · 讀取 register.tsx` ("working · read …"); with several tools at once it adds "等 n 項" ("and n more"). After a tool finishes, the line keeps the latest step until the next tool starts or the model writes a new note (it then shows the first sentence of that note or thinking). A long line is cut to fit one row.
  - When a tool fails, the line adds the count: `› 處理了 1 分 23 秒 · 1 個錯誤` ("1 min 23 s · 1 error").
  - The `(ctrl+b to run in background)` hint under a running command folds away too.
  - A subagent's report (`Message from @…`) and the notice that a background task finished (`Agent "…" finished`, `Background command "…" completed`) fold in too. One that arrives while Claude works folds into that turn. A finish notice that arrives after the answer folds into the turn that started the task.
  - The `Worked for …` line at the end of each turn is hidden, because the time is already on the folded line.
- **Expand**: click `›` and it turns into `⌄`. The work shows as Claude Code draws it, indented two cells under the line. Click again to fold it.
- **Final answer**: the text after the last tool call. Its leading dot becomes a bold orange `✻`, and wrapped lines indent two cells to align.
- **Subagent reports**: a report that arrives after the answer starts a new turn, so it stays in the conversation as a one-row card: `◆ Explore · Review Standards axis · 完成 2 分 17 秒  › 回報` (the type, the task description, and the status and time from the finish notice; 完成 means "done", 回報 means "report"). Click the row to show the full report under it, indented two cells; Claude Code gives the opened message a light grey background. Click again to fold it. When the subagent failed or was stopped, the `◆` and the status are red.

Expanded:

![tidy screenshot: after a click, the work is indented under the "⌄" line](docs/expanded.png)

A subagent report card, and the next turn at work with `› 處理中 · 執行：…`:

![tidy screenshot: a subagent report drawn as a one-row card; in the next turn, the line names the command that runs](docs/working.png)

The report card after a click:

![tidy screenshot: after a click, the full report is indented two cells under the card](docs/report.png)

The labels are in Traditional Chinese for now.

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
