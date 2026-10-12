import { atom, read, update } from 'claude-code'
import type { Hook, Register } from 'claude-code'

import type { Accent, FileRow, Limit, LogRow, LogStatus, Tab, Task } from '../types'

type Dollar = Parameters<Hook<'session.start'>>[0]

const PANE = 'painel-lateral'
const MAX_LOG = 100
const WRITERS = ['Edit', 'Write', 'MultiEdit', 'NotebookEdit']
const NARDO_THEME = 'custom:nardo-grey'

const TABS: readonly { id: Tab; label: string }[] = [
  { id: 'overview', label: '◉ Overview' },
  { id: 'tarefas', label: '✔ Tarefas' },
  { id: 'tokens', label: '◈ Tokens' },
  { id: 'log', label: '≡ Log' },
  { id: 'arquivos', label: '▤ Arquivos' },
  { id: 'notas', label: '✎ Notas' },
  { id: 'ajustes', label: '⚙ Ajustes' },
]

// Cinzentos do painel. "nardo" é o Nardo Grey (o cinzento flat da Audi).
const PALETTES: Record<Accent, { label: string; main: string; light: string }> = {
  nardo: { label: 'Nardo', main: '#787a7b', light: '#b4b6b7' },
  grafite: { label: 'Grafite', main: '#5b5f63', light: '#9a9ea2' },
  prata: { label: 'Prata', main: '#9ea2a6', light: '#d0d3d6' },
  cimento: { label: 'Cimento', main: '#8a8780', light: '#bdbab2' },
}

const ACCENTS = Object.keys(PALETTES) as Accent[]

const INK = '#dcdedf'
const OK = '#9db89f'
const MID = '#c9b887'
const BAD = '#cf8f8f'

const THEMES: readonly { id: string; label: string; words: string[] }[] = [
  { id: NARDO_THEME, label: 'Nardo Grey', words: ['nardo', 'cinza', 'cinzento', 'grey', 'gray'] },
  { id: 'dark', label: 'Escuro', words: ['escuro', 'dark'] },
  { id: 'light', label: 'Claro', words: ['claro', 'light'] },
  { id: 'auto', label: 'Auto', words: ['auto'] },
]

const WIDTHS: readonly { columns: number; label: string }[] = [
  { columns: 44, label: 'Estreito' },
  { columns: 52, label: 'Normal' },
  { columns: 64, label: 'Largo' },
]

const HELP = [
  '/painel                  abre o painel',
  '/painel tarefa <texto>   adiciona uma tarefa',
  '/painel feito <n>        marca ou desmarca a tarefa n',
  '/painel remover <n>      remove a tarefa n',
  '/painel limpar           remove as tarefas feitas',
  '/painel nota <texto>     adiciona uma nota',
  '/painel aba <nome>       overview, tarefas, tokens, log, arquivos, notas ou ajustes',
  '/tema                    mostra o tema atual',
  '/tema nardo|escuro|claro|auto   muda o tema do Claude',
  '/tema cor nardo|grafite|prata|cimento   muda a cor do painel',
].join('\n')

const tab = atom({ plugin: 'painel-lateral', key: 'tab' } as const, 'overview')
const tasks = atom({ plugin: 'painel-lateral', key: 'tasks' } as const, [])
const notes = atom({ plugin: 'painel-lateral', key: 'notes' } as const, [])
const log = atom({ plugin: 'painel-lateral', key: 'log' } as const, [])
const files = atom({ plugin: 'painel-lateral', key: 'files' } as const, [])
const usage = atom({ plugin: 'painel-lateral', key: 'usage' } as const, null)
const isOpen = atom({ plugin: 'painel-lateral', key: 'isOpen' } as const, false)
const accent = atom({ plugin: 'painel-lateral', key: 'accent' } as const, 'nardo')
const width = atom({ plugin: 'painel-lateral', key: 'width' } as const, 52)
const showOpenButton = atom({ plugin: 'painel-lateral', key: 'showOpenButton' } as const, true)
const theme = atom({ plugin: 'painel-lateral', key: 'theme' } as const, '')

const openPane = (columns: number): { id: string; title: string; columns: number } => ({
  id: PANE,
  title: 'Painel',
  columns,
})

const togglePane = async ($: Dollar): Promise<void> => {
  const isUp = (await $.ui.panes()).some(one => one.id === PANE)

  if (isUp) {
    await $.ui.close({ id: PANE })
  } else {
    await $.ui.open(openPane(await read($, width)))
  }
  await update($, isOpen, () => !isUp)
}

const clip = (text: string, max: number): string =>
  text.length > max ? `${text.slice(0, max - 1)}…` : text

const clipStart = (text: string, max: number): string =>
  text.length > max ? `…${text.slice(text.length - max + 1)}` : text

const count = (n: number): string =>
  n >= 1000000
    ? `${(n / 1000000).toFixed(1)}M`
    : n >= 1000
      ? `${(n / 1000).toFixed(1)}k`
      : String(n)

const money = (usd: number): string =>
  usd < 0.01 ? `$${usd.toFixed(4)}` : `$${usd.toFixed(2)}`

const tone = (percent: number): string =>
  percent >= 85 ? BAD : percent >= 60 ? MID : OK

const resetIn = (iso: string | null): string => {
  if (iso === null) {
    return ''
  }

  const ms = Date.parse(iso) - Date.now()

  if (Number.isNaN(ms) || ms <= 0) {
    return 'reinicia agora'
  }

  const mins = Math.round(ms / 60000)
  const days = Math.floor(mins / 1440)
  const hours = Math.floor((mins % 1440) / 60)
  const rest = mins % 60

  return days > 0
    ? `reinicia em ${days}d ${hours}h`
    : hours > 0
      ? `reinicia em ${hours}h ${rest}m`
      : `reinicia em ${rest}m`
}

const findLimit = (list: Limit[], kind: string): Limit | undefined =>
  list.find(one => one.kind === kind)

const describe = (input: Record<string, unknown>): string => {
  const pick =
    input.command ??
    input.file_path ??
    input.notebook_path ??
    input.pattern ??
    input.url ??
    input.query ??
    input.description ??
    ''

  return clip(String(pick).replace(/\s+/g, ' '), 60)
}

const glyph = (status: LogStatus): string =>
  status === 'run' ? '…' : status === 'ok' ? '✓' : status === 'fail' ? '✗' : '⊘'

const glyphColor = (status: LogStatus): string =>
  status === 'ok' ? OK : status === 'run' ? MID : BAD

const nextId = (list: Task[]): number =>
  list.reduce((max, one) => Math.max(max, one.id), 0) + 1

const persist = async ($: Dollar): Promise<void> => {
  await $.store.set('tasks', await read($, tasks))
  await $.store.set('notes', await read($, notes))
}

const persistSettings = async ($: Dollar): Promise<void> => {
  await $.store.set('settings', {
    accent: await read($, accent),
    width: await read($, width),
    showOpenButton: await read($, showOpenButton),
  })
}

const addTask = async ($: Dollar, text: string): Promise<void> => {
  const clean = text.trim()

  if (clean === '') {
    return
  }

  await update($, tasks, list => [
    ...list,
    { id: nextId(list), text: clean, isDone: false },
  ])
  await persist($)
}

const toggleTask = async ($: Dollar, id: number): Promise<void> => {
  await update($, tasks, list =>
    list.map(one => (one.id === id ? { ...one, isDone: !one.isDone } : one)),
  )
  await persist($)
}

const removeTask = async ($: Dollar, id: number): Promise<void> => {
  await update($, tasks, list => list.filter(one => one.id !== id))
  await persist($)
}

const clearDone = async ($: Dollar): Promise<void> => {
  await update($, tasks, list => list.filter(one => !one.isDone))
  await persist($)
}

const addNote = async ($: Dollar, text: string): Promise<void> => {
  const clean = text.trim()

  if (clean === '') {
    return
  }

  await update($, notes, list => [...list, clean])
  await persist($)
}

const removeNote = async ($: Dollar, index: number): Promise<void> => {
  await update($, notes, list => list.filter((_, at) => at !== index))
  await persist($)
}

type Turn = { input: number; output: number; cacheRead: number; model: string }

const refreshUsage = async ($: Dollar, turn?: Turn): Promise<void> => {
  const snap = await $.session.usage()

  await update($, usage, old => ({
    contextTokens: snap.context.tokens ?? null,
    window: snap.context.window,
    percent: snap.context.percent ?? null,
    usd: snap.cost?.usd ?? null,
    limits: snap.rateLimits.map(one => ({
      kind: one.kind,
      percentUsed: one.percentUsed,
      resetsAt: one.resetsAt ?? null,
    })),
    turns: (old?.turns ?? 0) + (turn === undefined ? 0 : 1),
    input: (old?.input ?? 0) + (turn?.input ?? 0),
    output: (old?.output ?? 0) + (turn?.output ?? 0),
    cacheRead: (old?.cacheRead ?? 0) + (turn?.cacheRead ?? 0),
    model: turn?.model ?? old?.model ?? '',
  }))
}

// ---- tema do Claude ----------------------------------------------------

const refreshTheme = async ($: Dollar): Promise<void> => {
  try {
    const row = (await $.config.list()).find(one => one.key === 'theme')

    if (row !== undefined) {
      await update($, theme, () => String(row.value))
    }
  } catch {
    // sem leitura do tema: o painel mostra "—"
  }
}

const themeLabel = (id: string): string =>
  THEMES.find(one => one.id === id)?.label ?? (id === '' ? '—' : id)

const setTheme = async ($: Dollar, id: string): Promise<string> => {
  try {
    const result = await $.config.set({ key: 'theme', value: id })

    if (result.deny !== undefined) {
      return `Tema não mudou: ${result.deny}`
    }
  } catch (error) {
    return `Tema não mudou: ${error instanceof Error ? error.message : String(error)}`
  }
  await update($, theme, () => id)
  await refreshTheme($)

  return `Tema: ${themeLabel(id)}`
}

const setAccent = async ($: Dollar, id: Accent): Promise<void> => {
  await update($, accent, () => id)
  await persistSettings($)
}

const setWidth = async ($: Dollar, columns: number): Promise<void> => {
  await update($, width, () => columns)
  await persistSettings($)

  if ((await $.ui.panes()).some(one => one.id === PANE)) {
    await $.ui.close({ id: PANE })
    await $.ui.open(openPane(columns))
  }
}

const toggleOpenButton = async ($: Dollar): Promise<void> => {
  await update($, showOpenButton, on => !on)
  await persistSettings($)
}

const isTab = (word: string): word is Tab =>
  TABS.some(one => one.id === word)

const isAccent = (word: string): word is Accent => word in PALETTES

const runTheme = async ($: Dollar, args: string): Promise<string> => {
  const [word = '', ...rest] = args.trim().toLowerCase().split(/\s+/)

  if (word === '') {
    await refreshTheme($)

    return `Tema atual: ${themeLabel(await read($, theme))} · cor do painel: ${PALETTES[await read($, accent)].label}\n${HELP.split('\n').filter(line => line.startsWith('/tema')).join('\n')}`
  }
  if (word === 'cor') {
    const name = rest[0] ?? ''

    if (!isAccent(name)) {
      return `Cores do painel: ${ACCENTS.join(', ')}`
    }
    await setAccent($, name)

    return `Cor do painel: ${PALETTES[name].label}`
  }

  const found = THEMES.find(one => one.words.includes(word) || one.id === word)

  if (found === undefined) {
    return `Não conheço o tema "${word}". Use: ${THEMES.map(one => one.words[0]).join(', ')}`
  }

  return setTheme($, found.id)
}

const runCommand = async ($: Dollar, args: string): Promise<string> => {
  const [word = '', ...rest] = args.trim().split(/\s+/)
  const text = rest.join(' ')
  const at = Number(rest[0]) - 1
  const list = await read($, tasks)
  const target = list[at]

  switch (word.toLowerCase()) {
    case '':
    case 'abrir':
      return 'Painel aberto.'
    case 'tarefa':
    case 't':
      await addTask($, text)

      return text === '' ? 'Escreva a tarefa depois de "tarefa".' : `Tarefa adicionada: ${text}`
    case 'feito':
    case 'f':
      if (target === undefined) {
        return `Não existe a tarefa ${rest[0] ?? ''}.`
      }
      await toggleTask($, target.id)

      return `${target.isDone ? 'Reaberta' : 'Feita'}: ${target.text}`
    case 'remover':
    case 'rm':
      if (target === undefined) {
        return `Não existe a tarefa ${rest[0] ?? ''}.`
      }
      await removeTask($, target.id)

      return `Removida: ${target.text}`
    case 'limpar':
      await clearDone($)

      return 'Tarefas feitas removidas.'
    case 'nota':
    case 'n':
      await addNote($, text)

      return text === '' ? 'Escreva a nota depois de "nota".' : 'Nota adicionada.'
    case 'aba': {
      const name = (rest[0] ?? '').toLowerCase()

      if (!isTab(name)) {
        return `Abas: ${TABS.map(one => one.id).join(', ')}`
      }
      await update($, tab, () => name)

      return `Aba: ${name}`
    }
    default:
      return HELP
  }
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'painel',
      description: 'Painel lateral: overview, tarefas, tokens, log, arquivos, notas e ajustes',
    })
    await $.command.register({
      name: 'tema',
      description: 'Muda o tema do Claude (nardo, escuro, claro, auto) e a cor do painel',
    })

    const savedTasks = await $.store.get('tasks')
    const savedNotes = await $.store.get('notes')
    const saved = (await $.store.get('settings')) as
      | { accent?: string; width?: number; showOpenButton?: boolean }
      | undefined

    if (Array.isArray(savedTasks)) {
      await update($, tasks, () => savedTasks as Task[])
    }
    if (Array.isArray(savedNotes)) {
      await update($, notes, () => savedNotes as string[])
    }
    if (saved !== undefined && saved !== null) {
      if (typeof saved.accent === 'string' && isAccent(saved.accent)) {
        const chosen: Accent = saved.accent

        await update($, accent, () => chosen)
      }
      if (typeof saved.width === 'number') {
        const columns = saved.width

        await update($, width, () => columns)
      }
      if (typeof saved.showOpenButton === 'boolean') {
        const shown = saved.showOpenButton

        await update($, showOpenButton, () => shown)
      }
    }
    await refreshUsage($)
    await refreshTheme($)

    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    await refreshUsage($)

    return next(e)
  })

  on('command.run', { command: 'painel' }, async ($, e) => {
    await $.ui.open(openPane(await read($, width)))
    await update($, isOpen, () => true)

    return { text: await runCommand($, e.args) }
  })

  on('command.run', { command: 'tema' }, async ($, e) => ({
    text: await runTheme($, e.args),
  }))

  on('ui.close', { id: PANE }, async ($, e, next) => {
    const closed = await next(e)
    await update($, isOpen, () => false)

    return closed
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey) {
      return next(e)
    }

    const { Box, Button } = $.ui.resolve(e)
    const [panes, wantsButton] = await Promise.all([
      $.ui.panes(),
      read($, showOpenButton),
      read($, isOpen),
    ])

    // Painel aberto (ou botão desligado nos Ajustes): sem faixa nenhuma.
    // Aberto, fecha-se pelo ✕ no cabeçalho do painel.
    if (!wantsButton || panes.some(one => one.id === PANE)) {
      return next(e)
    }

    return (
      <Box flexDirection="row">
        <Button
          key="painel-toggle"
          label="Abrir painel"
          variant="primary"
          onPress={() => togglePane($)}
        />
      </Box>
    )
  })

  on('tool.call', async ($, e, next) => {
    const input = e as unknown as Record<string, unknown>
    const row: LogRow = {
      id: e.tool_use_id,
      tool: e.tool,
      label: describe(input),
      status: 'run',
    }

    await update($, log, list => [...list, row].slice(-MAX_LOG))

    const ran = await next(e)
    const status: LogStatus =
      ran.deny !== undefined ? 'deny' : ran.isError === true ? 'fail' : 'ok'

    await update($, log, list =>
      list.map(one => (one.id === row.id ? { ...one, status } : one)),
    )

    const path = input.file_path ?? input.notebook_path

    if (status === 'ok' && WRITERS.includes(e.tool) && typeof path === 'string') {
      await update($, files, list => {
        const old = list.find(one => one.path === path)
        const entry: FileRow = { path, edits: (old?.edits ?? 0) + 1 }

        return [...list.filter(one => one.path !== path), entry]
      })
    }
    await refreshUsage($)

    return ran
  })

  on('turn.complete', async ($, e, next) => {
    const isMain = e.agentId === undefined

    await refreshUsage(
      $,
      isMain && e.usage !== undefined
        ? {
            input: e.usage.input_tokens,
            output: e.usage.output_tokens,
            cacheRead: e.usage.cache_read_input_tokens,
            model: e.usage.model,
          }
        : undefined,
    )

    return next(e)
  })

  on('ui.render', { component: 'Pane', requestId: PANE }, async ($, e) => {
    const els = $.ui.resolve(e)
    const { Box, Text, Button } = els
    const Input = 'Input' in els ? els.Input : undefined
    const current = await read($, tab)
    const room = Math.max(4, (e.viewport?.rows ?? 24) - 12)
    const cols = e.props.bodyColumns ?? 52
    const inner = Math.max(20, cols - 4)

    const [u, taskList, noteList, logList, fileList, accentId, themeNow, openBtn] =
      await Promise.all([
        read($, usage),
        read($, tasks),
        read($, notes),
        read($, log),
        read($, files),
        read($, accent),
        read($, theme),
        read($, showOpenButton),
      ])

    const P = PALETTES[accentId]
    const columnsNow = await read($, width)

    const session = findLimit(u?.limits ?? [], 'five_hour')
    const week = findLimit(u?.limits ?? [], 'seven_day')
    const ctxPct = u?.percent ?? 0

    // ---- building blocks ----------------------------------------------

    const bar = (percent: number, color: string, size: number) => {
      const full = Math.min(size, Math.max(0, Math.round((percent / 100) * size)))

      return (
        <Text>
          <Text color={color}>{'█'.repeat(full)}</Text>
          <Text dimColor>{'░'.repeat(size - full)}</Text>
        </Text>
      )
    }

    const rule = () => <Text dimColor>{'─'.repeat(cols)}</Text>

    const label = (text: string) => (
      <Text bold color={P.light}>
        {text.toUpperCase()}
      </Text>
    )

    const go = (to: Tab) => (
      <Button
        key={`go-${to}`}
        label="ver →"
        dimColor
        onPress={() => update($, tab, () => to)}
      />
    )

    const card = (
      title: string,
      right: string | undefined,
      children: unknown,
      to?: Tab,
      color: string = P.main,
    ) => (
      <Box
        flexDirection="column"
        borderStyle="round"
        borderColor={color}
        paddingX={1}
      >
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color={P.light}>
            {title}
          </Text>
          <Box flexDirection="row" gap={1}>
            {right !== undefined && <Text dimColor>{right}</Text>}
            {to !== undefined && go(to)}
          </Box>
        </Box>
        {children}
      </Box>
    )

    const empty = (icon: string, text: string) => (
      <Box flexDirection="column" alignItems="center" paddingY={1}>
        <Text dimColor>{icon}</Text>
        <Text dimColor>{text}</Text>
      </Box>
    )

    const limitRow = (title: string, one: Limit | undefined) => {
      const pct = one?.percentUsed ?? 0
      const color = one === undefined ? P.main : tone(pct)

      return (
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Text bold color={INK}>
              {title}
            </Text>
            <Text bold color={color}>
              {one === undefined ? '—' : `${pct}%`}
            </Text>
          </Box>
          {bar(pct, color, inner - 2)}
          <Text dimColor>
            {one === undefined ? 'sem leitura ainda' : resetIn(one.resetsAt)}
          </Text>
        </Box>
      )
    }

    // linha curta do overview: nome, % e barra numa linha só
    const miniRow = (title: string, pct: number | undefined, note: string) => {
      const color = pct === undefined ? P.main : tone(pct)

      return (
        <Box flexDirection="column">
          <Box flexDirection="row" justifyContent="space-between">
            <Text>
              <Text bold color={INK}>
                {title}
              </Text>
              {note === '' ? '' : <Text dimColor> · {note}</Text>}
            </Text>
            <Text bold color={color}>
              {pct === undefined ? '—' : `${pct}%`}
            </Text>
          </Box>
          {bar(pct ?? 0, color, inner - 2)}
        </Box>
      )
    }

    const stat = (name: string, value: string, color: string) => (
      <Box flexDirection="column" flexGrow={1}>
        <Text dimColor>{name}</Text>
        <Text bold color={color}>
          {value}
        </Text>
      </Box>
    )

    const chip = (name: string, pct: number | undefined) => (
      <Text>
        <Text dimColor>{name} </Text>
        <Text bold color={pct === undefined ? P.main : tone(pct)}>
          {pct === undefined ? '—' : `${pct}%`}
        </Text>
      </Text>
    )

    const logLine = (one: LogRow, max: number) => (
      <Text>
        <Text bold color={glyphColor(one.status)}>
          {glyph(one.status)}
        </Text>{' '}
        <Text bold color={INK}>
          {one.tool}
        </Text>{' '}
        <Text dimColor>{clip(one.label, Math.max(8, max - one.tool.length - 4))}</Text>
      </Text>
    )

    const fileLine = (one: FileRow, max: number) => {
      const cut = Math.max(one.path.lastIndexOf('/'), one.path.lastIndexOf('\\'))
      const name = one.path.slice(cut + 1)
      const dir = one.path.slice(0, cut + 1)

      return (
        <Box flexDirection="row" justifyContent="space-between">
          <Text>
            <Text dimColor>{clipStart(dir, Math.max(4, max - name.length - 8))}</Text>
            <Text bold color={INK}>
              {name}
            </Text>
          </Text>
          <Text color={P.light}>×{one.edits}</Text>
        </Box>
      )
    }

    const choice = (key: string, text: string, isOn: boolean, press: () => unknown) => (
      <Button
        key={key}
        label={text}
        variant={isOn ? 'primary' : 'secondary'}
        onPress={() => press()}
      />
    )

    // ---- header: title, live summary, tabs ----------------------------

    const openTasks = taskList.filter(one => !one.isDone).length
    const badge: Record<Tab, number> = {
      overview: 0,
      tarefas: openTasks,
      tokens: 0,
      log: logList.length,
      arquivos: fileList.length,
      notas: noteList.length,
      ajustes: 0,
    }

    const header = (
      <Box flexDirection="column" gap={1}>
        <Box flexDirection="row" justifyContent="space-between">
          <Text bold color={P.light}>
            ◆ PAINEL
          </Text>
          <Box flexDirection="row" gap={1}>
            <Text bold color={INK}>
              {u === null || u.usd === null ? '' : money(u.usd)}
            </Text>
            <Button key="painel-close" label="✕" onPress={() => togglePane($)} />
          </Box>
        </Box>
        <Box flexDirection="row" justifyContent="space-between">
          {chip('Sessão', session?.percentUsed)}
          {chip('Semana', week?.percentUsed)}
          {chip('Ctx', u === null ? undefined : ctxPct)}
        </Box>
        <Box flexDirection="row" flexWrap="wrap" gap={1}>
          {TABS.map(one => (
            <Button
              key={`tab-${one.id}`}
              label={badge[one.id] > 0 ? `${one.label} ${badge[one.id]}` : one.label}
              variant={one.id === current ? 'primary' : 'secondary'}
              onPress={() => update($, tab, () => one.id)}
            />
          ))}
        </Box>
        {rule()}
      </Box>
    )

    // ---- tabs ---------------------------------------------------------

    let body = <Text dimColor>…</Text>

    if (current === 'overview') {
      const done = taskList.length - openTasks
      const pct = taskList.length === 0 ? 0 : Math.round((done / taskList.length) * 100)
      const pending = taskList.filter(one => !one.isDone)
      const recentLog = [...logList].slice(-4).reverse()
      const recentFiles = [...fileList].reverse().slice(0, 4)
      const recentNotes = [...noteList].slice(-3).reverse()

      body = (
        <Box flexDirection="column" gap={1}>
          {card(
            'Tokens',
            u === null || u.usd === null ? undefined : money(u.usd),
            <Box flexDirection="column" gap={1}>
              {miniRow('Sessão', session?.percentUsed, resetIn(session?.resetsAt ?? null))}
              {miniRow('Semana', week?.percentUsed, resetIn(week?.resetsAt ?? null))}
              {miniRow(
                'Contexto',
                u === null ? undefined : ctxPct,
                u === null ? '' : `${count(u.contextTokens ?? 0)} / ${count(u.window)}`,
              )}
            </Box>,
            'tokens',
          )}
          {card(
            'Tarefas',
            `${done}/${taskList.length} feitas`,
            <Box flexDirection="column">
              {bar(pct, OK, inner - 2)}
              {pending.length === 0 && (
                <Text dimColor>
                  {taskList.length === 0 ? 'Nenhuma tarefa ainda.' : 'Tudo feito ✓'}
                </Text>
              )}
              {pending.slice(0, 4).map(one => (
                <Box flexDirection="row" gap={1}>
                  <Button
                    key={`ov-toggle-${one.id}`}
                    label="[ ]"
                    onPress={() => toggleTask($, one.id)}
                  />
                  <Text color={INK}>{clip(one.text, inner - 10)}</Text>
                </Box>
              ))}
              {pending.length > 4 && <Text dimColor>+{pending.length - 4} a fazer</Text>}
            </Box>,
            'tarefas',
          )}
          {card(
            'Log',
            `${logList.length} chamadas`,
            <Box flexDirection="column">
              {recentLog.length === 0 && <Text dimColor>Nada rodou ainda.</Text>}
              {recentLog.map(one => logLine(one, inner - 2))}
            </Box>,
            'log',
          )}
          {card(
            'Arquivos',
            `${fileList.length} alterados`,
            <Box flexDirection="column">
              {recentFiles.length === 0 && <Text dimColor>Nenhum arquivo alterado.</Text>}
              {recentFiles.map(one => fileLine(one, inner - 2))}
            </Box>,
            'arquivos',
          )}
          {card(
            'Notas',
            `${noteList.length} notas`,
            <Box flexDirection="column">
              {recentNotes.length === 0 && <Text dimColor>Nenhuma nota ainda.</Text>}
              {recentNotes.map(one => (
                <Box flexDirection="row" gap={1}>
                  <Text color={P.light}>•</Text>
                  <Text color={INK}>{clip(one, inner - 8)}</Text>
                </Box>
              ))}
              {Input !== undefined ? (
                <Input
                  key="ov-note"
                  placeholder="nota rápida"
                  submitLabel="salvar"
                  value=""
                  onSubmit={text => addNote($, text)}
                />
              ) : (
                <Text dimColor>Use /painel nota texto</Text>
              )}
            </Box>,
            'notas',
          )}
        </Box>
      )
    }

    if (current === 'tarefas') {
      const done = taskList.length - openTasks
      const pct = taskList.length === 0 ? 0 : Math.round((done / taskList.length) * 100)

      body = (
        <Box flexDirection="column" gap={1}>
          {card('Progresso', `${done}/${taskList.length} feitas`, bar(pct, OK, inner - 2))}
          {label('A fazer')}
          {taskList.length === 0 && empty('☐', 'Nenhuma tarefa ainda.')}
          <Box flexDirection="column">
            {taskList.map((one, at) => (
              <Box flexDirection="row" gap={1}>
                <Button
                  key={`toggle-${one.id}`}
                  label={one.isDone ? '[x]' : '[ ]'}
                  onPress={() => toggleTask($, one.id)}
                />
                <Box flexGrow={1}>
                  <Text dimColor={one.isDone} strikethrough={one.isDone}>
                    <Text dimColor>{at + 1}.</Text> {clip(one.text, inner - 16)}
                  </Text>
                </Box>
                <Button
                  key={`remove-${one.id}`}
                  label="✕"
                  dimColor
                  onPress={() => removeTask($, one.id)}
                />
              </Box>
            ))}
          </Box>
          {Input !== undefined ? (
            <Input
              key="new-task"
              placeholder="nova tarefa"
              submitLabel="adicionar"
              value=""
              onSubmit={text => addTask($, text)}
            />
          ) : (
            <Text dimColor>Use /painel tarefa texto</Text>
          )}
        </Box>
      )
    }

    if (current === 'tokens') {
      const others = (u?.limits ?? []).filter(
        one => one.kind !== 'five_hour' && one.kind !== 'seven_day',
      )

      body = (
        <Box flexDirection="column" gap={1}>
          {card(
            'Limites de uso',
            undefined,
            <Box flexDirection="column" gap={1}>
              {limitRow('Session limit', session)}
              {limitRow('Weekly · all models', week)}
              {others.map(one => limitRow(one.kind, one))}
            </Box>,
          )}
          {card(
            'Contexto',
            u === null ? undefined : `${count(u.contextTokens ?? 0)} / ${count(u.window)}`,
            <Box flexDirection="column">
              <Box flexDirection="row" justifyContent="space-between">
                <Text dimColor>janela usada</Text>
                <Text bold color={tone(ctxPct)}>
                  {u === null ? '—' : `${ctxPct}%`}
                </Text>
              </Box>
              {bar(ctxPct, tone(ctxPct), inner - 2)}
            </Box>,
          )}
          {card(
            'Sessão',
            u !== null && u.model !== '' ? u.model : undefined,
            <Box flexDirection="column" gap={1}>
              <Box flexDirection="row">
                {stat('Custo', u === null || u.usd === null ? '—' : money(u.usd), INK)}
                {stat('Respostas', String(u?.turns ?? 0), INK)}
              </Box>
              <Box flexDirection="row">
                {stat('↑ Entrada', count(u?.input ?? 0), P.light)}
                {stat('↓ Saída', count(u?.output ?? 0), P.light)}
                {stat('⚡ Cache', count(u?.cacheRead ?? 0), P.light)}
              </Box>
            </Box>,
          )}
        </Box>
      )
    }

    if (current === 'log') {
      const rows = logList.slice(-room).reverse()
      const fails = logList.filter(one => one.status === 'fail' || one.status === 'deny').length

      body = (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" justifyContent="space-between">
            {label('Ferramentas')}
            <Text dimColor>
              {logList.length} chamadas
              {fails > 0 ? ` · ${fails} com erro` : ''}
            </Text>
          </Box>
          {rows.length === 0 && empty('≡', 'Nada rodou ainda.')}
          <Box flexDirection="column">{rows.map(one => logLine(one, inner))}</Box>
        </Box>
      )
    }

    if (current === 'arquivos') {
      const rows = [...fileList].reverse().slice(0, room)

      body = (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" justifyContent="space-between">
            {label('Alterados')}
            <Text dimColor>{fileList.length} arquivos</Text>
          </Box>
          {rows.length === 0 && empty('▤', 'Nenhum arquivo alterado.')}
          <Box flexDirection="column">{rows.map(one => fileLine(one, inner))}</Box>
        </Box>
      )
    }

    if (current === 'notas') {
      body = (
        <Box flexDirection="column" gap={1}>
          <Box flexDirection="row" justifyContent="space-between">
            {label('Anotações')}
            <Text dimColor>{noteList.length} notas</Text>
          </Box>
          {noteList.length === 0 && empty('✎', 'Nenhuma nota ainda.')}
          <Box flexDirection="column">
            {noteList.map((one, at) => (
              <Box flexDirection="row" gap={1}>
                <Text color={P.light}>•</Text>
                <Box flexGrow={1}>
                  <Text color={INK}>{clip(one, inner - 8)}</Text>
                </Box>
                <Button
                  key={`note-${at}`}
                  label="✕"
                  dimColor
                  onPress={() => removeNote($, at)}
                />
              </Box>
            ))}
          </Box>
          {Input !== undefined ? (
            <Input
              key="new-note"
              placeholder="nova nota"
              submitLabel="salvar"
              value=""
              onSubmit={text => addNote($, text)}
            />
          ) : (
            <Text dimColor>Use /painel nota texto</Text>
          )}
        </Box>
      )
    }

    if (current === 'ajustes') {
      const doneCount = taskList.length - openTasks

      body = (
        <Box flexDirection="column" gap={1}>
          {card(
            'Tema do Claude',
            `atual: ${themeLabel(themeNow)}`,
            <Box flexDirection="row" flexWrap="wrap" gap={1}>
              {THEMES.map(one =>
                choice(`theme-${one.id}`, one.label, one.id === themeNow, async () => {
                  $.ui.toast(await setTheme($, one.id))
                }),
              )}
            </Box>,
          )}
          {card(
            'Cor do painel',
            P.label,
            <Box flexDirection="row" flexWrap="wrap" gap={1}>
              {ACCENTS.map(one => (
                <Box flexDirection="row">
                  <Text color={PALETTES[one].main}>■ </Text>
                  {choice(`accent-${one}`, PALETTES[one].label, one === accentId, () =>
                    setAccent($, one),
                  )}
                </Box>
              ))}
            </Box>,
          )}
          {card(
            'Largura do painel',
            `${columnsNow} colunas`,
            <Box flexDirection="row" flexWrap="wrap" gap={1}>
              {WIDTHS.map(one =>
                choice(
                  `width-${one.columns}`,
                  `${one.label} ${one.columns}`,
                  one.columns === columnsNow,
                  () => setWidth($, one.columns),
                ),
              )}
            </Box>,
          )}
          {card(
            'Botão "Abrir painel"',
            openBtn ? 'ligado' : 'desligado',
            <Box flexDirection="column">
              <Text dimColor>Aparece sobre o prompt só com o painel fechado.</Text>
              {choice(
                'toggle-open-button',
                openBtn ? '[x] mostrar quando fechado' : '[ ] mostrar quando fechado',
                openBtn,
                () => toggleOpenButton($),
              )}
            </Box>,
          )}
          {card(
            'Limpeza',
            undefined,
            <Box flexDirection="row" flexWrap="wrap" gap={1}>
              <Button
                key="clear-done"
                label={`tarefas feitas (${doneCount})`}
                onPress={() => clearDone($)}
              />
              <Button
                key="clear-log"
                label={`log (${logList.length})`}
                onPress={() => update($, log, () => [])}
              />
              <Button
                key="clear-files"
                label={`arquivos (${fileList.length})`}
                onPress={() => update($, files, () => [])}
              />
              <Button
                key="clear-notes"
                label={`notas (${noteList.length})`}
                onPress={async () => {
                  await update($, notes, () => [])
                  await persist($)
                }}
              />
            </Box>,
          )}
        </Box>
      )
    }

    return (
      <Box flexDirection="column" gap={1}>
        {header}
        {body}
        {rule()}
        <Text dimColor>/painel ajuda · /tema muda o tema</Text>
      </Box>
    )
  })
}
