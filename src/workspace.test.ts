import assert from 'node:assert/strict'
import { test } from 'node:test'
import { POSITION_LIMIT_MM, TILE_MM, canNudge, displayMeasurement, workspaceReducer as reduce, type Axis } from './workspace'
import { defaultRoomMeasurements } from './workspace'

type State = Parameters<typeof reduce>[0]

function sample(): State {
  return {
    past: [], future: [], revision: 0, selectedId: 'base-01',
    present: [
      { id: 'base-01', kind: 'base-cabinet', name: 'Base cabinet', dimensionsMm: { width: 914.4, height: 876.3, depth: 609.6 }, rotationDegrees: 0, positionMm: { x: -650, y: 0, z: -300 } },
      { id: 'upper-01', kind: 'wall-cabinet', name: 'Wall cabinet', dimensionsMm: { width: 914.4, height: 762, depth: 304.8 }, rotationDegrees: 0, positionMm: { x: -650, y: 1480, z: -300 } },
    ],
    proposal: { kind: 'resize', status: 'pending', objectId: 'base-01', objectName: 'Base cabinet', revision: 0, beforeMm: 914.4, afterMm: 1066.8 },
    roomMeasurements: { ...defaultRoomMeasurements },
    roomMeasurementsPast: [],
    roomMeasurementsFuture: [],
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

for (const axis of ['x', 'y', 'z'] satisfies Axis[]) {
  for (const direction of [-1, 1] satisfies (-1 | 1)[]) {
    test(`one tile moves only ${axis} in direction ${direction}`, () => {
      const before = sample()
      const moved = reduce(before, { kind: 'nudge', axis, direction })
      const expected = { ...before.present[0].positionMm, [axis]: Math.round((before.present[0].positionMm[axis] + TILE_MM * direction) * 1000) / 1000 }
      assert.deepEqual(moved.present[0].positionMm, expected)
      assert.deepEqual(moved.present[1], before.present[1])
      assert.equal(moved.past.length, 1)
      assert.equal(moved.proposal.kind, 'none')
    })
  }
}

test('height can go below the floor and undo and redo restore it exactly', () => {
  const before = sample()
  const moved = reduce(before, { kind: 'nudge', axis: 'y', direction: -1 })
  assert.equal(moved.present[0].positionMm.y, -TILE_MM)
  const undone = reduce(moved, { kind: 'undo' })
  assert.deepEqual(undone.present, before.present)
  assert.deepEqual(reduce(undone, { kind: 'redo' }).present, moved.present)
  const branched = reduce(undone, { kind: 'nudge', axis: 'x', direction: 1 })
  assert.equal(branched.future.length, 0)
})

test('position boundaries reject the whole tile instead of clamping it', () => {
  for (const axis of ['x', 'y', 'z'] satisfies Axis[]) {
    for (const direction of [-1, 1] satisfies (-1 | 1)[]) {
      const before = sample()
      before.present[0].positionMm[axis] = direction * (POSITION_LIMIT_MM - TILE_MM / 2)
      assert.equal(canNudge(before.present[0], axis, direction), false)
      assert.equal(reduce(before, { kind: 'nudge', axis, direction }), before)
    }
  }
  const invalid = sample(); invalid.present[0].positionMm.y = NaN
  assert.equal(reduce(invalid, { kind: 'nudge', axis: 'x', direction: 1 }), invalid)
  const empty = { ...sample(), present: [], selectedId: null }
  assert.equal(reduce(empty, { kind: 'nudge', axis: 'y', direction: -1 }), empty)
})

test('new placement is stored once and survivors never move after edits or deletion', () => {
  const added = reduce(reduce(sample(), { kind: 'add', objectKind: 'base-cabinet', id: 'new-1' }), { kind: 'add', objectKind: 'sink', id: 'new-2' })
  const survivor = added.present.find((object) => object.id === 'new-2')
  assert.ok(survivor)
  const selected = reduce(added, { kind: 'select', id: 'new-1' })
  const resized = reduce(selected, { kind: 'resize', dimension: 'width', valueMm: 2000 })
  const deleted = reduce(resized, { kind: 'delete' })
  const more = reduce(deleted, { kind: 'add', objectKind: 'wall', id: 'new-3' })
  assert.deepEqual(more.present.find((object) => object.id === survivor.id), survivor)
})

test('movement invalidates a pending proposal without allowing stale approval', () => {
  const moved = reduce(sample(), { kind: 'nudge', axis: 'z', direction: 1 })
  const approved = reduce(moved, { kind: 'apply-proposal' })
  assert.equal(approved, moved)
  assert.equal(approved.present[0].dimensionsMm.width, 914.4)
})

test('set-position stores an absolute coordinate and rejects invalid or out-of-bounds values', () => {
  const before = sample()
  const moved = reduce(before, { kind: 'set-position', axis: 'x', valueMm: 123.456 })
  assert.equal(moved.present[0].positionMm.x, 123.456)
  assert.equal(moved.past.length, 1)
  assert.equal(moved.proposal.kind, 'none')
  for (const valueMm of [NaN, Infinity, -Infinity, 10000.1, -10000.1]) {
    assert.deepEqual(reduce(before, { kind: 'set-position', axis: 'y', valueMm }), before)
  }
  const empty = { ...sample(), present: [], selectedId: null }
  assert.deepEqual(reduce(empty, { kind: 'set-position', axis: 'x', valueMm: 100 }), empty)
})

test('set-position accepts fractional and negative coordinates including below the floor', () => {
  const before = sample()
  const a = reduce(before, { kind: 'set-position', axis: 'y', valueMm: -123.456 })
  assert.equal(a.present[0].positionMm.y, -123.456)
  const b = reduce(a, { kind: 'set-position', axis: 'x', valueMm: 0.123 })
  assert.equal(b.present[0].positionMm.x, 0.123)
  const c = reduce(b, { kind: 'set-position', axis: 'z', valueMm: -0.001 })
  assert.equal(c.present[0].positionMm.z, -0.001)
})

test('set-position respects unit conversion rounding to three decimals', () => {
  // 12 inches = 304.8 mm exactly, 3.94 in = 100.076 mm -> rounded to 100.076
  const inchesToMm = 12 * 25.4
  const moved = reduce(sample(), { kind: 'set-position', axis: 'x', valueMm: inchesToMm })
  assert.equal(moved.present[0].positionMm.x, 304.8)
  const fractional = reduce(sample(), { kind: 'set-position', axis: 'x', valueMm: 100.076 })
  assert.equal(fractional.present[0].positionMm.x, 100.076)
})

test('unchanged set-position preserves proposal and redo history', () => {
  const initial = sample()
  const undone = reduce(reduce(initial, { kind: 'set-position', axis: 'x', valueMm: 500 }), { kind: 'undo' })
  assert.equal(undone.future.length, 1)
  for (const before of [initial, undone]) {
    const valueMm = before.present[0].positionMm.x
    const after = reduce(before, { kind: 'set-position', axis: 'x', valueMm })
    assert.equal(after, before)
    assert.deepEqual(after.future, before.future)
    assert.deepEqual(after.proposal, before.proposal)
  }
  // inch rounding case: stored 100 mm displayed as 3.94 in (100.076 mm) should not be considered unchanged if exact mm differs,
  // but unchanged exact mm must be preserved
  const stored100 = reduce(sample(), { kind: 'set-position', axis: 'x', valueMm: 100 })
  const displayedIn = Number(displayMeasurement(stored100.present[0].positionMm.x, 'in')) * 25.4
  // displayedIn is 100.076, which is not equal to 100, so reducer will treat as change - UI must prevent this drift by not dispatching when draft === display string
  // reducer correctly sees 100 vs 100.076 as different, which is expected; UI layer ensures unchanged display string does not dispatch
  assert.notDeepEqual(reduce(stored100, { kind: 'set-position', axis: 'x', valueMm: displayedIn }), stored100)
})

test('typed position participates in undo and redo and clears redo on new edit', () => {
  const a = reduce(sample(), { kind: 'set-position', axis: 'z', valueMm: 111 })
  const b = reduce(a, { kind: 'set-position', axis: 'z', valueMm: 222 })
  assert.equal(b.present[0].positionMm.z, 222)
  const undone = reduce(b, { kind: 'undo' })
  assert.equal(undone.present[0].positionMm.z, 111)
  const undone2 = reduce(undone, { kind: 'undo' })
  assert.equal(undone2.present[0].positionMm.z, -300)
  assert.deepEqual(reduce(undone, { kind: 'redo' }).present[0].positionMm.z, 222)
  const branched = reduce(undone, { kind: 'set-position', axis: 'z', valueMm: 999 })
  assert.equal(branched.future.length, 0)
  assert.deepEqual(reduce(branched, { kind: 'redo' }), branched)
})

test('arrow movement after a typed coordinate moves exactly one tile from that coordinate', () => {
  const typed = reduce(sample(), { kind: 'set-position', axis: 'x', valueMm: 123.45 })
  assert.equal(typed.present[0].positionMm.x, 123.45)
  const nudged = reduce(typed, { kind: 'nudge', axis: 'x', direction: 1 })
  assert.ok(Math.abs(nudged.present[0].positionMm.x - (123.45 + TILE_MM)) < 0.001)
  const nudgedY = reduce(reduce(sample(), { kind: 'set-position', axis: 'y', valueMm: 50.1 }), { kind: 'nudge', axis: 'y', direction: 1 })
  assert.ok(Math.abs(nudgedY.present[0].positionMm.y - (50.1 + TILE_MM)) < 0.001)
})

test('set-position at ±10000 mm bounds is accepted and beyond is rejected', () => {
  const atMax = reduce(sample(), { kind: 'set-position', axis: 'x', valueMm: 10000 })
  assert.equal(atMax.present[0].positionMm.x, 10000)
  const atMin = reduce(sample(), { kind: 'set-position', axis: 'y', valueMm: -10000 })
  assert.equal(atMin.present[0].positionMm.y, -10000)
  assert.deepEqual(reduce(sample(), { kind: 'set-position', axis: 'x', valueMm: 10000.001 }), sample())
})

test('set-position invalidates pending proposal like other scene edits', () => {
  const moved = reduce(sample(), { kind: 'set-position', axis: 'x', valueMm: 500 })
  assert.equal(moved.proposal.kind, 'none')
  assert.deepEqual(reduce(moved, { kind: 'apply-proposal' }), moved)
})
