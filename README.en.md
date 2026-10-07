# claude-code-mods

[繁體中文](README.md)

My mods for Claude Code. This repository is a Claude Code marketplace. It is not an official Anthropic project.

## Mods

| Mod | What it does |
| --- | --- |
| [statusbar](statusbar/README.en.md) | Status rows under the prompt: model, effort, and context, 5-hour, 7-day and Fable usage |
| [tidy](tidy/README.en.md) | Folds each turn's tool calls and thinking into one line, keeping your message and the final answer |

### statusbar

The two rows under the prompt: the model and effort on the left, and the context, 7-day, 5-hour and Fable usage on the right.

![statusbar screenshot: two rows under the prompt, with the model and effort on the left and the ctx, 7d, 5h and Fable usage bars on the right](statusbar/docs/screenshot.png)

### tidy

The `› 處理了 15 秒` line ("worked for 15 seconds") in the middle is the folded work; a click opens it. The text marked with `✻` below it is the final answer.

![tidy screenshot: your message, the folded "› 處理了 15 秒" line, and the final answer marked with ✻](tidy/docs/collapsed.png)

## Install

In the Claude Code prompt, type (replace `<mod>` with a name from the table):

```
/plugin install <mod> --marketplace MomoChenisMe/claude-code-mods
```

The first time, Claude Code asks to add the `github:MomoChenisMe/claude-code-mods` marketplace: answer `y`, and pick the user scope so that every project loads it.

Update: run `claude plugin update <mod>`, then restart Claude Code.

## Requirements

- Claude Code 2.1.290 or later (tested on this version). The mod API is early access, so a Claude Code release can make an update of a mod necessary.

## Development

Each mod is one folder: `.claude-plugin/plugin.json`, `hooks/` (the code), `types/` (the state types) and `tests/`.

```bash
claude plugin validate <mod>
claude plugin test <mod>
```

For local work, add this repository as a local marketplace and install from it. Claude Code then reads the working tree, and `/reload-plugins` applies an edit:

```bash
claude plugin marketplace add <path to this repository>
claude plugin install <mod>@claude-code-mods
```

After Claude Code loads a mod, it writes type files into `<mod>/.claude-plugin/types/` (ignored by git). Then `tsc -p <mod>` with TypeScript type-checks the mod.

To add a mod: make a new folder, and add an entry to `plugins` in `.claude-plugin/marketplace.json`.
