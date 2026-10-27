import type { SceneObject } from './workspace'

export type CameraView = 'isometric' | 'front' | 'back' | 'left' | 'right' | 'top'
export type Projection = 'perspective' | 'orthographic'
export interface Camera { yaw: number; pitch: number; projection: Projection }
export interface Point3 { x: number; y: number; z: number }
export interface ProjectedPoint { x: number; y: number; depth: number }
export interface SceneBox { object: SceneObject; origin: Point3 }
export type FaceSide = 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom'
export interface BoxFace { side: FaceSide; points: Point3[]; normal: Point3; center: Point3 }
export interface Bounds3 { min: Point3; max: Point3 }

const tau = Math.PI * 2
const clamp = (value: number, min: number, max: number) => Math.max(min, Math.min(value, max))
const normalize = (angle: number) => ((angle + Math.PI) % tau + tau) % tau - Math.PI

export function cameraForView(view: CameraView, projection: Projection): Camera {
  switch (view) {
    case 'isometric': return { yaw: Math.PI / 4, pitch: Math.atan(1 / Math.sqrt(2)), projection }
    case 'front': return { yaw: 0, pitch: 0, projection }
    case 'back': return { yaw: Math.PI, pitch: 0, projection }
    case 'left': return { yaw: -Math.PI / 2, pitch: 0, projection }
    case 'right': return { yaw: Math.PI / 2, pitch: 0, projection }
    case 'top': return { yaw: 0, pitch: Math.PI / 2, projection }
    default: { const exhaustive: never = view; return exhaustive }
  }
}

export function viewLabel(camera: Camera): string {
  const close = (a: number, b: number) => Math.abs(normalize(a - b)) < 0.025
  if (close(camera.pitch, Math.PI / 2)) return 'Top'
  if (close(camera.yaw, Math.PI / 4) && close(camera.pitch, Math.atan(1 / Math.sqrt(2)))) return 'Isometric'
  if (close(camera.pitch, 0)) {
    if (close(camera.yaw, 0)) return 'Front'
    if (close(camera.yaw, Math.PI)) return 'Back'
    if (close(camera.yaw, -Math.PI / 2)) return 'Left'
    if (close(camera.yaw, Math.PI / 2)) return 'Right'
  }
  return 'Orbit'
}

export function orbitCamera(camera: Camera, dx: number, dy: number): Camera {
  return { ...camera, yaw: normalize(camera.yaw - dx * 0.007), pitch: clamp(camera.pitch + dy * 0.007, -Math.PI / 2 + 0.012, Math.PI / 2 - 0.012) }
}

export function cameraDirection(camera: Camera): Point3 {
  return { x: Math.sin(camera.yaw) * Math.cos(camera.pitch), y: Math.sin(camera.pitch), z: Math.cos(camera.yaw) * Math.cos(camera.pitch) }
}

export function sceneBoxes(objects: SceneObject[]): SceneBox[] {
  let nextX = -650, nextZ = 1100, rowDepth = 0
  return objects.map((object) => {
    if (object.id === 'base-01') return { object, origin: { x: -650, y: 0, z: -300 } }
    if (object.id === 'upper-01') return { object, origin: { x: -650, y: 1480, z: -300 } }
    if (object.id === 'tall-01') return { object, origin: { x: 650, y: 0, z: -300 } }
    const { width, depth } = object.dimensionsMm
    if (nextX > -650 && nextX + width > 2400) { nextX = -650; nextZ += rowDepth + 260; rowDepth = 0 }
    const origin = { x: nextX, y: object.kind === 'wall-cabinet' ? 1480 : 0, z: nextZ }
    nextX += width + 180
    rowDepth = Math.max(rowDepth, depth)
    return { object, origin }
  })
}

// Coordinates use millimeters: X = width, Y = height, Z = depth toward the front.
// Fractional box coordinates make cabinet details follow every dimension/rotation.
export function boxPoint(box: SceneBox, x: number, y: number, z: number): Point3 {
  const { width, height, depth } = box.object.dimensionsMm
  const angle = box.object.rotationDegrees * Math.PI / 180
  const localX = (x - 0.5) * width, localZ = (z - 0.5) * depth
  return { x: box.origin.x + width / 2 + localX * Math.cos(angle) + localZ * Math.sin(angle), y: box.origin.y + y * height, z: box.origin.z + depth / 2 - localX * Math.sin(angle) + localZ * Math.cos(angle) }
}

export function boxFaces(box: SceneBox): BoxFace[] {
  const face = (side: FaceSide, coordinates: number[][], normal: Point3): BoxFace => {
    const points = coordinates.map(([x, y, z]) => boxPoint(box, x, y, z))
    const angle = box.object.rotationDegrees * Math.PI / 180
    return { side, points, normal: { x: normal.x * Math.cos(angle) + normal.z * Math.sin(angle), y: normal.y, z: -normal.x * Math.sin(angle) + normal.z * Math.cos(angle) }, center: { x: points.reduce((sum, p) => sum + p.x, 0) / 4, y: points.reduce((sum, p) => sum + p.y, 0) / 4, z: points.reduce((sum, p) => sum + p.z, 0) / 4 } }
  }
  return [
    face('front', [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], { x: 0, y: 0, z: 1 }),
    face('back', [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], { x: 0, y: 0, z: -1 }),
    face('left', [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], { x: -1, y: 0, z: 0 }),
    face('right', [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], { x: 1, y: 0, z: 0 }),
    face('top', [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], { x: 0, y: 1, z: 0 }),
    face('bottom', [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], { x: 0, y: -1, z: 0 }),
  ]
}

export function boundsOf(points: Point3[]): Bounds3 {
  if (points.length === 0) return { min: { x: -650, y: 0, z: -300 }, max: { x: 1100, y: 2240, z: 700 } }
  return { min: { x: Math.min(...points.map((p) => p.x)), y: Math.min(...points.map((p) => p.y)), z: Math.min(...points.map((p) => p.z)) }, max: { x: Math.max(...points.map((p) => p.x)), y: Math.max(...points.map((p) => p.y)), z: Math.max(...points.map((p) => p.z)) } }
}

export function createProjector(points: Point3[], camera: Camera, zoom: number) {
  const bounds = boundsOf(points)
  const center = { x: (bounds.min.x + bounds.max.x) / 2, y: (bounds.min.y + bounds.max.y) / 2, z: (bounds.min.z + bounds.max.z) / 2 }
  const radius = Math.max(1, Math.hypot(bounds.max.x - bounds.min.x, bounds.max.y - bounds.min.y, bounds.max.z - bounds.min.z) / 2)
  const distance = radius * 3.5
  const direction = cameraDirection(camera)
  const viewer = { x: center.x + direction.x * distance, y: center.y + direction.y * distance, z: center.z + direction.z * distance }
  const raw = (point: Point3): ProjectedPoint => {
    const x = point.x - center.x, y = point.y - center.y, z = point.z - center.z
    const depth = x * direction.x + y * direction.y + z * direction.z
    const factor = camera.projection === 'perspective' ? distance / (distance - depth) : 1
    return { x: (x * Math.cos(camera.yaw) - z * Math.sin(camera.yaw)) * factor, y: (x * Math.sin(camera.yaw) * Math.sin(camera.pitch) - y * Math.cos(camera.pitch) + z * Math.cos(camera.yaw) * Math.sin(camera.pitch)) * factor, depth }
  }
  const projected = points.length ? points.map(raw) : [raw(bounds.min), raw(bounds.max)]
  const minX = Math.min(...projected.map((p) => p.x)), maxX = Math.max(...projected.map((p) => p.x))
  const minY = Math.min(...projected.map((p) => p.y)), maxY = Math.max(...projected.map((p) => p.y))
  const scale = Math.min(870 / Math.max(1, maxX - minX), 670 / Math.max(1, maxY - minY)) * zoom
  const project = (point: Point3): ProjectedPoint => {
    const p = raw(point)
    return { x: 500 + (p.x - (minX + maxX) / 2) * scale, y: 400 + (p.y - (minY + maxY) / 2) * scale, depth: p.depth }
  }
  const isVisible = (face: BoxFace): boolean => {
    const vector = camera.projection === 'perspective' ? { x: viewer.x - face.center.x, y: viewer.y - face.center.y, z: viewer.z - face.center.z } : direction
    return face.normal.x * vector.x + face.normal.y * vector.y + face.normal.z * vector.z > 0.0001
  }
  return { project, isVisible }
}
