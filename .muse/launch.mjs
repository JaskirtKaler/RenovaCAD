import { existsSync, mkdirSync, readFileSync, realpathSync } from 'node:fs'
import { dirname, isAbsolute, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseEnv } from 'node:util'

const efforts = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'ultra'])
const inheritedVariables = /^(PATH|HOME|USER|LOGNAME|SHELL|TERM|COLORTERM|TERM_PROGRAM|TERM_PROGRAM_VERSION|LANG|LC_.*|TZ|NO_COLOR|FORCE_COLOR|SSL_CERT_FILE|SSL_CERT_DIR|HTTPS?_PROXY|ALL_PROXY|NO_PROXY|https?_proxy|all_proxy|no_proxy)$/

function assertLocal(root, path) {
  let ancestor = resolve(path)
  while (!existsSync(ancestor)) ancestor = dirname(ancestor)
  const remainder = relative(root, realpathSync(ancestor))
  if (remainder === '..' || remainder.startsWith(`..${process.platform === 'win32' ? '\\' : '/'}`) || isAbsolute(remainder)) {
    throw new Error('A Muse project path resolves outside this repository. Remove the external symlink before starting.')
  }
}

export function buildLaunchSpec({ root, executable, settings, environment = process.env }) {
  const key = settings.META_API_KEY?.trim()
  const model = settings.MUSE_MODEL?.trim() || 'muse-spark-1.2'
  const effort = settings.MUSE_REASONING_EFFORT?.trim() || 'high'
  if (!/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(model)) throw new Error('MUSE_MODEL must be a model ID.')
  if (!efforts.has(effort)) throw new Error('MUSE_REASONING_EFFORT is not supported.')
  const state = join(root, '.muse', 'runtime')
  const scratch = join(root, '.agent-runtime')
  const env = Object.fromEntries(Object.entries(environment).filter(([name, value]) => inheritedVariables.test(name) && value !== undefined))
  Object.assign(env, {
    META_API_KEY: key || '',
    XDG_CONFIG_HOME: join(state, 'config'),
    XDG_DATA_HOME: join(state, 'data'),
    XDG_CACHE_HOME: join(scratch, 'cache'),
    TMPDIR: join(scratch, 'tmp'),
    TMP: join(scratch, 'tmp'),
    TEMP: join(scratch, 'tmp'),
    BUN_INSTALL_CACHE_DIR: join(scratch, 'cache', 'bun'),
    PIP_CACHE_DIR: join(scratch, 'cache', 'pip'),
    GOCACHE: join(scratch, 'cache', 'go-build'),
    GOMODCACHE: join(scratch, 'cache', 'go-mod'),
    GOTMPDIR: join(scratch, 'tmp', 'go'),
    ELECTRON_CACHE: join(scratch, 'cache', 'electron'),
    PYTHONDONTWRITEBYTECODE: '1',
    PYTHONNOUSERSITE: '1',
    MUSE_NO_AUTO_UPDATE: '1',
    MUSE_LOGIN: '0',
  })
  return {
    executable,
    cwd: root,
    env,
    args: [
      '--workspace', root,
      '--permission-profile', ':ask-me',
      '--contributor-mode', 'off',
      '--model', model,
      '--reasoning-effort', effort,
    ],
  }
}

export function prepareLaunch(root, environment = process.env) {
  root = realpathSync(root)
  const envPath = join(root, '.env')
  assertLocal(root, envPath)
  const fileSettings = existsSync(envPath) ? parseEnv(readFileSync(envPath, 'utf8')) : {}
  const settings = Object.fromEntries(['META_API_KEY', 'MUSE_MODEL', 'MUSE_REASONING_EFFORT'].map((name) => [name, environment[name] ?? fileSettings[name]]))
  const localMuse = join(root, '.muse', 'bin', 'muse')
  assertLocal(root, localMuse)
  const executable = existsSync(localMuse) ? localMuse : Bun.which('muse', { PATH: environment.PATH })
  const spec = buildLaunchSpec({ root, executable, settings, environment })
  for (const path of [
    spec.env.XDG_CONFIG_HOME, spec.env.XDG_DATA_HOME, spec.env.XDG_CACHE_HOME,
    spec.env.TMPDIR, spec.env.BUN_INSTALL_CACHE_DIR, spec.env.PIP_CACHE_DIR,
    spec.env.GOCACHE, spec.env.GOMODCACHE, spec.env.GOTMPDIR, spec.env.ELECTRON_CACHE,
    join(spec.env.XDG_CONFIG_HOME, 'muse'), join(spec.env.XDG_DATA_HOME, 'muse'),
    join(spec.env.XDG_CACHE_HOME, 'muse'),
  ]) {
    assertLocal(root, path)
    mkdirSync(path, { recursive: true, mode: 0o700 })
  }
  return spec
}

export function checkPrerequisites(spec) {
  const problems = []
  if (Bun.version !== '1.3.8') problems.push('Use Bun 1.3.8 for this project.')
  if (!spec.env.META_API_KEY) problems.push('Add META_API_KEY to the project .env file.')
  if (!spec.executable) problems.push('Muse Code is not installed. See docs/muse-agent.md for project-local installation.')
  const conda = Bun.which('conda', { PATH: spec.env.PATH })
  if (!conda) {
    problems.push('Conda is not on PATH. The existing musedev environment is required.')
  } else {
    const result = Bun.spawnSync([conda, 'run', '-n', 'musedev', 'python', '-B', '-c', 'import os, sys; sys.exit(0 if os.path.basename(sys.prefix) == "musedev" else 1)'], {
      cwd: spec.cwd,
      env: spec.env,
      stdout: 'pipe',
      stderr: 'pipe',
    })
    if (result.exitCode !== 0) problems.push('The existing musedev Conda environment is unavailable. No environment was created or changed.')
  }
  return problems
}

export function syncCommandPermissions(spec) {
  const helper = join(spec.cwd, '.muse', 'sync-permissions.py')
  assertLocal(spec.cwd, helper)
  const conda = Bun.which('conda', { PATH: spec.env.PATH })
  if (!conda || Bun.version !== '1.3.8') throw new Error('Bun 1.3.8 and musedev are required to synchronize permissions.')
  const result = Bun.spawnSync([conda, 'run', '-n', 'musedev', 'python', '-B', helper], {
    cwd: spec.cwd, env: { ...spec.env, META_API_KEY: '' }, stdout: 'pipe', stderr: 'pipe',
  })
  if (result.exitCode !== 0) throw new Error('Muse project permissions could not be synchronized.')
}

export async function main(args = process.argv.slice(2)) {
  if (args.length > 1 || (args.length === 1 && !['--check', '--permissions'].includes(args[0]))) {
    console.error('Use bun run muse, bun run muse:check, or bun run muse:permissions. Additional Muse flags are not accepted.')
    return 1
  }
  try {
    const root = realpathSync(resolve(dirname(fileURLToPath(import.meta.url)), '..'))
    const spec = prepareLaunch(root)
    if (args[0] === '--permissions') {
      syncCommandPermissions(spec)
      console.log('Project development command permissions synchronized. The sandbox and human approvals remain enabled. No API request was made.')
      return 0
    }
    const problems = checkPrerequisites(spec)
    if (problems.length) {
      for (const problem of problems) console.error(problem)
      return 1
    }
    if (args[0] === '--check') {
      console.log('Muse is ready. Bun 1.3.8, musedev, API key presence, and CLI presence checked. No API request was made.')
      return 0
    }
    syncCommandPermissions(spec)
    const child = Bun.spawn([spec.executable, ...spec.args], {
      cwd: spec.cwd,
      env: spec.env,
      stdin: 'inherit',
      stdout: 'inherit',
      stderr: 'inherit',
    })
    return await child.exited
  } catch {
    console.error('Muse could not start. Check local settings, project paths, permission storage, and installation. No credential values are printed.')
    return 1
  }
}

if (import.meta.main) process.exitCode = await main()
