import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CAMERA_VIEWS, FLOOR_GRID, cubeRegions, sceneFrame, boxFaces, boxPoint, cameraForView, createProjector, orbitCamera, sceneBoxes, viewLabel, type CameraView } from './viewport'
import type { SceneObject } from './workspace'

const cabinet: SceneObject = { id: 'base-01', kind: 'base-cabinet', name: 'Cabinet', dimensionsMm: { width: 900, height: 800, depth: 600 }, rotationDegrees: 0, positionMm: { x: -650, y: 0, z: -300 } }
const box = sceneBoxes([cabinet])[0]
const corners = boxFaces(box).flatMap((face) => face.points)

test('all 26 camera presets produce distinct views and truthful labels', () => {
  const views: CameraView[] = CAMERA_VIEWS.map((view) => view.id)
  const signatures = views.map((view) => {
    const camera = cameraForView(view, 'orthographic')
    assert.equal(viewLabel(camera), CAMERA_VIEWS.find((preset) => preset.id === view)?.label)
    const projector = createProjector(corners, camera, 1)
    return JSON.stringify(corners.map((point) => { const p = projector.project(point); return [Math.round(p.x), Math.round(p.y)] }))
  })
  assert.equal(new Set(signatures).size, 26)
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

test('cube registry and geometry contain six faces, twelve edges, and eight corners', () => {
  const regions = cubeRegions()
  assert.equal(regions.length, 26)
  assert.equal(regions.filter((region) => region.kind === 'face').length, 6)
  assert.equal(regions.filter((region) => region.kind === 'edge').length, 12)
  assert.equal(regions.filter((region) => region.kind === 'corner').length, 8)
  for (const region of regions) {
    assert.equal(region.points.length, region.kind === 'corner' ? 3 : 4)
    const { isVisible } = createProjector(corners, cameraForView(region.id, 'orthographic'), 1)
    assert.ok(isVisible(region))
  }
})

test('stored positions are independent of object IDs and array order', () => {
  const moved = { ...cabinet, id: 'unrelated-id', positionMm: { x: 1200, y: -304.8, z: 1500 } }
  const boxes = sceneBoxes([moved, cabinet])
  assert.deepEqual(boxes[0].origin, moved.positionMm)
  assert.deepEqual(sceneBoxes([moved])[0].origin, moved.positionMm)
})

test('moving a lone object changes its screen location against a fixed world frame', () => {
  const frame = sceneFrame([cabinet])
  const { project } = createProjector(frame, cameraForView('front', 'orthographic'), 1)
  const reference = project({ x: 0, y: 0, z: 0 })
  const before = project(boxPoint(box, 0.5, 0, 0.5))
  const moved = sceneBoxes([{ ...cabinet, positionMm: { ...cabinet.positionMm, x: cabinet.positionMm.x + 304.8 } }])[0]
  const after = project(boxPoint(moved, 0.5, 0, 0.5))
  assert.ok(after.x > before.x + 20)
  assert.deepEqual(project({ x: 0, y: 0, z: 0 }), reference)
})

test('the extended floor keeps fixed twelve-inch spacing and finite clipped projection', () => {
  const parallel = FLOOR_GRID.filter((segment) => segment.from.x === segment.to.x)
  for (let index = 1; index < parallel.length; index++) assert.ok(Math.abs(parallel[index].from.x - parallel[index - 1].from.x - 304.8) < 0.000001)
  for (const view of CAMERA_VIEWS) {
    const { projectSegment } = createProjector(sceneFrame([cabinet]), cameraForView(view.id, 'perspective'), 2)
    for (const segment of FLOOR_GRID) {
      const projected = projectSegment(segment.from, segment.to)
      if (projected) for (const point of projected) assert.ok(Number.isFinite(point.x) && Number.isFinite(point.y))
    }
  }
})

test('segments and polygons behind the camera plane are omitted', () => {
  const projector = createProjector(corners, cameraForView('front', 'perspective'), 1)
  assert.equal(projector.projectSegment({ x: 0, y: 0, z: 50000 }, { x: 100, y: 100, z: 51000 }), null)
  assert.deepEqual(projector.projectPolygon([{ x: 0, y: 0, z: 50000 }, { x: 100, y: 0, z: 50000 }, { x: 100, y: 100, z: 50000 }]), [])
  const crossing = projector.projectSegment({ x: 0, y: 0, z: 0 }, { x: 100, y: 100, z: 50000 })
  assert.ok(crossing)
  assert.ok(crossing.every((point) => Number.isFinite(point.x) && Number.isFinite(point.y)))
})
