import type { Row, Turn, View } from '../types'

// 只留最近的輪次；更早的列照原樣畫。
const KEEP = 200

type Block = { readonly type: string; readonly [field: string]: unknown }

export const startTurn = (turns: Turn[], id: string): Turn[] =>
  [...turns, { id, rows: [], durationMs: null, errors: 0 }].slice(-KEEP)

export const endTurn = (turns: Turn[], id: string, durationMs: number): Turn[] =>
  turns.map(t => (t.id === id ? { ...t, durationMs } : t))

// 把主對話新記下的一列併進進行中的那一輪：模型的思考與文字、工具呼叫，與出錯的工具結果。
// 沒有進行中的輪次（歷史列、mod 載入前）就不動，回傳原本的表。
export const addRow = (turns: Turn[], uuid: string, type: string, content: readonly Block[]): Turn[] => {
  const current = turns.at(-1)
  if (current === undefined || current.durationMs !== null) {
    return turns
  }
  const rows: Row[] = []
  let errors = 0
  if (type === 'assistant') {
    // 有內容的思考會畫成一段帶圓點的文字；空的（不給看的）不會畫，不記。
    const thought = textKey(content.filter(b => b.type === 'thinking' && typeof b.thinking === 'string').map(b => b.thinking as string).join(''))
    if (thought !== null) {
      rows.push({ kind: 'thought', id: uuid, key: thought })
    }
    const texts = content.filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text as string)
    if (texts.length > 0) {
      rows.push({ kind: 'text', id: uuid, key: textKey(texts.join('')) })
    }
    const ids = content.filter(b => b.type === 'tool_use' && typeof b.id === 'string').map(b => b.id as string)
    if (ids.length > 0) {
      rows.push({ kind: 'tools', ids })
    }
  } else if (type === 'user') {
    errors = content.filter(b => b.type === 'tool_result' && b.is_error === true).length
  }
  if (rows.length === 0 && errors === 0) {
    return turns
  }
  return [...turns.slice(0, -1), { ...current, rows: [...current.rows, ...rows], errors: current.errors + errors }]
}

// 文字的指紋：去掉空白後的 FNV-1a 雜湊。畫面給的列 id 對不上 uuid 時，用內文找回同一列。
export const textKey = (text: string) => {
  let hash = 0x811c9dc5
  const bare = text.replace(/\s+/g, '')
  for (const ch of bare) {
    hash = Math.imul(hash ^ ch.codePointAt(0)!, 0x01000193) >>> 0
  }
  return bare === '' ? null : `text:${hash.toString(16)}`
}

// 一輪裡每一列該怎麼畫，以列 id（文字與思考列的 uuid 與指紋、工具呼叫的 tool_use id）查。
// 「過程」是工具呼叫、思考，以及後面還有工具或思考的文字。收起來時第一個工具列（沒有工具就是第一段
// 思考）畫「處理了 …」，其餘藏起來：工具列一定畫得出來，文字列在有些 session 對不上。展開時標頭
// 移到這一輪的第一列，展開的內容才會都在標頭下面。最後一段過程之後的文字是回答。
export const views = (turn: Turn, isOpen: boolean): Record<string, View> => {
  const errors = turn.errors > 0 ? ` · ${turn.errors} 個錯誤` : ''
  const label = turn.durationMs === null ? '處理中…' : `處理了 ${duration(turn.durationMs)}${errors}`
  const kinds = turn.rows.map(r => r.kind)
  const host = isOpen ? 0 : kinds.includes('tools') ? kinds.indexOf('tools') : kinds.indexOf('thought')
  const lastWork = Math.max(kinds.lastIndexOf('tools'), kinds.lastIndexOf('thought'))
  const out: Record<string, View> = {}
  turn.rows.forEach((row, index) => {
    const view: View =
      index > lastWork
        ? { kind: 'answer' }
        : index === host
          ? { kind: 'header', turn: turn.id, label, isOpen }
          : { kind: 'work', isOpen }
    const ids = row.kind === 'tools' ? row.ids : [row.id, row.key ?? null].filter(id => id !== null)
    for (const id of ids) {
      out[id] = view
    }
  })
  return out
}

// 83000 → 1 分 23 秒
export const duration = (ms: number) => {
  const s = Math.max(1, Math.round(ms / 1000))
  if (s < 60) return `${s} 秒`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m} 分 ${s % 60} 秒`
  return `${Math.floor(m / 60)} 小時 ${m % 60} 分`
}
