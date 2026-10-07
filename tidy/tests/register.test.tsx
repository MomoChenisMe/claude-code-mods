import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { addRow, duration, endTurn, startTurn, textKey, views } from '../hooks/turns'

const text = (t: string) => ({ type: 'text', text: t })
const toolUse = (id: string) => ({ type: 'tool_use', id, name: 'Bash', input: {} })

// 一輪：先說明、跑一個工具、出錯一次，最後回答。
const oneTurn = () => {
  let all = startTurn([], 't1')
  all = addRow(all, 'a1', 'assistant', [text('我先看一下檔案。')])
  all = addRow(all, 'a2', 'assistant', [toolUse('tu1')])
  all = addRow(all, 'u1', 'user', [{ type: 'tool_result', tool_use_id: 'tu1', is_error: true }])
  all = addRow(all, 'a3', 'assistant', [text('做好了。')])
  return endTurn(all, 't1', 83_000)
}

const INTRO = textKey('我先看一下檔案。')!
const DONE = textKey('做好了。')!

test('依序記下一輪的列；最後一次工具呼叫之後的文字是回答，其餘是過程', () => {
  const all = oneTurn()
  expect(all).toEqual([
    {
      id: 't1',
      rows: [
        { kind: 'text', id: 'a1', key: INTRO },
        { kind: 'tools', ids: ['tu1'] },
        { kind: 'text', id: 'a3', key: DONE },
      ],
      durationMs: 83_000,
      errors: 1,
    },
  ])
  // 標頭在第一個工具列；文字列用 uuid 與內文指紋都查得到。
  expect(views(all[0], false)).toEqual({
    a1: { kind: 'work', isOpen: false },
    [INTRO]: { kind: 'work', isOpen: false },
    tu1: { kind: 'header', turn: 't1', label: '處理了 1 分 23 秒 · 1 個錯誤', isOpen: false },
    a3: { kind: 'answer' },
    [DONE]: { kind: 'answer' },
  })
  // 指紋不管空白；沒有內文就沒有指紋。
  expect(textKey('我先看一下\n檔案。 ')).toBe(INTRO)
  expect(textKey('  ')).toBe(null)
  // 還在進行：最新的一段文字先當回答，等後面出現工具呼叫才收進過程。
  const running = addRow(startTurn([], 't2'), 'b1', 'assistant', [text('我先跑測試。')])
  expect(views(running[0], false)).toEqual({ b1: { kind: 'answer' }, [textKey('我先跑測試。')!]: { kind: 'answer' } })
  const ran = addRow(running, 'b2', 'assistant', [toolUse('tu2')])
  expect(views(ran[0], false)['tu2']).toEqual({ kind: 'header', turn: 't2', label: '處理中…', isOpen: false })
  // 展開時標頭移到第一列，展開的內容都在它下面。
  expect(views(ran[0], true)).toEqual({
    b1: { kind: 'header', turn: 't2', label: '處理中…', isOpen: true },
    [textKey('我先跑測試。')!]: { kind: 'header', turn: 't2', label: '處理中…', isOpen: true },
    tu2: { kind: 'work', isOpen: true },
  })
  // 畫在畫面上的思考也是過程；沒有工具的輪次，標頭放在第一段思考。空的思考不記。
  const thinking = (t: string) => ({ type: 'thinking', thinking: t, signature: 'x' })
  let quiet = startTurn([], 't3')
  quiet = addRow(quiet, 'c0', 'assistant', [thinking('')])
  quiet = addRow(quiet, 'c1', 'assistant', [thinking('先確認三個條件。')])
  quiet = addRow(quiet, 'c2', 'assistant', [text('都通過了。')])
  expect(views(quiet[0], false)).toEqual({
    c1: { kind: 'header', turn: 't3', label: '處理中…', isOpen: false },
    [textKey('先確認三個條件。')!]: { kind: 'header', turn: 't3', label: '處理中…', isOpen: false },
    c2: { kind: 'answer' },
    [textKey('都通過了。')!]: { kind: 'answer' },
  })
  // 有工具時，工具之間的思考收起來，標頭仍在第一個工具列。
  const busy = addRow(addRow(ran, 'b3', 'assistant', [thinking('rebase 有衝突。')]), 'b4', 'assistant', [text('停下來了。')])
  expect(views(busy[0], false)['b3']).toEqual({ kind: 'work', isOpen: false })
  expect(views(busy[0], false)['tu2']).toEqual({ kind: 'header', turn: 't2', label: '處理中…', isOpen: false })
  expect(views(busy[0], false)['b4']).toEqual({ kind: 'answer' })
  // 輪次結束後才來的列（或沒有進行中的輪次）不記。
  expect(addRow(all, 'a4', 'assistant', [text('late')])).toBe(all)
  expect(addRow([], 'a5', 'assistant', [text('history')])).toEqual([])
})

test('時間的格式', () => {
  expect(duration(400)).toBe('1 秒')
  expect(duration(23_000)).toBe('23 秒')
  expect(duration(83_000)).toBe('1 分 23 秒')
  expect(duration(3_720_000)).toBe('1 小時 2 分')
})

const ROW = { onScreen: null }

// 用 mod 自己聽的事件把同一輪餵進去。測試裡沒辦法替 session.append 墊底，那一步在 mod
// 記完帳之後才失敗，所以吞掉它的錯誤。
const seed = async ($: Engine, on: On) => {
  on('turn.start', ($, e) => ({ turnId: e.turnId }))
  on('turn.complete', () => ({ text: '' }))
  const append = (uuid: string, type: string, content: unknown[]) =>
    $.session
      .append({ uuid, door: type === 'user' ? 'tool-result' : 'response', message: { type, content } } as never)
      .catch(() => undefined)
  // 測試引擎的型別只列出 turn.abort，turn.start／turn.complete 實際上叫得到。
  const turn = $.turn as unknown as { start: (e: unknown) => Promise<unknown>; complete: (e: unknown) => Promise<unknown> }
  await turn.start({ text: '整理一下', turnId: 't1' })
  await append('a1', 'assistant', [text('我先看一下檔案。')])
  await append('a2', 'assistant', [toolUse('tu1')])
  await append('u1', 'user', [{ type: 'tool_result', tool_use_id: 'tu1', is_error: true }])
  await append('a3', 'assistant', [text('做好了。')])
  await turn.complete({ turnId: 't1', durationMs: 83_000, answer: '做好了。', isAborted: false, reason: 'completed' })
}

test('過程收成一行「› 處理了」，按下去展開；回答開頭標上「✻」', async ($, on) => {
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
  await seed($, on)

  const intro = await $.ui.mount({
    plugin: 'tidy',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'a1',
    props: { text: '我先看一下檔案。', isFirstOfReply: true, ...ROW },
  })
  expect(await intro.find({ type: 'Text', text: /我先看一下/ })).toBeUndefined()
  // 畫面給的列 id 對不上 uuid 時，用內文指紋認出同一段過程文字。
  const stray = await $.ui.mount({
    plugin: 'tidy',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'not-the-uuid',
    props: { text: '我先看一下檔案。\n', isFirstOfReply: true, ...ROW },
  })
  expect(await stray.find({ type: 'Text', text: /我先看一下/ })).toBeUndefined()

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
  expect(await tools.find({ type: 'Button', key: 'turn:t1', text: '› 處理了 1 分 23 秒 · 1 個錯誤' })).toBeDefined()
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

  await tools.press({ key: 'turn:t1' })
  expect(await intro.find({ type: 'Button', key: 'turn:t1', text: '⌄ 處理了 1 分 23 秒 · 1 個錯誤' })).toBeDefined()
  expect(await intro.find({ type: 'Text', text: '● 我先看一下檔案。' })).toBeDefined()
  expect(await tools.find({ type: 'Button', key: 'turn:t1' })).toBeUndefined()
  expect(await tools.find({ type: 'Text', text: 'Ran 1 shell command' })).toBeDefined()
  expect(await hint.find({ type: 'Text', text: /ctrl\+b/ })).toBeDefined()
})

test('不在輪次表裡的列（歷史、mod 載入前）照原樣畫', async ($, on) => {
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
