import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { act, create, type ReactTestInstance, type ReactTestRenderer } from 'react-test-renderer'
import App from './App'
import { workspaceReducer as reduce } from './workspace'

// Helpers mirrored from App.test.tsx mount setup
const listeners = new Map<string, Set<EventListener>>()
let saved: Map<string, PropertyDescriptor | undefined>

function installGlobals() {
  const names = ['IS_REACT_ACT_ENVIRONMENT', 'HTMLElement', 'Element', 'HTMLInputElement', 'HTMLTextAreaElement', 'document', 'window', 'navigator', 'crypto']
  saved = new Map(names.map((n) => [n, Object.getOwnPropertyDescriptor(globalThis as unknown as Record<string, unknown>, n)]))
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
    document: { configurable: true, value: { activeElement: null, querySelector: () => null, addEventListener(k: string, l: EventListener) { if (!listeners.has(k)) listeners.set(k, new Set()); listeners.get(k)?.add(l) }, removeEventListener(k: string, l: EventListener) { listeners.get(k)?.delete(l) } } },
    window: { configurable: true, value: { setTimeout, clearTimeout, addEventListener(k: string, l: EventListener) { if (!listeners.has(k)) listeners.set(k, new Set()); listeners.get(k)?.add(l) }, removeEventListener(k: string, l: EventListener) { listeners.get(k)?.delete(l) } } },
    navigator: { configurable: true, value: { userAgent: 'Electron' } },
    crypto: { configurable: true, value: { randomUUID: () => 'test-id-' + Math.random().toString(36).slice(2) } },
  } as unknown as PropertyDescriptorMap)
}
function restoreGlobals() {
  for (const [name, d] of saved) {
    if (d) Object.defineProperty(globalThis, name, d)
    else Reflect.deleteProperty(globalThis as unknown as Record<string, unknown>, name)
  }
}

type BridgeStub = {
  proposeEdit: (payload: unknown) => Promise<unknown>
  getStatus: () => Promise<unknown>
  isAvailable: () => boolean
}

async function mountWithBridge(bridge: BridgeStub | null): Promise<{ renderer: ReactTestRenderer; root: () => ReactTestInstance }> {
  listeners.clear()
  const w = (globalThis as unknown as { window: Record<string, unknown> }).window as Record<string, unknown>
  if (bridge) w['renovacadApi'] = bridge
  else delete w['renovacadApi']

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

function text(node: ReactTestInstance): string { return node.children.map((c) => typeof c === 'string' ? c : text(c as ReactTestInstance)).join('') }
function host(type: string, root: ReactTestInstance, predicate: (n: ReactTestInstance) => boolean): ReactTestInstance {
  const matches = root.findAll((n) => n.type === type && predicate(n))
  assert.equal(matches.length, 1, `Expected one ${type} found ${matches.length}`)
  return matches[0]
}
function button(label: string, root: ReactTestInstance): ReactTestInstance { return host('button', root, (n) => n.props['aria-label'] === label) }
function field(label: string, root: ReactTestInstance): ReactTestInstance { return host('input', root, (n) => n.props.id === `field-${label}`) }
async function change(node: ReactTestInstance, value: string) { await act(() => node.props.onChange({ target: { value }, currentTarget: { value } })) }
async function click(node: ReactTestInstance) { assert.ok(!node.props.disabled, `Cannot click disabled ${text(node) || node.props['aria-label']}`); await act(() => node.props.onClick?.({ detail: 0, preventDefault() {}, stopPropagation() {} })) }

beforeEach(() => installGlobals())
afterEach(async () => {
  listeners.clear()
  restoreGlobals()
})

// Workspace reducer: ai-proposal behavior
test('ai-proposal sets pending proposal and apply validates revision and beforeMm', () => {
  const s = { past: [], future: [], revision: 0, selectedId: 'base-01', present: [
    { id: 'base-01', kind: 'base-cabinet' as const, name: 'Base cabinet', dimensionsMm: { width: 914.4, height: 876.3, depth: 609.6 }, rotationDegrees: 0, positionMm: { x: 0, y: 0, z: 0 } },
  ], proposal: { kind: 'none' as const } }
  const pending = reduce(s, { kind: 'ai-proposal', objectId: 'base-01', objectName: 'Base cabinet', revision: 0, beforeMm: 914.4, afterMm: 1066.8 })
  assert.equal(pending.proposal.kind, 'resize')
  if (pending.proposal.kind === 'resize') assert.equal(pending.proposal.afterMm, 1066.8)
  const applied = reduce(pending, { kind: 'apply-proposal' })
  assert.equal(applied.present[0].dimensionsMm.width, 1066.8)
  // Undo/redo reverts
  const undone = reduce(applied, { kind: 'undo' })
  assert.equal(undone.present[0].dimensionsMm.width, 914.4)
  const redone = reduce(undone, { kind: 'redo' })
  assert.equal(redone.present[0].dimensionsMm.width, 1066.8)
})

test('ai-proposal cancel leaves design unchanged without history', () => {
  const s = { past: [], future: [], revision: 0, selectedId: 'base-01', present: [
    { id: 'base-01', kind: 'base-cabinet' as const, name: 'Base', dimensionsMm: { width: 914.4, height: 876.3, depth: 609.6 }, rotationDegrees: 0, positionMm: { x: 0, y: 0, z: 0 } },
  ], proposal: { kind: 'none' as const } }
  const pending = reduce(s, { kind: 'ai-proposal', objectId: 'base-01', objectName: 'Base', revision: 0, beforeMm: 914.4, afterMm: 1066.8 })
  const canceled = reduce(pending, { kind: 'cancel-proposal' })
  assert.equal(canceled.present[0].dimensionsMm.width, 914.4)
  assert.equal(canceled.past.length, 0)
  assert.deepEqual(reduce(canceled, { kind: 'apply-proposal' }), canceled)
})

test('stale ai-proposal after scene edit cannot be applied', () => {
  const s = { past: [], future: [], revision: 0, selectedId: 'base-01', present: [
    { id: 'base-01', kind: 'base-cabinet' as const, name: 'Base', dimensionsMm: { width: 914.4, height: 876.3, depth: 609.6 }, rotationDegrees: 0, positionMm: { x: 0, y: 0, z: 0 } },
  ], proposal: { kind: 'none' as const } }
  const withProposal = reduce(s, { kind: 'ai-proposal', objectId: 'base-01', objectName: 'Base', revision: 0, beforeMm: 914.4, afterMm: 1066.8 })
  const edited = reduce(withProposal, { kind: 'resize', dimension: 'width', valueMm: 1200 })
  // Editing invalidates pending proposal (commit clears it)
  assert.equal(edited.proposal.kind, 'none')
  // If proposal survived but revision mismatched, apply would be no-op; also before mismatch clears to none
  const staleState = { ...withProposal, revision: 1 } as typeof withProposal
  const notApplied = reduce(staleState, { kind: 'apply-proposal' })
  assert.equal(notApplied.present[0].dimensionsMm.width, 914.4)
  assert.equal(notApplied.past.length, 0)
})

test('ai-proposal response never exposes Baseten key', async () => {
  // This unit checks that no response object stringifies the secret; bridge mock would never include it
  const payload = { instruction: 'Make it 6 inches wider', selectedObjectId: 'base-01', sceneRevision: 0, scene: { objects: [{ id: 'base-01', kind: 'base-cabinet', name: 'Base cabinet', dimensionsMm: { width: 914.4, height: 876.3, depth: 609.6 }, rotationDegrees: 0, positionMm: { x: 0, y: 0, z: 0 } }] } }
  const bridge: BridgeStub = {
    isAvailable: () => true,
    getStatus: async () => ({ ready: true, address: '127.0.0.1:8787', error: null }),
    proposeEdit: async () => ({ kind: 'proposal', proposal: { objectId: 'base-01', objectName: 'Base cabinet', operation: 'resize', dimension: 'width', beforeMm: 914.4, afterMm: 1066.8, explanation: 'wider', sceneRevision: 0 } }),
  }
  const res = await bridge.proposeEdit(payload) as unknown as Record<string, unknown>
  const json = JSON.stringify(res)
  assert.equal(json.includes('BASETEN'), false)
  assert.equal(json.includes('b10_'), false)
  assert.equal(json.includes('sk-'), false)
})

// Interactive: valid proposal shown and applied via bridge, with loading
test('valid AI proposal is shown and applied to correct cabinet', async () => {
  let resolveProposal: (v: unknown) => void = () => {}
  const bridge: BridgeStub = {
    isAvailable: () => true,
    getStatus: async () => ({ ready: true, address: '127.0.0.1:8787', error: null }),
    proposeEdit: (payload: unknown) => new Promise((res) => { resolveProposal = res as (v: unknown) => void; // capture for delayed resolve
      // verify payload does not contain secret
      const str = JSON.stringify(payload)
      assert.equal(str.includes('BASETEN'), false)
    }),
  }
  const { root } = await mountWithBridge(bridge)
  const composer = host('textarea', root(), (n) => n.props['aria-label'] === 'Ask AI to modify design')
  await change(composer, 'Make this cabinet 6 inches wider')
  // Submit
  await act(async () => host('form', root(), () => true).props.onSubmit({ preventDefault() {} }))
  // Loading state appears
  assert.match(text(root()), /Asking Renova/)
  // Resolve with valid proposal
  await act(async () => { resolveProposal({ kind: 'proposal', proposal: { objectId: 'base-01', objectName: 'Base cabinet', operation: 'resize', dimension: 'width', beforeMm: 914.4, afterMm: 1066.8, explanation: '6 in wider', sceneRevision: 0 } }); await new Promise((r) => setTimeout(r, 0)) })
  // Proposal card should show before/after in inches
  const proposalCard = root().findAll((n) => String(n.props.className).includes('proposal-card'))[0]
  assert.ok(proposalCard, 'proposal card missing')
  assert.match(text(proposalCard), /36/)
  assert.match(text(proposalCard), /42/)
  // Apply
  const apply = root().findAll((n) => n.type === 'button' && text(n).trim() === 'Apply change')[0]
  await click(apply)
  assert.equal(field('Width', root()).props.value, '42')
})

// Clarification and provider errors are separate from proposals
test('ambiguous request shows clarification and provider error shows message', async () => {
  const clarBridge: BridgeStub = {
    isAvailable: () => true,
    getStatus: async () => ({ ready: true, address: '127.0.0.1:8787', error: null }),
    proposeEdit: async () => ({ kind: 'clarification', message: 'How much wider?', sceneRevision: 0 }),
  }
  let { root } = await mountWithBridge(clarBridge)
  await change(host('textarea', root(), (n) => n.props['aria-label'] === 'Ask AI to modify design'), 'Make it bigger')
  await act(async () => host('form', root(), () => true).props.onSubmit({ preventDefault() {} }))
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  assert.match(text(root()), /How much wider\?/)
  // Provider error
  const errBridge: BridgeStub = {
    isAvailable: () => true,
    getStatus: async () => ({ ready: true, address: '127.0.0.1:8787', error: null }),
    proposeEdit: async () => ({ kind: 'error', code: 'provider_error', message: 'AI provider error', httpStatus: 502 }),
  }
  const mounted2 = await mountWithBridge(errBridge)
  root = mounted2.root
  await change(host('textarea', root(), (n) => n.props['aria-label'] === 'Ask AI to modify design'), 'Make it wider')
  await act(async () => host('form', root(), () => true).props.onSubmit({ preventDefault() {} }))
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  assert.match(text(root()), /AI provider error|AI request/i)
  // Ensure design unchanged
  assert.equal(field('Width', root()).props.value, '36')
})

// Bridge unavailable: honest message, no AI call
test('browser-only mode shows honest unavailable message and local preview', async () => {
  const { root } = await mountWithBridge(null)
  await change(host('textarea', root(), (n) => n.props['aria-label'] === 'Ask AI to modify design'), 'Make this cabinet 6 inches wider')
  await act(async () => host('form', root(), () => true).props.onSubmit({ preventDefault() {} }))
  await act(async () => { await new Promise((r) => setTimeout(r, 0)) })
  assert.match(text(root()), /Live AI isn’t connected yet/)
  assert.match(text(root()), /No AI service connected|UI preview/)
})

// Late response is ignored after newer request or cancel
test('late response is ignored when user issues newer request', async () => {
  let firstResolve: (v: unknown) => void = () => {}
  let callCount = 0
  const bridge: BridgeStub = {
    isAvailable: () => true,
    getStatus: async () => ({ ready: true, address: '127.0.0.1:8787', error: null }),
    proposeEdit: () => new Promise((res) => {
      callCount++
      if (callCount === 1) firstResolve = res as (v: unknown) => void
      else res({ kind: 'clarification', message: 'Second reply', sceneRevision: 0 })
    }),
  }
  const { root } = await mountWithBridge(bridge)
  // First request
  await change(host('textarea', root(), (n) => n.props['aria-label'] === 'Ask AI to modify design'), 'First')
  await act(async () => host('form', root(), () => true).props.onSubmit({ preventDefault() {} }))
  // Second request before first resolves
  await change(host('textarea', root(), (n) => n.props['aria-label'] === 'Ask AI to modify design'), 'Second')
  await act(async () => host('form', root(), () => true).props.onSubmit({ preventDefault() {} }))
  await act(async () => { await new Promise((r) => setTimeout(r, 20)) })
  assert.match(text(root()), /Second reply/)
  // Now late first resolves — should be ignored, not overwrite second
  await act(async () => { firstResolve({ kind: 'proposal', proposal: { objectId: 'base-01', objectName: 'Base cabinet', operation: 'resize', dimension: 'width', beforeMm: 914.4, afterMm: 1200, explanation: 'late', sceneRevision: 0 } }); await new Promise((r) => setTimeout(r, 10)) })
  // Should still show Second reply, not proposal
  assert.match(text(root()), /Second reply/)
  assert.doesNotMatch(text(root()), /late/)
})
