import assert from 'node:assert/strict'
import { test } from 'node:test'
import { workspaceReducer as reduce, initialState } from './workspace'
import { parseProject, serializeProject, PROJECT_VERSION } from './project'
import type { ProjectFile } from './project'

function clone(o: any) { return JSON.parse(JSON.stringify(o)) }

test('workspace load resets history and clears pending proposal', () => {
  let s = clone(initialState) as typeof initialState
  // Apply a proposal then undo history exists
  s = reduce(s, { kind: 'resize', dimension: 'width', valueMm: 1200 })
  assert.ok(s.past.length > 0)
  // Add pending ai-proposal
  s = reduce(s, { kind: 'ai-proposal', objectId: 'base-01', objectName: 'Base cabinet', revision: s.revision, beforeMm: s.present[0].dimensionsMm.width, afterMm: 1300 })
  assert.equal(s.proposal.kind, 'resize')
  // Now load new project
  const newScene = [clone(s.present[0]), clone(s.present[1])]
  newScene[0].dimensionsMm.width = 500
  newScene[0].positionMm.x = 999
  newScene[0].rotationDegrees = 90
  const loaded = reduce(s, { kind: 'load', scene: newScene, selectedId: newScene[0].id })
  assert.equal(loaded.past.length, 0)
  assert.equal(loaded.future.length, 0)
  assert.equal(loaded.revision, 0)
  assert.equal(loaded.proposal.kind, 'none')
  assert.equal(loaded.present[0].dimensionsMm.width, 500)
  assert.equal(loaded.present[0].positionMm.x, 999)
  assert.equal(loaded.present[0].rotationDegrees, 90)
  assert.equal(loaded.selectedId, newScene[0].id)
})

test('workspace load selects first object when selectedId is dangling', () => {
  const s = clone(initialState) as typeof initialState
  const loaded = reduce(s, { kind: 'load', scene: s.present, selectedId: 'nonexistent' })
  assert.equal(loaded.selectedId, s.present[0].id)
})

test('serialize after AI-apply round-trip retains updated dimensions', () => {
  // Simulate user edited then AI proposal applied
  let s = clone(initialState) as typeof initialState
  // AI proposal
  const base = s.present.find(o => o.id === 'base-01')!
  const beforeMm = base.dimensionsMm.width
  const afterMm = 1066.8
  s = reduce(s, { kind: 'ai-proposal', objectId: 'base-01', objectName: 'Base cabinet', revision: s.revision, beforeMm, afterMm })
  s = reduce(s, { kind: 'apply-proposal' })
  assert.equal(s.present.find(o => o.id === 'base-01')!.dimensionsMm.width, afterMm)
  // Build project file and serialize
  const project: ProjectFile = {
    version: PROJECT_VERSION,
    name: 'AI edited',
    scene: s.present,
    selectedId: s.selectedId,
    settings: { unit: 'in', showGrid: true },
    camera: { yaw: 0.5, pitch: 0.3, projection: 'perspective', zoom: 1 },
    viewMode: 'cad',
    referencePhoto: null,
  }
  const json = serializeProject(project)
  const parsed = parseProject(json)
  assert.equal(parsed.scene.find(o => o.id === 'base-01')!.dimensionsMm.width, afterMm)
  // Opening parsed project resets history but keeps AI edit
  const loaded = reduce(s, { kind: 'load', scene: parsed.scene, selectedId: parsed.selectedId })
  assert.equal(loaded.present.find(o => o.id === 'base-01')!.dimensionsMm.width, afterMm)
  assert.equal(loaded.past.length, 0)
  assert.equal(loaded.proposal.kind, 'none')
})

test('invalid project parse leaves current scene object unchanged (simulated)', () => {
  const s = clone(initialState) as typeof initialState
  const original = JSON.stringify(s.present)
  // Attempt to parse various invalid files — each should throw, caller must not dispatch load
  const invalids = [
    'not json',
    JSON.stringify({ version: 99, name: 'x', scene: [] }),
    JSON.stringify({ version: 1, name: '', scene: [] }),
    JSON.stringify({ version: 1, name: 'a', scene: [{ id: 'a', kind: 'base-cabinet', name: 'x', dimensionsMm: { width: 5, height: 100, depth: 100 }, rotationDegrees: 0, positionMm: { x: 0, y: 0, z: 0 } }], selectedId: null, settings: { unit: 'in', showGrid: true }, camera: { yaw: 0, pitch: 0, projection: 'perspective', zoom: 1 }, viewMode: 'cad', referencePhoto: null }),
  ]
  for (const txt of invalids) {
    assert.throws(() => parseProject(txt))
  }
  // Ensure original state still intact
  assert.equal(JSON.stringify(s.present), original)
})

test('serialize strips transient fields and does not leak proposal', () => {
  const project: any = {
    version: 1, name: 'a', scene: clone(initialState).present, selectedId: 'base-01',
    settings: { unit: 'in', showGrid: true },
    camera: { yaw: 0, pitch: 0, projection: 'perspective', zoom: 1 },
    viewMode: 'cad', referencePhoto: null,
    proposal: { kind: 'resize', status: 'pending', objectId: 'base-01', beforeMm: 100, afterMm: 200 },
    apiKey: 'sk-secret', token: 'Bearer xyz',
  }
  const json = serializeProject(project)
  assert.equal(json.includes('proposal'), false)
  assert.equal(json.includes('apiKey'), false)
  assert.equal(json.includes('token'), false)
  assert.equal(json.includes('BASETEN'), false)
})
