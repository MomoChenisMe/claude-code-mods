import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Armed, RateLimit, Usage } from '../types'

const EMPTY: Usage = { model: '', effort: null, contextPercent: null, rateLimits: [], fable: null }
const usage = atom({ plugin: 'statusbar', key: 'usage' } as const, EMPTY)
// 等第二次按下的 compact／clear 鈕；null 是兩顆都沒按。
const armed = atom({ plugin: 'statusbar', key: 'armed' } as const, null as Armed | null)

const ORANGE = '#ff8700'
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

const EFFORT_COLOR: Record<string, string> = {
  low: 'success',
  medium: 'warning',
  high: ORANGE,
  xhigh: 'error',
  max: 'error',
}

// 百分比膠囊固定白字，底色由藍到紅，任何主題都讀得清楚。
const WHITE = '#ffffff'
const BLUE = '#3a7cc0'
const ROSE = '#c9605f'
const RED = '#b03a3a'

// 寬版（兩列三欄、有進度條）要的寬度；終端機比這窄就改用三列、只有百分比的窄版。
const WIDE_COLUMNS = 84

// claude-opus-5-5 → Opus 5.5
export const modelName = (id: string) => {
  const [family = '', ...version] = id
    .replace(/^claude-/, '')
    .replace(/-\d{8}$/, '')
    .split('-')
  return `${family.charAt(0).toUpperCase()}${family.slice(1)} ${version.join('.')}`.trim()
}

// <50 綠、<75 黃、<90 橘、其餘紅。
export const colorFor = (pct: number) =>
  pct < 50 ? 'success' : pct < 75 ? 'warning' : pct < 90 ? ORANGE : 'error'

// 百分比膠囊的底色：<50 藍、<75 玫瑰紅、其餘紅。
export const pillColor = (pct: number) => (pct < 50 ? BLUE : pct < 75 ? ROSE : RED)

const percent = (pct: number | null) => (pct === null ? '--%' : `${Math.round(pct)}%`)

export const bar = (pct: number, width: number) => {
  const filled = Math.max(0, Math.min(width, Math.round((pct / 100) * width)))
  return '▰'.repeat(filled) + '▱'.repeat(width - filled)
}

const pad = (n: number) => String(n).padStart(2, '0')
const hhmm = (d: Date) => `${pad(d.getHours())}:${pad(d.getMinutes())}`
const dayHhmm = (d: Date) => `${DAYS[d.getDay()]} ${hhmm(d)}`

const rowText = (content: readonly { type: string; [field: string]: unknown }[]) =>
  content.map(b => (b.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('\n')

// `/effort`、`/model` 輸出列帶來的變動；其他列回 null。
export const pickerChange = (text: string) => {
  const effort = text.match(/Set effort level to (\w+)/)?.[1]
  return effort !== undefined || text.includes('Set model to') ? { effort } : null
}

// `claude -p /usage` 裡的「Current week (Fable): 17% used · resets Oct 11 at 4:59am (Asia/Taipei)」；
// 重置時間是本機時區。沒有這一列（帳號沒有 Fable 額度）回 null。
export const fableUsage = (text: string, now: Date): RateLimit | null => {
  const m = text.match(
    /^Current week \(Fable\): ([\d.]+)% used(?: · resets (\w{3}) (\d{1,2}) at (\d{1,2})(?::(\d{2}))?(am|pm))?/m,
  )
  if (m === null) {
    return null
  }
  const [, pct, month, day, hour, minute, half] = m
  if (month === undefined) {
    return { kind: 'fable', percentUsed: Number(pct) }
  }
  const at = new Date(
    now.getFullYear(),
    MONTHS.indexOf(month),
    Number(day),
    (Number(hour) % 12) + (half === 'pm' ? 12 : 0),
    Number(minute ?? 0),
  )
  // 十二月看到一月的重置日：跨年。
  if (now.getTime() - at.getTime() > 86_400_000) {
    at.setFullYear(at.getFullYear() + 1)
  }
  return { kind: 'fable', percentUsed: Number(pct), resetsAt: at.toISOString() }
}

// 和在輸入框打 `/<command>` 一樣：記進對話，模型回覆中則排隊等這一輪結束。
// `/model`、`/effort` 打開選單，選完的變動由 session.append 讀回來。
const run = ($: EngineInterface, command: string) => $.command.run({ command })

// 和自己在輸入框打「繼續工作」再按 Enter 一樣；模型回覆中時，等這一輪結束才送出。
const CONTINUE_TEXT = '繼續工作'
const continueWork = ($: EngineInterface) => $.prompt.submit({ text: CONTINUE_TEXT, asUser: true })

// `/compact`、`/clear` 都會改掉整段對話，所以要按兩次：第一次只把鈕換成 `↓ compact?`、
// `× clear?`，3 秒內再按同一顆才送出，否則恢復原狀；改按另一顆就換成等那一顆。
// 比對指令與按下的時間，免得上一次的計時把新的一次提早收掉。
const CONFIRM_MS = 3000

const pressTwice = async ($: EngineInterface, command: Armed['command']) => {
  if ((await read($, armed))?.command === command) {
    await update($, armed, () => null)
    await run($, command)
    return
  }
  const at = await $.clock.now()
  await update($, armed, () => ({ command, at }))
  try {
    await $.clock.sleep(CONFIRM_MS)
  } catch {
    // 計時中模組被卸下（/reload-plugins、session 結束）會中止等待；那時沒有東西要恢復。
    return
  }
  await update($, armed, a => (a?.command === command && a.at === at ? null : a))
}

// 不等第一輪對話，先把模型、設定的 effort 與用量讀進來。
const refresh = async ($: EngineInterface) => {
  const [model, measured, settings] = await Promise.all([
    $.session.model(),
    $.session.usage(),
    $.settings.read(),
  ])
  const configured = typeof settings.effortLevel === 'string' ? settings.effortLevel : null
  await update($, usage, u => ({
    ...u,
    model,
    effort: u.effort ?? configured,
    contextPercent: measured.context.percent ?? null,
    rateLimits: measured.rateLimits,
  }))
}

// 引擎只回報 five_hour、seven_day；Fable 的週用量只在 `/usage`，借 `claude -p /usage` 讀。
// 一次約 2～4 秒、不呼叫模型，所以背景跑、最多每 5 分鐘一次。`claude -p` 也會載入這個
// mod，只在互動 session 讀，免得一路生下去。
const FABLE_EVERY_MS = 5 * 60 * 1000
let interactive = false
let fableReadAt = 0

const refreshFable = async ($: EngineInterface) => {
  if (!interactive || Date.now() - fableReadAt < FABLE_EVERY_MS) {
    return
  }
  fableReadAt = Date.now()
  try {
    const { stdout } = await $.process.run(
      ['claude', '-p', '/usage', '--no-session-persistence', '--strict-mcp-config'],
      { timeoutMs: 20_000 },
    )
    const fable = fableUsage(stdout, new Date())
    await update($, usage, u => ({ ...u, fable }))
  } catch {
    // 找不到 claude 或逾時：Fable 維持上一次的值，5 分鐘後再試。
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    interactive = e.isInteractive
    await refresh($)
    void refreshFable($)

    return next(e)
  })

  // `/clear` 換成新的 session，卻不發 session.start；新 session 的值是空的，
  // 模型、effort 與用量會空白到第一輪對話結束。
  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'clear') {
      await refresh($)
      fableReadAt = 0
      void refreshFable($)
    }

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await update($, usage, u => ({
      ...u,
      contextPercent: e.context.percent ?? null,
      rateLimits: e.rateLimits,
    }))
    void refreshFable($)

    return next(e)
  })

  // 主對話送出請求時的 effort；subagent 的請求帶 agentId，不算。
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined) {
      const effort = e.effort === undefined ? null : String(e.effort)
      await update($, usage, u => ({ ...u, model: e.model, effort }))
    }

    return yield* next(e)
  })

  // `/effort`、`/model` 不送模型請求，turn.step 看不到；它們的 command.run 又在
  // 選單一打開就結束。選單關掉後留下的輸出列（`Set effort level to max (this
  // session only): ...`、`Set model to ...`）會記進對話，從這裡讀。只看 door
  // `command`，模型與使用者自己打的同一句話不算。
  on('session.append', { door: 'command' }, async ($, e, next) => {
    const kept = await next(e)
    const change = pickerChange(rowText(e.message.content))
    if (change !== null) {
      const model = await $.session.model()
      await update($, usage, u => ({ ...u, model, effort: change.effort ?? u.effort }))
    }

    return kept
  })

  // 畫在輸入框下方的提示列位置：引擎自己的那一列（`⏵⏵ auto mode on`、`? for shortcuts`）
  // 永遠在最上面，狀態列排在它下面。
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const hint = await next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const u = await read($, usage)

    // 模型、effort 的膠囊字色跟著主題反白；百分比膠囊固定白字。
    const pill = (text: string, background: string, color: string) => (
      <Text backgroundColor={background} color={color} bold>
        {` ${text} `}
      </Text>
    )

    // 膠囊旁的 ▾：按下送出同名指令，滑鼠移上去會反白。Button 的字不能上色，所以白字
    // 膠囊只能是文字。不等指令結束：選單開著或 compact 跑超過 10 秒，按鈕會被引擎判逾時。
    const control = (command: string) => (
      <Button key={command} label="▾" plain dimColor onPress={() => void run($, command)} />
    )

    // ctx 旁的 ↓ compact（把對話壓下去）、→ 送出「繼續工作」、× clear（清掉）；compact
    // 與 clear 會改掉整段對話，要按兩次。滑鼠移上去時，右邊浮出名稱；浮出的字疊在旁邊的
    // 內容上，不推擠版面。有一顆在等確認時不浮出，免得和 `compact?` 疊在一起。
    const waiting = (await read($, armed))?.command ?? null
    const hoverLabel = (scope: string, text: string) => (
      <Box position="absolute" left={6} display="none" hover={{ scope, display: 'flex' }}>
        <Text dimColor>{text}</Text>
      </Box>
    )
    const confirmButton = (command: Armed['command'], glyph: string) => (
      <Button
        key={command}
        label={waiting === command ? `${glyph} ${command}?` : glyph}
        plain
        dimColor={waiting !== command}
        hover={{ scope: `hint:${command}` }}
        onPress={() => void pressTwice($, command)}
      />
    )
    const contextActions = (
      <Box flexShrink={0}>
        {confirmButton('compact', '↓')}
        <Text> </Text>
        <Button
          key="continue"
          label="→"
          plain
          dimColor
          hover={{ scope: 'hint:continue' }}
          onPress={() => void continueWork($)}
        />
        <Text> </Text>
        {confirmButton('clear', '×')}
        {waiting === null && hoverLabel('hint:compact', 'compact')}
        {waiting === null && hoverLabel('hint:continue', 'continue')}
        {waiting === null && hoverLabel('hint:clear', 'clear')}
      </Box>
    )

    // 寬版 `ctx ▰▰▰▰▱▱▱▱▱▱ [38%]`，窄版 `ctx [38%]`：標籤補到同欄一樣寬，進度條依用量上色。
    const isNarrow = (e.viewport?.columns ?? WIDE_COLUMNS) < WIDE_COLUMNS
    const gauge = (label: string, pct: number | null, width: number) => (
      <Text>
        <Text dimColor>{`${label} `}</Text>
        {!isNarrow && (
          <Text color={pct === null ? undefined : colorFor(pct)} dimColor={pct === null}>
            {`${bar(pct ?? 0, width)} `}
          </Text>
        )}
        {pct === null ? <Text dimColor>{` ${percent(pct)} `}</Text> : pill(percent(pct), pillColor(pct), WHITE)}
      </Text>
    )

    const resets = (r: RateLimit | null | undefined, when: (d: Date) => string) =>
      r?.resetsAt !== undefined && <Text dimColor>{` ↻${when(new Date(r.resetsAt))}`}</Text>

    const fiveHour = u.rateLimits.find(one => one.kind === 'five_hour')
    const sevenDay = u.rateLimits.find(one => one.kind === 'seven_day')

    const modelPill = (
      <Box>
        {pill(modelName(u.model), 'gray', 'inverseText')}
        {control('model')}
      </Box>
    )
    const effortPill = u.effort !== null && (
      <Box>
        {pill(u.effort, EFFORT_COLOR[u.effort] ?? 'gray', 'inverseText')}
        {control('effort')}
      </Box>
    )

    // 用量排成兩欄：短期的 ctx／5h 一列，每週的 7d／Fable 一列。終端機太窄時，
    // 5h、Fable 那欄從尾巴截斷。
    const usageColumns = [
      <Box flexDirection="column" flexShrink={0} marginRight={3}>
        <Box>
          {gauge('ctx', u.contextPercent, 10)}
          {contextActions}
        </Box>
        <Text>
          {gauge('7d ', sevenDay?.percentUsed ?? null, 10)}
          {resets(sevenDay, dayHhmm)}
        </Text>
      </Box>,
      <Box flexDirection="column">
        <Text wrap="truncate-end">
          {gauge(u.fable === null ? '5h' : '5h   ', fiveHour?.percentUsed ?? null, 8)}
          {resets(fiveHour, hhmm)}
        </Text>
        {u.fable !== null && (
          <Text wrap="truncate-end">
            {gauge('Fable', u.fable.percentUsed, 8)}
            {resets(u.fable, dayHhmm)}
          </Text>
        )}
      </Box>,
    ]

    // 寬版：模型／effort 疊成最左一欄，兩列三欄。窄版：模型、effort 並排在最上面一列，
    // 用量兩欄排在下面，不畫進度條。兩種版面的用量配對一樣。
    return (
      <Box flexDirection="column">
        {hint}
        {isNarrow ? (
          <Box flexDirection="column">
            <Box columnGap={2}>
              {modelPill}
              {effortPill}
            </Box>
            <Box>{usageColumns}</Box>
          </Box>
        ) : (
          <Box>
            <Box flexDirection="column" flexShrink={0} marginRight={3}>
              {modelPill}
              {effortPill}
            </Box>
            {usageColumns}
          </Box>
        )}
      </Box>
    )
  })
}
