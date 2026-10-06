import { expect, test } from 'claude-code/testing'

import { bar, colorFor, modelName, pickerChange } from '../hooks/register'

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
})

test('用量列畫在輸入框下方，引擎的提示列保留', async ($, on) => {
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200000, percent: 38 },
      rateLimits: [{ kind: 'five_hour', percentUsed: 41 }],
    },
  }))
  on('settings.read', () => ({ value: { effortLevel: 'xhigh' } }))
  on('session.start', ($, e) => ({ cwd: e.cwd }))
  on('ui.render', { component: 'PromptHint' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text dimColor>{e.props.hint}</Text>
  })

  await $.session.start({ cwd: '/tmp', surface: 'terminal', isInteractive: true })
  const ui = await $.ui.mount({ plugin: 'statusbar', surface: 'terminal', ...HINT })

  expect(await ui.find({ type: 'Text', text: ' Opus 5.5 ' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /^ xhigh $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /ctx ▰▰▰▰▱▱▱▱▱▱  38% $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /5h ▰▰▰▱▱▱▱▱  41% $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /7d ▱▱▱▱▱▱▱▱  --% $/ })).toBeDefined()
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
  expect(await ui.find({ type: 'Text', text: /^ xhigh $/ })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: /7d ▰▰▰▱▱▱▱▱  33% $/ })).toBeDefined()
})

test('按 compact 鈕送出 /compact', async ($, on) => {
  const ran: string[] = []
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 200000 }, rateLimits: [] } }))
  on('settings.read', () => ({ value: {} }))
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

  expect(await ui.find({ type: 'Button', key: 'compact', text: '⇣ compact' })).toBeDefined()
  await ui.press({ key: 'compact' })
  expect(ran).toEqual(['compact'])
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
