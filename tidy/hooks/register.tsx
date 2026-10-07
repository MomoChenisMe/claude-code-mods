import { atom, memberOf, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, ResolveInput } from 'claude-code'

import type { Turn, View } from '../types'

import { addRow, endTurn, startTurn, textKey, views } from './turns'

export const turns = atom({ plugin: 'tidy', key: 'turns' } as const, [] as Turn[])
// 按「›」展開的輪次。
export const expanded = atom({ plugin: 'tidy', key: 'expanded' } as const, [] as string[])
// 每一列自己的畫法。畫面只讀這一份，所以新增一列時只有變了的列重畫，長對話也不會拖慢。
// 用 memberOf(view, { requestId: 列 id }) 取某一列的那份。
const view = atom({ plugin: 'tidy', key: 'view' } as const, null as View | null)

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
  const open = await read($, expanded)
  for (const turn of after) {
    const old = before.find(t => t.id === turn.id)
    if (old !== turn) {
      const isOpen = open.includes(turn.id)
      await paint($, old === undefined ? {} : views(old, isOpen), views(turn, isOpen))
    }
  }
}

const toggle = async ($: EngineInterface, id: string) => {
  let isOpen = false
  await update($, expanded, ids => {
    isOpen = !ids.includes(id)
    return isOpen ? [...ids, id] : ids.filter(one => one !== id)
  })
  const turn = (await read($, turns)).find(t => t.id === id)
  if (turn !== undefined) {
    await paint($, views(turn, !isOpen), views(turn, isOpen))
  }
}

// 過程裡的一列（含工具結果、執行中的「ctrl+b 放到背景」提示）：收起來時藏起來，展開時照原樣、
// 縮排兩格，看得出是「處理了」底下的內容。回答與不在輪次表裡的列照原樣。
const tail = async ($: EngineInterface, e: ResolveInput, view: View | null, original: () => Promise<RenderElement>) => {
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

// 過程列：第一個工具列換成「› 處理了 1 分 23 秒」，其餘藏起來；按下去展開，內容縮排在標頭下面。
// 不是過程列（回答、不在輪次表裡的列）回 null。
const fold = async ($: EngineInterface, e: ResolveInput, view: View | null, original: () => Promise<RenderElement>): Promise<RenderElement | null> => {
  if (view === null || view.kind === 'answer') {
    return null
  }
  if (view.kind === 'work') {
    return tail($, e, view, original)
  }
  const { Box, Button, Text } = $.ui.resolve(e)
  const header = (
    <Box marginTop={1}>
      <Button key={`turn:${view.turn}`} label={`${view.isOpen ? '⌄' : '›'} ${view.label}`} plain dimColor onPress={() => toggle($, view.turn)} />
      <Text> </Text>
    </Box>
  )
  return view.isOpen ? (
    <Box flexDirection="column">
      {header}
      {await tail($, e, view, original)}
    </Box>
  ) : (
    header
  )
}

export const register: Register = on => {
  // 重新載入 mod（/reload-plugins）時輪次表還在，照它把各列畫法補回來。新 session 的表是空的。
  on('session.start', async ($, e, next) => {
    const open = await read($, expanded)
    for (const turn of await read($, turns)) {
      await paint($, {}, views(turn, open.includes(turn.id)))
    }
    return next(e)
  })

  // 輪次表只記主對話；subagent 的輪次與列都帶 agentId。
  on('turn.start', async ($, e, next) => {
    await change($, all => startTurn(all, e.turnId))
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    if (e.agentId === undefined) {
      await change($, all => endTurn(all, e.turnId, e.durationMs))
    }
    return next(e)
  })

  // 這個 hook 擋在寫入對話紀錄的路上：先記帳再交給下一層；記帳出錯也照樣寫入。
  on('session.append', async ($, e, next) => {
    if (e.agentId === undefined) {
      await change($, all => addRow(all, e.uuid, e.message.type, e.message.content))
    }
    return next(e)
  }).catch(($, e, next) => next(e))

  on('ui.render', { component: 'AssistantMessage' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    // 先用列 id 找；有些 session 的列 id 對不上 uuid，再用內文指紋找。
    const key = textKey(e.props.text)
    const mine = (await read($, memberOf(view, e))) ?? (key === null ? null : await read($, memberOf(view, { requestId: key })))
    const folded = await fold($, e, mine, () => next(e))
    if (folded !== null) return folded
    if (mine === null) return next(e)
    // 回答：開頭換成橘色粗體的「✻」，內容接在後面，換行縮排兩格對齊。
    const { Box, Markdown, Text } = $.ui.resolve(e)
    return (
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
  })

  // 一組工具呼叫看它第一個呼叫的畫法：同一組的呼叫都在同一輪裡，標頭所在的第一個工具列就是第一組的第一個呼叫。
  on('ui.render', { component: 'ToolGroup' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const first = e.props.calls.find(c => c.tool_use_id !== undefined)?.tool_use_id
    if (first === undefined) return next(e)
    const folded = await fold($, e, await read($, memberOf(view, { requestId: first })), () => next(e))
    return folded ?? next(e)
  })

  on('ui.render', { component: 'ToolUse' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const folded = await fold($, e, await read($, memberOf(view, { requestId: e.props.tool_use_id })), () => next(e))
    return folded ?? next(e)
  })

  on('ui.render', { component: 'ToolResult' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    return tail($, e, await read($, memberOf(view, { requestId: e.props.tool_use_id })), () => next(e))
  })

  on('ui.render', { component: 'ToolProgress' }, async ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    return tail($, e, await read($, memberOf(view, { requestId: e.props.tool_use_id })), () => next(e))
  })

  // 每輪結尾的「Worked for …」：時間已經寫在「處理了 …」裡。
  on('ui.render', { component: 'TurnDuration' }, ($, e, next) => {
    if (e.surface !== 'terminal') return next(e)
    const { Box } = $.ui.resolve(e)
    return <Box />
  })
}
