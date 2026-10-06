# statusbar: a usage status line for Claude Code

[繁體中文](README.md)

It adds one status line under the Claude Code prompt, in any project:

```
 Opus 5.5   xhigh    ctx ▰▰▰▰▱▱▱▱▱▱  38%  ⇣ compact   5h ▰▰▰▱▱▱▱▱  41%  ↻18:30    7d ▰▱▱▱▱▱▱▱  12%  ↻Mon 09:00
```

- **Model and effort**: pills. The effort pill has the color of its level: low green, medium yellow, high orange, xhigh and max red. They change at once after `/model` or `/effort`.
- **ctx**: how much of the context window the conversation uses.
- **⇣ compact**: the button next to ctx. A press does what `/compact` typed in the prompt does; while the model replies, it waits for the turn to end.
- **5h and 7d**: the 5-hour and weekly usage limits, followed by the reset time. Only subscription accounts have them.
- Each percentage has the color of its level: below 50% green, below 75% yellow, below 90% orange, else red.
- Claude Code's own hint line (`? for shortcuts`, the mode labels) stays below it.

## Requirements

- Claude Code 2.1.290 or later (tested on this version). The mod API is early access, so a Claude Code release can make an update of this mod necessary.

## Install

In the Claude Code prompt, type:

```
/plugin install statusbar --marketplace MomoChenisMe/claude-code-mods
```

The first time, Claude Code asks to add the `github:MomoChenisMe/claude-code-mods` marketplace: answer `y`, and pick the user scope so that every project loads it.

It is not the `statusLine` setting in settings.json, and the two can show together. To see only one line, remove `statusLine`.

## Known limits

- One press of the compact button compacts the conversation. There is no confirmation step.
- After `/model`, the model name changes at once. The `/model` output has no effort, so the effort pill changes when you send the next message.
- The effort comes from the English output of `/effort`, `Set effort level to …`. If Claude Code changes this text, the effort pill changes when you send the next message.

## Development

```bash
claude plugin validate statusbar
claude plugin test statusbar
```

For local development, see the [repository README](../README.en.md#development).
