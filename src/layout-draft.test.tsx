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
    crypto: { configurable: true, value: { randomUUID: () => 'test-layout-' + Math.random().toString(36).slice(2, 8) } },
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

function makeValidDraft() {
  return {
    kind: 'layout_draft' as const,
    draft: {
      version: 1,
      objects: [
        { kind: 'base-cabinet', name: 'Base cabinet 1', dimensionsMm: { width: 914.4, height: 876.3, depth: 609.6 }, positionMm: { x: -650, y: 0, z: -300 }, rotationDegrees: 0 },
        { kind: 'wall-cabinet', name: 'Wall cabinet 1', dimensionsMm: { width: 914.4, height: 762, depth: 304.8 }, positionMm: { x: -650, y: 1480, z: -300 }, rotationDegrees: 0 },
        { kind: 'sink', name: 'Sink', dimensionsMm: { width: 762, height: 228.6, depth: 508 }, positionMm: { x: 400, y: 0, z: -300 }, rotationDegrees: 0 },
      ],
      description: 'Detected base cabinet, upper cabinet and sink along back wall. Positions are approximate.',
      followUpQuestions: ['What is wall length?', 'Confirm sink position?'],
      warnings: ['Approximate dimensions — please verify and measure before building.'],
      isApproximate: true,
    }
  }
}

beforeEach(() => installGlobals(true))
afterEach(() => { listeners.clear(); restoreGlobals() })

test('valid draft shows supported objects with approximate warnings and follow-up questions', async () => {
  const apiBridge = {
    isAvailable: () => true,
    getStatus: async () => ({ ready: true, address: '127.0.0.1:8787', error: null }),
    proposeEdit: async () => ({ kind: 'clarification', message: '?' }),
    analyzePhoto: async () => ({ kind: 'analysis', description: 'x', followUpQuestions: [] }),
    proposeLayout: async () => makeValidDraft(),
  }
  const { root } = await mountApp(apiBridge, fakeProjectBridge())
  const fileInput = () => host('input', root(), (n) => n.props.type === 'file')
  await act(() => fileInput().props.onChange({ target: { files: [{ name: 'k.png', type: 'image/png', size: 100 } as unknown as File], value: 'k.png' } }))
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })

  // Before creating draft, scene has 3 objects
  const initialCount = root().findAll((n) => n.type === 'button' && String(n.props.className).includes('scene-row')).length
  assert.equal(initialCount, 3)

  // Click Create draft layout
  const createBtn = root().findAll((n) => n.type === 'button' && n.props['aria-label'] === 'Create draft layout')[0]
  assert.ok(createBtn, 'Create draft button missing')
  assert.match(text(root()), /Create draft sends only this photo to Baseten/)
  await act(async () => { createBtn.props.onClick(); await new Promise((r) => setTimeout(r, 20)) })

  const txt = text(root())
  // Draft should show description and warnings and objects
  assert.match(txt, /Detected base cabinet/)
  assert.match(txt, /Approximate dimensions/)
  assert.match(txt, /approximate/i)
  // Objects names should appear in inputs (check input values)
  const nameInputs = root().findAll((n) => n.type === 'input' && typeof n.props['aria-label'] === 'string' && n.props['aria-label'].endsWith(' name'))
  const names = nameInputs.map((n) => String(n.props.value))
  assert.ok(names.includes('Base cabinet 1'), `expected Base cabinet 1 in ${names}`)
  assert.ok(names.includes('Wall cabinet 1'), `expected Wall cabinet 1 in ${names}`)
  assert.ok(names.includes('Sink'), `expected Sink in ${names}`)
  // Follow-up questions
  assert.match(txt, /What is wall length/)
  // Should indicate it will add to current scene
  assert.match(txt, /add .* objects to your current scene/)
  // Should not have modified scene yet
  const afterDraftCount = root().findAll((n) => n.type === 'button' && String(n.props.className).includes('scene-row')).length
  assert.equal(afterDraftCount, 3, 'Scene should be preserved until apply')
  // Check isApproximate handling: draft should be marked approximate
  assert.match(txt, /approximate/i)
})

test('invalid provider output is rejected without modifying scene', async () => {
  const apiBridge = {
    isAvailable: () => true,
    getStatus: async () => ({ ready: true, address: '127.0.0.1:8787', error: null }),
    proposeEdit: async () => ({ kind: 'clarification', message: '?' }),
    analyzePhoto: async () => ({ kind: 'analysis', description: 'x', followUpQuestions: [] }),
    proposeLayout: async () => ({
      kind: 'layout_draft',
      draft: {
        version: 1,
        objects: [
          // Invalid kind
          { kind: 'sofa', name: 'Sofa', dimensionsMm: { width: 1000, height: 800, depth: 800 }, positionMm: { x: 0, y: 0, z: 0 }, rotationDegrees: 0 },
        ],
        description: 'bad',
        followUpQuestions: [],
        warnings: [],
        isApproximate: true,
      }
    }),
  }
  const { root } = await mountApp(apiBridge, fakeProjectBridge())
  const fileInput = () => host('input', root(), (n) => n.props.type === 'file')
  await act(() => fileInput().props.onChange({ target: { files: [{ name: 'k.png', type: 'image/png', size: 100 } as unknown as File], value: 'k.png' } }))
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  const btn = root().findAll((n) => n.type === 'button' && n.props['aria-label'] === 'Create draft layout')[0]
  await act(async () => { btn.props.onClick(); await new Promise((r) => setTimeout(r, 20)) })
  const txt = text(root())
  // Should show error about unsupported kind, not crash, and not modify scene
  assert.match(txt, /Unsupported object kind|Invalid/i)
  const count = root().findAll((n) => n.type === 'button' && String(n.props.className).includes('scene-row')).length
  assert.equal(count, 3)
})

test('provider returns needs_info when insufficient info', async () => {
  const apiBridge = {
    isAvailable: () => true,
    getStatus: async () => ({ ready: true, address: '127.0.0.1:8787', error: null }),
    proposeEdit: async () => ({ kind: 'clarification', message: '?' }),
    analyzePhoto: async () => ({ kind: 'analysis', description: 'x', followUpQuestions: [] }),
    proposeLayout: async () => ({ kind: 'needs_info', message: 'Photo too blurry to detect layout', followUpQuestions: ['Provide clearer photo', 'What wall are we designing?'] }),
  }
  const { root } = await mountApp(apiBridge, fakeProjectBridge())
  const fileInput = () => host('input', root(), (n) => n.props.type === 'file')
  await act(() => fileInput().props.onChange({ target: { files: [{ name: 'k.png', type: 'image/png', size: 100 } as unknown as File], value: 'k.png' } }))
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  const btn = root().findAll((n) => n.type === 'button' && n.props['aria-label'] === 'Create draft layout')[0]
  await act(async () => { btn.props.onClick(); await new Promise((r) => setTimeout(r, 20)) })
  const txt = text(root())
  assert.match(txt, /Photo too blurry/)
  assert.match(txt, /Provide clearer photo/)
  // No draft objects should be shown
  assert.doesNotMatch(txt, /Apply draft/)
  assert.equal(root().findAll((n) => n.type === 'button' && String(n.props.className).includes('scene-row')).length, 3)
})

test('photo change while layout request pending discards stale response', async () => {
  let firstResolve: (v: unknown) => void = () => {}
  let secondResolve: (v: unknown) => void = () => {}
  let callIdx = 0
  const apiBridge = {
    isAvailable: () => true,
    getStatus: async () => ({ ready: true, address: '127.0.0.1:8787', error: null }),
    proposeEdit: async () => ({ kind: 'clarification', message: '?' }),
    analyzePhoto: async () => ({ kind: 'analysis', description: 'x', followUpQuestions: [] }),
    proposeLayout: () => new Promise((res) => {
      callIdx++
      if (callIdx === 1) firstResolve = res as (v: unknown) => void
      else secondResolve = res as (v: unknown) => void
    }),
  }
  const { root } = await mountApp(apiBridge, fakeProjectBridge())
  const fileInput = () => host('input', root(), (n) => n.props.type === 'file')
  await act(() => fileInput().props.onChange({ target: { files: [{ name: 'A.png', type: 'image/png', size: 100 } as unknown as File], value: 'A.png' } }))
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  const btn = root().findAll((n) => n.type === 'button' && n.props['aria-label'] === 'Create draft layout')[0]
  await act(() => { btn.props.onClick() })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  assert.match(text(root()), /Creating draft/)

  // Replace photo before resolve — should immediately clear loading
  await act(() => fileInput().props.onChange({ target: { files: [{ name: 'B.png', type: 'image/png', size: 100 } as unknown as File], value: 'B.png' } }))
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  // After photo change, draft loading should be reset and no draft shown
  assert.doesNotMatch(text(root()), /Creating draft/)
  const btn2 = root().findAll((n) => n.type === 'button' && n.props['aria-label'] === 'Create draft layout')[0]
  // Button should be enabled again (not disabled)
  assert.equal(btn2.props.disabled, false, 'After photo change, draft button should be enabled')
  // Resolve first request (for A) — should be ignored
  await act(async () => { firstResolve(makeValidDraft()); await new Promise((r) => setTimeout(r, 20)) })
  assert.doesNotMatch(text(root()), /Detected base cabinet/)
  assert.doesNotMatch(text(root()), /Apply draft/)
  // Now create draft for B and verify it succeeds
  await act(() => { btn2.props.onClick() })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  assert.match(text(root()), /Creating draft/)
  await act(async () => { secondResolve(makeValidDraft()); await new Promise((r) => setTimeout(r, 20)) })
  assert.match(text(root()), /Detected base cabinet/)
})

test('project change (open/new) while layout pending discards stale', async () => {
  let resolveLayout: (v: unknown) => void = () => {}
  const apiBridge = {
    isAvailable: () => true,
    getStatus: async () => ({ ready: true, address: '127.0.0.1:8787', error: null }),
    proposeEdit: async () => ({ kind: 'clarification', message: '?' }),
    analyzePhoto: async () => ({ kind: 'analysis', description: 'x', followUpQuestions: [] }),
    proposeLayout: () => new Promise((res) => { resolveLayout = res as (v: unknown) => void }),
  }
  const projectBridge = {
    isAvailable: () => true,
    setDirty: async () => ({ ok: true }),
    confirmUnsaved: async () => ({ choice: 'discard' as const }),
    confirmClose: async () => ({ ok: true }),
    openProject: async () => ({ canceled: false, filePath: '/tmp/other.renovacad', content: JSON.stringify({ version: 1, name: 'Other Kitchen', scene: [{ id: 'other-01', kind: 'base-cabinet', name: 'Other', dimensionsMm: { width: 900, height: 800, depth: 600 }, rotationDegrees: 0, positionMm: { x: 0, y: 0, z: 0 } }], selectedId: 'other-01', settings: { unit: 'in', showGrid: true }, camera: { yaw: 0, pitch: 0, projection: 'perspective', zoom: 1 }, viewMode: 'cad', referencePhoto: null }) }),
    saveProject: async () => ({ canceled: true }),
    onRequestSaveBeforeQuit: () => () => {},
  }
  const { root } = await mountApp(apiBridge, projectBridge)
  const fileInput = () => host('input', root(), (n) => n.props.type === 'file')
  await act(() => fileInput().props.onChange({ target: { files: [{ name: 'A.png', type: 'image/png', size: 100 } as unknown as File], value: 'A.png' } }))
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  const btn = root().findAll((n) => n.type === 'button' && n.props['aria-label'] === 'Create draft layout')[0]
  await act(() => { btn.props.onClick() })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  // Open other project while pending
  const openBtn = root().findAll((n) => n.type === 'button' && String(n.props['aria-label']).includes('Open project'))[0]
  await act(async () => { openBtn.props.onClick(); await new Promise((r) => setTimeout(r, 20)) })
  assert.match(text(root()), /Other Kitchen/)
  // Resolve old layout — should be ignored
  await act(async () => { resolveLayout(makeValidDraft()); await new Promise((r) => setTimeout(r, 20)) })
  assert.doesNotMatch(text(root()), /Apply draft/)
})

test('review edit: remove object and change dimensions before apply', async () => {
  const apiBridge = {
    isAvailable: () => true,
    getStatus: async () => ({ ready: true, address: '127.0.0.1:8787', error: null }),
    proposeEdit: async () => ({ kind: 'clarification', message: '?' }),
    analyzePhoto: async () => ({ kind: 'analysis', description: 'x', followUpQuestions: [] }),
    proposeLayout: async () => makeValidDraft(),
  }
  const { root } = await mountApp(apiBridge, fakeProjectBridge())
  const fileInput = () => host('input', root(), (n) => n.props.type === 'file')
  await act(() => fileInput().props.onChange({ target: { files: [{ name: 'k.png', type: 'image/png', size: 100 } as unknown as File], value: 'k.png' } }))
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  const btn = root().findAll((n) => n.type === 'button' && n.props['aria-label'] === 'Create draft layout')[0]
  await act(async () => { btn.props.onClick(); await new Promise((r) => setTimeout(r, 20)) })

  // Draft should have 3 objects
  assert.match(text(root()), /Apply draft — add 3 objects/)
  // Remove one object (Sink)
  const removeBtn = root().findAll((n) => n.type === 'button' && n.props['aria-label'] === 'Remove Sink')[0]
  assert.ok(removeBtn, 'Remove Sink button missing')
  await act(() => { removeBtn.props.onClick() })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  assert.match(text(root()), /Apply draft — add 2 objects/)
  // Edit width of first object — display unit is in by default, so 1000 mm = 39.37 in
  const widthInput = root().findAll((n) => n.type === 'input' && n.props['aria-label'] === 'Base cabinet 1 width')[0]
  assert.ok(widthInput, 'width input missing')
  // Input shows display units (in); set to 39.37 to represent 1000 mm
  await act(() => { widthInput.props.onChange({ target: { value: '39.37' } }) })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  // Value is in display units (in)
  assert.equal(String(widthInput.props.value), '39.37')

  // Apply
  const applyBtn = host('button', root(), (n) => n.props['aria-label'] === 'Apply draft layout')
  await act(() => { applyBtn.props.onClick() })
  await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
  // Scene should now have 3+2 =5 objects and new width should be reflected
  const rows = root().findAll((n) => n.type === 'button' && String(n.props.className).includes('scene-row'))
  assert.equal(rows.length, 5)
  // Check that edited width persisted: find width field for first new object? After apply, selected is first new object
  const field = root().findAll((n) => n.type === 'input' && n.props.id === 'field-Width')[0]
  // Since 1000 mm = 39.37 in, display should be 39.37
  assert.match(String(field.props.value), /39\.37/)
})

test('cancel draft does not modify scene', async () => {
  const apiBridge = {
    isAvailable: () => true,
    getStatus: async () => ({ ready: true, address: '127.0.0.1:8787', error: null }),
    proposeEdit: async () => ({ kind: 'clarification', message: '?' }),
    analyzePhoto: async () => ({ kind: 'analysis', description: 'x', followUpQuestions: [] }),
    proposeLayout: async () => makeValidDraft(),
  }
  const { root } = await mountApp(apiBridge, fakeProjectBridge())
  const fileInput = () => host('input', root(), (n) => n.props.type === 'file')
  await act(() => fileInput().props.onChange({ target: { files: [{ name: 'k.png', type: 'image/png', size: 100 } as unknown as File], value: 'k.png' } }))
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  const btn = root().findAll((n) => n.type === 'button' && n.props['aria-label'] === 'Create draft layout')[0]
  await act(async () => { btn.props.onClick(); await new Promise((r) => setTimeout(r, 20)) })
  assert.match(text(root()), /Apply draft/)
  const cancelBtn = root().findAll((n) => n.type === 'button' && text(n).trim() === 'Cancel draft')[0]
  await act(() => { cancelBtn.props.onClick() })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  assert.doesNotMatch(text(root()), /Apply draft/)
  assert.equal(root().findAll((n) => n.type === 'button' && String(n.props.className).includes('scene-row')).length, 3)
})

test('apply, undo, redo, save and reopen preserves draft objects', async () => {
  const apiBridge = {
    isAvailable: () => true,
    getStatus: async () => ({ ready: true, address: '127.0.0.1:8787', error: null }),
    proposeEdit: async () => ({ kind: 'clarification', message: '?' }),
    analyzePhoto: async () => ({ kind: 'analysis', description: 'x', followUpQuestions: [] }),
    proposeLayout: async () => makeValidDraft(),
  }
  let savedContent: string | null = null
  const projectBridge = {
    isAvailable: () => true,
    setDirty: async () => ({ ok: true }),
    confirmUnsaved: async () => ({ choice: 'discard' as const }),
    confirmClose: async () => ({ ok: true }),
    openProject: async () => ({ canceled: false, filePath: '/tmp/saved.renovacad', content: savedContent ?? '' }),
    saveProject: async (payload: unknown) => {
      const p = payload as { content: string }
      savedContent = p.content
      return { canceled: false, filePath: '/tmp/saved.renovacad' }
    },
    onRequestSaveBeforeQuit: () => () => {},
  }
  const { root } = await mountApp(apiBridge, projectBridge)
  const fileInput = () => host('input', root(), (n) => n.props.type === 'file')
  await act(() => fileInput().props.onChange({ target: { files: [{ name: 'k.png', type: 'image/png', size: 100 } as unknown as File], value: 'k.png' } }))
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  const btn = root().findAll((n) => n.type === 'button' && n.props['aria-label'] === 'Create draft layout')[0]
  await act(async () => { btn.props.onClick(); await new Promise((r) => setTimeout(r, 20)) })
  const applyBtn = host('button', root(), (n) => n.props['aria-label'] === 'Apply draft layout')
  await act(() => { applyBtn.props.onClick() })
  await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
  assert.equal(root().findAll((n) => n.type === 'button' && String(n.props.className).includes('scene-row')).length, 6)

  // Undo should revert to 3
  const undoBtn = host('button', root(), (n) => n.props['aria-label'] === 'Undo (⌘Z)')
  await act(() => { undoBtn.props.onClick() })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  assert.equal(root().findAll((n) => n.type === 'button' && String(n.props.className).includes('scene-row')).length, 3)

  // Redo should go back to 6
  const redoBtn = host('button', root(), (n) => n.props['aria-label'] === 'Redo (⇧⌘Z)')
  await act(() => { redoBtn.props.onClick() })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  assert.equal(root().findAll((n) => n.type === 'button' && String(n.props.className).includes('scene-row')).length, 6)

  // Save
  const saveBtn = root().findAll((n) => n.type === 'button' && String(n.props['aria-label']).includes('Save project'))[0]
  await act(async () => { saveBtn.props.onClick(); await new Promise((r) => setTimeout(r, 20)) })
  assert.ok(savedContent, 'savedContent missing')
  assert.match(savedContent!, /Base cabinet 1/)

  // Modify scene to ensure reopen restores: add dummy change then open
  // Open saved project should have 6 objects
  const openBtn = root().findAll((n) => n.type === 'button' && String(n.props['aria-label']).includes('Open project'))[0]
  await act(async () => { openBtn.props.onClick(); await new Promise((r) => setTimeout(r, 20)) })
  assert.equal(root().findAll((n) => n.type === 'button' && String(n.props.className).includes('scene-row')).length, 6)
})

test('provider unavailability and timeout show error and keep scene intact', async () => {
  const unavailableBridge = {
    isAvailable: () => true,
    getStatus: async () => ({ ready: true, address: '127.0.0.1:8787', error: null }),
    proposeEdit: async () => ({ kind: 'clarification', message: '?' }),
    analyzePhoto: async () => ({ kind: 'analysis', description: 'x', followUpQuestions: [] }),
    proposeLayout: async () => ({ kind: 'error', code: 'service_unavailable', message: 'service unavailable', httpStatus: 503 }),
  }
  let { root } = await mountApp(unavailableBridge, fakeProjectBridge())
  let fileInput = () => host('input', root(), (n) => n.props.type === 'file')
  await act(() => fileInput().props.onChange({ target: { files: [{ name: 'k.png', type: 'image/png', size: 100 } as unknown as File], value: 'k.png' } }))
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  let btn = root().findAll((n) => n.type === 'button' && n.props['aria-label'] === 'Create draft layout')[0]
  await act(async () => { btn.props.onClick(); await new Promise((r) => setTimeout(r, 20)) })
  assert.match(text(root()), /not reachable|unavailable/i)
  assert.equal(root().findAll((n) => n.type === 'button' && String(n.props.className).includes('scene-row')).length, 3)

  const timeoutBridge = {
    isAvailable: () => true,
    getStatus: async () => ({ ready: true, address: '127.0.0.1:8787', error: null }),
    proposeEdit: async () => ({ kind: 'clarification', message: '?' }),
    analyzePhoto: async () => ({ kind: 'analysis', description: 'x', followUpQuestions: [] }),
    proposeLayout: async () => ({ kind: 'error', code: 'provider_timeout', message: 'timeout', httpStatus: 504 }),
  }
  const mounted2 = await mountApp(timeoutBridge, fakeProjectBridge())
  root = mounted2.root
  fileInput = () => host('input', root(), (n) => n.props.type === 'file')
  await act(() => fileInput().props.onChange({ target: { files: [{ name: 'k.png', type: 'image/png', size: 100 } as unknown as File], value: 'k.png' } }))
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  btn = root().findAll((n) => n.type === 'button' && n.props['aria-label'] === 'Create draft layout')[0]
  await act(async () => { btn.props.onClick(); await new Promise((r) => setTimeout(r, 20)) })
  assert.match(text(root()), /timed out/i)
  assert.equal(root().findAll((n) => n.type === 'button' && String(n.props.className).includes('scene-row')).length, 3)
})

test('save/project-switch race: old save does not overwrite new project path and later save of new project succeeds', async () => {
  let firstSaveResolve: (v: unknown) => void = () => {}
  let secondSaveResolve: (v: unknown) => void = () => {}
  let saveCall = 0
  const projectBridge = {
    isAvailable: () => true,
    setDirty: async () => ({ ok: true }),
    confirmUnsaved: async () => ({ choice: 'discard' as const }),
    confirmClose: async () => ({ ok: true }),
    openProject: async () => ({
      canceled: false,
      filePath: '/tmp/new.renovacad',
      content: JSON.stringify({ version: 1, name: 'New Kitchen', scene: [{ id: 'new-01', kind: 'base-cabinet', name: 'New Cabinet', dimensionsMm: { width: 914.4, height: 876.3, depth: 609.6 }, rotationDegrees: 0, positionMm: { x: 0, y: 0, z: 0 } }], selectedId: 'new-01', settings: { unit: 'in', showGrid: true }, camera: { yaw: 0, pitch: 0, projection: 'perspective', zoom: 1 }, viewMode: 'cad', referencePhoto: null }),
    }),
    saveProject: (payload: unknown) => new Promise((res) => {
      saveCall++
      if (saveCall === 1) firstSaveResolve = res as (v: unknown) => void
      else secondSaveResolve = res as (v: unknown) => void
    }),
    onRequestSaveBeforeQuit: () => () => {},
  }
  const apiBridge = {
    isAvailable: () => true,
    getStatus: async () => ({ ready: true, address: '127.0.0.1:8787', error: null }),
    proposeEdit: async () => ({ kind: 'clarification', message: '?' }),
    analyzePhoto: async () => ({ kind: 'analysis', description: 'x', followUpQuestions: [] }),
    proposeLayout: async () => makeValidDraft(),
  }
  const { root } = await mountApp(apiBridge, projectBridge)

  // Initial project is Kitchen Remodel Project, path null
  assert.match(text(root()), /Kitchen Remodel Project/)

  // Trigger first save (will be delayed) — Save As because path null
  const saveBtn = root().findAll((n) => n.type === 'button' && String(n.props['aria-label']).includes('Save project'))[0]
  await act(() => { saveBtn.props.onClick() })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  assert.match(text(root()), /Saving/)

  // While first save pending (dialog/write delay), open new project
  const openBtn = root().findAll((n) => n.type === 'button' && String(n.props['aria-label']).includes('Open project'))[0]
  await act(async () => { openBtn.props.onClick(); await new Promise((r) => setTimeout(r, 20)) })
  assert.match(text(root()), /New Kitchen/)

  // Now resolve first save (old project) with old path
  await act(async () => { firstSaveResolve({ canceled: false, filePath: '/tmp/old.renovacad' }); await new Promise((r) => setTimeout(r, 20)) })
  // New project's path should NOT have been overwritten to old path — it should remain /tmp/new.renovacad
  assert.match(text(root()), /New Kitchen/)
  assert.doesNotMatch(text(root()), /Kitchen Remodel Project/)
  // The status should show new project's path name, not old
  // Check that project label shows new.renovacad, not old
  assert.match(text(root()), /new\.renovacad/i)

  // Now save new project — should succeed and use its own path
  // Make an edit to make it dirty
  const widthField = host('input', root(), (n) => n.props.id === 'field-Width')
  await act(() => { widthField.props.onChange({ target: { value: '40' } }) })
  await act(() => { widthField.props.onBlur() })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  await act(() => { saveBtn.props.onClick() })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  // Resolve second save (for new project) — it was initiated with filePath /tmp/new.renovacad, should return same
  await act(async () => { secondSaveResolve({ canceled: false, filePath: '/tmp/new.renovacad' }); await new Promise((r) => setTimeout(r, 20)) })
  assert.match(text(root()), /Saved/)
  assert.match(text(root()), /new\.renovacad/i)
})

test('existing scene preserved until apply — photo import and draft creation do not mutate', async () => {
  const apiBridge = {
    isAvailable: () => true,
    getStatus: async () => ({ ready: true, address: '127.0.0.1:8787', error: null }),
    proposeEdit: async () => ({ kind: 'clarification', message: '?' }),
    analyzePhoto: async () => ({ kind: 'analysis', description: 'x', followUpQuestions: [] }),
    proposeLayout: async () => makeValidDraft(),
  }
  const { root } = await mountApp(apiBridge, fakeProjectBridge())
  const initialRows = root().findAll((n) => n.type === 'button' && String(n.props.className).includes('scene-row')).length
  const fileInput = () => host('input', root(), (n) => n.props.type === 'file')
  await act(() => fileInput().props.onChange({ target: { files: [{ name: 'k.png', type: 'image/png', size: 100 } as unknown as File], value: 'k.png' } }))
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  assert.equal(root().findAll((n) => n.type === 'button' && String(n.props.className).includes('scene-row')).length, initialRows)
  const btn = root().findAll((n) => n.type === 'button' && n.props['aria-label'] === 'Create draft layout')[0]
  await act(async () => { btn.props.onClick(); await new Promise((r) => setTimeout(r, 20)) })
  // Still not mutated until apply
  assert.equal(root().findAll((n) => n.type === 'button' && String(n.props.className).includes('scene-row')).length, initialRows)
  assert.match(text(root()), /Draft layout — approximate/)
})
