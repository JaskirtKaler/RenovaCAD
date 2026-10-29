import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import App from './App'

const listeners = new Map<string, Set<EventListener>>()
let savedGlobals: Map<string, PropertyDescriptor | undefined>

function installGlobals(isElectron: boolean) {
  const names = ['IS_REACT_ACT_ENVIRONMENT', 'HTMLElement', 'Element', 'HTMLInputElement', 'HTMLTextAreaElement', 'document', 'window', 'navigator', 'crypto', 'FileReader']
  savedGlobals = new Map(names.map((n) => [n, Object.getOwnPropertyDescriptor(globalThis as unknown as Record<string, unknown>, n)]))
  class ElementStub { tagName = 'DIV'; isContentEditable = false; focus() {}; closest(): ElementStub | null { return null } }
  class HtmlElementStub extends ElementStub {}
  class InputStub extends HtmlElementStub {}
  class TextareaStub extends HtmlElementStub {}
  class FileReaderStub { result: string | null = null; onload: (() => void) | null = null; readAsDataURL(_file: unknown) { this.result = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='; setTimeout(() => this.onload?.(), 0) } }
  Object.defineProperties(globalThis, {
    IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
    HTMLElement: { configurable: true, value: HtmlElementStub },
    Element: { configurable: true, value: ElementStub },
    HTMLInputElement: { configurable: true, value: InputStub },
    HTMLTextAreaElement: { configurable: true, value: TextareaStub },
    FileReader: { configurable: true, value: FileReaderStub },
    document: { configurable: true, value: { activeElement: null, querySelector: () => null, addEventListener(k: string, l: EventListener) { if (!listeners.has(k)) listeners.set(k, new Set()); listeners.get(k)?.add(l) }, removeEventListener(k: string, l: EventListener) { listeners.get(k)?.delete(l) } } },
    window: { configurable: true, value: { setTimeout, clearTimeout, addEventListener(k: string, l: EventListener) { if (!listeners.has(k)) listeners.set(k, new Set()); listeners.get(k)?.add(l) }, removeEventListener(k: string, l: EventListener) { listeners.get(k)?.delete(l) }, confirm: () => true } },
    navigator: { configurable: true, value: { userAgent: isElectron ? 'Electron' : 'Mozilla' } },
    crypto: { configurable: true, value: { randomUUID: () => 'test-id-' + Math.random().toString(36).slice(2) } },
  } as unknown as PropertyDescriptorMap)
}
function restoreGlobals() {
  for (const [name, d] of savedGlobals) {
    if (d) Object.defineProperty(globalThis, name, d)
    else Reflect.deleteProperty(globalThis as unknown as Record<string, unknown>, name)
  }
}

function text(node: ReactTestInstance): string { return node.children.map((c) => typeof c === 'string' ? c : text(c as ReactTestInstance)).join('') }
function host(type: string, root: ReactTestInstance, predicate: (n: ReactTestInstance) => boolean): ReactTestInstance {
  const m = root.findAll((n) => n.type === type && predicate(n))
  assert.equal(m.length, 1, `Expected one ${type} found ${m.length}`)
  return m[0]
}

async function mountApp(apiBridge: Record<string, unknown>, projectBridge: Record<string, unknown>) {
  listeners.clear()
  const w = (globalThis as unknown as { window: Record<string, unknown> }).window as Record<string, unknown>
  w['renovacadApi'] = apiBridge
  w['renovacadProject'] = projectBridge
  let renderer: ReactTestRenderer | undefined
  await act(() => {
    renderer = create(<App />, {
      createNodeMock: () => ({
        style: { cursor: '' }, focus() {}, click() {}, scrollIntoView() {}, contains: () => false,
        addEventListener() {}, removeEventListener() {}, querySelector: () => null, querySelectorAll: () => [],
      }),
    } as unknown as Parameters<typeof create>[1])
  })
  if (!renderer) throw new Error('mount failed')
  return { renderer, root: () => renderer!.root }
}

function fakeProjectBridge() {
  return {
    isAvailable: () => true,
    setDirty: async () => ({ ok: true }),
    confirmUnsaved: async () => ({ choice: 'discard' as const }),
    confirmClose: async () => ({ ok: true }),
    openProject: async () => ({ canceled: true }),
    saveProject: async () => ({ canceled: true }),
    onRequestSaveBeforeQuit: () => () => {},
  }
}

beforeEach(() => installGlobals(true))
afterEach(() => { listeners.clear(); restoreGlobals() })

test('replacing photo invalidates pending analysis — late response for photo A is ignored with photo B', async () => {
  let firstResolve: (v: unknown) => void = () => {}
  let secondResolve: (v: unknown) => void = () => {}
  let callCount = 0
  const apiBridge = {
    isAvailable: () => true,
    getStatus: async () => ({ ready: true, address: '127.0.0.1:8787', error: null }),
    proposeEdit: async () => ({ kind: 'clarification', message: '?' }),
    analyzePhoto: () => new Promise((res) => {
      callCount++
      if (callCount === 1) firstResolve = res as (v: unknown) => void
      else secondResolve = res as (v: unknown) => void
    }),
  }
  const { root } = await mountApp(apiBridge, fakeProjectBridge())

  // Upload first photo A
  const fileInput = () => host('input', root(), (n) => n.props.type === 'file')
  const fileA = { name: 'kitchen-A.png', type: 'image/png', size: 1000 } as unknown as File
  await act(() => fileInput().props.onChange({ target: { files: [fileA], value: 'kitchen-A.png' } }))
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  // Start analysis for photo A
  let analyzeBtn = root().findAll((n) => n.type === 'button' && n.props['aria-label'] === 'Analyze kitchen photo')[0]
  assert.ok(analyzeBtn, 'Analyze button missing for photo A')
  await act(() => { analyzeBtn.props.onClick() })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  assert.match(text(root()), /Analyzing|Sending photo/i, 'should show loading for photo A')

  // Replace photo with B BEFORE first analysis resolves
  const fileB = { name: 'kitchen-B.png', type: 'image/png', size: 1000 } as unknown as File
  await act(() => fileInput().props.onChange({ target: { files: [fileB], value: 'kitchen-B.png' } }))
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  // After replacing, previous loading should be cleared and result not shown; user can analyze B
  assert.match(text(root()), /kitchen-B\.png/)
  // The old loading should have been reset by invalidation, so Analyze button should be enabled again (not showing Analyzing)
  analyzeBtn = root().findAll((n) => n.type === 'button' && n.props['aria-label'] === 'Analyze kitchen photo')[0]
  assert.equal(analyzeBtn.props.disabled, false, 'After photo replace, Analyze should be enabled (loading reset)')
  assert.doesNotMatch(text(root()), /Visible: cabinets A|Photo description/i)

  // Late response for photo A arrives — should be ignored
  await act(async () => { firstResolve({ kind: 'analysis', description: 'Visible: cabinets A', followUpQuestions: ['Q-A'] }); await new Promise((r) => setTimeout(r, 20)) })
  assert.doesNotMatch(text(root()), /Visible: cabinets A/, 'Late response for photo A should be ignored after photo B')
  assert.doesNotMatch(text(root()), /Q-A/)
  assert.equal(analyzeBtn.props.disabled, false, 'Should still be able to analyze after ignored late response')

  // Now analyze photo B and verify new analysis can succeed
  await act(() => { analyzeBtn.props.onClick() })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  assert.match(text(root()), /Analyzing/)
  await act(async () => { secondResolve({ kind: 'analysis', description: 'Visible: cabinets B', followUpQuestions: ['Q-B'] }); await new Promise((r) => setTimeout(r, 20)) })
  assert.match(text(root()), /Visible: cabinets B/)
  assert.match(text(root()), /Q-B/)
})

test('late error from previous photo does not appear after photo replacement', async () => {
  let firstReject: (v: unknown) => void = () => {}
  const apiBridge = {
    isAvailable: () => true,
    getStatus: async () => ({ ready: true, address: '127.0.0.1:8787', error: null }),
    proposeEdit: async () => ({ kind: 'clarification', message: '?' }),
    analyzePhoto: () => new Promise((_, rej) => { firstReject = rej as (v: unknown) => void }),
  }
  // Actually analyzePhoto resolves with error kind, not reject; we simulate error response
  let firstResolve: (v: unknown) => void = () => {}
  const apiBridge2 = {
    isAvailable: () => true,
    getStatus: async () => ({ ready: true, address: '127.0.0.1:8787', error: null }),
    proposeEdit: async () => ({ kind: 'clarification', message: '?' }),
    analyzePhoto: () => new Promise((res) => { firstResolve = res as (v: unknown) => void }),
  }
  const { root } = await mountApp(apiBridge2, fakeProjectBridge())
  const fileInput = () => host('input', root(), (n) => n.props.type === 'file')
  await act(() => fileInput().props.onChange({ target: { files: [{ name: 'A.png', type: 'image/png', size: 100 } as unknown as File], value: 'A.png' } }))
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  let btn = root().findAll((n) => n.type === 'button' && n.props['aria-label'] === 'Analyze kitchen photo')[0]
  await act(() => { btn.props.onClick() })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

  await act(() => fileInput().props.onChange({ target: { files: [{ name: 'B.png', type: 'image/png', size: 100 } as unknown as File], value: 'B.png' } }))
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })

  await act(async () => { firstResolve({ kind: 'error', code: 'provider_error', message: 'Error for A' }); await new Promise((r) => setTimeout(r, 20)) })
  assert.doesNotMatch(text(root()), /Error for A/, 'Late error for previous photo should be ignored')
  btn = root().findAll((n) => n.type === 'button' && n.props['aria-label'] === 'Analyze kitchen photo')[0]
  assert.equal(btn.props.disabled, false, 'Should be able to retry after ignored error')
})

test('opening a project while analysis pending invalidates it — old response ignored', async () => {
  let resolveA: (v: unknown) => void = () => {}
  const apiBridge = {
    isAvailable: () => true,
    getStatus: async () => ({ ready: true, address: '127.0.0.1:8787', error: null }),
    proposeEdit: async () => ({ kind: 'clarification', message: '?' }),
    analyzePhoto: () => new Promise((res) => { resolveA = res as (v: unknown) => void }),
  }
  // Project bridge that will provide a new project on open
  let openResolve: (v: unknown) => void = () => {}
  const projectBridge = {
    isAvailable: () => true,
    setDirty: async () => ({ ok: true }),
    confirmUnsaved: async () => ({ choice: 'discard' as const }),
    confirmClose: async () => ({ ok: true }),
    openProject: async () => ({ canceled: false, filePath: '/tmp/other.renovacad', content: JSON.stringify({
      version: 1, name: 'Other Kitchen', scene: [{ id: 'base-01', kind: 'base-cabinet', name: 'Base cabinet', dimensionsMm: { width: 900, height: 800, depth: 600 }, rotationDegrees: 0, positionMm: { x: 0, y: 0, z: 0 } }], selectedId: 'base-01', settings: { unit: 'in', showGrid: true }, camera: { yaw: 0, pitch: 0, projection: 'perspective', zoom: 1 }, viewMode: 'cad', referencePhoto: null
    }) }),
    saveProject: async () => ({ canceled: true }),
    onRequestSaveBeforeQuit: () => () => {},
  }
  const { root } = await mountApp(apiBridge, projectBridge)

  // Upload photo and start analysis
  const fileInput = () => host('input', root(), (n) => n.props.type === 'file')
  await act(() => fileInput().props.onChange({ target: { files: [{ name: 'A.png', type: 'image/png', size: 100 } as unknown as File], value: 'A.png' } }))
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  let btn = root().findAll((n) => n.type === 'button' && n.props['aria-label'] === 'Analyze kitchen photo')[0]
  await act(() => { btn.props.onClick() })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  assert.match(text(root()), /Analyzing/)

  // Open a different project while analysis pending (should invalidate)
  const openBtn = root().findAll((n) => n.type === 'button' && String(n.props['aria-label']).includes('Open project'))[0]
  assert.ok(openBtn, 'Open button missing')
  await act(async () => { openBtn.props.onClick(); await new Promise((r) => setTimeout(r, 20)) })
  // After open, should show Other Kitchen and no photo analysis loading/result
  const txtAfterOpen = text(root())
  assert.match(txtAfterOpen, /Other Kitchen/)
  // Loading should be reset
  assert.doesNotMatch(txtAfterOpen, /Analyzing/)
  // Late response for old photo should be ignored
  await act(async () => { resolveA({ kind: 'analysis', description: 'Stale analysis for A', followUpQuestions: ['Stale Q'] }); await new Promise((r) => setTimeout(r, 20)) })
  const txtAfterLate = text(root())
  assert.doesNotMatch(txtAfterLate, /Stale analysis for A/)
  assert.doesNotMatch(txtAfterLate, /Stale Q/)
})

test('creating a new project while analysis pending invalidates it and allows new analysis', async () => {
  let resolveA: (v: unknown) => void = () => {}
  const apiBridge = {
    isAvailable: () => true,
    getStatus: async () => ({ ready: true, address: '127.0.0.1:8787', error: null }),
    proposeEdit: async () => ({ kind: 'clarification', message: '?' }),
    analyzePhoto: () => new Promise((res) => { resolveA = res as (v: unknown) => void }),
  }
  const { root } = await mountApp(apiBridge, fakeProjectBridge())

  const fileInput = () => host('input', root(), (n) => n.props.type === 'file')
  await act(() => fileInput().props.onChange({ target: { files: [{ name: 'A.png', type: 'image/png', size: 100 } as unknown as File], value: 'A.png' } }))
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  let btn = root().findAll((n) => n.type === 'button' && n.props['aria-label'] === 'Analyze kitchen photo')[0]
  await act(() => { btn.props.onClick() })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

  // Create new project
  const newBtn = root().findAll((n) => n.type === 'button' && String(n.props['aria-label']).includes('New project'))[0]
  assert.ok(newBtn, 'New project button missing')
  await act(async () => { newBtn.props.onClick(); await new Promise((r) => setTimeout(r, 20)) })
  assert.match(text(root()), /Kitchen Remodel Project/)
  assert.doesNotMatch(text(root()), /Analyzing/)

  await act(async () => { resolveA({ kind: 'analysis', description: 'Stale for A', followUpQuestions: [] }); await new Promise((r) => setTimeout(r, 20)) })
  assert.doesNotMatch(text(root()), /Stale for A/)

  // Upload new photo B and ensure new analysis can be started (not blocked by stale loading)
  await act(() => fileInput().props.onChange({ target: { files: [{ name: 'B.png', type: 'image/png', size: 100 } as unknown as File], value: 'B.png' } }))
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  btn = root().findAll((n) => n.type === 'button' && n.props['aria-label'] === 'Analyze kitchen photo')[0]
  assert.equal(btn.props.disabled, false, 'After new project invalidation, new photo analysis should be startable')
})

test('explicit consent notice remains and scene not modified by photo analysis', async () => {
  const apiBridge = {
    isAvailable: () => true,
    getStatus: async () => ({ ready: true, address: '127.0.0.1:8787', error: null }),
    proposeEdit: async () => ({ kind: 'clarification', message: '?' }),
    analyzePhoto: async () => ({ kind: 'analysis', description: 'Desc', followUpQuestions: ['Q1'] }),
  }
  const { root } = await mountApp(apiBridge, fakeProjectBridge())
  const fileInput = () => host('input', root(), (n) => n.props.type === 'file')
  await act(() => fileInput().props.onChange({ target: { files: [{ name: 'A.png', type: 'image/png', size: 100 } as unknown as File], value: 'A.png' } }))
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  // Consent notice must be present before analyzing
  assert.match(text(root()), /Analyze sends only this photo to Baseten/)
  assert.match(text(root()), /not inferred|not measured/i)
  const beforeWidth = host('input', root(), (n) => n.props.id === 'field-Width').props.value
  const btn = root().findAll((n) => n.type === 'button' && n.props['aria-label'] === 'Analyze kitchen photo')[0]
  await act(async () => { btn.props.onClick(); await new Promise((r) => setTimeout(r, 20)) })
  // Scene should not be modified
  const afterWidth = host('input', root(), (n) => n.props.id === 'field-Width').props.value
  assert.equal(afterWidth, beforeWidth, 'Photo analysis should not modify scene')
  assert.match(text(root()), /Desc/)
  assert.match(text(root()), /was not modified/i)
})
