export type Tab =
  | 'overview'
  | 'tarefas'
  | 'tokens'
  | 'log'
  | 'arquivos'
  | 'notas'
  | 'ajustes'

export type Accent = 'nardo' | 'grafite' | 'prata' | 'cimento'

export type Task = { id: number; text: string; isDone: boolean }

export type LogStatus = 'run' | 'ok' | 'fail' | 'deny'

export type LogRow = { id: string; tool: string; label: string; status: LogStatus }

export type FileRow = { path: string; edits: number }

export type Limit = { kind: string; percentUsed: number; resetsAt: string | null }

export type Usage = {
  contextTokens: number | null
  window: number
  percent: number | null
  usd: number | null
  limits: Limit[]
  turns: number
  input: number
  output: number
  cacheRead: number
  model: string
}

declare module 'claude-code' {
  interface PluginState {
    'painel-lateral': {
      tab: Tab
      tasks: Task[]
      notes: string[]
      log: LogRow[]
      files: FileRow[]
      usage: Usage | null
      isOpen: boolean
      accent: Accent
      width: number
      showOpenButton: boolean
      theme: string
    }
  }
}
