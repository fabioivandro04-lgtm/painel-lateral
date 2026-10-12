import { expect, mock, test } from 'claude-code/testing'

const USAGE = {
  startedAt: 0,
  context: { window: 200000, tokens: 50000, percent: 25 },
  rateLimits: [
    { kind: 'five_hour', percentUsed: 10, resetsAt: '2099-01-01T00:00:00Z' },
    { kind: 'seven_day', percentUsed: 72 },
  ],
  cost: { usd: 0.42 },
}

const PANE = {
  plugin: 'painel-lateral',
  component: 'Pane',
  requestId: 'painel-lateral',
  viewport: { rows: 30, columns: 52 },
  props: {
    title: 'Painel',
    isFocused: false,
    bodyColumns: 52,
    placement: 'inline',
    scroll: { offset: 0, bodyRows: 28 },
    view: {},
  },
} as const

const BAND = {
  plugin: 'painel-lateral',
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const SURFACES = ['terminal', 'desktop'] as const

test('o botao abre o painel, a faixa some e o X do painel o fecha', async ($, on) => {
  const open: string[] = []
  on('ui.panes', () => ({
    value: open.length === 0 ? [] : [{ id: 'painel-lateral', title: 'Painel', isShown: true, isFocused: false, isPlaced: true }],
  }))
  on('ui.open', (_, e) => {
    open.push(e.id)

    return { value: { isPlaced: true } }
  })
  on('ui.close', () => {
    open.length = 0

    return { value: {} }
  })
  // o que o motor desenha quando a faixa nao pinta nada
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))

  for (const surface of SURFACES) {
    open.length = 0
    const band = await $.ui.mount({ ...BAND, surface })
    expect((await band.find({ key: 'painel-toggle' }))?.text).toContain('Abrir painel')

    await band.press({ key: 'painel-toggle' })
    expect(open).toEqual(['painel-lateral'])
    // aberto: a faixa nao desenha botao nenhum
    expect(await band.find({ key: 'painel-toggle' })).toBeUndefined()
    await band.unmount()

    const pane = await $.ui.mount({ ...PANE, surface })
    await pane.press({ key: 'painel-close' })
    expect(open).toEqual([])
    await pane.unmount()

    const again = await $.ui.mount({ ...BAND, surface })
    expect((await again.find({ key: 'painel-toggle' }))?.text).toContain('Abrir painel')
    await again.unmount()
  }
})

test('/painel adiciona, marca e remove tarefas', async ($, on) => {
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))

  const added = await $.command.run({ command: 'painel', args: 'tarefa comprar pao' })
  expect(added.text).toBe('Tarefa adicionada: comprar pao')

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /comprar pao/ })).toBeDefined()
    await ui.unmount()
  }

  const done = await $.command.run({ command: 'painel', args: 'feito 1' })
  expect(done.text).toBe('Feita: comprar pao')

  await $.command.run({ command: 'painel', args: 'aba tarefas' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await ui.find({ key: 'toggle-1' }))?.text).toContain('[x]')
  await ui.press({ key: 'toggle-1' })
  expect((await ui.find({ key: 'toggle-1' }))?.text).toContain('[ ]')
  await ui.press({ key: 'remove-1' })
  expect(await ui.find({ key: 'toggle-1' })).toBeUndefined()
  await ui.unmount()
})

test('/painel recusa tarefa que nao existe', async ($, on) => {
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))

  const missing = await $.command.run({ command: 'painel', args: 'feito 9' })
  expect(missing.text).toBe('Não existe a tarefa 9.')
})

test('o campo de nova tarefa adiciona pelo Enter', async ($, on) => {
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run({ command: 'painel', args: 'aba tarefas' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.input({ key: 'new-task', text: 'revisar o PR' })
  expect(await ui.find({ type: 'Text', text: /revisar o PR/ })).toBeDefined()
  await ui.unmount()
})

test('notas e troca de aba', async ($, on) => {
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))

  await $.command.run({ command: 'painel', args: 'nota ligar para o banco' })
  await $.command.run({ command: 'painel', args: 'aba notas' })

  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /ligar para o banco/ })).toBeDefined()
  await ui.unmount()
})

test('tool.call vai para o log e para a aba Arquivos, e o custo aparece em Tokens', async ($, on) => {
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.usage', () => ({ value: USAGE }))
  on('tool.call', () => ({ ref: 'r1', result: {}, text: 'ok' }))

  await $.tool.call({
    tool: 'Edit',
    tool_use_id: 't1',
    file_path: '/proj/a.ts',
    old_string: 'a',
    new_string: 'b',
  })

  await $.command.run({ command: 'painel', args: 'aba log' })
  const log = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await log.find({ type: 'Text', text: /Edit \/proj\/a\.ts/ })).toBeDefined()
  await log.unmount()

  await $.command.run({ command: 'painel', args: 'aba arquivos' })
  const files = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await files.find({ type: 'Text', text: /a\.ts/ })).toBeDefined()
  await files.unmount()

  await $.command.run({ command: 'painel', args: 'aba tokens' })
  const tokens = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await tokens.find({ type: 'Text', text: /\$0\.42/ })).toBeDefined()
  expect(await tokens.find({ type: 'Text', text: /25%/ })).toBeDefined()
  expect(await tokens.find({ type: 'Text', text: /Session limit/ })).toBeDefined()
  expect(await tokens.find({ type: 'Text', text: /10%/ })).toBeDefined()
  expect(await tokens.find({ type: 'Text', text: /Weekly/ })).toBeDefined()
  expect(await tokens.find({ type: 'Text', text: /72%/ })).toBeDefined()
  await tokens.unmount()
})

test('overview resume tokens, tarefas, log, arquivos e notas', async ($, on) => {
  mock.store(on)
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('session.usage', () => ({ value: USAGE }))
  on('tool.call', () => ({ ref: 'r1', result: {}, text: 'ok' }))

  await $.command.run({ command: 'painel', args: 'tarefa comprar pao' })
  await $.command.run({ command: 'painel', args: 'nota ligar para o banco' })
  await $.tool.call({
    tool: 'Edit',
    tool_use_id: 't1',
    file_path: '/proj/a.ts',
    old_string: 'a',
    new_string: 'b',
  })
  await $.command.run({ command: 'painel', args: 'aba overview' })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    expect(await ui.find({ type: 'Text', text: /Tokens/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /72%/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /comprar pao/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /Edit \/proj\/a\.ts/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /a\.ts/ })).toBeDefined()
    expect(await ui.find({ type: 'Text', text: /ligar para o banco/ })).toBeDefined()
    expect(await ui.find({ key: 'go-tokens' })).toBeDefined()
    await ui.unmount()
  }

  // marcar uma tarefa pelo overview
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await ui.press({ key: 'ov-toggle-1' })
  expect(await ui.find({ key: 'ov-toggle-1' })).toBeUndefined()
  await ui.unmount()
})

test('/tema muda o tema e a cor do painel', async ($, on) => {
  mock.store(on)
  const set: unknown[] = []
  on('config.set', (_, e) => {
    set.push(e.value)

    return { value: e.value }
  })

  const nardo = await $.command.run({ command: 'tema', args: 'nardo' })
  expect(nardo.text).toBe('Tema: Nardo Grey')
  expect(set).toEqual(['custom:nardo-grey'])

  const dark = await $.command.run({ command: 'tema', args: 'escuro' })
  expect(dark.text).toBe('Tema: Escuro')
  expect(set).toEqual(['custom:nardo-grey', 'dark'])

  const color = await $.command.run({ command: 'tema', args: 'cor prata' })
  expect(color.text).toBe('Cor do painel: Prata')

  const bad = await $.command.run({ command: 'tema', args: 'roxo' })
  expect(bad.text).toContain('Não conheço o tema')
})

test('ajustes: botoes mudam tema, cor, largura e o botao Abrir painel', async ($, on) => {
  mock.store(on)
  const set: unknown[] = []
  on('config.set', (_, e) => {
    set.push(e.value)

    return { value: e.value }
  })
  on('ui.panes', () => ({ value: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('ui.close', () => ({ value: {} }))
  await $.command.run({ command: 'painel', args: 'aba ajustes' })

  for (const surface of SURFACES) {
    const ui = await $.ui.mount({ ...PANE, surface })
    await ui.press({ key: 'theme-custom:nardo-grey' })
    await ui.press({ key: 'accent-prata' })
    await ui.press({ key: 'width-64' })
    expect((await ui.find({ key: 'toggle-open-button' }))?.text).toContain('[x]')
    await ui.press({ key: 'toggle-open-button' })
    expect((await ui.find({ key: 'toggle-open-button' }))?.text).toContain('[ ]')
    await ui.press({ key: 'toggle-open-button' })
    await ui.unmount()
  }
  expect(set).toContain('custom:nardo-grey')
})

test('com o botao desligado nos ajustes a faixa nao desenha nada', async ($, on) => {
  mock.store(on)
  on('ui.panes', () => ({ value: [] }))
  on('ui.render', () => ({ type: 'Box', props: {}, children: [] }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  await $.command.run({ command: 'painel', args: 'aba ajustes' })

  const pane = await $.ui.mount({ ...PANE, surface: 'terminal' })
  await pane.press({ key: 'toggle-open-button' })
  await pane.unmount()

  const band = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await band.find({ key: 'painel-toggle' })).toBeUndefined()
  await band.unmount()
})
