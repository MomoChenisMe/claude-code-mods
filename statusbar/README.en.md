# statusbar: a usage status line for Claude Code

[繁體中文](README.md)

It adds two status rows under the Claude Code prompt (three in a narrow terminal), in any project:

![statusbar screenshot: two rows under auto mode, with model/effort, ctx/7d and 5h/Fable columns](docs/screenshot.png)

```
⏵⏵ auto mode on (shift+tab to cycle)
 Opus 5.5 ▾   ctx ▰▰▱▱▱▱▱▱▱▱  24%  ↓ → × ⌫      5h    ▰▱▱▱▱▱▱▱  9%  ↻19:00
 xhigh ▾      7d  ▰▰▰▰▱▱▱▱▱▱  35%  ↻Sun 05:00   Fable ▰▱▱▱▱▱▱▱  17%  ↻Sun 05:00
```

- **Model and effort**: pills. The model pill is gray. The effort pill has the color of its level: low green, medium yellow, high orange, xhigh and max red. A press on the ▾ after a pill does what `/model` or `/effort` typed in the prompt does: it opens the picker. The pills change at once after a pick.
- **ctx**: how much of the context window the conversation uses. After a session starts, after `/clear` and after a compact, Claude Code has no figure until the model's first reply. Until then, the pill shows a local estimate: what the system prompt, the tools, the memory files and the conversation already use. The estimate sends no request and makes no model call. After the reply, the pill shows the real figure. A conversation brought back with `/resume` shows the real figure from its last reply. Four buttons follow the percentage after one space. When the mouse is on a button, a label with its name shows next to it in inverted colors; the label covers the 5h column until the mouse moves away:
  - `↓` does what `/compact` typed in the prompt does; while the model replies, it waits for the turn to end.
  - `→` does what typing `繼續工作` ("continue working" in Chinese) and Enter in the prompt does, on one press; while the model replies, it waits for the turn to end.
  - `×` does what `/clear` does.
  - `⌫` clears the prompt box. While Claude works, Esc stops the turn and does not clear what you typed. This button clears only the prompt box, and the work goes on.
  - `↓` and `×` change the whole conversation, and `⌫` discards what you typed, so each needs two presses, to prevent an accidental press: the first press changes it to `↓ compact?`, `× clear?` or `⌫ clear input?`, and a second press on the same button within 3 seconds does the action. Otherwise it changes back.
- The glyphs split the work: `▾` opens a picker; `→` tells the model to go on; `↓` (press down) and `×` (clear away) act on the conversation; `⌫` (erase) acts only on the prompt box.
- **5h and 7d**: the 5-hour and weekly usage limits, followed by the reset time. Only subscription accounts have them.
- **Fable**: the weekly Fable usage, followed by the reset time. It shows only when the account has a Fable limit.
- Each bar has the color of its level: below 50% green, below 75% yellow, below 90% orange, else red. Each percentage pill has this background: below 50% blue, below 75% rose, else red.
- The percentage pills always have white text on a dark background. They do not follow the theme.
- Claude Code's own hint line (`? for shortcuts`, `auto mode on`) still shows on top, and the status rows come under it.

If the terminal is less than 85 columns wide, the status rows change to a narrow layout: three rows, two columns, and no bars. The model and the effort are at the top of the two columns, and each usage label goes into its percentage pill, so the pills in each column line up. The usage pairs stay the same as in the wide layout:

![statusbar narrow-layout screenshot: a 72-column terminal with three rows and two columns under auto mode, model/ctx/7d in one column and effort/5h/Fable in the other, each label inside its pill](docs/narrow.png)

The narrow layout needs about 49 columns. In a narrower terminal, the 5h and Fable column is cut from the end, and the reset times go first.

## Requirements

- Claude Code 2.1.290 or later (tested on this version). The mod API is early access, so a Claude Code release can make an update of this mod necessary.
- Mouse clicks on the buttons (`▾`, `↓`, `→`, `×`, `⌫`) need Claude Code's fullscreen layout (`"tui": "fullscreen"` in settings.json). Without it, a click on a button does nothing.

## Install

In the Claude Code prompt, type:

```
/plugin install statusbar --marketplace MomoChenisMe/claude-code-mods
```

The first time, Claude Code asks to add the `github:MomoChenisMe/claude-code-mods` marketplace: answer `y`, and pick the user scope so that every project loads it.

It is not the `statusLine` setting in settings.json, and the two can show together. To see only one line, remove `statusLine`.

## Known limits

- After a session starts, after `/clear` and after a compact, ctx is an estimate. It can differ from the real figure after the first reply by about 1 percentage point.
- The text that `→` sends, `繼續工作`, is fixed Chinese. You cannot change it, and it does not follow the language setting.
- For the 3 seconds while a button waits for the second press, the name after it pushes the right column to the right (about 6 cells for `compact?`, about 10 cells for `clear input?`). The column moves back after the press or the timeout.
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
