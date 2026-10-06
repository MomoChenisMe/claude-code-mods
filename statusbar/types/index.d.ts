export type RateLimit = { kind: string; percentUsed: number; resetsAt?: string }

export type Usage = {
  model: string
  effort: string | null
  contextPercent: number | null
  rateLimits: RateLimit[]
  // Fable 的週用量，讀自 `claude -p /usage`；帳號沒有這一列時是 null。
  fable: RateLimit | null
}

// 按了一次、等第二次按下確認的鈕，與第一次按下的時間。
export type Armed = { command: 'compact' | 'clear'; at: number }

declare module 'claude-code' {
  interface PluginState {
    statusbar: { usage: Usage; armed: Armed | null }
  }
}
