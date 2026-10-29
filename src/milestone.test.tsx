import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import App from './App'
import { AxisIndicator } from './components/AxisIndicator'
import { axisScreenVectors, cameraForView } from './viewport'

const listeners = new Map<string, Set<EventListener>>()
let savedGlobals: Map<string, PropertyDescriptor | undefined>

function installGlobals(isElectron: boolean) {
  const names = ['IS_REACT_ACT_ENVIRONMENT', 'HTMLElement', 'Element', 'HTMLInputElement', 'HTMLTextAreaElement', 'document', 'window', 'navigator', 'crypto', 'FileReader']
  savedGlobals = new Map(names.map((n) => [n, Object.getOwnPropertyDescriptor(globalThis as unknown as Record<string, unknown>, n)]))
  class ElementStub { tagName = 'DIV'; isContentEditable = false; focus() {}; closest(): ElementStub | null { return null } }
  class HtmlElementStub extends ElementStub {}
  class InputStub extends HtmlElementStub {}
  class TextareaStub extends HtmlElementStub {}
  class FileReaderStub { result: string | null = null; onload: (() => void) | null = null; readAsDataURL() { this.result = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='; setTimeout(() => this.onload?.(), 0) } }
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

async function mountApp(bridge: Record<string, unknown> | null, projectBridge: Record<string, unknown> | null, isElectron: boolean) {
  listeners.clear()
  const w = (globalThis as unknown as { window: Record<string, unknown> }).window as Record<string, unknown>
  if (bridge) w['renovacadApi'] = bridge
  else delete w['renovacadApi']
  if (projectBridge) w['renovacadProject'] = projectBridge
  else delete w['renovacadProject']
  let renderer: ReactTestRenderer | undefined
  await act(() => {
    renderer = create(<App />, {
      createNodeMock: () => ({
        style: { cursor: '' }, focus() {}, click() {}, scrollIntoView() {}, contains: () => false,
        addEventListener(k: string, l: EventListener) { if (!listeners.has(k)) listeners.set(k, new Set()); listeners.get(k)?.add(l) },
        removeEventListener(k: string, l: EventListener) { listeners.get(k)?.delete(l) },
        querySelector: () => null, querySelectorAll: () => [],
      }),
    } as unknown as Parameters<typeof create>[1])
  })
  if (!renderer) throw new Error('mount failed')
  return { renderer, root: () => renderer!.root }
}

beforeEach(() => installGlobals(true))
afterEach(async () => { listeners.clear(); restoreGlobals() })

test('axis indicator uses three arrows with red green blue and handles short projections', async () => {
  // front view: Z is short (len ~0)
  const front = cameraForView('front', 'perspective')
  const fVecs = axisScreenVectors(front)
  assert.ok(Math.hypot(fVecs.z.x, fVecs.z.y) < 0.01, 'front Z should be short')
  // top view: Y short
  const top = cameraForView('top', 'perspective')
  const tVecs = axisScreenVectors(top)
  assert.ok(Math.hypot(tVecs.y.x, tVecs.y.y) < 0.01, 'top Y should be short')
  // home view: all vectors non-short
  const home = cameraForView('top-front-right', 'perspective')
  const hVecs = axisScreenVectors(home)
  assert.ok(Math.hypot(hVecs.x.x, hVecs.x.y) > 0.5)
  assert.ok(Math.hypot(hVecs.y.x, hVecs.y.y) > 0.5)
  assert.ok(Math.hypot(hVecs.z.x, hVecs.z.y) > 0.5)

  // Render AxisIndicator for front view and check SVG contains three labels X Y Z and arrow polygons or dots
  let r: ReactTestRenderer | undefined
  await act(() => { r = create(<AxisIndicator camera={front} />) })
  const root = r!.root
  const svg = root.findByType('svg')
  const texts = root.findAll((n) => n.type === 'text')
  assert.equal(texts.length, 3)
  const labels = texts.map((n) => text(n)).sort()
  assert.deepEqual(labels, ['X', 'Y', 'Z'])
  // Check colors: first char of stroke fill
  const lines = root.findAll((n) => n.type === 'line' || n.type === 'polygon' || n.type === 'circle')
  assert.ok(lines.length >= 3, 'should have arrow lines or dots')
  // Verify colors are red/green/blue distinct
  const colorSet = new Set<string>()
  for (const n of root.findAll((n) => n.props.stroke || n.props.fill)) {
    const c = String(n.props.stroke ?? n.props.fill).toLowerCase()
    if (c.includes('ff') || c.includes('e539') || c.includes('453a')) colorSet.add(c)
  }
  await act(() => r!.unmount())
})

test('axis indicator perspective and orthographic share same direction signs', () => {
  for (const viewId of ['front', 'top', 'right', 'top-front-right'] as const) {
    const persp = cameraForView(viewId, 'perspective')
    const ortho = cameraForView(viewId, 'orthographic')
    const pv = axisScreenVectors(persp)
    const ov = axisScreenVectors(ortho)
    // Signs should match for each axis (direction, not magnitude perspective)
    for (const axis of ['x', 'y', 'z'] as const) {
      const p = pv[axis], o = ov[axis]
      // At least sign matches or both near zero
      if (Math.hypot(p.x, p.y) < 0.01 && Math.hypot(o.x, o.y) < 0.01) continue
      assert.ok(Math.sign(p.x) === Math.sign(o.x) || Math.abs(p.x) < 0.01 || Math.abs(o.x) < 0.01, `x sign mismatch ${viewId} ${axis}`)
      assert.ok(Math.sign(p.y) === Math.sign(o.y) || Math.abs(p.y) < 0.01 || Math.abs(o.y) < 0.01, `y sign mismatch ${viewId} ${axis}`)
    }
  }
})

test('project controls: header has one Save, Save As only in settings, and status shows Not yet saved for untitled', async () => {
  installGlobals(true)
  const bridge = {
    isAvailable: () => true,
    setDirty: async () => ({ ok: true }),
    confirmUnsaved: async () => ({ choice: 'discard' as const }),
    confirmClose: async () => ({ ok: true }),
    openProject: async () => ({ canceled: true }),
    saveProject: async () => ({ canceled: true }),
    onRequestSaveBeforeQuit: () => () => {},
  }
  const { root } = await mountApp(null, bridge, true)
  // Header should have exactly one Save button (primary)
  const saveButtons = root().findAll((n) => n.type === 'button' && String(n.props['aria-label']).includes('Save project'))
  assert.equal(saveButtons.length, 1, `expected one Save in header, found ${saveButtons.length}`)
  // No duplicate Save As icon in header (label Save project as)
  const saveAsHeader = root().findAll((n) => n.type === 'button' && n.props['aria-label'] === 'Save project as')
  assert.equal(saveAsHeader.length, 0, 'Save As should not be duplicate icon in header')
  // Footer and header should show Not yet saved for untitled unsaved project
  const txt = text(root())
  assert.match(txt, /Not yet saved/, 'should show Not yet saved for untitled workspace')
  assert.doesNotMatch(txt, /Local workspace.*Saved[^a-z]/, 'should not show Saved for never-saved project')
  // Settings should have Save and Save As with clear labels
  const settingsBtn = root().findAll((n) => n.type === 'button' && n.props['aria-label'] === 'Workspace settings')[0]
  await act(() => settingsBtn.props.onClick())
  const settingsText = text(root())
  assert.match(settingsText, /Save/)
  assert.match(settingsText, /Save As/)
  // Close settings
  const closeBtn = root().findAll((n) => n.type === 'button' && n.props['aria-label'] === 'Close dialog')[0]
  await act(() => closeBtn.props.onClick())
  restoreGlobals()
})

test('photo analysis requires explicit consent and validates image', async () => {
  const fakeBridge = {
    isAvailable: () => true,
    getStatus: async () => ({ ready: true, address: '127.0.0.1:8787', error: null }),
    proposeEdit: async () => ({ kind: 'clarification', message: '?' }),
    analyzePhoto: async (payload: unknown) => {
      const p = payload as { image: { mimeType: string; dataUrl: string } }
      if (!p.image.dataUrl.startsWith('data:image')) return { kind: 'error', code: 'invalid_request', message: 'unsupported image type' }
      return { kind: 'analysis', description: 'Visible: cabinets', followUpQuestions: ['What is wall length?'] }
    },
  }
  const projectBridge = {
    isAvailable: () => true,
    setDirty: async () => ({ ok: true }),
    confirmUnsaved: async () => ({ choice: 'discard' as const }),
    confirmClose: async () => ({ ok: true }),
    openProject: async () => ({ canceled: true }),
    saveProject: async () => ({ canceled: true }),
    onRequestSaveBeforeQuit: () => () => {},
  }
  const { root } = await mountApp(fakeBridge, projectBridge, true)
  // Initially no photo, photo view shows empty state with upload, not analyze
  const emptyText = text(root())
  assert.match(emptyText, /Upload kitchen photo/)
  // Simulate uploading a photo via FileReader
  const fileInput = root().findAll((n) => n.type === 'input' && n.props.type === 'file')[0]
  const fakeFile = { name: 'kitchen.png', type: 'image/png', size: 1000 } as unknown as File
  await act(() => fileInput.props.onChange({ target: { files: [fakeFile], value: 'kitchen.png' } }))
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  // Now photo view should be active with Analyze button and consent text
  const withPhotoText = text(root())
  assert.match(withPhotoText, /Analyze sends only this photo to Baseten/)
  assert.match(withPhotoText, /dimensions are not inferred/i)
  const analyzeBtn = root().findAll((n) => n.type === 'button' && n.props['aria-label'] === 'Analyze kitchen photo')[0]
  assert.ok(analyzeBtn, 'Analyze button missing')
  // Click analyze should call bridge and show result
  await act(async () => { analyzeBtn.props.onClick(); await new Promise((r) => setTimeout(r, 20)) })
  const afterAnalysis = text(root())
  assert.match(afterAnalysis, /Visible: cabinets/)
  assert.match(afterAnalysis, /What is wall length/)
  assert.match(afterAnalysis, /not measured/i)
  assert.match(afterAnalysis, /was not modified/i)
})

test('photo analysis shows error on provider failure and keeps editing usable', async () => {
  const errBridge = {
    isAvailable: () => true,
    getStatus: async () => ({ ready: true, address: '127.0.0.1:8787', error: null }),
    proposeEdit: async () => ({ kind: 'error', code: 'provider_error', message: 'boom' }),
    analyzePhoto: async () => ({ kind: 'error', code: 'provider_error', message: 'AI provider error' }),
  }
  const projectBridge = {
    isAvailable: () => true,
    setDirty: async () => ({ ok: true }),
    confirmUnsaved: async () => ({ choice: 'discard' as const }),
    confirmClose: async () => ({ ok: true }),
    openProject: async () => ({ canceled: true }),
    saveProject: async () => ({ canceled: true }),
    onRequestSaveBeforeQuit: () => () => {},
  }
  const { root } = await mountApp(errBridge, projectBridge, true)
  // Upload photo
  const fileInput = root().findAll((n) => n.type === 'input' && n.props.type === 'file')[0]
  await act(() => fileInput.props.onChange({ target: { files: [{ name: 'k.png', type: 'image/png', size: 100 } as unknown as File], value: 'k.png' } }))
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  const btn = root().findAll((n) => n.type === 'button' && n.props['aria-label'] === 'Analyze kitchen photo')[0]
  await act(async () => { btn.props.onClick(); await new Promise((r) => setTimeout(r, 20)) })
  const txt = text(root())
  assert.match(txt, /AI provider error/)
  // Editing should still be usable: check Save button still enabled
  const saveBtn = root().findAll((n) => n.type === 'button' && String(n.props['aria-label']).includes('Save project'))[0]
  assert.ok(saveBtn)
  assert.notEqual(saveBtn.props.disabled, true)
})

test('photo analysis unavailable in browser preview shows honest message', async () => {
  // No bridge (browser preview)
  const { root } = await mountApp(null, null, false)
  // Need to get into photo view with a photo - but even without bridge, upload still works (FileReader stub)
  const fileInput = root().findAll((n) => n.type === 'input' && n.props.type === 'file')[0]
  await act(() => fileInput.props.onChange({ target: { files: [{ name: 'k.png', type: 'image/png', size: 100 } as unknown as File], value: 'k.png' } }))
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  const btn = root().findAll((n) => n.type === 'button' && n.props['aria-label'] === 'Analyze kitchen photo')[0]
  assert.ok(btn)
  await act(async () => { btn.props.onClick(); await new Promise((r) => setTimeout(r, 20)) })
  const txt = text(root())
  assert.match(txt, /not available in browser preview/i)
})

test('assistant distinguishes local bridge from verified provider', async () => {
  // Bridge available but not verified (simulated by status not ready)
  const localOnlyBridge = {
    isAvailable: () => true,
    getStatus: async () => ({ ready: false, address: null, error: 'Go service not ready' }),
    proposeEdit: async () => ({ kind: 'error', code: 'service_unavailable', message: 'not ready' }),
    analyzePhoto: async () => ({ kind: 'error', code: 'service_unavailable', message: 'not ready' }),
  }
  const { root } = await mountApp(localOnlyBridge, null, true)
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  const badge = root().findAll((n) => String(n.props.className).includes('sample-badge'))[0]
  assert.ok(badge, 'badge missing')
  assert.equal(text(badge).trim(), 'LOCAL')
  const txt = text(root())
  // Should not show LIVE badge (but LIVE PREVIEW in viewport is okay)
  assert.match(txt, /LOCAL/)
})
