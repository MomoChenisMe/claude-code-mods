export type RateLimit = { kind: string; percentUsed: number; resetsAt?: string }

export type Usage = {
  model: string
  effort: string | null
  contextPercent: number | null
  rateLimits: RateLimit[]
  // Fable 的週用量，讀自 `claude -p /usage`；帳號沒有這一列時是 null。
  fable: RateLimit | null
}

declare module 'claude-code' {
  interface PluginState {
    statusbar: { usage: Usage }
  }
}
