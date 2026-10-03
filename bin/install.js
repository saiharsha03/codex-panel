#!/usr/bin/env node
// npx claude-codex-panel: adds this repo as a Claude Code plugin marketplace and installs the mod.
const { spawnSync } = require('node:child_process')

const REPO = 'saiharsha03/codex-panel'
const run = args => {
  console.log(`> claude ${args.join(' ')}`)
  const r = spawnSync('claude', args, { stdio: 'inherit', shell: process.platform === 'win32' })
  return r.status === 0
}

if (spawnSync('claude', ['--version'], { shell: process.platform === 'win32' }).status !== 0) {
  console.error('Claude Code (the `claude` command) was not found. Install it first: https://claude.com/claude-code')
  process.exit(1)
}
if (spawnSync('codex', ['--version'], { shell: process.platform === 'win32' }).status !== 0)
  console.warn('Note: the Codex CLI (`codex`) was not found on PATH. Install it and run `codex login` before using the panel.')

// adding a marketplace that is already there fails harmlessly; update it instead
if (!run(['plugin', 'marketplace', 'add', REPO])) run(['plugin', 'marketplace', 'update', 'codex-panel'])
if (!run(['plugin', 'install', 'codex-panel@codex-panel'])) process.exit(1)
console.log('\nInstalled. In Claude Code run /reload-plugins (or restart), then /codex opens the panel.')
