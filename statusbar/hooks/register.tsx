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

// 寬版（兩列三欄、有進度條）要的寬度；終端機比這窄就改用三列兩欄、標籤放進百分比膠囊的窄版。
const WIDE_COLUMNS = 85

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

// 不等第一輪對話，先把模型、設定的 effort 與用量讀進來。`/resume` 接回的對話帶著它最後一次
// 回覆的 token 數（contextTokens），ctx 照它算；這時引擎的值還是換過去之前那段對話的。
const refresh = async ($: EngineInterface, contextTokens?: number) => {
  const [model, measured, settings] = await Promise.all([
    $.session.model(),
    $.session.usage(),
    $.settings.read(),
  ])
  const configured = typeof settings.effortLevel === 'string' ? settings.effortLevel : null
  const window = measured.context.window
  const percent = contextTokens === undefined ? measured.context.percent : Math.round((contextTokens / window) * 100)
  await update($, usage, u => ({
    ...u,
    model,
    effort: u.effort ?? configured,
    contextPercent: percent ?? null,
    rateLimits: measured.rateLimits,
  }))
  if (percent === undefined) {
    await estimateContext($, window)
  }
}

// compact 換掉對話後，引擎要等下一次回覆才有新的 ctx，在那之前還是 compact 前的數字。
// 新的對話在 session.compact 的 hook 都回去之後才換上，所以等一下再讀，改用本機估算。
const refreshAfterCompact = async ($: EngineInterface) => {
  try {
    await $.clock.sleep(0)
  } catch {
    return
  }
  await refresh($)
}

// 引擎要等第一次回覆才有 ctx（開 session、/clear、compact 之後）。這之前先用本機估算：系統提示、
// 工具、記憶檔與對話已經佔掉的量，不發請求、不呼叫模型；回覆後由 session.measure 換成實際值。
// 估不出來就維持空的，畫成 0%。
const estimateContext = async ($: EngineInterface, window: number) => {
  const { context } = await $.session.usage({ breakdown: 'summary' })
  const tokens = context.breakdown?.totalTokens
  if (tokens !== undefined) {
    const estimate = Math.round((tokens / window) * 100)
    await update($, usage, u => (u.contextPercent === null ? { ...u, contextPercent: estimate } : u))
  }
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

  // `/clear`、`/resume` 換成另一個 session，卻不發 session.start；新 session 的值是空的，
  // 模型、effort 與用量會空白到第一輪對話結束。
  on('classic.SessionStart', async ($, e, next) => {
    if (e.source === 'clear' || e.source === 'resume') {
      await refresh($, e.context_tokens)
      fableReadAt = 0
      void refreshFable($)
    }

    return next(e)
  })

  // 主對話的 compact（`/compact`、自動 compact、ctx 旁的 ↓）；precompute 只是先算好摘要，對話不變。
  on('session.compact', async ($, e, next) => {
    const done = await next(e)
    if (e.agentId === undefined && e.trigger !== 'precompute' && done.skip === undefined) {
      void refreshAfterCompact($)
    }

    return done
  })

  // 開 session 後不久也會量一次，那時還沒有回覆、沒有 ctx；保留目前的值（本機估算），
  // 不要蓋成空的。
  on('session.measure', async ($, e, next) => {
    await update($, usage, u => ({
      ...u,
      contextPercent: e.context.percent ?? u.contextPercent,
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
    // 與 clear 會改掉整段對話，要按兩次。
    const waiting = (await read($, armed))?.command ?? null
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
    // 和膠囊之間空一格，跟 7d、5h 那幾列的重置時間一樣。
    const contextActions = (
      <Box flexShrink={0} marginLeft={1}>
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
      </Box>
    )

    // 寬版 `ctx ▰▰▰▰▱▱▱▱▱▱ [38%]`，進度條依用量上色。窄版沒有進度條，標籤放進膠囊 `[ctx 38%]`，
    // 百分比靠右補到 3 格，同一欄的膠囊一樣寬。標籤都補到同欄一樣寬。
    const isNarrow = (e.viewport?.columns ?? WIDE_COLUMNS) < WIDE_COLUMNS
    const narrowText = (label: string, pct: number | null) => `${label} ${percent(pct).padStart(3)}`
    const gauge = (label: string, pct: number | null, width: number) =>
      isNarrow ? (
        pct === null ? (
          <Text dimColor>{` ${narrowText(label, pct)} `}</Text>
        ) : (
          pill(narrowText(label, pct), pillColor(pct), WHITE)
        )
      ) : (
        <Text>
          <Text dimColor>{`${label} `}</Text>
          <Text color={pct === null ? undefined : colorFor(pct)} dimColor={pct === null}>
            {`${bar(pct ?? 0, width)} `}
          </Text>
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

    // 滑鼠移到三顆鈕上，鈕的右邊浮出反白的名稱標籤，像工具提示一樣暫時蓋在 5h 那一欄上，
    // 不推擠版面。後畫的元素蓋在先畫的上面，所以標籤放在整列最後、位置用前面的寬度算：
    // 寬版先是模型／effort 那一欄與 3 格間隔，ctx 列是「ctx 」、進度條、百分比膠囊；窄版的 ctx
    // 列在模型下面那一列，只有放進標籤的膠囊。再空一格才是鈕。三個標籤補到一樣寬，每個都整個
    // 蓋住「5h」，不會露出半個字。有一顆在等確認時不浮出，免得和 `compact?` 疊在一起。
    const ctxPercent = u.contextPercent ?? 0
    const modelColumn = Math.max(modelName(u.model).length, u.effort?.length ?? 0) + 3 + 3
    const buttonsAt = isNarrow
      ? narrowText('ctx', ctxPercent).length + 2 + 1
      : modelColumn + 4 + 11 + percent(ctxPercent).length + 2 + 1
    const hoverLabel = (scope: string, text: string) => (
      <Box
        position="absolute"
        top={isNarrow ? 1 : 0}
        left={buttonsAt + 6}
        display="none"
        hover={{ scope, display: 'flex' }}
      >
        <Text inverse>{` ${text.padEnd(8)} `}</Text>
      </Box>
    )
    const hoverLabels = waiting === null && [
      hoverLabel('hint:compact', 'compact'),
      hoverLabel('hint:continue', 'continue'),
      hoverLabel('hint:clear', 'clear'),
    ]

    // 用量的配對：短期的 ctx／5h 一列，每週的 7d／Fable 一列。終端機太窄時，5h、Fable
    // 那欄從尾巴截斷。
    const ctxRow = (
      <Box>
        {gauge('ctx', ctxPercent, 10)}
        {contextActions}
      </Box>
    )
    const sevenDayRow = (
      <Text>
        {gauge('7d ', sevenDay?.percentUsed ?? null, 10)}
        {resets(sevenDay, dayHhmm)}
      </Text>
    )
    const fiveHourRow = (
      <Text wrap="truncate-end">
        {gauge(u.fable === null ? '5h' : '5h   ', fiveHour?.percentUsed ?? null, 8)}
        {resets(fiveHour, hhmm)}
      </Text>
    )
    const fableRow = u.fable !== null && (
      <Text wrap="truncate-end">
        {gauge('Fable', u.fable.percentUsed, 8)}
        {resets(u.fable, dayHhmm)}
      </Text>
    )

    // 寬版：模型／effort 疊成最左一欄，兩列三欄。窄版：三列兩欄，模型、effort 各在一欄的最上面，
    // 底下是那一欄的用量，所以每個膠囊都從兩條直線開始；沒有 effort 時那一格空著。
    return (
      <Box flexDirection="column">
        {hint}
        {isNarrow ? (
          <Box>
            <Box flexDirection="column" flexShrink={0} marginRight={3}>
              {modelPill}
              {ctxRow}
              {sevenDayRow}
            </Box>
            <Box flexDirection="column">
              {effortPill || <Text> </Text>}
              {fiveHourRow}
              {fableRow}
            </Box>
            {hoverLabels}
          </Box>
        ) : (
          <Box>
            <Box flexDirection="column" flexShrink={0} marginRight={3}>
              {modelPill}
              {effortPill}
            </Box>
            <Box flexDirection="column" flexShrink={0} marginRight={3}>
              {ctxRow}
              {sevenDayRow}
            </Box>
            <Box flexDirection="column">
              {fiveHourRow}
              {fableRow}
            </Box>
            {hoverLabels}
          </Box>
        )}
      </Box>
    )
  })
}
