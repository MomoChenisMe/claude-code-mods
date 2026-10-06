import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Usage } from '../types'

const EMPTY: Usage = { model: '', effort: null, contextPercent: null, rateLimits: [] }
const usage = atom({ plugin: 'statusbar', key: 'usage' } as const, EMPTY)

const ORANGE = '#ff8700'
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const EFFORT_COLOR: Record<string, string> = {
  low: 'success',
  medium: 'warning',
  high: ORANGE,
  xhigh: 'error',
  max: 'error',
}

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

// 和在輸入框打 `/compact` 一樣：記進對話，模型回覆中則排隊等這一輪結束。
const compact = ($: EngineInterface) => $.command.run({ command: 'compact' })

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    const [model, measured, settings] = await Promise.all([
      $.session.model(),
      $.session.usage(),
      $.settings.read(),
    ])
    const configured = typeof settings.effortLevel === 'string' ? settings.effortLevel : null
    await update($, usage, u => ({
      model,
      effort: u.effort ?? configured,
      contextPercent: measured.context.percent ?? null,
      rateLimits: measured.rateLimits,
    }))

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await update($, usage, u => ({
      ...u,
      contextPercent: e.context.percent ?? null,
      rateLimits: e.rateLimits,
    }))

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

  // 畫在輸入框下方的提示列位置；引擎自己的提示列留在它下面。
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    const hint = await next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const u = await read($, usage)

    const pill = (text: string, background: string) => (
      <Text backgroundColor={background} color="inverseText" bold>
        {` ${text} `}
      </Text>
    )

    // `ctx ▰▰▰▰▱▱▱▱▱▱ [38%] ↻18:30`：百分比是膠囊，依用量上色。
    const gauge = (label: string, pct: number | null, width: number, resets?: string) => (
      <Text>
        <Text dimColor>{`   ${label} `}</Text>
        {pct === null ? (
          <Text dimColor>{`${bar(0, width)}  --% `}</Text>
        ) : (
          <Text>
            <Text color={colorFor(pct)}>{`${bar(pct, width)} `}</Text>
            {pill(`${Math.round(pct)}%`, colorFor(pct))}
          </Text>
        )}
        {resets !== undefined && <Text dimColor>{` ↻${resets}`}</Text>}
      </Text>
    )

    const limit = (kind: string, label: string, when: (d: Date) => string) => {
      const r = u.rateLimits.find(one => one.kind === kind)
      const resets = r?.resetsAt === undefined ? undefined : when(new Date(r.resetsAt))
      return gauge(label, r?.percentUsed ?? null, 8, resets)
    }

    // 模型、effort、ctx 與 compact 鈕不縮；終端機太窄時，從 5h、7d 的尾巴截斷。
    return (
      <Box flexDirection="column">
        <Box>
          <Box flexShrink={0}>
            <Text>
              {pill(modelName(u.model), 'gray')}
              {u.effort !== null && ' '}
              {u.effort !== null && pill(u.effort, EFFORT_COLOR[u.effort] ?? 'gray')}
              {gauge('ctx', u.contextPercent, 10)}{' '}
            </Text>
            <Button key="compact" label="⇣ compact" plain dimColor onPress={() => compact($)} />
          </Box>
          <Text wrap="truncate-end">
            {limit('five_hour', '5h', hhmm)}
            {limit('seven_day', '7d', dayHhmm)}
          </Text>
        </Box>
        {hint}
      </Box>
    )
  })
}
