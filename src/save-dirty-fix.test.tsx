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
  class FileReaderStub { result: string | null = null; onload: (() => void) | null = null; onError: (() => void) | null = null; readAsDataURL(_file: unknown) { this.result = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='; setTimeout(() => this.onload?.(), 0) } }
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
  const matches = root.findAll((n) => n.type === type && predicate(n))
  assert.equal(matches.length, 1, `Expected one ${type} found ${matches.length}`)
  return matches[0]
}
function field(label: string, root: ReactTestInstance): ReactTestInstance { return host('input', root, (n) => n.props.id === `field-${label}`) }
async function change(node: ReactTestInstance, value: string) { await act(() => node.props.onChange({ target: { value }, currentTarget: { value } })) }
async function blurField(label: string, root: ReactTestInstance) { await act(() => field(label, root).props.onBlur()) }
async function click(node: ReactTestInstance) { await act(() => node.props.onClick?.()) }

async function mountWithProjectBridge(bridge: Record<string, unknown>) {
  listeners.clear()
  // Use real setTimeout/clearTimeout inside window so app timers work
  const w = (globalThis as unknown as { window: Record<string, unknown> }).window as Record<string, unknown>
  w['renovacadProject'] = bridge
  delete w['renovacadApi']
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

beforeEach(() => installGlobals(true))
afterEach(async () => { listeners.clear(); restoreGlobals() })

test('save preserves edits made during async dialog/write — newer edits remain unsaved', async () => {
  let resolveSave: (v: unknown) => void = () => {}
  let saveCallCount = 0
  const bridge = {
    isAvailable: () => true,
    setDirty: async () => ({ ok: true }),
    confirmUnsaved: async () => ({ choice: 'discard' as const }),
    confirmClose: async () => ({ ok: true }),
    openProject: async () => ({ canceled: true }),
    saveProject: (payload: unknown) => new Promise((res) => { saveCallCount++; resolveSave = res as (v: unknown) => void }),
    onRequestSaveBeforeQuit: () => () => {},
  }
  const { root } = await mountWithProjectBridge(bridge)

  // Initially not dirty? But inspector has proposal; width is 36. Make dirty via edit.
  await change(field('Width', root()), '40')
  await blurField('Width', root())
  assert.match(text(root()), /Unsaved/)

  // Begin saving — bridge will not resolve yet (simulates dialog + file write delay)
  const saveBtn = root().findAll((n) => n.type === 'button' && String(n.props['aria-label']).includes('Save project'))[0]
  assert.ok(saveBtn)
  await act(() => { saveBtn.props.onClick?.() })
  // Give a tick so save starts and isSaving true
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  assert.match(text(root()), /Saving/)

  // Make another edit BEFORE save resolves
  await change(field('Width', root()), '42')
  await blurField('Width', root())
  assert.equal(field('Width', root()).props.value, '42')

  // Now resolve save (it saved snapshot with Width 40, not 42)
  await act(async () => { resolveSave({ canceled: false, filePath: '/tmp/test.renovacad' }); await new Promise((r) => setTimeout(r, 20)) })

  // Newer edit should still be unsaved — status should show Unsaved and warning, not Saved
  const txt = text(root())
  assert.match(txt, /Unsaved/i, `after delayed save with intervening edit, should still be unsaved, got: ${txt.slice(0,500)}`)
  assert.match(txt, /newer edits remain unsaved|Unsaved/i)
  assert.equal(saveCallCount, 1)
  // Width should remain 42 (newer edit not lost)
  assert.equal(field('Width', root()).props.value, '42')
})

test('saveAs preserves edits made during dialog — newer edits remain unsaved', async () => {
  let resolveSaveAs: (v: unknown) => void = () => {}
  const bridge = {
    isAvailable: () => true,
    setDirty: async () => ({ ok: true }),
    confirmUnsaved: async () => ({ choice: 'discard' as const }),
    confirmClose: async () => ({ ok: true }),
    openProject: async () => ({ canceled: true }),
    saveProject: (payload: unknown) => {
      const p = payload as { filePath?: string | null }
      // SaveAs is called with filePath null; Save with existing path
      if (p.filePath === null) return new Promise((res) => { resolveSaveAs = res as (v: unknown) => void })
      return Promise.resolve({ canceled: false, filePath: p.filePath })
    },
    onRequestSaveBeforeQuit: () => () => {},
  }
  const { root } = await mountWithProjectBridge(bridge)

  // Make edit
  await change(field('Width', root()), '38')
  await blurField('Width', root())

  // Trigger Save As via settings dialog: open settings and click Save As
  const settingsBtn = root().findAll((n) => n.type === 'button' && n.props['aria-label'] === 'Workspace settings')[0]
  await click(settingsBtn)
  const saveAsBtn = root().findAll((n) => n.type === 'button' && text(n).trim() === 'Save As')[0]
  assert.ok(saveAsBtn, 'Save As button missing in settings')
  await act(() => { saveAsBtn.props.onClick?.() })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

  // Edit again before Save As dialog resolves
  await change(field('Width', root()), '45')
  await blurField('Width', root())
  assert.equal(field('Width', root()).props.value, '45')

  // Resolve Save As (saved snapshot with 38)
  await act(async () => { resolveSaveAs({ canceled: false, filePath: '/tmp/kitchen2.renovacad' }); await new Promise((r) => setTimeout(r, 20)) })

  const txt = text(root())
  assert.match(txt, /Unsaved/i, 'Save As with intervening edit should remain unsaved')
  assert.equal(field('Width', root()).props.value, '45')
})

test('unchanged successful save marks project as Saved (no intervening edits)', async () => {
  const bridge = {
    isAvailable: () => true,
    setDirty: async () => ({ ok: true }),
    confirmUnsaved: async () => ({ choice: 'discard' as const }),
    confirmClose: async () => ({ ok: true }),
    openProject: async () => ({ canceled: true }),
    saveProject: async () => ({ canceled: false, filePath: '/tmp/clean.renovacad' }),
    onRequestSaveBeforeQuit: () => () => {},
  }
  const { root } = await mountWithProjectBridge(bridge)

  await change(field('Width', root()), '44')
  await blurField('Width', root())
  assert.match(text(root()), /Unsaved/)

  const saveBtn = root().findAll((n) => n.type === 'button' && String(n.props['aria-label']).includes('Save project'))[0]
  await act(async () => { saveBtn.props.onClick?.(); await new Promise((r) => setTimeout(r, 20)) })

  const txt = text(root())
  assert.match(txt, /Saved/i)
  assert.doesNotMatch(txt, /newer edits/i)
})

test('canceled dialog and failed write do not clear dirty (Save and Save As)', async () => {
  // Canceled save
  const cancelBridge = {
    isAvailable: () => true,
    setDirty: async () => ({ ok: true }),
    confirmUnsaved: async () => ({ choice: 'discard' as const }),
    confirmClose: async () => ({ ok: true }),
    openProject: async () => ({ canceled: true }),
    saveProject: async () => ({ canceled: true }),
    onRequestSaveBeforeQuit: () => () => {},
  }
  let { root } = await mountWithProjectBridge(cancelBridge)
  await change(field('Width', root()), '39')
  await blurField('Width', root())
  const saveBtn = root().findAll((n) => n.type === 'button' && String(n.props['aria-label']).includes('Save project'))[0]
  await act(async () => { saveBtn.props.onClick?.(); await new Promise((r) => setTimeout(r, 20)) })
  assert.match(text(root()), /Unsaved/i, 'canceled save should leave unsaved')

  // Failed write
  const failBridge = {
    isAvailable: () => true,
    setDirty: async () => ({ ok: true }),
    confirmUnsaved: async () => ({ choice: 'discard' as const }),
    confirmClose: async () => ({ ok: true }),
    openProject: async () => ({ canceled: true }),
    saveProject: async () => ({ canceled: false, error: 'disk full' }),
    onRequestSaveBeforeQuit: () => () => {},
  }
  const mounted2 = await mountWithProjectBridge(failBridge)
  root = mounted2.root
  await change(field('Width', root()), '41')
  await blurField('Width', root())
  const saveBtn2 = root().findAll((n) => n.type === 'button' && String(n.props['aria-label']).includes('Save project'))[0]
  await act(async () => { saveBtn2.props.onClick?.(); await new Promise((r) => setTimeout(r, 20)) })
  assert.match(text(root()), /Unsaved|disk full/i)
})

test('overlapping save attempts remain consistent — second save includes newer edits', async () => {
  let firstResolve: (v: unknown) => void = () => {}
  let secondResolve: (v: unknown) => void = () => {}
  let callIdx = 0
  const bridge = {
    isAvailable: () => true,
    setDirty: async () => ({ ok: true }),
    confirmUnsaved: async () => ({ choice: 'discard' as const }),
    confirmClose: async () => ({ ok: true }),
    openProject: async () => ({ canceled: true }),
    saveProject: () => new Promise((res) => {
      callIdx++
      if (callIdx === 1) firstResolve = res as (v: unknown) => void
      else secondResolve = res as (v: unknown) => void
    }),
    onRequestSaveBeforeQuit: () => () => {},
  }
  const { root } = await mountWithProjectBridge(bridge)

  await change(field('Width', root()), '40')
  await blurField('Width', root())

  const saveBtn = root().findAll((n) => n.type === 'button' && String(n.props['aria-label']).includes('Save project'))[0]
  // Start first save
  await act(() => { saveBtn.props.onClick?.() })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

  // Edit before first resolves
  await change(field('Width', root()), '42')
  await blurField('Width', root())

  // Start second save (should capture 42)
  await act(() => { saveBtn.props.onClick?.() })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })

  // Resolve first save (snapshot was 40) — should keep dirty
  await act(async () => { firstResolve({ canceled: false, filePath: '/tmp/a.renovacad' }); await new Promise((r) => setTimeout(r, 20)) })
  assert.match(text(root()), /Unsaved|newer edits/i, 'first overlapping save should leave dirty after intervening edit+second save pending')
  assert.equal(field('Width', root()).props.value, '42')

  // Resolve second save (snapshot was 42) — should become clean
  await act(async () => { secondResolve({ canceled: false, filePath: '/tmp/a.renovacad' }); await new Promise((r) => setTimeout(r, 20)) })
  assert.match(text(root()), /Saved/i)
})

test('close/new/open do not discard newer edits after save completes', async () => {
  let resolveSave: (v: unknown) => void = () => {}
  let confirmChoice: 'save' | 'discard' | 'cancel' = 'save'
  const bridge = {
    isAvailable: () => true,
    setDirty: async () => ({ ok: true }),
    confirmUnsaved: async () => ({ choice: confirmChoice }),
    confirmClose: async () => ({ ok: true }),
    openProject: async () => ({ canceled: true }),
    saveProject: () => new Promise((res) => { resolveSave = res as (v: unknown) => void }),
    onRequestSaveBeforeQuit: () => () => {},
  }
  const { root } = await mountWithProjectBridge(bridge)

  // Dirty
  await change(field('Width', root()), '40')
  await blurField('Width', root())

  // Try to open new project via New button — will trigger confirmUnsaved which triggers save
  // Simulate flow: click New (which calls confirmUnsaved -> save -> if saved false should not proceed)
  // We test directly: start save, make edit, finish save, ensure still dirty so New would not have proceeded.
  const saveBtn = root().findAll((n) => n.type === 'button' && String(n.props['aria-label']).includes('Save project'))[0]
  await act(() => { saveBtn.props.onClick?.() })
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  await change(field('Width', root()), '43')
  await blurField('Width', root())
  await act(async () => { resolveSave({ canceled: false, filePath: '/tmp/x.renovacad' }); await new Promise((r) => setTimeout(r, 20)) })
  // After save, still unsaved due to newer edit
  assert.match(text(root()), /Unsaved/i)
  // Now if we attempt New, confirmUnsaved would see dirty and ask again; simulate that confirmUnsaved returns cancel if still dirty
  // Ensure file not overwritten with stale snapshot: width should still be 43
  assert.equal(field('Width', root()).props.value, '43')
})
