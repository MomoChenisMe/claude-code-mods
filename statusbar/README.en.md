# statusbar: a usage status line for Claude Code

[繁體中文](README.md)

It adds two status rows under the Claude Code prompt, in any project:

![statusbar screenshot: two rows under auto mode, with model/effort, ctx/7d and 5h/Fable columns](docs/screenshot.png)

```
⏵⏵ auto mode on (shift+tab to cycle)
 Opus 5.5 ▾   ctx ▰▰▱▱▱▱▱▱▱▱  24% ▾             5h    ▰▱▱▱▱▱▱▱  9%  ↻19:00
 xhigh ▾      7d  ▰▰▰▱▱▱▱▱▱▱  35%  ↻Sun 05:00   Fable ▰▱▱▱▱▱▱▱  17%  ↻Sun 05:00
```

- **Model and effort**: pills. The model pill is gray. The effort pill has the color of its level: low green, medium yellow, high orange, xhigh and max red. A press on the ▾ after a pill does what `/model` or `/effort` typed in the prompt does: it opens the picker. The pills change at once after a pick.
- **ctx**: how much of the context window the conversation uses. A press on the ▾ after its percentage does what `/compact` typed in the prompt does; while the model replies, it waits for the turn to end.
- **5h and 7d**: the 5-hour and weekly usage limits, followed by the reset time. Only subscription accounts have them.
- **Fable**: the weekly Fable usage, followed by the reset time. It shows only when the account has a Fable limit.
- Each bar has the color of its level: below 50% green, below 75% yellow, below 90% orange, else red. Each percentage pill has this background: below 50% blue, below 75% rose, else red.
- The percentage pills always have white text on a dark background. They do not follow the theme.
- Claude Code's own hint line (`? for shortcuts`, `auto mode on`) still shows on top, and the status rows come under it.

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

- One press of the ▾ next to ctx compacts the conversation. There is no confirmation step.
- ▾ is a small glyph next to a pill, not the pill: a mod button cannot set its text color, so a white-text pill can only be text.
- Claude Code does not give the Fable usage to mods, so statusbar runs `claude -p /usage` in the background to read it: once when the session starts, then at most once every 5 minutes. Each run takes about 2 to 4 seconds and makes no model call. Thus the Fable number can be up to 5 minutes old.
- After `/model`, the model name changes at once. The `/model` output has no effort, so the effort pill changes when you send the next message.
- The effort comes from the English output of `/effort`, `Set effort level to …`. If Claude Code changes this text, the effort pill changes when you send the next message.

## Development

```bash
claude plugin validate statusbar
claude plugin test statusbar
```

For local development, see the [repository README](../README.en.md#development).
