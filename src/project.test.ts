import assert from 'node:assert/strict'
import { test } from 'node:test'
import { parseProject, serializeProject, validateProject, PROJECT_VERSION, MAX_IMAGE_BYTES, MAX_PROJECT_BYTES } from './project'
import type { SceneObject } from './workspace'

function sampleObjects(): SceneObject[] {
  return [
    { id: 'base-01', kind: 'base-cabinet', name: 'Base cabinet', dimensionsMm: { width: 914.4, height: 876.3, depth: 609.6 }, rotationDegrees: 45, positionMm: { x: 123.456, y: -50, z: 300 } },
    { id: 'wall-01', kind: 'wall', name: 'Wall', dimensionsMm: { width: 3048, height: 2438.4, depth: 152.4 }, rotationDegrees: 0, positionMm: { x: 0, y: 0, z: 0 } },
  ]
}

test('project round-trip preserves objects, dimensions, positions, rotations and photo', () => {
  const dataUrl = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII='
  const project = {
    version: PROJECT_VERSION,
    name: 'Test Kitchen',
    scene: sampleObjects(),
    selectedId: 'base-01',
    settings: { unit: 'in' as const, showGrid: true },
    camera: { yaw: 0.5, pitch: 0.3, projection: 'perspective' as const, zoom: 1.2 },
    viewMode: 'photo' as const,
    referencePhoto: { name: 'kitchen.png', mimeType: 'image/png', dataUrl },
  }
  const json = serializeProject(project)
  const parsed = parseProject(json)
  assert.equal(parsed.version, 1)
  assert.equal(parsed.name, 'Test Kitchen')
  assert.deepEqual(parsed.scene, project.scene)
  assert.equal(parsed.selectedId, 'base-01')
  assert.deepEqual(parsed.settings, project.settings)
  assert.deepEqual(parsed.camera, project.camera)
  assert.equal(parsed.viewMode, 'photo')
  assert.equal(parsed.referencePhoto?.dataUrl, dataUrl)
})

test('invalid and unsupported files are rejected', () => {
  assert.throws(() => parseProject('not json'), /Invalid project/)
  assert.throws(() => parseProject(JSON.stringify({ version: 99, name: 'x', scene: [] })), /Unsupported/)
  assert.throws(() => parseProject(JSON.stringify({ version: 1, name: '', scene: [] })), /project name/)
  // missing scene
  assert.throws(() => parseProject(JSON.stringify({ version: 1, name: 'a' })), /scene/)
  // invalid dimensions
  const bad = { version: 1, name: 'a', scene: [{ id: 'a', kind: 'base-cabinet', name: 'x', dimensionsMm: { width: NaN, height: 100, depth: 100 }, rotationDegrees: 0, positionMm: { x: 0, y: 0, z: 0 } }], selectedId: null, settings: { unit: 'in', showGrid: true }, camera: { yaw: 0, pitch: 0, projection: 'perspective', zoom: 1 }, viewMode: 'cad', referencePhoto: null }
  assert.throws(() => parseProject(JSON.stringify(bad)), /width/)
  // image too large (simulate) — must exceed decoded limit (~5 MB) and dataURL length
  const bigBase64 = 'data:image/png;base64,' + 'A'.repeat(MAX_IMAGE_BYTES * 2)
  const bigPhoto = { version: 1, name: 'a', scene: sampleObjects(), selectedId: null, settings: { unit: 'in', showGrid: true }, camera: { yaw: 0, pitch: 0, projection: 'perspective', zoom: 1 }, viewMode: 'cad', referencePhoto: { name: 'big.png', mimeType: 'image/png', dataUrl: bigBase64 } }
  assert.throws(() => validateProject(bigPhoto as any), /photo.*large|image.*limit|too large/i)
  // project too large
  const hugeScene = Array.from({ length: 60 }, (_, i) => ({ id: `id-${i}`, kind: 'base-cabinet' as const, name: 'Base', dimensionsMm: { width: 100, height: 100, depth: 100 }, rotationDegrees: 0, positionMm: { x: 0, y: 0, z: 0 } }))
  assert.throws(() => validateProject({ version: 1, name: 'a', scene: hugeScene, selectedId: null, settings: { unit: 'in', showGrid: true }, camera: { yaw: 0, pitch: 0, projection: 'perspective', zoom: 1 }, viewMode: 'cad', referencePhoto: null } as any), /too many|limit/i)
})

test('serialize excludes transient fields and resets stale proposal', () => {
  // validate does not allow proposal field; serialize should not include it
  const project = {
    version: 1, name: 'a', scene: sampleObjects(), selectedId: 'base-01',
    settings: { unit: 'mm' as const, showGrid: false },
    camera: { yaw: 0, pitch: 0, projection: 'orthographic' as const, zoom: 1 },
    viewMode: 'cad' as const, referencePhoto: null,
    // @ts-ignore extra transient field that must be stripped or rejected
    proposal: { kind: 'resize', status: 'pending', objectId: 'base-01', beforeMm: 100, afterMm: 200 },
  }
  // validate should reject unknown proposal preservation if present? Our serialize strips it; parse of serialized should not contain it
  const json = serializeProject(project as any)
  assert.equal(json.includes('proposal'), false)
  assert.equal(json.includes('BASETEN'), false)
})
