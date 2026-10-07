// 一輪裡依序出現的列：模型寫的一段文字、畫在畫面上的思考內容（列 id 與內文指紋），或一次工具呼叫（tool_use id）。
// key 是 null：記下時還沒有內文。舊版記下的列沒有 key。
export type Row =
  | { kind: 'text'; id: string; key?: string | null }
  | { kind: 'thought'; id: string; key: string }
  | { kind: 'tools'; ids: string[] }

export type Turn = {
  // turn.start 給的 id。
  id: string
  rows: Row[]
  // 這一輪花的時間；還在進行是 null。
  durationMs: number | null
  // 出錯的工具呼叫數。
  errors: number
}

// 一列的畫法：輪次第一個工具列的「處理了 …」標頭、收起來的過程列，或回答（照原樣畫）。
export type View =
  | { kind: 'header'; turn: string; label: string; isOpen: boolean }
  | { kind: 'work'; isOpen: boolean }
  | { kind: 'answer' }

declare module 'claude-code' {
  interface PluginState {
    // view 每列一份，各列只讀自己那份：新增一列時只有變了的列重畫。null 是不在輪次表裡的列。
    tidy: { turns: Turn[]; expanded: string[]; view: StateFamily<View | null> }
  }
}
