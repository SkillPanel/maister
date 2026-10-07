// The plugin's hooks module (hooks/display.mjs), run by `claude plugin test`
// through `make test-mod`. It reads the display files the engine writes and
// draws them; here the files are answered from memory, and so are the session's
// id and root, so each case says exactly what is on disk.

import { describe, expect, test } from 'claude-code/testing'

const ROOT = '/project'
const SESSION = 'session-a'
const RUN = `${ROOT}/.maister/tasks/development/2026-10-07-sample`
const POINTER = `${ROOT}/.maister/display/sessions/${SESSION}.json`
const STATUS = `${RUN}/display/status.json`
const BANNER = `${RUN}/display/banner.json`
const NEXT = `${RUN}/display/next.json`

const FROZEN = '2026-10-07T16:24:39Z'
const LINE = 'Development · phase 1/12 · Intake · Add count() to the store'
const ASK = 'Specification complete. Ready to go on?'
const GLANCE = [
  'Checkpoint 4/10 · Specification',
  'The spec adds store.count(), which returns how many notes the store holds.',
  'Decided: 1 · open risks: 0',
  'Next: Specification audit',
  'Review: implementation/spec.md',
]
const QUESTIONS = [{
  question: ASK,
  header: 'Spec',
  multiSelect: false,
  options: [{ label: 'Continue (Recommended)', description: 'go on' }, { label: 'Stop here', description: 'end' }],
}]

const json = (value: unknown) => JSON.stringify(value)
const status = (updated: string) => json({ version: 1, line: LINE, updated, run_dir: RUN })
const banner = json({ version: 1, frozen: FROZEN, lines: ['Maister run started: Development', 'Task: Add count() to the store'] })
const pointer = json({ version: 1, run_dir: RUN, updated: FROZEN })
const next = (question: string) => json({ version: 1, kind: 'gate', node: 'specification-approval', header: 'Spec', question, glance: GLANCE })

type Seen = { status: Array<string | undefined>; logs: string[] }

/** The engine beneath the plugin: these files on disk, this session, and nothing drawn but what the plugin asks. */
function beneath(on: any, files: Record<string, string>): Seen {
  const seen: Seen = { status: [], logs: [] }
  on('session.id', () => ({ value: SESSION }))
  on('session.root', () => ({ value: ROOT }))
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
  on('tool.call', { tool: 'Bash' }, () => ({ result: { stdout: '', stderr: '', interrupted: false } }))
  return seen
}

/** Ask the gate's question and read what each surface draws around the dialog while it is open. */
async function askAndDraw($: any, on: any, questions = QUESTIONS) {
  const drawn: Record<string, string | undefined> = {}
  on('tool.call', { tool: 'AskUserQuestion' }, async () => {
    for (const surface of ['terminal', 'desktop'] as const) {
      const ui = await $.ui.mount({ plugin: 'maister', surface, component: 'AskUserQuestion', props: { tool: 'AskUserQuestion', questions } })
      drawn[surface] = (await ui.find({ type: 'Text', text: /^Checkpoint / }))?.text
      await ui.unmount()
    }
    return { result: { answers: {} } }
  })
  await $.tool.call({ tool: 'AskUserQuestion', questions })
  return drawn
}

describe('status line', () => {
  test('is the run status file\'s line, at the session\'s start and after a shell call', async ($: any, on: any) => {
    const seen = beneath(on, { [POINTER]: pointer, [STATUS]: status('2026-10-07T17:00:00Z') })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    expect(seen.status).toEqual([LINE])
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(seen.status).toEqual([LINE, LINE])
  })

  test('is left alone when this session drives no run', async ($: any, on: any) => {
    const seen = beneath(on, {})
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(seen.status).toEqual([])
    expect(seen.logs).toEqual([])
  })
})

describe('banner', () => {
  test('is logged one line at a time, once, right after the freeze', async ($: any, on: any) => {
    const seen = beneath(on, { [POINTER]: pointer, [STATUS]: status(FROZEN), [BANNER]: banner })
    await $.tool.call({ tool: 'Bash', command: 'node workflow.mjs write-state' })
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(seen.logs).toEqual(['Maister run started: Development', 'Task: Add count() to the store'])
  })

  test('is not logged once a later write has moved the run on, nor at the session\'s start', async ($: any, on: any) => {
    const seen = beneath(on, { [POINTER]: pointer, [STATUS]: status('2026-10-07T17:00:00Z'), [BANNER]: banner })
    await $.session.start({ cwd: ROOT, surface: 'terminal', isInteractive: true })
    await $.tool.call({ tool: 'Bash', command: 'ls' })
    expect(seen.logs).toEqual([])
  })
})

describe('gate panel', () => {
  test('draws the glance above the gate\'s question on the terminal and the desktop', async ($: any, on: any) => {
    beneath(on, { [POINTER]: pointer, [STATUS]: status(FROZEN), [NEXT]: next(ASK) })
    const drawn = await askAndDraw($, on)
    expect(drawn.terminal).toBe('Checkpoint 4/10 · Specification')
    expect(drawn.desktop).toBe('Checkpoint 4/10 · Specification')
  })

  test('draws nothing above a question that is not the gate\'s', async ($: any, on: any) => {
    beneath(on, { [POINTER]: pointer, [STATUS]: status(FROZEN), [NEXT]: next('Which line endings should toCsv write?') })
    const drawn = await askAndDraw($, on)
    expect(drawn.terminal).toBeUndefined()
    expect(drawn.desktop).toBeUndefined()
  })

  test('draws nothing when no gate brief is open', async ($: any, on: any) => {
    beneath(on, { [POINTER]: pointer, [STATUS]: status(FROZEN) })
    const drawn = await askAndDraw($, on)
    expect(drawn.terminal).toBeUndefined()
  })
})
