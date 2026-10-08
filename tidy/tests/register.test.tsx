import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'
import type { On } from 'claude-code'

import type { Turn } from '../types'

import { noticeOf, senderOf } from '../hooks/agents'
import { addNote, addRow, describe, duration, endTurn, firstSentence, startTurn, textKey, views } from '../hooks/turns'

const text = (t: string) => ({ type: 'text', text: t })
const toolUse = (id: string) => ({ type: 'tool_use', id, name: 'Bash', input: {} })

// 一輪：先說明、跑一個工具、出錯一次，最後回答。at 是各列記下的時間。
const oneTurn = () => {
  let all = startTurn([], 't1', 0)
  all = addRow(all, 'a1', 'assistant', [text('我先看一下檔案。')], 2_000)
  all = addRow(all, 'a2', 'assistant', [toolUse('tu1')], 5_000)
  all = addRow(all, 'u1', 'user', [{ type: 'tool_result', tool_use_id: 'tu1', is_error: true }], 9_000)
  all = addRow(all, 'a3', 'assistant', [text('做好了。')], 50_000)
  return endTurn(all, 't1', 83_000)
}

const INTRO = textKey('我先看一下檔案。')!
const DONE = textKey('做好了。')!
const thinking = (t: string) => ({ type: 'thinking', thinking: t, signature: 'x' })

test('依序記下一輪的列；模型寫的文字都留著，夾在中間的工具收成一段「處理了」', () => {
  const all = oneTurn()
  expect(all).toEqual([
    {
      id: 't1',
      rows: [
        { kind: 'text', id: 'a1', key: INTRO, at: 2_000 },
        { kind: 'tools', ids: ['tu1'], at: 5_000, errors: 1 },
        { kind: 'text', id: 'a3', key: DONE, at: 50_000 },
      ],
      durationMs: 83_000,
      running: [],
      recent: undefined,
      startedAt: 0,
    },
  ])
  // 標頭在這段的工具列，時間從前一段文字算到後一段文字；文字列用 uuid 與內文指紋都查得到。
  expect(views(all[0]!, [])).toEqual({
    a1: { kind: 'answer' },
    [INTRO]: { kind: 'answer' },
    tu1: { kind: 'header', group: 'tu1', label: '處理了 48 秒 · 1 個錯誤', isOpen: false },
    a3: { kind: 'answer' },
    [DONE]: { kind: 'answer' },
  })
  // 指紋不管空白；沒有內文就沒有指紋。
  expect(textKey('我先看一下\n檔案。 ')).toBe(INTRO)
  expect(textKey('  ')).toBe(null)
  // 還在進行：文字一出現就留著，後面的工具是正在跑的一段。
  const running = addRow(startTurn([], 't2', 0), 'b1', 'assistant', [text('我先跑測試。')], 1_000)
  expect(views(running[0]!, [])).toEqual({ b1: { kind: 'answer' }, [textKey('我先跑測試。')!]: { kind: 'answer' } })
  const ran = addRow(running, 'b2', 'assistant', [toolUse('tu2')], 3_000)
  expect(views(ran[0]!, [], 13_000)['tu2']).toEqual({ kind: 'header', group: 'tu2', label: '處理中 12 秒 · 執行指令', isOpen: false })
  // 展開時標頭移到這段的第一列。
  const busy = addRow(addRow(ran, 'b3', 'assistant', [thinking('rebase 有衝突。')], 4_000), 'b4', 'assistant', [toolUse('tu3')], 5_000)
  expect(views(busy[0]!, ['tu2'])).toMatchObject({
    tu2: { kind: 'header', group: 'tu2', isOpen: true },
    b3: { kind: 'work', group: 'tu2', isOpen: true },
    tu3: { kind: 'work', group: 'tu2', isOpen: true },
  })
  // 沒有工具的一段，標頭放在思考上。空的思考不記。
  let quiet = startTurn([], 't3', 0)
  quiet = addRow(quiet, 'c0', 'assistant', [thinking('')], 1_000)
  quiet = addRow(quiet, 'c1', 'assistant', [thinking('先確認三個條件。')], 2_000)
  quiet = addRow(quiet, 'c2', 'assistant', [text('都通過了。')], 6_000)
  expect(views(quiet[0]!, [])).toEqual({
    c1: { kind: 'header', group: 'c1', label: '處理了 6 秒', isOpen: false },
    [textKey('先確認三個條件。')!]: { kind: 'header', group: 'c1', label: '處理了 6 秒', isOpen: false },
    c2: { kind: 'answer' },
    [textKey('都通過了。')!]: { kind: 'answer' },
  })
  // 輪次結束後才來的列（或沒有進行中的輪次）不記。
  expect(addRow(all, 'a4', 'assistant', [text('late')], 99_000)).toBe(all)
  expect(addRow([], 'a5', 'assistant', [text('history')], 99_000)).toEqual([])
})

test('先寫訊息再做事：每段文字都留著，文字之間的每段過程各自一行、各自展開、各自計時', () => {
  let all = startTurn([], 't1', 0)
  all = addRow(all, 'a1', 'assistant', [toolUse('tu1')], 3_000)
  all = addRow(all, 'u1', 'user', [{ type: 'tool_result', tool_use_id: 'tu1' }], 4_000)
  all = addRow(all, 'a2', 'assistant', [text('要。建議統整成兩層：\n\n- theme.css 放值\n- TS 表只剩對照')], 20_000)
  all = addRow(all, 'a3', 'assistant', [toolUse('tu2')], 25_000)
  all = addRow(all, 'u2', 'user', [{ type: 'tool_result', tool_use_id: 'tu2', is_error: true }], 30_000)
  all = addRow(all, 'a4', 'assistant', [text('第六輪已落檔。')], 63_000)
  const done = endTurn(all, 't1', 70_000)[0]!
  const shown = views(done, ['tu2'])
  expect(shown['tu1']).toEqual({ kind: 'header', group: 'tu1', label: '處理了 20 秒', isOpen: false })
  expect(shown['a2']).toEqual({ kind: 'answer' })
  expect(shown['tu2']).toEqual({ kind: 'header', group: 'tu2', label: '處理了 43 秒 · 1 個錯誤', isOpen: true })
  expect(shown['a4']).toEqual({ kind: 'answer' })
  // 舊版記下、沒有時間的列：只有一段時用這一輪的時間，好幾段就不寫時間。
  const legacy: Turn = { id: 't2', rows: [{ kind: 'tools', ids: ['x1'] }, { kind: 'text', id: 'y', key: 'k' }], durationMs: 9_000 }
  expect(views(legacy, [])['x1']).toEqual({ kind: 'header', group: 'x1', label: '處理了 9 秒', isOpen: false })
  const legacyTwo: Turn = { ...legacy, rows: [...legacy.rows, { kind: 'tools', ids: ['x2'] }] }
  expect(views(legacyTwo, [])['x2']).toEqual({ kind: 'header', group: 'x2', label: '處理了', isOpen: false })
})

test('subagent：一輪進行中送進來的訊息是過程；同時開好幾個時，標頭不放在呼叫列', () => {
  const agent = (id: string) => ({ type: 'tool_use', id, name: 'Agent', input: { description: id } })
  const answer = { kind: 'answer' }

  // 開一個 subagent，它的回報在這一輪進行中送進來，最後回答。
  let one = startTurn([], 't4', 0)
  one = addRow(one, 'd1', 'assistant', [agent('ag1')], 1_000)
  one = addNote(one, 'n1', 2_000)
  one = addRow(one, 'd2', 'assistant', [text('它回報了。')], 3_000)
  expect(one[0]!.rows).toEqual([
    { kind: 'tools', ids: ['ag1'], agents: true, at: 1_000 },
    { kind: 'note', id: 'n1', at: 2_000 },
    { kind: 'text', id: 'd2', key: textKey('它回報了。'), at: 3_000 },
  ])
  expect(views(one[0]!, [])['ag1']).toEqual({ kind: 'header', group: 'ag1', label: '處理了 3 秒', isOpen: false })
  expect(views(one[0]!, [])['n1']).toEqual({ kind: 'work', group: 'ag1', isOpen: false })
  expect(views(one[0]!, [])['d2']).toEqual(answer)

  // 同一則回覆開兩個：引擎把它們畫成自己的一列，標頭改放在思考。
  let two = startTurn([], 't5', 0)
  two = addRow(two, 'e0', 'assistant', [thinking('開兩個。')], 1_000)
  two = addRow(two, 'e1', 'assistant', [agent('ag2')], 2_000)
  two = addRow(two, 'e2', 'assistant', [agent('ag3')], 3_000)
  two = addRow(two, 'e3', 'assistant', [text('已開')], 4_000)
  expect(views(two[0]!, [])['e0']).toMatchObject({ kind: 'header', group: 'e0' })
  expect(views(two[0]!, [])['ag2']).toEqual({ kind: 'work', group: 'e0', isOpen: false })
  expect(views(two[0]!, [])['e3']).toEqual(answer)

  // 沒有思考時，標頭畫在緊接著的文字上面。
  let lead = startTurn([], 't7', 0)
  lead = addRow(lead, 'g1', 'assistant', [agent('ag6')], 1_000)
  lead = addRow(lead, 'g2', 'assistant', [agent('ag7')], 2_000)
  lead = addRow(lead, 'g3', 'assistant', [text('已開')], 7_000)
  expect(views(lead[0]!, [])['ag6']).toEqual({ kind: 'work', group: 'ag6', isOpen: false })
  expect(views(lead[0]!, [])['g3']).toEqual({ kind: 'answer', header: { group: 'ag6', label: '處理了 7 秒', isOpen: false } })

  // 後面也沒有文字：照原樣，免得藏起來卻點不開。
  let bare = startTurn([], 't6', 0)
  bare = addRow(bare, 'f1', 'assistant', [agent('ag4'), agent('ag5')], 1_000)
  bare = addNote(bare, 'n2', 2_000)
  expect(views(bare[0]!, [])).toEqual({ ag4: answer, ag5: answer, n2: answer })

  // 輪次結束後才來的訊息不記。
  const ended = endTurn(two, 't5', 7_000)
  expect(addNote(ended, 'n3', 8_000)).toBe(ended)
})

test('「處理中」後面的動作：正在跑的工具，沒有工具在跑時是這段最近一個動作（工具或思考）', () => {
  expect(describe('Bash', { command: 'npm test\nnpm run lint', description: 'Run the tests' })).toBe('執行：Run the tests')
  expect(describe('Bash', { command: 'npm test\nnpm run lint' })).toBe('執行：npm test')
  expect(describe('Read', { file_path: '/repo/hooks/register.tsx' })).toBe('讀取 register.tsx')
  expect(describe('Edit', { file_path: '/repo/hooks/turns.ts', old_string: 'a', new_string: 'b' })).toBe('編輯 turns.ts')
  expect(describe('Grep', { pattern: 'textKey' })).toBe('搜尋 textKey')
  expect(describe('Agent', { description: 'Review Standards axis', prompt: '…' })).toBe('subagent：Review Standards axis')
  expect(describe('mcp__claude-in-chrome__navigate', { url: 'https://example.com' })).toBe('claude-in-chrome：navigate')
  expect(describe('TodoWrite', {})).toBe('TodoWrite')
  expect(firstSentence('**先確認**失敗的測試是哪一條。再改 parser。')).toBe('先確認失敗的測試是哪一條。')
  expect(firstSentence('\n- I will run `npm test` first. Then fix it.')).toBe('I will run npm test first.')
  expect(firstSentence('  ')).toBeUndefined()

  const read = (id: string, path: string) => ({ type: 'tool_use', id, name: 'Read', input: { file_path: path } })
  const label = (all: ReturnType<typeof startTurn>) => (views(all[0]!, [])['r1'] as { label: string }).label
  let all = startTurn([], 't1', 0)
  all = addRow(all, 'a1', 'assistant', [text('先看兩個檔案。'), read('r1', '/repo/a.ts'), read('r2', '/repo/b.ts')], 1_000)
  expect(label(all)).toBe('處理中 · 讀取 a.ts 等 2 項')
  all = addRow(all, 'u1', 'user', [{ type: 'tool_result', tool_use_id: 'r1' }], 2_000)
  expect(label(all)).toBe('處理中 · 讀取 b.ts')
  // 跑完了、模型還沒寫新的說明（思考內容也常是空的）：保留最近開始的那個工具。
  all = addRow(all, 'u2', 'user', [{ type: 'tool_result', tool_use_id: 'r2' }], 3_000)
  all = addRow(all, 'a2', 'assistant', [thinking('')], 4_000)
  expect(label(all)).toBe('處理中 · 讀取 b.ts')
  all = addRow(all, 'a3', 'assistant', [thinking('兩個檔案都看完了。接著改。')], 5_000)
  expect(label(all)).toBe('處理中 · 兩個檔案都看完了。')
  // 文字留在對話裡，這一段就結束了。
  all = addRow(all, 'a4', 'assistant', [text('改好了。')], 9_000)
  expect(label(all)).toBe('處理了 8 秒')
})

test('「處理中」後面寫已經過了多久；舊版記下、沒有開始時間的輪次不寫', () => {
  const ran = addRow(startTurn([], 't1', 1_000), 'a1', 'assistant', [toolUse('tu1')], 1_000)
  const header = (turn: Turn, now: number) => (views(turn, [], now)['tu1'] as { label: string }).label
  expect(header(ran[0]!, 1_000)).toBe('處理中 1 秒 · 執行指令')
  expect(header(ran[0]!, 84_000)).toBe('處理中 1 分 23 秒 · 執行指令')
  // 沒有動作可寫時只寫時間。
  const quiet: Turn = { id: 't2', rows: [{ kind: 'tools', ids: ['tu1'] }], durationMs: null, startedAt: 0 }
  expect(header(quiet, 12_000)).toBe('處理中 12 秒')
  const { startedAt: _, ...legacy } = quiet
  expect(header(legacy, 12_000)).toBe('處理中…')
})

test('從原始內容取出回報的 subagent，與完成通知的狀態和時間', () => {
  const report = [text('Another Claude session sent a message:\n<agent-message from="a8e5">\n  ok\n</agent-message>')]
  expect(senderOf(report)).toBe('a8e5')
  expect(senderOf([text('你好')])).toBe(null)
  const agentDone = [
    text('<task-notification>\n<task-id>a8e5</task-id>\n<status>completed</status>\n<usage><tool_uses>1</tool_uses><duration_ms>5252</duration_ms></usage>\n</task-notification>'),
  ]
  expect(noticeOf(agentDone)).toEqual({ id: 'a8e5', status: 'completed', durationMs: 5252 })
  const shellDone = [text('<task-notification>\n<task-id>b1</task-id>\n<status>failed</status>\n</task-notification>')]
  expect(noticeOf(shellDone)).toEqual({ id: 'b1', status: 'failed', durationMs: null })
  expect(noticeOf(report)).toBe(null)
})

test('問你問題：AskUserQuestion 不收進過程，前面的說明與後面的工作照一般規則', () => {
  const bash = (id: string) => ({ type: 'tool_use', id, name: 'Bash', input: { description: 'Check status' } })
  const ask = (id: string) => ({ type: 'tool_use', id, name: 'AskUserQuestion', input: { questions: [] } })
  const answer = { kind: 'answer' }

  let all = startTurn([], 't1', 0)
  all = addRow(all, 'a1', 'assistant', [bash('b1')], 1_000)
  all = addRow(all, 'u1', 'user', [{ type: 'tool_result', tool_use_id: 'b1' }], 2_000)
  all = addRow(all, 'a2', 'assistant', [text('提交計畫如下。')], 5_000)
  all = addRow(all, 'a3', 'assistant', [ask('q1')], 6_000)
  expect(all[0]!.rows.at(-1)).toEqual({ kind: 'tools', ids: ['q1'], ask: true, at: 6_000 })
  const waiting = views(all[0]!, [])
  expect(waiting['b1']).toEqual({ kind: 'header', group: 'b1', label: '處理了 5 秒', isOpen: false })
  expect(waiting['a2']).toEqual(answer)
  expect(waiting['q1']).toEqual(answer)
  // 問題直接接在工具後面時，問題也把過程切開。
  all = addRow(all, 'u2', 'user', [{ type: 'tool_result', tool_use_id: 'q1' }], 20_000)
  all = addRow(all, 'a4', 'assistant', [bash('b2')], 22_000)
  all = addRow(all, 'a5', 'assistant', [ask('q2')], 25_000)
  const asked = views(all[0]!, [])
  expect(asked['b2']).toEqual({ kind: 'header', group: 'b2', label: '處理了 19 秒', isOpen: false })
  expect(asked['q2']).toEqual(answer)
})

test('時間的格式', () => {
  expect(duration(400)).toBe('1 秒')
  expect(duration(23_000)).toBe('23 秒')
  expect(duration(83_000)).toBe('1 分 23 秒')
  expect(duration(3_720_000)).toBe('1 小時 2 分')
})

const ROW = { onScreen: null }

// 用 mod 自己聽的事件把同一輪餵進去，各列之間讓時鐘往前走。測試裡沒辦法替 session.append 墊底，那一步在 mod
// 記完帳之後才失敗，所以吞掉它的錯誤。
const seed = async ($: Engine, on: On, clock: MockClock) => {
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const append = (uuid: string, type: string, content: unknown[]) =>
    $.session
      .append({ uuid, door: type === 'user' ? 'tool-result' : 'response', message: { type, content } } as never)
      .catch(() => undefined)
  // 測試引擎的型別只列出 turn.abort，turn.start／turn.complete 實際上叫得到。
  const turn = $.turn as unknown as { start: (e: unknown) => Promise<unknown>; complete: (e: unknown) => Promise<unknown> }
  await turn.start({ text: '整理一下', turnId: 't1' })
  await clock.advance(2_000)
  await append('a1', 'assistant', [text('我先看一下檔案。')])
  await clock.advance(3_000)
  await append('a2', 'assistant', [toolUse('tu1')])
  await clock.advance(4_000)
  await append('u1', 'user', [{ type: 'tool_result', tool_use_id: 'tu1', is_error: true }])
  await clock.advance(76_000)
  await append('a3', 'assistant', [text('做好了。')])
  await turn.complete({ turnId: 't1', durationMs: 83_000, answer: '做好了。', isAborted: false, reason: 'completed' })
}

test('過程收成一行「› 處理了」，按下去展開；文字開頭標上「✻」', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`● ${e.props.text}`}</Text>
  })
  on('ui.render', { component: 'ToolGroup' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>Ran 1 shell command</Text>
  })
  on('ui.render', { component: 'ToolProgress' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{e.props.hint}</Text>
  })
  await seed($, on, clock)

  const intro = await $.ui.mount({
    plugin: 'tidy',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'a1',
    props: { text: '我先看一下檔案。', isFirstOfReply: true, ...ROW },
  })
  // 工具前面的說明也留在對話裡，開頭標上「✻」。
  expect(await intro.find({ type: 'Markdown' })).toBeDefined()
  expect(await intro.find({ type: 'Text', text: '✻' })).toBeDefined()
  // 畫面給的列 id 對不上 uuid 時，用內文指紋認出同一段文字。
  const stray = await $.ui.mount({
    plugin: 'tidy',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'not-the-uuid',
    props: { text: '我先看一下檔案。\n', isFirstOfReply: true, ...ROW },
  })
  expect(await stray.find({ type: 'Text', text: '✻' })).toBeDefined()

  const tools = await $.ui.mount({
    plugin: 'tidy',
    surface: 'terminal',
    component: 'ToolGroup',
    props: {
      calls: [{ tool_use_id: 'tu1', tool: 'Bash', input: {}, isRunning: false, isErrored: true, isInterrupted: false }],
      isActive: false,
      isExpanded: false,
      ...ROW,
    },
  })
  expect(await tools.find({ type: 'Button', key: 'group:tu1', text: '› 處理了 1 分 23 秒 · 1 個錯誤' })).toBeDefined()
  expect(await tools.find({ type: 'Text', text: 'Ran 1 shell command' })).toBeUndefined()

  // 執行中工具下方的「ctrl+b 放到背景」提示也跟著收起來。
  const hint = await $.ui.mount({
    plugin: 'tidy',
    surface: 'terminal',
    component: 'ToolProgress',
    props: { tool_use_id: 'tu1', kind: 'background_hint', hint: '(ctrl+b to run in background)' },
  })
  expect(await hint.find({ type: 'Text', text: /ctrl\+b/ })).toBeUndefined()

  const answer = await $.ui.mount({
    plugin: 'tidy',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'a3',
    props: { text: '做好了。', isFirstOfReply: false, ...ROW },
  })
  expect(await answer.find({ type: 'Markdown' })).toBeDefined()
  expect(await answer.find({ type: 'Text', text: '✻' })).toBeDefined()
  expect(await answer.find({ type: 'Text', text: /●/ })).toBeUndefined()

  await tools.press({ key: 'group:tu1' })
  expect(await tools.find({ type: 'Button', key: 'group:tu1', text: '⌄ 處理了 1 分 23 秒 · 1 個錯誤' })).toBeDefined()
  expect(await tools.find({ type: 'Text', text: 'Ran 1 shell command' })).toBeDefined()
  expect(await hint.find({ type: 'Text', text: /ctrl\+b/ })).toBeDefined()
})

test('不在輪次表裡的列（歷史、mod 載入前）照原樣畫', async ($, on) => {
  mock.clock(on)
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`● ${e.props.text}`}</Text>
  })

  const old = await $.ui.mount({
    plugin: 'tidy',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'old',
    props: { text: '以前的回答', isFirstOfReply: true, ...ROW },
  })
  expect(await old.find({ type: 'Text', text: '● 以前的回答' })).toBeDefined()
})

test('subagent 的回報與完成通知收進「› 處理了」；你的訊息與開新一輪的回報照原樣', async ($, on) => {
  mock.clock(on)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', { component: 'ToolUse' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`Agent ${e.props.tool_use_id}`}</Text>
  })
  on('ui.render', { component: 'UserMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`msg ${e.props.text}`}</Text>
  })
  const append = (uuid: string, door: string, type: string, content: unknown[]) =>
    $.session.append({ uuid, door, message: { type, content } } as never).catch(() => undefined)
  const turn = $.turn as unknown as { start: (e: unknown) => Promise<unknown>; complete: (e: unknown) => Promise<unknown> }
  await turn.start({ text: '開一個 subagent', turnId: 't1' })
  await append('a1', 'response', 'assistant', [{ type: 'tool_use', id: 'ag1', name: 'Agent', input: {} }])
  await append('u1', 'tool-result', 'user', [{ type: 'tool_result', tool_use_id: 'ag1' }])
  await append('m1', 'delivery', 'attachment', [text('<agent-message>ok</agent-message>')])
  await append('a2', 'response', 'assistant', [text('它回報了。')])
  await turn.complete({ turnId: 't1', durationMs: 9_000, answer: '它回報了。', isAborted: false, reason: 'completed' })

  const message = (requestId: string, props: Record<string, unknown>) =>
    $.ui.mount({
      plugin: 'tidy',
      surface: 'terminal',
      component: 'UserMessage',
      requestId,
      props: { isExpanded: false, ...ROW, ...props } as never,
    })
  const peer = await message('m1', { text: 'ok', origin: { kind: 'peer' }, from: { name: 'Explore' } })
  // 回答之後才來的完成通知不在輪次表裡，跟著開它的那個呼叫。
  const done = await message('late', {
    text: 'Agent "測試" finished',
    origin: { kind: 'task-notification' },
    task: { id: 'x', status: 'completed', toolUseId: 'ag1', durationMs: 4_000 },
  })
  const mine = await message('p1', { text: '你好', origin: { kind: 'composer' } })
  const nextTurn = await message('m2', { text: 'ok', origin: { kind: 'peer' }, from: { name: 'Explore' } })
  expect(await peer.find({ type: 'Text', text: 'msg ok' })).toBeUndefined()
  expect(await done.find({ type: 'Text', text: /finished/ })).toBeUndefined()
  expect(await mine.find({ type: 'Text', text: 'msg 你好' })).toBeDefined()
  expect(await nextTurn.find({ type: 'Text', text: 'msg ok' })).toBeDefined()

  const call = await $.ui.mount({
    plugin: 'tidy',
    surface: 'terminal',
    component: 'ToolUse',
    props: { tool_use_id: 'ag1', tool: 'Agent', input: {}, isRunning: false, isErrored: false, isInterrupted: false, ...ROW },
  })
  await call.press({ key: 'group:ag1' })
  expect(await peer.find({ type: 'Text', text: 'msg ok' })).toBeDefined()
  expect(await done.find({ type: 'Text', text: /finished/ })).toBeDefined()
})

test('同時開好幾個 subagent 的一輪，「› 處理了」畫在回答上面，之後的完成通知收在它底下', async ($, on) => {
  const clock = mock.clock(on)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  on('ui.render', { component: 'AssistantMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`● ${e.props.text}`}</Text>
  })
  on('ui.render', { component: 'UserMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`msg ${e.props.text}`}</Text>
  })
  const append = (uuid: string, door: string, type: string, content: unknown[]) =>
    $.session.append({ uuid, door, message: { type, content } } as never).catch(() => undefined)
  const turn = $.turn as unknown as { start: (e: unknown) => Promise<unknown>; complete: (e: unknown) => Promise<unknown> }
  await turn.start({ text: '開兩個 subagent', turnId: 't1' })
  await append('a1', 'response', 'assistant', [{ type: 'tool_use', id: 'ag1', name: 'Agent', input: {} }])
  await append('a2', 'response', 'assistant', [{ type: 'tool_use', id: 'ag2', name: 'Agent', input: {} }])
  await clock.advance(7_000)
  await append('a3', 'response', 'assistant', [text('已開')])
  await turn.complete({ turnId: 't1', durationMs: 7_000, answer: '已開', isAborted: false, reason: 'completed' })

  const answer = await $.ui.mount({
    plugin: 'tidy',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'a3',
    props: { text: '已開', isFirstOfReply: true, ...ROW },
  })
  expect(await answer.find({ type: 'Button', key: 'group:ag1', text: '› 處理了 7 秒' })).toBeDefined()
  expect(await answer.find({ type: 'Text', text: '✻' })).toBeDefined()

  const done = await $.ui.mount({
    plugin: 'tidy',
    surface: 'terminal',
    component: 'UserMessage',
    requestId: 'late',
    props: {
      text: 'Agent "測試甲" finished',
      origin: { kind: 'task-notification' },
      task: { id: 'x', status: 'completed', toolUseId: 'ag2', durationMs: 4_000 },
      isExpanded: false,
      ...ROW,
    } as never,
  })
  expect(await done.find({ type: 'Text', text: /finished/ })).toBeUndefined()
  await answer.press({ key: 'group:ag1' })
  expect(await answer.find({ type: 'Button', key: 'group:ag1', text: '⌄ 處理了 7 秒' })).toBeDefined()
  expect(await done.find({ type: 'Text', text: /finished/ })).toBeDefined()
})

test('subagent 的回報畫成一行卡片，點開（isExpanded）才畫全文；完成通知補上狀態與時間', async ($, on) => {
  mock.clock(on)
  on('agent.list', () => ({ value: [{ id: 'a8e5', description: 'Review Standards axis', type: 'Explore', status: 'completed' }] }))
  on('ui.render', { component: 'UserMessage' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>{`msg ${e.props.text}`}</Text>
  })
  const append = (uuid: string, content: unknown[]) =>
    $.session.append({ uuid, door: 'prompt', message: { type: 'user', content } } as never).catch(() => undefined)
  await append('m1', [text('<agent-message from="a8e5">\n  找到 3 條 SUGGESTION\n</agent-message>')])

  const row = await $.ui.mount({
    plugin: 'tidy',
    surface: 'terminal',
    component: 'UserMessage',
    requestId: 'm1',
    props: { text: '找到 3 條 SUGGESTION', origin: { kind: 'peer' }, from: { name: 'Explore' }, isExpanded: false, ...ROW } as never,
  })
  expect(await row.find({ type: 'Text', text: '◆' })).toBeDefined()
  expect(await row.find({ type: 'Text', text: 'Explore · Review Standards axis' })).toBeDefined()
  expect(await row.find({ type: 'Text', text: '› 回報' })).toBeDefined()
  expect(await row.find({ type: 'Markdown' })).toBeUndefined()
  expect(await row.find({ type: 'Text', text: /msg/ })).toBeUndefined()

  await append('n1', [text('<task-notification>\n<task-id>a8e5</task-id>\n<status>completed</status>\n<usage><duration_ms>137000</duration_ms></usage>\n</task-notification>')])
  expect(await row.find({ type: 'Text', text: ' · 完成 2 分 17 秒' })).toBeDefined()

  // 點一下這一列，引擎把它標成展開。
  await row.unmount()
  const open = await $.ui.mount({
    plugin: 'tidy',
    surface: 'terminal',
    component: 'UserMessage',
    requestId: 'm1',
    props: { text: '找到 3 條 SUGGESTION', origin: { kind: 'peer' }, from: { name: 'Explore' }, isExpanded: true, ...ROW } as never,
  })
  expect(await open.find({ type: 'Text', text: '⌄ 回報' })).toBeDefined()
  expect(await open.find({ type: 'Markdown' })).toBeDefined()

  // 不知道是誰送來的回報（mod 載入前）照原樣。
  const old = await $.ui.mount({
    plugin: 'tidy',
    surface: 'terminal',
    component: 'UserMessage',
    requestId: 'old',
    props: { text: 'ok', origin: { kind: 'peer' }, from: { name: 'Explore' }, isExpanded: false, ...ROW } as never,
  })
  expect(await old.find({ type: 'Text', text: 'msg ok' })).toBeDefined()
})

test('「處理中」後面的時間每秒往前走；這一輪結束就換成「處理了」', async ($, on) => {
  const clock = mock.clock(on)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const turn = $.turn as unknown as { start: (e: unknown) => Promise<unknown>; complete: (e: unknown) => Promise<unknown> }
  await turn.start({ text: '跑測試', turnId: 't1' })
  await $.session
    .append({ uuid: 'a1', door: 'response', message: { type: 'assistant', content: [toolUse('tu1')] } } as never)
    .catch(() => undefined)
  const tools = await $.ui.mount({
    plugin: 'tidy',
    surface: 'terminal',
    component: 'ToolGroup',
    props: {
      calls: [{ tool_use_id: 'tu1', tool: 'Bash', input: {}, isRunning: true, isErrored: false, isInterrupted: false }],
      isActive: true,
      isExpanded: false,
      ...ROW,
    },
  })
  expect(await tools.find({ type: 'Button', key: 'group:tu1', text: '› 處理中 1 秒 · 執行指令' })).toBeDefined()
  await clock.advance(3_000)
  expect(await tools.find({ type: 'Button', key: 'group:tu1', text: '› 處理中 3 秒 · 執行指令' })).toBeDefined()
  await clock.advance(62_000)
  expect(await tools.find({ type: 'Button', key: 'group:tu1', text: '› 處理中 1 分 5 秒 · 執行指令' })).toBeDefined()

  await turn.complete({ turnId: 't1', durationMs: 65_000, answer: '', isAborted: false, reason: 'completed' })
  expect(await tools.find({ type: 'Button', key: 'group:tu1', text: '› 處理了 1 分 5 秒' })).toBeDefined()
  await clock.advance(5_000)
  expect(await tools.find({ type: 'Button', key: 'group:tu1', text: '› 處理了 1 分 5 秒' })).toBeDefined()
})

const BAND = {
  component: 'AbovePrompt',
  props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 100, scroll: { offset: 0, bodyRows: 9 }, view: {} },
} as const

test('展開的一段捲到標頭看不見、內容還在畫面上時，輸入框上方出現浮動列；按「⌃ 收起」就收起', async ($, on) => {
  const clock = mock.clock(on)
  on('ui.render', { component: 'ToolGroup' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>Ran 1 shell command</Text>
  })
  on('ui.render', { component: 'AbovePrompt' }, ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text>技能列</Text>
  })
  await seed($, on, clock)
  const props = (onScreen: { first: number; last: number; of: number } | null) => ({
    calls: [{ tool_use_id: 'tu1', tool: 'Bash', input: {}, isRunning: false, isErrored: true, isInterrupted: false }],
    isActive: false,
    isExpanded: false,
    onScreen,
  })
  const tools = await $.ui.mount({ plugin: 'tidy', surface: 'terminal', component: 'ToolGroup', requestId: 'row1', props: props({ first: 0, last: 2, of: 3 }) })
  const band = await $.ui.mount({ plugin: 'tidy', surface: 'terminal', ...BAND })
  expect(await band.find({ type: 'Text', text: '技能列' })).toBeDefined()
  expect(await band.find({ type: 'Button', key: 'unstick' })).toBeUndefined()

  // 展開後往下捲：標頭那一列捲掉了，內容還在。
  await tools.press({ key: 'group:tu1' })
  await tools.redraw(props({ first: 6, last: 30, of: 40 }))
  expect(await band.find({ type: 'Text', text: '⌄ 處理了 1 分 23 秒 · 1 個錯誤 · ' })).toBeDefined()
  expect(await band.find({ type: 'Button', key: 'unstick', text: '⌃ 收起' })).toBeDefined()
  expect(await band.find({ type: 'Text', text: '技能列' })).toBeDefined()

  // 捲回去看得到標頭：浮動列消失。
  await tools.redraw(props({ first: 1, last: 30, of: 40 }))
  expect(await band.find({ type: 'Button', key: 'unstick' })).toBeUndefined()

  await tools.redraw(props({ first: 6, last: 30, of: 40 }))
  await band.press({ key: 'unstick' })
  expect(await tools.find({ type: 'Button', key: 'group:tu1', text: '› 處理了 1 分 23 秒 · 1 個錯誤' })).toBeDefined()
  expect(await band.find({ type: 'Button', key: 'unstick' })).toBeUndefined()

  // 整段捲出畫面：不畫。
  await tools.press({ key: 'group:tu1' })
  await tools.redraw(props(null))
  expect(await band.find({ type: 'Button', key: 'unstick' })).toBeUndefined()
})

test('模型文字的摘要列（isSummary）也留著；它在一段過程的開頭時，標頭畫在它上面', async ($, on) => {
  const clock = mock.clock(on)
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const turn = $.turn as unknown as { start: (e: unknown) => Promise<unknown>; complete: (e: unknown) => Promise<unknown> }
  await turn.start({ text: '要不要統整', turnId: 't1' })
  await clock.advance(1_000)
  await $.session
    .append({ uuid: 'k1', door: 'response', message: { type: 'assistant', content: [thinking('要，建議統整成兩層。')] } } as never)
    .catch(() => undefined)
  await clock.advance(4_000)
  await $.session
    .append({ uuid: 'k2', door: 'response', message: { type: 'assistant', content: [text('要寫入嗎？')] } } as never)
    .catch(() => undefined)
  await turn.complete({ turnId: 't1', durationMs: 6_000, answer: '', isAborted: false, reason: 'completed' })

  const summary = await $.ui.mount({
    plugin: 'tidy',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'k1',
    props: { text: '要。建議統整成「值只在一處」。', isFirstOfReply: true, isSummary: true, ...ROW },
  })
  expect(await summary.find({ type: 'Button', key: 'group:k1', text: '› 處理了 5 秒' })).toBeDefined()
  expect(await summary.find({ type: 'Markdown' })).toBeDefined()
  expect(await summary.find({ type: 'Text', text: '✻' })).toBeDefined()
})
