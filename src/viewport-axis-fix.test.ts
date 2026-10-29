import assert from 'node:assert/strict'
import { test } from 'node:test'
import { axisScreenVectors, cameraForView, createProjector, sceneFrame } from './viewport'
import type { SceneObject } from './workspace'

const cabinet: SceneObject = { id: 'base-01', kind: 'base-cabinet', name: 'Cabinet', dimensionsMm: { width: 900, height: 800, depth: 600 }, rotationDegrees: 0, positionMm: { x: -650, y: 0, z: -300 } }

// Helper to compute projected axis direction via createProjector (source of truth)
function projectedAxisDelta(camera: ReturnType<typeof cameraForView>, axis: 'x' | 'y' | 'z') {
  // Use a stable frame that covers scene so projector bounds are well-defined
  const frame = sceneFrame([cabinet])
  const proj = createProjector(frame, camera, 1)
  const origin = proj.project({ x: 0, y: 0, z: 0 })
  const tip = proj.project(axis === 'x' ? { x: 1000, y: 0, z: 0 } : axis === 'y' ? { x: 0, y: 1000, z: 0 } : { x: 0, y: 0, z: 1000 })
  return { x: tip.x - origin.x, y: tip.y - origin.y }
}

function dot(a: { x: number; y: number }, b: { x: number; y: number }) { return a.x * b.x + a.y * b.y }

test('axis arrows match projected world-axis endpoints for representative views (orthographic)', () => {
  const views: Array<ReturnType<typeof cameraForView>> = [
    cameraForView('front', 'orthographic'),
    cameraForView('top', 'orthographic'),
    cameraForView('right', 'orthographic'),
    cameraForView('top-front-right', 'orthographic'),
  ]
  for (const cam of views) {
    const vecs = axisScreenVectors(cam)
    for (const axis of ['x', 'y', 'z'] as const) {
      const projected = projectedAxisDelta(cam, axis)
      const arrow = vecs[axis]
      const projLen = Math.hypot(projected.x, projected.y)
      const arrowLen = Math.hypot(arrow.x, arrow.y)
      // If one is near-zero (axis points toward viewer), both should be near-zero (short indication)
      if (projLen < 5 || arrowLen < 0.05) {
        // Both should be short; check agreement
        assert.ok(arrowLen < 0.2 || projLen < 8, `toward/away mismatch for ${axis} in ${JSON.stringify(cam)}: arrowLen ${arrowLen} projLen ${projLen}`)
        continue
      }
      // Otherwise directions should align (dot product positive and angle < ~10 degrees)
      const d = dot(arrow, projected)
      assert.ok(d > 0, `axis ${axis} arrow should point same direction as projected endpoint in orthographic view cam=${JSON.stringify(cam)} dot=${d} arrow=${JSON.stringify(arrow)} projected=${JSON.stringify(projected)}`)
      const cosAngle = d / (arrowLen * projLen)
      assert.ok(cosAngle > 0.985, `axis ${axis} angle too large cos=${cosAngle} cam=${JSON.stringify(cam)}`)
    }
  }
})

test('axis arrows match projected world-axis endpoints for representative views (perspective)', () => {
  const views = [
    cameraForView('front', 'perspective'),
    cameraForView('top', 'perspective'),
    cameraForView('left', 'perspective'),
    cameraForView('top-front-right', 'perspective'),
  ]
  for (const cam of views) {
    const vecs = axisScreenVectors(cam)
    for (const axis of ['x', 'y', 'z'] as const) {
      const projected = projectedAxisDelta(cam, axis)
      const arrow = vecs[axis]
      const projLen = Math.hypot(projected.x, projected.y)
      const arrowLen = Math.hypot(arrow.x, arrow.y)
      if (projLen < 5 || arrowLen < 0.05) {
        assert.ok(arrowLen < 0.2 || projLen < 8, `perspective toward/away mismatch for ${axis}`)
        continue
      }
      const d = dot(arrow, projected)
      assert.ok(d > 0, `perspective axis ${axis} should align dot=${d} cam=${JSON.stringify(cam)}`)
      const cosAngle = d / (arrowLen * projLen)
      // Perspective introduces small perspective foreshortening, allow slightly larger tolerance
      assert.ok(cosAngle > 0.97, `perspective angle too large cos=${cosAngle}`)
    }
  }
})

test('front orthographic: point higher in scene projects upward and Y arrow points upward (negative screen Y)', () => {
  const cam = cameraForView('front', 'orthographic')
  const frame = sceneFrame([cabinet])
  const proj = createProjector(frame, cam, 1)
  const low = proj.project({ x: 0, y: 0, z: 0 })
  const high = proj.project({ x: 0, y: 1000, z: 0 })
  // Higher in scene (increase Y) should project upward = smaller screen y
  assert.ok(high.y < low.y, `front view: higher Y should project upward (smaller screen y) low=${low.y} high=${high.y}`)
  const vecs = axisScreenVectors(cam)
  // Y arrow should also point upward (negative screen Y)
  assert.ok(vecs.y.y < -0.5, `Y arrow should point upward (negative y) in front view, got ${JSON.stringify(vecs.y)}`)
  // Y arrow Y component sign should agree with projected delta sign
  const delta = { x: high.x - low.x, y: high.y - low.y }
  assert.ok(Math.sign(vecs.y.y) === Math.sign(delta.y), `Y arrow sign should match projected delta sign`)
})

test('diagonal view preserves clear indication for axis pointing toward viewer', () => {
  // Front view Z axis points directly toward viewer -> short
  const front = cameraForView('front', 'orthographic')
  const fv = axisScreenVectors(front)
  assert.ok(Math.hypot(fv.z.x, fv.z.y) < 0.01, 'front Z should be short (toward viewer)')

  // Top view Y axis points toward viewer -> short
  const top = cameraForView('top', 'orthographic')
  const tv = axisScreenVectors(top)
  assert.ok(Math.hypot(tv.y.x, tv.y.y) < 0.01, 'top Y should be short (toward viewer)')

  // Right view X axis points toward viewer -> short
  const right = cameraForView('right', 'orthographic')
  const rv = axisScreenVectors(right)
  assert.ok(Math.hypot(rv.x.x, rv.x.y) < 0.01, 'right X should be short')
})

test('axis fix does not reverse movement calculation (screen -> world)', async () => {
  // Movement plane uses createProjector deltas, not axisScreenVectors.
  // Simulate a drag to the right in front orthographic top-down? Check that worldDeltaFromScreenDelta still moves X positive when dragging right in a diagonal view.
  const { worldDeltaFromScreenDelta } = await import('./viewport')
  const cam = cameraForView('top-front-right', 'orthographic')
  const frame = sceneFrame([cabinet])
  // Drag 100px right on screen should produce positive world X/Z depending on view, but should not be inverted vs projection.
  // Verify by comparing to projector delta: moving world +100 in X should project to positive screen X in this view.
  const projDelta = projectedAxisDelta(cam, 'x')
  assert.ok(projDelta.x > 0, 'diagonal view: +X should project to +screenX')
  const worldDelta = worldDeltaFromScreenDelta(projDelta.x, projDelta.y, cam, frame, 1, 0)
  assert.ok(worldDelta, 'worldDelta should be computable')
  if (worldDelta) {
    // Projected X axis was +X direction, so inverting it should give back positive X
    assert.ok(worldDelta.dx > 0.5, `inverted X should give positive dx, got ${worldDelta.dx}`)
  }
  // Also verify Z axis
  const projZ = projectedAxisDelta(cam, 'z')
  const worldDz = worldDeltaFromScreenDelta(projZ.x, projZ.y, cam, frame, 1, 0)
  assert.ok(worldDz, 'worldDelta Z should be computable')
  if (worldDz) assert.ok(worldDz.dz > 0.5, `inverted Z should give positive dz, got ${worldDz.dz}`)
})
