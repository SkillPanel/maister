// The plugin's hooks module (hooks/display.mjs), run by `claude plugin test`
// through `make test-mod`. It reads the display files the engine writes and
// draws them; here the files are answered from memory, and so are the session's
// id, root and surfaces, so each case says exactly what is on disk. A shell call
// beneath the plugin changes the files as the engine's verb would.

import { describe, expect, mock, test } from 'claude-code/testing'

const ROOT = '/project'
const SESSION = 'session-a'
const RUN = `${ROOT}/.maister/tasks/development/2026-10-07-sample`
const RUN_URL = `file://${RUN}`
const DASHBOARD = `file://${RUN}/dashboard.html`
const POINTER = `${ROOT}/.maister/display/sessions/${SESSION}.json`
const STATUS = `${RUN}/display/status.json`
const BANNER = `${RUN}/display/banner.json`
const NEXT = `${RUN}/display/next.json`
const PATCH = `${RUN}/.state-patch.json`

const FROZEN = '2026-10-07T16:24:39Z'
const LATER = '2026-10-07T16:33:39Z'
const LINE = 'Development · phase 5/12 · Specification · Add count() to the store'
const ENGINE = 'node "/plugin/skills/workflow-engine/scripts/workflow.mjs"'
const WRITE = `${ENGINE} write-state --state=${RUN}/orchestrator-state.yml --patch-file=${PATCH}`
const BRIEF = `${ENGINE} gate-brief --state=${RUN}/orchestrator-state.yml --node=specification-approval --json`
const ASK = 'Specification complete. Ready to go on?'
const GLANCE = [
  'Checkpoint 2/10 · Specification',
  'The spec adds store.count(), which returns how many notes the store holds.',
  'Decided: 1 · open risks: 1',
  'Next: Specification audit',
  'Review: implementation/spec.md',
]
const PARTS = [
  { key: 'title', label: 'Checkpoint 2 of 10', text: 'Specification' },
  { key: 'headline', label: 'Done', text: 'The spec adds store.count(), which returns how many notes the store holds.' },
  { key: 'counts', label: 'Decided', text: '1', risks: '1 open risk', open: 1 },
  { key: 'next', label: 'Next', text: 'Specification audit' },
  {
    key: 'review',
    label: 'Review',
    files: [
      { label: 'spec.md', path: 'implementation/spec.md', href: `${RUN_URL}/implementation/spec.md` },
      { label: 'spec.html', path: 'implementation/spec.html', href: `${RUN_URL}/implementation/spec.html` },
    ],
    more: 1,
  },
]
const QUESTIONS = [{
  question: ASK,
  header: 'Spec',
  multiSelect: false,
  options: [{ label: 'Continue (Recommended)', description: 'go on' }, { label: 'Stop here', description: 'end' }],
}]

const json = (value: unknown) => JSON.stringify(value)
const NODES = {
  intake: { title: 'Intake', status: 'completed' },
  'codebase-analysis': { title: 'Codebase analysis', status: 'running' },
  'specification-approval': { title: 'Specification approval', status: 'pending' },
}
const statusDoc = (fields: Record<string, unknown> = {}) => json({
  version: 1,
  workflow: 'Development',
  task: 'Add count() to the store',
  phase: { index: 5, total: 12, title: 'Specification' },
  checkpoint: { index: 2, total: 10, title: 'Specification approval' },
  status: 'in_progress',
  line: LINE,
  run_dir: RUN,
  run_url: RUN_URL,
  dashboard: DASHBOARD,
  started: FROZEN,
  nodes: NODES,
  saved: [],
  gate_open: false,
  artifacts: ['analysis/research-context', 'analysis/scope-clarifications.md', 'implementation/spec.md'],
  updated: LATER,
  ...fields,
})
const bannerDoc = json({
  version: 1,
  frozen: FROZEN,
  lines: ['Maister run started: Development', 'Task: Add count() to the store'],
  workflow: 'Development',
  task: 'Add count() to the store',
  checkpoints: 10,
  first_phase: 'Intake',
  run_dir: RUN,
  run_url: RUN_URL,
  dashboard: DASHBOARD,
})
const pointer = json({ version: 1, run_dir: RUN, updated: FROZEN })
const nextDoc = (question: string, fields: Record<string, unknown> = {}) =>
  json({ version: 1, kind: 'gate', node: 'specification-approval', header: 'Spec', question, glance: GLANCE, parts: PARTS, ...fields })

type Shell = { stdout?: string; stderr?: string; error?: string; files?: Record<string, string>; gone?: string[] }
type Written = { error?: string }
type Seen = { status: Array<string | undefined>; logs: string[]; ids: string[]; results: unknown[] }

/**
 * The engine beneath the plugin: these files on disk, this session drawn on
 * these surfaces, and each shell call answered by the next of `shells`, which
 * changes the files as the verb would and exits as it would.
 */
function beneath(on: any, files: Record<string, string>, { surfaces = ['terminal'], shells = [] as Shell[], writes = [] as Written[] } = {}): Seen {
  const seen: Seen = { status: [], logs: [], ids: [], results: [] }
  on('session.id', () => ({ value: SESSION }))
  on('session.root', () => ({ value: ROOT }))
  on('session.surfaces', () => ({ value: surfaces }))
  on('fs.exists', ($: unknown, e: { path: string }) => ({ value: e.path in files }))
  on('fs.read', ($: unknown, e: { path: string }) => (e.path in files ? { value: files[e.path] } : { deny: `${e.path}: missing` }))
  on('ui.status', ($: unknown, e: { text?: string }) => {
    seen.status.push(e.text)
    return { value: undefined }
  })
  on('ui.log', ($: unknown, e: { text: string }) => {
    seen.logs.push(e.text)
    return { value: undefined }
  })
  on('ui.render', () => ({ type: 'engine', ref: 0 }))
  on('session.start', () => ({ cwd: ROOT }))
  on('tool.call', { tool: 'Bash' }, ($: unknown, e: { tool_use_id: string }) => {
    seen.ids.push(e.tool_use_id)
    const shell = shells.shift() ?? {}
    Object.assign(files, shell.files ?? {})
    for (const file of shell.gone ?? []) delete files[file]
    const answer = shell.error !== undefined
      ? { isError: true, result: shell.error, text: shell.error }
      : { result: { stdout: shell.stdout ?? '', stderr: shell.stderr ?? '', interrupted: false } }
    seen.results.push(answer)
    return answer
  })
  on('tool.call', { tool: 'Write' }, ($: unknown, e: { tool_use_id: string; file_path: string }) => {
    seen.ids.push(e.tool_use_id)
    const write = writes.shift() ?? {}
    if (write.error !== undefined) return { isError: true, result: write.error, text: write.error }
    return { result: { type: 'create', filePath: e.file_path, content: '' } }
  })
  return seen
}

/** A tool row as the transcript draws it once the call has returned. */
const toolRow = (id: string, tool: string, input: unknown, fields: Record<string, unknown> = {}) =>
  ({ tool_use_id: id, tool, input, isRunning: false, isErrored: false, isInterrupted: false, output: {}, ...fields })

/** Mount one row on a surface and read what it draws. */
async function row($: any, surface: 'terminal' | 'desktop', id: string, tool = 'Bash', fields: Record<string, unknown> = {}) {
  const ui = await $.ui.mount({ plugin: 'maister', surface, component: 'ToolUse', requestId: id, props: toolRow(id, tool, {}, fields) })
  const drawn = await ui.drawn()
  const texts = (await ui.findAll({ type: 'Text' })).map((each: any) => each.text)
  const links = (await ui.findAll({ type: 'Link' })).map((each: any) => ({ href: each.props.href, text: flatten(each) }))
  const styles = (await ui.findAll({ type: 'Link' })).map((each: any) => each.children?.[0]?.props)
  await ui.unmount()
  return { drawn, texts, links, styles }
}

const BAND = { hasSurvey: false, isWorking: true, maxRows: 6, bodyColumns: 100, scroll: { offset: 0, bodyRows: 6, total: 2 }, view: {} }

/** Mount the band on a surface and read what it draws. */
async function band($: any, surface: 'terminal' | 'desktop', props: Record<string, unknown> = {}) {
  const ui = await $.ui.mount({ plugin: 'maister', surface, component: 'AbovePrompt', props: { ...BAND, ...props } })
  const drawn = await ui.drawn()
  const texts = (await ui.findAll({ type: 'Text' })).map((each: any) => each.text)
  const links = (await ui.findAll({ type: 'Link' })).map((each: any) => ({ href: each.props.href, text: flatten(each) }))
  const colours = Object.fromEntries((await ui.findAll({ type: 'Text' })).map((each: any) => [each.text, each.props.color]))
  await ui.unmount()
  return { drawn, texts, links, colours }
}

/** Ask the gate's question and read what each surface draws around the dialog while it is open. */
async function askAndDraw($: any, on: any, questions = QUESTIONS) {
  const drawn: Record<string, { texts: string[]; links: Array<{ href: unknown; text: string }>; rows: number } | undefined> = {}
  on('tool.call', { tool: 'AskUserQuestion' }, async () => {
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'maister', surface, component: 'AskUserQuestion', props: { tool: 'AskUserQuestion', questions } })
      const tree: any = await ui.drawn()
      const box = tree?.type === 'Box' ? tree.children?.[0] : null
      if (box?.type === 'Box' && box.props?.borderStyle) {
        drawn[surface] = {
          texts: (box.children ?? []).map(flatten),
          links: (await ui.findAll({ type: 'Link' })).map((each: any) => ({ href: each.props.href, text: flatten(each) })),
          rows: around(box, surface === 'terminal'),
        }
      }
      await ui.unmount()
    }
    return { result: { answers: {} } }
  })
  await $.tool.call({ tool: 'AskUserQuestion', questions })
  return drawn
}

/**
 * The rows a tree takes around the dialog, as Claude Code's own check counts
 * them (read from its validator): an inline element outside another one row, a
 * string one more per forty characters (and a row of its own outside an inline
 * element), a link the rows of a space and its URL where it is drawn as one, a
 * border two. The test kit does not hold a tree to it; this does.
 */
function around(node: any, links: boolean, inline = false): number {
  if (typeof node === 'string') return (inline ? 0 : 1) + Math.floor(node.length / 40)
  if (!node || typeof node !== 'object') return 0
  const isInline = node.type === 'Text' || node.type === 'Link'
  let rows = isInline && !inline ? 1 : 0
  if (node.type === 'Link' && links) rows += Math.floor((1 + String(node.props?.href ?? '').length) / 40)
  if (node.props?.borderStyle !== undefined) rows += 2
  for (const child of node.children ?? []) rows += around(child, links, inline || isInline)
  return rows
}

/** An element's shown text, its nested children joined. */
function flatten(node: any): string {
  if (typeof node === 'string') return node
  if (!node || typeof node !== 'object') return ''
  return (node.children ?? []).map(flatten).join('')
}

// ---------------------------------------------------------------------------
// B: the start card
// ---------------------------------------------------------------------------

describe('start card', () => {
  const freeze = (stderr = ''): Shell => ({
    stdout: 'Tell the user...\nMaister run started: Development\n',
    stderr,
    files: { [POINTER]: pointer, [STATUS]: statusDoc({ updated: FROZEN, phase: { index: 1, total: 12, title: 'Intake' } }), [BANNER]: bannerDoc },
  })

  test('draws in place of the freeze\'s row, with links to the dashboard and the task folder where they open', async ($: any, on: any) => {
    const seen = beneath(on, {}, { shells: [freeze()] })
    await $.tool.call({ tool: 'Bash', command: WRITE })
    for (const surface of ['terminal', 'desktop'] as const) {
      const drawn = await row($, surface, seen.ids[0])
      expect(drawn.texts).toContain('Development run started')
      expect(drawn.texts).toContain('Add count() to the store')
      expect(drawn.texts).toContain('up to 10 checkpoints · first: Intake')
      expect(drawn.links).toEqual(surface === 'terminal' ? [
        { href: DASHBOARD, text: 'Open dashboard ↗' },
        { href: RUN_URL, text: 'Open task folder ↗' },
      ] : [])
      for (const style of drawn.styles) expect(style).toMatchObject({ color: '#7cc4e8', underline: true })
      expect((drawn.drawn as any).type).not.toBe('engine')
      expect((drawn.drawn as any).props).toMatchObject({ borderStyle: 'round', borderColor: '#4a4f5a', paddingX: 2, paddingY: 1 })
    }
    expect(seen.logs).toEqual([])
  })

  test('draws under the row it does not replace when the freeze wrote a warning', async ($: any, on: any) => {
    const seen = beneath(on, {}, { shells: [freeze('warning: dashboard-data.js was not written')] })
    await $.tool.call({ tool: 'Bash', command: WRITE })
    const drawn = await row($, 'terminal', seen.ids[0])
    expect(drawn.texts).toContain('Development run started')
    expect(JSON.stringify(drawn.drawn)).toContain('"engine"')
  })

  test('falls back to the banner\'s log lines, once, where no surface draws the card', async ($: any, on: any) => {
    const seen = beneath(on, {}, { surfaces: ['vscode'], shells: [freeze(), {}] })
    await $.tool.call({ tool: 'Bash', command: WRITE })
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(seen.logs).toEqual(['Maister run started: Development', 'Task: Add count() to the store'])
    const drawn = await row($, 'terminal', seen.ids[0])
    expect(drawn.drawn).toMatchObject({ type: 'engine' })
  })

  test('is not drawn once a later write has moved the run on, nor for an unrelated row', async ($: any, on: any) => {
    const seen = beneath(on, { [POINTER]: pointer, [STATUS]: statusDoc(), [BANNER]: bannerDoc }, { shells: [{}] })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect((await row($, 'terminal', seen.ids[0])).drawn).toMatchObject({ type: 'engine' })
    expect(seen.logs).toEqual([])
  })
})

// ---------------------------------------------------------------------------
// C: the run band
// ---------------------------------------------------------------------------

describe('run band', () => {
  test('draws the run, its links, the phase as dots, the next checkpoint and how long it has run', async ($: any, on: any) => {
    const clock = mock.clock(on, { now: Date.parse(LATER) })
    beneath(on, { [POINTER]: pointer, [STATUS]: statusDoc() })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    for (const surface of ['terminal', 'desktop'] as const) {
      const drawn = await band($, surface)
      expect(drawn.texts).toContain('Development')
      expect(drawn.texts).toContain('Add count() to the store')
      expect(drawn.texts).toContain('●●●●●●●●●●●●')
      expect(drawn.texts).toContain('phase 5 of 12 · Specification')
      expect(drawn.texts).toContain('next checkpoint 2 of 10 · running for 9 min')
      expect(drawn.links).toEqual(surface === 'terminal' ? [{ href: DASHBOARD, text: 'Dashboard ↗' }, { href: RUN_URL, text: 'Task folder ↗' }] : [])
      expect(drawn.colours).toMatchObject({ Development: '#e2885d', '●●●●': '#79c08b', '●': '#e3bd59', '●●●●●●●': '#5a5f69' })
      if (surface === 'terminal') expect(drawn.colours).toMatchObject({ 'Dashboard ↗': '#7cc4e8', 'Task folder ↗': '#7cc4e8' })
    }
    await clock.advance(60_000)
    expect((await band($, 'terminal')).texts).toContain('next checkpoint 2 of 10 · running for 10 min')
  })

  test('never says how long anything will take', async ($: any, on: any) => {
    mock.clock(on, { now: Date.parse(LATER) })
    beneath(on, { [POINTER]: pointer, [STATUS]: statusDoc() })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    const text = (await band($, 'terminal')).texts.join(' ')
    expect(text).not.toMatch(/usually|about|left|remaining|estimate|eta/i)
  })

  test('yields while a survey holds the band', async ($: any, on: any) => {
    mock.clock(on, { now: Date.parse(LATER) })
    beneath(on, { [POINTER]: pointer, [STATUS]: statusDoc() })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    expect((await band($, 'terminal', { hasSurvey: true })).drawn).toMatchObject({ type: 'engine' })
  })

  test('keeps to one row when the band has one', async ($: any, on: any) => {
    mock.clock(on, { now: Date.parse(LATER) })
    beneath(on, { [POINTER]: pointer, [STATUS]: statusDoc() })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    const drawn: any = (await band($, 'terminal', { maxRows: 1 })).drawn
    expect(drawn.props.flexDirection).toBe('row')
    expect((await band($, 'terminal', { maxRows: 0 })).drawn).toMatchObject({ type: 'engine' })
  })

  test('frames the band with a blank row above it when the rows allow', async ($: any, on: any) => {
    mock.clock(on, { now: Date.parse(LATER) })
    beneath(on, { [POINTER]: pointer, [STATUS]: statusDoc() })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    for (const maxRows of [5, 6]) {
      const drawn: any = (await band($, 'terminal', { maxRows })).drawn
      expect(drawn.props).toMatchObject({ flexDirection: 'column', marginTop: 1, borderStyle: 'round', borderColor: '#4a4f5a', paddingX: 1 })
      expect(drawn.children).toHaveLength(2)
    }
  })

  test('drops the blank row first, then the frame, as the rows shrink', async ($: any, on: any) => {
    mock.clock(on, { now: Date.parse(LATER) })
    beneath(on, { [POINTER]: pointer, [STATUS]: statusDoc() })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    const four: any = (await band($, 'terminal', { maxRows: 4 })).drawn
    expect(four.props).toMatchObject({ borderStyle: 'round', borderColor: '#4a4f5a', paddingX: 1 })
    expect(four.props.marginTop).toBeUndefined()
    for (const maxRows of [2, 3]) {
      const drawn: any = (await band($, 'terminal', { maxRows })).drawn
      expect(drawn.props).toMatchObject({ flexDirection: 'column', marginLeft: 2 })
      expect(drawn.props.borderStyle).toBeUndefined()
      expect(drawn.props.marginTop).toBeUndefined()
      expect(drawn.children).toHaveLength(2)
    }
  })

  test('names how an ended run ended, with no dots and no clock', async ($: any, on: any) => {
    mock.clock(on, { now: Date.parse(LATER) })
    beneath(on, { [POINTER]: pointer, [STATUS]: statusDoc({ status: 'completed' }) })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    const drawn = await band($, 'terminal')
    expect(drawn.texts).toContain('completed')
    expect(drawn.texts.join(' ')).not.toMatch(/running for|●/)
  })

  test('draws nothing, and sets no status line, when this session drives no run', async ($: any, on: any) => {
    mock.clock(on, { now: Date.parse(LATER) })
    const seen = beneath(on, {}, { surfaces: ['vscode'] })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect((await band($, 'terminal')).drawn).toMatchObject({ type: 'engine' })
    expect(seen.status).toEqual([])
  })

  test('the status line stands in for it only where no surface draws the band', async ($: any, on: any) => {
    mock.clock(on, { now: Date.parse(LATER) })
    const drawn = beneath(on, { [POINTER]: pointer, [STATUS]: statusDoc() }, { surfaces: ['terminal', 'vscode'] })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(drawn.status).toEqual([])
  })

  test('the status line is the fallback on a surface without the band', async ($: any, on: any) => {
    mock.clock(on, { now: Date.parse(LATER) })
    const seen = beneath(on, { [POINTER]: pointer, [STATUS]: statusDoc() }, { surfaces: ['vscode'] })
    await $.session.start({ cwd: ROOT, surface: 'vscode', isInteractive: true })
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(seen.status).toEqual([LINE, LINE])
  })
})

// ---------------------------------------------------------------------------
// D: the gate panel
// ---------------------------------------------------------------------------

describe('gate panel', () => {
  test('the panel is two lines with links: the checkpoint, what was decided and the risks, then the review files', async ($: any, on: any) => {
    beneath(on, { [POINTER]: pointer, [STATUS]: statusDoc(), [NEXT]: nextDoc(ASK) })
    const drawn = await askAndDraw($, on)
    for (const surface of ['terminal', 'desktop'] as const) {
      const panel = drawn[surface]!
      expect(panel.texts).toEqual([
        'Checkpoint 2 of 10 · Specification · 1 decided · 1 open risk',
        'Review  spec.md  spec.html  +1 more',
      ])
      expect(panel.links).toEqual(surface === 'terminal' ? [
        { href: `${RUN_URL}/implementation/spec.md`, text: 'spec.md' },
        { href: `${RUN_URL}/implementation/spec.html`, text: 'spec.html' },
      ] : [])
      expect(panel.rows).toBeLessThanOrEqual(12)
    }
  })

  test('names the review files without links where their URLs would take the panel past twelve rows', async ($: any, on: any) => {
    const deep = `${RUN_URL}/${'a-very-long-directory-name/'.repeat(12)}`
    const parts = PARTS.map(part => (part.key !== 'review' ? part : {
      ...part,
      files: part.files!.map(file => ({ ...file, href: `${deep}${file.path}` })),
    }))
    beneath(on, { [POINTER]: pointer, [STATUS]: statusDoc(), [NEXT]: nextDoc(ASK, { parts }) })
    const drawn = await askAndDraw($, on)
    const panel = drawn.terminal!
    expect(panel.links).toEqual([])
    expect(panel.texts[1]).toBe('Review  spec.md  spec.html  +1 more')
    expect(panel.rows).toBeLessThanOrEqual(12)
  })

  test('links the review files that fit and names the rest', async ($: any, on: any) => {
    const deep = `${RUN_URL}/${'a-very-long-directory-name/'.repeat(12)}`
    const parts = PARTS.map(part => (part.key !== 'review' ? part : {
      ...part,
      files: part.files!.map((file, index) => ({ ...file, href: index === 0 ? file.href : `${deep}${file.path}` })),
    }))
    beneath(on, { [POINTER]: pointer, [STATUS]: statusDoc(), [NEXT]: nextDoc(ASK, { parts }) })
    const panel = (await askAndDraw($, on)).terminal!
    expect(panel.links).toEqual([{ href: `${RUN_URL}/implementation/spec.md`, text: 'spec.md' }])
    expect(panel.texts[1]).toBe('Review  spec.md  spec.html  +1 more')
    expect(panel.rows).toBeLessThanOrEqual(12)
  })

  test('marks open risks in amber, the checkpoint in the accent, and the review files as links', async ($: any, on: any) => {
    beneath(on, { [POINTER]: pointer, [STATUS]: statusDoc(), [NEXT]: nextDoc(ASK) })
    let colours: Record<string, unknown> = {}
    let styles: unknown[] = []
    on('tool.call', { tool: 'AskUserQuestion' }, async () => {
      const ui = await $.ui.mount({ plugin: 'maister', surface: 'terminal', component: 'AskUserQuestion', props: { tool: 'AskUserQuestion', questions: QUESTIONS } })
      colours = Object.fromEntries((await ui.findAll({ type: 'Text' })).map((each: any) => [each.text, each.props.color]))
      styles = (await ui.findAll({ type: 'Link' })).map((each: any) => each.children?.[0]?.props)
      await ui.unmount()
      return { result: { answers: {} } }
    })
    await $.tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS })
    expect(colours).toMatchObject({ '1 open risk': '#e3bd59', 'Checkpoint 2 of 10': '#e2885d', '1 decided': '#8c909a' })
    expect(styles).toEqual([{ color: '#7cc4e8', underline: true }, { color: '#7cc4e8', underline: true }])
  })

  test('draws no open risks dim', async ($: any, on: any) => {
    const parts = PARTS.map(part => (part.key !== 'counts' ? part : { ...part, risks: 'no open risks', open: 0 }))
    beneath(on, { [POINTER]: pointer, [STATUS]: statusDoc(), [NEXT]: nextDoc(ASK, { parts }) })
    let colour: unknown
    on('tool.call', { tool: 'AskUserQuestion' }, async () => {
      const ui = await $.ui.mount({ plugin: 'maister', surface: 'terminal', component: 'AskUserQuestion', props: { tool: 'AskUserQuestion', questions: QUESTIONS } })
      colour = (await ui.findAll({ type: 'Text' })).find((each: any) => each.text === 'no open risks')?.props.color
      await ui.unmount()
      return { result: { answers: {} } }
    })
    await $.tool.call({ tool: 'AskUserQuestion', questions: QUESTIONS })
    expect(colour).toBe('#8c909a')
  })

  test('draws the plain glance from a brief without parts', async ($: any, on: any) => {
    beneath(on, { [POINTER]: pointer, [STATUS]: statusDoc(), [NEXT]: nextDoc(ASK, { parts: undefined }) })
    const drawn = await askAndDraw($, on)
    expect(drawn.terminal!.texts).toEqual(GLANCE)
  })

  test('draws nothing above a question that is not the gate\'s', async ($: any, on: any) => {
    beneath(on, { [POINTER]: pointer, [STATUS]: statusDoc(), [NEXT]: nextDoc('Which line endings should toCsv write?') })
    const drawn = await askAndDraw($, on)
    expect(drawn.terminal).toBeUndefined()
    expect(drawn.desktop).toBeUndefined()
  })

  test('draws nothing when no gate brief is open', async ($: any, on: any) => {
    beneath(on, { [POINTER]: pointer, [STATUS]: statusDoc() })
    const drawn = await askAndDraw($, on)
    expect(drawn.terminal).toBeUndefined()
  })
})

// ---------------------------------------------------------------------------
// E: quiet bookkeeping
// ---------------------------------------------------------------------------

describe('quiet bookkeeping', () => {
  const saved = (fields: Record<string, unknown> = {}): Shell => ({
    stdout: 'workflow.nodes.intake\nworkflow.nodes.codebase-analysis\n',
    files: {
      [STATUS]: statusDoc({
        updated: '2026-10-07T16:40:00Z',
        saved: [
          { node: 'intake', title: 'Intake', status: 'completed' },
          { node: 'codebase-analysis', title: 'Codebase analysis', status: 'running' },
        ],
        ...fields,
      }),
    },
    gone: [PATCH],
  })
  const files = () => ({ [POINTER]: pointer, [STATUS]: statusDoc(), [BANNER]: bannerDoc })

  test('a clean state write draws as one line naming what it saved, the result unchanged for the model', async ($: any, on: any) => {
    const seen = beneath(on, files(), { shells: [saved()] })
    const ran = await $.tool.call({ tool: 'Bash', command: WRITE })
    expect(ran.result).toEqual((seen.results[0] as any).result)
    for (const surface of ['terminal', 'desktop'] as const) {
      expect((await row($, surface, seen.ids[0])).texts).toEqual(['· maister · saved · intake → done, codebase analysis → running'])
    }
    const result = await $.ui.mount({ plugin: 'maister', surface: 'terminal', component: 'ToolResult', props: { tool_use_id: seen.ids[0], tool: 'Bash', output: {}, isErrored: false } })
    expect(await result.findAll({ type: 'Text' })).toEqual([])
    await result.unmount()
  })

  test('a quiet line sits under the row\'s bullet, dim, as a tool result\'s line does', async ($: any, on: any) => {
    const seen = beneath(on, files(), { shells: [saved()] })
    await $.tool.call({ tool: 'Bash', command: WRITE })
    const drawn: any = (await row($, 'terminal', seen.ids[0])).drawn
    expect(drawn).toMatchObject({ type: 'Box', props: { marginLeft: 2 } })
    expect(drawn.children[0].props.color).toBe('#8c909a')
  })

  test('an empty write draws nothing', async ($: any, on: any) => {
    const seen = beneath(on, files(), { shells: [saved({ saved: [] })] })
    await $.tool.call({ tool: 'Bash', command: WRITE })
    const drawn = await row($, 'terminal', seen.ids[0])
    expect(drawn.texts).toEqual([])
    expect((drawn.drawn as any).type).toBe('Box')
  })

  test('a repeat is dropped: the brief of the checkpoint a write already opened draws nothing', async ($: any, on: any) => {
    const parts = PARTS.map(part => (part.key !== 'title' ? part : { ...part, text: 'Specification approval' }))
    const seen = beneath(on, files(), { shells: [saved({ gate_open: true }), { stdout: '{"ok":true}', files: { [NEXT]: nextDoc(ASK, { parts }) } }, saved({ updated: '2026-10-07T16:41:00Z', saved: [{ node: 'intake', title: 'Intake', status: 'completed' }] }), saved({ updated: '2026-10-07T16:42:00Z', saved: [{ node: 'intake', title: 'Intake', status: 'completed' }] })] })
    for (const command of [WRITE, BRIEF, WRITE, WRITE]) await $.tool.call({ tool: 'Bash', command })
    expect((await row($, 'terminal', seen.ids[0])).texts).toEqual(['· maister · checkpoint 2 of 10 · Specification approval'])
    expect((await row($, 'terminal', seen.ids[1])).texts).toEqual([])
    expect((await row($, 'terminal', seen.ids[2])).texts).toEqual(['· maister · saved · intake → done'])
    expect((await row($, 'terminal', seen.ids[3])).texts).toEqual([])
  })

  test('a write that opens a gate draws as the checkpoint it opened', async ($: any, on: any) => {
    const seen = beneath(on, files(), { shells: [saved({ gate_open: true })] })
    await $.tool.call({ tool: 'Bash', command: WRITE })
    expect((await row($, 'terminal', seen.ids[0])).texts).toEqual(['· maister · checkpoint 2 of 10 · Specification approval'])
  })

  test('a clean gate brief draws as the checkpoint it briefs', async ($: any, on: any) => {
    const seen = beneath(on, files(), { shells: [{ stdout: '{"ok":true}', files: { [NEXT]: nextDoc(ASK) } }] })
    await $.tool.call({ tool: 'Bash', command: BRIEF })
    expect((await row($, 'terminal', seen.ids[0])).texts).toEqual(['· maister · checkpoint 2 of 10 · Specification'])
  })

  test('a refusal is never collapsed', async ($: any, on: any) => {
    const seen = beneath(on, files(), { shells: [{ error: 'Exit code 1\nstate-node-unknown: no node named intak' }] })
    await $.tool.call({ tool: 'Bash', command: WRITE })
    expect((await row($, 'terminal', seen.ids[0], 'Bash', { isErrored: true })).drawn).toMatchObject({ type: 'engine' })
    expect((await row($, 'terminal', seen.ids[0])).drawn).toMatchObject({ type: 'engine' })
  })

  test('a write that landed with a warning draws in full', async ($: any, on: any) => {
    const seen = beneath(on, files(), { shells: [{ ...saved(), stderr: 'warning: display/status.json was not written' }] })
    await $.tool.call({ tool: 'Bash', command: WRITE })
    expect((await row($, 'terminal', seen.ids[0])).drawn).toMatchObject({ type: 'engine' })
  })

  test('a write the files do not show landing draws in full', async ($: any, on: any) => {
    const seen = beneath(on, files(), { shells: [{ stdout: '' }] })
    await $.tool.call({ tool: 'Bash', command: WRITE })
    expect((await row($, 'terminal', seen.ids[0])).drawn).toMatchObject({ type: 'engine' })
  })

  test('another command that moves the run on is not the engine\'s verb, and draws in full', async ($: any, on: any) => {
    const seen = beneath(on, files(), { shells: [saved()] })
    await $.tool.call({ tool: 'Bash', command: 'make test' })
    expect((await row($, 'terminal', seen.ids[0])).drawn).toMatchObject({ type: 'engine' })
  })

  test('a row that errors after it was drawn quiet draws in full again', async ($: any, on: any) => {
    const seen = beneath(on, files(), { shells: [saved()] })
    await $.tool.call({ tool: 'Bash', command: WRITE })
    expect((await row($, 'terminal', seen.ids[0], 'Bash', { isErrored: true })).drawn).toMatchObject({ type: 'engine' })
  })

  test('the patch file draws as one line, then nothing once a write lands it', async ($: any, on: any) => {
    const seen = beneath(on, files(), { shells: [saved()] })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    const content = json({ nodes: { intake: { status: 'completed' }, 'codebase-analysis': { status: 'running' } } })
    await $.tool.call({ tool: 'Write', file_path: PATCH, content })
    const write = seen.ids[0]
    expect((await row($, 'terminal', write, 'Write')).texts).toEqual(['· maister · patch · intake → done, codebase analysis → running'])
    await $.tool.call({ tool: 'Bash', command: WRITE })
    const after = await row($, 'terminal', write, 'Write')
    expect(after.texts).toEqual([])
    expect((after.drawn as any).type).toBe('Box')
  })

  test('a patch whose write is refused keeps its line', async ($: any, on: any) => {
    const seen = beneath(on, files(), { shells: [{ error: 'Exit code 1\nstate-patch-invalid' }] })
    await $.tool.call({ tool: 'Write', file_path: PATCH, content: json({ nodes: { intake: { status: 'completed' } } }) })
    await $.tool.call({ tool: 'Bash', command: WRITE })
    expect((await row($, 'terminal', seen.ids[0], 'Write')).texts).toEqual(['· maister · patch · intake → done'])
  })

  test('a Write of any other file draws in full', async ($: any, on: any) => {
    const seen = beneath(on, files())
    await $.tool.call({ tool: 'Write', file_path: `${ROOT}/notes.md`, content: 'x' })
    await $.tool.call({ tool: 'Write', file_path: `${RUN}/analysis/notes-to-self.md`, content: 'x' })
    expect((await row($, 'terminal', seen.ids[0], 'Write')).drawn).toMatchObject({ type: 'engine' })
    expect((await row($, 'terminal', seen.ids[1], 'Write')).drawn).toMatchObject({ type: 'engine' })
  })

  test('an artifact write collapses to one line, its path a link where links open', async ($: any, on: any) => {
    const seen = beneath(on, files())
    await $.tool.call({ tool: 'Write', file_path: `${RUN}/analysis/scope-clarifications.md`, content: '# Scope' })
    await $.tool.call({ tool: 'Write', file_path: `${RUN}/analysis/research-context/sources.md`, content: '# Sources' })
    for (const surface of ['terminal', 'desktop'] as const) {
      const drawn = await row($, surface, seen.ids[0], 'Write')
      expect(flatten(drawn.drawn)).toBe('· maister · wrote analysis/scope-clarifications.md')
      expect(drawn.links).toEqual(surface === 'terminal' ? [{ href: `${RUN_URL}/analysis/scope-clarifications.md`, text: 'analysis/scope-clarifications.md' }] : [])
      for (const style of drawn.styles) expect(style).toMatchObject({ color: '#7cc4e8', underline: true })
    }
    expect(flatten((await row($, 'terminal', seen.ids[1], 'Write')).drawn)).toBe('· maister · wrote analysis/research-context/sources.md')
  })

  test('a failed artifact write draws in full', async ($: any, on: any) => {
    const seen = beneath(on, files(), { writes: [{ error: 'EACCES: permission denied' }] })
    await $.tool.call({ tool: 'Write', file_path: `${RUN}/analysis/scope-clarifications.md`, content: '# Scope' })
    expect((await row($, 'terminal', seen.ids[0], 'Write')).drawn).toMatchObject({ type: 'engine' })
    expect((await row($, 'terminal', seen.ids[0], 'Write', { isErrored: true })).drawn).toMatchObject({ type: 'engine' })
  })

  test('without a declared list, any file in the task folder but the engine\'s own is an artifact', async ($: any, on: any) => {
    const seen = beneath(on, { ...files(), [STATUS]: statusDoc({ artifacts: undefined }) })
    await $.tool.call({ tool: 'Write', file_path: `${RUN}/analysis/notes.md`, content: 'x' })
    await $.tool.call({ tool: 'Write', file_path: `${RUN}/orchestrator-state.yml`, content: 'x' })
    expect(flatten((await row($, 'terminal', seen.ids[0], 'Write')).drawn)).toBe('· maister · wrote analysis/notes.md')
    expect((await row($, 'terminal', seen.ids[1], 'Write')).drawn).toMatchObject({ type: 'engine' })
  })

  const call = (id: string, tool = 'Bash', fields: Record<string, unknown> = {}) =>
    ({ tool_use_id: id, tool, input: {}, isRunning: false, isErrored: false, isInterrupted: false, output: {}, ...fields })

  /** Mount a folded run of calls and read what it draws. */
  async function group($: any, calls: unknown[], isExpanded = false) {
    const ui = await $.ui.mount({ plugin: 'maister', surface: 'terminal', component: 'ToolGroup', props: { calls, isActive: false, isExpanded } })
    const drawn: any = await ui.drawn()
    const texts = (await ui.findAll({ type: 'Text' })).map((each: any) => each.text)
    await ui.unmount()
    return { drawn, texts }
  }

  test('a folded run of the engine\'s own calls draws as their lines alone', async ($: any, on: any) => {
    const seen = beneath(on, files(), { shells: [saved()] })
    await $.tool.call({ tool: 'Write', file_path: PATCH, content: json({ nodes: { intake: { status: 'completed' } } }) })
    await $.tool.call({ tool: 'Bash', command: WRITE })
    const drawn = await group($, [call(seen.ids[0], 'Write'), call(seen.ids[1])])
    expect(drawn.texts).toEqual(['· maister · saved · intake → done, codebase analysis → running'])
    expect(JSON.stringify(drawn.drawn)).not.toContain('"engine"')
  })

  test('a folded run of engine calls, one of which says nothing, draws only the quiet line in its place', async ($: any, on: any) => {
    const seen = beneath(on, files(), { shells: [saved({ saved: [] }), saved({ updated: '2026-10-07T16:41:00Z' })] })
    await $.tool.call({ tool: 'Bash', command: WRITE })
    await $.tool.call({ tool: 'Bash', command: WRITE })
    const drawn = await group($, [call(seen.ids[0]), call(seen.ids[1])])
    expect(drawn.texts).toEqual(['· maister · saved · intake → done, codebase analysis → running'])
    expect(JSON.stringify(drawn.drawn)).not.toContain('"engine"')
    const quiet = await group($, [call(seen.ids[0])])
    expect(quiet.texts).toEqual([])
    expect(JSON.stringify(quiet.drawn)).not.toContain('"engine"')
  })

  test('a folded run mixed with other calls draws as Claude Code draws it, nothing added', async ($: any, on: any) => {
    const seen = beneath(on, files(), { shells: [{}, saved()] })
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    await $.tool.call({ tool: 'Bash', command: WRITE })
    const drawn = await group($, [call(seen.ids[0]), call(seen.ids[1])])
    expect(drawn.drawn).toMatchObject({ type: 'engine' })
    expect(drawn.texts).toEqual([])
  })

  test('a folded run holding the freeze draws the start card', async ($: any, on: any) => {
    const seen = beneath(on, {}, { shells: [{
      stdout: 'Tell the user...\n',
      files: { [POINTER]: pointer, [STATUS]: statusDoc({ updated: FROZEN }), [BANNER]: bannerDoc },
    }] })
    await $.tool.call({ tool: 'Bash', command: WRITE })
    expect((await group($, [call(seen.ids[0])])).texts).toContain('Development run started')
  })

  test('a folded run whose engine call errored, or one that is unfolded, draws as Claude Code draws it', async ($: any, on: any) => {
    const seen = beneath(on, files(), { shells: [saved()] })
    await $.tool.call({ tool: 'Bash', command: WRITE })
    expect((await group($, [call(seen.ids[0], 'Bash', { isErrored: true })])).drawn).toMatchObject({ type: 'engine' })
    expect((await group($, [call(seen.ids[0])], true)).drawn).toMatchObject({ type: 'engine' })
  })
})
