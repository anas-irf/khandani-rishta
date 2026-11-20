// Starts the local development environment: PostgreSQL (Docker), the Rust API and the web app.
//
//   pnpm bootstrap
//
// - Creates missing env files from their templates.
// - Installs JavaScript dependencies when the lockfile has changed.
// - Starts PostgreSQL from infra/local/docker-compose.yml. It keeps running afterwards;
//   stop it with `pnpm db:stop`. Creates the database named in apps/api/.env if it's missing.
// - Runs the API with cargo, or inside the rust Docker image when Rust (or, on Windows, the
//   Visual Studio C++ Build Tools) isn't installed, and restarts it whenever its code,
//   migrations or .env change.
// - Runs the web dev server, which reloads the browser on its own.
//
// Ctrl+C stops the API and the web app.

import { spawn, spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, statSync, utimesSync, watch } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, relative, sep } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

const root = fileURLToPath(new URL('..', import.meta.url)).replace(/[\\/]$/, '')
const apiDir = join(root, 'apps', 'api')
const webDir = join(root, 'apps', 'web')
const composeFile = join(root, 'infra', 'local', 'docker-compose.yml')
const isWindows = process.platform === 'win32'
const apiContainer = 'khandani-api-dev'
const webUrl = 'http://localhost:3000'

const useColor = Boolean(process.stdout.isTTY) && !process.env.NO_COLOR
const paint = (code, text) => (useColor ? `\x1b[${code}m${text}\x1b[0m` : text)
const say = (message) => console.log(`${paint('1;32', '>')} ${message}`)
const fail = (message) => {
  console.error(`${paint('1;31', 'x')} ${message}`)
  process.exit(1)
}
const show = (path) => relative(root, path).split(sep).join('/')

// A bare `pnpm` can be a .cmd shim on Windows, which Node can only start through a shell.
const needsShell = (command) => isWindows && command === 'pnpm'

/** Runs pnpm through the same binary that started this script, so no shell shim is involved. */
function pnpmInvocation(args) {
  const entry = process.env.npm_execpath ?? ''
  if (/pnpm[^\\/]*$/i.test(entry)) {
    return /\.[cm]?js$/i.test(entry) ? [process.execPath, [entry, ...args]] : [entry, args]
  }
  return ['pnpm', args]
}

function commandWorks(command, args) {
  return spawnSync(command, args, { stdio: 'ignore', timeout: 30_000 }).status === 0
}

function runOrFail(command, args) {
  const result = needsShell(command)
    ? spawnSync(`${command} ${args.join(' ')}`, { cwd: root, stdio: 'inherit', shell: true })
    : spawnSync(command, args, { cwd: root, stdio: 'inherit' })
  if (result.status !== 0) fail(`\`${command} ${args.join(' ')}\` failed.`)
}

function ensureEnvFile(dir, name) {
  const file = join(dir, name)
  if (existsSync(file)) return
  copyFileSync(join(dir, '.env.example'), file)
  say(`Created ${show(file)} from .env.example`)
}

function ensureDependencies() {
  const installed = join(root, 'node_modules', '.pnpm', 'lock.yaml')
  const lockfile = join(root, 'pnpm-lock.yaml')
  if (existsSync(installed) && statSync(installed).mtimeMs >= statSync(lockfile).mtimeMs) return
  say('Installing JavaScript dependencies...')
  runOrFail(...pnpmInvocation(['install']))
  // pnpm leaves this file alone when nothing changed; touch it so the next run skips the install.
  if (existsSync(installed)) utimesSync(installed, new Date(), new Date())
}

/** Runs Vite with Node directly. Going through pnpm and the .bin shims adds a cmd.exe batch
 * file on Windows, which prints "Terminate batch job (Y/N)?" on Ctrl+C. */
function viteInvocation(args) {
  const require = createRequire(join(webDir, 'package.json'))
  const manifest = require.resolve('vite/package.json')
  const { bin } = JSON.parse(readFileSync(manifest, 'utf8'))
  return [
    process.execPath,
    [join(dirname(manifest), typeof bin === 'string' ? bin : bin.vite), ...args],
  ]
}

function ensureDocker() {
  if (!commandWorks('docker', ['--version'])) {
    fail('Docker is not installed. Install Docker Desktop: https://docs.docker.com/desktop/')
  }
  if (commandWorks('docker', ['info'])) return
  say('Docker is not running. Starting Docker Desktop...')
  spawnSync('docker', ['desktop', 'start'], { stdio: 'inherit', timeout: 180_000 })
  if (!commandWorks('docker', ['info'])) {
    fail('Docker is still not running. Start Docker Desktop, then run `pnpm bootstrap` again.')
  }
}

function readApiEnv() {
  return parseEnv(readFileSync(join(apiDir, '.env'), 'utf8'))
}

function apiPort() {
  return (readApiEnv().BIND_ADDR ?? '127.0.0.1:8787').split(':').pop()
}

/**
 * Creates the database that apps/api/.env points at when it's on the Compose server and doesn't
 * exist yet. A checkout whose branch has different migrations (for example a git worktree) needs
 * its own database: the API refuses to start on a database with migrations it doesn't have.
 */
function ensureDatabase() {
  const { DATABASE_URL } = readApiEnv()
  if (!DATABASE_URL) return
  const url = new URL(DATABASE_URL)
  const compose = ['compose', '-f', composeFile]
  const published = spawnSync('docker', [...compose, 'port', 'postgres', '5432'], {
    encoding: 'utf8',
  })
  const composePort = (published.stdout ?? '').trim().split(':').pop()
  if (!['localhost', '127.0.0.1'].includes(url.hostname) || url.port !== composePort) return

  const name = decodeURIComponent(url.pathname.slice(1))
  const user = decodeURIComponent(url.username)
  const exec = [...compose, 'exec', '-T', 'postgres']
  // Sent on stdin, because psql only fills in :'name' there, not in a -c command.
  const found = spawnSync(
    'docker',
    [...exec, 'psql', '-U', user, '-d', 'postgres', '-tA', '-v', `name=${name}`],
    {
      input: "select 1 from pg_database where datname = :'name'",
      encoding: 'utf8',
    },
  )
  if (found.status !== 0) fail(`Could not look up the ${name} database: ${found.stderr.trim()}`)
  if (found.stdout.trim() === '1') return
  say(`Creating the ${name} database...`)
  runOrFail('docker', [...exec, 'createdb', '-U', user, name])
}

/** Starts a long-running process and prefixes each line of its output with its name. */
function launch(name, color, command, args, options) {
  const settings = {
    ...options,
    stdio: ['ignore', 'pipe', 'pipe'],
    // Elsewhere, give each process its own process group so the whole tree can be stopped.
    detached: !isWindows,
  }
  const child = needsShell(command)
    ? spawn(`${command} ${args.join(' ')}`, { ...settings, shell: true })
    : spawn(command, args, settings)
  const label = paint(color, `[${name}]`)
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on('line', (line) => console.log(`${label} ${line}`))
  }
  child.on('error', (error) => console.error(`${label} ${error.message}`))
  return child
}

/** Stops a process started with `launch`, including everything it started. */
function stop(child) {
  return new Promise((resolve) => {
    if (!child || child.exitCode !== null || child.signalCode !== null) {
      resolve()
      return
    }
    const timer = setTimeout(resolve, 10_000)
    child.once('exit', () => {
      clearTimeout(timer)
      resolve()
    })
    if (isWindows) {
      spawnSync('taskkill', ['/pid', String(child.pid), '/T', '/F'], { stdio: 'ignore' })
    } else {
      try {
        process.kill(-child.pid, 'SIGTERM')
      } catch {
        // The process group is already gone.
      }
    }
  })
}

function hasMsvcBuildTools() {
  const programFiles = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)'
  const vswhere = join(programFiles, 'Microsoft Visual Studio', 'Installer', 'vswhere.exe')
  if (!existsSync(vswhere)) return false
  const result = spawnSync(
    vswhere,
    [
      '-latest',
      '-products',
      '*',
      '-requires',
      'Microsoft.VisualStudio.Component.VC.Tools.x86.x64',
      '-property',
      'installationPath',
    ],
    { encoding: 'utf8' },
  )
  return result.status === 0 && result.stdout.trim() !== ''
}

/** Why the API can't be built with a local Rust toolchain, or null when it can. */
function whyNoNativeRust() {
  if (!commandWorks('rustup', ['--version']) && !commandWorks('cargo', ['--version'])) {
    return "Rust isn't installed"
  }
  const rustc = spawnSync('rustc', ['-vV'], { encoding: 'utf8' })
  const host = /host: (\S+)/.exec(rustc.stdout ?? '')?.[1] ?? ''
  if (isWindows && host.endsWith('msvc') && !hasMsvcBuildTools()) {
    return "the Visual Studio C++ Build Tools that Rust needs on Windows aren't installed"
  }
  return null
}

const noNativeRustReason = whyNoNativeRust()
const useNativeRust = noNativeRustReason === null

function spawnApi() {
  const colorEnv = useColor ? { CARGO_TERM_COLOR: 'always' } : {}
  if (useNativeRust) {
    return launch('api', '36', 'cargo', ['run'], {
      cwd: apiDir,
      env: { ...process.env, ...colorEnv },
    })
  }

  // No Rust on this machine: build and run the API in the rust image pinned by rust-toolchain.toml.
  spawnSync('docker', ['rm', '-f', apiContainer], { stdio: 'ignore' })
  const toolchain = readFileSync(join(apiDir, 'rust-toolchain.toml'), 'utf8')
  const channel = /channel\s*=\s*"([^"]+)"/.exec(toolchain)?.[1]
  if (!channel) throw new Error('apps/api/rust-toolchain.toml has no channel')
  const port = apiPort()
  // Inside the container, "localhost" is the container itself, so reach the database via the host.
  const databaseUrl = new URL(readApiEnv().DATABASE_URL)
  if (['localhost', '127.0.0.1'].includes(databaseUrl.hostname)) {
    databaseUrl.hostname = 'host.docker.internal'
  }
  const env = {
    RUSTUP_TOOLCHAIN: channel,
    BIND_ADDR: `0.0.0.0:${port}`,
    DATABASE_URL: String(databaseUrl),
    ...colorEnv,
  }
  return launch(
    'api',
    '36',
    'docker',
    [
      'run',
      '--rm',
      '--name',
      apiContainer,
      '--add-host=host.docker.internal:host-gateway',
      '-p',
      `127.0.0.1:${port}:${port}`,
      '-v',
      `${root}:/repo`,
      '-v',
      'khandani-cargo-registry:/usr/local/cargo/registry',
      '-v',
      'khandani-api-target:/repo/apps/api/target',
      '-w',
      '/repo/apps/api',
      ...Object.entries(env).flatMap(([key, value]) => ['-e', `${key}=${value}`]),
      `rust:${channel}`,
      'cargo',
      'run',
    ],
    { cwd: root },
  )
}

let api
let web
let shuttingDown = false
let restarting = false
let restartQueued = false
let restartTimer

// On Windows, Ctrl+C also reaches the child processes. Give our own SIGINT handler a moment
// to run first, so a normal Ctrl+C isn't reported as a crash.
const afterGrace = (callback) =>
  setTimeout(() => {
    if (!shuttingDown) callback()
  }, 500)

async function stopApi() {
  if (!useNativeRust) spawnSync('docker', ['rm', '-f', apiContainer], { stdio: 'ignore' })
  await stop(api)
}

function startApi() {
  let child
  try {
    child = spawnApi()
  } catch (error) {
    // For example while a branch switch has removed files. Wait for the next change.
    api = undefined
    say(
      `Could not start the API (${error.message}). It restarts when you save a change in apps/api.`,
    )
    return
  }
  api = child
  child.on('exit', (code) => {
    afterGrace(() => {
      if (restarting || child !== api) return
      say(`The API stopped (exit code ${code}). It restarts when you save a change in apps/api.`)
    })
  })
}

async function restartApi() {
  if (shuttingDown) return
  if (restarting) {
    restartQueued = true
    return
  }
  restarting = true
  say('API code changed, restarting the API...')
  try {
    await stopApi()
  } finally {
    restarting = false
  }
  if (shuttingDown) return
  startApi()
  if (restartQueued) {
    restartQueued = false
    restartApi()
  }
}

/** Restarts the API when its Rust code, migrations, manifest or .env change. */
function watchApi() {
  const files = new Set(['Cargo.toml', 'Cargo.lock', 'build.rs', '.env'])
  watch(apiDir, { recursive: true }, (_event, filename) => {
    if (!filename || shuttingDown) return
    const path = filename.split(sep).join('/')
    const relevant =
      files.has(path) ||
      (path.startsWith('src/') && path.endsWith('.rs')) ||
      (path.startsWith('migrations/') && path.endsWith('.sql'))
    if (!relevant) return
    clearTimeout(restartTimer)
    restartTimer = setTimeout(restartApi, 300)
  })
}

async function shutdown(code) {
  if (shuttingDown) return
  shuttingDown = true
  clearTimeout(restartTimer)
  say('Stopping the API and the web app...')
  await Promise.all([stopApi(), stop(web)])
  say('Stopped. PostgreSQL is still running; stop it with `pnpm db:stop`.')
  process.exit(code)
}

ensureEnvFile(apiDir, '.env')
ensureEnvFile(webDir, '.env.local')
ensureDependencies()
ensureDocker()

say('Starting PostgreSQL...')
runOrFail('docker', ['compose', '-f', composeFile, 'up', '-d', '--wait'])
ensureDatabase()

if (!useNativeRust) {
  const guide = noNativeRustReason.startsWith('the Visual Studio')
    ? 'https://rust-lang.github.io/rustup/installation/windows-msvc.html'
    : 'https://rustup.rs'
  say(`The API runs in Docker because ${noNativeRustReason}. For faster builds, see ${guide}`)
}

process.on('SIGINT', () => shutdown(0))
process.on('SIGTERM', () => shutdown(0))

// Never exit on an unexpected error without stopping the API and the web app first.
for (const event of ['uncaughtException', 'unhandledRejection']) {
  process.on(event, (error) => {
    console.error(`${paint('1;31', 'x')} ${error?.stack ?? error}`)
    shutdown(1)
  })
}

startApi()
watchApi()
web = launch('web', '35', ...viteInvocation(['dev']), {
  cwd: webDir,
  env: useColor ? { ...process.env, FORCE_COLOR: '1' } : process.env,
})
web.on('exit', (code) => {
  afterGrace(() => {
    say(`The web app stopped (exit code ${code}).`)
    shutdown(code || 1)
  })
})

say(`Web app: ${webUrl}   API: http://localhost:${apiPort()}/healthz   Press Ctrl+C to stop.`)
