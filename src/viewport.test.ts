import assert from 'node:assert/strict'
import { test } from 'node:test'
import { boxFaces, boxPoint, cameraForView, createProjector, orbitCamera, sceneBoxes, viewLabel, type CameraView } from './viewport'
import type { SceneObject } from './workspace'

const cabinet: SceneObject = { id: 'base-01', kind: 'base-cabinet', name: 'Cabinet', dimensionsMm: { width: 900, height: 800, depth: 600 }, rotationDegrees: 0 }
const box = sceneBoxes([cabinet])[0]
const corners = boxFaces(box).flatMap((face) => face.points)

test('all six camera presets produce distinct views and truthful labels', () => {
  const views: CameraView[] = ['isometric', 'front', 'back', 'left', 'right', 'top']
  const signatures = views.map((view) => {
    const camera = cameraForView(view, 'orthographic')
    assert.equal(viewLabel(camera).toLowerCase(), view)
    const projector = createProjector(corners, camera, 1)
    return JSON.stringify(corners.map((point) => { const p = projector.project(point); return [Math.round(p.x), Math.round(p.y)] }))
  })
  assert.equal(new Set(signatures).size, 6)
})

test('front and top views genuinely collapse depth and height respectively', () => {
  const front = createProjector(corners, cameraForView('front', 'orthographic'), 1)
  const top = createProjector(corners, cameraForView('top', 'orthographic'), 1)
  const frontA = front.project(boxPoint(box, 0.2, 0.3, 0)), frontB = front.project(boxPoint(box, 0.2, 0.3, 1))
  assert.ok(Math.abs(frontA.x - frontB.x) < 0.0001 && Math.abs(frontA.y - frontB.y) < 0.0001)
  const topA = top.project(boxPoint(box, 0.2, 0, 0.4)), topB = top.project(boxPoint(box, 0.2, 1, 0.4))
  assert.ok(Math.abs(topA.x - topB.x) < 0.0001 && Math.abs(topA.y - topB.y) < 0.0001)
})

test('perspective makes near edges larger while orthographic keeps them parallel', () => {
  const edgeLengths = (projection: 'perspective' | 'orthographic') => {
    const { project } = createProjector(corners, cameraForView('front', projection), 1)
    return [0, 1].map((z) => {
      const a = project(boxPoint(box, 0, 0.5, z)), b = project(boxPoint(box, 1, 0.5, z))
      return Math.hypot(a.x - b.x, a.y - b.y)
    })
  }
  const ortho = edgeLengths('orthographic'), perspective = edgeLengths('perspective')
  assert.ok(Math.abs(ortho[0] - ortho[1]) < 0.0001)
  assert.ok(perspective[1] > perspective[0] * 1.1)
})

test('rotation changes world vertices and preserves the cabinet dimensions', () => {
  const rotated = sceneBoxes([{ ...cabinet, rotationDegrees: 90 }])[0]
  const a = boxPoint(rotated, 0, 0, 0), b = boxPoint(rotated, 1, 0, 0)
  assert.ok(Math.abs(a.x - b.x) < 0.0001)
  assert.ok(Math.abs(Math.abs(a.z - b.z) - cabinet.dimensionsMm.width) < 0.0001)
  assert.notDeepEqual(boxPoint(box, 0, 0, 0), a)
})

test('front camera exposes the front face and hides the back face', () => {
  const { isVisible } = createProjector(corners, cameraForView('front', 'orthographic'), 1)
  assert.deepEqual(boxFaces(box).filter(isVisible).map((face) => face.side), ['front'])
})

test('orbit changes camera angles and clamps pitch without losing projection', () => {
  const moved = orbitCamera(cameraForView('front', 'perspective'), 80, 40)
  assert.notEqual(moved.yaw, 0)
  assert.notEqual(moved.pitch, 0)
  assert.equal(moved.projection, 'perspective')
  assert.equal(viewLabel(moved), 'Orbit')
  assert.ok(orbitCamera(moved, 0, 100000).pitch < Math.PI / 2)
})

test('every added object has actual size and a visible scene box', () => {
  const objects = Array.from({ length: 15 }, (_, index) => ({ ...cabinet, id: `added-${index}` }))
  const boxes = sceneBoxes(objects)
  assert.equal(boxes.length, objects.length)
  for (const added of boxes) {
    const a = boxPoint(added, 0, 0, 0), b = boxPoint(added, 1, 0, 0)
    assert.equal(Math.hypot(b.x - a.x, b.z - a.z), 900)
  }
})
