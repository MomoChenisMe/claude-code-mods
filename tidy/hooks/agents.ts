// subagent 的回報與背景工作的完成通知：從主對話記下的原始內容取出是誰、怎麼結束、花了多久。

type Block = { readonly type: string; readonly [field: string]: unknown }

const textOf = (content: readonly Block[]) =>
  content.map(b => (b.type === 'text' && typeof b.text === 'string' ? b.text : '')).join('\n')

// 回報開頭的 `<agent-message from="a8e5…">`：送來的 subagent 的 id；不是回報回 null。
export const senderOf = (content: readonly Block[]) => textOf(content).match(/<agent-message from="([^"]+)"/)?.[1] ?? null

// `<task-notification>` 裡的工作 id（subagent 的就是它的 id）、狀態與花費時間；背景指令的通知沒有時間。
export const noticeOf = (content: readonly Block[]) => {
  const text = textOf(content)
  if (!text.includes('<task-notification>')) {
    return null
  }
  const tag = (name: string) => text.match(new RegExp(`<${name}>([^<]*)</${name}>`))?.[1]
  const id = tag('task-id')
  const ms = tag('duration_ms')
  return id === undefined ? null : { id, status: tag('status') ?? null, durationMs: ms === undefined ? null : Number(ms) }
}

// 狀態在卡片上的寫法；其他字照原樣。
export const STATUS: Record<string, string> = { completed: '完成', failed: '失敗', killed: '已停止' }
