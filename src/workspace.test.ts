import assert from 'node:assert/strict'
import { test } from 'node:test'
import { displayMeasurement, workspaceReducer as reduce } from './workspace'

type State = Parameters<typeof reduce>[0]

function sample(): State {
  return {
    past: [], future: [], revision: 0, selectedId: 'base-01',
    present: [
      { id: 'base-01', kind: 'base-cabinet', name: 'Base cabinet', dimensionsMm: { width: 914.4, height: 876.3, depth: 609.6 }, rotationDegrees: 0 },
      { id: 'upper-01', kind: 'wall-cabinet', name: 'Wall cabinet', dimensionsMm: { width: 914.4, height: 762, depth: 304.8 }, rotationDegrees: 0 },
    ],
    proposal: { kind: 'resize', status: 'pending', objectId: 'base-01', objectName: 'Base cabinet', revision: 0, beforeMm: 914.4, afterMm: 1066.8 },
  }
}

test('approving a proposal changes its cabinet exactly once', () => {
  const before = sample()
  const applied = reduce(before, { kind: 'apply-proposal' })
  assert.equal(applied.present[0].dimensionsMm.width, 1066.8)
  assert.equal(applied.past.length, 1)
  assert.deepEqual(reduce(applied, { kind: 'apply-proposal' }), applied)
  assert.equal(before.present[0].dimensionsMm.width, 914.4)
})

test('a proposal from an older scene revision cannot change the design', () => {
  const before = { ...sample(), revision: 1 }
  assert.deepEqual(reduce(before, { kind: 'apply-proposal' }), before)
})

test('a deleted or changed proposal target cannot be overwritten', () => {
  for (const present of [sample().present.slice(1), sample().present.map((object) => ({ ...object, dimensionsMm: { ...object.dimensionsMm, width: 1200 } }))]) {
    const before = { ...sample(), present }
    const after = reduce(before, { kind: 'apply-proposal' })
    assert.deepEqual(after.present, present)
    assert.equal(after.past.length, 0)
    assert.equal(after.proposal.kind, 'none')
  }
})

test('manual dimension changes invalidate the pending proposal', () => {
  const edited = reduce(sample(), { kind: 'resize', dimension: 'width', valueMm: 1200 })
  assert.equal(edited.present[0].dimensionsMm.width, 1200)
  assert.equal(edited.proposal.kind, 'none')
  assert.deepEqual(reduce(edited, { kind: 'apply-proposal' }).present, edited.present)
})

test('undo and redo restore the design before and after approval', () => {
  const before = sample(), applied = reduce(before, { kind: 'apply-proposal' })
  const undone = reduce(applied, { kind: 'undo' })
  assert.deepEqual(undone.present, before.present)
  assert.equal(undone.past.length, 0)
  assert.equal(undone.future.length, 1)
  const redone = reduce(undone, { kind: 'redo' })
  assert.deepEqual(redone.present, applied.present)
  assert.equal(redone.future.length, 0)
})

test('changing selection leaves undo and redo available', () => {
  const undone = reduce(reduce(sample(), { kind: 'apply-proposal' }), { kind: 'undo' })
  const selected = reduce(undone, { kind: 'select', id: 'upper-01' })
  assert.equal(selected.selectedId, 'upper-01')
  assert.deepEqual(selected.past, undone.past)
  assert.deepEqual(selected.future, undone.future)
  assert.deepEqual(reduce(selected, { kind: 'redo' }).present, undone.future[0])
})

test('deletion can be undone and an empty scene remains usable', () => {
  const before = sample(), deleted = reduce(before, { kind: 'delete' })
  assert.deepEqual(deleted.present.map((object) => object.id), ['upper-01'])
  assert.equal(deleted.selectedId, 'upper-01')
  assert.deepEqual(reduce(deleted, { kind: 'undo' }).present, before.present)
  const empty = reduce(deleted, { kind: 'delete' })
  assert.equal(empty.selectedId, null)
  assert.deepEqual(reduce(empty, { kind: 'delete' }), empty)
  assert.deepEqual(reduce(empty, { kind: 'resize', dimension: 'width', valueMm: 100 }), empty)
})

test('invalid dimensions and rotations leave the design and history unchanged', () => {
  const before = sample()
  for (const valueMm of [NaN, Infinity, -1, 0, 25.39, 10000.01]) {
    assert.deepEqual(reduce(before, { kind: 'resize', dimension: 'width', valueMm }), before)
  }
  for (const degrees of [NaN, Infinity, -361, 361]) {
    assert.deepEqual(reduce(before, { kind: 'rotate', degrees }), before)
  }
})

test('canceling a proposal prevents approval without creating an edit', () => {
  const before = sample(), canceled = reduce(before, { kind: 'cancel-proposal' })
  assert.deepEqual(canceled.present, before.present)
  assert.equal(canceled.past.length, 0)
  assert.deepEqual(reduce(canceled, { kind: 'apply-proposal' }), canceled)
  assert.deepEqual(reduce(canceled, { kind: 'cancel-proposal' }), canceled)
})

test('a proposal still edits its original target after another object is selected', () => {
  const selected = reduce(sample(), { kind: 'select', id: 'upper-01' })
  const applied = reduce(selected, { kind: 'apply-proposal' })
  assert.equal(applied.present[0].dimensionsMm.width, 1066.8)
  assert.equal(applied.present[1].dimensionsMm.width, 914.4)
  assert.equal(applied.selectedId, 'upper-01')
})

test('round-tripping an unchanged inch value preserves proposals and redo', () => {
  const initial = sample()
  const undone = reduce(reduce(initial, { kind: 'apply-proposal' }), { kind: 'undo' })
  for (const before of [initial, undone]) {
    const valueMm = Number(displayMeasurement(before.present[0].dimensionsMm.depth, 'in')) * 25.4
    assert.deepEqual(reduce(before, { kind: 'resize', dimension: 'depth', valueMm }), before)
  }
})

test('a cabinet at maximum width cannot produce an empty resize edit', () => {
  const maximum = reduce(sample(), { kind: 'resize', dimension: 'width', valueMm: 10000 })
  assert.deepEqual(reduce(maximum, { kind: 'sample-proposal' }), maximum)
  const pending: State = { ...maximum, proposal: { kind: 'resize', status: 'pending', objectId: 'base-01', objectName: 'Base cabinet', revision: maximum.revision, beforeMm: 10000, afterMm: 10000 } }
  const applied = reduce(pending, { kind: 'apply-proposal' })
  assert.deepEqual(applied.present, maximum.present)
  assert.deepEqual(applied.past, maximum.past)
  assert.equal(applied.proposal.kind, 'none')
})

test('editing after undo replaces the redo branch', () => {
  const undone = reduce(reduce(sample(), { kind: 'apply-proposal' }), { kind: 'undo' })
  const edited = reduce(undone, { kind: 'resize', dimension: 'height', valueMm: 1000 })
  assert.equal(edited.present[0].dimensionsMm.width, 914.4)
  assert.equal(edited.present[0].dimensionsMm.height, 1000)
  assert.equal(edited.future.length, 0)
  assert.deepEqual(reduce(edited, { kind: 'redo' }), edited)
})

test('adding an object selects it and undo restores the previous scene', () => {
  const before = sample()
  const added = reduce(before, { kind: 'add', objectKind: 'sink', id: 'sink-01' })
  assert.equal(added.selectedId, 'sink-01')
  assert.equal(added.present.find((object) => object.id === 'sink-01')?.kind, 'sink')
  assert.equal(added.present.length, before.present.length + 1)
  const undone = reduce(added, { kind: 'undo' })
  assert.deepEqual(undone.present, before.present)
  assert.ok(undone.present.some((object) => object.id === undone.selectedId))
  assert.deepEqual(reduce(undone, { kind: 'redo' }).present, added.present)
})
