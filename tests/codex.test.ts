import { expect, mock, test } from 'claude-code/testing'

// A fake Codex: each run is one JSONL stream; what it was sent is kept.
const NOW = Date.UTC(2026, 9, 3, 16, 0)
const world = { inputs: [] as string[], argv: [] as string[][], prompts: [] as string[], reply: 'Looks fine.', installed: true, signedIn: true, writerBusy: 0 }

const boot = (on: any) => {
  const clock = mock.clock(on, { now: NOW })
  mock.env(on, { USERPROFILE: 'C:/Users/x' })
  mock.store(on, {})
  on('command.register', async () => ({ value: {} }) as any)
  on('tool.register', async () => ({ value: { tool: 'mcp__codex-panel__codex' } }) as any)
  on('ui.open', async () => ({ value: { isPlaced: true } }) as any)
  on('session.start', async () => ({ cwd: 'C:/work/repo' }) as any)
  on('session.id', async () => ({ value: 'sess-1' }) as any)
  on('turn.start', async () => ({ turnId: 't' }) as any)
  on('turn.complete', async () => ({ text: '' }) as any)
  on('prompt.submit', async (_$: any, e: any) => {
    world.prompts.push(e.text)
    return { text: e.text } as any
  })
  on('tool.call', async () => ({ ref: 'r', result: { stdout: 'ok', stderr: '', interrupted: false }, text: 'ok', isError: false }) as any)
  on('fs.read', async (_$: any, e: any) => {
    const p = String(e?.path ?? e).replace(/\\/g, '/')
    if (p.endsWith('models_cache.json')) return { value: '{"models":[{"slug":"gpt-6.1-sol"},{"slug":"gpt-6-astra"}]}' } as any
    throw new Error('ENOENT: ' + p)
  })
  on('process.run', async (_$: any, e: any) => {
    const key = (e.argv ?? []).slice(1).join(' ')
    if (key === '--version') return world.installed ? ({ value: { exitCode: 0, stdout: 'codex-cli 0.160.0\n', stderr: '' } } as any) : ({ value: { exitCode: 1, stdout: '', stderr: 'not found' } } as any)
    if (key === 'login status') return world.signedIn ? ({ value: { exitCode: 0, stdout: 'Logged in using ChatGPT\n', stderr: '' } } as any) : ({ value: { exitCode: 1, stdout: 'Not logged in\n', stderr: '' } } as any)
    return { value: { exitCode: 0, stdout: '', stderr: '' } } as any
  })
  on('process.spawn', async function* (_$: any, e: any) {
    world.argv.push([...e.argv])
    world.inputs.push(String(e.input ?? ''))
    if (world.writerBusy > 0) {
      world.writerBusy -= 1
      yield { stream: 'stdout', text: '{"type":"error","message":"thread/resume: thread/resume failed: thread th-1 already has an active writer (code -32600)"}\n' }
      return { value: { code: 1, signal: null } }
    }
    yield { stream: 'stdout', text: '{"type":"thread.started","thread_id":"th-1"}\n{"type":"item.started","item":{"id":"c1","type":"command_execution","command":"git diff"}}\n' }
    yield { stream: 'stdout', text: `{"type":"item.completed","item":{"id":"c1","type":"command_execution","command":"git diff","exit_code":0}}\n{"type":"item.completed","item":{"id":"m1","type":"agent_message","text":${JSON.stringify(world.reply)}}}\n` }
    return { value: { code: 0, signal: null } }
  })
  return clock
}

const PANE = { plugin: 'codex-panel', surface: 'terminal', component: 'Pane', requestId: 'codex', props: { title: 'Codex', isFocused: false, bodyColumns: 48, placement: 'dock', scroll: { offset: 0, bodyRows: 60 } } } as const
const text = async (ui: any) => (await ui.findAll({ type: 'Text' })).map((t: any) => t.text ?? '').join('')

test('Claude asks Codex through the tool; Codex sees what Claude did, and the panel shows the thread', async ($, on) => {
  boot(on)
  await $.session.start({ cwd: 'C:/work/repo' } as any)
  await $.turn.start({ turnId: 't1', text: 'fix the avg bug' } as any)
  await $.tool.call({ tool: 'Bash', command: 'make test' } as any)
  const r: any = await $.tool.call({ tool: 'mcp__codex-panel__codex', message: 'review my fix', wait: true } as any)
  expect(JSON.stringify(r)).toContain('Looks fine.')
  const sent = world.inputs[0]!
  for (const want of ['You are Codex', 'developer: fix the avg bug', 'Claude ran: make test', 'sess-1.jsonl', '[from Claude] review my fix']) expect(sent).toContain(want)
  const ui = await $.ui.mount(PANE as any)
  await ui.press({ key: 'settings' } as any)
  const shown = await text(ui)
  expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.props?.label)).toContain('▾ ⚙ Default · Low · Read-only')
  for (const want of ['thread th-1', 'review my fix', '✓ git diff', 'Looks fine.']) expect(shown).toContain(want)
})

test('a panel message resumes the thread, and "@claude:" in the reply reaches Claude', async ($, on) => {
  boot(on)
  world.reply = 'Found a gap.\n@claude: add a test for an empty list'
  await $.session.start({ cwd: 'C:/work/repo' } as any)
  const ui = await $.ui.mount(PANE as any)
  await ui.input({ key: 'input', text: 'what is left?' } as any)
  expect(world.argv.at(-1)).not.toContain('resume')
  expect(world.prompts.filter(p => p.includes('add a test for an empty list')).length).toBe(1)
  await ui.input({ key: 'input', text: 'and then?' } as any)
  expect(world.argv.at(-1)).toEqual(expect.arrayContaining(['resume', 'th-1']))
  expect(world.prompts.some(p => p.includes('add a test for an empty list'))).toBe(true)
  // one forward per reply that asks: two panel messages, two forwards, never more
  expect(world.prompts.filter(p => p.includes('add a test for an empty list')).length).toBe(2)
  expect(await text(ui)).toContain('→ Claude delivered: add a test for an empty list')
})

test('yolo access runs Codex with no sandbox and says so', async ($, on) => {
  boot(on)
  await $.session.start({ cwd: 'C:/work/repo' } as any)
  const ui = await $.ui.mount(PANE as any)
  await ui.press({ key: 'settings' } as any)
  await ui.select({ key: 'sandbox', value: 'danger-full-access' } as any)
  expect(await text(ui)).toContain('YOLO: Codex runs with no sandbox')
  await ui.input({ key: 'input', text: 'go' } as any)
  expect(world.argv.at(-1)).toContain('sandbox_mode="danger-full-access"')
})

test('without Codex installed or signed in, the panel says how to fix it and sends nothing', async ($, on) => {
  boot(on)
  world.installed = false
  await $.session.start({ cwd: 'C:/work/repo' } as any)
  let ui = await $.ui.mount(PANE as any)
  expect(await text(ui)).toContain('npm i -g @openai/codex')
  world.installed = true
  world.signedIn = false
  await ui.press({ key: 'recheck' } as any)
  expect(await text(ui)).toContain('not signed in')
  expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.props?.label)).toContain('→ Sign in')
  const before = world.argv.length
  await ui.input({ key: 'input', text: 'hello' } as any)
  expect(world.argv.length).toBe(before)
  world.signedIn = true
})

test('keys in what Claude ran never reach Codex: JSON keys, Bearer headers, quoted passwords', async ($, on) => {
  boot(on)
  world.reply = 'ok'
  await $.session.start({ cwd: 'C:/work/repo' } as any)
  await $.tool.call({ tool: 'Bash', command: `curl -H "Authorization: Bearer abc123def456ghi789" -d '{"api_key": "plainsecretvalue99"}' --pw "correct horse battery"` } as any)
  await $.tool.call({ tool: 'mcp__codex-panel__codex', message: 'check', wait: true } as any)
  const sent = world.inputs.at(-1)!
  for (const leak of ['abc123def456ghi789', 'plainsecretvalue99']) expect(sent).not.toContain(leak)
  expect(sent).toContain('Claude ran: curl')
})

test('two messages at once both go through, in order, in the same thread', async ($, on) => {
  boot(on)
  world.reply = 'done'
  await $.session.start({ cwd: 'C:/work/repo' } as any)
  const before = world.argv.length
  const [a, b]: any[] = await Promise.all([
    $.tool.call({ tool: 'mcp__codex-panel__codex', message: 'first', wait: true } as any),
    $.tool.call({ tool: 'mcp__codex-panel__codex', message: 'second', wait: true } as any),
  ])
  expect(JSON.stringify(a)).toContain('done')
  expect(JSON.stringify(b)).toContain('done')
  expect(world.argv.length).toBe(before + 2)
  expect(world.inputs.at(-2)).toContain('first')
  expect(world.inputs.at(-1)).toContain('second')
})

test('the folder shows its full path on press', async ($, on) => {
  boot(on)
  await $.session.start({ cwd: 'C:/work/repo' } as any)
  const ui = await $.ui.mount(PANE as any)
  expect(await text(ui)).not.toContain('C:/work/repo')
  await ui.press({ key: 'folder' } as any)
  expect(await text(ui)).toContain('C:/work/repo')
})

test('a long draft shows wrapped above the one-line composer while typing', async ($, on) => {
  boot(on)
  await $.session.start({ cwd: 'C:/work/repo' } as any)
  const ui = await $.ui.mount(PANE as any)
  const long = 'please review the queue logic and the redaction rules and tell me what could still leak to you'
  await ui.input({ key: 'input', text: long, kind: 'change' } as any)
  expect(await text(ui)).toContain(long)
})

test('a thread still held by a cut-off run is retried, not shown as an error', async ($, on) => {
  const clock = boot(on)
  world.reply = 'after the wait'
  world.writerBusy = 1
  await $.session.start({ cwd: 'C:/work/repo' } as any)
  const call = $.tool.call({ tool: 'mcp__codex-panel__codex', message: 'retry me', wait: true } as any)
  for (let i = 0; i < 5; i++) await clock.advance(1000)
  expect(JSON.stringify(await call)).toContain('after the wait')
  const shown = await text(await $.ui.mount(PANE as any))
  expect(shown).not.toContain('active writer')
  expect(shown).toContain('✓ waiting for the previous Codex run')
})

test("Claude's messages run Codex read-only even when the panel is set to YOLO", async ($, on) => {
  boot(on)
  await $.session.start({ cwd: 'C:/work/repo' } as any)
  const ui = await $.ui.mount(PANE as any)
  await ui.press({ key: 'settings' } as any)
  await ui.select({ key: 'sandbox', value: 'danger-full-access' } as any)
  await $.tool.call({ tool: 'mcp__codex-panel__codex', message: 'from claude', wait: true } as any)
  expect(world.argv.at(-1)).toContain('sandbox_mode="read-only"')
  await ui.input({ key: 'input', text: 'from me' } as any)
  expect(world.argv.at(-1)).toContain('sandbox_mode="danger-full-access"')
  await ui.select({ key: 'sandbox', value: 'read-only' } as any)
})

test("by default Claude's message returns at once and Codex's reply wakes Claude as a prompt", async ($, on) => {
  const clock = boot(on)
  world.reply = 'async answer'
  await $.session.start({ cwd: 'C:/work/repo' } as any)
  const before = world.prompts.length
  const r: any = await $.tool.call({ tool: 'mcp__codex-panel__codex', message: 'look later' } as any)
  expect(JSON.stringify(r)).toContain('Sent to Codex')
  expect(JSON.stringify(r)).not.toContain('async answer')
  for (let i = 0; i < 3; i++) await clock.advance(100)
  const woke = world.prompts.slice(before).filter(p => p.includes('async answer'))
  expect(woke.length).toBe(1)
  expect(woke[0]).toContain('answering your codex message "look later"')
})
