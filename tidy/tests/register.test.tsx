import { expect, test } from 'claude-code/testing'
import type { Engine } from 'claude-code/testing'
import type { On } from 'claude-code'

import { noticeOf, senderOf } from '../hooks/agents'
import { addNote, addRow, describe, duration, endTurn, firstSentence, startTurn, textKey, views } from '../hooks/turns'

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
      running: [],
      said: '做好了。',
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
  // 還在跑的工具寫在「處理中」後面。
  expect(views(ran[0], false)['tu2']).toEqual({ kind: 'header', turn: 't2', label: '處理中 · 執行指令', isOpen: false })
  // 展開時標頭移到第一列，展開的內容都在它下面。
  expect(views(ran[0], true)).toEqual({
    b1: { kind: 'header', turn: 't2', label: '處理中 · 執行指令', isOpen: true },
    [textKey('我先跑測試。')!]: { kind: 'header', turn: 't2', label: '處理中 · 執行指令', isOpen: true },
    tu2: { kind: 'work', isOpen: true },
  })
  // 畫在畫面上的思考也是過程；沒有工具的輪次，標頭放在第一段思考。空的思考不記。
  const thinking = (t: string) => ({ type: 'thinking', thinking: t, signature: 'x' })
  let quiet = startTurn([], 't3')
  quiet = addRow(quiet, 'c0', 'assistant', [thinking('')])
  quiet = addRow(quiet, 'c1', 'assistant', [thinking('先確認三個條件。')])
  quiet = addRow(quiet, 'c2', 'assistant', [text('都通過了。')])
  // 沒有工具在跑時，「處理中」後面是模型最近說的那一句。
  expect(views(quiet[0], false)).toEqual({
    c1: { kind: 'header', turn: 't3', label: '處理中 · 都通過了。', isOpen: false },
    [textKey('先確認三個條件。')!]: { kind: 'header', turn: 't3', label: '處理中 · 都通過了。', isOpen: false },
    c2: { kind: 'answer' },
    [textKey('都通過了。')!]: { kind: 'answer' },
  })
  // 有工具時，工具之間的思考收起來，標頭仍在第一個工具列。
  const busy = addRow(addRow(ran, 'b3', 'assistant', [thinking('rebase 有衝突。')]), 'b4', 'assistant', [text('停下來了。')])
  expect(views(busy[0], false)['b3']).toEqual({ kind: 'work', isOpen: false })
  expect(views(busy[0], false)['tu2']).toEqual({ kind: 'header', turn: 't2', label: '處理中 · 執行指令', isOpen: false })
  expect(views(busy[0], false)['b4']).toEqual({ kind: 'answer' })
  // 輪次結束後才來的列（或沒有進行中的輪次）不記。
  expect(addRow(all, 'a4', 'assistant', [text('late')])).toBe(all)
  expect(addRow([], 'a5', 'assistant', [text('history')])).toEqual([])
})

test('subagent：一輪進行中送進來的訊息是過程；同時開好幾個時，標頭不放在呼叫列', () => {
  const agent = (id: string) => ({ type: 'tool_use', id, name: 'Agent', input: { description: id } })
  const thought = (t: string) => ({ type: 'thinking', thinking: t, signature: 'x' })
  const work = { kind: 'work', isOpen: false }
  const answer = { kind: 'answer' }

  // 開一個 subagent，它的回報在這一輪進行中送進來，最後回答。
  let one = startTurn([], 't4')
  one = addRow(one, 'd1', 'assistant', [agent('ag1')])
  one = addNote(one, 'n1')
  one = addRow(one, 'd2', 'assistant', [text('它回報了。')])
  expect(one[0].rows).toEqual([{ kind: 'tools', ids: ['ag1'], agents: true }, { kind: 'note', id: 'n1' }, { kind: 'text', id: 'd2', key: textKey('它回報了。') }])
  expect(views(one[0], false)['ag1']).toEqual({ kind: 'header', turn: 't4', label: '處理中 · subagent：ag1', isOpen: false })
  expect(views(one[0], false)['n1']).toEqual(work)
  expect(views(one[0], false)['d2']).toEqual(answer)

  // 同一則回覆開兩個：引擎把它們畫成自己的一列，標頭改放在思考。
  let two = startTurn([], 't5')
  two = addRow(two, 'e0', 'assistant', [thought('開兩個。')])
  two = addRow(two, 'e1', 'assistant', [agent('ag2')])
  two = addRow(two, 'e2', 'assistant', [agent('ag3')])
  two = addRow(two, 'e3', 'assistant', [text('已開')])
  expect(views(two[0], false)['e0']).toEqual({ kind: 'header', turn: 't5', label: '處理中 · subagent：ag2 等 2 項', isOpen: false })
  expect(views(two[0], false)['ag2']).toEqual(work)
  expect(views(two[0], false)['ag3']).toEqual(work)
  expect(views(two[0], false)['e3']).toEqual(answer)

  // 沒有思考時，標頭畫在回答上面。
  let lead = startTurn([], 't7')
  lead = addRow(lead, 'g1', 'assistant', [agent('ag6')])
  lead = addRow(lead, 'g2', 'assistant', [agent('ag7')])
  lead = addRow(lead, 'g3', 'assistant', [text('已開')])
  expect(views(lead[0], false)['ag6']).toEqual(work)
  expect(views(lead[0], false)['g3']).toEqual({ kind: 'answer', header: { turn: 't7', label: '處理中 · subagent：ag6 等 2 項', isOpen: false } })

  // 連回答也沒有：整輪照原樣，免得藏起來卻點不開。
  let bare = startTurn([], 't6')
  bare = addRow(bare, 'f1', 'assistant', [agent('ag4'), agent('ag5')])
  bare = addNote(bare, 'n2')
  expect(views(bare[0], false)).toEqual({ ag4: answer, ag5: answer, n2: answer })

  // 輪次結束後才來的訊息不記。
  const ended = endTurn(two, 't5', 7_000)
  expect(addNote(ended, 'n3')).toBe(ended)
})

test('「處理中」後面的動作：工具的說明、跑完拿掉，沒有工具在跑時是最近說的那一句', () => {
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
  const label = (all: ReturnType<typeof startTurn>) => (views(all[0], false)['r1'] as { label: string }).label
  let all = startTurn([], 't1')
  all = addRow(all, 'a1', 'assistant', [text('先看兩個檔案。'), read('r1', '/repo/a.ts'), read('r2', '/repo/b.ts')])
  expect(label(all)).toBe('處理中 · 讀取 a.ts 等 2 項')
  all = addRow(all, 'u1', 'user', [{ type: 'tool_result', tool_use_id: 'r1' }])
  expect(label(all)).toBe('處理中 · 讀取 b.ts')
  all = addRow(all, 'u2', 'user', [{ type: 'tool_result', tool_use_id: 'r2' }])
  expect(label(all)).toBe('處理中 · 先看兩個檔案。')
  expect(label(endTurn(all, 't1', 5_000))).toBe('處理了 5 秒')
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

test('subagent 的回報與完成通知收進「› 處理了」；你的訊息與開新一輪的回報照原樣', async ($, on) => {
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
  await call.press({ key: 'turn:t1' })
  expect(await peer.find({ type: 'Text', text: 'msg ok' })).toBeDefined()
  expect(await done.find({ type: 'Text', text: /finished/ })).toBeDefined()
})

test('同時開好幾個 subagent 的一輪，「› 處理了」畫在回答上面，之後的完成通知收在它底下', async ($, on) => {
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
  await append('a3', 'response', 'assistant', [text('已開')])
  await turn.complete({ turnId: 't1', durationMs: 7_000, answer: '已開', isAborted: false, reason: 'completed' })

  const answer = await $.ui.mount({
    plugin: 'tidy',
    surface: 'terminal',
    component: 'AssistantMessage',
    requestId: 'a3',
    props: { text: '已開', isFirstOfReply: true, ...ROW },
  })
  expect(await answer.find({ type: 'Button', key: 'turn:t1', text: '› 處理了 7 秒' })).toBeDefined()
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
  await answer.press({ key: 'turn:t1' })
  expect(await answer.find({ type: 'Button', key: 'turn:t1', text: '⌄ 處理了 7 秒' })).toBeDefined()
  expect(await done.find({ type: 'Text', text: /finished/ })).toBeDefined()
})

test('subagent 的回報畫成一行卡片，點開（isExpanded）才畫全文；完成通知補上狀態與時間', async ($, on) => {
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
