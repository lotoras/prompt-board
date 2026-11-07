// Run the dev build in an isolated data profile next to the everyday app.
//
// - userData: %APPDATA%\prompt-board-<profile> (own single-instance lock, own data)
// - seeded once from the real profile with boards / projects / acks only:
//   no sync*.json (the copy can never push to Supabase) and no terminals.json
//   (never resume the same sessions twice)
// - CDP on ELECTRON_REMOTE_DEBUG_PORT (default 9223) for `npm run smoke:isolated`
//
// Usage: node scripts/dev-isolated.mjs [--profile t3] [--reseed]
import { spawn } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'

const args = process.argv.slice(2)
const flag = (name) => args.includes(name)
const value = (name, fallback) => {
  const i = args.indexOf(name)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

const profile = value('--profile', process.env.PROMPT_BOARD_PROFILE || 't3')
const port = process.env.ELECTRON_REMOTE_DEBUG_PORT || '9223'
const appData = process.env.APPDATA
if (!appData) {
  console.error('APPDATA is not set')
  process.exit(1)
}

const source = join(appData, 'prompt-board')
const target = join(appData, `prompt-board-${profile}`)
const SEED_FILES = ['boards.json', 'projects.json', 'sessionAcks.json']

mkdirSync(target, { recursive: true })
for (const file of SEED_FILES) {
  const from = join(source, file)
  const to = join(target, file)
  if (!existsSync(from)) continue
  if (existsSync(to) && !flag('--reseed')) continue
  copyFileSync(from, to)
  console.log(`[dev-isolated] seeded ${file}`)
}
console.log(`[dev-isolated] profile "${profile}" -> ${target} (CDP ${port})`)

const child = spawn('npx', ['electron-vite', 'dev'], {
  stdio: 'inherit',
  shell: true,
  env: { ...process.env, PROMPT_BOARD_PROFILE: profile, ELECTRON_REMOTE_DEBUG_PORT: port }
})
child.on('exit', (code) => process.exit(code ?? 0))
