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
      ],
      description: 'Draft for test',
      followUpQuestions: ['Q?'],
      warnings: ['Approximate dimensions — please verify'],
      isApproximate: true,
    }
  }
}

beforeEach(() => installGlobals(true))
afterEach(() => { listeners.clear(); restoreGlobals() })

test('apply with empty name keeps draft visible and explains, then corrected draft succeeds', async () => {
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
  assert.match(text(root()), /Draft for test/)

  // Make name empty for first object
  const nameInput = root().findAll((n) => n.type === 'input' && n.props['aria-label'] === 'Base cabinet 1 name')[0]
  assert.ok(nameInput)
  await act(() => { nameInput.props.onChange({ target: { value: '' } }) })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

  const applyBtn = host('button', root(), (n) => n.props['aria-label'] === 'Apply draft layout')
  await act(() => { applyBtn.props.onClick() })
  await act(async () => { await new Promise((r) => setTimeout(r, 10)) })

  // Should keep draft visible and show explanation, not clear, scene unchanged
  assert.match(text(root()), /empty name/i)
  assert.match(text(root()), /Draft for test/) // draft still visible
  assert.equal(root().findAll((n) => n.type === 'button' && String(n.props.className).includes('scene-row')).length, 3)

  // Correct name
  const nameInput2 = root().findAll((n) => n.type === 'input' && n.props['aria-label'] === ' name')[0] // aria-label for empty is " name"
  // Find by placeholder? Instead find first name input again
  const firstNameInput = root().findAll((n) => n.type === 'input' && typeof n.props['aria-label'] === 'string' && n.props['aria-label'].includes('name'))[0]
  await act(() => { firstNameInput.props.onChange({ target: { value: 'Corrected Cabinet' } }) })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

  await act(() => { applyBtn.props.onClick() })
  await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
  // Now should succeed, draft cleared, scene added
  assert.doesNotMatch(text(root()), /Draft for test/)
  assert.equal(root().findAll((n) => n.type === 'button' && String(n.props.className).includes('scene-row')).length, 5)
  assert.match(text(root()), /Applied 2 draft objects/)
})

test('apply with rotation outside ±360 keeps draft and explains', async () => {
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

  const rotInput = root().findAll((n) => n.type === 'input' && n.props['aria-label'] === 'Base cabinet 1 rotation')[0]
  assert.ok(rotInput)
  await act(() => { rotInput.props.onChange({ target: { value: '500' } }) })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

  const applyBtn = host('button', root(), (n) => n.props['aria-label'] === 'Apply draft layout')
  await act(() => { applyBtn.props.onClick() })
  await act(async () => { await new Promise((r) => setTimeout(r, 10)) })

  assert.match(text(root()), /invalid rotation/i)
  assert.match(text(root()), /Draft for test/)
  assert.equal(root().findAll((n) => n.type === 'button' && String(n.props.className).includes('scene-row')).length, 3)

  // Correct rotation
  await act(() => { rotInput.props.onChange({ target: { value: '45' } }) })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  await act(() => { applyBtn.props.onClick() })
  await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
  assert.equal(root().findAll((n) => n.type === 'button' && String(n.props.className).includes('scene-row')).length, 5)
  assert.doesNotMatch(text(root()), /Draft for test/)
})

test('stale draft via scene edit during review is blocked with explanation and preserves scene', async () => {
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
  assert.match(text(root()), /Draft for test/)

  // Edit scene while reviewing (e.g., nudge selected object)
  const widthField = host('input', root(), (n) => n.props.id === 'field-Width')
  await act(() => { widthField.props.onChange({ target: { value: '40' } }) })
  await act(() => { widthField.props.onBlur() })
  await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
  // Now scene revision has changed
  const applyBtn = host('button', root(), (n) => n.props['aria-label'] === 'Apply draft layout')
  await act(() => { applyBtn.props.onClick() })
  await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
  assert.match(text(root()), /Scene changed since draft was created/i)
  assert.match(text(root()), /Draft for test/) // still visible
  assert.equal(root().findAll((n) => n.type === 'button' && String(n.props.className).includes('scene-row')).length, 3) // not 5, still 3 plus edited? Actually edit changed width but still 3 objects, so should be 3
})

test('stale draft via scene edit during pending request is discarded with explanation', async () => {
  let resolveLayout: (v: unknown) => void = () => {}
  const apiBridge = {
    isAvailable: () => true,
    getStatus: async () => ({ ready: true, address: '127.0.0.1:8787', error: null }),
    proposeEdit: async () => ({ kind: 'clarification', message: '?' }),
    analyzePhoto: async () => ({ kind: 'analysis', description: 'x', followUpQuestions: [] }),
    proposeLayout: () => new Promise((res) => { resolveLayout = res as (v: unknown) => void }),
  }
  const { root } = await mountApp(apiBridge, fakeProjectBridge())
  const fileInput = () => host('input', root(), (n) => n.props.type === 'file')
  await act(() => fileInput().props.onChange({ target: { files: [{ name: 'k.png', type: 'image/png', size: 100 } as unknown as File], value: 'k.png' } }))
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  const btn = root().findAll((n) => n.type === 'button' && n.props['aria-label'] === 'Create draft layout')[0]
  await act(() => { btn.props.onClick() })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  assert.match(text(root()), /Creating draft/)

  // Edit scene while request pending (e.g., edit width)
  const widthField = host('input', root(), (n) => n.props.id === 'field-Width')
  await act(() => { widthField.props.onChange({ target: { value: '40' } }) })
  await act(() => { widthField.props.onBlur() })
  await act(async () => { await new Promise((r) => setTimeout(r, 10)) })

  // Now resolve layout — should be considered stale and show error, not draft
  await act(async () => { resolveLayout(makeValidDraft()); await new Promise((r) => setTimeout(r, 20)) })
  assert.match(text(root()), /Scene changed while draft was being created/i)
  assert.doesNotMatch(text(root()), /Draft for test/)
  // Scene should be preserved at 3 (original count), not 3+2 draft
  const count = root().findAll((n) => n.type === 'button' && String(n.props.className).includes('scene-row')).length
  assert.equal(count, 3)
})

test('display units and approx/edited distinction in review', async () => {
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

  // Default unit is in, so inputs should show in and badges should be approx
  const txtBefore = text(root())
  assert.match(txtBefore, /Width \(in\)/)
  assert.match(txtBefore, /approx/)
  // Width for base cabinet 914.4 mm = 36 in, should be displayed as 36
  const widthInput = root().findAll((n) => n.type === 'input' && n.props['aria-label'] === 'Base cabinet 1 width')[0]
  assert.equal(String(widthInput.props.value), '36')

  // Edit width to 40 in (should mark as edited and convert to mm internally)
  await act(() => { widthInput.props.onChange({ target: { value: '40' } }) })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  assert.match(text(root()), /edited/)
  // After edit, width should be edited badge for that field
  const editedBadges = root().findAll((n) => n.type === 'span' && n.props.className === 'edited-badge')
  assert.ok(editedBadges.length >= 1, 'should have edited badge')

  // Switch unit to mm via settings? But we can check that display changes when unit changes via settings
  // Simulate changing unit via workspace settings? The unit state is not directly exposed, but we can verify mmToDisplay logic by checking that after edit, internal mm is 1016 (40*25.4)
  // Apply and check that saved width is 40 in = 1016 mm => display in inspector should be 40
  const applyBtn = host('button', root(), (n) => n.props['aria-label'] === 'Apply draft layout')
  await act(() => { applyBtn.props.onClick() })
  await act(async () => { await new Promise((r) => setTimeout(r, 10)) })
  const field = root().findAll((n) => n.type === 'input' && n.props.id === 'field-Width')[0]
  assert.match(String(field.props.value), /40/)
})
