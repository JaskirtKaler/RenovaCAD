import { afterEach, expect, test } from 'bun:test'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildLaunchSpec, main, prepareLaunch } from './launch.mjs'

const fixtures = []
const projectRoot = realpathSync(fileURLToPath(new URL('..', import.meta.url)))
const testRuntime = join(projectRoot, '.agent-runtime', 'permission-tests')
mkdirSync(testRuntime, { recursive: true })
const realConda = Bun.which('conda')
afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true })
})

function fixture() {
  const root = realpathSync(mkdtempSync(join(testRuntime, 'fixture-')))
  fixtures.push(root)
  mkdirSync(join(root, '.muse', 'bin'), { recursive: true })
  for (const file of ['launch.mjs', 'sync-permissions.py', 'dev-commands.json']) cpSync(fileURLToPath(new URL(file, import.meta.url)), join(root, '.muse', file))
  writeFileSync(join(root, '.env'), 'META_API_KEY=fixture-secret\nMUSE_REASONING_EFFORT=medium\n')
  return root
}

function stub(root, name, body) {
  const path = join(root, '.muse', 'bin', name)
  writeFileSync(path, `#!${process.execPath}\n${body}\n`)
  chmodSync(path, 0o755)
  return path
}

function run(root, args = [], overrides = {}) {
  return Bun.spawnSync([process.execPath, '--no-env-file', join(root, '.muse', 'launch.mjs'), ...args], {
    cwd: dirname(root),
    env: { HOME: process.env.HOME, PATH: `${join(root, '.muse', 'bin')}:${dirname(process.execPath)}:/usr/bin:/bin`, ...overrides },
    stdout: 'pipe',
    stderr: 'pipe',
  })
}

test('the real launcher fixes the workspace, prompts, and child environment from another directory', () => {
  const root = fixture()
  stub(root, 'conda', 'process.exit(0)')
  stub(root, 'muse', 'await Bun.write("launch-observation.json", JSON.stringify({ args: process.argv.slice(2), cwd: process.cwd(), env: process.env }))')
  const result = run(root, [], { MUSE_PERMISSION_PROFILE_FAIL_OPEN: '1', MUSE_AUTH_PATH: '/outside/auth', NODE_OPTIONS: '--trace-warnings', UNRELATED_SECRET: 'must-not-forward', GOCACHE: '/outside/go-build', GOMODCACHE: '/outside/go-mod', GOTMPDIR: '/outside/go-tmp', ELECTRON_CACHE: '/outside/electron' })
  expect(result.exitCode).toBe(0)
  const actual = JSON.parse(readFileSync(join(root, 'launch-observation.json'), 'utf8'))
  expect(actual.cwd).toBe(root)
  expect(actual.args).toEqual(['--workspace', root, '--permission-profile', ':ask-me', '--contributor-mode', 'off', '--model', 'muse-spark-1.2', '--reasoning-effort', 'medium'])
  expect(actual.env.META_API_KEY).toBe('fixture-secret')
  expect(actual.env.XDG_DATA_HOME).toBe(join(root, '.muse', 'runtime', 'data'))
  expect(actual.env.TMPDIR).toBe(join(root, '.agent-runtime', 'tmp'))
  expect(actual.env.PIP_CACHE_DIR).toStartWith(root)
  for (const [name, suffix] of Object.entries({ GOCACHE: 'cache/go-build', GOMODCACHE: 'cache/go-mod', GOTMPDIR: 'tmp/go', ELECTRON_CACHE: 'cache/electron' })) {
    expect(actual.env[name]).toBe(join(root, '.agent-runtime', suffix))
    expect(existsSync(actual.env[name])).toBe(true)
  }
  expect(actual.env.PYTHONDONTWRITEBYTECODE).toBe('1')
  expect(actual.env.MUSE_PERMISSION_PROFILE_FAIL_OPEN).toBeUndefined()
  expect(actual.env.MUSE_AUTH_PATH).toBeUndefined()
  expect(actual.env.NODE_OPTIONS).toBeUndefined()
  expect(actual.env.UNRELATED_SECRET).toBeUndefined()
})

test('missing credentials fail before Muse starts and diagnostics omit credentials', () => {
  const root = fixture()
  writeFileSync(join(root, '.env'), 'META_API_KEY=\n')
  stub(root, 'conda', 'process.exit(0)')
  stub(root, 'muse', 'await Bun.write("should-not-exist", "bad")')
  const result = run(root)
  expect(result.exitCode).toBe(1)
  expect(result.stderr.toString()).toContain('Add META_API_KEY')
  expect(() => readFileSync(join(root, 'should-not-exist'))).toThrow()
})

test('offline check verifies prerequisites without launching an API session', () => {
  const root = fixture()
  stub(root, 'conda', 'process.exit(0)')
  stub(root, 'muse', 'process.exit(99)')
  const result = run(root, ['--check'])
  expect(result.exitCode).toBe(0)
  expect(result.stdout.toString()).toContain('No API request was made')
  expect(result.stdout.toString() + result.stderr.toString()).not.toContain('fixture-secret')
})

test('all unrecognized arguments are rejected, including bypass flags', async () => {
  for (const args of [['--yolo'], ['--disable-sandbox'], ['--workspace', '/tmp'], ['--check', '--disable-approval'], ['--permission-profile', ':unrestricted'], ['-c', 'permissions.default_profile=unrestricted']]) {
    expect(await main(args)).toBe(1)
  }
})

test('invalid model and effort reject before spawn without echoing their values', () => {
  for (const settings of [{ MUSE_MODEL: '--yolo secret' }, { MUSE_REASONING_EFFORT: 'not-an-effort' }]) {
    expect(() => buildLaunchSpec({ root: '/repo', executable: '/muse', settings })).toThrow()
  }
})

test('external runtime and dotenv symlinks fail closed', () => {
  const root = fixture()
  const outside = mkdtempSync(join(testRuntime, 'outside-'))
  fixtures.push(outside)
  symlinkSync(outside, join(root, '.muse', 'runtime'))
  expect(() => prepareLaunch(root, { PATH: '/usr/bin:/bin' })).toThrow('outside this repository')
  rmSync(join(root, '.muse', 'runtime'))
  rmSync(join(root, '.env'))
  writeFileSync(join(outside, 'secret'), 'META_API_KEY=external-secret')
  symlinkSync(join(outside, 'secret'), join(root, '.env'))
  expect(() => prepareLaunch(root, { PATH: '/usr/bin:/bin' })).toThrow('outside this repository')
})

test('only the configured keys are loaded from dotenv', () => {
  const root = fixture()
  writeFileSync(join(root, '.env'), 'META_API_KEY="literal-$value"\nMUSE_AUTH_PATH=/outside\nNODE_OPTIONS=--inspect\nMUSE_MODEL=muse-wonder-1.0\n')
  const spec = prepareLaunch(root, { PATH: '/usr/bin:/bin' })
  expect(spec.env.META_API_KEY).toBe('literal-$value')
  expect(spec.env.MUSE_AUTH_PATH).toBeUndefined()
  expect(spec.env.NODE_OPTIONS).toBeUndefined()
  expect(spec.args).toContain('muse-wonder-1.0')
})

const nativeMuse = join(projectRoot, '.muse', 'bin', 'muse')

test.skipIf(!existsSync(nativeMuse))('the installed native CLI accepts the permission profile without model calls', () => {
  const spec = prepareLaunch(projectRoot, { PATH: process.env.PATH, HOME: process.env.HOME, META_API_KEY: '' })
  const metaOnly = new Set(['--model', '--reasoning-effort'])
  const args = spec.args.filter((arg, index, all) => !metaOnly.has(arg) && !metaOnly.has(all[index - 1]))
  const result = Bun.spawnSync([nativeMuse, 'exec', '--provider', 'echo', '--trust-workspace', '--disable-reminders', '--no-foreign-personal-context', ...args, '--json', 'offline-config-smoke'], {
    cwd: spec.cwd, env: spec.env, stdout: 'pipe', stderr: 'pipe',
  })
  expect(result.exitCode).toBe(0)
  const records = result.stdout.toString().trim().split('\n').map((line) => JSON.parse(line))
  expect(records.some((record) => record.payload?.kind === 'run_terminal' && record.payload?.terminal === 'completed' && record.payload?.text === 'echo: offline-config-smoke')).toBe(true)
  const usage = records.find((record) => record.payload?.kind === 'run_usage')?.payload
  expect(usage?.models.every((model) => model.input_tokens === 0 && model.output_tokens === 0)).toBe(true)
}, 20_000)

function synchronize(root) {
  if (!realConda) throw new Error('The existing musedev Conda environment is required for permission tests.')
  const spec = prepareLaunch(root, { PATH: process.env.PATH, HOME: process.env.HOME })
  return Bun.spawnSync([realConda, 'run', '-n', 'musedev', 'python', '-B', join(root, '.muse', 'sync-permissions.py')], {
    cwd: root, env: spec.env, stdout: 'pipe', stderr: 'pipe',
  })
}

function policyPath(root) {
  return join(root, '.muse', 'runtime', 'config', 'muse', 'approval-policy.json')
}

test('native permission synchronization is idempotent and preserves denies and other workspaces', () => {
  const root = fixture()
  prepareLaunch(root, { PATH: process.env.PATH })
  const deny = { effect: 'deny', rule: { kind: 'shell_command_argv_prefix', argv_prefix: ['bun', 'run', 'dev'], workspace_root: root }, durability: 'local_persistent', reason: 'human restriction' }
  const otherWorkspace = { effect: 'allow', rule: { kind: 'shell_command_argv_prefix', argv_prefix: ['bun', 'run', 'build'], workspace_root: '/another/project' }, durability: 'local_persistent', reason: null }
  const original = { schema_version: 2, retained: { sentinel: true }, rules: [deny, otherWorkspace] }
  writeFileSync(policyPath(root), JSON.stringify(original))
  expect(synchronize(root).exitCode).toBe(0)
  const first = readFileSync(policyPath(root), 'utf8')
  const policy = JSON.parse(first)
  expect(policy.retained).toEqual(original.retained)
  expect(policy.rules.slice(0, 2)).toEqual(original.rules)
  const commands = JSON.parse(readFileSync(join(root, '.muse', 'dev-commands.json'), 'utf8')).commands
  expect(policy.rules.slice(2).map((entry) => entry.rule.argv_prefix)).toEqual(commands)
  expect(policy.rules.slice(2).every((entry) => entry.rule.workspace_root === root && entry.effect === 'allow' && entry.durability === 'local_persistent')).toBe(true)
  const again = synchronize(root)
  expect(again.exitCode).toBe(0)
  expect(JSON.parse(again.stdout.toString()).added).toBe(0)
  expect(readFileSync(policyPath(root), 'utf8')).toBe(first)
}, 20_000)

test('an unknown or malformed native approval store is rejected without overwriting it', () => {
  const root = fixture()
  prepareLaunch(root, { PATH: process.env.PATH })
  for (const original of ['{"schema_version":99,"rules":[]}', '{"schema_version":2,"rules":{}}', 'not-json']) {
    writeFileSync(policyPath(root), original)
    const result = synchronize(root)
    expect(result.exitCode).toBe(1)
    expect(readFileSync(policyPath(root), 'utf8')).toBe(original)
  }
}, 20_000)

test('Go cache paths and the native approval store reject external symlinks', () => {
  const root = fixture()
  const outside = mkdtempSync(join(testRuntime, 'outside-'))
  fixtures.push(outside)
  const spec = prepareLaunch(root, { PATH: process.env.PATH })
  rmSync(spec.env.GOCACHE, { recursive: true })
  symlinkSync(outside, spec.env.GOCACHE)
  expect(() => prepareLaunch(root, { PATH: process.env.PATH })).toThrow('outside this repository')
  rmSync(spec.env.GOCACHE)
  mkdirSync(spec.env.GOCACHE)
  const externalPolicy = join(outside, 'policy.json')
  writeFileSync(externalPolicy, '{"schema_version":2,"rules":[]}')
  symlinkSync(externalPolicy, policyPath(root))
  expect(synchronize(root).exitCode).toBe(1)
  expect(readFileSync(externalPolicy, 'utf8')).toBe('{"schema_version":2,"rules":[]}')
}, 20_000)

test('the authoritative command list contains no broad interpreter or process-kill allowance', () => {
  const commands = JSON.parse(readFileSync(fileURLToPath(new URL('./dev-commands.json', import.meta.url)), 'utf8')).commands
  expect(commands.every((command) => command.length >= 2)).toBe(true)
  expect(commands.some((command) => ['bash', 'sh', 'python', 'node', 'kill', 'pkill', 'killall', 'curl'].includes(command[0]))).toBe(false)
  expect(commands.filter((command) => command[0] === 'go')).toEqual([['go', 'run', './cmd/server'], ['go', 'test', './...']])
  expect(commands.filter((command) => command[0] === 'bun' && command[1] === 'install')).toEqual([['bun', 'install', '--frozen-lockfile']])
})

test('permissions mode does not require credentials or start Muse', () => {
  const root = fixture()
  writeFileSync(join(root, '.env'), 'META_API_KEY=\n')
  stub(root, 'conda', 'await Bun.write("sync-invocation.json", JSON.stringify(process.argv.slice(2)))')
  stub(root, 'muse', 'await Bun.write("should-not-start", "bad")')
  const result = run(root, ['--permissions'])
  expect(result.exitCode).toBe(0)
  expect(result.stdout.toString()).toContain('No API request was made')
  expect(JSON.parse(readFileSync(join(root, 'sync-invocation.json'), 'utf8'))).toEqual(['run', '-n', 'musedev', 'python', '-B', join(root, '.muse', 'sync-permissions.py')])
  expect(existsSync(join(root, 'should-not-start'))).toBe(false)
})

test('an external native lock symlink is rejected without touching its target', () => {
  const root = fixture()
  const outside = mkdtempSync(join(testRuntime, 'outside-'))
  fixtures.push(outside)
  prepareLaunch(root, { PATH: process.env.PATH })
  const externalLock = join(outside, 'native.lock')
  writeFileSync(externalLock, 'outside sentinel')
  symlinkSync(externalLock, join(dirname(policyPath(root)), 'approval-policy.lock'))
  const result = synchronize(root)
  expect(result.exitCode).toBe(1)
  expect(readFileSync(externalLock, 'utf8')).toBe('outside sentinel')
  expect(existsSync(policyPath(root))).toBe(false)
}, 20_000)

test('concurrent synchronizers converge without duplicating or replacing existing rules', async () => {
  const root = fixture()
  const spec = prepareLaunch(root, { PATH: process.env.PATH, HOME: process.env.HOME })
  const existing = { effect: 'deny', rule: { kind: 'shell_command_argv_prefix', argv_prefix: ['rm'], workspace_root: root }, durability: 'local_persistent', reason: null }
  writeFileSync(policyPath(root), JSON.stringify({ schema_version: 2, rules: [existing], preserved: true }))
  const start = () => Bun.spawn([realConda, 'run', '-n', 'musedev', 'python', '-B', '-c', 'import runpy,sys; runpy.run_path(sys.argv[1])["synchronize"]()', join(root, '.muse', 'sync-permissions.py')], {
    cwd: root, env: spec.env, stdout: 'pipe', stderr: 'pipe',
  })
  const first = start()
  const second = start()
  const codes = await Promise.all([first.exited, second.exited])
  if (codes.some((code) => code !== 0)) throw new Error(`Permission synchronizers failed: ${await new Response(first.stderr).text()} ${await new Response(second.stderr).text()}`)
  expect(codes).toEqual([0, 0])
  const policy = JSON.parse(readFileSync(policyPath(root), 'utf8'))
  const commands = JSON.parse(readFileSync(join(root, '.muse', 'dev-commands.json'), 'utf8')).commands
  expect(policy.rules).toHaveLength(commands.length + 1)
  expect(policy.rules[0]).toEqual(existing)
  expect(policy.preserved).toBe(true)
  expect(new Set(policy.rules.slice(1).map((entry) => JSON.stringify(entry.rule.argv_prefix))).size).toBe(commands.length)
}, 20_000)
