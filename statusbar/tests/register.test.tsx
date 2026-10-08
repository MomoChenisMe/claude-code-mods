import { expect, mock, test } from 'claude-code/testing'
import type { On } from 'claude-code'

import { bar, colorFor, fableUsage, modelName, pickerChange, pillColor } from '../hooks/register'

const HINT = {
  component: 'PromptHint',
  props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
} as const

test('模型名稱、進度條與用量顏色', () => {
  expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelName('claude-haiku-4-5-20251001')).toBe('Haiku 4.5')
  expect(bar(38, 10)).toBe('▰▰▰▰▱▱▱▱▱▱')
  expect(bar(100, 8)).toBe('▰▰▰▰▰▰▰▰')
  expect(colorFor(49)).toBe('success')
  expect(colorFor(80)).toBe('#ff8700')
  expect(colorFor(95)).toBe('error')
  expect(pillColor(11)).toBe('#3a7cc0')
  expect(pillColor(60)).toBe('#c9605f')
  expect(pillColor(95)).toBe('#b03a3a')
})

test('從 claude -p /usage 讀出 Fable 的週用量', () => {
  const now = new Date(2026, 9, 6, 15, 0)
  const usage = (fable: string) => `Current week (all models): 35% used · resets Oct 11 at 5am (Asia/Taipei)
Current week (Fable): ${fable}
`

  expect(fableUsage(usage('17% used · resets Oct 11 at 4:59am (Asia/Taipei)'), now)).toEqual({
    kind: 'fable',
    percentUsed: 17,
    resetsAt: new Date(2026, 9, 11, 4, 59).toISOString(),
  })
  expect(fableUsage(usage('2.5% used · resets Oct 11 at 5pm (Asia/Taipei)'), now)?.resetsAt).toBe(
    new Date(2026, 9, 11, 17, 0).toISOString(),
  )
  // 十二月看到一月的重置日：跨年。
  expect(fableUsage(usage('80% used · resets Jan 2 at 12am (UTC)'), new Date(2026, 11, 30))?.resetsAt).toBe(
    new Date(2027, 0, 2, 0, 0).toISOString(),
  )
  expect(fableUsage(usage('0% used'), now)).toEqual({ kind: 'fable', percentUsed: 0 })
  expect(fableUsage('Current week (all models): 35% used', now)).toBeNull()
})

test('狀態列畫在輸入框下方，引擎的提示列保留在上面', async ($, on) => {
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200000, percent: 38 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 41 }],
    },
  }))
  on('settings.read', () => ({ value: { effortLevel: 'xhigh' } }))
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: 'Current week (Fable): 17% used\n',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{e.props.hint}</Text>
  })

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'statusbar', surface: 'terminal', ...HINT })

  expect(await ui.find({ type: 'Text', text: ' Opus 5.5 ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' xhigh ' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'model', text: '▾' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'effort', text: '▾' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'ctx ▰▰▰▰▱▱▱▱▱▱  38% ' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'compact', text: '↓' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'clear', text: '×' })).toBeDefined()
  // 有 Fable 時，5h 的標籤補到和 Fable 一樣寬，兩列的進度條對齊。
  expect(await ui.find({ type: 'Text', text: '5h    ▰▰▰▱▱▱▱▱  41% ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Fable ▰▱▱▱▱▱▱▱  17% ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '7d  ▱▱▱▱▱▱▱▱▱▱  --% ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '? for shortcuts' })).toBeDefined()
})

test('終端機比寬版窄時，三列兩欄、標籤放進百分比膠囊，不畫進度條', async ($, on) => {
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200000, percent: 38 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 41 }],
    },
  }))
  on('settings.read', () => ({ value: { effortLevel: 'xhigh' } }))
  on('process.run', () => ({
    value: {
      exitCode: 0,
      stdout: 'Current week (Fable): 17% used\n',
      stderr: '',
      isStdoutTruncated: false,
      isStderrTruncated: false,
    },
  }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{e.props.hint}</Text>
  })

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({
    plugin: 'statusbar',
    surface: 'terminal',
    viewport: { columns: 60, rows: 30 },
    ...HINT,
  })

  expect(await ui.find({ type: 'Text', text: ' Opus 5.5 ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' xhigh ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' ctx 38% ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 5h    41% ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' 7d  --% ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' Fable 17% ' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'compact', text: '↓' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /▰|▱/ })).toBeUndefined()
})

test('/clear 之後沒有 session.start，模型、effort 與用量仍然補讀', async ($, on) => {
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200000 },
      rateLimits: [{ kind: 'seven_day', percentUsed: 33 }],
    },
  }))
  on('settings.read', () => ({ value: { effortLevel: 'xhigh' } }))
  on('classic.SessionStart', () => ({}))
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{e.props.hint}</Text>
  })

  await $.classic.SessionStart({ source: 'clear' })
  const ui = await $.ui.mount({ plugin: 'statusbar', surface: 'terminal', ...HINT })

  expect(await ui.find({ type: 'Text', text: ' Opus 5.5 ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' xhigh ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '7d  ▰▰▰▱▱▱▱▱▱▱  33% ' })).toBeDefined()
  // 還沒有回覆、也估不出來時，ctx 畫成 0%。
  expect(await ui.find({ type: 'Text', text: 'ctx ▱▱▱▱▱▱▱▱▱▱  0% ' })).toBeDefined()
})

test('第一次回覆前先用本機估算的 ctx', async ($, on) => {
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', ($, e) => ({
    value: {
      startedAt: 0,
      context:
        e?.breakdown === 'summary'
          ? { window: 200000, breakdown: { totalTokens: 8000 } as never }
          : { window: 200000 },
      rateLimits: [],
    },
  }))
  on('settings.read', () => ({ value: { effortLevel: 'xhigh' } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.measure', ($, e) => ({ changed: e.changed }))
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{e.props.hint}</Text>
  })

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: false })
  const ui = await $.ui.mount({ plugin: 'statusbar', surface: 'terminal', ...HINT })

  // 8000 / 200000 = 4%。
  expect(await ui.find({ type: 'Text', text: 'ctx ▱▱▱▱▱▱▱▱▱▱  4% ' })).toBeDefined()

  // 開 session 後引擎會先量一次，還沒有 ctx：估算值不能被蓋掉。
  await $.session.measure({ context: { window: 200000 }, rateLimits: [], changed: [] })
  expect(await ui.find({ type: 'Text', text: 'ctx ▱▱▱▱▱▱▱▱▱▱  4% ' })).toBeDefined()

  // 第一次回覆後量到實際值。
  await $.session.measure({ context: { window: 200000, percent: 6 }, rateLimits: [], changed: [] })
  expect(await ui.find({ type: 'Text', text: 'ctx ▰▱▱▱▱▱▱▱▱▱  6% ' })).toBeDefined()
})

test('/resume 之後沒有 session.start，ctx 照接回的對話最後一次回覆算', async ($, on) => {
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  // 這時引擎的值還是換過去之前那段對話的。
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 200000, percent: 40 }, rateLimits: [{ kind: 'seven_day', percentUsed: 33 }] },
  }))
  on('settings.read', () => ({ value: { effortLevel: 'xhigh' } }))
  on('classic.SessionStart', () => ({}))
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{e.props.hint}</Text>
  })

  await $.classic.SessionStart({ source: 'resume', context_tokens: 24000 })
  const ui = await $.ui.mount({ plugin: 'statusbar', surface: 'terminal', ...HINT })

  expect(await ui.find({ type: 'Text', text: ' Opus 5.5 ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '7d  ▰▰▰▱▱▱▱▱▱▱  33% ' })).toBeDefined()
  // 24000 / 200000 = 12%。
  expect(await ui.find({ type: 'Text', text: 'ctx ▰▱▱▱▱▱▱▱▱▱  12% ' })).toBeDefined()
})

test('compact 之後 ctx 改用本機估算，不停在 compact 前的數字', async ($, on) => {
  const summary = [{ role: 'user', text: '摘要', toolUses: [] }] as never
  const clock = mock.clock(on)
  let compacted = false
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  // compact 前量到 40%；compact 後引擎沒有 ctx，估算是 8000 / 200000 = 4%。
  on('session.usage', ($, e) => ({
    value: {
      startedAt: 0,
      context: !compacted
        ? { window: 200000, percent: 40 }
        : e?.breakdown === 'summary'
          ? { window: 200000, breakdown: { totalTokens: 8000 } as never }
          : { window: 200000 },
      rateLimits: [],
    },
  }))
  on('settings.read', () => ({ value: { effortLevel: 'xhigh' } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('session.compact', () => {
    compacted = true
    return { messages: summary }
  })
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{e.props.hint}</Text>
  })

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: false })
  const ui = await $.ui.mount({ plugin: 'statusbar', surface: 'terminal', ...HINT })
  expect(await ui.find({ type: 'Text', text: 'ctx ▰▰▰▰▱▱▱▱▱▱  40% ' })).toBeDefined()

  await $.session.compact({ trigger: 'manual', messages: summary } as never)
  await clock.advance(0)
  expect(await ui.find({ type: 'Text', text: 'ctx ▱▱▱▱▱▱▱▱▱▱  4% ' })).toBeDefined()
})

// 按鈕測試的引擎替身：記下送出的指令與訊息。
const buttons = (on: On, ran: string[], said: string[] = []) => {
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  on('settings.read', () => ({ value: { effortLevel: 'high' } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.run', ($, e) => {
    ran.push(e.command)
    return { text: '' }
  })
  on('prompt.submit', ($, e) => {
    said.push(e.origin.kind === 'plugin' && e.origin.asUser === true ? e.text : `(framed) ${e.text}`)
    return { text: e.text }
  })
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{e.props.hint}</Text>
  })
}

test('按 ▾ 送出 /model、/effort，按一次 → 就以使用者的話送出「繼續工作」；滑鼠移上去會浮出名稱', async ($, on) => {
  const ran: string[] = []
  const said: string[] = []
  buttons(on, ran, said)

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'statusbar', surface: 'terminal', ...HINT })

  await ui.press({ key: 'model' })
  await ui.press({ key: 'effort' })
  await ui.press({ key: 'continue' })
  expect(ran).toEqual(['model', 'effort'])
  expect(said).toEqual(['繼續工作'])
  expect(await ui.find({ type: 'Button', key: 'continue', text: '→' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' compact     ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' continue    ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' clear       ' })).toBeDefined()
})

test('按一次 ⌫ 清空輸入框，不送指令；Claude 工作中也一樣；滑鼠移上去浮出名稱', async ($, on) => {
  const ran: string[] = []
  const filled: string[] = []
  buttons(on, ran)
  on('prompt.fill', ($, e) => {
    filled.push(e.text)
    return { isFilled: true }
  })

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({
    plugin: 'statusbar',
    surface: 'terminal',
    component: 'PromptHint',
    props: { ...HINT.props, isWorking: true },
  })

  await ui.press({ key: 'erase' })
  expect(filled).toEqual([''])
  expect(ran).toEqual([])
  expect(await ui.find({ type: 'Button', key: 'erase', text: '⌫' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: ' clear input ' })).toBeDefined()
})

for (const [command, glyph] of [
  ['compact', '↓'],
  ['clear', '×'],
] as const) {
  test(`${glyph} 要按兩次：第一次換成 ${command}?，3 秒內再按才送出 /${command}，逾時恢復`, async ($, on) => {
    const ran: string[] = []
    const clock = mock.clock(on)
    buttons(on, ran)

    await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
    const ui = await $.ui.mount({ plugin: 'statusbar', surface: 'terminal', ...HINT })

    await ui.press({ key: command })
    expect(ran).toEqual([])
    expect(await ui.find({ type: 'Button', key: command, text: `${glyph} ${command}?` })).toBeDefined()

    await clock.advance(3000)
    expect(await ui.find({ type: 'Button', key: command, text: glyph })).toBeDefined()

    await ui.press({ key: command })
    await clock.advance(1000)
    await ui.press({ key: command })
    expect(ran).toEqual([command])
    expect(await ui.find({ type: 'Button', key: command, text: glyph })).toBeDefined()
  })
}

test('按了 ↓ 之後改按 ×：換成等 × 確認，兩個指令都不送出', async ($, on) => {
  const ran: string[] = []
  const clock = mock.clock(on)
  buttons(on, ran)

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'statusbar', surface: 'terminal', ...HINT })

  await ui.press({ key: 'compact' })
  await clock.advance(2000)
  await ui.press({ key: 'clear' })
  expect(await ui.find({ type: 'Button', key: 'compact', text: '↓' })).toBeDefined()
  expect(await ui.find({ type: 'Button', key: 'clear', text: '× clear?' })).toBeDefined()

  // ↓ 的計時到了，不會把 × 的等待提早收掉。
  await clock.advance(1500)
  expect(await ui.find({ type: 'Button', key: 'clear', text: '× clear?' })).toBeDefined()

  await clock.advance(1500)
  expect(await ui.find({ type: 'Button', key: 'clear', text: '×' })).toBeDefined()
  expect(ran).toEqual([])
})

// `claude plugin test` 無法在 session.append 底下墊替身，所以只單獨測解析；
// 其他列由 hook 的 door 篩選擋掉。
test('從 /effort、/model 的輸出列讀出變動', () => {
  const stdout = (text: string) => `<local-command-stdout>${text}</local-command-stdout>`

  expect(pickerChange(stdout('Set effort level to max (this session only): Maximum capability'))).toEqual({
    effort: 'max',
  })
  expect(pickerChange(stdout('Set effort level to low (saved as your default for new sessions): Quick'))).toEqual({
    effort: 'low',
  })
  expect(pickerChange(stdout('Set model to `Fable 5.1` and saved as your default for new sessions'))).toEqual({
    effort: undefined,
  })
  expect(pickerChange(stdout('Compacted the conversation'))).toBeNull()
})
