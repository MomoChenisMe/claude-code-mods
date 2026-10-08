import type { Header, Row, Turn, View } from '../types'

// 只留最近的輪次；更早的列照原樣畫。
const KEEP = 200

type Block = { readonly type: string; readonly [field: string]: unknown }

export const startTurn = (turns: Turn[], id: string, startedAt: number): Turn[] =>
  [...turns, { id, rows: [], durationMs: null, startedAt }].slice(-KEEP)

export const endTurn = (turns: Turn[], id: string, durationMs: number): Turn[] =>
  turns.map(t => (t.id === id ? { ...t, durationMs } : t))

// 把主對話新記下的一列併進進行中的那一輪：模型的思考與文字、工具呼叫，與工具結果（出錯的記在那次呼叫上，
// 跑完的從「正在跑」拿掉）。at 是記下的時間，用來算每段過程花多久。沒有進行中的輪次（歷史列、mod 載入前）
// 就不動，回傳原本的表。
export const addRow = (turns: Turn[], uuid: string, type: string, content: readonly Block[], at: number): Turn[] => {
  const current = turns.at(-1)
  if (current === undefined || current.durationMs !== null) {
    return turns
  }
  let rows = current.rows
  const added: Row[] = []
  let running = current.running ?? []
  let recent = current.recent
  if (type === 'assistant') {
    // 有內容的思考會畫成一段帶圓點的文字；空的（不給看的）不會畫，不記。
    const thinking = content.filter(b => b.type === 'thinking' && typeof b.thinking === 'string').map(b => b.thinking as string).join('')
    const thought = textKey(thinking)
    if (thought !== null) {
      added.push({ kind: 'thought', id: uuid, key: thought, at })
    }
    const texts = content.filter(b => b.type === 'text' && typeof b.text === 'string').map(b => b.text as string)
    if (texts.length > 0) {
      added.push({ kind: 'text', id: uuid, key: textKey(texts.join('')), at })
    }
    // 文字留在對話裡，結束了這一段過程；下一段的動作從頭記。
    recent = texts.length > 0 ? undefined : (firstSentence(thinking) ?? recent)
    const calls = content.filter(b => b.type === 'tool_use' && typeof b.id === 'string')
    if (calls.length > 0) {
      const ids = calls.map(b => b.id as string)
      added.push(
        calls.every(b => b.name === 'Agent')
          ? { kind: 'tools', ids, agents: true, at }
          : calls.every(b => ASKS.includes(String(b.name)))
            ? { kind: 'tools', ids, ask: true, at }
            : { kind: 'tools', ids, at },
      )
      const steps = calls.map(b => ({ id: b.id as string, label: describe(String(b.name), (b.input ?? {}) as Record<string, unknown>) }))
      running = [...running, ...steps]
      recent = steps[steps.length - 1].label
    }
  } else if (type === 'user') {
    const results = content.filter(b => b.type === 'tool_result')
    const failed = results.filter(b => b.is_error === true).map(b => b.tool_use_id)
    if (failed.length > 0) {
      rows = rows.map(r =>
        r.kind === 'tools' && r.ids.some(id => failed.includes(id))
          ? { ...r, errors: (r.errors ?? 0) + r.ids.filter(id => failed.includes(id)).length }
          : r,
      )
    }
    running = running.filter(step => !results.some(b => b.tool_use_id === step.id))
  }
  if (added.length === 0 && rows === current.rows && running === (current.running ?? []) && recent === current.recent) {
    return turns
  }
  return [...turns.slice(0, -1), { ...current, rows: [...rows, ...added], running, recent }]
}

// 問你問題的工具：它是對話，不是過程。
const ASKS = ['AskUserQuestion', 'ExitPlanMode']

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
  if (ASKS.includes(name)) {
    return '等你回答'
  }
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
export const addNote = (turns: Turn[], uuid: string, at: number): Turn[] => {
  const current = turns.at(-1)
  if (current === undefined || current.durationMs !== null) {
    return turns
  }
  return [...turns.slice(0, -1), { ...current, rows: [...current.rows, { kind: 'note', id: uuid, at }] }]
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

// 一段過程：連在一起的工具呼叫、思考與送進來的訊息。模型寫的文字與問你問題的工具不算，它們把過程切成好幾段。
const isWork = (row: Row) => row.kind === 'note' || row.kind === 'thought' || (row.kind === 'tools' && row.ask !== true)

// 一段過程以它第一列的 id 記：展開哪幾段、標頭按鈕的 key 都用它。
export const groupOf = (row: Row) => (row.kind === 'tools' ? row.ids[0]! : row.id)

const idsOf = (row: Row) =>
  row.kind === 'tools' ? row.ids : row.kind === 'note' ? [row.id] : [row.id, row.key ?? null].filter(id => id !== null)

// 一段過程的標頭：做完的「處理了 1 分 23 秒 · 1 個錯誤」，還在進行的「處理中 12 秒 · 執行：…」。時間從前一段文字
// （第一段從這一輪開始）算到後一段文字（最後一段算到這一輪結束或現在）。舊版記下的列沒有時間，只有一段時用
// 這一輪的時間，否則不寫時間。
const labelOf = (turn: Turn, start: number, end: number, count: number, now?: number) => {
  const { rows } = turn
  const isLast = end === rows.length - 1
  const from = start === 0 ? turn.startedAt : rows[start - 1]!.at
  const until = !isLast
    ? rows[end + 1]!.at
    : turn.durationMs === null
      ? now
      : turn.startedAt === undefined
        ? undefined
        : turn.startedAt + turn.durationMs
  const ms = from !== undefined && until !== undefined ? until - from : count === 1 && turn.durationMs !== null ? turn.durationMs : undefined
  const time = ms === undefined ? '' : ` ${duration(ms)}`
  if (turn.durationMs === null && isLast) {
    const action = doing(turn)
    return action === undefined ? `處理中${time === '' ? '…' : time}` : `處理中${time} · ${action}`
  }
  const errors = rows.slice(start, end + 1).reduce((n, r) => n + (r.kind === 'tools' ? (r.errors ?? 0) : 0), 0)
  return `處理了${time}${errors > 0 ? ` · ${errors} 個錯誤` : ''}`
}

// 一輪裡每一列該怎麼畫，以列 id（文字與思考列的 uuid 與指紋、工具呼叫的 tool_use id、訊息列的 uuid）查。
// 模型寫的文字都留在對話裡；夾在文字之間的每一段過程收成一行「› 處理了 …」，各段各自展開。收起來時標頭畫在這段
// 的第一個工具列（沒有工具就是第一段思考）：工具列一定畫得出來。展開時標頭移到這段的第一列，展開的內容才會都在
// 標頭下面。一段裡沒有列畫得出標頭時（例如只有一起開的 subagent），標頭畫在緊接著的文字上面；後面也沒有文字就
// 照原樣，免得過程藏起來卻點不開。expanded 是展開中的段，now 是現在的時間。
export const views = (turn: Turn, expanded: readonly string[], now?: number): Record<string, View> => {
  const { rows } = turn
  const spans: { start: number; end: number }[] = []
  rows.forEach((row, index) => {
    if (isWork(row)) {
      const last = spans.at(-1)
      if (last !== undefined && last.end === index - 1) {
        last.end = index
      } else {
        spans.push({ start: index, end: index })
      }
    }
  })
  // 同一則回覆開好幾個 subagent 時，引擎把這些呼叫畫成自己的一列「N background agents launched」，mod 畫不到；
  // 訊息列也不一定收合（只收 subagent 與背景工作的）。這兩種列不放標頭。
  const isAgents = (row: Row | undefined) => row?.kind === 'tools' && row.agents === true
  const isGrouped = (index: number) => {
    const row = rows[index]!
    return row.kind === 'tools' && row.agents === true && (row.ids.length > 1 || isAgents(rows[index - 1]) || isAgents(rows[index + 1]))
  }
  const shown: View[] = rows.map(() => ({ kind: 'answer' }))
  for (const { start, end } of spans) {
    const group = groupOf(rows[start]!)
    const isOpen = expanded.includes(group)
    const header: Header = { group, label: labelOf(turn, start, end, spans.length, now), isOpen }
    const members = rows.slice(start, end + 1).map((_, k) => start + k)
    const hosts = members.filter(i => rows[i]!.kind !== 'note' && !isGrouped(i))
    const host = isOpen ? hosts[0] : (hosts.find(i => rows[i]!.kind === 'tools') ?? hosts[0])
    const after = rows[end + 1]
    if (host === undefined && after?.kind !== 'text') {
      continue
    }
    for (const i of members) {
      shown[i] = i === host ? { kind: 'header', ...header } : { kind: 'work', group, isOpen }
    }
    if (host === undefined) {
      shown[end + 1] = { kind: 'answer', header }
    }
  }
  // 依列的順序寫：同一則回覆的思考與文字共用 uuid，後面的文字蓋過前面的思考。
  const out: Record<string, View> = {}
  rows.forEach((row, index) => {
    for (const id of idsOf(row)) {
      out[id] = shown[index]!
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
