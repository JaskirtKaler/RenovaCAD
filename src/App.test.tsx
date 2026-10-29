import assert from 'node:assert/strict'
import { after, afterEach, beforeEach, test } from 'node:test'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import App from './App'
import { CAMERA_VIEWS } from './viewport'

// These tests render an in-memory React tree. They do not exercise a browser,
// focus behavior, image decoding, file dialogs, scrolling position, or layout.
const listeners = new Map<string, Set<EventListener>>()
const replacedGlobals = ['IS_REACT_ACT_ENVIRONMENT', 'HTMLElement', 'Element', 'HTMLInputElement', 'HTMLTextAreaElement', 'document', 'window']
const originalGlobals = new Map(replacedGlobals.map((name) => [name, Object.getOwnPropertyDescriptor(globalThis, name)]))
class ElementStub { tagName = 'DIV'; isContentEditable = false; focus() {}; closest(): ElementStub | null { return null } }
class HtmlElementStub extends ElementStub {}
class InputStub extends HtmlElementStub {}
class TextareaStub extends HtmlElementStub {}
Object.defineProperties(globalThis, {
  IS_REACT_ACT_ENVIRONMENT: { configurable: true, value: true },
  HTMLElement: { configurable: true, value: HtmlElementStub },
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

test('one catalog supplies object additions without duplicate add controls', async () => {
  assert.equal(root().findAll((node) => node.props.className === 'add-buttons').length, 0)
  assert.equal(root().findAll((node) => node.type === 'button' && node.props['aria-label'] === 'Add object').length, 0)
  for (const name of ['Base cabinet', 'Wall', 'Sink']) {
    await click(button('Objects (O)')); await click(menuButton(name))
  }
  assert.equal(rows().length, 6)
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

test('settings convert units while grid visibility has one viewport control', async () => {
  await openSettings(); await click(namedButton('mm'))
  assert.equal(field('Width').props.value, '914.4')
  assert.equal(root().findAll((node) => node.props['aria-label'] === 'Viewport grid').length, 0)
  await click(namedButton('in')); await click(button('Close dialog'))
  assert.equal(field('Width').props.value, '36')
  await click(button('Toggle grid')); assert.equal(button('Toggle grid').props['aria-pressed'], false)
  assert.equal(root().findAll((node) => node.props['data-grid-plane'] === 'floor').length, 0)
  await click(button('Toggle grid')); assert.equal(button('Toggle grid').props['aria-pressed'], true)
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

test('cube faces, edges, corners and all 26 view choices change the geometry', async () => {
  const original = sceneGeometry(), distinct = new Set<string>()
  for (const label of ['Top view', 'Front view', 'Right view', 'Top front view', 'Top front right view']) {
    await click(button('Home view'))
    const region = host('g', (node) => node.props.role === 'button' && node.props['aria-label'] === label)
    await click(region)
    await act(() => region.props.onKeyDown({ key: 'Enter', preventDefault() {}, stopPropagation() {} }))
    assert.equal(host('select', (node) => node.props['aria-label'] === 'All views').props.value, CAMERA_VIEWS.find((view) => view.label + ' view' === label)?.id)
  }
  for (const value of CAMERA_VIEWS.map((view) => view.id)) {
    await change(host('select', (node) => node.props['aria-label'] === 'All views'), value)
    distinct.add(sceneGeometry())
  }
  assert.equal(distinct.size, 26)
  await click(button('Home view')); assert.equal(sceneGeometry(), original)
})

test('projection changes between perspective and orthographic without changing objects', async () => {
  const projection = () => host('select', (node) => node.props['aria-label'] === 'Projection')
  const before = sceneGeometry()
  await change(projection(), 'orthographic'); assert.equal(projection().props.value, 'orthographic')
  assert.notEqual(sceneGeometry(), before)
  await change(projection(), 'perspective'); assert.equal(sceneGeometry(), before)
  assert.equal(rows().length, 3)
})

test('camera navigation is consolidated into the cube with one Home action', async () => {
  const original = sceneGeometry()
  assert.equal(root().findAll((node) => typeof node.props['aria-label'] === 'string' && node.props['aria-label'].startsWith('Orbit ')).length, 0)
  assert.equal(root().findAll((node) => node.props['aria-label'] === 'Reset camera' || node.props['aria-label'] === 'Reset zoom').length, 0)
  await change(host('select', (node) => node.props['aria-label'] === 'All views'), 'bottom-back-right')
  await click(button('Zoom in'))
  await click(button('Home view')); assert.equal(sceneGeometry(), original)
  assert.match(text(host('span', (node) => node.props['aria-label'] === 'Zoom level')), /100%/)
})

test('zoom is bounded and fit resets zoom while preserving the selected angle', async () => {
  await change(host('select', (node) => node.props['aria-label'] === 'All views'), 'front')
  const front = sceneGeometry()
  for (let i = 0; i < 20 && !button('Zoom in').props.disabled; i++) await click(button('Zoom in'))
  assert.equal(button('Zoom in').props.disabled, true)
  await click(button('Fit preview')); assert.equal(sceneGeometry(), front)
  assert.match(text(host('span', (node) => node.props['aria-label'] === 'Zoom level')), /100%/)
  for (let i = 0; i < 30 && !button('Zoom out').props.disabled; i++) await click(button('Zoom out'))
  assert.equal(button('Zoom out').props.disabled, true)
  await click(button('Fit preview')); assert.equal(sceneGeometry(), front)
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
  assert.match(text(host('span', (node) => node.props['aria-label'] === 'Zoom level')), /115%/)
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
  const select = new HtmlElementStub(); select.tagName = 'SELECT'
  const editable = new HtmlElementStub(); editable.isContentEditable = true
  for (const target of [select, editable]) {
    await keyboard('o', { target })
    assert.equal(root().findAll((node) => node.props.className === 'object-menu').length, 0)
    await keyboard('Delete', { target }); assert.equal(rows().length, 3)
  }
})

function positionField(axis: 'X' | 'Y' | 'Z'): ReactTestInstance {
  return host('input', (node) => node.props['aria-label'] === `${axis} position`)
}
function position(axis: 'X' | 'Y' | 'Z'): number {
  return Number.parseFloat(String(positionField(axis).props.value))
}
async function editPosition(axis: 'X' | 'Y' | 'Z', value: string) {
  await change(positionField(axis), value)
  await act(() => positionField(axis).props.onBlur())
}
async function positionKey(axis: 'X' | 'Y' | 'Z', key: string) {
  await act(() => positionField(axis).props.onKeyDown({ key, currentTarget: { blur: () => positionField(axis).props.onBlur() }, preventDefault() {} }))
}
function floorGeometry(): string {
  const floor = host('g', (node) => node.props['data-grid-plane'] === 'floor')
  return JSON.stringify(floor.findAllByType('line').map((line) => [line.props.x1, line.props.y1, line.props.x2, line.props.y2]))
}

test('six position buttons move one physical tile and retain a stationary floor', async () => {
  await units('mm')
  const floor = floorGeometry()
  const changes = [
    { label: 'Move right one tile', axis: 'X', delta: 304.8 }, { label: 'Move left one tile', axis: 'X', delta: -304.8 },
    { label: 'Raise one tile', axis: 'Y', delta: 304.8 }, { label: 'Lower one tile', axis: 'Y', delta: -304.8 },
    { label: 'Move forward one tile', axis: 'Z', delta: 304.8 }, { label: 'Move back one tile', axis: 'Z', delta: -304.8 },
  ] satisfies { label: string; axis: 'X' | 'Y' | 'Z'; delta: number }[]
  for (const { label, axis, delta } of changes) {
    const before = position(axis)
    await click(button(label))
    assert.ok(Math.abs(position(axis) - before - delta) < 0.001)
    assert.equal(floorGeometry(), floor)
  }
  assert.equal(button('Move (M)').props['aria-pressed'], true)
  assert.ok(host('g', (node) => node.props['data-grid-plane'] === 'vertical'))
  await click(button('Toggle grid'))
  assert.equal(root().findAll((node) => node.props['data-grid-plane']).length, 0)
  assert.ok(host('g', (node) => node.props['data-position-guide'] === 'height'))
})

test('Move keys change X Z and elevation while undo and redo preserve the view frame', async () => {
  await units('mm'); await keyboard('m')
  const floor = floorGeometry(), original = { x: position('X'), y: position('Y'), z: position('Z') }
  await keyboard('ArrowRight'); assert.equal(position('X'), -345.2)
  await keyboard('ArrowDown'); assert.equal(position('Z'), 4.8)
  await keyboard('PageDown'); assert.equal(position('Y'), -304.8)
  await click(button('Undo (⌘Z)')); assert.equal(position('Y'), 0)
  assert.equal(floorGeometry(), floor)
  await click(button('Redo (⇧⌘Z)')); assert.equal(position('Y'), -304.8)
  assert.equal(floorGeometry(), floor)
  await keyboard('PageUp'); await keyboard('ArrowUp'); await keyboard('ArrowLeft')
  assert.deepEqual({ x: position('X'), y: position('Y'), z: position('Z') }, original)
  await keyboard('v'); await keyboard('ArrowRight'); assert.equal(position('X'), original.x)
})

test('movement keys respect form fields cube regions menus and non-CAD views', async () => {
  await units('mm'); await keyboard('m')
  const original = position('X')
  const select = new HtmlElementStub(); select.tagName = 'SELECT'
  const cubeRegion = new ElementStub(); cubeRegion.tagName = 'g'
  cubeRegion.closest = () => cubeRegion
  assert.equal(cubeRegion instanceof HtmlElementStub, false)
  for (const target of [new InputStub(), new TextareaStub(), select, cubeRegion]) {
    await keyboard('ArrowRight', { target }); assert.equal(position('X'), original)
  }
  await openSettings(); await keyboard('ArrowRight'); await click(button('Close dialog'))
  assert.equal(position('X'), original)
  await click(button('Objects (O)')); await keyboard('ArrowRight'); await keyboard('Escape')
  assert.equal(position('X'), original)
  await keyboard('m'); await click(tab('photo')); await keyboard('ArrowRight')
  assert.equal(position('X'), original)
})

test('history shortcuts remain available after cube and view-tab controls receive focus', async () => {
  await click(namedButton('Apply change'))
  assert.equal(field('Width').props.value, '42')
  const cubeRegion = new ElementStub(); cubeRegion.tagName = 'g'; cubeRegion.closest = () => cubeRegion
  const viewTab = new HtmlElementStub(); viewTab.tagName = 'BUTTON'; viewTab.closest = () => viewTab
  for (const target of [cubeRegion, viewTab]) {
    await keyboard('z', { metaKey: true, target })
    assert.equal(field('Width').props.value, '36')
    await keyboard('z', { ctrlKey: true, shiftKey: true, target })
    assert.equal(field('Width').props.value, '42')
    await keyboard('z', { ctrlKey: true, target })
    assert.equal(field('Width').props.value, '36')
    await keyboard('z', { metaKey: true, shiftKey: true, target })
    assert.equal(field('Width').props.value, '42')
  }
})

test('tool shortcuts remain available after cube and view-tab controls receive focus', async () => {
  const cubeRegion = new ElementStub(); cubeRegion.tagName = 'g'; cubeRegion.closest = () => cubeRegion
  const viewTab = new HtmlElementStub(); viewTab.tagName = 'BUTTON'; viewTab.closest = () => viewTab
  for (const target of [cubeRegion, viewTab]) {
    await keyboard('m', { target })
    assert.equal(button('Move (M)').props['aria-pressed'], true)
    await keyboard('v', { target })
    assert.equal(button('Select (V)').props['aria-pressed'], true)
  }
})

test('moving a lone object translates its polygons without moving the grid or camera', async () => {
  await click(rows()[2]); await click(button('Delete selected object'))
  await click(rows()[1]); await click(button('Delete selected object'))
  await click(button('Fit preview'))
  await change(host('select', (node) => node.props['aria-label'] === 'All views'), 'front')
  const polygonPoints = () => host('g', (node) => node.props['data-object-id'] === 'base-01').findAllByType('polygon').map((polygon) => polygon.props.points).join('|')
  const before = polygonPoints(), floor = floorGeometry()
  await click(button('Move right one tile'))
  assert.notEqual(polygonPoints(), before)
  assert.equal(floorGeometry(), floor)
  await click(button('Undo (⌘Z)')); assert.equal(polygonPoints(), before)
  assert.equal(floorGeometry(), floor)
  await click(button('Redo (⇧⌘Z)')); assert.notEqual(polygonPoints(), before)
  assert.equal(floorGeometry(), floor)
  await click(button('Fit preview')); assert.notEqual(floorGeometry(), floor)
})

test('brand navigation preserves camera orientation and Home remains the reset action', async () => {
  await change(host('select', (node) => node.props['aria-label'] === 'All views'), 'bottom-back-left')
  await click(tab('photo'))
  await click(host('a', (node) => node.props['aria-label'] === 'RenovaCAD home'))
  assert.equal(host('select', (node) => node.props['aria-label'] === 'All views').props.value, 'bottom-back-left')
  await click(button('Home view'))
  assert.equal(host('select', (node) => node.props['aria-label'] === 'All views').props.value, 'top-front-right')
})

test('position inputs show the selected unit and accept absolute coordinates without snapping', async () => {
  await units('mm')
  assert.equal(position('X'), -650)
  assert.equal(position('Y'), 0)
  await editPosition('X', '100.5')
  assert.equal(position('X'), 100.5)
  await editPosition('Y', '-123.456')
  // display rounds to 2 decimals in mm, stored value remains -123.456 but input shows -123.46
  assert.ok(Math.abs(position('Y') - -123.46) < 0.01)
  assert.equal(position('Z'), -300)
  // fractional, not snapped: tile is 304.8, value preserves decimal
  await units('in')
  // 100.5 mm = 3.96 in, -123.456 mm = -4.86 in (rounded to 2 decimals by displayMeasurement)
  assert.ok(Math.abs(position('X') - 3.96) < 0.01)
  assert.ok(Math.abs(position('Y') - -4.86) < 0.01)
})

test('typing a position converts between inches and millimeters', async () => {
  await units('in')
  await editPosition('X', '12')
  assert.ok(Math.abs(position('X') - 12) < 0.001)
  await units('mm')
  assert.ok(Math.abs(position('X') - 304.8) < 0.001)
  await editPosition('Y', '500')
  assert.equal(position('Y'), 500)
  await units('in')
  assert.ok(Math.abs(position('Y') - 19.69) < 0.01)
  await editPosition('Z', '-5.5')
  assert.ok(Math.abs(position('Z') - -5.5) < 0.001)
  await units('mm')
  assert.ok(Math.abs(position('Z') - -139.7) < 0.01)
})

test('position inputs accept negative Y below the floor', async () => {
  await units('mm')
  await editPosition('Y', '-500')
  assert.equal(position('Y'), -500)
  await editPosition('Y', '-0.5')
  assert.equal(position('Y'), -0.5)
  await editPosition('Y', '0')
  assert.equal(position('Y'), 0)
})

test('out-of-range and empty position values are rejected with feedback', async () => {
  await units('mm')
  const beforeX = position('X')
  for (const invalid of ['', '   ', 'abc', '10000.1', '-10000.1', 'Infinity', 'NaN']) {
    await editPosition('X', invalid)
    assert.equal(position('X'), beforeX)
    assert.equal(positionField('X').props['aria-invalid'], true)
  }
  assert.equal(button('Undo (⌘Z)').props.disabled, true)
  await units('in')
  const beforeY = position('Y')
  // 393.71 in is just over 10000 mm
  await editPosition('Y', '400')
  assert.equal(position('Y'), beforeY)
  assert.equal(positionField('Y').props['aria-invalid'], true)
  await editPosition('Y', '-400')
  assert.equal(position('Y'), beforeY)
  assert.equal(positionField('Y').props['aria-invalid'], true)
})

test('Enter commits a position draft and Escape restores without changing the scene', async () => {
  await units('mm')
  const before = position('X')
  await change(positionField('X'), '200')
  await positionKey('X', 'Enter')
  assert.equal(position('X'), 200)
  await change(positionField('X'), '300')
  await positionKey('X', 'Escape')
  assert.equal(position('X'), 200)
  // Escape should not create history
  await click(button('Undo (⌘Z)'))
  assert.equal(position('X'), before)
})

test('blurring without changing a position preserves proposal and redo', async () => {
  await units('mm')
  // pending proposal initially exists
  assert.ok(namedButton('Apply change'))
  await act(() => positionField('X').props.onBlur())
  assert.equal(positionField('X').props['aria-invalid'], false)
  assert.ok(namedButton('Apply change'))
  assert.equal(button('Undo (⌘Z)').props.disabled, true)
  // create a history entry, undo, then blur unchanged should preserve redo
  await editPosition('X', '123')
  await click(button('Undo (⌘Z)'))
  assert.equal(button('Redo (⇧⌘Z)').props.disabled, false)
  const xBefore = position('X')
  await act(() => positionField('X').props.onBlur())
  assert.equal(position('X'), xBefore)
  assert.equal(button('Redo (⇧⌘Z)').props.disabled, false)
  // after undo, past is empty so Undo is disabled (past length 0)
  assert.equal(button('Undo (⌘Z)').props.disabled, true)
})

test('leaving the same inch value after unit rounding preserves exact millimeters', async () => {
  await units('mm')
  await editPosition('X', '100')
  // 100 mm = 3.94 in (3.937... rounded to 2 decimals)
  await units('in')
  const displayed = String(positionField('X').props.value)
  assert.equal(displayed, '3.94')
  // blur unchanged should not create a new history entry or change stored mm
  await act(() => positionField('X').props.onBlur())
  // still only one undo entry (the 100 mm edit), not a second from drift
  await units('mm')
  assert.equal(position('X'), 100)
  // now test that blurring unchanged in initial state preserves pending proposal
  // need fresh mount to get pending proposal back: remount by creating new App? Use undo to go back then check pending is gone (undo clears proposal) so we test separately
})

test('blurring unchanged after unit switch preserves pending proposal', async () => {
  await units('in')
  // initial state has pending proposal, display -650 mm as -25.59 in
  assert.ok(Math.abs(Number(positionField('X').props.value) - -25.59) < 0.01)
  assert.ok(namedButton('Apply change'))
  await act(() => positionField('X').props.onBlur())
  assert.ok(namedButton('Apply change'))
  assert.equal(button('Undo (⌘Z)').props.disabled, true)
})

test('one accepted position edit creates one undo step and Enter does not double-commit', async () => {
  await units('mm')
  const before = position('Y')
  await change(positionField('Y'), '250')
  await positionKey('Y', 'Enter')
  // blur after Enter would cause second commit if not deduplicated; ensure only one undo entry
  await act(() => positionField('Y').props.onBlur())
  assert.equal(position('Y'), 250)
  await click(button('Undo (⌘Z)'))
  assert.equal(position('Y'), before)
  assert.equal(button('Undo (⌘Z)').props.disabled, true)
  assert.equal(button('Redo (⇧⌘Z)').props.disabled, false)
})

test('typed position participates in undo and redo and clears redo on new edit', async () => {
  await units('mm')
  await editPosition('Z', '111')
  await editPosition('Z', '222')
  assert.equal(position('Z'), 222)
  await click(button('Undo (⌘Z)'))
  assert.equal(position('Z'), 111)
  await click(button('Undo (⌘Z)'))
  assert.equal(position('Z'), -300)
  await click(button('Redo (⇧⌘Z)'))
  assert.equal(position('Z'), 111)
  await editPosition('Z', '999')
  assert.equal(button('Redo (⇧⌘Z)').props.disabled, true)
  assert.equal(position('Z'), 999)
})

test('arrow movement after typing moves exactly one tile from the typed coordinate and keeps frame', async () => {
  await units('mm')
  const floor = floorGeometry()
  await editPosition('X', '123.45')
  assert.equal(position('X'), 123.45)
  await click(button('Move right one tile'))
  assert.ok(Math.abs(position('X') - (123.45 + 304.8)) < 0.001)
  assert.equal(floorGeometry(), floor)
  await click(button('Move left one tile'))
  assert.ok(Math.abs(position('X') - 123.45) < 0.001)
  assert.equal(floorGeometry(), floor)
  await editPosition('Y', '50.1')
  await click(button('Raise one tile'))
  assert.ok(Math.abs(position('Y') - (50.1 + 304.8)) < 0.001)
  assert.equal(floorGeometry(), floor)
})

test('switching selection does not apply a stale position draft to the new object', async () => {
  await units('mm')
  await change(positionField('X'), '999')
  // before blurring, switch object
  await click(rows()[1])
  // new object's X should be its own stored value, not 999
  assert.equal(position('X'), -650)
  assert.equal(positionField('X').props.value, '-650')
  // original object should remain unchanged
  await click(rows()[0])
  assert.equal(position('X'), -650)
})

test('position unit changes update the displayed value without stale drafts', async () => {
  await units('mm')
  await change(positionField('Z'), '123.45')
  // change unit before committing - display should reset to converted stored value, not stale draft
  await units('in')
  assert.ok(Math.abs(Number(positionField('Z').props.value) - -11.81) < 0.01)
  await units('mm')
  assert.equal(position('Z'), -300)
})

test('typing in position fields does not trigger move keys or tool shortcuts', async () => {
  await units('mm')
  await keyboard('m')
  assert.equal(button('Move (M)').props['aria-pressed'], true)
  const beforeX = position('X')
  // simulate typing 'm' while focused in position input - global handler should see HTMLInputElement and not switch tools
  await keyboard('m', { target: new InputStub() })
  assert.equal(button('Move (M)').props['aria-pressed'], true)
  // ArrowRight while focused in input should not move
  await keyboard('ArrowRight', { target: new InputStub() })
  assert.equal(position('X'), beforeX)
  await keyboard('o', { target: new InputStub() })
  assert.equal(root().findAll((node) => node.props.className === 'object-menu').length, 0)
})

test('typed position keeps camera framing stationary', async () => {
  await units('mm')
  const floor = floorGeometry()
  await editPosition('X', '800')
  assert.equal(floorGeometry(), floor)
  await editPosition('Z', '800')
  assert.equal(floorGeometry(), floor)
  await click(button('Fit preview'))
  assert.notEqual(floorGeometry(), floor)
})
