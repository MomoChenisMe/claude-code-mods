import type { Header, Row, Turn, View } from '../types'

// 只留最近的輪次；更早的列照原樣畫。
const KEEP = 200

type Block = { readonly type: string; readonly [field: string]: unknown }

export const startTurn = (turns: Turn[], id: string): Turn[] =>
  [...turns, { id, rows: [], durationMs: null, errors: 0 }].slice(-KEEP)

export const endTurn = (turns: Turn[], id: string, durationMs: number): Turn[] =>
  turns.map(t => (t.id === id ? { ...t, durationMs } : t))

// 把主對話新記下的一列併進進行中的那一輪：模型的思考與文字、工具呼叫，與工具結果（出錯的計數，
// 跑完的從「正在跑」拿掉）。沒有進行中的輪次（歷史列、mod 載入前）就不動，回傳原本的表。
export const addRow = (turns: Turn[], uuid: string, type: string, content: readonly Block[]): Turn[] => {
  const current = turns.at(-1)
  if (current === undefined || current.durationMs !== null) {
    return turns
  }
  const rows: Row[] = []
  let errors = 0
  let running = current.running ?? []
  let recent = current.recent
  if (type === 'assistant') {
    // 有內容的思考會畫成一段帶圓點的文字；空的（不給看的）不會畫，不記。
    const thinking = content.filter(b => b.type === 'thinking' && typeof b.thinking === 'string').map(b => b.thinking as string).join('')
    const thought = textKey(thinking)
    if (thought !== null) {
      rows.push({ kind: 'thought', id: uuid, key: thought })
    }
    const texts = content.filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text as string)
    if (texts.length > 0) {
      rows.push({ kind: 'text', id: uuid, key: textKey(texts.join('')) })
    }
    recent = firstSentence(texts.join('\n')) ?? firstSentence(thinking) ?? recent
    const calls = content.filter(b => b.type === 'tool_use' && typeof b.id === 'string')
    if (calls.length > 0) {
      const ids = calls.map(b => b.id as string)
      rows.push(calls.every(b => b.name === 'Agent') ? { kind: 'tools', ids, agents: true } : { kind: 'tools', ids })
      const steps = calls.map(b => ({ id: b.id as string, label: describe(String(b.name), (b.input ?? {}) as Record<string, unknown>) }))
      running = [...running, ...steps]
      recent = steps[steps.length - 1].label
    }
  } else if (type === 'user') {
    const results = content.filter(b => b.type === 'tool_result')
    errors = results.filter(b => b.is_error === true).length
    running = running.filter(step => !results.some(b => b.tool_use_id === step.id))
  }
  if (rows.length === 0 && errors === 0 && running === (current.running ?? []) && recent === current.recent) {
    return turns
  }
  return [...turns.slice(0, -1), { ...current, rows: [...current.rows, ...rows], errors: current.errors + errors, running, recent }]
}

// 工具在標頭上的說明：動詞，與要顯示的那個參數（路徑只留檔名）。
const VERBS: Record<string, [verb: string, field: string]> = {
  Read: ['讀取 ', 'file_path'],
  Edit: ['編輯 ', 'file_path'],
  MultiEdit: ['編輯 ', 'file_path'],
  Write: ['寫入 ', 'file_path'],
  NotebookEdit: ['編輯 ', 'notebook_path'],
  Grep: ['搜尋 ', 'pattern'],
  Glob: ['找檔案 ', 'pattern'],
  Agent: ['subagent：', 'description'],
  WebFetch: ['讀取網頁 ', 'url'],
  WebSearch: ['搜尋網路：', 'query'],
  Skill: ['技能 ', 'skill'],
}

// 「執行：Run the tests」「讀取 register.tsx」；MCP 工具是「伺服器：工具」，其他工具用名稱。
export const describe = (name: string, input: Record<string, unknown>) => {
  const field = (key: string) => (typeof input[key] === 'string' && input[key] !== '' ? (input[key] as string) : undefined)
  if (name === 'Bash') {
    const what = field('description') ?? field('command')?.split('\n')[0]
    return what === undefined ? '執行指令' : `執行：${what}`
  }
  const verb = VERBS[name]
  const value = verb === undefined ? undefined : field(verb[1])
  if (verb !== undefined && value !== undefined) {
    return verb[0] + (verb[1].endsWith('_path') ? value.split('/').pop() : value)
  }
  const mcp = name.match(/^mcp__(.+?)__(.+)$/)
  return mcp === null ? name : `${mcp[1]}：${mcp[2]}`
}

// 一段文字的第一句：第一個非空行，拿掉 Markdown 的強調、程式碼與標題記號，切在第一個句號。
export const firstSentence = (text: string) => {
  const line = text
    .split('\n')
    .map(l => l.replace(/[*`]/g, '').replace(/^\s*(#+|>|[-+]|\d+\.)\s+/, '').trim())
    .find(l => l !== '')
  return line?.split(/(?<=[。！？])|(?<=[.!?])\s/)[0].trim()
}

// 「處理中」後面接的動作：正在跑的工具（同時好幾個時寫「等 n 項」）。沒有工具在跑時是最近一個動作：
// 模型常常不寫說明、思考內容也是空的，工具跑完就保留它的說明，直到下一個工具或新的說明出現。
const doing = (turn: Turn) => {
  const running = turn.running ?? []
  if (running.length === 0) return turn.recent
  return running.length === 1 ? running[0].label : `${running[0].label} 等 ${running.length} 項`
}

// 一輪進行中送進來的訊息（subagent 的回報、背景工作完成的通知）也是過程。沒有進行中的輪次就不動。
export const addNote = (turns: Turn[], uuid: string): Turn[] => {
  const current = turns.at(-1)
  if (current === undefined || current.durationMs !== null) {
    return turns
  }
  return [...turns.slice(0, -1), { ...current, rows: [...current.rows, { kind: 'note', id: uuid }] }]
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

// 一輪裡每一列該怎麼畫，以列 id（文字與思考列的 uuid 與指紋、工具呼叫的 tool_use id、訊息列的 uuid）查。
// 「過程」是工具呼叫、思考、送進來的訊息，以及後面還有工具或思考的文字。收起來時第一個工具列（沒有工具
// 就是第一段思考）畫「處理了 …」，其餘藏起來：工具列一定畫得出來，文字列在有些 session 對不上。展開時
// 標頭移到這一輪的第一列過程，展開的內容才會都在標頭下面。最後一段工具或思考之後的文字是回答。
// 沒有過程列畫得出標頭時（例如這一輪只有一起開的 subagent），標頭畫在第一段回答上面；連回答也沒有
// 就整輪照原樣，免得過程藏起來卻點不開。
export const views = (turn: Turn, isOpen: boolean): Record<string, View> => {
  const errors = turn.errors > 0 ? ` · ${turn.errors} 個錯誤` : ''
  const now = doing(turn)
  const label =
    turn.durationMs !== null ? `處理了 ${duration(turn.durationMs)}${errors}` : now === undefined ? '處理中…' : `處理中 · ${now}`
  const { rows } = turn
  const kinds = rows.map(r => r.kind)
  const lastWork = Math.max(kinds.lastIndexOf('tools'), kinds.lastIndexOf('thought'))
  const isWork = (index: number) => kinds[index] === 'note' || index <= lastWork
  // 同一則回覆開好幾個 subagent 時，引擎把這些呼叫畫成自己的一列「N background agents
  // launched」，mod 畫不到；訊息列也不一定收合（只收 subagent 與背景工作的）。這兩種列不放標頭。
  const isAgents = (row: Row | undefined) => row?.kind === 'tools' && row.agents === true
  const isGrouped = (row: Row, index: number) =>
    row.kind === 'tools' && row.agents === true && (row.ids.length > 1 || isAgents(rows[index - 1]) || isAgents(rows[index + 1]))
  const hosts = rows.flatMap((row, index) => (isWork(index) && row.kind !== 'note' && !isGrouped(row, index) ? [index] : []))
  const firstAnswer = rows.findIndex((_, index) => !isWork(index))
  const host =
    (isOpen ? hosts[0] : (hosts.find(i => kinds[i] === 'tools') ?? hosts.find(i => kinds[i] === 'thought') ?? hosts[0])) ??
    (firstAnswer === -1 ? undefined : firstAnswer)
  const hasWork = rows.some((_, index) => isWork(index))
  const header: Header = { turn: turn.id, label, isOpen }
  const out: Record<string, View> = {}
  rows.forEach((row, index) => {
    const view: View =
      !hasWork || host === undefined
        ? { kind: 'answer' }
        : !isWork(index)
          ? index === host
            ? { kind: 'answer', header }
            : { kind: 'answer' }
          : index === host
            ? { kind: 'header', ...header }
            : { kind: 'work', isOpen }
    const ids = row.kind === 'tools' ? row.ids : row.kind === 'note' ? [row.id] : [row.id, row.key ?? null].filter(id => id !== null)
    for (const id of ids) {
      out[id] = view
    }
  })
  return out
}

// 截成最多 cells 格（中日韓文字算兩格），截掉的地方補「…」。
export const fit = (text: string, cells: number) => {
  let used = 0
  let out = ''
  for (const ch of text) {
    const width = ch.codePointAt(0)! >= 0x2e80 ? 2 : 1
    if (used + width > cells - 1) {
      return `${out}…`
    }
    used += width
    out += ch
  }
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
