import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderViewport, ResolveInput, Timer } from 'claude-code'

import type { Agent, Header, Turn, View } from '../types'

import { noticeOf, senderOf, STATUS } from './agents'
import { addNote, addRow, duration, endTurn, fit, groupOf, startTurn, textKey, views } from './turns'

export const turns = atom({ plugin: 'tidy', key: 'turns' } as const, [] as Turn[])
// 按「›」展開的過程（每段以它第一列的 id 記）。
export const expanded = atom({ plugin: 'tidy', key: 'expanded' } as const, [] as string[])
// 每一列自己的畫法。畫面只讀這一份，所以新增一列時只有變了的列重畫，長對話也不會拖慢。
// 用 memberOf(view, { requestId: 列 id }) 取某一列的那份。
const view = atom({ plugin: 'tidy', key: 'view' } as const, null as View | null)
// subagent 回報卡片：回報列是誰送來的（以列 id 取），與那個 subagent 的說明和結果（以它的 id 取）。
const sender = atom({ plugin: 'tidy', key: 'sender' } as const, null as string | null)
const agent = atom({ plugin: 'tidy', key: 'agent' } as const, null as Agent | null)

// 一個 ui.render 事件：畫在哪、哪一列、畫面多寬。
type Drawn = ResolveInput & { requestId: string; viewport?: RenderViewport }
// 一列在對話畫面裡露出的範圍（props.onScreen）：null 是在畫面外，沒有這個欄位是畫面不回報。
type OnScreen = { first: number } | null | undefined

// 只寫畫法有變的列。
const paint = async ($: EngineInterface, before: Record<string, View>, after: Record<string, View>) => {
  for (const [id, next] of Object.entries(after)) {
    if (JSON.stringify(before[id]) !== JSON.stringify(next)) {
      await update($, memberOf(view, { requestId: id }), () => next)
    }
  }
}

// 改輪次表，再把有變的輪次重新算一次各列畫法。
const change = async ($: EngineInterface, fn: (all: Turn[]) => Turn[]) => {
  let before: Turn[] = []
  let after: Turn[] = []
  await update($, turns, all => {
    before = all
    after = fn(all)
    return after
  })
  const [open, now] = await Promise.all([read($, expanded), $.clock.now()])
  for (const turn of after) {
    const old = before.find(t => t.id === turn.id)
    if (old !== turn) {
      await paint($, old === undefined ? {} : views(old, open, now), views(turn, open, now))
    }
  }
}

// 「處理中 12 秒」的時間每秒往前走：進行中的那一輪每秒重算一次，只有標頭那一列的畫法會變。
// 這一輪結束（沒有進行中的輪次）就停。ticked 是上一次重算用的時間。
let ticker: Timer | null = null
let ticked = 0

const tick = async ($: EngineInterface) => {
  const current = (await read($, turns)).at(-1)
  if (current === undefined || current.durationMs !== null) {
    stopTicking()
    return
  }
  const [open, now] = await Promise.all([read($, expanded), $.clock.now()])
  await paint($, views(current, open, ticked), views(current, open, now))
  ticked = now
}

const startTicking = async ($: EngineInterface) => {
  if (ticker === null) {
    ticked = await $.clock.now()
    ticker = $.clock.every(1000, () => void tick($))
  }
}

const stopTicking = () => {
  ticker?.cancel()
  ticker = null
}

const toggle = async ($: EngineInterface, group: string) => {
  let before: string[] = []
  let after: string[] = []
  await update($, expanded, ids => {
    before = ids
    after = ids.includes(group) ? ids.filter(one => one !== group) : [...ids, group]
    return after
  })
  const turn = (await read($, turns)).find(t => t.rows.some(r => groupOf(r) === group))
  if (turn !== undefined) {
    const now = await $.clock.now()
    await paint($, views(turn, before, now), views(turn, after, now))
  }
}

// 浮動列：展開中的一段，標頭捲出畫面、內容還在畫面上時，輸入框上方畫一列「⌄ 處理了 … · ⌃ 收起」，不用捲回去就
// 能收起。每一列露出多少只在畫它的時候知道（捲動時，畫面邊緣的列會重畫），畫面 hook 又不能寫 $.state，所以記在
// 模組裡；該出現、該換或該消失時，請引擎把這個 mod 畫的東西重畫一次。
type Seen = { group: string; shows: boolean; header?: { label: string; requestId: string; shows: boolean } }
const seen = new Map<string, Seen>()
let stuck: { group: string; label: string; requestId: string } | null = null

const stuckOf = () => {
  const groups = new Map<string, Omit<Seen, 'group'>>()
  for (const one of seen.values()) {
    const g = groups.get(one.group)
    groups.set(one.group, { shows: (g?.shows ?? false) || one.shows, header: one.header ?? g?.header })
  }
  const found = [...groups].filter(([, g]) => g.shows && g.header !== undefined && !g.header.shows).at(-1)
  return found === undefined ? null : { group: found[0], label: found[1].header!.label, requestId: found[1].header!.requestId }
}

// 標頭那一列最上面是一行空白（marginTop），所以捲掉一行時標頭還看得到。
const track = ($: EngineInterface, e: Drawn, site: string, view: View | null, onScreen: OnScreen) => {
  if (onScreen === undefined) {
    return
  }
  const id = `${site}:${e.requestId}`
  if (view === null || view.kind === 'answer' || !view.isOpen) {
    seen.delete(id)
  } else {
    const shows = onScreen !== null
    seen.set(id, {
      group: view.group,
      shows,
      header: view.kind === 'header' ? { label: view.label, requestId: e.requestId, shows: shows && onScreen.first <= 1 } : undefined,
    })
  }
  const next = stuckOf()
  if (JSON.stringify(next) !== JSON.stringify(stuck)) {
    stuck = next
    $.ui.invalidate('ui.render')
  }
}

// 從浮動列收起：收起這一段，再把畫面捲回它的標頭。捲不動（畫面不支援）也已經收起了。
const unstick = async ($: EngineInterface, at: NonNullable<typeof stuck>) => {
  await toggle($, at.group)
  await $.ui.scroll({ to: { requestId: at.requestId } }).catch(() => undefined)
}

// 過程裡的一列（含工具結果、執行中的「ctrl+b 放到背景」提示）：收起來時藏起來，展開時照原樣、
// 縮排兩格，看得出是「處理了」底下的內容。回答與不在輪次表裡的列照原樣。
const tail = async ($: EngineInterface, e: Drawn, view: View | null, original: () => Promise<RenderElement>) => {
  if (view === null || view.kind === 'answer') {
    return original()
  }
  const { Box } = $.ui.resolve(e)
  return view.isOpen ? (
    <Box paddingLeft={2} flexDirection="column">
      {await original()}
    </Box>
  ) : (
    <Box />
  )
}

// 「› 處理了 1 分 23 秒」；按下去展開或收起這一段過程。「處理中 · …」太長時截成一行。
const headerRow = ($: EngineInterface, e: Drawn, header: Header) => {
  const { Box, Button, Text } = $.ui.resolve(e)
  const label = fit(header.label, (e.viewport?.columns ?? 80) - 8)
  return (
    <Box marginTop={1}>
      <Button key={`group:${header.group}`} label={`${header.isOpen ? '⌄' : '›'} ${label}`} plain dimColor onPress={() => toggle($, header.group)} />
      <Text> </Text>
    </Box>
  )
}

// 過程列：一段的第一個工具列換成「› 處理了 1 分 23 秒」，其餘藏起來；按下去展開，內容縮排在標頭下面。
// 不是過程列（模型寫的文字、不在輪次表裡的列）回 null。
const fold = async ($: EngineInterface, e: Drawn, view: View | null, original: () => Promise<RenderElement>): Promise<RenderElement | null> => {
  if (view === null || view.kind === 'answer') {
    return null
  }
  if (view.kind === 'work') {
    return tail($, e, view, original)
  }
  const { Box } = $.ui.resolve(e)
  return view.isOpen ? (
    <Box flexDirection="column">
      {headerRow($, e, view)}
      {await tail($, e, view, original)}
    </Box>
  ) : (
    headerRow($, e, view)
  )
}

// 記下 subagent 的回報是誰送來的（類型與任務說明查 $.agent.list()），以及完成通知的狀態和時間。
// 通知通常比回報晚幾秒到；先到也照記，回報到了再補上說明。
const noteAgents = async ($: EngineInterface, uuid: string, content: readonly { type: string; [field: string]: unknown }[]) => {
  const from = senderOf(content)
  if (from !== null) {
    const info = (await $.agent.list()).find(one => one.id === from)
    await update($, memberOf(agent, { requestId: from }), a => ({
      status: null,
      durationMs: null,
      ...a,
      type: info?.type ?? a?.type ?? '',
      description: info?.description ?? a?.description ?? '',
    }))
    await update($, memberOf(sender, { requestId: uuid }), () => from)
  }
  const notice = noticeOf(content)
  if (notice !== null) {
    await update($, memberOf(agent, { requestId: notice.id }), a => ({
      type: '',
      description: '',
      ...a,
      status: notice.status,
      durationMs: notice.durationMs ?? a?.durationMs ?? null,
    }))
  }
}

// subagent 回報卡片：「◆ Explore · Review Standards axis · 完成 2 分 17 秒  › 回報」。點一下這一列，引擎把它
// 標成展開（和 ctrl+o 的完整紀錄一樣），回報全文縮排兩格畫在底下；再點一下收起。失敗或被停止時「◆」與狀態
// 是紅色。不知道是誰送來的（mod 載入前的回報）回 null。
const card = async ($: EngineInterface, e: Drawn, report: string, name: string | undefined, isOpen: boolean) => {
  const from = await read($, memberOf(sender, e))
  if (from === null) {
    return null
  }
  const info = await read($, memberOf(agent, { requestId: from }))
  const { Box, Markdown, Text } = $.ui.resolve(e)
  const failed = info?.status === 'failed' || info?.status === 'killed'
  const title = [info?.type ?? '', info?.description ?? ''].filter(part => part !== '').join(' · ') || (name ?? 'subagent')
  const status =
    info === null || info.status === null
      ? null
      : [STATUS[info.status] ?? info.status, info.durationMs === null ? '' : duration(info.durationMs)].join(' ').trim()
  return (
    <Box flexDirection="column" marginTop={1}>
      <Box>
        <Box width={2} flexShrink={0}>
          <Text color={failed ? 'error' : 'suggestion'}>◆</Text>
        </Box>
        <Text>{title}</Text>
        {status !== null && (
          <Text color={failed ? 'error' : undefined} dimColor={!failed}>
            {` · ${status}`}
          </Text>
        )}
        <Box marginLeft={2} flexShrink={0}>
          <Text dimColor>{`${isOpen ? '⌄' : '›'} 回報`}</Text>
        </Box>
      </Box>
      {isOpen && (
        <Box paddingLeft={2} flexDirection="column">
          <Markdown text={report} />
        </Box>
      )}
    </Box>
  )
}

export const register: Register = on => {
  // 重新載入 mod（/reload-plugins）時輪次表還在，照它把各列畫法補回來；還在進行的那一輪接著計時。
  // 新 session 的表是空的。
  on('session.start', async ($, e, next) => {
    const [open, now, all] = await Promise.all([read($, expanded), $.clock.now(), read($, turns)])
    for (const turn of all) {
      await paint($, {}, views(turn, open, now))
    }
    if (all.at(-1)?.durationMs === null) {
      await startTicking($)
    }
    return next(e)
  })

  // 輪次表只記主對話；subagent 的輪次與列都帶 agentId。
  on('turn.start', async ($, e, next) => {
    const startedAt = await $.clock.now()
    await change($, all => startTurn(all, e.turnId, startedAt))
    await startTicking($)
    return next(e)
  })

  // 回答完、被中斷（Esc）或出錯都會結束這一輪。
  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      stopTicking()
      await change($, all => endTurn(all, e.turnId, e.durationMs))
    }
    return next(e)
  })

  // 這個 hook 擋在寫入對話紀錄的路上：先記帳再交給下一層；記帳出錯也照樣寫入。
  // 一輪進行中送進來的訊息走 delivery。
  on('session.append', async ($, e, next) => {
    if (e.agentId === undefined) {
      const at = await $.clock.now()
      await change($, all => (e.door === 'delivery' ? addNote(all, e.uuid, at) : addRow(all, e.uuid, e.message.type, e.message.content, at)))
      await noteAgents($, e.uuid, e.message.content)
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    // 先用列 id 找；有些 session 的列 id 對不上 uuid，再用內文指紋找。
    const key = textKey(e.props.text)
    const found = (await read($, memberOf(view, e))) ?? (key === null ? null : await read($, memberOf(view, { requestId: key })))
    // 模型文字的摘要列（isSummary，掛在思考的 uuid 上）也是寫給你的話：照原樣留著；它是一段過程的標頭時，
    // 標頭畫在它上面。
    const mine: View | null =
      e.props.isSummary === true && found !== null && found.kind !== 'answer'
        ? { kind: 'answer', header: found.kind === 'header' ? found : undefined }
        : found
    track($, e, 'AssistantMessage', mine, e.props.onScreen)
    const folded = await fold($, e, mine, () => next(e))
    if (folded !== null) return folded
    if (mine === null) return next(e)
    // 回答：開頭換成橘色粗體的「✻」，內容接在後面，換行縮排兩格對齊。
    const { Box, Markdown, Text } = $.ui.resolve(e)
    const answer = (
      <Box marginTop={1}>
        <Box width={2} flexShrink={0}>
          <Text color="claude" bold>
            ✻
          </Text>
        </Box>
        <Box flexDirection="column" flexGrow={1}>
          <Markdown text={e.props.text} />
        </Box>
      </Box>
    )
    return mine.kind === 'answer' && mine.header !== undefined ? (
      <Box flexDirection="column">
        {headerRow($, e, mine.header)}
        {answer}
      </Box>
    ) : (
      answer
    )
  })

  // 一組工具呼叫看它第一個呼叫的畫法：同一組的呼叫都在同一輪裡，標頭所在的第一個工具列就是第一組的第一個呼叫。
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const first = e.props.calls.find(c => c.tool_use_id !== undefined)?.tool_use_id
    if (first === undefined) return next(e)
    const mine = await read($, memberOf(view, { requestId: first }))
    track($, e, 'ToolGroup', mine, e.props.onScreen)
    const folded = await fold($, e, mine, () => next(e))
    return folded ?? next(e)
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const mine = await read($, memberOf(view, { requestId: e.props.tool_use_id }))
    track($, e, 'ToolUse', mine, e.props.onScreen)
    const folded = await fold($, e, mine, () => next(e))
    return folded ?? next(e)
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const mine = await read($, memberOf(view, { requestId: e.props.tool_use_id }))
    track($, e, 'ToolResult', mine, e.props.onScreen)
    return tail($, e, mine, () => next(e))
  })

  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    return tail($, e, await read($, memberOf(view, { requestId: e.props.tool_use_id })), () => next(e))
  })

  // subagent 的回報（Message from @…）畫成卡片，背景工作完成的通知（Agent "…" finished）藏起來：一輪進行中
  // 送進來的收進那一輪；回答之後才來的完成通知，跟著開這個工作的工具呼叫收起來。回答之後才來的回報會開新
  // 的一輪，和你的訊息一樣留在對話裡。點開的列與 ctrl+o 的完整紀錄（isExpanded）不收合。
  on('ui.render', { component: 'UserMessage' }, async ($, e, next) => {
    const { origin, task, isExpanded } = e.props
    if (e.surface !== 'terminal' || (origin.kind !== 'peer' && origin.kind !== 'task-notification')) {
      return next(e)
    }
    const mine = await read($, memberOf(view, e))
    const opener =
      mine === null && task?.toolUseId !== undefined ? await read($, memberOf(view, { requestId: task.toolUseId })) : null
    const found = mine ?? opener
    const shown: View | null = isExpanded && found !== null && found.kind !== 'answer' ? { kind: 'work', group: found.group, isOpen: true } : found
    track($, e, 'UserMessage', shown, e.props.onScreen)
    const drawn = async () =>
      origin.kind === 'peer' ? ((await card($, e, e.props.text, e.props.from?.name, isExpanded)) ?? next(e)) : next(e)
    return tail($, e, shown, drawn)
  })

  // 浮動列畫在輸入框上方這一區的最上面，其他 mod 畫的（例如 speclink 的技能列）接在下面。/clear 之後新 session
  // 沒有展開中的段，所以舊的記錄不會畫出來。
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const below = await next(e)
    const at = stuck
    if (e.surface !== 'terminal' || e.props.hasSurvey || at === null || !(await read($, expanded)).includes(at.group)) {
      return below
    }
    const { Box, Button, Text } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Box>
          <Text dimColor>{`⌄ ${fit(at.label, e.props.bodyColumns - 12)} · `}</Text>
          <Button key="unstick" label="⌃ 收起" plain dimColor onPress={() => unstick($, at)} />
        </Box>
        {below}
      </Box>
    )
  })

  // 每輪結尾的「Worked for …」：時間已經寫在「處理了 …」裡。
  on('ui.render', { component: 'TurnDuration' }, ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
}
