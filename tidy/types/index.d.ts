// 一輪裡依序出現的列：模型寫的一段文字、畫在畫面上的思考內容（列 id 與內文指紋）、一次工具呼叫（tool_use id），
// 或一輪進行中送進來的訊息（subagent 的回報、背景工作完成的通知；列 id）。
// key 是 null：記下時還沒有內文。舊版記下的列沒有 key。agents：這次呼叫的工具全是 Agent。
export type Row =
  | { kind: 'text'; id: string; key?: string | null }
  | { kind: 'thought'; id: string; key: string }
  | { kind: 'tools'; ids: string[]; agents?: true }
  | { kind: 'note'; id: string }

// 一個正在跑的工具呼叫，與它在標頭上的說明（「讀取 register.tsx」）。
export type Step = { id: string; label: string }

export type Turn = {
  // turn.start 給的 id。
  id: string
  rows: Row[]
  // 這一輪花的時間；還在進行是 null。
  durationMs: number | null
  // 出錯的工具呼叫數。
  errors: number
  // 正在跑的工具呼叫，與最近一個動作（最近開始的工具，或模型最近一段說明或思考的第一句，看哪個晚）；
  // 「處理中」標頭顯示它們。舊版記下的輪次沒有。
  running?: Step[]
  recent?: string
}

// 「處理了 …」標頭：哪一輪、標籤、是否展開。
export type Header = { turn: string; label: string; isOpen: boolean }

// 一列的畫法：輪次第一個工具列的「處理了 …」標頭、收起來的過程列，或回答（照原樣畫）。
// 沒有過程列畫得出標頭時，標頭畫在第一段回答上面（header）。
export type View =
  | ({ kind: 'header' } & Header)
  | { kind: 'work'; isOpen: boolean }
  | { kind: 'answer'; header?: Header }

// subagent 的類型、任務說明，與完成通知帶來的狀態和花費時間（還沒收到是 null）。
export type Agent = { type: string; description: string; status: string | null; durationMs: number | null }

declare module 'claude-code' {
  interface PluginState {
    // view 每列一份，各列只讀自己那份：新增一列時只有變了的列重畫。null 是不在輪次表裡的列。
    // sender（送來回報的 subagent id）以回報列的 id、agent 以 subagent 的 id 各一份。
    tidy: {
      turns: Turn[]
      expanded: string[]
      view: StateFamily<View | null>
      sender: StateFamily<string | null>
      agent: StateFamily<Agent | null>
    }
  }
}
