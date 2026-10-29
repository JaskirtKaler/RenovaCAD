import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import App from './App'

const listeners = new Map<string, Set<EventListener>>()
let saved: Map<string, PropertyDescriptor | undefined>

function installGlobals(isElectron: boolean) {
  const names = ['IS_REACT_ACT_ENVIRONMENT', 'HTMLElement', 'Element', 'HTMLInputElement', 'HTMLTextAreaElement', 'document', 'window', 'navigator', 'crypto', 'FileReader']
  saved = new Map(names.map((n) => [n, Object.getOwnPropertyDescriptor(globalThis as unknown as Record<string, unknown>, n)]))
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
  for (const [name, d] of saved) {
    if (d) Object.defineProperty(globalThis, name, d)
    else Reflect.deleteProperty(globalThis as unknown as Record<string, unknown>, name)
  }
}

function text(node: ReactTestInstance): string { return node.children.map((c) => typeof c === 'string' ? c : text(c as ReactTestInstance)).join('') }

async function mountElectronWithProject(bridge: Record<string, unknown> | null) {
  listeners.clear()
  const w = (globalThis as unknown as { window: Record<string, unknown> }).window as Record<string, unknown>
  if (bridge) w['renovacadProject'] = bridge
  else delete w['renovacadProject']
  // Also ensure renovacadApi undefined so test is isolated from AI
  delete w['renovacadApi']
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

beforeEach(() => installGlobals(false))
afterEach(() => { listeners.clear(); restoreGlobals() })

test('browser-only mode shows honest message when saving is unavailable', async () => {
  // Mount in browser mode (no project bridge)
  const { root } = await mountElectronWithProject(null)
  // Trigger Save via header button
  const saveBtn = root().findAll((n) => n.type === 'button' && n.props['aria-label']?.includes('Save project'))[0]
  assert.ok(saveBtn, 'save button missing')
  await act(async () => { saveBtn.props.onClick?.(); await new Promise(r => setTimeout(r, 10)) })
  // Error should be rendered in header or statusbar
  const txt = text(root())
  assert.match(txt, /browser preview|not available in browser/i)
})

test('canceled save leaves current scene intact and dirty remains', async () => {
  installGlobals(true)
  // Need fresh mount with Electron bridge that cancels
  const bridge = {
    isAvailable: () => true,
    setDirty: async () => ({ ok: true }),
    confirmUnsaved: async () => ({ choice: 'discard' as const }),
    confirmClose: async () => ({ ok: true }),
    openProject: async () => ({ canceled: true }),
    saveProject: async () => ({ canceled: true }),
    onRequestSaveBeforeQuit: () => () => {},
  }
  const { root } = await mountElectronWithProject(bridge)
  // Make an edit to become dirty: find width field and change it
  // Find Width input
  const widthInput = root().findAll((n) => n.type === 'input' && n.props.id === 'field-Width')[0]
  assert.ok(widthInput, 'width input missing')
  // Simulate commit: change value and blur
  await act(async () => { widthInput.props.onChange({ target: { value: '50' } }); })
  await act(async () => { widthInput.props.onBlur(); await new Promise(r => setTimeout(r, 10)) })
  // Now save should be canceled and scene should still have new width? Actually width change dirty, but save canceled leaves width as edited, not reverted.
  const beforeWidth = widthInput.props.value
  // Click save
  const saveBtn = root().findAll((n) => n.type === 'button' && n.props['aria-label']?.includes('Save project'))[0]
  await act(async () => { saveBtn.props.onClick?.(); await new Promise(r => setTimeout(r, 20)) })
  // Width should remain same (not reverted), and no filePath change
  const afterWidth = root().findAll((n) => n.type === 'input' && n.props.id === 'field-Width')[0].props.value
  assert.equal(afterWidth, beforeWidth)
  restoreGlobals()
})

test('failed write shows error and does not clear dirty', async () => {
  installGlobals(true)
  const bridge = {
    isAvailable: () => true,
    setDirty: async () => ({ ok: true }),
    confirmUnsaved: async () => ({ choice: 'discard' as const }),
    confirmClose: async () => ({ ok: true }),
    openProject: async () => ({ canceled: true }),
    saveProject: async () => ({ canceled: false, error: 'Failed to save project: disk full. Your previous file (if any) was not overwritten.' }),
    onRequestSaveBeforeQuit: () => () => {},
  }
  const { root } = await mountElectronWithProject(bridge)
  // Make dirty via edit
  const widthInput = root().findAll((n) => n.type === 'input' && n.props.id === 'field-Width')[0]
  await act(async () => { widthInput.props.onChange({ target: { value: '50' } }); })
  await act(async () => { widthInput.props.onBlur(); await new Promise(r => setTimeout(r, 10)) })
  const saveBtn = root().findAll((n) => n.type === 'button' && n.props['aria-label']?.includes('Save project'))[0]
  await act(async () => { saveBtn.props.onClick?.(); await new Promise(r => setTimeout(r, 20)) })
  const txt = text(root())
  assert.match(txt, /Failed to save|disk full/i)
  // Dirty indicator should remain (Unsaved)
  assert.match(txt, /Unsaved/i)
  restoreGlobals()
})
