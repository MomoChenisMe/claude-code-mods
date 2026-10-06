export type RateLimit = { kind: string; percentUsed: number; resetsAt?: string }

export type Usage = {
  model: string
  effort: string | null
  contextPercent: number | null
  rateLimits: RateLimit[]
}

declare module 'claude-code' {
  interface PluginState {
    statusbar: { usage: Usage }
  }
}
