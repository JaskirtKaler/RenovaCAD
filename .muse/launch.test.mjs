import { afterEach, expect, test } from 'bun:test'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildLaunchSpec, main, prepareLaunch } from './launch.mjs'

const fixtures = []
afterEach(() => {
  for (const fixture of fixtures.splice(0)) rmSync(fixture, { recursive: true, force: true })
})

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'renovacad-muse-test-')))
  fixtures.push(root)
  mkdirSync(join(root, '.muse', 'bin'), { recursive: true })
  cpSync(fileURLToPath(new URL('./launch.mjs', import.meta.url)), join(root, '.muse', 'launch.mjs'))
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
  const result = run(root, [], { MUSE_PERMISSION_PROFILE_FAIL_OPEN: '1', MUSE_AUTH_PATH: '/outside/auth', NODE_OPTIONS: '--trace-warnings', UNRELATED_SECRET: 'must-not-forward' })
  expect(result.exitCode).toBe(0)
  const actual = JSON.parse(readFileSync(join(root, 'launch-observation.json'), 'utf8'))
  expect(actual.cwd).toBe(root)
  expect(actual.args).toEqual(['--workspace', root, '--permission-profile', ':ask-me', '--contributor-mode', 'off', '--model', 'muse-spark-1.2', '--reasoning-effort', 'medium'])
  expect(actual.env.META_API_KEY).toBe('fixture-secret')
  expect(actual.env.XDG_DATA_HOME).toBe(join(root, '.muse', 'runtime', 'data'))
  expect(actual.env.TMPDIR).toBe(join(root, '.agent-runtime', 'tmp'))
  expect(actual.env.PIP_CACHE_DIR).toStartWith(root)
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
  const outside = mkdtempSync(join(tmpdir(), 'renovacad-outside-'))
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

const projectRoot = realpathSync(fileURLToPath(new URL('..', import.meta.url)))
const nativeMuse = join(projectRoot, '.muse', 'bin', 'muse')

test.skipIf(!existsSync(nativeMuse))('the installed native CLI accepts the permission profile without model calls', () => {
  const spec = prepareLaunch(projectRoot, { PATH: process.env.PATH, HOME: process.env.HOME, META_API_KEY: '' })
  const metaOnly = new Set(['--model', '--reasoning-effort'])
  const args = spec.args.filter((arg, index, all) => !metaOnly.has(arg) && !metaOnly.has(all[index - 1]))
  const result = Bun.spawnSync([nativeMuse, 'exec', '--provider', 'echo', '--trust-workspace', ...args, '--json', 'offline-config-smoke'], {
    cwd: spec.cwd, env: spec.env, stdout: 'pipe', stderr: 'pipe',
  })
  expect(result.exitCode).toBe(0)
  const records = result.stdout.toString().trim().split('\n').map((line) => JSON.parse(line))
  expect(records.some((record) => record.payload?.kind === 'run_terminal' && record.payload?.terminal === 'completed' && record.payload?.text === 'echo: offline-config-smoke')).toBe(true)
  const usage = records.find((record) => record.payload?.kind === 'run_usage')?.payload
  expect(usage?.models.every((model) => model.input_tokens === 0 && model.output_tokens === 0)).toBe(true)
}, 20_000)
