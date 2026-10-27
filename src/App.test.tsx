import assert from 'node:assert/strict'
import { after, afterEach, beforeEach, test } from 'node:test'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import App from './App'

// These tests render an in-memory React tree. They do not exercise a browser,
// focus behavior, image decoding, file dialogs, scrolling position, or layout.
const listeners = new Map<string, Set<EventListener>>()
const replacedGlobals = ['IS_REACT_ACT_ENVIRONMENT', 'HTMLElement', 'Element', 'HTMLInputElement', 'HTMLTextAreaElement', 'document', 'window']
const originalGlobals = new Map(replacedGlobals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
class ElementStub { tagName = 'DIV'; isContentEditable = false; focus() {}; closest() { return null } }
class InputStub extends ElementStub {}
class TextareaStub extends ElementStub {}
Object.defineProperties(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  HTMLElement: { configurable: true, value: ElementStub },
  Element: { configurable: true, value: ElementStub },
  HTMLInputElement: { configurable: true, value: InputStub },
  HTMLTextAreaElement: { configurable: true, value: TextareaStub },
  document: { configurable: true, value: {
    activeElement: null, querySelector: () => null,
    addEventListener: (kind: string, listener: EventListener) => {
      if (!listeners.has(kind)) listeners.set(kind, new Set())
      listeners.get(kind)?.add(listener)
    },
    removeEventListener: (kind: string, listener: EventListener) => listeners.get(kind)?.delete(listener),
  } },
  window: { configurable: true, value: {
    setTimeout, clearTimeout,
    addEventListener: (kind: string, listener: EventListener) => {
      if (!listeners.has(kind)) listeners.set(kind, new Set())
      listeners.get(kind)?.add(listener)
    },
    removeEventListener: (kind: string, listener: EventListener) => listeners.get(kind)?.delete(listener),
  } },
})

let renderer: ReactTestRenderer | undefined
beforeEach(async () => {
  listeners.clear()
  await act(() => { renderer = create(<App />, { createNodeMock: () => ({
    style: { cursor: '' }, focus() {}, click() {}, scrollIntoView() {}, contains: () => false,
    addEventListener(kind: string, listener: EventListener) { if (!listeners.has(kind)) listeners.set(kind, new Set()); listeners.get(kind)?.add(listener) },
    removeEventListener(kind: string, listener: EventListener) { listeners.get(kind)?.delete(listener) },
    querySelector: () => null, querySelectorAll: () => [],
  }) }) })
})
afterEach(async () => { await act(() => renderer?.unmount()); renderer = undefined })
after(() => {
  for (const [name, descriptor] of originalGlobals) {
    if (descriptor) Object.defineProperty(globalThis, name, descriptor)
    else Reflect.deleteProperty(globalThis, name)
  }
})

function root(): ReactTestInstance {
  if (!renderer) throw new Error('App is not mounted')
  return renderer.root
}
function text(node: ReactTestInstance): string {
  return node.children.map((child) => typeof child === 'string' ? child : text(child)).join('')
}
function host(type: string, predicate: (node: ReactTestInstance) => boolean): ReactTestInstance {
  const matches = root().findAll((node) => node.type === type && predicate(node))
  assert.equal(matches.length, 1, `Expected one ${type} control; found ${matches.length}`)
  return matches[0]
}
function button(label: string): ReactTestInstance { return host('button', (node) => node.props['aria-label'] === label) }
function namedButton(name: string): ReactTestInstance { return host('button', (node) => text(node).trim() === name) }
function menuButton(name: string): ReactTestInstance {
  const menu = root().findByProps({ role: 'group', 'aria-label': 'Add objects' })
  const matches = menu.findAll((node) => node.type === 'button' && text(node).trim() === name)
  assert.equal(matches.length, 1); return matches[0]
}
function field(label: string): ReactTestInstance { return host('input', (node) => node.props.id === `field-${label}`) }
function rows(): ReactTestInstance[] { return root().findAll((node) => node.type === 'button' && String(node.props.className).split(' ').includes('scene-row')) }
function tab(id: string): ReactTestInstance { return host('button', (node) => node.props.id === `tab-${id}`) }
function selectedTab(): string { return host('button', (node) => node.props.role === 'tab' && node.props['aria-selected']).props.id }
async function click(node: ReactTestInstance) {
  assert.ok(!node.props.disabled, `Cannot click disabled control: ${text(node) || node.props['aria-label']}`)
  await act(() => node.props.onClick?.({ detail: 0, preventDefault() {}, stopPropagation() {} }))
}
async function change(node: ReactTestInstance, value: string) {
  await act(() => node.props.onChange({ target: { value }, currentTarget: { value } }))
}
async function edit(label: string, value: string) {
  await change(field(label), value)
  await act(() => field(label).props.onBlur())
}
async function inputKey(label: string, key: string) {
  await act(() => field(label).props.onKeyDown({ key, currentTarget: { blur: () => field(label).props.onBlur() }, preventDefault() {} }))
}
async function keyboard(key: string, options: { metaKey?: boolean; ctrlKey?: boolean; shiftKey?: boolean; target?: ElementStub } = {}) {
  const { target, ...modifiers } = options
  const event = Object.assign(new Event('keydown', { cancelable: true }), { key, metaKey: false, ctrlKey: false, altKey: false, shiftKey: false, ...modifiers })
  if (target) Object.defineProperty(event, 'target', { value: target })
  await act(() => { for (const listener of listeners.get('keydown') ?? []) listener(event) })
}
function sceneGeometry(): string {
  const scene = host('svg', (node) => String(node.props.className).split(' ').includes('kitchen-preview'))
  return JSON.stringify(scene.findAll((node) => typeof node.type === 'string' && ['polygon', 'line', 'path', 'g'].includes(node.type)).map((node) => [node.type, node.props.points, node.props.d, node.props.x1, node.props.y1, node.props.x2, node.props.y2, node.props.transform]))
}
async function openSettings() { await click(button('Workspace settings')) }
async function units(unit: 'in' | 'mm') {
  await openSettings(); await click(namedButton(unit)); await click(button('Close dialog'))
}

test('opens the prepared kitchen with a selected cabinet and pending proposal', () => {
  assert.equal(rows().length, 3)
  assert.equal(field('Width').props.value, '36')
  assert.equal(selectedTab(), 'tab-cad')
  assert.equal(button('Undo (⌘Z)').props.disabled, true)
  assert.ok(namedButton('Apply change'))
})

test('every toolbar tool can be selected and the object menu toggles', async () => {
  for (const label of ['Move (M)', 'Measure (R)', 'Annotate (A)', 'Select (V)']) {
    await click(button(label)); assert.equal(button(label).props['aria-pressed'], true)
  }
  await click(button('Objects (O)')); assert.ok(menuButton('Wall cabinet'))
  await click(button('Objects (O)')); assert.equal(root().findAll((node) => node.props.className === 'object-menu').length, 0)
})

test('tool shortcuts open the object menu and another tool closes it', async () => {
  await keyboard('o'); assert.ok(menuButton('Wall cabinet'))
  await keyboard('m'); assert.equal(button('Move (M)').props['aria-pressed'], true)
  assert.equal(root().findAll((node) => node.props.className === 'object-menu').length, 0)
  for (const [key, label] of [['v', 'Select (V)'], ['r', 'Measure (R)'], ['a', 'Annotate (A)']]) {
    await keyboard(key); assert.equal(button(label).props['aria-pressed'], true)
  }
  await keyboard('o')
  const outside = new Event('pointerdown')
  Object.defineProperty(outside, 'target', { value: new ElementStub() })
  await act(() => { for (const listener of listeners.get('pointerdown') ?? []) listener(outside) })
  assert.equal(root().findAll((node) => node.props.className === 'object-menu').length, 0)
})

test('all five object menu entries add and select their object', async () => {
  for (const [index, name] of ['Base cabinet', 'Wall cabinet', 'Tall cabinet', 'Wall', 'Sink'].entries()) {
    await click(button('Objects (O)')); await click(menuButton(name))
    assert.equal(rows().length, 4 + index)
    const selected = rows().find((node) => node.props['aria-pressed'])
    assert.ok(selected); assert.equal(text(selected).trim(), name)
  }
})

test('quick additions and the scene add button work', async () => {
  for (const name of ['Cabinet', 'Wall', 'Sink']) await click(namedButton(name))
  assert.equal(rows().length, 6)
  await click(button('Add object')); assert.ok(menuButton('Tall cabinet'))
  await keyboard('Escape')
  await click(button('Delete selected object')); assert.equal(rows().length, 5)
})

test('selection works from the object list and the scene', async () => {
  await click(rows()[1]); assert.equal(field('Height').props.value, '30')
  const cabinet = host('g', (node) => node.props.role === 'button' && String(node.props['aria-label']).startsWith('Base cabinet,'))
  await click(cabinet); assert.equal(field('Height').props.value, '34.5')
})

test('delete, undo, and redo buttons update objects and available history', async () => {
  await click(button('Delete selected object')); assert.equal(rows().length, 2)
  await click(button('Undo (⌘Z)')); assert.equal(rows().length, 3)
  await click(button('Redo (⇧⌘Z)')); assert.equal(rows().length, 2)
  assert.equal(button('Redo (⇧⌘Z)').props.disabled, true)
})

test('keyboard history and delete work while typing is protected', async () => {
  await edit('Width', '42'); await keyboard('z', { metaKey: true })
  assert.equal(field('Width').props.value, '36')
  await keyboard('z', { ctrlKey: true, shiftKey: true }); assert.equal(field('Width').props.value, '42')
  await keyboard('Delete', { target: new InputStub() }); assert.equal(rows().length, 3)
  await keyboard('Backspace'); assert.equal(rows().length, 2)
})

test('all four numeric controls commit valid values on blur and rotation resets', async () => {
  for (const [label, value] of [['Width', '42'], ['Height', '40'], ['Depth', '25'], ['Rotation', '45']]) {
    await edit(label, value); assert.equal(field(label).props.value, value)
  }
  await click(button('Reset rotation')); assert.equal(field('Rotation').props.value, '0')
})

test('Enter commits a numeric draft and Escape cancels another draft', async () => {
  await change(field('Width'), '42'); await inputKey('Width', 'Enter')
  assert.equal(field('Width').props.value, '42')
  await change(field('Width'), '48'); await inputKey('Width', 'Escape')
  assert.equal(field('Width').props.value, '42')
  await click(button('Undo (⌘Z)')); assert.equal(field('Width').props.value, '36')
})

test('empty and out-of-range numeric drafts are rejected without editing', async () => {
  for (const [label, invalid, original] of [['Width', '', '36'], ['Width', '0', '36'], ['Height', '394', '34.5'], ['Depth', '-3', '24'], ['Rotation', '361', '0'], ['Rotation', '-361', '0']]) {
    await edit(label, invalid)
    assert.equal(field(label).props.value, original)
    assert.equal(field(label).props['aria-invalid'], true)
  }
  assert.equal(button('Undo (⌘Z)').props.disabled, true)
})

test('leaving an unchanged inch field preserves the pending proposal and history', async () => {
  await act(() => field('Depth').props.onBlur())
  assert.equal(field('Depth').props.value, '24')
  assert.equal(button('Undo (⌘Z)').props.disabled, true)
  assert.ok(namedButton('Apply change'))
})

test('approval stays attached to its original object and can be undone and redone', async () => {
  await click(rows()[1]); await click(namedButton('Apply change'))
  assert.equal(field('Width').props.value, '36')
  await click(rows()[0]); assert.equal(field('Width').props.value, '42')
  await click(button('Undo (⌘Z)')); assert.equal(field('Width').props.value, '36')
  await click(button('Redo (⇧⌘Z)')); assert.equal(field('Width').props.value, '42')
})

test('cancel and retry leave the scene unchanged until the new proposal is applied', async () => {
  await click(namedButton('Cancel')); assert.equal(field('Width').props.value, '36')
  assert.equal(button('Undo (⌘Z)').props.disabled, true)
  await click(namedButton('Try another sample change')); await click(namedButton('Apply change'))
  assert.equal(field('Width').props.value, '42')
})

test('reaching maximum width disables another sample resize', async () => {
  await units('mm'); await edit('Width', '9900')
  await click(namedButton('Try sample resize')); await click(namedButton('Apply change'))
  assert.equal(field('Width').props.value, '10000')
  assert.equal(namedButton('Try another sample change').props.disabled, true)
})

test('all workspace views and their keyboard navigation select the corresponding panel', async () => {
  for (const id of ['photo', 'render', 'cad']) { await click(tab(id)); assert.equal(selectedTab(), `tab-${id}`) }
  for (const [key, expected] of [['ArrowRight', 'render'], ['Home', 'photo'], ['End', 'render'], ['ArrowRight', 'photo']]) {
    await act(() => host('div', (node) => node.props.role === 'tablist').props.onKeyDown({ key, preventDefault() {}, currentTarget: { querySelector: () => null } }))
    assert.equal(selectedTab(), `tab-${expected}`)
  }
  await click(tab('render')); await click(namedButton('Back to your design'))
  assert.equal(selectedTab(), 'tab-cad')
})

test('settings convert displayed units and synchronize the viewport grid toggle', async () => {
  await openSettings(); await click(namedButton('mm'))
  assert.equal(field('Width').props.value, '914.4')
  await click(button('Viewport grid')); assert.equal(button('Viewport grid').props['aria-checked'], false)
  await click(namedButton('in')); await click(button('Close dialog'))
  assert.equal(field('Width').props.value, '36')
  assert.equal(button('Toggle grid').props['aria-pressed'], false)
  await click(button('Toggle grid')); await openSettings()
  assert.equal(button('Viewport grid').props['aria-checked'], true)
})

test('help and settings close through their buttons, backdrop, and Escape', async () => {
  await click(namedButton('Help')); assert.equal(root().findAllByProps({ role: 'dialog' }).length, 1)
  await click(namedButton('Back to designing')); assert.equal(root().findAllByProps({ role: 'dialog' }).length, 0)
  await openSettings(); await keyboard('Escape'); assert.equal(root().findAllByProps({ role: 'dialog' }).length, 0)
  await click(namedButton('Help'))
  const backdrop = root().findByProps({ className: 'modal-backdrop' }), target = {}
  await act(() => backdrop.props.onMouseDown({ target, currentTarget: target }))
  assert.equal(root().findAllByProps({ role: 'dialog' }).length, 0)
})

test('save explains the current milestone and its notice can be dismissed', async () => {
  await click(button('Save project'))
  assert.match(text(root().findByProps({ role: 'status' })), /saving will be added/i)
  await click(button('Dismiss notification')); assert.equal(root().findAllByProps({ role: 'status' }).length, 0)
})

test('the composer sends trimmed text and respects multiline and composition Enter', async () => {
  const composer = () => host('textarea', (node) => node.props['aria-label'] === 'Ask AI to modify design')
  assert.equal(button('Send message').props.disabled, true)
  await change(composer(), '  More workspace please  ')
  await act(() => host('form', () => true).props.onSubmit({ preventDefault() {} }))
  assert.equal(composer().props.value, '')
  assert.match(text(root()), /More workspace please/)
  assert.match(text(root()), /Live AI isn’t connected yet/)
  await change(composer(), 'Second request')
  await act(() => composer().props.onKeyDown({ key: 'Enter', shiftKey: true, nativeEvent: { isComposing: false }, preventDefault() {} }))
  assert.equal(composer().props.value, 'Second request')
  await act(() => composer().props.onKeyDown({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: true }, preventDefault() {} }))
  assert.equal(composer().props.value, 'Second request')
  await act(() => composer().props.onKeyDown({ key: 'Enter', shiftKey: false, nativeEvent: { isComposing: false }, preventDefault() {} }))
  assert.equal(composer().props.value, '')
})

test('the photo handler accepts and replaces local files with object URLs', async () => {
  const upload = () => host('input', (node) => node.props.type === 'file')
  for (const name of ['kitchen.png', 'replacement.png']) {
    const target = { files: [new File(['image fixture'], name, { type: 'image/png' })], value: name }
    await act(() => upload().props.onChange({ target }))
    assert.equal(target.value, '')
    assert.equal(selectedTab(), 'tab-photo')
    const image = host('img', (node) => node.props.alt === 'Your kitchen reference')
    assert.match(image.props.src, /^blob:/)
    assert.match(text(root()), new RegExp(name.replace('.', '\\.')))
  }
})

test('canceling photo selection and unsupported files preserve the current view', async () => {
  const upload = () => host('input', (node) => node.props.type === 'file')
  await act(() => upload().props.onChange({ target: { files: [] } }))
  assert.equal(selectedTab(), 'tab-cad')
  await act(() => upload().props.onChange({ target: { files: [new File(['text'], 'notes.txt', { type: 'text/plain' })] } }))
  assert.equal(selectedTab(), 'tab-cad')
  assert.match(text(root().findByProps({ role: 'status' })), /JPG, PNG, or WEBP/)
})

test('all six camera presets change the rendered scene and isometric restores it', async () => {
  const original = sceneGeometry(), distinct = new Set<string>()
  for (const label of ['Top view', 'Front view', 'Right view']) {
    const face = host('g', (node) => node.props.role === 'button' && node.props['aria-label'] === label)
    await click(face); assert.equal(face.props['aria-pressed'], true)
    await act(() => face.props.onKeyDown({ key: 'Enter', preventDefault() {} }))
  }
  for (const value of ['top', 'front', 'right', 'back', 'left']) {
    await change(host('select', (node) => node.props['aria-label'] === 'Camera view'), value)
    distinct.add(sceneGeometry())
  }
  assert.equal(distinct.size, 5)
  await click(button('Isometric view')); assert.equal(sceneGeometry(), original)
})

test('projection changes between perspective and orthographic without changing objects', async () => {
  const projection = () => host('select', (node) => node.props['aria-label'] === 'Projection')
  const before = sceneGeometry()
  await change(projection(), 'orthographic'); assert.equal(projection().props.value, 'orthographic')
  assert.notEqual(sceneGeometry(), before)
  await change(projection(), 'perspective'); assert.equal(sceneGeometry(), before)
  assert.equal(rows().length, 3)
})

test('orbit arrows change the rendered viewpoint and reset restores the default camera', async () => {
  const original = sceneGeometry()
  for (const label of ['Orbit left', 'Orbit right', 'Orbit up', 'Orbit down']) {
    const before = sceneGeometry(); await click(button(label)); assert.notEqual(sceneGeometry(), before)
  }
  await change(host('select', (node) => node.props['aria-label'] === 'Camera view'), 'top')
  await click(button('Zoom in'))
  await click(button('Reset camera')); assert.equal(sceneGeometry(), original)
  assert.match(text(button('Reset zoom')), /100%/)
})

test('zoom is bounded and fit resets zoom while preserving the selected angle', async () => {
  await change(host('select', (node) => node.props['aria-label'] === 'Camera view'), 'front')
  const front = sceneGeometry()
  for (let i = 0; i < 20 && !button('Zoom in').props.disabled; i++) await click(button('Zoom in'))
  assert.equal(button('Zoom in').props.disabled, true)
  await click(button('Fit preview')); assert.equal(sceneGeometry(), front)
  assert.match(text(button('Reset zoom')), /100%/)
  for (let i = 0; i < 30 && !button('Zoom out').props.disabled; i++) await click(button('Zoom out'))
  assert.equal(button('Zoom out').props.disabled, true)
  await click(button('Reset zoom')); assert.equal(sceneGeometry(), front)
})

test('viewport focus mode is reversible', async () => {
  await click(button('Focus viewport')); assert.ok(button('Exit focus mode'))
  assert.equal(host('aside', (node) => node.props['aria-label'] === 'Design inspector').props.hidden, true)
  assert.equal(host('aside', (node) => node.props['aria-label'] === 'AI assistant').props.hidden, true)
  await click(button('Exit focus mode')); assert.ok(button('Focus viewport'))
  assert.equal(host('aside', (node) => node.props['aria-label'] === 'Design inspector').props.hidden, false)
  assert.equal(host('aside', (node) => node.props['aria-label'] === 'AI assistant').props.hidden, false)
  assert.equal(rows().length, 3)
  const original = sceneGeometry()
  await click(button('Focus viewport')); await click(tab('photo'))
  await click(host('a', (node) => node.props['aria-label'] === 'RenovaCAD home'))
  assert.equal(selectedTab(), 'tab-cad')
  assert.equal(sceneGeometry(), original)
  assert.ok(button('Focus viewport'))
})

test('inspector and assistant can each be hidden and restored', async () => {
  await click(button('Hide design inspector')); assert.ok(button('Show design inspector'))
  assert.equal(host('aside', (node) => node.props['aria-label'] === 'Design inspector').props.hidden, true)
  await click(button('Show design inspector')); assert.ok(field('Width'))
  assert.equal(host('aside', (node) => node.props['aria-label'] === 'Design inspector').props.hidden, false)
  await click(button('Hide AI assistant')); assert.ok(button('Show AI assistant'))
  assert.equal(host('aside', (node) => node.props['aria-label'] === 'AI assistant').props.hidden, true)
  await click(button('Show AI assistant')); assert.ok(namedButton('Apply change'))
  assert.equal(host('aside', (node) => node.props['aria-label'] === 'AI assistant').props.hidden, false)
})

test('drag handlers distinguish an orbit from a small pointer movement and stop on release', async () => {
  const scene = () => host('svg', (node) => node.props.className === 'kitchen-preview')
  const captured: number[] = [], released: number[] = []
  const surface = { style: { cursor: '' }, setPointerCapture: (id: number) => captured.push(id), hasPointerCapture: () => true, releasePointerCapture: (id: number) => released.push(id) }
  const pointer = { button: 0, pointerId: 7, clientX: 0, clientY: 0, target: new ElementStub(), currentTarget: surface }
  const original = sceneGeometry()
  await act(() => scene().props.onPointerDown(pointer))
  assert.deepEqual(captured, [7])
  await act(() => scene().props.onPointerMove({ ...pointer, clientX: 2, clientY: 1 }))
  assert.equal(sceneGeometry(), original)
  await act(() => scene().props.onPointerMove({ ...pointer, clientX: 32, clientY: 20 }))
  const orbited = sceneGeometry()
  assert.notEqual(orbited, original)
  await act(() => scene().props.onPointerUp(pointer))
  assert.deepEqual(released, [7])
  assert.equal(surface.style.cursor, '')
  await act(() => scene().props.onPointerMove({ ...pointer, clientX: 80, clientY: 40 }))
  assert.equal(sceneGeometry(), orbited)
  assert.equal(button('Undo (⌘Z)').props.disabled, true)
})

test('the wheel handler changes bounded zoom and prevents page scrolling', async () => {
  const event = Object.assign(new Event('wheel', { cancelable: true }), { deltaY: -100 })
  await act(() => { for (const listener of listeners.get('wheel') ?? []) listener(event) })
  assert.equal(event.defaultPrevented, true)
  assert.match(text(button('Reset zoom')), /115%/)
  assert.equal(button('Undo (⌘Z)').props.disabled, true)
})

test('closing a dialog or object menu preserves focus mode until Escape is pressed again', async () => {
  await click(button('Focus viewport')); await openSettings()
  await keyboard('Escape'); assert.ok(button('Exit focus mode'))
  await keyboard('o'); assert.ok(menuButton('Wall cabinet'))
  await keyboard('Escape'); assert.ok(button('Exit focus mode'))
  await keyboard('Escape'); assert.ok(button('Focus viewport'))
})

test('native selects and editable text do not trigger design shortcuts', async () => {
  const select = new ElementStub(); select.tagName = 'SELECT'
  const editable = new ElementStub(); editable.isContentEditable = true
  for (const target of [select, editable]) {
    await keyboard('o', { target })
    assert.equal(root().findAll((node) => node.props.className === 'object-menu').length, 0)
    await keyboard('Delete', { target }); assert.equal(rows().length, 3)
  }
})
