import { expect, test } from 'claude-code/testing'

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
  expect(await ui.find({ type: 'Button', key: 'compact', text: '▾' })).toBeDefined()
  // 有 Fable 時，5h 的標籤補到和 Fable 一樣寬，兩列的進度條對齊。
  expect(await ui.find({ type: 'Text', text: '5h    ▰▰▰▱▱▱▱▱  41% ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: 'Fable ▰▱▱▱▱▱▱▱  17% ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '7d  ▱▱▱▱▱▱▱▱▱▱  --% ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '? for shortcuts' })).toBeDefined()
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
})

test('按膠囊旁的 ▾，送出 /model、/effort、/compact', async ($, on) => {
  const ran: string[] = []
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  on('settings.read', () => ({ value: { effortLevel: 'high' } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('command.run', ($, e) => {
    ran.push(e.command)
    return { text: 'Compacted' }
  })
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{e.props.hint}</Text>
  })

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'statusbar', surface: 'terminal', ...HINT })

  expect(await ui.find({ type: 'Button', key: 'compact', text: '▾' })).toBeDefined()
  await ui.press({ key: 'model' })
  await ui.press({ key: 'effort' })
  await ui.press({ key: 'compact' })
  expect(ran).toEqual(['model', 'effort', 'compact'])
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
